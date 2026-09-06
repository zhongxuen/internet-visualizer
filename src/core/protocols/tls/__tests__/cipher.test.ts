import { describe, expect, it } from 'vitest';

import {
  ALL_SUITES,
  DEFAULT_TLS12_SUITE,
  DEFAULT_TLS13_SUITE,
  decomposeSuite,
  getCipherSuite,
  LEGACY_RECORD_VERSION,
  namedComponentCount,
  negotiateSuite,
  parseCipherSuiteName,
  recordExpansionBytes,
  suitesForVersion,
  TLS12_SUITES,
  TLS13_SUITES,
  type CipherSuite,
} from './cipher';

const suite = (name: string): CipherSuite => getCipherSuite(name) as CipherSuite;

describe('the TLS 1.3 catalogue', () => {
  it('holds exactly the five suites RFC 8446 s B.4 defines', () => {
    expect(TLS13_SUITES.map((entry) => entry.name)).toEqual([
      'TLS_AES_128_GCM_SHA256',
      'TLS_AES_256_GCM_SHA384',
      'TLS_CHACHA20_POLY1305_SHA256',
      'TLS_AES_128_CCM_SHA256',
      'TLS_AES_128_CCM_8_SHA256',
    ]);
  });

  it('assigns the registered code points', () => {
    expect(suite('TLS_AES_128_GCM_SHA256').codePoint).toBe('0x13,0x01');
    expect(suite('TLS_CHACHA20_POLY1305_SHA256').codePoint).toBe('0x13,0x03');
    expect(suite('TLS_AES_128_CCM_8_SHA256').codePoint).toBe('0x13,0x05');
  });

  it('names no key exchange or authentication -- they moved out of the suite', () => {
    for (const entry of TLS13_SUITES) {
      expect(entry.keyExchange).toBeUndefined();
      expect(entry.authentication).toBeUndefined();
    }
  });

  it('gives every suite forward secrecy, because TLS 1.3 removed static key exchange', () => {
    expect(TLS13_SUITES.every((entry) => entry.forwardSecrecy)).toBe(true);
  });

  it('uses a 12-byte nonce for every AEAD, per RFC 8446 s 5.3', () => {
    expect(TLS13_SUITES.every((entry) => entry.ivBytes === 12)).toBe(true);
  });

  it('matches hash output width to the named hash', () => {
    expect(suite('TLS_AES_128_GCM_SHA256').hashBytes).toBe(32);
    expect(suite('TLS_AES_256_GCM_SHA384').hashBytes).toBe(48);
  });

  it('truncates the tag only for the CCM_8 suite', () => {
    expect(suite('TLS_AES_128_CCM_8_SHA256').tagBytes).toBe(8);
    const others = TLS13_SUITES.filter(
      (entry) => entry.name !== 'TLS_AES_128_CCM_8_SHA256',
    );
    expect(others.every((entry) => entry.tagBytes === 16)).toBe(true);
  });
});

describe('the TLS 1.2 catalogue', () => {
  it('names all four components on every suite', () => {
    for (const entry of TLS12_SUITES) {
      expect(entry.keyExchange).toBeDefined();
      expect(entry.authentication).toBeDefined();
    }
  });

  it('marks static-RSA suites as having no forward secrecy', () => {
    expect(suite('TLS_RSA_WITH_AES_128_GCM_SHA256').forwardSecrecy).toBe(false);
    expect(suite('TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256').forwardSecrecy).toBe(true);
  });

  it('ties forward secrecy to the key exchange and nothing else', () => {
    // Same record protection, opposite verdicts -- the point of the whole field.
    const withFs = suite('TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256');
    const without = suite('TLS_RSA_WITH_AES_128_GCM_SHA256');
    expect(withFs.cipher).toBe(without.cipher);
    expect(withFs.mode).toBe(without.mode);
    expect(withFs.keyBits).toBe(without.keyBits);
    expect(withFs.forwardSecrecy).not.toBe(without.forwardSecrecy);
  });

  it('recommends nothing without forward secrecy', () => {
    expect(
      ALL_SUITES.filter((entry) => entry.recommended).every((e) => e.forwardSecrecy),
    ).toBe(true);
  });

  it('assigns the registered code points', () => {
    expect(suite('TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256').codePoint).toBe('0xC0,0x2F');
    expect(suite('TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256').codePoint).toBe('0xC0,0x2B');
    expect(suite('TLS_RSA_WITH_AES_128_CBC_SHA').codePoint).toBe('0x00,0x2F');
    expect(suite('TLS_RSA_WITH_3DES_EDE_CBC_SHA').codePoint).toBe('0x00,0x0A');
  });
});

describe('suitesForVersion / namedComponentCount', () => {
  it('splits the catalogue by naming scheme', () => {
    expect(suitesForVersion('TLS 1.3')).toBe(TLS13_SUITES);
    expect(suitesForVersion('TLS 1.2')).toBe(TLS12_SUITES);
  });

  it('counts two named components for 1.3 and four for 1.2', () => {
    expect(namedComponentCount('TLS 1.3')).toBe(2);
    expect(namedComponentCount('TLS 1.2')).toBe(4);
  });
});

describe('decomposeSuite', () => {
  it('always returns the same four roles, so the two columns line up', () => {
    const roles = ['Key exchange', 'Authentication', 'Record protection', 'Hash'];
    expect(decomposeSuite(suite(DEFAULT_TLS13_SUITE)).map((part) => part.role)).toEqual(
      roles,
    );
    expect(decomposeSuite(suite(DEFAULT_TLS12_SUITE)).map((part) => part.role)).toEqual(
      roles,
    );
  });

  it('marks the two components TLS 1.3 moved, and names where they went', () => {
    const parts = decomposeSuite(suite(DEFAULT_TLS13_SUITE));
    const moved = parts.filter((part) => part.movedOutOfSuiteName);
    expect(moved.map((part) => part.role)).toEqual(['Key exchange', 'Authentication']);
    expect(moved[0].negotiatedBy).toContain('key_share');
    expect(moved[1].negotiatedBy).toContain('signature_algorithms');
    expect(moved.every((part) => part.token === undefined)).toBe(true);
  });

  it('moves nothing for a TLS 1.2 suite, and keeps every token', () => {
    const parts = decomposeSuite(suite(DEFAULT_TLS12_SUITE));
    expect(parts.some((part) => part.movedOutOfSuiteName)).toBe(false);
    expect(parts.map((part) => part.token)).toEqual([
      'ECDHE',
      'RSA',
      'AES_128_GCM',
      'SHA256',
    ]);
  });

  it('names ChaCha20 the way the registered suite spells it', () => {
    const parts = decomposeSuite(suite('TLS_CHACHA20_POLY1305_SHA256'));
    expect(parts[2].token).toBe('CHACHA20_POLY1305');
  });

  it('explains why a static-RSA suite has no forward secrecy', () => {
    const parts = decomposeSuite(suite('TLS_RSA_WITH_AES_128_GCM_SHA256'));
    expect(parts[0].explain).toContain('no forward secrecy');
  });
});

describe('parseCipherSuiteName', () => {
  it('returns catalogue data for a suite it knows', () => {
    const parsed = parseCipherSuiteName('TLS_AES_128_GCM_SHA256');
    expect(parsed.malformed).toBe(false);
    expect(parsed.version).toBe('TLS 1.3');
    expect(parsed.keyBits).toBe(128);
    expect(parsed.hash).toBe('SHA-256');
  });

  it('uses _WITH_ to tell the two naming schemes apart', () => {
    expect(parseCipherSuiteName('TLS_AES_128_CCM_SHA256').version).toBe('TLS 1.3');
    expect(parseCipherSuiteName('TLS_DHE_RSA_WITH_AES_256_GCM_SHA384').version).toBe(
      'TLS 1.2',
    );
  });

  it('parses a TLS 1.2 suite outside the catalogue', () => {
    const parsed = parseCipherSuiteName('TLS_DHE_RSA_WITH_AES_256_GCM_SHA384');
    expect(parsed.malformed).toBe(false);
    expect(parsed.keyExchange).toBe('DHE');
    expect(parsed.authentication).toBe('RSA');
    expect(parsed.cipher).toBe('AES');
    expect(parsed.keyBits).toBe(256);
    expect(parsed.mode).toBe('GCM');
    expect(parsed.hash).toBe('SHA-384');
  });

  it('treats TLS_RSA_WITH_ as one token doing both jobs', () => {
    const parsed = parseCipherSuiteName('TLS_RSA_WITH_AES_256_CBC_SHA256');
    expect(parsed.keyExchange).toBe('RSA');
    expect(parsed.authentication).toBe('RSA');
  });

  it('reads a bare SHA suffix as SHA-1', () => {
    expect(parseCipherSuiteName('TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA').hash).toBe('SHA-1');
  });

  it('flags names that do not fit either grammar', () => {
    expect(parseCipherSuiteName('not-a-suite').malformed).toBe(true);
    expect(parseCipherSuiteName('TLS_AES_128_GCM').malformed).toBe(true);
    expect(parseCipherSuiteName('TLS_NONSENSE_WITH_AES_128_GCM_SHA256').malformed).toBe(
      true,
    );
  });
});

describe('negotiateSuite', () => {
  const clientOffers = [
    'TLS_CHACHA20_POLY1305_SHA256',
    'TLS_AES_128_GCM_SHA256',
    'TLS_AES_256_GCM_SHA384',
  ];

  it('follows the server preference order, not the client one', () => {
    const chosen = negotiateSuite(clientOffers, [
      'TLS_AES_256_GCM_SHA384',
      'TLS_AES_128_GCM_SHA256',
    ]);
    expect(chosen?.name).toBe('TLS_AES_256_GCM_SHA384');
  });

  it('skips a server preference the client did not offer', () => {
    const chosen = negotiateSuite(clientOffers, [
      'TLS_AES_128_CCM_SHA256',
      'TLS_AES_128_GCM_SHA256',
    ]);
    expect(chosen?.name).toBe('TLS_AES_128_GCM_SHA256');
  });

  it('returns undefined when there is no overlap', () => {
    expect(negotiateSuite(clientOffers, ['TLS_AES_128_CCM_8_SHA256'])).toBeUndefined();
  });
});

describe('recordExpansionBytes', () => {
  it('counts the AEAD tag plus the inner content type byte', () => {
    expect(recordExpansionBytes(suite('TLS_AES_128_GCM_SHA256'))).toBe(17);
    expect(recordExpansionBytes(suite('TLS_AES_128_CCM_8_SHA256'))).toBe(9);
  });
});

describe('LEGACY_RECORD_VERSION', () => {
  it('is 0x0303 -- a TLS 1.3 capture says "TLS 1.2" in every record header', () => {
    expect(LEGACY_RECORD_VERSION).toBe('0x0303');
  });
});

describe('the catalogue as a whole', () => {
  it('has unique names and code points', () => {
    expect(new Set(ALL_SUITES.map((entry) => entry.name)).size).toBe(ALL_SUITES.length);
    expect(new Set(ALL_SUITES.map((entry) => entry.codePoint)).size).toBe(
      ALL_SUITES.length,
    );
  });

  it('gives every suite a note explaining what it is for or why it is retired', () => {
    expect(ALL_SUITES.every((entry) => entry.note.length > 20)).toBe(true);
  });

  it('defaults to a recommended suite for each version', () => {
    expect(suite(DEFAULT_TLS13_SUITE).recommended).toBe(true);
    expect(suite(DEFAULT_TLS12_SUITE).recommended).toBe(true);
  });
});
