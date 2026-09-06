/**
 * Certificates -- what the padlock actually checked.
 *
 * A certificate is a signed claim: *this public key belongs to whoever controls these
 * names, and I, the issuer, vouch for that until this date.* Everything a browser does
 * with one reduces to five independent questions, and the whole point of this file is
 * that they really are five, not one:
 *
 * 1. **{@link checkChainOfTrust}** -- does the signature chain reach a root the client
 *    already trusts?
 * 2. **{@link checkValidityPeriod}** -- is every certificate in the chain inside its
 *    `notBefore` / `notAfter` window right now?
 * 3. **{@link checkHostname}** -- does the name the user typed match a SAN entry, by the
 *    rules in RFC 9525?
 * 4. **{@link checkRevocation}** -- has the issuer said, since issuing it, that this
 *    certificate is no longer good?
 * 5. **{@link checkUsage}** -- do the key usage and basic constraints extensions permit
 *    each certificate to play the part it is playing?
 *
 * ## Why the checks do not short-circuit
 *
 * {@link validateChain} runs all five against the same inputs and reports all five
 * verdicts, even after one has failed. A real client aborts on the first failure, and for
 * a client that is right. For a *teaching* model it is exactly wrong: a learner shown one
 * red row learns "the certificate was bad", where a learner shown four green rows and one
 * red row learns which specific promise broke. Each `cert-*` scenario in phase 09 breaks
 * exactly one step, and that property is only observable because nothing short-circuits.
 *
 * A consequence worth stating: the checks are written to be genuinely independent. An
 * expired certificate still gets its hostname matched; an untrusted chain still gets its
 * dates read. No check may consult another check's verdict.
 *
 * ## Hostname matching follows RFC 9525, which means no CN fallback
 *
 * RFC 9525 obsoleted RFC 6125 and settled a long-running piece of folklore: the subject
 * Common Name **must not** be used to identify a service. RFC 9525 s 2 puts it plainly --
 * the CN RDN is free-form text with no type, so it cannot carry a domain name reliably.
 * Only `subjectAltName` counts. {@link checkHostname} therefore never looks at
 * {@link DistinguishedName.commonName}, and reports a certificate that has a matching CN
 * and no matching SAN as a **failure** -- which is what every current browser does, and
 * has done since roughly 2017.
 *
 * ## There is no cryptography in this file
 *
 * {@link Certificate.signature} and {@link Certificate.fingerprint} are opaque
 * placeholder strings (see `placeholder.ts`), and {@link signatureVerifies} compares
 * *modelled* facts -- "was this certificate issued by that one, and has anybody flipped
 * the `tampered` flag" -- rather than verifying anything. The structure of the chain is
 * modelled faithfully; the mathematics is absent on purpose. Treat every verdict here as
 * a teaching model and never as validation.
 */

import type { RfcRef } from '@/core/types/events';

import { placeholderFingerprint, placeholderSignature } from './placeholder';

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

/** RFC 9525 -- service identity in TLS. Obsoletes RFC 6125. */
export const RFC_9525: RfcRef = {
  rfc: 9525,
  title: 'Service Identity in TLS',
};

/** RFC 9525 s 2 -- the Common Name RDN must not be used to identify a service. */
export const RFC_9525_NO_CN: RfcRef = { ...RFC_9525, section: '2' };

/** RFC 9525 s 6.3 -- matching the DNS domain name portion, including wildcards. */
export const RFC_9525_MATCHING: RfcRef = { ...RFC_9525, section: '6.3' };

/** RFC 9525 s 6.4 -- matching an IP address portion against an iPAddress SAN. */
export const RFC_9525_IP: RfcRef = { ...RFC_9525, section: '6.4' };

/** RFC 9525 s 6.6 -- what a client does when no reference identifier matches. */
export const RFC_9525_OUTCOME: RfcRef = { ...RFC_9525, section: '6.6' };

/** RFC 5280 -- the certificate and CRL profile. */
export const RFC_5280: RfcRef = {
  rfc: 5280,
  title: 'Internet X.509 Public Key Infrastructure Certificate and CRL Profile',
};

/** RFC 5280 s 4.1.2.5 -- the validity period. */
export const RFC_5280_VALIDITY: RfcRef = { ...RFC_5280, section: '4.1.2.5' };

/** RFC 5280 s 4.2.1.9 -- basic constraints: the cA flag and pathLenConstraint. */
export const RFC_5280_BASIC_CONSTRAINTS: RfcRef = { ...RFC_5280, section: '4.2.1.9' };

/** RFC 5280 s 4.2.1.3 -- key usage. */
export const RFC_5280_KEY_USAGE: RfcRef = { ...RFC_5280, section: '4.2.1.3' };

/** RFC 5280 s 6.1 -- the certification path validation algorithm. */
export const RFC_5280_PATH: RfcRef = { ...RFC_5280, section: '6.1' };

/** RFC 6960 -- OCSP. */
export const RFC_6960: RfcRef = {
  rfc: 6960,
  title: 'X.509 Internet PKI Online Certificate Status Protocol -- OCSP',
};

/** RFC 6066 s 8 -- the certificate_status extension, i.e. OCSP stapling. */
export const RFC_6066_STAPLING: RfcRef = {
  rfc: 6066,
  section: '8',
  title: 'Transport Layer Security (TLS) Extensions: Extension Definitions',
};

/** RFC 8446 s 6.2 -- the alerts a failed certificate check produces. */
export const RFC_8446_ALERTS: RfcRef = {
  rfc: 8446,
  section: '6.2',
  title: 'The Transport Layer Security (TLS) Protocol Version 1.3',
};

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/**
 * The subject or issuer name.
 *
 * {@link commonName} is carried because certificates really do have one and the chain
 * view should show it -- it is the human label a CA puts on a certificate. It is
 * deliberately **never** consulted by {@link checkHostname}; see RFC 9525 s 2.
 */
export interface DistinguishedName {
  /** CN. Display only. Not an identifier -- RFC 9525 s 2. */
  readonly commonName: string;
  /** O. */
  readonly organization?: string;
  /** OU. */
  readonly organizationalUnit?: string;
  /** C, a two-letter country code. */
  readonly country?: string;
}

/** Render a DN the way `openssl x509 -subject` does, for the chain view. */
export function formatDistinguishedName(name: DistinguishedName): string {
  const parts = [
    name.country && `C=${name.country}`,
    name.organization && `O=${name.organization}`,
    name.organizationalUnit && `OU=${name.organizationalUnit}`,
    `CN=${name.commonName}`,
  ];
  return parts.filter(Boolean).join(', ');
}

/**
 * The kinds of `subjectAltName` this layer models.
 *
 * `dns` and `ip` are the two that matter for server identity. RFC 9525 keeps them
 * strictly apart: an IP literal is matched only against an `iPAddress` entry (s 6.4), and
 * never against a `dNSName`, no matter how the text happens to look.
 */
export type SanKind = 'dns' | 'ip';

/** One `subjectAltName` entry. */
export interface SubjectAltName {
  readonly kind: SanKind;
  /** A DNS name (possibly wildcarded) or an IP literal, exactly as encoded. */
  readonly value: string;
}

/** Build a `dNSName` SAN entry. */
export function dnsName(value: string): SubjectAltName {
  return { kind: 'dns', value };
}

/** Build an `iPAddress` SAN entry. */
export function ipAddress(value: string): SubjectAltName {
  return { kind: 'ip', value };
}

// ---------------------------------------------------------------------------
// Extensions
// ---------------------------------------------------------------------------

/** The `keyUsage` bits this layer models (RFC 5280 s 4.2.1.3). */
export type KeyUsage =
  'digitalSignature' | 'keyEncipherment' | 'keyAgreement' | 'keyCertSign' | 'cRLSign';

/** The `extKeyUsage` purposes this layer models (RFC 5280 s 4.2.1.12). */
export type ExtendedKeyUsage =
  'serverAuth' | 'clientAuth' | 'codeSigning' | 'emailProtection';

/**
 * `basicConstraints` (RFC 5280 s 4.2.1.9).
 *
 * The `cA` flag is the single most load-bearing bit in the whole PKI. A leaf certificate
 * with `cA: true` and `keyCertSign` could issue certificates for any name on the Internet
 * -- which is precisely the 2008-era bug where clients ignored this extension and any
 * leaf certificate could be used to mint others.
 */
export interface BasicConstraints {
  /** Whether this certificate may act as a certification authority. */
  readonly ca: boolean;
  /** How many intermediates may appear below this one. Absent means unlimited. */
  readonly pathLenConstraint?: number;
}

/** The public key a certificate binds to its subject. */
export interface PublicKeyInfo {
  /** e.g. `RSA`, `ECDSA`, `Ed25519`. */
  readonly algorithm: string;
  /** Key size in bits: 2048 for RSA, 256 for P-256. */
  readonly sizeBits: number;
  /** Named curve, for elliptic-curve keys. */
  readonly curve?: string;
  /**
   * An opaque stand-in for the encoded public key. Not a key. See `placeholder.ts`.
   */
  readonly placeholder: string;
}

// ---------------------------------------------------------------------------
// Revocation
// ---------------------------------------------------------------------------

/** The three answers an OCSP responder can give (RFC 6960 s 2.2). */
export type RevocationStatus = 'good' | 'revoked' | 'unknown';

/** Why a certificate was revoked (RFC 5280 s 5.3.1). */
export type RevocationReason =
  | 'unspecified'
  | 'keyCompromise'
  | 'cACompromise'
  | 'affiliationChanged'
  | 'superseded'
  | 'cessationOfOperation'
  | 'privilegeWithdrawn';

/**
 * A signed statement about one certificate's revocation status.
 *
 * ## Why stapling is the mechanism that matters
 *
 * The original design had the *client* contact the CA's OCSP responder during the
 * handshake. That is bad three ways: it adds a round trip to a third party before the
 * page loads, it tells the CA every site you visit, and when the responder is unreachable
 * clients "soft-fail" -- they proceed anyway, which makes the check worthless against an
 * attacker who can simply block it.
 *
 * OCSP stapling (RFC 6066 s 8) inverts it: the **server** fetches a signed, time-stamped
 * status for its own certificate periodically and hands it to the client inside the
 * handshake, in the `status_request` extension. No third-party round trip, no privacy
 * leak, and the response is signed by the CA so the server cannot forge a `good`.
 * `producedAt` and `nextUpdate` are what stop a server from stapling an ancient `good`
 * response forever after being revoked.
 */
export interface OcspResponse {
  readonly status: RevocationStatus;
  /** When the responder signed this, in epoch milliseconds. */
  readonly producedAt: number;
  /** After this instant the response is stale and must be refetched. Epoch ms. */
  readonly nextUpdate: number;
  /** When revocation took effect, if `status` is `revoked`. Epoch ms. */
  readonly revokedAt?: number;
  readonly reason?: RevocationReason;
  /** Whether the server delivered this in-handshake rather than the client fetching it. */
  readonly stapled: boolean;
}

// ---------------------------------------------------------------------------
// The certificate
// ---------------------------------------------------------------------------

/**
 * One certificate.
 *
 * Times are **epoch milliseconds**, not the simulation clock: a certificate's
 * validity window is an absolute wall-clock fact about the real world, and comparing it
 * to a virtual millisecond offset would be meaningless. {@link ValidationOptions.now} is
 * the one place a wall-clock instant enters the validation, and it is always passed in --
 * `Date.now()` appears nowhere in this layer, so every scenario is reproducible.
 */
export interface Certificate {
  /** Stable id, used to link a chain together and as a React key. */
  readonly id: string;
  readonly subject: DistinguishedName;
  readonly issuer: DistinguishedName;
  /** Hex serial, as a CA would print it. */
  readonly serialNumber: string;
  /** Start of the validity window, epoch ms (RFC 5280 s 4.1.2.5). */
  readonly notBefore: number;
  /** End of the validity window, epoch ms. */
  readonly notAfter: number;
  /** The identities this certificate speaks for. The only source for hostname matching. */
  readonly subjectAltNames: readonly SubjectAltName[];
  readonly publicKey: PublicKeyInfo;
  /** e.g. `sha256WithRSAEncryption`, `ecdsa-with-SHA256`. */
  readonly signatureAlgorithm: string;
  /** Opaque placeholder. Not a signature. */
  readonly signature: string;
  /** Opaque placeholder for the SHA-256 fingerprint of the DER encoding. */
  readonly fingerprint: string;
  readonly basicConstraints: BasicConstraints;
  readonly keyUsage: readonly KeyUsage[];
  readonly extendedKeyUsage: readonly ExtendedKeyUsage[];
  /**
   * The id of the certificate that signed this one. `undefined` on a self-signed root,
   * whose `issuer` equals its `subject`.
   *
   * A real client matches issuer DN plus authority key identifier and then verifies a
   * signature. This layer models the *result* of that as an explicit link, which is what
   * lets a scenario break the chain by pointing at a CA the client does not have.
   */
  readonly issuedBy?: string;
  /**
   * Set by a scenario to model a certificate whose bytes were altered after signing.
   *
   * This is the one hook for "the signature does not verify" that does not require real
   * cryptography. Nothing else in the TLS layer sets it.
   */
  readonly tampered?: boolean;
  /** Revocation status as known to the client, if any is available. */
  readonly revocation?: OcspResponse;
}

/**
 * A chain as the server presented it: leaf first, then intermediates.
 *
 * The root is deliberately **not** part of this. A server may send it and many do, but
 * the client ignores the copy on the wire and uses the one in its own trust store --
 * otherwise anyone could append a self-signed root and vouch for themselves. Modelling
 * the presented chain as leaf-plus-intermediates makes that impossible to get wrong here.
 */
export interface CertificateChain {
  /** Leaf first, then each intermediate, in issuing order. Never contains the root. */
  readonly presented: readonly Certificate[];
}

/** The client's set of trust anchors -- the certificates it believes without checking. */
export interface TrustStore {
  readonly name: string;
  readonly roots: readonly Certificate[];
}

/** The end-entity certificate: the one that speaks for the hostname. */
export function leafOf(chain: CertificateChain): Certificate | undefined {
  return chain.presented[0];
}

/** Everything between the leaf and the root. */
export function intermediatesOf(chain: CertificateChain): readonly Certificate[] {
  return chain.presented.slice(1);
}

// ---------------------------------------------------------------------------
// Building certificates
// ---------------------------------------------------------------------------

/** Fields {@link certificate} does not derive for you. */
export interface CertificateInit {
  readonly id: string;
  readonly subject: DistinguishedName;
  readonly issuer: DistinguishedName;
  readonly serialNumber?: string;
  readonly notBefore: number;
  readonly notAfter: number;
  readonly subjectAltNames?: readonly SubjectAltName[];
  readonly publicKey?: Partial<PublicKeyInfo>;
  readonly signatureAlgorithm?: string;
  readonly basicConstraints?: BasicConstraints;
  readonly keyUsage?: readonly KeyUsage[];
  readonly extendedKeyUsage?: readonly ExtendedKeyUsage[];
  readonly issuedBy?: string;
  readonly tampered?: boolean;
  readonly revocation?: OcspResponse;
}

/**
 * Build a certificate, filling in the placeholder signature and fingerprint.
 *
 * Both derived values are a deterministic function of `id`, so a scenario file never has
 * to invent hex and two runs of the same scenario are byte-identical.
 */
export function certificate(init: CertificateInit): Certificate {
  const ca = init.basicConstraints?.ca ?? false;
  return {
    id: init.id,
    subject: init.subject,
    issuer: init.issuer,
    serialNumber: init.serialNumber ?? placeholderFingerprint(`serial:${init.id}`, 8),
    notBefore: init.notBefore,
    notAfter: init.notAfter,
    subjectAltNames: init.subjectAltNames ?? [],
    publicKey: {
      algorithm: init.publicKey?.algorithm ?? 'RSA',
      sizeBits: init.publicKey?.sizeBits ?? 2048,
      curve: init.publicKey?.curve,
      placeholder: init.publicKey?.placeholder ?? placeholderSignature(`spki:${init.id}`),
    },
    signatureAlgorithm: init.signatureAlgorithm ?? 'sha256WithRSAEncryption',
    signature: placeholderSignature(`sig:${init.id}`),
    fingerprint: placeholderFingerprint(`fp:${init.id}`, 32),
    basicConstraints: init.basicConstraints ?? { ca: false },
    keyUsage: init.keyUsage ?? (ca ? ['keyCertSign', 'cRLSign'] : ['digitalSignature']),
    extendedKeyUsage: init.extendedKeyUsage ?? (ca ? [] : ['serverAuth']),
    issuedBy: init.issuedBy,
    tampered: init.tampered,
    revocation: init.revocation,
  };
}

// ---------------------------------------------------------------------------
// Hostname matching -- RFC 9525 s 6.3 and s 6.4
// ---------------------------------------------------------------------------

/** Why a candidate SAN entry did or did not match the reference identifier. */
export interface HostnameMatch {
  readonly san: SubjectAltName;
  readonly matched: boolean;
  /** Set when the SAN was matched by a wildcard rather than literally. */
  readonly viaWildcard: boolean;
  readonly detail: string;
}

/** An IPv4 dotted quad or anything containing a colon (IPv6). Good enough here. */
function looksLikeIpLiteral(host: string): boolean {
  if (host.includes(':')) return true;
  const octets = host.split('.');
  return (
    octets.length === 4 &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  );
}

/**
 * Lower-case a DNS name and drop one trailing dot.
 *
 * RFC 9525 s 6.3 requires case-insensitive ASCII comparison. The trailing dot is the
 * fully-qualified form -- `example.com.` and `example.com` name the same thing, and a
 * certificate never encodes the dot.
 */
export function normalizeHost(host: string): string {
  const trimmed = host.endsWith('.') ? host.slice(0, -1) : host;
  return trimmed.toLowerCase();
}

/**
 * Whether a `dNSName` SAN is a syntactically legal wildcard.
 *
 * RFC 9525 s 6.3 allows exactly one wildcard character, and only as the **complete
 * content** of the leftmost label. So:
 *
 * - `*.example.com` -- legal.
 * - `www*.example.com` -- not legal. Partial-label wildcards were removed; a client that
 *   honours them lets `wwwX.example.com` be impersonated by a certificate that looks
 *   narrower than it is.
 * - `*.*.example.com` -- not legal. Only one wildcard.
 * - `foo.*.example.com` -- not legal. Only the leftmost label.
 *
 * A wildcard also may not be the entire name (`*`), and this layer additionally refuses
 * a two-label wildcard such as `*.com`: matching a whole top-level domain is what RFC
 * 9525 s 7 warns about, and no CA will issue one.
 */
export function isLegalWildcard(san: string): boolean {
  const labels = san.split('.');
  if (labels.length < 3) return false;
  if (labels[0] !== '*') return false;
  return labels.slice(1).every((label) => label.length > 0 && !label.includes('*'));
}

/**
 * Match one reference identifier against one SAN entry, per RFC 9525.
 *
 * A wildcard covers **exactly one** label. `*.example.com` matches `www.example.com`; it
 * does not match `example.com` (no label to consume) and it does not match
 * `a.b.example.com` (two labels). That surprises people, and it is the reason wildcard
 * certificates are less useful than they look.
 */
export function matchesSan(host: string, san: SubjectAltName): HostnameMatch {
  const isIp = looksLikeIpLiteral(host);

  if (san.kind === 'ip') {
    if (!isIp) {
      return {
        san,
        matched: false,
        viaWildcard: false,
        detail: `iPAddress SAN is only compared against an IP reference identifier; "${host}" is a DNS name (RFC 9525 s 6.4).`,
      };
    }
    const matched = normalizeHost(san.value) === normalizeHost(host);
    return {
      san,
      matched,
      viaWildcard: false,
      detail: matched
        ? `iPAddress ${san.value} is an exact match (RFC 9525 s 6.4).`
        : `iPAddress ${san.value} does not equal ${host}.`,
    };
  }

  if (isIp) {
    return {
      san,
      matched: false,
      viaWildcard: false,
      detail: `"${host}" is an IP literal and must match an iPAddress SAN, never a dNSName (RFC 9525 s 6.4).`,
    };
  }

  const reference = normalizeHost(host);
  const presented = normalizeHost(san.value);

  if (!presented.includes('*')) {
    const matched = presented === reference;
    return {
      san,
      matched,
      viaWildcard: false,
      detail: matched
        ? `dNSName ${san.value} is an exact, case-insensitive match (RFC 9525 s 6.3).`
        : `dNSName ${san.value} does not equal ${reference}.`,
    };
  }

  if (!isLegalWildcard(presented)) {
    return {
      san,
      matched: false,
      viaWildcard: false,
      detail: `dNSName ${san.value} is not a legal wildcard: RFC 9525 s 6.3 allows one wildcard, as the complete content of the leftmost label only.`,
    };
  }

  const suffix = presented.slice('*.'.length);
  const referenceLabels = reference.split('.');
  const matched =
    referenceLabels.length === suffix.split('.').length + 1 &&
    referenceLabels.slice(1).join('.') === suffix;

  return {
    san,
    matched,
    viaWildcard: matched,
    detail: matched
      ? `Wildcard ${san.value} covers the single leftmost label "${referenceLabels[0]}" (RFC 9525 s 6.3).`
      : `Wildcard ${san.value} covers exactly one leftmost label, which ${reference} does not supply.`,
  };
}

/** Match a hostname against every SAN in a certificate, keeping each entry's verdict. */
export function matchHostname(
  host: string,
  cert: Certificate,
): { readonly matched: boolean; readonly attempts: readonly HostnameMatch[] } {
  const attempts = cert.subjectAltNames.map((san) => matchesSan(host, san));
  return { matched: attempts.some((attempt) => attempt.matched), attempts };
}

// ---------------------------------------------------------------------------
// Validation verdicts
// ---------------------------------------------------------------------------

/** The five checks, in the order the UI lists them. */
export type ValidationStepId =
  'chain-of-trust' | 'validity-period' | 'hostname' | 'revocation' | 'usage';

/** The five step ids, in display order. */
export const VALIDATION_STEP_IDS: readonly ValidationStepId[] = [
  'chain-of-trust',
  'validity-period',
  'hostname',
  'revocation',
  'usage',
];

/**
 * A TLS alert a failing check would send (RFC 8446 s 6.2).
 *
 * Carried so the UI can show that a certificate failure is not a browser invention: the
 * connection really is torn down, with a specific numbered alert on the wire.
 */
export interface TlsAlert {
  readonly name: string;
  readonly code: number;
}

const ALERT_BAD_CERTIFICATE: TlsAlert = { name: 'bad_certificate', code: 42 };
const ALERT_UNSUPPORTED_CERTIFICATE: TlsAlert = {
  name: 'unsupported_certificate',
  code: 43,
};
const ALERT_CERTIFICATE_REVOKED: TlsAlert = { name: 'certificate_revoked', code: 44 };
const ALERT_CERTIFICATE_EXPIRED: TlsAlert = { name: 'certificate_expired', code: 45 };
const ALERT_UNKNOWN_CA: TlsAlert = { name: 'unknown_ca', code: 48 };

/** The verdict of one check. */
export interface ValidationStep {
  readonly id: ValidationStepId;
  /** Short label for the row, e.g. `Chains to a trusted root`. */
  readonly title: string;
  readonly passed: boolean;
  /** One sentence naming what was compared and what came of it. */
  readonly detail: string;
  /** What this check is for, shown whether it passed or failed. */
  readonly explain: string;
  readonly reference: RfcRef;
  /** The alert this failure would send. Absent when the step passed. */
  readonly alert?: TlsAlert;
  /**
   * The error string a browser would show, e.g. `NET::ERR_CERT_DATE_INVALID`. Absent when
   * the step passed.
   */
  readonly browserError?: string;
  /** Plain-language version of the interstitial. Absent when the step passed. */
  readonly userFacing?: string;
}

/** The whole verification, with every step's verdict retained. */
export interface ChainValidation {
  /** The name the client asked for -- the reference identifier of RFC 9525 s 6.1. */
  readonly host: string;
  /** When validation ran, epoch ms. */
  readonly at: number;
  /** All five, always, in {@link VALIDATION_STEP_IDS} order. */
  readonly steps: readonly ValidationStep[];
  /** True only when every step passed. */
  readonly trusted: boolean;
  /**
   * The path the client built: leaf, intermediates, then the trust anchor it landed on.
   * Empty when no path to a trusted root exists.
   */
  readonly path: readonly Certificate[];
  /** The root the path terminated at, if any. */
  readonly anchor?: Certificate;
  /** The steps that failed, in display order. Empty when `trusted`. */
  readonly failures: readonly ValidationStep[];
}

// ---------------------------------------------------------------------------
// Path building
// ---------------------------------------------------------------------------

/**
 * A modelled signature check.
 *
 * Real path validation verifies `issuer.publicKey` against `subject.signature` over the
 * subject's encoded body. There is no cryptography in this layer, so this asserts the
 * two modelled facts that stand in for it: the certificates are actually linked, and
 * nobody set {@link Certificate.tampered}.
 */
export function signatureVerifies(subject: Certificate, issuer: Certificate): boolean {
  if (subject.tampered) return false;
  return subject.issuedBy === issuer.id;
}

/** A self-signed certificate names itself as its own issuer. */
export function isSelfSigned(cert: Certificate): boolean {
  return cert.issuedBy === undefined || cert.issuedBy === cert.id;
}

/**
 * Walk from the leaf up, following `issuedBy`, until a trust anchor is reached.
 *
 * Returns the certificates it walked plus the anchor it landed on. `anchor` is
 * `undefined` when the walk ran out of presented certificates without reaching a root in
 * the store -- the "untrusted CA" case, which looks identical on the wire to a chain that
 * is simply missing an intermediate. That ambiguity is real, and the reason
 * "misconfigured server" and "attack" produce the same browser warning.
 */
export function buildPath(
  chain: CertificateChain,
  store: TrustStore,
): {
  readonly path: readonly Certificate[];
  readonly anchor?: Certificate;
  readonly brokenAt?: Certificate;
} {
  const path: Certificate[] = [];
  const bySubject = new Map(chain.presented.map((cert) => [cert.id, cert]));

  let current = leafOf(chain);
  const seen = new Set<string>();

  while (current) {
    if (seen.has(current.id)) break; // A cycle; a malformed bundle, not a valid path.
    seen.add(current.id);
    path.push(current);

    const anchor = store.roots.find((root) =>
      signatureVerifies(current as Certificate, root),
    );
    if (anchor) {
      return { path: [...path, anchor], anchor };
    }

    // A self-signed certificate that is not in the store terminates the walk: there is
    // nowhere further up to go, and it vouches only for itself.
    if (isSelfSigned(current)) {
      return { path, brokenAt: current };
    }

    const next = current.issuedBy ? bySubject.get(current.issuedBy) : undefined;
    if (!next || !signatureVerifies(current, next)) {
      return { path, brokenAt: current };
    }
    current = next;
  }

  return { path, brokenAt: current };
}

// ---------------------------------------------------------------------------
// The five checks
// ---------------------------------------------------------------------------

/** What the checks need besides the chain itself. */
export interface ValidationOptions {
  /** The hostname the user asked for. */
  readonly host: string;
  /** The instant to validate at, epoch ms. Always supplied -- never `Date.now()`. */
  readonly now: number;
  readonly store: TrustStore;
  /**
   * How to treat a certificate with no revocation information at all.
   *
   * Browsers **soft-fail** by default: no OCSP response means "carry on". That is a
   * deliberate availability trade-off and it is also why revocation is the weakest of the
   * five checks -- an attacker who can present a revoked certificate can usually also
   * block the status lookup. Set `hardFail` to model a client that refuses instead.
   */
  readonly hardFailRevocation?: boolean;
}

/**
 * Step 1 -- does the chain reach a root the client already trusts?
 *
 * Trust in the web PKI is not transitive discovery: the client ships with a fixed set of
 * roots and a chain is only worth anything if it terminates in one of them. A self-signed
 * certificate, or one issued by a CA the store has never heard of, fails here regardless
 * of how well-formed it is -- there is nothing wrong with its contents, there is simply
 * nobody the client trusts saying they are true.
 */
export function checkChainOfTrust(
  chain: CertificateChain,
  options: ValidationOptions,
): ValidationStep {
  const base = {
    id: 'chain-of-trust' as const,
    title: 'Signature chains to a trusted root',
    explain:
      'The client trusts a fixed set of root certificates it shipped with. A chain is worth nothing unless each certificate is signed by the next and the last one is a root already in that store.',
    reference: RFC_5280_PATH,
  };

  const leaf = leafOf(chain);
  if (!leaf) {
    return {
      ...base,
      passed: false,
      detail: 'The server presented no certificate at all.',
      alert: ALERT_BAD_CERTIFICATE,
      browserError: 'NET::ERR_CERT_INVALID',
      userFacing: 'This site sent no certificate, so there is nothing to verify.',
    };
  }

  const { path, anchor, brokenAt } = buildPath(chain, options.store);

  if (anchor) {
    const hops = path.length - 1;
    return {
      ...base,
      passed: true,
      detail: `${leaf.subject.commonName} chains through ${hops === 1 ? 'no intermediates' : `${hops - 1} intermediate${hops - 1 === 1 ? '' : 's'}`} to ${anchor.subject.commonName}, which is in the ${options.store.name}.`,
    };
  }

  if (brokenAt?.tampered) {
    return {
      ...base,
      passed: false,
      detail: `The signature on ${brokenAt.subject.commonName} does not verify against its issuer's key -- the certificate was altered after it was signed.`,
      alert: ALERT_BAD_CERTIFICATE,
      browserError: 'NET::ERR_CERT_INVALID',
      userFacing: 'This certificate has been modified since it was issued.',
    };
  }

  const stuckOn = brokenAt ?? leaf;
  return {
    ...base,
    passed: false,
    detail: `The chain stops at ${stuckOn.subject.commonName}, issued by "${stuckOn.issuer.commonName}", which is not in the ${options.store.name} and was not supplied as an intermediate.`,
    alert: ALERT_UNKNOWN_CA,
    browserError: 'NET::ERR_CERT_AUTHORITY_INVALID',
    userFacing:
      'This certificate was issued by an authority your device does not trust. A misconfigured server that forgot to send its intermediate looks exactly like this, and so does an interception proxy.',
  };
}

/**
 * Step 2 -- is every certificate in the chain currently inside its validity window?
 *
 * Checked over the whole presented chain, not just the leaf: an expired intermediate
 * invalidates everything under it. `notBefore` matters as much as `notAfter` and catches
 * the other common cause, a client whose clock is wrong -- which is why "your date and
 * time are incorrect" is one of the browser's suggestions here.
 */
export function checkValidityPeriod(
  chain: CertificateChain,
  options: ValidationOptions,
): ValidationStep {
  const base = {
    id: 'validity-period' as const,
    title: 'Within its validity window',
    explain:
      'Every certificate names the window it is good for. Short lifetimes are the practical limit on how long a mis-issued or stolen certificate stays useful, which is why public TLS certificates are now measured in weeks rather than years.',
    reference: RFC_5280_VALIDITY,
  };

  const notYetValid = chain.presented.find((cert) => options.now < cert.notBefore);
  if (notYetValid) {
    return {
      ...base,
      passed: false,
      detail: `${notYetValid.subject.commonName} is not valid until ${formatInstant(notYetValid.notBefore)}, which is ${describeGap(notYetValid.notBefore - options.now)} from now.`,
      alert: ALERT_CERTIFICATE_EXPIRED,
      browserError: 'NET::ERR_CERT_DATE_INVALID',
      userFacing:
        'This certificate is not valid yet. Usually that means the clock on this device is wrong, not that the site is.',
    };
  }

  const expired = chain.presented.find((cert) => options.now > cert.notAfter);
  if (expired) {
    return {
      ...base,
      passed: false,
      detail: `${expired.subject.commonName} expired on ${formatInstant(expired.notAfter)}, ${describeGap(options.now - expired.notAfter)} ago.`,
      alert: ALERT_CERTIFICATE_EXPIRED,
      browserError: 'NET::ERR_CERT_DATE_INVALID',
      userFacing:
        'This certificate expired. The connection is still encrypted, but nobody is currently vouching for who is on the other end.',
    };
  }

  const leaf = leafOf(chain);
  return {
    ...base,
    passed: true,
    detail: leaf
      ? `All ${chain.presented.length} presented certificate${chain.presented.length === 1 ? '' : 's'} are in window; the leaf is good until ${formatInstant(leaf.notAfter)}.`
      : 'Nothing to check.',
  };
}

/**
 * Step 3 -- does the hostname match a SAN entry?
 *
 * This is the check that makes the other four mean anything. A perfectly valid,
 * unexpired, unrevoked certificate from a trusted CA proves the identity of *whoever it
 * was issued to* -- which is only useful if that is the site you asked for. Without this
 * check, anyone with any valid certificate could impersonate anyone.
 *
 * Per RFC 9525 s 2 the subject Common Name is **not** consulted, even when it holds the
 * right name and the SAN list does not. `commonNameWouldHaveMatched` in the detail text
 * exists to make that visible: a certificate that "looks right" still fails, and every
 * current browser agrees.
 */
export function checkHostname(
  chain: CertificateChain,
  options: ValidationOptions,
): ValidationStep {
  const base = {
    id: 'hostname' as const,
    title: 'Hostname matches a SAN entry',
    explain:
      'The name you asked for must appear in the certificate subjectAltName list. RFC 9525 s 2 removed the old Common Name fallback entirely: the CN is free-form text, not a typed identifier, so it is display only.',
    reference: RFC_9525_MATCHING,
  };

  const leaf = leafOf(chain);
  if (!leaf) {
    return {
      ...base,
      passed: false,
      detail: 'No leaf certificate to match against.',
      alert: ALERT_BAD_CERTIFICATE,
      browserError: 'NET::ERR_CERT_COMMON_NAME_INVALID',
    };
  }

  const { matched, attempts } = matchHostname(options.host, leaf);
  if (matched) {
    const hit = attempts.find((attempt) => attempt.matched);
    return {
      ...base,
      passed: true,
      detail: hit?.detail ?? `${options.host} matched a SAN entry.`,
    };
  }

  const presented = leaf.subjectAltNames.map((san) => san.value).join(', ') || '(none)';
  const commonNameWouldHaveMatched =
    normalizeHost(leaf.subject.commonName) === normalizeHost(options.host);

  const cnNote = commonNameWouldHaveMatched
    ? ` The subject CN is "${leaf.subject.commonName}", which does match -- but RFC 9525 s 2 forbids using it, so this is still a failure.`
    : '';

  return {
    ...base,
    passed: false,
    detail: `You asked for ${options.host}; the certificate speaks for ${presented}.${cnNote}`,
    alert: ALERT_BAD_CERTIFICATE,
    // Chrome's error code still says COMMON_NAME. The name is a fossil from before RFC
    // 6125; the check behind it has been SAN-only for years.
    browserError: 'NET::ERR_CERT_COMMON_NAME_INVALID',
    userFacing: `This certificate is valid, but it was issued for a different site. Its identity does not cover ${options.host}.`,
  };
}

/**
 * Step 4 -- has the issuer revoked this certificate since it was issued?
 *
 * The other four checks look at what the certificate says. This one asks whether the CA
 * has changed its mind -- which is the only recourse when a private key leaks, and the
 * only one of the five that needs information from outside the handshake.
 *
 * Stapling (RFC 6066 s 8) is the mechanism that works: the server attaches a recent
 * CA-signed status to the handshake, so there is no third-party round trip and no privacy
 * leak. A stapled response past its `nextUpdate` is treated as no response at all, which
 * is what prevents a revoked server from stapling one old `good` forever.
 */
export function checkRevocation(
  chain: CertificateChain,
  options: ValidationOptions,
): ValidationStep {
  const base = {
    id: 'revocation' as const,
    title: 'Not revoked',
    explain:
      'A certificate can be withdrawn before it expires -- typically because its private key leaked. OCSP stapling is the mechanism that actually works: the server fetches a signed status for itself periodically and hands it over inside the handshake.',
    reference: RFC_6066_STAPLING,
  };

  const revoked = chain.presented.find((cert) => cert.revocation?.status === 'revoked');
  if (revoked?.revocation) {
    const { revokedAt, reason, stapled } = revoked.revocation;
    return {
      ...base,
      passed: false,
      detail: `${revoked.subject.commonName} was revoked${revokedAt ? ` on ${formatInstant(revokedAt)}` : ''}${reason ? ` (reason: ${reason})` : ''}, reported by ${stapled ? 'a stapled OCSP response' : 'the OCSP responder'}.`,
      alert: ALERT_CERTIFICATE_REVOKED,
      browserError: 'NET::ERR_CERT_REVOKED',
      userFacing:
        reason === 'keyCompromise'
          ? 'The private key for this certificate is known to have leaked, and the issuer has withdrawn it. Whoever is on the other end may not be the real site.'
          : 'The issuer has withdrawn this certificate. It should no longer be in use.',
    };
  }

  const leaf = leafOf(chain);
  const status = leaf?.revocation;

  if (!status) {
    if (options.hardFailRevocation) {
      return {
        ...base,
        passed: false,
        detail:
          'No OCSP response was stapled and this client is configured to hard-fail rather than assume the certificate is good.',
        alert: ALERT_BAD_CERTIFICATE,
        browserError: 'NET::ERR_CERT_UNABLE_TO_CHECK_REVOCATION',
        userFacing: 'The revocation status of this certificate could not be established.',
      };
    }
    return {
      ...base,
      passed: true,
      detail:
        'No revocation information was available, and the client soft-fails: absence of a status is treated as good. This is the weakest of the five checks, because an attacker who can present a revoked certificate can usually also block the status lookup.',
    };
  }

  if (status.stapled && options.now > status.nextUpdate) {
    return {
      ...base,
      passed: options.hardFailRevocation ? false : true,
      detail: `The stapled OCSP response expired at ${formatInstant(status.nextUpdate)} and is treated as no response at all. Without nextUpdate, a revoked server could staple one old "good" forever.`,
      alert: options.hardFailRevocation ? ALERT_BAD_CERTIFICATE : undefined,
      browserError: options.hardFailRevocation
        ? 'NET::ERR_CERT_UNABLE_TO_CHECK_REVOCATION'
        : undefined,
    };
  }

  if (status.status === 'unknown') {
    return {
      ...base,
      passed: !options.hardFailRevocation,
      detail:
        'The responder returned "unknown" -- it has no record of this serial. Soft-failing clients continue anyway.',
      alert: options.hardFailRevocation ? ALERT_BAD_CERTIFICATE : undefined,
      browserError: options.hardFailRevocation
        ? 'NET::ERR_CERT_UNABLE_TO_CHECK_REVOCATION'
        : undefined,
    };
  }

  return {
    ...base,
    passed: true,
    detail: `${status.stapled ? 'A stapled' : 'A fetched'} OCSP response signed at ${formatInstant(status.producedAt)} says "good", and is fresh until ${formatInstant(status.nextUpdate)}.`,
  };
}

/**
 * Step 5 -- are the key usage and basic constraints right for each certificate's role?
 *
 * Two separate failures live here, and both were real historical vulnerabilities:
 *
 * - A **leaf with `cA: true`** could sign certificates for any name on the Internet.
 *   Clients that ignored `basicConstraints` -- which several did until 2002, and Apple's
 *   again in 2011 -- let any valid leaf mint certificates for any site.
 * - A **CA without `keyCertSign`**, or a leaf without `serverAuth` in its extended key
 *   usage, is being used for a job its issuer did not authorise.
 *
 * `pathLenConstraint` is checked too: it caps how many further intermediates may appear
 * below a CA, which is how a CA delegates narrowly instead of unboundedly.
 *
 * Alone among the five, this check takes no {@link ValidationOptions}: what a certificate
 * is permitted to do is a property of the certificate, not of who asked for it or when.
 */
export function checkUsage(chain: CertificateChain): ValidationStep {
  const base = {
    id: 'usage' as const,
    title: 'Key usage and basic constraints are appropriate',
    explain:
      'basicConstraints says whether a certificate may sign other certificates; keyUsage and extKeyUsage say what its key is allowed to do. A leaf marked cA:true with keyCertSign could impersonate every site on the Internet.',
    reference: RFC_5280_BASIC_CONSTRAINTS,
  };

  const leaf = leafOf(chain);
  if (!leaf) {
    return {
      ...base,
      passed: false,
      detail: 'No certificate to inspect.',
      alert: ALERT_UNSUPPORTED_CERTIFICATE,
      browserError: 'NET::ERR_CERT_INVALID',
    };
  }

  if (leaf.basicConstraints.ca) {
    return {
      ...base,
      passed: false,
      detail: `The end-entity certificate ${leaf.subject.commonName} is marked cA:true. A certificate serving a website must not also be able to issue certificates.`,
      alert: ALERT_UNSUPPORTED_CERTIFICATE,
      browserError: 'NET::ERR_CERT_INVALID',
      reference: RFC_5280_BASIC_CONSTRAINTS,
      userFacing:
        'This certificate claims powers it should not have: it is presented as a website identity but is also marked as a certificate authority.',
    };
  }

  if (!leaf.extendedKeyUsage.includes('serverAuth')) {
    return {
      ...base,
      passed: false,
      detail: `${leaf.subject.commonName} does not list serverAuth in its extended key usage (it lists ${leaf.extendedKeyUsage.join(', ') || 'nothing'}), so it is not authorised to identify a TLS server.`,
      alert: ALERT_UNSUPPORTED_CERTIFICATE,
      browserError: 'NET::ERR_CERT_INVALID',
      userFacing: 'This certificate was not issued for use by a web server.',
    };
  }

  if (
    !leaf.keyUsage.includes('digitalSignature') &&
    !leaf.keyUsage.includes('keyEncipherment')
  ) {
    return {
      ...base,
      passed: false,
      detail: `${leaf.subject.commonName} permits neither digitalSignature nor keyEncipherment, so its key cannot be used for any TLS key exchange.`,
      alert: ALERT_UNSUPPORTED_CERTIFICATE,
      browserError: 'NET::ERR_CERT_INVALID',
      reference: RFC_5280_KEY_USAGE,
    };
  }

  const intermediates = intermediatesOf(chain);
  for (const [index, ca] of intermediates.entries()) {
    if (!ca.basicConstraints.ca) {
      return {
        ...base,
        passed: false,
        detail: `${ca.subject.commonName} is used as an intermediate but is not marked cA:true, so it may not sign the certificate below it.`,
        alert: ALERT_UNSUPPORTED_CERTIFICATE,
        browserError: 'NET::ERR_CERT_INVALID',
      };
    }
    if (!ca.keyUsage.includes('keyCertSign')) {
      return {
        ...base,
        passed: false,
        detail: `${ca.subject.commonName} is marked cA:true but its keyUsage omits keyCertSign, so it is not authorised to issue certificates.`,
        alert: ALERT_UNSUPPORTED_CERTIFICATE,
        browserError: 'NET::ERR_CERT_INVALID',
        reference: RFC_5280_KEY_USAGE,
      };
    }
    // Certificates below this CA in the presented chain, excluding the CA itself.
    const below = index;
    const limit = ca.basicConstraints.pathLenConstraint;
    if (limit !== undefined && below > limit) {
      return {
        ...base,
        passed: false,
        detail: `${ca.subject.commonName} sets pathLenConstraint:${limit}, which allows ${limit} intermediate${limit === 1 ? '' : 's'} beneath it; this chain has ${below}.`,
        alert: ALERT_UNSUPPORTED_CERTIFICATE,
        browserError: 'NET::ERR_CERT_INVALID',
      };
    }
  }

  return {
    ...base,
    passed: true,
    detail: `${leaf.subject.commonName} is a non-CA serverAuth certificate, and ${intermediates.length === 0 ? 'there are no intermediates to check' : `all ${intermediates.length} intermediate${intermediates.length === 1 ? ' is a CA' : 's are CAs'} permitted to sign`}.`,
  };
}

// ---------------------------------------------------------------------------
// Running all five
// ---------------------------------------------------------------------------

/**
 * Run every check and keep every verdict.
 *
 * Deliberately does not short-circuit; see the note at the top of this file. The order of
 * {@link ChainValidation.steps} is always {@link VALIDATION_STEP_IDS}, so the UI can
 * render five fixed rows and a scenario can assert "exactly one of these is red".
 */
export function validateChain(
  chain: CertificateChain,
  options: ValidationOptions,
): ChainValidation {
  const steps: readonly ValidationStep[] = [
    checkChainOfTrust(chain, options),
    checkValidityPeriod(chain, options),
    checkHostname(chain, options),
    checkRevocation(chain, options),
    checkUsage(chain),
  ];

  const { path, anchor } = buildPath(chain, options.store);
  const failures = steps.filter((step) => !step.passed);

  return {
    host: options.host,
    at: options.now,
    steps,
    trusted: failures.length === 0,
    path: anchor ? path : [],
    anchor,
    failures,
  };
}

/** Look up one step's verdict by id. */
export function stepById(
  validation: ChainValidation,
  id: ValidationStepId,
): ValidationStep | undefined {
  return validation.steps.find((step) => step.id === id);
}

/**
 * The single warning a browser would show, or `undefined` when the chain is good.
 *
 * A browser shows one interstitial even when several checks fail, and it shows the
 * *first* failure in validation order. The rest of the verdicts stay available in
 * {@link ChainValidation.failures} for the detail panel.
 */
export function primaryFailure(validation: ChainValidation): ValidationStep | undefined {
  return validation.failures[0];
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Days in milliseconds, used by the scenario fixtures to place validity windows. */
export const DAY_MS = 86_400_000;

/** An ISO date, no time -- what a certificate viewer shows in the validity row. */
export function formatInstant(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/** A rough human duration for the expiry copy: `12 days`, `3 months`. */
export function describeGap(ms: number): string {
  const days = Math.round(Math.abs(ms) / DAY_MS);
  if (days === 0) return 'less than a day';
  if (days === 1) return '1 day';
  if (days < 60) return `${days} days`;
  const months = Math.round(days / 30);
  if (months < 24) return `${months} months`;
  return `${Math.round(days / 365)} years`;
}
