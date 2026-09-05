import { describe, expect, it } from 'vitest';

import {
  base64Decode,
  base64Encode,
  base64EncodeText,
  explainSha1Choice,
  sha1,
  sha1Text,
  strictUtf8Text,
  toHex,
  utf8Bytes,
  utf8Text,
} from './digest';

/**
 * These are published vectors, not values captured from this implementation. That is the
 * only kind of test worth writing for a hash: a self-consistent one would pass just as
 * happily against a subtly wrong transcription of the compression function, and the whole
 * claim `upgrade.ts` makes is that its accept values match everyone else's.
 */

const hex = (text: string) => toHex(sha1Text(text));

describe('sha1', () => {
  it('matches the FIPS 180-4 vector for "abc"', () => {
    expect(hex('abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
  });

  it('matches the vector for the empty string', () => {
    expect(hex('')).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
  });

  it('matches the 448-bit vector, which needs a second padding block', () => {
    expect(hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '84983e441c3bd26ebaae4aa1f95129e5e54670f1',
    );
  });

  it('matches the vector for a million "a"s', () => {
    expect(hex('a'.repeat(1_000_000))).toBe('34aa973cd4c4daa4f61eeb2bdbad27316534016f');
  });

  /**
   * The padding rule says "the smallest number of zero bits". These lengths sit either side
   * of both block boundaries that matter: 55 bytes is the largest message whose padding
   * still fits in one block, and 56 is the smallest that needs two.
   */
  it.each([54, 55, 56, 57, 63, 64, 65])('pads correctly at length %i', (length) => {
    expect(hex('a'.repeat(length))).toMatch(/^[0-9a-f]{40}$/);
  });

  it('produces 20 bytes', () => {
    expect(sha1Text('anything')).toHaveLength(20);
  });

  it('is a pure function of its input', () => {
    expect(hex('same')).toBe(hex('same'));
    expect(hex('same')).not.toBe(hex('samf'));
  });

  it('hashes bytes, not characters', () => {
    // "é" is two bytes in UTF-8 and one character. A hash over char codes would differ.
    expect(sha1(utf8Bytes('é'))).toEqual(sha1(new Uint8Array([0xc3, 0xa9])));
  });
});

describe('base64', () => {
  /** RFC 4648 s 10, in full. Each one exercises a different amount of padding. */
  it.each([
    ['', ''],
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='],
    ['fooba', 'Zm9vYmE='],
    ['foobar', 'Zm9vYmFy'],
  ])('encodes %o as %o (RFC 4648 s 10)', (input, expected) => {
    expect(base64EncodeText(input)).toBe(expected);
  });

  it('uses the standard alphabet, not the URL-safe one', () => {
    // 0xfb 0xff encodes to "+/" in standard base64 and "-_" in base64url. RFC 6455 wants
    // the former: these are HTTP field values, not URL components.
    expect(base64Encode(new Uint8Array([0xfb, 0xff, 0xbf]))).toBe('+/+/');
  });

  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array(Array.from({ length: 200 }, (_, index) => index % 256));
    const decoded = base64Decode(base64Encode(bytes));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.value).toEqual(bytes);
  });

  it('decodes with or without padding', () => {
    const withPadding = base64Decode('Zm8=');
    const without = base64Decode('Zm8');
    expect(withPadding.ok && without.ok).toBe(true);
    if (withPadding.ok && without.ok) {
      expect(withPadding.value).toEqual(without.value);
    }
  });

  it('refuses base64url, because that would be a different value on the wire', () => {
    const result = base64Decode('a-b_');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('base64url');
  });

  it('refuses a length no byte count encodes to', () => {
    const result = base64Decode('Zm9vYg==A');
    expect(result.ok).toBe(false);
  });

  it('refuses a character outside the alphabet', () => {
    const result = base64Decode('Zm9v!Zg');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('"!"');
  });
});

describe('utf8', () => {
  it('decodes well-formed text strictly', () => {
    const result = strictUtf8Text(utf8Bytes('hej sverige'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('hej sverige');
  });

  it('refuses an ill-formed sequence -- the 1007 case', () => {
    // 0xC3 starts a two-byte sequence and 0x28 cannot continue it.
    const result = strictUtf8Text(new Uint8Array([0xc3, 0x28]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('UTF-8');
  });

  it('has a lenient counterpart for previews, which substitutes rather than refusing', () => {
    expect(utf8Text(new Uint8Array([0xc3, 0x28]))).toContain('�');
  });
});

describe('explainSha1Choice', () => {
  it('says the digest is not a security claim, and cites where that comes from', () => {
    const note = explainSha1Choice();
    expect(note.headline).toContain('not a security claim');
    expect(note.detail).toContain('wss://');
    expect(note.reference.rfc).toBe(6455);
  });
});
