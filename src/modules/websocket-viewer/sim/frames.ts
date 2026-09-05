/**
 * The frame -- two to fourteen bytes of header, and then your data.
 *
 * This is the file the module exists for. Everything else about WebSockets is arrangement;
 * the frame is the thing that makes the arrangement worth having. An HTTP request that
 * carries the word "hello" costs several hundred bytes of field lines. A WebSocket frame
 * carrying the word "hello" costs eleven, and six of those are the word.
 *
 * ```text
 *  0                   1                   2                   3
 *  0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
 * +-+-+-+-+-------+-+-------------+-------------------------------+
 * |F|R|R|R| opcode|M| Payload len |    Extended payload length    |
 * |I|S|S|S|  (4)  |A|     (7)     |             (16/64)           |
 * |N|V|V|V|       |S|             |   (if payload len==126/127)   |
 * | |1|2|3|       |K|             |                               |
 * +-+-+-+-+-------+-+-------------+ - - - - - - - - - - - - - - - +
 * |     Extended payload length continued, if payload len == 127  |
 * + - - - - - - - - - - - - - - - +-------------------------------+
 * |                               |Masking-key, if MASK set to 1  |
 * +-------------------------------+-------------------------------+
 * | Masking-key (continued)       |          Payload Data         |
 * +-------------------------------- - - - - - - - - - - - - - - - +
 * :                     Payload Data continued ...                :
 * + - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - +
 * |                     Payload Data continued ...                |
 * +---------------------------------------------------------------+
 * ```
 *
 * RFC 6455 s 5.2. Four things in it are worth arriving at rather than being told:
 *
 * 1. **The length field is variable-width, and the encoding must be minimal.** Seven bits
 *    cover 0-125, and the two escape values 126 and 127 say "the real length is in the next
 *    two, or the next eight, bytes". A 100-byte payload sent with the 16-bit encoding is a
 *    *protocol error*, not merely wasteful -- because an endpoint that accepted both forms
 *    would give an attacker two ways to write the same frame, and "two encodings of the same
 *    thing" is where parser-differential attacks are born.
 * 2. **Client-to-server frames are always masked. Server-to-client frames never are.** The
 *    asymmetry is the most surprising thing in the specification and it is not about
 *    confidentiality at all; see {@link explainMasking}.
 * 3. **A message is not a frame.** FIN and the continuation opcode let one message span any
 *    number of frames, which is what makes streaming a gigabyte over a socket possible
 *    without buffering a gigabyte before the first byte moves.
 * 4. **Control frames are small and cannot be fragmented**, so a ping can always be answered
 *    immediately -- even in the middle of a half-sent 4 GB message.
 *
 * ## The payload in this model is always unmasked
 *
 * {@link WebSocketFrame.payload} holds *application data*: what the sender meant and what
 * the receiver reads. Masking is applied by {@link encodeFrame} on the way to the wire and
 * undone by {@link decodeFrame} on the way back, exactly as a real implementation does it.
 *
 * That is deliberate, and it is the honest model. Masking is a transformation the transport
 * imposes for one narrow defensive reason; it is not part of the message, and no application
 * has ever cared what a frame's mask was. Storing the masked bytes in the frame would have
 * made every test read backwards and taught a reader that a masked frame contains different
 * data, which is precisely the misconception {@link explainMasking} exists to prevent.
 * {@link DecodedFrame.maskedPayload} keeps the wire bytes for the inspector to show.
 */

import { toBinary, toHex } from '@/core/net/bytes';
import { fail, ok, type ParseResult } from '@/core/net/result';
import { createRng } from '@/core/sim/rng';
import type { RfcRef } from '@/core/types/events';

import { strictUtf8Text, utf8Bytes, utf8Text } from './digest';

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

const RFC_6455: RfcRef = { rfc: 6455, title: 'The WebSocket Protocol' };

/** The base framing diagram. */
export const RFC_6455_FRAMING: RfcRef = { ...RFC_6455, section: '5.2' };
/** Client-to-server masking. */
export const RFC_6455_MASKING: RfcRef = { ...RFC_6455, section: '5.3' };
/** Fragmentation. */
export const RFC_6455_FRAGMENTATION: RfcRef = { ...RFC_6455, section: '5.4' };
/** Control frames. */
export const RFC_6455_CONTROL: RfcRef = { ...RFC_6455, section: '5.5' };
/** Data frames, and the UTF-8 requirement on text. */
export const RFC_6455_DATA: RfcRef = { ...RFC_6455, section: '5.6' };
/** Why masking is there at all. */
export const RFC_6455_MASKING_RATIONALE: RfcRef = { ...RFC_6455, section: '10.3' };

// ---------------------------------------------------------------------------
// Opcodes
// ---------------------------------------------------------------------------

/** The six opcodes RFC 6455 defines. The other ten are reserved. */
export type Opcode = 'continuation' | 'text' | 'binary' | 'close' | 'ping' | 'pong';

/** The four-bit value each opcode has on the wire. */
export const OPCODE_VALUES: Readonly<Record<Opcode, number>> = {
  continuation: 0x0,
  text: 0x1,
  binary: 0x2,
  close: 0x8,
  ping: 0x9,
  pong: 0xa,
};

const OPCODE_NAMES = new Map<number, Opcode>(
  (Object.entries(OPCODE_VALUES) as [Opcode, number][]).map(([name, value]) => [
    value,
    name,
  ]),
);

/** The opcode a wire value names, or `undefined` if the value is reserved. */
export function opcodeFromValue(value: number): Opcode | undefined {
  return OPCODE_NAMES.get(value);
}

/**
 * Whether a four-bit opcode value is a control opcode.
 *
 * The test is the **top bit**, not a list: `0x8`-`0xF` are control, `0x0`-`0x7` are data.
 * Putting the classification in one bit means an endpoint that meets a reserved opcode it
 * has never heard of still knows which rules apply to it -- whether it may be fragmented,
 * whether it may exceed 125 bytes, whether it may be sent mid-message. That is careful
 * design, and it is why {@link isReservedOpcode} can still say something useful about an
 * opcode nobody has defined yet.
 */
export function isControlOpcodeValue(value: number): boolean {
  return (value & 0x8) !== 0;
}

/**
 * Whether the opcode is a control opcode: close, ping, or pong.
 *
 * Written as a type predicate rather than a plain boolean so that a caller which has already
 * dealt with the control frames is left holding `'continuation' | 'text' | 'binary'` -- which
 * is what {@link reassemble} needs, and what stops a `close` frame being spliced into a
 * message body by a stray refactor.
 */
export function isControlOpcode(opcode: Opcode): opcode is 'close' | 'ping' | 'pong' {
  return isControlOpcodeValue(OPCODE_VALUES[opcode]);
}

/** Whether the opcode carries application data: text, binary, or continuation. */
export function isDataOpcode(opcode: Opcode): boolean {
  return !isControlOpcode(opcode);
}

/**
 * Whether a wire value is one of the ten opcodes nobody has defined.
 *
 * `0x3`-`0x7` are reserved for further non-control frames and `0xB`-`0xF` for further
 * control frames. Receiving one is a protocol error and the connection must be failed with
 * close code 1002 -- not ignored, and not skipped over. That strictness is deliberate: an
 * endpoint that silently skipped unknown frames could be desynchronised by an attacker who
 * knows it will, and an extension that means to add a frame type has to negotiate it in the
 * handshake where both ends can agree.
 */
export function isReservedOpcode(value: number): boolean {
  return !OPCODE_NAMES.has(value);
}

/** A one-line description of each opcode, for the inspector. */
export function describeOpcode(opcode: Opcode): string {
  switch (opcode) {
    case 'continuation':
      return 'More of the message the previous data frame began. Carries no type of its own -- the type was fixed by the first frame.';
    case 'text':
      return 'A message whose payload is UTF-8. Ill-formed UTF-8 must fail the connection with 1007; there is no lenient mode.';
    case 'binary':
      return 'A message whose payload is arbitrary bytes. No validation, no interpretation.';
    case 'close':
      return 'Begin the closing handshake. Payload is optional: a 2-byte code and then a UTF-8 reason.';
    case 'ping':
      return 'Are you there? The peer must answer with a pong carrying the identical payload, as soon as it can.';
    case 'pong':
      return 'The answer to a ping -- or, unsolicited, a one-way heartbeat that expects no reply.';
  }
}

// ---------------------------------------------------------------------------
// Payload length encodings
// ---------------------------------------------------------------------------

/** Which of the three forms the length field takes. */
export type LengthEncoding = '7-bit' | '7+16' | '7+64';

/** The largest payload the 7-bit field can state. 126 and 127 are escapes, not lengths. */
export const MAX_7_BIT_LENGTH = 125;
/** The largest payload the 16-bit extension can state. */
export const MAX_16_BIT_LENGTH = 0xffff;
/** RFC 6455 s 5.5: a control frame's payload may not exceed this. */
export const MAX_CONTROL_PAYLOAD = 125;

/**
 * The encoding a payload of this length must use.
 *
 * "Must", not "may". RFC 6455 s 5.2 requires the **minimal** number of bytes: a 200-byte
 * payload uses the 16-bit form and a 100-byte payload may not. An endpoint that accepted a
 * non-minimal encoding would be accepting two spellings of the same frame, and wherever two
 * spellings of one thing exist, two parsers eventually disagree about which they saw --
 * which is the shape of every request-smuggling bug ever written.
 */
export function lengthEncodingFor(length: number): LengthEncoding {
  if (length <= MAX_7_BIT_LENGTH) return '7-bit';
  if (length <= MAX_16_BIT_LENGTH) return '7+16';
  return '7+64';
}

/** How many bytes of *extended* length field an encoding adds after the first two. */
export function extendedLengthBytes(encoding: LengthEncoding): 0 | 2 | 8 {
  if (encoding === '7-bit') return 0;
  return encoding === '7+16' ? 2 : 8;
}

/** What goes in the 7-bit field itself: the length, or the escape value 126 or 127. */
export function lengthFieldValue(length: number): number {
  const encoding = lengthEncodingFor(length);
  if (encoding === '7-bit') return length;
  return encoding === '7+16' ? 126 : 127;
}

/** A description of one encoding, for the panel that lists all three. */
export interface LengthEncodingInfo {
  readonly encoding: LengthEncoding;
  readonly range: string;
  /** What the 7-bit field holds under this encoding. */
  readonly field: string;
  readonly headerBytes: string;
  readonly detail: string;
}

/**
 * All three encodings, described.
 *
 * Kept as data so the frame inspector can show the full table with the active row
 * highlighted -- which is the only way a reader ever internalises that the header is not a
 * fixed size.
 */
export const LENGTH_ENCODINGS: readonly LengthEncodingInfo[] = [
  {
    encoding: '7-bit',
    range: '0 to 125 bytes',
    field: 'the length itself',
    headerBytes: '2 (unmasked) or 6 (masked)',
    detail:
      'The common case, and the reason a chat message costs almost nothing to send. ' +
      'Seven bits could have held 127, but 126 and 127 were spent as escapes -- a good ' +
      'trade, since it bought a 64-bit length for two reserved values.',
  },
  {
    encoding: '7+16',
    range: '126 to 65,535 bytes',
    field: '126, as an escape',
    headerBytes: '4 (unmasked) or 8 (masked)',
    detail:
      'Two more bytes, big-endian, unsigned. Every multi-byte integer in the WebSocket ' +
      'header is big-endian, like every other integer on the Internet: RFC 1700 called it ' +
      'network byte order and the frame header does not get to be different.',
  },
  {
    encoding: '7+64',
    range: '65,536 bytes and above',
    field: '127, as an escape',
    headerBytes: '10 (unmasked) or 14 (masked)',
    detail:
      'Eight more bytes, big-endian, and the most significant bit MUST be 0 -- so the real ' +
      'ceiling is 2^63-1, not 2^64-1. Reserving the sign bit means a language whose integers ' +
      'are signed cannot be handed a length it will read as negative, which is a whole class ' +
      'of buffer bug refused at the specification level.',
  },
];

// ---------------------------------------------------------------------------
// The frame
// ---------------------------------------------------------------------------

/** The four bytes that mask a client-to-server payload. */
export type MaskingKey = readonly [number, number, number, number];

/**
 * One frame.
 *
 * `payload` is **application data**, never the masked bytes -- see the note at the top of
 * this file.
 */
export interface WebSocketFrame {
  /** Last frame of this message. False means a continuation frame follows. */
  readonly fin: boolean;
  /** Reserved bits. Must be 0 unless an extension negotiated in the handshake claims them. */
  readonly rsv1: boolean;
  readonly rsv2: boolean;
  readonly rsv3: boolean;
  readonly opcode: Opcode;
  /** Whether this frame is masked on the wire. Required client-to-server, forbidden back. */
  readonly masked: boolean;
  /** Present exactly when `masked` is true. */
  readonly maskingKey?: MaskingKey;
  readonly payload: Uint8Array;
}

/** Which way the frame is travelling -- the only thing that decides whether it is masked. */
export type Direction = 'client-to-server' | 'server-to-client';

/**
 * Build a frame, defaulting everything that has an obvious default.
 *
 * `fin` defaults true because an unfragmented message is the overwhelmingly common case, and
 * a scenario that means to fragment should have to say so.
 */
export function frame(init: {
  opcode: Opcode;
  payload?: Uint8Array;
  fin?: boolean;
  rsv1?: boolean;
  rsv2?: boolean;
  rsv3?: boolean;
  maskingKey?: MaskingKey;
}): WebSocketFrame {
  const masked = init.maskingKey !== undefined;
  return {
    fin: init.fin ?? true,
    rsv1: init.rsv1 ?? false,
    rsv2: init.rsv2 ?? false,
    rsv3: init.rsv3 ?? false,
    opcode: init.opcode,
    masked,
    ...(init.maskingKey === undefined ? {} : { maskingKey: init.maskingKey }),
    payload: init.payload ?? new Uint8Array(0),
  };
}

/** A text frame. The payload is the string as UTF-8; RFC 6455 s 5.6 permits nothing else. */
export function textFrame(
  text: string,
  options: { fin?: boolean; maskingKey?: MaskingKey } = {},
): WebSocketFrame {
  return frame({ opcode: 'text', payload: utf8Bytes(text), ...options });
}

/** A binary frame. */
export function binaryFrame(
  payload: Uint8Array,
  options: { fin?: boolean; maskingKey?: MaskingKey } = {},
): WebSocketFrame {
  return frame({ opcode: 'binary', payload, ...options });
}

/** A continuation frame -- more of a message some earlier data frame began. */
export function continuationFrame(
  payload: Uint8Array,
  options: { fin?: boolean; maskingKey?: MaskingKey } = {},
): WebSocketFrame {
  return frame({ opcode: 'continuation', payload, ...options });
}

/** A ping, optionally carrying application data the pong must echo back. */
export function pingFrame(
  payload: Uint8Array = new Uint8Array(0),
  options: { maskingKey?: MaskingKey } = {},
): WebSocketFrame {
  return frame({ opcode: 'ping', payload, ...options });
}

/** A pong. */
export function pongFrame(
  payload: Uint8Array = new Uint8Array(0),
  options: { maskingKey?: MaskingKey } = {},
): WebSocketFrame {
  return frame({ opcode: 'pong', payload, ...options });
}

/** The text a text frame carries, decoded leniently for display. */
export function frameText(value: WebSocketFrame): string {
  return utf8Text(value.payload);
}

// ---------------------------------------------------------------------------
// Masking
// ---------------------------------------------------------------------------

/**
 * XOR the payload with the four-byte key, repeating it.
 *
 * ```text
 * transformed[i] = original[i] XOR key[i MOD 4]
 * ```
 *
 * That is the whole algorithm. It is **involutive** -- applying it twice with the same key
 * returns the original bytes -- which is why one function serves both the sender and the
 * receiver, and why {@link encodeFrame} and {@link decodeFrame} both call this one.
 *
 * It is not encryption and provides no confidentiality whatsoever: the key travels in the
 * clear, in the same frame, four bytes before the data it masks. Anyone who can read the
 * payload can unmask it in four instructions. Confidentiality on a WebSocket comes from
 * `wss://` and from nowhere else.
 */
export function applyMask(data: Uint8Array, key: MaskingKey): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let index = 0; index < data.length; index += 1) {
    out[index] = data[index] ^ key[index % 4];
  }
  return out;
}

/**
 * A masking key drawn from the seeded generator.
 *
 * RFC 6455 s 5.3 requires a **fresh, unpredictable** key for every frame, from a strong
 * source of entropy, and this deliberately is not one -- it is `mulberry32` seeded from a
 * label, so a scenario replays identically and its frame hex can be asserted on and
 * screenshotted.
 *
 * The substitution is safe here because there is no wire and no proxy to confuse. It would
 * not be safe in a client. Unpredictability is the *entire* defence: an attacker who can
 * predict the key can choose plaintext that masks into whatever bytes they like, and the
 * attack in {@link explainMasking} comes straight back.
 */
export function maskingKeyFrom(seed: number | string): MaskingKey {
  const rng = createRng(`masking-key:${seed}`);
  return [rng.int(256), rng.int(256), rng.int(256), rng.int(256)];
}

/**
 * Why one direction is masked and the other is not.
 *
 * The threat is a **cache-poisoning attack against an intermediary**, and it predates
 * WebSockets: a transparent proxy sits on the path, does not understand the upgraded
 * connection, and keeps trying to parse what flows through it as HTTP. Script in a browser
 * cannot set headers, but before masking it could choose every byte of a WebSocket payload
 * -- so it could write bytes that *spell out* an HTTP request, and a confused proxy could be
 * induced to treat them as one, cache the reply, and serve that reply to everybody else
 * asking for that URL.
 *
 * Masking closes it by making the attacker unable to choose what appears on the wire. The
 * key is fresh per frame and unpredictable, so the on-wire bytes are effectively random, so
 * no chosen sequence can be planted.
 *
 * The direction follows from the threat, and this is the part people find surprising. The
 * attacker in this model is script inside the browser: it controls what the *client* sends.
 * A server has no such adversary reaching into it, so masking server-to-client would buy
 * nothing and cost a XOR pass over every byte a busy server ever writes -- on the side that
 * has the most bytes and the least spare CPU. A masked server frame is not a minor
 * inefficiency, either: RFC 6455 s 5.1 requires the client to **fail the connection**.
 */
export function explainMasking(direction: Direction): {
  readonly headline: string;
  readonly detail: string;
  readonly required: boolean;
  readonly reference: RfcRef;
} {
  if (direction === 'client-to-server') {
    return {
      headline: 'Client frames are always masked.',
      required: true,
      detail:
        'Not for privacy -- the key is in the frame, four bytes ahead of the data it masks. ' +
        'It is there so that page script cannot choose the bytes that appear on the wire. ' +
        'Without it, a script could write a payload that spells out an HTTP request, and a ' +
        'transparent proxy that never understood the upgrade could be induced to parse it as ' +
        'one and poison its cache for every other user. A fresh unpredictable key per frame ' +
        'makes the wire bytes effectively random, so nothing can be planted in them.',
      reference: RFC_6455_MASKING_RATIONALE,
    };
  }
  return {
    headline: 'Server frames are never masked.',
    required: false,
    detail:
      'The attack masking defends against needs an adversary who controls what is sent -- ' +
      'and that is page script, which only controls the client side. Nothing equivalent ' +
      'reaches into the server, so masking here would buy nothing and cost a XOR pass over ' +
      'every byte, on the side with the most bytes and the least spare CPU. It is not ' +
      'optional in either direction: a client that receives a masked frame must fail the ' +
      'connection, exactly as a server must fail on an unmasked one.',
    reference: RFC_6455_MASKING,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Extra context a validator needs but a frame does not carry. */
export interface FrameRules {
  /** Which way it is going. Omit to skip the masking-direction check. */
  readonly direction?: Direction;
  /** True when an extension that claims RSV bits was negotiated in the handshake. */
  readonly extensionNegotiated?: boolean;
}

/**
 * Check a frame against every rule RFC 6455 states about a single frame.
 *
 * The rules that are *not* checkable here -- fragmentation ordering, whether a continuation
 * has anything to continue -- belong to the sequence, and live in {@link reassemble} and in
 * `lifecycle.ts`. This function answers only "is this frame, on its own, legal".
 */
export function validateFrame(
  value: WebSocketFrame,
  rules: FrameRules = {},
): ParseResult<WebSocketFrame> {
  if ((value.rsv1 || value.rsv2 || value.rsv3) && rules.extensionNegotiated !== true) {
    return fail(
      'an RSV bit is set but no extension was negotiated; RFC 6455 s 5.2 makes that a ' +
        'protocol error (close 1002). permessage-deflate is what usually claims RSV1',
    );
  }

  if (isControlOpcode(value.opcode)) {
    if (value.payload.length > MAX_CONTROL_PAYLOAD) {
      return fail(
        `a control frame carries at most ${MAX_CONTROL_PAYLOAD} bytes; this one has ` +
          `${value.payload.length}. The cap is what lets a control frame always fit in one ` +
          'piece, so a ping can be answered mid-message',
      );
    }
    if (!value.fin) {
      return fail(
        'a control frame may not be fragmented (FIN must be 1): the whole point of a ' +
          'control frame is that it can be delivered and acted on immediately',
      );
    }
  }

  if (value.masked !== (value.maskingKey !== undefined)) {
    return fail(
      value.masked
        ? 'MASK is set but there is no masking key'
        : 'a masking key is present but MASK is not set',
    );
  }
  if (value.maskingKey !== undefined) {
    for (const byte of value.maskingKey) {
      if (!Number.isInteger(byte) || byte < 0 || byte > 0xff) {
        return fail(`masking key byte ${byte} is not a byte (0-255)`);
      }
    }
  }

  if (rules.direction === 'client-to-server' && !value.masked) {
    return fail(
      'a client-to-server frame must be masked (RFC 6455 s 5.1). A server that receives ' +
        'one unmasked must fail the connection with close code 1002',
    );
  }
  if (rules.direction === 'server-to-client' && value.masked) {
    return fail(
      'a server-to-client frame must not be masked (RFC 6455 s 5.1). A client that ' +
        'receives one masked must fail the connection',
    );
  }

  if (value.payload.length > Number.MAX_SAFE_INTEGER) {
    return fail('payload length exceeds what a JavaScript number can count exactly');
  }

  if (value.opcode === 'text' && value.fin) {
    const decoded = strictUtf8Text(value.payload);
    if (!decoded.ok) {
      return fail(
        `a text frame's payload ${decoded.error}; RFC 6455 s 8.1 requires the connection ` +
          'be failed with close code 1007. There is no lenient mode and no replacement ' +
          'character',
      );
    }
  }

  return ok(value);
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/**
 * The number of header bytes this frame needs: 2, 4, 6, 8, 10, or 14.
 *
 * Never an odd number, and never 12: the length extension is 0, 2, or 8 bytes and the mask
 * is 0 or 4, so the reachable set is exactly {2, 4, 6, 8, 10, 14}. Worth knowing, because
 * "the header is 2 to 14 bytes" is the number that makes the transport comparison in
 * `comparison.ts` come out the way it does.
 */
export function headerBytes(value: WebSocketFrame): number {
  return (
    2 +
    extendedLengthBytes(lengthEncodingFor(value.payload.length)) +
    (value.masked ? 4 : 0)
  );
}

/** Header plus payload: what this frame costs on the wire. */
export function frameBytes(value: WebSocketFrame): number {
  return headerBytes(value) + value.payload.length;
}

/**
 * Serialise a frame to the bytes that go on the wire, masking the payload if MASK is set.
 *
 * Validation happens first and failure is returned rather than thrown, because the caller
 * that matters is a UI letting a reader construct an illegal frame on purpose -- a masked
 * server frame, a fragmented ping, a 200-byte close -- and watch the receiving end refuse
 * it. An exception would make that lesson impossible to stage.
 */
export function encodeFrame(
  value: WebSocketFrame,
  rules: FrameRules = {},
): ParseResult<Uint8Array> {
  const valid = validateFrame(value, rules);
  if (!valid.ok) return valid;

  const length = value.payload.length;
  const encoding = lengthEncodingFor(length);
  const out = new Uint8Array(frameBytes(value));
  const view = new DataView(out.buffer);

  out[0] =
    (value.fin ? 0x80 : 0) |
    (value.rsv1 ? 0x40 : 0) |
    (value.rsv2 ? 0x20 : 0) |
    (value.rsv3 ? 0x10 : 0) |
    OPCODE_VALUES[value.opcode];
  out[1] = (value.masked ? 0x80 : 0) | lengthFieldValue(length);

  let offset = 2;
  if (encoding === '7+16') {
    view.setUint16(offset, length);
    offset += 2;
  } else if (encoding === '7+64') {
    // Two 32-bit halves rather than setBigUint64, so the high word can be written from a
    // Number without a BigInt conversion. The high word is 0 for anything under 4 GB, and
    // its top bit is 0 for anything under 2^63, which RFC 6455 s 5.2 requires.
    view.setUint32(offset, Math.floor(length / 0x1_0000_0000));
    view.setUint32(offset + 4, length >>> 0);
    offset += 8;
  }

  if (value.maskingKey !== undefined) {
    out.set(value.maskingKey, offset);
    offset += 4;
    out.set(applyMask(value.payload, value.maskingKey), offset);
  } else {
    out.set(value.payload, offset);
  }

  return ok(out);
}

/** Encode several frames into one buffer, as they would arrive on one TCP stream. */
export function encodeFrames(
  frames: readonly WebSocketFrame[],
  rules: FrameRules = {},
): ParseResult<Uint8Array> {
  const parts: Uint8Array[] = [];
  for (const value of frames) {
    const encoded = encodeFrame(value, rules);
    if (!encoded.ok) return encoded;
    parts.push(encoded.value);
  }
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return ok(out);
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

/** A frame read off the wire, plus what the wire actually held. */
export interface DecodedFrame {
  readonly frame: WebSocketFrame;
  /** How many bytes of header this frame used. */
  readonly headerBytes: number;
  /** Header plus payload -- how far to advance to reach the next frame. */
  readonly totalBytes: number;
  readonly lengthEncoding: LengthEncoding;
  /**
   * The payload exactly as it appeared on the wire.
   *
   * Identical to `frame.payload` for an unmasked frame, and the XOR-ed form for a masked
   * one. Kept so the inspector can show both columns side by side, which is the only way to
   * make it obvious that masking changes the bytes and not the message.
   */
  readonly maskedPayload: Uint8Array;
}

/**
 * How many bytes the frame at the head of `bytes` occupies, or a failure explaining why the
 * question cannot be answered yet.
 *
 * Separate from {@link decodeFrame} because a stream reader needs to ask "do I have a whole
 * frame yet" without committing to parsing one -- and because "I need 4 more bytes" is a
 * different situation from "these bytes are illegal", and a caller that conflated them would
 * close a healthy connection every time a TCP segment split a header.
 */
export function frameLength(bytes: Uint8Array, offset = 0): ParseResult<number> {
  const available = bytes.length - offset;
  if (available < 2) return fail(`need at least 2 header bytes, have ${available}`);

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const masked = (bytes[offset + 1] & 0x80) !== 0;
  const field = bytes[offset + 1] & 0x7f;

  let headerSize = 2 + (masked ? 4 : 0);
  let length: number;
  if (field <= MAX_7_BIT_LENGTH) {
    length = field;
  } else if (field === 126) {
    headerSize += 2;
    if (available < 4)
      return fail(`need 4 header bytes for a 16-bit length, have ${available}`);
    length = view.getUint16(offset + 2);
  } else {
    headerSize += 8;
    if (available < 10) {
      return fail(`need 10 header bytes for a 64-bit length, have ${available}`);
    }
    const high = view.getUint32(offset + 2);
    const low = view.getUint32(offset + 6);
    if ((high & 0x8000_0000) !== 0) {
      return fail(
        'the most significant bit of a 64-bit payload length must be 0 (RFC 6455 s 5.2)',
      );
    }
    length = high * 0x1_0000_0000 + low;
    if (!Number.isSafeInteger(length)) {
      return fail('payload length exceeds what a JavaScript number can count exactly');
    }
  }

  return ok(headerSize + length);
}

/**
 * Read one frame from the head of a byte buffer.
 *
 * The minimal-length rule is enforced on the way in, which is the check most implementations
 * forget: a 100-byte payload announced with the 16-bit escape decodes perfectly well and is
 * still a protocol error, and letting it through is how one endpoint ends up seeing a
 * different frame boundary from another.
 */
export function decodeFrame(bytes: Uint8Array, offset = 0): ParseResult<DecodedFrame> {
  const size = frameLength(bytes, offset);
  if (!size.ok) return size;
  if (bytes.length - offset < size.value) {
    return fail(
      `frame needs ${size.value} bytes, only ${bytes.length - offset} are available`,
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const first = bytes[offset];
  const second = bytes[offset + 1];

  const opcodeValue = first & 0x0f;
  const opcode = opcodeFromValue(opcodeValue);
  if (opcode === undefined) {
    return fail(
      `opcode 0x${opcodeValue.toString(16)} is reserved; RFC 6455 s 5.2 makes receiving ` +
        'one a protocol error (close 1002)',
    );
  }

  const masked = (second & 0x80) !== 0;
  const field = second & 0x7f;

  let cursor = offset + 2;
  let length: number;
  let encoding: LengthEncoding;
  if (field <= MAX_7_BIT_LENGTH) {
    length = field;
    encoding = '7-bit';
  } else if (field === 126) {
    length = view.getUint16(cursor);
    cursor += 2;
    encoding = '7+16';
  } else {
    length = view.getUint32(cursor) * 0x1_0000_0000 + view.getUint32(cursor + 4);
    cursor += 8;
    encoding = '7+64';
  }

  if (lengthEncodingFor(length) !== encoding) {
    return fail(
      `payload length ${length} was sent with the ${encoding} encoding, but RFC 6455 s 5.2 ` +
        `requires the minimal one (${lengthEncodingFor(length)}). Two spellings of one ` +
        'frame is how two parsers come to disagree about where the next frame starts',
    );
  }

  let maskingKey: MaskingKey | undefined;
  if (masked) {
    maskingKey = [bytes[cursor], bytes[cursor + 1], bytes[cursor + 2], bytes[cursor + 3]];
    cursor += 4;
  }

  const maskedPayload = bytes.slice(cursor, cursor + length);
  const payload =
    maskingKey === undefined ? maskedPayload : applyMask(maskedPayload, maskingKey);

  return ok({
    frame: {
      fin: (first & 0x80) !== 0,
      rsv1: (first & 0x40) !== 0,
      rsv2: (first & 0x20) !== 0,
      rsv3: (first & 0x10) !== 0,
      opcode,
      masked,
      ...(maskingKey === undefined ? {} : { maskingKey }),
      payload,
    },
    headerBytes: 2 + extendedLengthBytes(encoding) + (masked ? 4 : 0),
    totalBytes: size.value,
    lengthEncoding: encoding,
    maskedPayload,
  });
}

/**
 * Read as many whole frames as the buffer holds.
 *
 * `remainder` is what is left when a frame is only partly arrived -- the normal condition on
 * a real socket, where TCP has no idea where a frame ends and will happily deliver half a
 * header. A reader keeps the remainder and prepends it to the next read.
 */
export function decodeFrames(bytes: Uint8Array): {
  frames: readonly DecodedFrame[];
  remainder: Uint8Array;
  error?: string;
} {
  const frames: DecodedFrame[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const size = frameLength(bytes, offset);
    if (!size.ok || bytes.length - offset < size.value) break;
    const decoded = decodeFrame(bytes, offset);
    if (!decoded.ok) {
      return { frames, remainder: bytes.slice(offset), error: decoded.error };
    }
    frames.push(decoded.value);
    offset += decoded.value.totalBytes;
  }
  return { frames, remainder: bytes.slice(offset) };
}

// ---------------------------------------------------------------------------
// The bit-level layout
// ---------------------------------------------------------------------------

/** One field of the header, positioned to the bit. */
export interface FrameField {
  readonly id: string;
  readonly name: string;
  /** Bits from the start of the frame. */
  readonly bitOffset: number;
  /** Width in bits. For the payload this is `payload.length * 8`. */
  readonly bits: number;
  /** The value in the notation this field is best read in. */
  readonly value: string;
  /** The bits themselves, for fields narrow enough to show that way. */
  readonly binary?: string;
  readonly explain: string;
  readonly reference: RfcRef;
}

/** The whole frame, positioned. */
export interface FrameLayout {
  readonly fields: readonly FrameField[];
  readonly headerBits: number;
  readonly headerBytes: number;
  readonly payloadBytes: number;
  readonly totalBytes: number;
  readonly lengthEncoding: LengthEncoding;
  /** Header bytes as a fraction of the whole frame -- the number the comparison lives on. */
  readonly overheadRatio: number;
}

/**
 * The frame as a list of positioned fields.
 *
 * This is what `FrameInspector` renders, and building it here rather than in the component
 * is the boundary this project is arranged around: the bit offsets are facts about RFC 6455,
 * not design decisions, so they are testable without a DOM.
 *
 * The conditional fields are simply *absent* when they do not apply, rather than present and
 * greyed. That is the honest rendering: an unmasked frame does not have an empty masking-key
 * field, it has no masking-key field at all, and every byte after the length field shifts
 * four places to the left. Showing a placeholder would misdraw the one thing the inspector
 * exists to get right.
 */
export function frameLayout(value: WebSocketFrame): FrameLayout {
  const length = value.payload.length;
  const encoding = lengthEncodingFor(length);
  const fields: FrameField[] = [
    {
      id: 'fin',
      name: 'FIN',
      bitOffset: 0,
      bits: 1,
      value: value.fin ? '1 (final frame)' : '0 (more to come)',
      binary: value.fin ? '1' : '0',
      explain:
        'The last frame of this message. A 0 here means the next data frame from this ' +
        'endpoint will be a continuation carrying more of the same message.',
      reference: RFC_6455_FRAGMENTATION,
    },
    ...[value.rsv1, value.rsv2, value.rsv3].map((bit, index) => ({
      id: `rsv${index + 1}`,
      name: `RSV${index + 1}`,
      bitOffset: 1 + index,
      bits: 1,
      value: bit ? '1' : '0',
      binary: bit ? '1' : '0',
      explain:
        index === 0
          ? 'Reserved. Must be 0 unless an extension negotiated in the handshake claims it ' +
            '-- permessage-deflate (RFC 7692) uses RSV1 to mark a compressed message. A set ' +
            'bit nobody agreed to is a protocol error.'
          : 'Reserved. Must be 0 unless an extension negotiated in the handshake claims it.',
      reference: RFC_6455_FRAMING,
    })),
    {
      id: 'opcode',
      name: 'opcode',
      bitOffset: 4,
      bits: 4,
      value: `${toHex(OPCODE_VALUES[value.opcode], { bits: 4 })} (${value.opcode})`,
      binary: toBinary(OPCODE_VALUES[value.opcode], { bits: 4, group: 0 }),
      explain: describeOpcode(value.opcode),
      reference: isControlOpcode(value.opcode) ? RFC_6455_CONTROL : RFC_6455_DATA,
    },
    {
      id: 'mask',
      name: 'MASK',
      bitOffset: 8,
      bits: 1,
      value: value.masked ? '1 (payload is masked)' : '0 (payload is not masked)',
      binary: value.masked ? '1' : '0',
      explain: value.masked
        ? 'Set on every client-to-server frame, without exception. A server that receives a ' +
          'frame without it must fail the connection.'
        : 'Clear on every server-to-client frame, without exception. A client that receives ' +
          'a masked frame must fail the connection.',
      reference: RFC_6455_MASKING,
    },
    {
      id: 'length-field',
      name: 'Payload len',
      bitOffset: 9,
      bits: 7,
      value:
        encoding === '7-bit'
          ? `${length}`
          : `${lengthFieldValue(length)} (escape: the real length follows)`,
      binary: toBinary(lengthFieldValue(length), { bits: 7, group: 0 }),
      explain:
        encoding === '7-bit'
          ? 'The length fits in seven bits, so this is the length. 126 and 127 are escapes, ' +
            'which is why the ceiling here is 125 and not 127.'
          : `126 and 127 are escape values, not lengths. ${lengthFieldValue(length)} means ` +
            `the real length is in the next ${extendedLengthBytes(encoding)} bytes.`,
      reference: RFC_6455_FRAMING,
    },
  ];

  let bitOffset = 16;
  if (encoding !== '7-bit') {
    const bits = extendedLengthBytes(encoding) * 8;
    fields.push({
      id: 'extended-length',
      name: `Extended payload length (${bits})`,
      bitOffset,
      bits,
      value: `${length} bytes`,
      ...(bits === 16 ? { binary: toBinary(length, { bits: 16 }) } : {}),
      explain:
        bits === 16
          ? 'Sixteen bits, unsigned, big-endian. Used for 126 through 65,535 bytes -- and ' +
            'only for those: RFC 6455 s 5.2 requires the minimal encoding, so a 100-byte ' +
            'payload sent this way is a protocol error.'
          : 'Sixty-four bits, unsigned, big-endian, with the most significant bit required ' +
            'to be 0 -- so the true ceiling is 2^63-1. Reserving the sign bit means no ' +
            'implementation with signed integers can be handed a length it reads as ' +
            'negative.',
      reference: RFC_6455_FRAMING,
    });
    bitOffset += bits;
  }

  if (value.maskingKey !== undefined) {
    fields.push({
      id: 'masking-key',
      name: 'Masking-key',
      bitOffset,
      bits: 32,
      value: value.maskingKey
        .map((byte) => toHex(byte, { prefix: false }))
        .join(' ')
        .toUpperCase(),
      explain:
        'Four bytes, fresh and unpredictable for every frame. payload[i] XOR key[i mod 4], ' +
        'which is its own inverse -- the receiver runs the identical operation to get the ' +
        'data back. It is not encryption: the key is right here, in the clear, immediately ' +
        'before the bytes it masks.',
      reference: RFC_6455_MASKING,
    });
    bitOffset += 32;
  }

  const headerBits = bitOffset;
  fields.push({
    id: 'payload',
    name: 'Payload Data',
    bitOffset: headerBits,
    bits: length * 8,
    value: `${length} bytes`,
    explain:
      value.opcode === 'text'
        ? 'UTF-8, and strictly so: an ill-formed sequence must fail the connection with ' +
          'close code 1007.'
        : 'Application data. Extension data, if an extension negotiated any, would sit ' +
          'ahead of it inside this same field.',
    reference: RFC_6455_DATA,
  });

  const totalBytes = headerBits / 8 + length;
  return {
    fields,
    headerBits,
    headerBytes: headerBits / 8,
    payloadBytes: length,
    totalBytes,
    lengthEncoding: encoding,
    overheadRatio: totalBytes === 0 ? 1 : headerBits / 8 / totalBytes,
  };
}

// ---------------------------------------------------------------------------
// Fragmentation
// ---------------------------------------------------------------------------

/**
 * Split a message into frames of at most `chunkBytes` payload each.
 *
 * The rules are in RFC 6455 s 5.4 and there are only three: the first frame carries the real
 * opcode with FIN 0, every frame after it carries the *continuation* opcode, and the last
 * one sets FIN. The type is stated once and never repeated, which is why a continuation
 * frame is meaningless on its own.
 *
 * Fragmentation exists so a sender can begin transmitting before it knows how long the
 * message will be -- a stream from a file, a live encoder -- without buffering the whole
 * thing to fill in a length field. It also lets a large message be sent without monopolising
 * the connection, because control frames may be slipped between fragments.
 *
 * `maskingKeys` is per-frame by design: every frame gets its own key, because a key reused
 * across frames would let an attacker who can guess one guess the rest.
 */
export function fragmentMessage(
  opcode: 'text' | 'binary',
  payload: Uint8Array,
  chunkBytes: number,
  maskingKeys?: readonly MaskingKey[],
): ParseResult<readonly WebSocketFrame[]> {
  if (!Number.isInteger(chunkBytes) || chunkBytes < 1) {
    return fail(`fragment size must be a positive integer, got ${chunkBytes}`);
  }

  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < payload.length; offset += chunkBytes) {
    chunks.push(payload.slice(offset, offset + chunkBytes));
  }
  // A zero-length message is still a message: one frame, FIN set, empty payload.
  if (chunks.length === 0) chunks.push(new Uint8Array(0));

  if (maskingKeys !== undefined && maskingKeys.length < chunks.length) {
    return fail(
      `fragmenting into ${chunks.length} frames needs ${chunks.length} masking keys, ` +
        `got ${maskingKeys.length}: RFC 6455 s 5.3 requires a fresh key per frame`,
    );
  }

  return ok(
    chunks.map((chunk, index) =>
      frame({
        opcode: index === 0 ? opcode : 'continuation',
        payload: chunk,
        fin: index === chunks.length - 1,
        ...(maskingKeys === undefined ? {} : { maskingKey: maskingKeys[index] }),
      }),
    ),
  );
}

/** A message put back together from its fragments. */
export interface ReassembledMessage {
  readonly opcode: 'text' | 'binary';
  readonly payload: Uint8Array;
  /** How many data frames it took. Control frames in between are not counted. */
  readonly frameCount: number;
  /** Total bytes on the wire, including every frame header. */
  readonly wireBytes: number;
  /** The text, when the message was text and the bytes are valid UTF-8. */
  readonly text?: string;
}

/**
 * Put a fragmented message back together, refusing any sequence RFC 6455 forbids.
 *
 * Control frames interleaved between fragments are skipped rather than rejected -- that is
 * explicitly legal, and it is the whole reason control frames may not themselves be
 * fragmented. A ping arriving between fragment two and fragment three of a 40 MB upload must
 * be answerable immediately, and it is.
 *
 * The three errors are the interesting part: a continuation with nothing to continue, a new
 * data frame while a message is still open, and a sequence that ends without FIN. Each is a
 * protocol error worth close code 1002, and each is a bug a real implementation ships at
 * least once.
 */
export function reassemble(
  frames: readonly WebSocketFrame[],
): ParseResult<ReassembledMessage> {
  let opcode: 'text' | 'binary' | undefined;
  const parts: Uint8Array[] = [];
  let frameCount = 0;
  let wireBytes = 0;
  let complete = false;

  for (const value of frames) {
    if (isControlOpcode(value.opcode)) {
      // Legal anywhere, including between fragments. Not part of the message.
      wireBytes += frameBytes(value);
      continue;
    }
    if (complete) {
      return fail('frames continue after a FIN frame closed the message');
    }

    if (value.opcode === 'continuation') {
      if (opcode === undefined) {
        return fail(
          'a continuation frame arrived with no message in progress; RFC 6455 s 5.4 makes ' +
            'that a protocol error (close 1002)',
        );
      }
    } else {
      if (opcode !== undefined) {
        return fail(
          `a new ${value.opcode} frame arrived while a ${opcode} message was still open. ` +
            'A message must be finished, or continued, before another begins',
        );
      }
      opcode = value.opcode;
    }

    parts.push(value.payload);
    frameCount += 1;
    wireBytes += frameBytes(value);
    if (value.fin) complete = true;
  }

  if (opcode === undefined) return fail('no data frames to reassemble');
  if (!complete) {
    return fail('the sequence ends without a FIN frame: the message is still incomplete');
  }

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const payload = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    payload.set(part, offset);
    offset += part.length;
  }

  if (opcode === 'text') {
    // Validated only now, on the whole message -- and that is the subtle part. A multi-byte
    // character can be split across a fragment boundary, so a fragment is not required to be
    // valid UTF-8 on its own and checking it there would reject legal traffic.
    const decoded = strictUtf8Text(payload);
    if (!decoded.ok) {
      return fail(
        `the reassembled text message ${decoded.error}; close the connection with 1007`,
      );
    }
    return ok({ opcode, payload, frameCount, wireBytes, text: decoded.value });
  }

  return ok({ opcode, payload, frameCount, wireBytes });
}
