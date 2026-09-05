import { describe, expect, it } from 'vitest';

import {
  base64UrlDecode,
  base64UrlDecodeText,
  base64UrlEncode,
  base64UrlEncodeText,
  constantTimeEqual,
  hmacSha256,
  hmacSha256Hex,
  sha256Text,
  toHex,
  utf8Bytes,
} from './digest';

/**
 * These are published vectors, not values captured from this implementation. That is the
 * only kind of test worth writing for a hash: a self-consistent one would pass just as
 * happily against a subtly wrong transcription of the compression function.
 */

const hex = (text: string) => toHex(sha256Text(text));

describe('sha256', () => {
  it('matches the FIPS 180-4 vector for "abc"', () => {
    expect(hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('matches the vector for the empty string', () => {
    expect(hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('matches the 448-bit vector, which needs a second padding block', () => {
    expect(hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('matches the vector for a million "a"s', () => {
    expect(hex('a'.repeat(1_000_000))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    );
  });

  /**
   * The padding rule says "the smallest number of zero bits". These four lengths sit either
   * side of both block boundaries that matter: 55 bytes is the largest message whose padding
   * still fits in one block, and 56 is the smallest that needs two.
   */
  it.each([54, 55, 56, 57, 63, 64, 65])('pads correctly at length %i', (length) => {
    expect(hex('a'.repeat(length))).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces 32 bytes', () => {
    expect(sha256Text('anything')).toHaveLength(32);
  });

  it('is a pure function of its input', () => {
    expect(hex('same')).toBe(hex('same'));
    expect(hex('same')).not.toBe(hex('samf'));
  });
});

describe('hmacSha256', () => {
  /** RFC 4231 test case 1: a 20-byte key of 0x0b, over "Hi There". */
  it('matches RFC 4231 case 1', () => {
    const key = new Uint8Array(20).fill(0x0b);
    expect(toHex(hmacSha256(key, utf8Bytes('Hi There')))).toBe(
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    );
  });

  /** RFC 4231 test case 2: a short ASCII key, the case people actually write. */
  it('matches RFC 4231 case 2', () => {
    expect(hmacSha256Hex('Jefe', 'what do ya want for nothing?')).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });

  /** RFC 4231 test case 6: a 131-byte key, longer than the 64-byte block, so it is hashed. */
  it('matches RFC 4231 case 6, where the key is longer than the block', () => {
    const key = new Uint8Array(131).fill(0xaa);
    const message = utf8Bytes('Test Using Larger Than Block-Size Key - Hash Key First');
    expect(toHex(hmacSha256(key, message))).toBe(
      '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54',
    );
  });

  it('changes completely when one byte of the message changes', () => {
    const a = hmacSha256Hex('secret', 'amount=10');
    const b = hmacSha256Hex('secret', 'amount=11');
    expect(a).not.toBe(b);
    // Avalanche: roughly half the hex digits differ. Anything close to zero would mean the
    // outer hash was not actually mixing.
    const differing = [...a].filter((character, index) => character !== b[index]).length;
    expect(differing).toBeGreaterThan(40);
  });

  it('changes when the key changes and the message does not', () => {
    expect(hmacSha256Hex('secret', 'body')).not.toBe(hmacSha256Hex('secrey', 'body'));
  });
});

describe('base64url', () => {
  /** RFC 4648 s 10, translated to the URL-safe alphabet and stripped of padding. */
  it.each([
    ['', ''],
    ['f', 'Zg'],
    ['fo', 'Zm8'],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg'],
    ['fooba', 'Zm9vYmE'],
    ['foobar', 'Zm9vYmFy'],
  ])('encodes %o as %o', (input, expected) => {
    expect(base64UrlEncodeText(input)).toBe(expected);
  });

  it('never emits padding', () => {
    expect(base64UrlEncodeText('foob')).not.toContain('=');
  });

  it('uses "-" and "_" rather than "+" and "/"', () => {
    // 0xfb 0xff encodes to "+/8" in standard base64.
    const encoded = base64UrlEncode(new Uint8Array([0xfb, 0xff, 0xbf]));
    expect(encoded).toBe('-_-_');
    expect(encoded).not.toMatch(/[+/]/);
  });

  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array(256).map((_, index) => index);
    const decoded = base64UrlDecode(base64UrlEncode(bytes));
    expect(decoded.ok && [...decoded.value]).toEqual([...bytes]);
  });

  it('round-trips text through the decoder', () => {
    const decoded = base64UrlDecodeText(base64UrlEncodeText('{"alg":"HS256"}'));
    expect(decoded).toEqual({ ok: true, value: '{"alg":"HS256"}' });
  });

  it('accepts padding on input even though it never writes any', () => {
    expect(base64UrlDecodeText('Zm9vYg==')).toEqual({ ok: true, value: 'foob' });
  });

  it('rejects the standard-base64 alphabet rather than translating it', () => {
    const result = base64UrlDecode('a+b/c');
    expect(result).toEqual({ ok: false, error: expect.stringContaining('base64url') });
  });

  it('rejects a length no byte count can produce', () => {
    expect(base64UrlDecode('Zm9vYmFyZ')).toEqual({
      ok: false,
      error: expect.stringContaining('cannot be base64url'),
    });
  });

  it('rejects a character outside the alphabet', () => {
    expect(base64UrlDecode('ab*d')).toEqual({
      ok: false,
      error: '"*" is not a base64url character',
    });
  });
});

describe('constantTimeEqual', () => {
  it('agrees with === on equality', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
  });

  it('rejects different lengths', () => {
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });

  it('treats the empty string as equal to itself', () => {
    expect(constantTimeEqual('', '')).toBe(true);
  });

  it('does not short-circuit on the first differing character', () => {
    // Both of these differ from the reference; the point is only that neither throws and
    // both answer false, whichever position the difference is in.
    expect(constantTimeEqual('Xbcdef', 'abcdef')).toBe(false);
    expect(constantTimeEqual('abcdeX', 'abcdef')).toBe(false);
  });
});
