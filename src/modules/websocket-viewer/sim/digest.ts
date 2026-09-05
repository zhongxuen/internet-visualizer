/**
 * SHA-1 and base64 -- the two primitives the opening handshake is built from.
 *
 * This module needs exactly one piece of arithmetic, and it needs it to be real. The
 * server's `Sec-WebSocket-Accept` is
 * `base64(SHA-1(Sec-WebSocket-Key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))`, and RFC 6455
 * s 1.3 prints a worked example of that computation with the intermediate digest spelled out
 * byte by byte. A learner who types this module's key into any other WebSocket
 * implementation gets this module's accept value back. Faking the hash would have quietly
 * removed the only claim in `upgrade.ts` that can be checked from outside.
 *
 * ## Why SHA-1, of all things
 *
 * Because RFC 6455 says SHA-1, and it is not a mistake that wants correcting. The handshake
 * is not authenticating anybody: it is proving that the thing on the other end *parsed the
 * WebSocket handshake* rather than being an ordinary HTTP server, or a caching proxy, that
 * echoed a header it did not understand. Nothing about that requires collision resistance.
 * The threat SHA-1 is broken against -- a chosen-prefix collision -- buys an attacker
 * nothing here, because there is no signature to transplant and no document to substitute.
 *
 * That is a genuinely useful lesson, and the opposite of the reflex it corrects. "SHA-1 is
 * broken, therefore every use of SHA-1 is a vulnerability" is wrong; what matters is which
 * property the protocol leans on. This one leans on nothing more than "hard to produce
 * without having read the specification". {@link explainSha1Choice} carries that sentence to
 * the UI so it can be said where a reader will otherwise reach for the reflex.
 *
 * ## What this is not
 *
 * A teaching implementation: compact, synchronous, and unhardened. It is checked against
 * FIPS 180-4's published vectors and RFC 6455's worked example, and against nothing else.
 * `crypto.subtle` is what production code should call -- it is audited and hardware
 * accelerated, and it is asynchronous, which is precisely why it is not used here. Every
 * simulation in this repository is a pure synchronous function of its inputs, and an
 * `await` in the middle of a handshake would end that.
 *
 * Nothing here protects an asset. The keys are string literals in `scenarios/`, and there is
 * no socket to open.
 */

import { bytesToHex } from '@/core/net/bytes';
import { fail, ok, type ParseResult } from '@/core/net/result';
import type { RfcRef } from '@/core/types/events';

// ---------------------------------------------------------------------------
// Text and bytes
// ---------------------------------------------------------------------------

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

/**
 * Text as UTF-8 bytes.
 *
 * Everything hashed, masked, or length-counted in this module is bytes and never
 * characters. A frame carrying `"hello"` with an accented `e` is six bytes and five
 * characters, and a `Payload length` field that counted the characters would disagree with
 * every WebSocket implementation in existence about where the next frame starts.
 *
 * The result is copied into a freshly constructed `Uint8Array` rather than returned straight
 * from the encoder. Under jsdom the platform `TextEncoder` hands back an array built from a
 * *different realm's* `Uint8Array` constructor, which is structurally identical and fails
 * `toEqual` against a locally constructed one -- a difference with no visual difference,
 * which is a miserable afternoon to debug. Copying also detaches the bytes from the
 * encoder's own buffer, which is the safer contract for a value this module then masks in
 * place.
 */
export function utf8Bytes(text: string): Uint8Array {
  return new Uint8Array(ENCODER.encode(text));
}

/** Bytes back to text, for showing a decoded frame payload or a close reason. */
export function utf8Text(bytes: Uint8Array): string {
  return DECODER.decode(bytes);
}

/**
 * Bytes back to text, refusing anything that is not well-formed UTF-8.
 *
 * The lenient {@link utf8Text} substitutes U+FFFD for a malformed sequence, which is right
 * for a preview pane and wrong for the protocol: RFC 6455 s 8.1 requires an endpoint that
 * receives a text frame whose payload is not valid UTF-8 to *fail the connection* with close
 * code 1007. `lifecycle.ts` needs to be able to tell, so it comes here.
 */
export function strictUtf8Text(bytes: Uint8Array): ParseResult<string> {
  try {
    return ok(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return fail('is not well-formed UTF-8');
  }
}

/** A digest as a solid run of lower-case hex -- the form a signature is quoted in. */
export function toHex(bytes: Uint8Array): string {
  return bytesToHex(bytes, { separator: '' });
}

/** The same digest spaced into octets, which is how RFC 6455 s 1.3 prints it. */
export function toSpacedHex(bytes: Uint8Array): string {
  return bytesToHex(bytes, { separator: ' ' });
}

// ---------------------------------------------------------------------------
// base64 (RFC 4648 s 4)
// ---------------------------------------------------------------------------

/**
 * The standard base64 alphabet -- with `+` and `/`, and with padding.
 *
 * This is deliberately *not* base64url. `Sec-WebSocket-Key` and `Sec-WebSocket-Accept` are
 * ordinary HTTP field values, not URL components, so there is nothing to escape and RFC 6455
 * s 4.1 specifies plain base64. Reaching for the URL-safe variant here would produce a value
 * that differs from every other implementation's exactly when a digest happens to contain
 * the bit patterns that encode to `+` or `/` -- most of the time, but not always, which is
 * the most annoying kind of bug there is.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const PAD = '=';

/**
 * Encode bytes as base64, padded to a multiple of four characters.
 *
 * The padding is kept, unlike the JWT and PKCE encodings elsewhere in this repository. It
 * carries no information -- the decoder recovers the length from the character count -- but
 * it is what RFC 4648 s 4 specifies by default, and a `Sec-WebSocket-Accept` is compared by
 * the client as an exact string. A server that stripped the trailing `=` would produce a
 * value that hashes correctly and still fails every client on earth.
 */
export function base64Encode(bytes: Uint8Array): string {
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const b0 = bytes[index];
    const b1: number | undefined = bytes[index + 1];
    const b2: number | undefined = bytes[index + 2];

    out += ALPHABET[b0 >> 2];
    out += ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? PAD : ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? PAD : ALPHABET[b2 & 0x3f];
  }
  return out;
}

/** Encode text as base64 -- used by the tests and by the worked example. */
export function base64EncodeText(text: string): string {
  return base64Encode(utf8Bytes(text));
}

const VALUES = new Map<string, number>(
  [...ALPHABET].map((character, index) => [character, index]),
);

/**
 * Decode base64, insisting on correct padding.
 *
 * Strictness earns its keep here, because the one thing this module decodes is a
 * `Sec-WebSocket-Key`, and the check that matters is that it holds **exactly 16 bytes**
 * (RFC 6455 s 4.1). That check is only meaningful if the decoder refuses to guess: a value
 * of the wrong length, or with a `-` or `_` in it, is a client that got the encoding wrong,
 * and saying so is more useful than silently decoding it to fifteen bytes.
 *
 * A group of exactly one leftover character is impossible -- no number of bytes encodes to
 * it -- so it is reported as such rather than decoded to nothing.
 */
export function base64Decode(text: string): ParseResult<Uint8Array> {
  if (text.includes('-') || text.includes('_')) {
    return fail('contains "-" or "_": that is base64url, not the base64 RFC 6455 uses');
  }
  const trimmed = text.replace(/=+$/, '');
  const padding = text.length - trimmed.length;
  if (padding > 2) {
    return fail(`has ${padding} padding characters; base64 never needs more than two`);
  }
  if (padding > 0 && text.length % 4 !== 0) {
    return fail(
      `is padded but ${text.length} characters long, which is not a multiple of 4`,
    );
  }
  for (const character of trimmed) {
    if (!VALUES.has(character)) {
      return fail(`"${character}" is not a base64 character`);
    }
  }
  if (trimmed.length % 4 === 1) {
    return fail(`length ${trimmed.length} cannot be base64: no byte count encodes to it`);
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

// ---------------------------------------------------------------------------
// SHA-1 (FIPS 180-4 s 6.1)
// ---------------------------------------------------------------------------

/** Rotate left, 32-bit. The `>>>` is essential: `>>` would smear the sign bit back in. */
function rotl(value: number, count: number): number {
  return ((value << count) | (value >>> (32 - count))) >>> 0;
}

/**
 * SHA-1 of a byte string, as 20 bytes.
 *
 * The padding is worth reading, and it is identical to SHA-256's: a single `1` bit, then the
 * smallest number of zero bits that leaves exactly 64 bits free at the end of the final
 * 64-byte block, then the message length **in bits** as a big-endian 64-bit integer.
 * Appending the length is what stops two different messages sharing a padded form, and the
 * "smallest number of zeros" rule is load-bearing: a surplus block of zeros is still
 * syntactically padding but hashes to something else entirely.
 *
 * The compression function is much simpler than SHA-256's -- eighty rounds over five words,
 * with the round constant and the mixing function changing every twenty rounds -- and that
 * simplicity is, in the end, why it fell.
 */
export function sha1(message: Uint8Array): Uint8Array {
  const h = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]);

  const paddedLength = (((message.length + 8) >> 6) << 6) + 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(message);
  padded[message.length] = 0x80;

  const view = new DataView(padded.buffer);
  const bitLength = message.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const w = new Uint32Array(80);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    // The one line that separates SHA-1 from SHA-0 is this rotate. SHA-0 shipped without
    // it, and its absence is exactly what made SHA-0 collide first.
    for (let i = 16; i < 80; i += 1) {
      w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    }

    let [a, b, c, d, e] = h;
    for (let i = 0; i < 80; i += 1) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d); // choose
        k = 0x5a827999; // 2^30 * sqrt(2)
      } else if (i < 40) {
        f = b ^ c ^ d; // parity
        k = 0x6ed9eba1; // 2^30 * sqrt(3)
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d); // majority
        k = 0x8f1bbcdc; // 2^30 * sqrt(5)
      } else {
        f = b ^ c ^ d; // parity again
        k = 0xca62c1d6; // 2^30 * sqrt(10)
      }

      const temp = (rotl(a, 5) + (f >>> 0) + e + k + w[i]) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }

    const round = [a, b, c, d, e];
    for (let i = 0; i < 5; i += 1) h[i] = (h[i] + round[i]) >>> 0;
  }

  const digest = new Uint8Array(20);
  const digestView = new DataView(digest.buffer);
  for (let i = 0; i < 5; i += 1) digestView.setUint32(i * 4, h[i]);
  return digest;
}

/** SHA-1 of text, encoded as UTF-8 first. */
export function sha1Text(text: string): Uint8Array {
  return sha1(utf8Bytes(text));
}

// ---------------------------------------------------------------------------
// The sentence about SHA-1
// ---------------------------------------------------------------------------

/** RFC 6455's own security considerations, which is where the argument below comes from. */
const RFC_6455_SECURITY: RfcRef = {
  rfc: 6455,
  section: '10.8',
  title: 'The WebSocket Protocol',
};

/** A short explanation the UI can pin next to the digest. */
export interface Sha1Note {
  readonly headline: string;
  readonly detail: string;
  readonly reference: RfcRef;
}

/**
 * Why a protocol standardised in 2011 specifies a hash that was already in trouble.
 *
 * Carried as data rather than written into a component, so the claim lives beside the
 * implementation it describes and a test can assert the module still makes it.
 */
export function explainSha1Choice(): Sha1Note {
  return {
    headline: 'SHA-1 here is not a security claim.',
    detail:
      'The handshake authenticates nobody. Hashing the key with a fixed, published GUID ' +
      'proves only that the responder read the WebSocket specification -- that it is not ' +
      'an ordinary HTTP server, or an intermediary, echoing back a header it never ' +
      'understood. No signature rests on this digest and no document can be substituted ' +
      'for another, so a collision buys an attacker nothing. What protects a WebSocket in ' +
      'transit is TLS (wss://), not this.',
    reference: RFC_6455_SECURITY,
  };
}
