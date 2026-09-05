/**
 * Scenario 3 -- the payload length field, all three ways.
 *
 * A WebSocket carries bytes, not text. The opcode says which, and that single bit of type
 * information is worth more than it looks: it is what lets a receiver hand a frame to an
 * image decoder without first proving the bytes are valid UTF-8, and what lets a text frame
 * be validated strictly -- an ill-formed sequence in a text frame is a protocol error worth
 * close code 1007, which is a stricter rule than HTTP has ever managed to apply to a body.
 *
 * This is also the scenario where the three payload-length encodings all appear, because
 * three sizes of message is the only honest way to show them.
 *
 * - **9 bytes** -- the 7-bit form. The length is the length, and the header is two bytes
 *   (six masked).
 * - **300 bytes** -- 126 escapes into a 16-bit extension. Four bytes of header, or eight.
 * - **90,000 bytes** -- 127 escapes into a 64-bit extension. Ten bytes of header, or
 *   fourteen, and the most significant bit of those eight must be 0, so the real ceiling is
 *   2^63-1 rather than 2^64-1. Reserving the sign bit means no implementation with signed
 *   integers can ever be handed a length it reads as negative.
 *
 * The encoding is not a choice. RFC 6455 s 5.2 requires the *minimal* one, so a 100-byte
 * payload sent with the 16-bit escape is a protocol error rather than merely wasteful --
 * because two legal spellings of one frame is how two parsers come to disagree about where
 * the next frame starts, and that disagreement is the shape of every request-smuggling bug
 * ever written.
 *
 * The last step is the comparison that makes binary frames worth having: the same 300 bytes,
 * sent as text. base64 is four characters for every three bytes, and the JSON wrapper adds
 * its own, so the text frame is a third larger before anybody has decoded anything.
 */

import { base64Overhead, PAGE_ORIGIN, sampleBytes, WS_HOST } from './common';

import type { WebSocketScenario } from '../sim/exchange';

/** A 300-byte sample, big enough to need the 16-bit length escape. */
const TELEMETRY = sampleBytes(300, 0x5eed);

/** 90 kB of it: past 65,535, so the 64-bit escape is the only legal encoding. */
const TILE = sampleBytes(90_000, 0xc0ffee);

/** The same 300 bytes as a client would be forced to send them over a text-only channel. */
const AS_JSON = `{"telemetry":"${'A'.repeat(base64Overhead(TELEMETRY.length))}"}`;

/** Binary frames at all three payload-length encodings, then the same data as text. */
export const BINARY_FRAMES: WebSocketScenario = {
  id: 'binary-frames',
  title: 'Binary frames and the three length encodings',
  summary:
    'Nine bytes, three hundred, and ninety thousand -- one message at each of the three payload-length encodings, with the escape values 126 and 127 doing the work. Then the same 300 bytes sent as base64 text, to price what a text-only channel costs.',
  teaches: [
    'The 7-bit length field holds 0-125; 126 and 127 are escapes, not lengths, which is why the ceiling is 125',
    '126 means the real length is in the next 2 bytes, big-endian; 127 means the next 8',
    'The encoding MUST be minimal -- two legal spellings of one frame is how parsers come to disagree',
    'The 64-bit length has its top bit reserved as 0, so the ceiling is 2^63-1 and no signed integer reads it as negative',
    'The opcode carries the type, so binary is handed straight to a decoder and text is validated as UTF-8 or the connection fails with 1007',
    'base64 over a text channel costs 33% before JSON quoting -- which is what binary frames exist to avoid',
  ],
  conditions: { rttMs: 60, bandwidthKbps: 40_000 },
  plan: {
    kind: 'session',
    handshake: {
      resource: '/telemetry',
      host: WS_HOST,
      keySeed: 'binary',
      origin: PAGE_ORIGIN,
      policy: { allowedOrigins: [PAGE_ORIGIN] },
    },
    steps: [
      {
        kind: 'message',
        id: 'tiny-binary',
        title: 'Nine bytes: the 7-bit length',
        from: 'client',
        intent:
          'The common case, and the reason a sensor reading costs almost nothing to send. Nine fits in seven bits, so the length field holds the length and the header is six bytes: two of flags and length, four of masking key.',
        bytes: sampleBytes(9, 7),
        afterMs: 100,
        notes: [
          'Seven bits could have held 127. Two of those values were spent as escapes, which bought a 64-bit length -- a good trade.',
        ],
      },
      {
        kind: 'message',
        id: 'medium-binary',
        title: 'Three hundred bytes: 126 escapes to 16 bits',
        from: 'server',
        intent:
          'Three hundred does not fit in seven bits, so the field holds 126 and the real length follows in the next two bytes, unsigned and big-endian -- network byte order, like every other multi-byte integer on the Internet. The header is four bytes, because a server frame has no masking key.',
        bytes: TELEMETRY,
        afterMs: 220,
      },
      {
        kind: 'message',
        id: 'large-binary',
        title: 'Ninety thousand bytes: 127 escapes to 64 bits',
        from: 'server',
        intent:
          'Past 65,535, so the 16-bit form cannot state it and 127 escapes into eight more bytes. Ten bytes of header for ninety thousand of payload: the overhead ratio here is about one part in nine thousand, which is what the frame format was optimised for.',
        bytes: TILE,
        afterMs: 260,
      },
      {
        kind: 'message',
        id: 'as-text',
        title: 'The same 300 bytes, as text',
        from: 'client',
        intent:
          'What the binary frame is worth. base64 turns every three bytes into four characters, and wrapping it in a JSON object adds the field name and the quotes -- so 300 bytes of data becomes a 416-byte payload, and every one of those bytes is masked, transmitted, parsed, and decoded again at the other end.',
        text: AS_JSON,
        afterMs: 300,
        notes: [
          'This is not a strawman: it is what an application does when its channel only carries text, which was the situation before WebSockets and is still the situation on Server-Sent Events.',
        ],
      },
    ],
  },
  notes: [
    {
      phase: 'tiny-binary',
      text: 'Open the frame inspector on this one. The MASK bit is 1, the length field reads 9, and there is no extended length field at all -- not an empty one, not a zeroed one. It is absent, and every byte after the length shifts left accordingly. That is what "variable-width header" means, and it is why a frame parser cannot know how many bytes to read until it has read the second one.',
      reference: { rfc: 6455, section: '5.2', title: 'The WebSocket Protocol' },
    },
    {
      phase: 'medium-binary',
      target: 'server',
      text: 'The length field reads 126, which is not a length. It is an escape saying the real length is in the next sixteen bits. And the encoding is not the sender’s choice: RFC 6455 s 5.2 requires the minimal form, so a 100-byte payload sent this way is a protocol error and must fail the connection with 1002. Accepting both spellings would give an attacker two ways to write one frame, and wherever two spellings of one thing exist, two parsers eventually disagree about which they saw.',
      reference: { rfc: 6455, section: '5.2', title: 'The WebSocket Protocol' },
    },
    {
      phase: 'large-binary',
      target: 'server',
      text: 'Eight bytes of length, and the most significant bit of them MUST be 0 -- so the real ceiling is 2^63-1, not 2^64-1. That reservation costs one bit and buys a guarantee: no implementation whose integers are signed can ever be handed a length it will read as negative, which is a whole class of buffer bug refused at the specification level rather than in every parser separately.',
      reference: { rfc: 6455, section: '5.2', title: 'The WebSocket Protocol' },
    },
    {
      phase: 'as-text',
      text: 'Compare this frame with the 300-byte binary one above it. Same data: a 416-byte payload in a 424-byte frame, against 300 in 304 -- 39% more on the wire, plus an encode on one side and a decode on the other. The opcode is a four-bit field and this is what it is worth: a receiver that knows the frame is binary hands it straight to a decoder, and a receiver that knows the frame is text validates it as UTF-8 strictly and fails the connection with 1007 if it is not -- on the whole message, never per fragment, because a multi-byte character may straddle a fragment boundary.',
      reference: { rfc: 6455, section: '5.6', title: 'The WebSocket Protocol' },
    },
  ],
};
