/**
 * The fixtures every scenario is written against.
 *
 * Three kinds of thing live here because more than one scenario needs them and a second copy
 * would be a second thing to keep true: the host names, the RFC's own worked example, and the
 * deterministic byte buffers the binary scenario sends.
 *
 * ## Why the RFC's key is the default
 *
 * `dGhlIHNhbXBsZSBub25jZQ==` is the `Sec-WebSocket-Key` printed in RFC 6455 s 1.2, and
 * `s3pPLMBiTxaQ9kYGzzhZRbK+xOo=` is the `Sec-WebSocket-Accept` printed beside it. Using them
 * means a reader can hold the derivation panel next to the specification and see the same
 * twenty bytes of SHA-1 -- and it means `upgrade.test.ts` and the scenarios are checked
 * against the same published vector rather than against each other.
 *
 * A real client must not use a fixed key. The nonce is what stops a cached `101` from a
 * previous connection being replayed as an answer to this one; `generateKey` exists for the
 * scenarios that want a different one, and it draws from the seeded generator so a run still
 * replays byte for byte.
 *
 * ## Why every name is under `.example` and `.com` is never real
 *
 * RFC 2606 s 2 reserves `.example` so it can never be registered by anybody, and the
 * addresses in `sim/exchange.ts` come from the RFC 5737 documentation ranges. Both are belt
 * and braces on a module that has no socket to begin with: there is no `fetch`, no
 * `WebSocket`, and no host parameter anywhere in this folder that could be handed one.
 *
 * `chat.example.com` is the one apparent exception and is not one -- `example.com` is
 * reserved by the same RFC, for exactly this.
 */

/** The host every handshake in this module is aimed at. */
export const WS_HOST = 'chat.example.com';

/** The page holding the socket. Not the same origin as the socket, deliberately. */
export const PAGE_ORIGIN = 'https://app.example.com';

/**
 * The `Sec-WebSocket-Key` from RFC 6455 s 1.2.
 *
 * Sixteen bytes of base64, always 24 characters, always ending `==`. Fixed here so the
 * derivation panel shows the same digest the specification prints; see the note above on why
 * a real client must never do this.
 */
export const RFC_EXAMPLE_KEY = 'dGhlIHNhbXBsZSBub25jZQ==';

/** The `Sec-WebSocket-Accept` RFC 6455 s 1.2 prints for {@link RFC_EXAMPLE_KEY}. */
export const RFC_EXAMPLE_ACCEPT = 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=';

/**
 * The subprotocols the client offers, in the client's order of preference.
 *
 * The server's list in {@link SERVER_SUBPROTOCOLS} is the other way round on purpose: the
 * server chooses, applying *its* preference order to the client's set, and watching `chat.v1`
 * win when the client asked for `chat.v2` first is the fastest way to learn that.
 */
export const CLIENT_SUBPROTOCOLS = ['chat.v2', 'chat.v1'] as const;

/** What the server speaks, in the server's order of preference. */
export const SERVER_SUBPROTOCOLS = ['chat.v1', 'chat.v2'] as const;

/**
 * A deterministic byte buffer, standing in for something that is genuinely not text.
 *
 * A counter and a cheap mixing step rather than a random source, because every value in this
 * module has to be identical on every run: the frame hex is asserted on in tests and read off
 * the screen by a learner comparing it against the layout above it.
 */
export function sampleBytes(length: number, seed = 1): Uint8Array {
  const out = new Uint8Array(length);
  let state = seed >>> 0;
  for (let index = 0; index < length; index += 1) {
    // A small xorshift. Nothing here needs randomness; it needs bytes that do not look like
    // ASCII, so that the payload column of the inspector is visibly not text.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    out[index] = (state >>> 0) % 256;
  }
  return out;
}

/**
 * The same bytes as a client would be forced to send them over a text-only channel.
 *
 * base64 is four characters for every three bytes, so this is the 33% surcharge the binary
 * scenario measures -- before the JSON quoting and the field name are counted.
 */
export function base64Overhead(byteLength: number): number {
  return Math.ceil(byteLength / 3) * 4;
}
