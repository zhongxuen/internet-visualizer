/**
 * SHA-256, HMAC, and base64url -- the primitives the rest of this module rests on.
 *
 * This is the one file in the API Visualizer that computes anything cryptographic, and
 * unlike the HTTPS Explorer's `placeholder.ts` it is **real**: a straight transcription of
 * FIPS 180-4 and RFC 2104. That difference is deliberate, and worth stating because the two
 * modules teach opposite lessons about the same subject.
 *
 * In TLS, the value of a traffic key is not the lesson -- the *derivation graph* is, and a
 * fake key with the right shape teaches it perfectly while a real one would invite misuse.
 * Here the value **is** the lesson. Three of this module's claims are only checkable if the
 * arithmetic actually happens:
 *
 * - a PKCE `code_challenge` is `BASE64URL(SHA256(ASCII(code_verifier)))`, and the whole
 *   point of the flow is that you cannot go backwards from one to the other;
 * - a JWT signature is an HMAC over the two encoded segments, which is what makes tampering
 *   with the payload detectable *and* what makes the payload readable to anyone;
 * - a webhook signature verifies, or it does not, and the receiver must be able to tell.
 *
 * A learner who pastes this module's `code_challenge` into someone else's PKCE checker gets
 * a match, and one who decodes its JWT in a public debugger sees the same claims. Faking
 * that would have made all three lessons unfalsifiable.
 *
 * ## What this is not
 *
 * A teaching implementation: compact, synchronous, and unhardened. It has no defence against
 * side channels, it holds keys in ordinary garbage-collected memory, and it has been checked
 * against published test vectors and nothing else. Production code should use
 * `crypto.subtle`, which is audited, hardware-accelerated, and asynchronous -- the last of
 * which is exactly why it is not used here: every simulation in this repository is a pure
 * synchronous function of its inputs, and an `await` in the middle of a scenario would end
 * that. Nothing in this module protects a real asset; the "secrets" are string literals in
 * `scenarios/`, and there is no network to send them over.
 *
 * ## The vectors
 *
 * `digest.test.ts` checks {@link sha256} against FIPS 180-4's `"abc"` and empty-string
 * vectors, {@link hmacSha256} against RFC 4231's test cases, and {@link base64UrlEncode}
 * against RFC 4648 §10. `auth.test.ts` then checks the whole PKCE derivation against
 * RFC 7636 Appendix B, which is the vector that proves all of it at once.
 */

import { bytesToHex } from '@/core/net/bytes';
import { fail, ok, type ParseResult } from '@/core/net/result';

// ---------------------------------------------------------------------------
// Text and bytes
// ---------------------------------------------------------------------------

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

/**
 * Text as UTF-8 bytes.
 *
 * Every signature in this module is over bytes, never over characters, which is why this
 * exists rather than a call to `charCodeAt`. A JWT payload containing `"name":"José"`
 * is one length in characters and another in bytes, and an HMAC that hashed the characters
 * would disagree with every other implementation on earth about that one token.
 */
export function utf8Bytes(text: string): Uint8Array {
  return ENCODER.encode(text);
}

/** Bytes back to text, for showing a decoded JWT segment. */
export function utf8Text(bytes: Uint8Array): string {
  return DECODER.decode(bytes);
}

/** A digest as a solid run of lower-case hex -- the form a signature header carries. */
export function toHex(bytes: Uint8Array): string {
  return bytesToHex(bytes, { separator: '' });
}

// ---------------------------------------------------------------------------
// base64url (RFC 4648 s 5)
// ---------------------------------------------------------------------------

/**
 * The base64url alphabet.
 *
 * Identical to base64 except for the last two characters: `-` and `_` replace `+` and `/`.
 * That substitution is the entire reason the encoding exists -- `+` and `/` are reserved in
 * URLs and would have to be percent-encoded, which is intolerable for a value that lives in
 * a query string (an OAuth `code_challenge`) or in a path segment.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Encode bytes as base64url **without padding**.
 *
 * The trailing `=` is omitted, as RFC 7515 s 2 requires of every JWT segment and RFC 7636
 * s 4.2 of a PKCE challenge. The padding carries no information -- the decoder recovers the
 * length from the number of characters -- and a literal `=` in a URL is another character
 * that would need escaping. A JWT with padding on its segments is malformed, not merely
 * unusual, which is a mistake people make when they reach for a generic base64 helper.
 */
export function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const b0 = bytes[index];
    const b1: number | undefined = bytes[index + 1];
    const b2: number | undefined = bytes[index + 2];

    out += ALPHABET[b0 >> 2];
    out += ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 === undefined) break;
    out += ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 === undefined) break;
    out += ALPHABET[b2 & 0x3f];
  }
  return out;
}

/** Encode text as base64url, the way a JWT segment is built from its JSON. */
export function base64UrlEncodeText(text: string): string {
  return base64UrlEncode(utf8Bytes(text));
}

const VALUES = new Map<string, number>(
  [...ALPHABET].map((character, index) => [character, index]),
);

/**
 * Decode base64url, tolerating padding but rejecting anything else.
 *
 * Padding is accepted on input because tokens in the wild carry it, but a `+` or a `/` is
 * refused rather than silently translated: those characters mean the value is standard
 * base64 and probably came from somewhere that will disagree about the next thing too.
 *
 * A length of exactly one character past a group boundary is impossible -- no number of
 * bytes encodes to it -- so it is reported as such rather than decoded to nothing.
 */
export function base64UrlDecode(text: string): ParseResult<Uint8Array> {
  const trimmed = text.replace(/=+$/, '');
  if (trimmed.includes('+') || trimmed.includes('/')) {
    return fail('contains "+" or "/": that is standard base64, not base64url');
  }
  for (const character of trimmed) {
    if (!VALUES.has(character)) {
      return fail(`"${character}" is not a base64url character`);
    }
  }
  if (trimmed.length % 4 === 1) {
    return fail(
      `length ${trimmed.length} cannot be base64url: no byte count encodes to it`,
    );
  }

  const bytes = new Uint8Array(Math.floor((trimmed.length * 3) / 4));
  let written = 0;
  let accumulator = 0;
  let bits = 0;
  for (const character of trimmed) {
    accumulator = (accumulator << 6) | (VALUES.get(character) as number);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[written] = (accumulator >> bits) & 0xff;
      written += 1;
    }
  }
  return ok(bytes.subarray(0, written));
}

/** Decode a base64url segment to the text it holds -- a JWT header or payload. */
export function base64UrlDecodeText(text: string): ParseResult<string> {
  const bytes = base64UrlDecode(text);
  return bytes.ok ? ok(utf8Text(bytes.value)) : bytes;
}

// ---------------------------------------------------------------------------
// SHA-256 (FIPS 180-4)
// ---------------------------------------------------------------------------

/** The first 32 bits of the fractional parts of the cube roots of the first 64 primes. */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
  0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
  0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
  0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
  0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
  0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

/** Rotate right, 32-bit. `>>>` is essential: `>>` would smear the sign bit. */
function rotr(value: number, count: number): number {
  return ((value >>> count) | (value << (32 - count))) >>> 0;
}

/**
 * SHA-256 of a byte string, as 32 bytes.
 *
 * The padding is the part worth reading. A message is followed by a single `1` bit, then
 * enough zero bits to leave exactly 64 bits at the end of the final 64-byte block, then the
 * message's length **in bits** as a big-endian 64-bit integer. Appending the length is what
 * stops two different messages sharing a padded form, and the "smallest number of zeros"
 * rule is load-bearing: a surplus block of zeros is still syntactically padding but hashes
 * to something else entirely.
 */
export function sha256(message: Uint8Array): Uint8Array {
  // Fractional parts of the square roots of the first 8 primes.
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
    0x5be0cd19,
  ]);

  const paddedLength = (((message.length + 8) >> 6) << 6) + 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(message);
  padded[message.length] = 0x80;

  const view = new DataView(padded.buffer);
  const bitLength = message.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const x = w[i - 15];
      const y = w[i - 2];
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choose = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + choose + K[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + majority) >>> 0;

      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }

    const round = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i += 1) h[i] = (h[i] + round[i]) >>> 0;
  }

  const digest = new Uint8Array(32);
  const digestView = new DataView(digest.buffer);
  for (let i = 0; i < 8; i += 1) digestView.setUint32(i * 4, h[i]);
  return digest;
}

/** SHA-256 of text, encoded as UTF-8 first. */
export function sha256Text(text: string): Uint8Array {
  return sha256(utf8Bytes(text));
}

// ---------------------------------------------------------------------------
// HMAC-SHA256 (RFC 2104, FIPS 198-1)
// ---------------------------------------------------------------------------

/** SHA-256's block size. HMAC pads or hashes the key to exactly this. */
const BLOCK_BYTES = 64;

/**
 * HMAC-SHA256: `H((K ^ opad) || H((K ^ ipad) || message))`.
 *
 * The nested structure is not decoration. The obvious construction -- `H(secret || message)`
 * -- is broken for every Merkle-Damgard hash, SHA-256 included: an attacker who knows the
 * digest and the message length can append data and compute the digest of the longer message
 * **without the key**, because the digest *is* the internal state. That is a length-extension
 * forgery, and it is why HMAC hashes twice with two different key-derived pads instead.
 *
 * This is the operation underneath both an HS256 JWT signature and a webhook's signature
 * header, which is why both `auth.ts` and `webhook.ts` come here.
 */
export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  // A key longer than the block is hashed down; a shorter one is zero-padded up. Note that
  // this makes a long key and its SHA-256 digest interchangeable, which is a real quirk.
  const shortened = key.length > BLOCK_BYTES ? sha256(key) : key;
  const inner = new Uint8Array(BLOCK_BYTES + message.length);
  const outer = new Uint8Array(BLOCK_BYTES + 32);
  for (let i = 0; i < BLOCK_BYTES; i += 1) {
    const byte: number = shortened[i] ?? 0;
    inner[i] = byte ^ 0x36; // ipad
    outer[i] = byte ^ 0x5c; // opad
  }
  inner.set(message, BLOCK_BYTES);
  outer.set(sha256(inner), BLOCK_BYTES);
  return sha256(outer);
}

/** HMAC-SHA256 over text with a text key, returned as hex -- the header-ready form. */
export function hmacSha256Hex(secret: string, message: string): string {
  return toHex(hmacSha256(utf8Bytes(secret), utf8Bytes(message)));
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/**
 * Compare two strings without letting the time taken reveal where they first differ.
 *
 * `a === b` returns as soon as it finds a mismatched byte, so a caller who can time it learns
 * the length of the matching prefix -- and an attacker who can learn that can forge a
 * signature one character at a time, in a few hundred requests per character rather than the
 * 2^256 the hash was supposed to cost. Every character is examined here, and the result is
 * accumulated with OR.
 *
 * Length is compared first and returns early, which does leak the length. That is deliberate
 * and standard: the length of a fixed-width hex digest is public.
 *
 * JavaScript makes no guarantee this compiles to constant time -- a JIT may do as it likes.
 * The *technique* is what this file teaches; production code should call
 * `crypto.timingSafeEqual`. `webhook.ts` says so where it matters.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}
