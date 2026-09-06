import { describe, expect, it } from 'vitest';

import {
  buildPath,
  certificate,
  checkChainOfTrust,
  checkHostname,
  checkRevocation,
  checkUsage,
  checkValidityPeriod,
  DAY_MS,
  dnsName,
  formatDistinguishedName,
  intermediatesOf,
  ipAddress,
  isLegalWildcard,
  isSelfSigned,
  leafOf,
  matchesSan,
  matchHostname,
  normalizeHost,
  primaryFailure,
  signatureVerifies,
  stepById,
  validateChain,
  VALIDATION_STEP_IDS,
  type Certificate,
  type CertificateChain,
  type TrustStore,
  type ValidationOptions,
  type ValidationStepId,
} from './certificates';

// ---------------------------------------------------------------------------
// Fixtures
//
// One good chain -- leaf <- intermediate <- root -- built once, then each failure
// scenario derives from it by changing exactly one thing. That is what makes the central
// claim of this suite testable: a broken certificate must fail one step and only one.
// ---------------------------------------------------------------------------

/** A fixed instant to validate at. Never `Date.now()`; every test is reproducible. */
const NOW = Date.UTC(2026, 5, 1);

const ROOT = certificate({
  id: 'root',
  subject: { commonName: 'Example Root CA X1', organization: 'Example Trust Services' },
  issuer: { commonName: 'Example Root CA X1', organization: 'Example Trust Services' },
  notBefore: NOW - 3650 * DAY_MS,
  notAfter: NOW + 3650 * DAY_MS,
  basicConstraints: { ca: true },
});

const INTERMEDIATE = certificate({
  id: 'intermediate',
  subject: {
    commonName: 'Example Intermediate R3',
    organization: 'Example Trust Services',
  },
  issuer: ROOT.subject,
  notBefore: NOW - 365 * DAY_MS,
  notAfter: NOW + 365 * DAY_MS,
  basicConstraints: { ca: true, pathLenConstraint: 0 },
  issuedBy: ROOT.id,
});

const LEAF = certificate({
  id: 'leaf',
  subject: { commonName: 'www.example.com' },
  issuer: INTERMEDIATE.subject,
  notBefore: NOW - 30 * DAY_MS,
  notAfter: NOW + 60 * DAY_MS,
  subjectAltNames: [dnsName('www.example.com'), dnsName('example.com')],
  issuedBy: INTERMEDIATE.id,
});

const STORE: TrustStore = { name: 'system trust store', roots: [ROOT] };

const GOOD_CHAIN: CertificateChain = { presented: [LEAF, INTERMEDIATE] };

const OPTIONS: ValidationOptions = {
  host: 'www.example.com',
  now: NOW,
  store: STORE,
};

/** Swap the leaf of the good chain for a variant. */
function chainWithLeaf(leaf: Certificate): CertificateChain {
  return { presented: [leaf, INTERMEDIATE] };
}

/** Which steps failed, as ids -- the assertion every failure scenario makes. */
function failedStepIds(
  chain: CertificateChain,
  options: ValidationOptions,
): ValidationStepId[] {
  return validateChain(chain, options).failures.map((step) => step.id);
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

describe('certificate', () => {
  it('derives a stable placeholder signature and fingerprint from the id', () => {
    const first = certificate({
      id: 'stable',
      subject: { commonName: 'a' },
      issuer: { commonName: 'b' },
      notBefore: 0,
      notAfter: 1,
    });
    const second = certificate({
      id: 'stable',
      subject: { commonName: 'a' },
      issuer: { commonName: 'b' },
      notBefore: 0,
      notAfter: 1,
    });
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.signature).toBe(second.signature);
  });

  it('labels every derived value so it cannot be mistaken for real cryptography', () => {
    expect(LEAF.signature).toContain('PLACEHOLDER');
    expect(LEAF.fingerprint).toContain('PLACEHOLDER');
    expect(LEAF.publicKey.placeholder).toContain('PLACEHOLDER');
  });

  it('defaults a CA to keyCertSign and a leaf to serverAuth', () => {
    expect(ROOT.keyUsage).toContain('keyCertSign');
    expect(ROOT.extendedKeyUsage).toHaveLength(0);
    expect(LEAF.keyUsage).toContain('digitalSignature');
    expect(LEAF.extendedKeyUsage).toContain('serverAuth');
  });
});

describe('formatDistinguishedName', () => {
  it('orders the RDNs the way a certificate viewer prints them', () => {
    expect(
      formatDistinguishedName({
        commonName: 'www.example.com',
        organization: 'Example Ltd',
        country: 'GB',
      }),
    ).toBe('C=GB, O=Example Ltd, CN=www.example.com');
  });
});

describe('signatureVerifies / isSelfSigned', () => {
  it('links a certificate to the issuer that signed it', () => {
    expect(signatureVerifies(LEAF, INTERMEDIATE)).toBe(true);
    expect(signatureVerifies(INTERMEDIATE, ROOT)).toBe(true);
    expect(signatureVerifies(LEAF, ROOT)).toBe(false);
  });

  it('fails for a certificate altered after signing', () => {
    const altered = { ...LEAF, tampered: true };
    expect(signatureVerifies(altered, INTERMEDIATE)).toBe(false);
  });

  it('treats a root that names itself as self-signed', () => {
    expect(isSelfSigned(ROOT)).toBe(true);
    expect(isSelfSigned(LEAF)).toBe(false);
  });
});

describe('buildPath', () => {
  it('walks leaf to intermediate to the root in the store', () => {
    const { path, anchor } = buildPath(GOOD_CHAIN, STORE);
    expect(path.map((cert) => cert.id)).toEqual(['leaf', 'intermediate', 'root']);
    expect(anchor?.id).toBe('root');
  });

  it('appends the store copy of the root, not one the server sent', () => {
    // A server that also sends the root changes nothing: the client still terminates on
    // its own copy. Otherwise anyone could append a self-signed root and vouch for
    // themselves.
    const withRoot: CertificateChain = { presented: [LEAF, INTERMEDIATE, ROOT] };
    const { anchor } = buildPath(withRoot, STORE);
    expect(anchor).toBe(ROOT);
  });

  it('stops at the highest certificate it could reach when no root matches', () => {
    const orphan = certificate({
      id: 'orphan-intermediate',
      subject: { commonName: 'Unknown CA' },
      issuer: { commonName: 'Unknown Root' },
      notBefore: NOW - DAY_MS,
      notAfter: NOW + DAY_MS,
      basicConstraints: { ca: true },
      issuedBy: 'unknown-root',
    });
    const leaf = certificate({ ...leafInit(), issuedBy: orphan.id });
    const { anchor, brokenAt } = buildPath({ presented: [leaf, orphan] }, STORE);
    expect(anchor).toBeUndefined();
    expect(brokenAt?.id).toBe('orphan-intermediate');
  });

  it('does not loop forever on a cyclic bundle', () => {
    const a = certificate({
      id: 'cycle-a',
      subject: { commonName: 'A' },
      issuer: { commonName: 'B' },
      notBefore: 0,
      notAfter: NOW * 2,
      basicConstraints: { ca: true },
      issuedBy: 'cycle-b',
    });
    const b = certificate({
      id: 'cycle-b',
      subject: { commonName: 'B' },
      issuer: { commonName: 'A' },
      notBefore: 0,
      notAfter: NOW * 2,
      basicConstraints: { ca: true },
      issuedBy: 'cycle-a',
    });
    const { anchor } = buildPath({ presented: [a, b] }, STORE);
    expect(anchor).toBeUndefined();
  });
});

describe('leafOf / intermediatesOf', () => {
  it('splits the presented chain', () => {
    expect(leafOf(GOOD_CHAIN)?.id).toBe('leaf');
    expect(intermediatesOf(GOOD_CHAIN).map((cert) => cert.id)).toEqual(['intermediate']);
  });
});

// ---------------------------------------------------------------------------
// Hostname matching -- RFC 9525
// ---------------------------------------------------------------------------

describe('normalizeHost', () => {
  it('lower-cases and drops the fully-qualified trailing dot', () => {
    expect(normalizeHost('WWW.Example.COM.')).toBe('www.example.com');
  });
});

describe('isLegalWildcard', () => {
  it('accepts a wildcard that is the complete leftmost label', () => {
    expect(isLegalWildcard('*.example.com')).toBe(true);
    expect(isLegalWildcard('*.a.b.example.com')).toBe(true);
  });

  it('rejects a partial-label wildcard', () => {
    // RFC 9525 s 6.3: the wildcard is the *complete content* of the leftmost label.
    expect(isLegalWildcard('www*.example.com')).toBe(false);
    expect(isLegalWildcard('*w.example.com')).toBe(false);
  });

  it('rejects more than one wildcard', () => {
    expect(isLegalWildcard('*.*.example.com')).toBe(false);
  });

  it('rejects a wildcard outside the leftmost label', () => {
    expect(isLegalWildcard('foo.*.example.com')).toBe(false);
  });

  it('rejects a wildcard spanning a whole top-level domain', () => {
    expect(isLegalWildcard('*.com')).toBe(false);
    expect(isLegalWildcard('*')).toBe(false);
  });
});

describe('matchesSan', () => {
  it('matches an exact dNSName case-insensitively', () => {
    expect(matchesSan('WWW.example.com', dnsName('www.example.com')).matched).toBe(true);
  });

  it('matches a wildcard against exactly one leftmost label', () => {
    const result = matchesSan('www.example.com', dnsName('*.example.com'));
    expect(result.matched).toBe(true);
    expect(result.viaWildcard).toBe(true);
  });

  it('does not let a wildcard match the bare parent domain', () => {
    // *.example.com has a label to consume; example.com does not supply one.
    expect(matchesSan('example.com', dnsName('*.example.com')).matched).toBe(false);
  });

  it('does not let a wildcard span more than one label', () => {
    expect(matchesSan('a.b.example.com', dnsName('*.example.com')).matched).toBe(false);
  });

  it('refuses an illegal wildcard rather than matching it loosely', () => {
    const result = matchesSan('wwwX.example.com', dnsName('www*.example.com'));
    expect(result.matched).toBe(false);
    expect(result.detail).toContain('not a legal wildcard');
  });

  it('matches an IP literal only against an iPAddress SAN', () => {
    expect(matchesSan('192.0.2.10', ipAddress('192.0.2.10')).matched).toBe(true);
    expect(matchesSan('192.0.2.10', dnsName('192.0.2.10')).matched).toBe(false);
  });

  it('never matches a DNS name against an iPAddress SAN', () => {
    expect(matchesSan('www.example.com', ipAddress('192.0.2.10')).matched).toBe(false);
  });
});

describe('matchHostname', () => {
  it('keeps a verdict for every SAN so the UI can show what was tried', () => {
    const { matched, attempts } = matchHostname('example.com', LEAF);
    expect(matched).toBe(true);
    expect(attempts).toHaveLength(2);
    expect(attempts.filter((attempt) => attempt.matched)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The happy path
// ---------------------------------------------------------------------------

describe('validateChain on a good chain', () => {
  const validation = validateChain(GOOD_CHAIN, OPTIONS);

  it('passes every step', () => {
    expect(validation.trusted).toBe(true);
    expect(validation.failures).toHaveLength(0);
  });

  it('always reports all five steps, in a fixed order', () => {
    expect(validation.steps.map((step) => step.id)).toEqual(VALIDATION_STEP_IDS);
  });

  it('reports the path it built and the anchor it landed on', () => {
    expect(validation.path.map((cert) => cert.id)).toEqual([
      'leaf',
      'intermediate',
      'root',
    ]);
    expect(validation.anchor?.id).toBe('root');
  });

  it('has no primary failure to show the user', () => {
    expect(primaryFailure(validation)).toBeUndefined();
  });

  it('is deterministic', () => {
    expect(validateChain(GOOD_CHAIN, OPTIONS)).toEqual(
      validateChain(GOOD_CHAIN, OPTIONS),
    );
  });
});

// ---------------------------------------------------------------------------
// Each failure mode, in isolation
//
// The phase doc requires each cert-* scenario to break exactly one validation step, so
// that a learner sees which check fired. These tests are what enforce it.
// ---------------------------------------------------------------------------

function leafInit() {
  return {
    id: 'leaf',
    subject: { commonName: 'www.example.com' },
    issuer: INTERMEDIATE.subject,
    notBefore: NOW - 30 * DAY_MS,
    notAfter: NOW + 60 * DAY_MS,
    subjectAltNames: [dnsName('www.example.com'), dnsName('example.com')],
    issuedBy: INTERMEDIATE.id,
  };
}

describe('failure 1 of 5 -- the chain does not reach a trusted root', () => {
  const rogueRoot = certificate({
    id: 'rogue-root',
    subject: { commonName: 'Corporate Interception CA' },
    issuer: { commonName: 'Corporate Interception CA' },
    notBefore: NOW - 365 * DAY_MS,
    notAfter: NOW + 365 * DAY_MS,
    basicConstraints: { ca: true },
  });
  const rogueIntermediate = certificate({
    id: 'rogue-intermediate',
    subject: { commonName: 'Corporate Interception R1' },
    issuer: rogueRoot.subject,
    notBefore: NOW - 200 * DAY_MS,
    notAfter: NOW + 200 * DAY_MS,
    basicConstraints: { ca: true, pathLenConstraint: 0 },
    issuedBy: rogueRoot.id,
  });
  const leaf = certificate({ ...leafInit(), issuedBy: rogueIntermediate.id });
  const chain: CertificateChain = { presented: [leaf, rogueIntermediate] };

  it('fails only the chain-of-trust step', () => {
    expect(failedStepIds(chain, OPTIONS)).toEqual(['chain-of-trust']);
  });

  it('sends unknown_ca(48) and the browser authority error', () => {
    const step = stepById(validateChain(chain, OPTIONS), 'chain-of-trust');
    expect(step?.alert).toEqual({ name: 'unknown_ca', code: 48 });
    expect(step?.browserError).toBe('NET::ERR_CERT_AUTHORITY_INVALID');
  });

  it('leaves the path empty because no anchor was reached', () => {
    const validation = validateChain(chain, OPTIONS);
    expect(validation.anchor).toBeUndefined();
    expect(validation.path).toHaveLength(0);
  });

  it('still matches the hostname -- the checks do not short-circuit', () => {
    expect(stepById(validateChain(chain, OPTIONS), 'hostname')?.passed).toBe(true);
  });
});

describe('failure 1 of 5 -- variant: a certificate altered after signing', () => {
  const chain = chainWithLeaf({ ...LEAF, tampered: true });

  it('fails only the chain-of-trust step', () => {
    expect(failedStepIds(chain, OPTIONS)).toEqual(['chain-of-trust']);
  });

  it('says the signature does not verify rather than blaming the CA', () => {
    const step = stepById(validateChain(chain, OPTIONS), 'chain-of-trust');
    expect(step?.detail).toContain('does not verify');
    expect(step?.browserError).toBe('NET::ERR_CERT_INVALID');
  });
});

describe('failure 2 of 5 -- expired', () => {
  const chain = chainWithLeaf(
    certificate({
      ...leafInit(),
      notBefore: NOW - 400 * DAY_MS,
      notAfter: NOW - 10 * DAY_MS,
    }),
  );

  it('fails only the validity-period step', () => {
    expect(failedStepIds(chain, OPTIONS)).toEqual(['validity-period']);
  });

  it('sends certificate_expired(45) and the browser date error', () => {
    const step = stepById(validateChain(chain, OPTIONS), 'validity-period');
    expect(step?.alert).toEqual({ name: 'certificate_expired', code: 45 });
    expect(step?.browserError).toBe('NET::ERR_CERT_DATE_INVALID');
    expect(step?.detail).toContain('expired on 2026-05-22');
  });

  it('still chains to a trusted root -- expiry is not a trust failure', () => {
    expect(stepById(validateChain(chain, OPTIONS), 'chain-of-trust')?.passed).toBe(true);
  });
});

describe('failure 2 of 5 -- variant: not yet valid', () => {
  const chain = chainWithLeaf(
    certificate({
      ...leafInit(),
      notBefore: NOW + 10 * DAY_MS,
      notAfter: NOW + 100 * DAY_MS,
    }),
  );

  it('fails only the validity-period step, and blames the clock', () => {
    expect(failedStepIds(chain, OPTIONS)).toEqual(['validity-period']);
    expect(
      stepById(validateChain(chain, OPTIONS), 'validity-period')?.userFacing,
    ).toContain('clock on this device is wrong');
  });
});

describe('failure 2 of 5 -- variant: an expired intermediate', () => {
  const staleIntermediate = certificate({
    id: 'intermediate',
    subject: INTERMEDIATE.subject,
    issuer: ROOT.subject,
    notBefore: NOW - 800 * DAY_MS,
    notAfter: NOW - 5 * DAY_MS,
    basicConstraints: { ca: true, pathLenConstraint: 0 },
    issuedBy: ROOT.id,
  });

  it('is caught even though the leaf itself is in date', () => {
    const chain: CertificateChain = { presented: [LEAF, staleIntermediate] };
    expect(failedStepIds(chain, OPTIONS)).toEqual(['validity-period']);
    expect(stepById(validateChain(chain, OPTIONS), 'validity-period')?.detail).toContain(
      'Example Intermediate R3',
    );
  });
});

describe('failure 3 of 5 -- hostname mismatch', () => {
  const chain = chainWithLeaf(
    certificate({
      ...leafInit(),
      subject: { commonName: 'www.example.net' },
      subjectAltNames: [dnsName('www.example.net'), dnsName('example.net')],
    }),
  );

  it('fails only the hostname step', () => {
    expect(failedStepIds(chain, OPTIONS)).toEqual(['hostname']);
  });

  it('sends bad_certificate(42) and names both sides of the comparison', () => {
    const step = stepById(validateChain(chain, OPTIONS), 'hostname');
    expect(step?.alert).toEqual({ name: 'bad_certificate', code: 42 });
    expect(step?.browserError).toBe('NET::ERR_CERT_COMMON_NAME_INVALID');
    expect(step?.detail).toContain('www.example.com');
    expect(step?.detail).toContain('www.example.net');
  });
});

describe('failure 3 of 5 -- variant: the CN matches but no SAN does', () => {
  // RFC 9525 s 2: the Common Name must not be used to identify a service. A certificate
  // that "looks right" in a viewer still fails, and saying why is the teaching point.
  const chain = chainWithLeaf(
    certificate({
      ...leafInit(),
      subject: { commonName: 'www.example.com' },
      subjectAltNames: [dnsName('other.example.com')],
    }),
  );

  it('fails only the hostname step, despite the matching CN', () => {
    expect(failedStepIds(chain, OPTIONS)).toEqual(['hostname']);
  });

  it('says explicitly that the CN matched and is forbidden as a fallback', () => {
    const step = stepById(validateChain(chain, OPTIONS), 'hostname');
    expect(step?.detail).toContain('RFC 9525 s 2 forbids using it');
  });
});

describe('failure 3 of 5 -- variant: a wildcard that does not reach', () => {
  const chain = chainWithLeaf(
    certificate({ ...leafInit(), subjectAltNames: [dnsName('*.example.com')] }),
  );

  it('accepts one leftmost label', () => {
    expect(validateChain(chain, { ...OPTIONS, host: 'www.example.com' }).trusted).toBe(
      true,
    );
  });

  it('rejects two labels, failing only the hostname step', () => {
    const options = { ...OPTIONS, host: 'a.b.example.com' };
    expect(failedStepIds(chain, options)).toEqual(['hostname']);
  });

  it('rejects the bare parent domain, failing only the hostname step', () => {
    const options = { ...OPTIONS, host: 'example.com' };
    expect(failedStepIds(chain, options)).toEqual(['hostname']);
  });
});

describe('failure 4 of 5 -- revoked', () => {
  const chain = chainWithLeaf(
    certificate({
      ...leafInit(),
      revocation: {
        status: 'revoked',
        producedAt: NOW - DAY_MS,
        nextUpdate: NOW + 6 * DAY_MS,
        revokedAt: NOW - 3 * DAY_MS,
        reason: 'keyCompromise',
        stapled: true,
      },
    }),
  );

  it('fails only the revocation step', () => {
    expect(failedStepIds(chain, OPTIONS)).toEqual(['revocation']);
  });

  it('sends certificate_revoked(44) and names the reason', () => {
    const step = stepById(validateChain(chain, OPTIONS), 'revocation');
    expect(step?.alert).toEqual({ name: 'certificate_revoked', code: 44 });
    expect(step?.browserError).toBe('NET::ERR_CERT_REVOKED');
    expect(step?.detail).toContain('keyCompromise');
    expect(step?.userFacing).toContain('leaked');
  });

  it('still passes the other four -- a revoked certificate is otherwise well-formed', () => {
    const validation = validateChain(chain, OPTIONS);
    for (const id of VALIDATION_STEP_IDS) {
      if (id !== 'revocation') expect(stepById(validation, id)?.passed).toBe(true);
    }
  });
});

describe('revocation, when there is nothing to check', () => {
  it('soft-fails by default, and says why that is weak', () => {
    const step = checkRevocation(GOOD_CHAIN, OPTIONS);
    expect(step.passed).toBe(true);
    expect(step.detail).toContain('soft-fails');
  });

  it('hard-fails when the client is configured to', () => {
    const step = checkRevocation(GOOD_CHAIN, { ...OPTIONS, hardFailRevocation: true });
    expect(step.passed).toBe(false);
    expect(step.browserError).toBe('NET::ERR_CERT_UNABLE_TO_CHECK_REVOCATION');
  });

  it('accepts a fresh stapled "good"', () => {
    const chain = chainWithLeaf(
      certificate({
        ...leafInit(),
        revocation: {
          status: 'good',
          producedAt: NOW - DAY_MS,
          nextUpdate: NOW + 6 * DAY_MS,
          stapled: true,
        },
      }),
    );
    const step = checkRevocation(chain, OPTIONS);
    expect(step.passed).toBe(true);
    expect(step.detail).toContain('stapled');
  });

  it('treats a stapled response past nextUpdate as no response at all', () => {
    const chain = chainWithLeaf(
      certificate({
        ...leafInit(),
        revocation: {
          status: 'good',
          producedAt: NOW - 30 * DAY_MS,
          nextUpdate: NOW - 20 * DAY_MS,
          stapled: true,
        },
      }),
    );
    expect(checkRevocation(chain, OPTIONS).detail).toContain('expired at');
    expect(checkRevocation(chain, { ...OPTIONS, hardFailRevocation: true }).passed).toBe(
      false,
    );
  });
});

describe('failure 5 of 5 -- key usage and basic constraints', () => {
  it('rejects a leaf marked as a CA, failing only the usage step', () => {
    const chain = chainWithLeaf(
      certificate({
        ...leafInit(),
        basicConstraints: { ca: true },
        keyUsage: ['digitalSignature', 'keyCertSign'],
        extendedKeyUsage: ['serverAuth'],
      }),
    );
    expect(failedStepIds(chain, OPTIONS)).toEqual(['usage']);
    const step = stepById(validateChain(chain, OPTIONS), 'usage');
    expect(step?.alert).toEqual({ name: 'unsupported_certificate', code: 43 });
    expect(step?.detail).toContain('cA:true');
  });

  it('rejects a leaf without serverAuth, failing only the usage step', () => {
    const chain = chainWithLeaf(
      certificate({ ...leafInit(), extendedKeyUsage: ['clientAuth'] }),
    );
    expect(failedStepIds(chain, OPTIONS)).toEqual(['usage']);
    expect(stepById(validateChain(chain, OPTIONS), 'usage')?.detail).toContain(
      'serverAuth',
    );
  });

  it('rejects a leaf whose key may neither sign nor encipher', () => {
    const chain = chainWithLeaf(certificate({ ...leafInit(), keyUsage: ['cRLSign'] }));
    expect(failedStepIds(chain, OPTIONS)).toEqual(['usage']);
  });

  it('rejects an intermediate that is not marked as a CA', () => {
    const notACa = certificate({
      id: 'intermediate',
      subject: INTERMEDIATE.subject,
      issuer: ROOT.subject,
      notBefore: NOW - 365 * DAY_MS,
      notAfter: NOW + 365 * DAY_MS,
      basicConstraints: { ca: false },
      keyUsage: ['keyCertSign'],
      issuedBy: ROOT.id,
    });
    expect(failedStepIds({ presented: [LEAF, notACa] }, OPTIONS)).toEqual(['usage']);
  });

  it('rejects a CA whose keyUsage omits keyCertSign', () => {
    const noSigning = certificate({
      id: 'intermediate',
      subject: INTERMEDIATE.subject,
      issuer: ROOT.subject,
      notBefore: NOW - 365 * DAY_MS,
      notAfter: NOW + 365 * DAY_MS,
      basicConstraints: { ca: true },
      keyUsage: ['cRLSign'],
      issuedBy: ROOT.id,
    });
    expect(failedStepIds({ presented: [LEAF, noSigning] }, OPTIONS)).toEqual(['usage']);
    expect(
      stepById(validateChain({ presented: [LEAF, noSigning] }, OPTIONS), 'usage')?.detail,
    ).toContain('keyCertSign');
  });

  it('enforces pathLenConstraint', () => {
    // The pathLen:0 intermediate permits no further intermediates beneath it. Insert one
    // and the chain becomes too deep for what the CA authorised.
    const deeper = certificate({
      id: 'sub-intermediate',
      subject: { commonName: 'Example Sub CA' },
      issuer: INTERMEDIATE.subject,
      notBefore: NOW - 100 * DAY_MS,
      notAfter: NOW + 100 * DAY_MS,
      basicConstraints: { ca: true },
      issuedBy: INTERMEDIATE.id,
    });
    const leaf = certificate({ ...leafInit(), issuedBy: deeper.id });
    const chain: CertificateChain = { presented: [leaf, deeper, INTERMEDIATE] };
    expect(failedStepIds(chain, OPTIONS)).toEqual(['usage']);
    expect(stepById(validateChain(chain, OPTIONS), 'usage')?.detail).toContain(
      'pathLenConstraint:0',
    );
  });
});

// ---------------------------------------------------------------------------
// Independence
// ---------------------------------------------------------------------------

describe('the five checks are independent', () => {
  it('reports every failure when several break at once', () => {
    const chain: CertificateChain = {
      presented: [
        certificate({
          id: 'bad-everything',
          subject: { commonName: 'wrong.example.net' },
          issuer: { commonName: 'Nobody' },
          notBefore: NOW - 400 * DAY_MS,
          notAfter: NOW - 10 * DAY_MS,
          subjectAltNames: [dnsName('wrong.example.net')],
          basicConstraints: { ca: true },
          keyUsage: ['keyCertSign'],
          extendedKeyUsage: ['serverAuth'],
          issuedBy: 'nobody',
          revocation: {
            status: 'revoked',
            producedAt: NOW - DAY_MS,
            nextUpdate: NOW + DAY_MS,
            revokedAt: NOW - 2 * DAY_MS,
            reason: 'superseded',
            stapled: true,
          },
        }),
      ],
    };
    expect(failedStepIds(chain, OPTIONS)).toEqual(VALIDATION_STEP_IDS);
  });

  it('shows the user the first failure but keeps the rest available', () => {
    const chain = chainWithLeaf(
      certificate({
        ...leafInit(),
        notAfter: NOW - DAY_MS,
        subjectAltNames: [dnsName('elsewhere.example.com')],
      }),
    );
    const validation = validateChain(chain, OPTIONS);
    expect(primaryFailure(validation)?.id).toBe('validity-period');
    expect(validation.failures.map((step) => step.id)).toEqual([
      'validity-period',
      'hostname',
    ]);
  });

  it('runs each check standalone against the same inputs', () => {
    // The functions are exported individually so a scenario can assert on one without
    // running the others.
    expect(checkChainOfTrust(GOOD_CHAIN, OPTIONS).passed).toBe(true);
    expect(checkValidityPeriod(GOOD_CHAIN, OPTIONS).passed).toBe(true);
    expect(checkHostname(GOOD_CHAIN, OPTIONS).passed).toBe(true);
    expect(checkRevocation(GOOD_CHAIN, OPTIONS).passed).toBe(true);
    expect(checkUsage(GOOD_CHAIN).passed).toBe(true);
  });

  it('handles an empty chain without throwing', () => {
    const empty: CertificateChain = { presented: [] };
    const validation = validateChain(empty, OPTIONS);
    expect(validation.trusted).toBe(false);
    expect(validation.steps).toHaveLength(5);
  });
});

describe('every step explains itself whether or not it passed', () => {
  it('carries an explanation and a citation on all five', () => {
    for (const step of validateChain(GOOD_CHAIN, OPTIONS).steps) {
      expect(step.explain.length).toBeGreaterThan(0);
      expect(step.detail.length).toBeGreaterThan(0);
      expect(step.reference.rfc).toBeGreaterThan(0);
    }
  });

  it('attaches an alert and a browser error to every failure', () => {
    const chain = chainWithLeaf(
      certificate({ ...leafInit(), subjectAltNames: [dnsName('nope.example.com')] }),
    );
    for (const step of validateChain(chain, OPTIONS).failures) {
      expect(step.alert).toBeDefined();
      expect(step.browserError).toMatch(/^NET::ERR_/);
    }
  });
});
