import { describe, expect, it } from 'vitest';

import {
  ROOT,
  ROOT_TRUST_ANCHOR,
  SIGNATURE_EXPIRATION,
  SIMULATED_INTERNET,
  VALIDATION_TIME,
  findZone,
  lookupInZone,
  question,
  rr,
  signZone,
  zoneKeys,
  type DnsZone,
  type ResourceRecord,
} from './records';
import {
  buildChain,
  describeValidation,
  dsMatchesKey,
  provesNoDs,
  validateAnswer,
  verifyRrset,
  verifySignature,
  zoneChain,
} from './dnssec';

const exampleOrg = findZone(SIMULATED_INTERNET, 'example.org') as DnsZone;

function recordsAt(zone: DnsZone, name: string, type: string): ResourceRecord[] {
  return zone.records.filter((record) => record.name === name && record.type === type);
}

function sigsFor(zone: DnsZone, name: string, type: string): ResourceRecord[] {
  return zone.records.filter(
    (record) =>
      record.name === name &&
      record.data.type === 'RRSIG' &&
      record.data.typeCovered === type,
  );
}

/** The answer as it arrives at a validating resolver: the RRset and its signatures. */
function signedAnswer(zone: DnsZone, name: string, type: 'A' | 'DNSKEY') {
  return {
    name,
    type,
    records: recordsAt(zone, name, type),
    sigs: sigsFor(zone, name, type),
  };
}

describe('verifySignature', () => {
  const rrset = recordsAt(exampleOrg, 'example.org', 'A');
  const sig = sigsFor(exampleOrg, 'example.org', 'A')[0];
  const zsk = recordsAt(exampleOrg, 'example.org', 'DNSKEY').find(
    (record) => record.data.type === 'DNSKEY' && record.data.flags === 256,
  ) as ResourceRecord;
  const ksk = recordsAt(exampleOrg, 'example.org', 'DNSKEY').find(
    (record) => record.data.type === 'DNSKEY' && record.data.flags === 257,
  ) as ResourceRecord;

  it('accepts the zone-signing key that made the signature', () => {
    expect(verifySignature(rrset, sig, zsk)).toEqual({
      ok: true,
      reason: expect.stringContaining('verified by key tag'),
    });
  });

  it('rejects the wrong key, even one from the same zone', () => {
    // The KSK signs the key set and nothing else. Its tag does not match this signature.
    expect(verifySignature(rrset, sig, ksk).ok).toBe(false);
  });

  it('rejects an RRset that has been altered under a valid signature', () => {
    const tampered = [rr('example.org', 3600, { type: 'A', address: '203.0.113.66' })];

    expect(verifySignature(tampered, sig, zsk)).toEqual({
      ok: false,
      reason: 'signature does not match the RRset',
    });
  });

  /**
   * The commonest real DNSSEC outage: nothing was changed and nothing was attacked, the
   * signatures simply ran out because the resigning job stopped running.
   */
  it('rejects a signature that has expired', () => {
    expect(verifySignature(rrset, sig, zsk, SIGNATURE_EXPIRATION + 1)).toEqual({
      ok: false,
      reason: 'signature has expired',
    });
  });

  it('rejects a signature that is not valid yet', () => {
    expect(verifySignature(rrset, sig, zsk, 0).reason).toBe('signature is not valid yet');
  });

  /** Without this check, any signed zone could sign for any name on the Internet. */
  it('refuses a signer that is outside the name it signed', () => {
    const keys = zoneKeys('attacker.example');
    const stolen = signZone(
      'attacker.example',
      [rr('example.org', 3600, { type: 'A', address: '203.0.113.66' })],
      keys,
    );
    const forged = stolen.find((record) => record.type === 'RRSIG') as ResourceRecord;
    const attackerKey = rr('attacker.example', 3600, keys.zsk);

    expect(verifySignature(stolen.slice(0, 1), forged, attackerKey).ok).toBe(false);
  });

  it('reports what it wanted when nothing was supplied', () => {
    expect(verifyRrset(rrset, [], [zsk])).toEqual({
      ok: false,
      reason: 'no RRSIG covering this RRset',
    });
    expect(verifyRrset(rrset, [sig], [])).toEqual({
      ok: false,
      reason: 'no DNSKEY to check against',
    });
  });

  /**
   * The reason RRSIG carries an original TTL: a cached record's TTL has been counted
   * down, and the signature has to keep verifying anyway (RFC 4034 s3.1.2).
   */
  it('still verifies an RRset whose TTL a cache has counted down', () => {
    const aged = rrset.map((record) => ({ ...record, ttl: 11 }));

    expect(verifySignature(aged, sig, zsk).ok).toBe(true);
  });
});

describe('the DS link', () => {
  it('matches a parent DS against the child key it fingerprints', () => {
    const org = findZone(SIMULATED_INTERNET, 'org') as DnsZone;
    const ds = recordsAt(org, 'example.org', 'DS')[0];
    const ksk = recordsAt(exampleOrg, 'example.org', 'DNSKEY').find(
      (record) => record.data.type === 'DNSKEY' && record.data.flags === 257,
    ) as ResourceRecord;
    const zsk = recordsAt(exampleOrg, 'example.org', 'DNSKEY').find(
      (record) => record.data.type === 'DNSKEY' && record.data.flags === 256,
    ) as ResourceRecord;

    expect(dsMatchesKey(ds, ksk)).toBe(true);
    // A DS points at the key-signing key, which is what lets the other one be rolled.
    expect(dsMatchesKey(ds, zsk)).toBe(false);
  });

  it('reads an NSEC as proof that a parent published no DS', () => {
    const com = findZone(SIMULATED_INTERNET, 'com') as DnsZone;
    const nsec = recordsAt(com, 'example.com', 'NSEC')[0];

    expect(provesNoDs(nsec)).toBe(true);
    expect(provesNoDs(undefined)).toBe(false);
  });

  it('is asked of the parent, which answers it rather than referring', () => {
    const org = findZone(SIMULATED_INTERNET, 'org') as DnsZone;
    const response = lookupInZone(org, question('example.org', 'DS'), { dnssec: true });

    expect(response.outcome).toBe('answer');
    expect(response.answer.some((record) => record.type === 'DS')).toBe(true);
  });
});

describe('walking the chain', () => {
  it('lists the zone cuts from the root down', () => {
    expect(
      zoneChain(SIMULATED_INTERNET, 'www.example.org').map((zone) => zone.origin),
    ).toEqual([ROOT, 'org', 'example.org']);
  });

  it('starts from the one record the resolver believes without checking', () => {
    const { links } = buildChain(SIMULATED_INTERNET, 'example.org');

    expect(links[0].zone).toBe(ROOT);
    expect(links[0].ds).toEqual([ROOT_TRUST_ANCHOR]);
    expect(links[0].state).toBe('secure');
  });

  it('is secure the whole way down a signed branch', () => {
    const { links, state } = buildChain(SIMULATED_INTERNET, 'example.org');

    expect(state).toBe('secure');
    expect(links.map((link) => `${link.zone || '.'}=${link.state}`)).toEqual([
      '.=secure',
      'org=secure',
      'example.org=secure',
    ]);
    expect(links.every((link) => link.checks.every((entry) => entry.ok))).toBe(true);
    expect(links[2].ksk?.flags).toBe(257);
    expect(links[2].zsk?.flags).toBe(256);
  });

  /** Insecure is the ordinary case, and it has to be *proven*, not assumed. */
  it('ends deliberately at an unsigned delegation, and says why', () => {
    const { links, state } = buildChain(SIMULATED_INTERNET, 'www.example.com');

    expect(state).toBe('insecure');
    expect(links.map((link) => `${link.zone || '.'}=${link.state}`)).toEqual([
      '.=secure',
      'com=secure',
      'example.com=insecure',
    ]);
    expect(links[2].reason).toContain('NSEC');
  });

  it('carries the insecure verdict down every zone below the cut', () => {
    const { links, state } = buildChain(SIMULATED_INTERNET, 'edge.cdn.example.net');

    expect(state).toBe('insecure');
    // The root publishes no DS for net, so nothing below it is signed either.
    expect(links.map((link) => link.state)).toEqual([
      'secure',
      'insecure',
      'insecure',
      'insecure',
    ]);
  });

  it('calls a DS that matches no key bogus rather than unsigned', () => {
    const { links, state } = buildChain(SIMULATED_INTERNET, 'broken.example.org');

    expect(state).toBe('bogus');
    expect(links.at(-1)?.zone).toBe('broken.example.org');
    expect(
      links.at(-1)?.checks.find((entry) => entry.label === 'DS matches a key')?.ok,
    ).toBe(false);
  });

  it('counts the extra lookups validation costs', () => {
    const { queries } = buildChain(SIMULATED_INTERNET, 'example.org');

    expect(queries.map((query) => `${query.zone || '.'} ${query.type}`)).toEqual([
      '. DNSKEY',
      'org DS',
      'org DNSKEY',
      'example.org DS',
      'example.org DNSKEY',
    ]);
  });
});

describe('validateAnswer', () => {
  it('verifies the answer itself, not only the chain above it', () => {
    const result = validateAnswer(
      SIMULATED_INTERNET,
      signedAnswer(exampleOrg, 'example.org', 'A'),
    );

    expect(result.state).toBe('secure');
    expect(result.answerVerified).toBe(true);
    expect(describeValidation(result)).toContain('SECURE');
  });

  /** A secure chain and a missing signature is a failure, not a fallback to plain DNS. */
  it('is bogus when a signed zone answers without a signature', () => {
    const result = validateAnswer(SIMULATED_INTERNET, {
      name: 'example.org',
      type: 'A',
      records: recordsAt(exampleOrg, 'example.org', 'A'),
      sigs: [],
    });

    expect(result.state).toBe('bogus');
    expect(result.answerVerified).toBe(false);
    expect(result.reason).toContain('no RRSIG');
  });

  /**
   * A day after the signatures ran out, nothing about the data has changed and every
   * zone in the chain is bogus -- starting at the root, since the whole fixture set was
   * signed in one window. This is what a resigning job that stopped running looks like.
   */
  it('is bogus once the signatures have expired, with the data unchanged', () => {
    const result = validateAnswer(
      SIMULATED_INTERNET,
      signedAnswer(exampleOrg, 'example.org', 'A'),
      { at: SIGNATURE_EXPIRATION + 86400 },
    );

    expect(result.state).toBe('bogus');
    expect(
      result.links[0].checks.some((entry) => entry.detail === 'signature has expired'),
    ).toBe(true);
  });

  it('is insecure, and says so plainly, for an unsigned zone', () => {
    const exampleCom = findZone(SIMULATED_INTERNET, 'example.com') as DnsZone;
    const result = validateAnswer(SIMULATED_INTERNET, {
      name: 'example.com',
      type: 'A',
      records: recordsAt(exampleCom, 'example.com', 'A'),
      sigs: [],
    });

    expect(result.state).toBe('insecure');
    expect(result.reason).toContain('not the same as wrong');
  });

  it('judges signatures against a supplied time rather than a wall clock', () => {
    const inside = validateAnswer(
      SIMULATED_INTERNET,
      signedAnswer(exampleOrg, 'example.org', 'A'),
      { at: VALIDATION_TIME },
    );

    expect(inside.state).toBe('secure');
  });
});
