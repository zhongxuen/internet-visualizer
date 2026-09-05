import { describe, expect, it } from 'vitest';

import { utf8Bytes } from './digest';
import {
  applyMask,
  binaryFrame,
  continuationFrame,
  decodeFrame,
  decodeFrames,
  describeOpcode,
  encodeFrame,
  encodeFrames,
  explainMasking,
  extendedLengthBytes,
  frame,
  frameBytes,
  frameLayout,
  frameLength,
  fragmentMessage,
  frameText,
  headerBytes,
  isControlOpcode,
  isDataOpcode,
  isReservedOpcode,
  LENGTH_ENCODINGS,
  lengthEncodingFor,
  lengthFieldValue,
  MAX_CONTROL_PAYLOAD,
  maskingKeyFrom,
  OPCODE_VALUES,
  opcodeFromValue,
  pingFrame,
  pongFrame,
  reassemble,
  textFrame,
  validateFrame,
  type MaskingKey,
  type WebSocketFrame,
} from './frames';

const bytes = (...values: number[]) => new Uint8Array(values);

/** The masking key RFC 6455 s 5.7 uses in both of its masked examples. */
const RFC_KEY: MaskingKey = [0x37, 0xfa, 0x21, 0x3d];

function encoded(value: WebSocketFrame): Uint8Array {
  const result = encodeFrame(value);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

// ---------------------------------------------------------------------------
// The published examples
// ---------------------------------------------------------------------------

/**
 * RFC 6455 s 5.7 prints six complete frames as hex. They are the only vectors that matter:
 * an encoder checked only against its own decoder can be wrong in both directions at once.
 */
describe('RFC 6455 s 5.7 examples', () => {
  it('encodes a single-frame unmasked text message "Hello"', () => {
    expect(encoded(textFrame('Hello'))).toEqual(
      bytes(0x81, 0x05, 0x48, 0x65, 0x6c, 0x6c, 0x6f),
    );
  });

  it('encodes a single-frame masked text message "Hello"', () => {
    expect(encoded(textFrame('Hello', { maskingKey: RFC_KEY }))).toEqual(
      bytes(0x81, 0x85, 0x37, 0xfa, 0x21, 0x3d, 0x7f, 0x9f, 0x4d, 0x51, 0x58),
    );
  });

  it('encodes a fragmented unmasked text message: "Hel" then "lo"', () => {
    expect(encoded(textFrame('Hel', { fin: false }))).toEqual(
      bytes(0x01, 0x03, 0x48, 0x65, 0x6c),
    );
    expect(encoded(continuationFrame(utf8Bytes('lo')))).toEqual(
      bytes(0x80, 0x02, 0x6c, 0x6f),
    );
  });

  it('encodes an unmasked ping carrying "Hello"', () => {
    expect(encoded(pingFrame(utf8Bytes('Hello')))).toEqual(
      bytes(0x89, 0x05, 0x48, 0x65, 0x6c, 0x6c, 0x6f),
    );
  });

  it('encodes a masked pong carrying "Hello"', () => {
    expect(encoded(pongFrame(utf8Bytes('Hello'), { maskingKey: RFC_KEY }))).toEqual(
      bytes(0x8a, 0x85, 0x37, 0xfa, 0x21, 0x3d, 0x7f, 0x9f, 0x4d, 0x51, 0x58),
    );
  });

  it('encodes 256 bytes of binary with the 16-bit length: 0x82 0x7E 0x0100', () => {
    const wire = encoded(binaryFrame(new Uint8Array(256)));
    expect(wire.slice(0, 4)).toEqual(bytes(0x82, 0x7e, 0x01, 0x00));
    expect(wire).toHaveLength(4 + 256);
  });

  it('encodes 64 KiB of binary with the 64-bit length: 0x82 0x7F 0x0000000000010000', () => {
    const wire = encoded(binaryFrame(new Uint8Array(65_536)));
    expect(wire.slice(0, 10)).toEqual(
      bytes(0x82, 0x7f, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00),
    );
    expect(wire).toHaveLength(10 + 65_536);
  });
});

// ---------------------------------------------------------------------------
// Opcodes
// ---------------------------------------------------------------------------

describe('opcodes', () => {
  it('maps each name to the value RFC 6455 s 5.2 assigns it', () => {
    expect(OPCODE_VALUES).toEqual({
      continuation: 0x0,
      text: 0x1,
      binary: 0x2,
      close: 0x8,
      ping: 0x9,
      pong: 0xa,
    });
  });

  it('classifies control frames by the top bit, not by a list', () => {
    expect(isControlOpcode('close')).toBe(true);
    expect(isControlOpcode('ping')).toBe(true);
    expect(isControlOpcode('pong')).toBe(true);
    expect(isDataOpcode('continuation')).toBe(true);
    expect(isDataOpcode('text')).toBe(true);
    expect(isDataOpcode('binary')).toBe(true);
  });

  it('knows the ten reserved values', () => {
    const reserved = [0x3, 0x4, 0x5, 0x6, 0x7, 0xb, 0xc, 0xd, 0xe, 0xf];
    for (const value of reserved) {
      expect(isReservedOpcode(value)).toBe(true);
      expect(opcodeFromValue(value)).toBeUndefined();
    }
    expect(isReservedOpcode(0x1)).toBe(false);
  });

  it('describes every opcode', () => {
    for (const name of Object.keys(OPCODE_VALUES)) {
      expect(describeOpcode(name as keyof typeof OPCODE_VALUES).length).toBeGreaterThan(
        30,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Payload length encodings
// ---------------------------------------------------------------------------

describe('payload length encodings', () => {
  it.each([
    [0, '7-bit'],
    [1, '7-bit'],
    [125, '7-bit'],
    [126, '7+16'],
    [1_000, '7+16'],
    [65_535, '7+16'],
    [65_536, '7+64'],
    [10_000_000, '7+64'],
  ])('uses the minimal encoding for %i bytes', (length, expected) => {
    expect(lengthEncodingFor(length)).toBe(expected);
  });

  it('spends 126 and 127 as escapes rather than lengths', () => {
    expect(lengthFieldValue(125)).toBe(125);
    expect(lengthFieldValue(126)).toBe(126);
    expect(lengthFieldValue(65_536)).toBe(127);
  });

  it('adds 0, 2 or 8 bytes of extended length', () => {
    expect(extendedLengthBytes('7-bit')).toBe(0);
    expect(extendedLengthBytes('7+16')).toBe(2);
    expect(extendedLengthBytes('7+64')).toBe(8);
  });

  it('produces only the six header sizes the format allows', () => {
    const sizes = new Set<number>();
    for (const length of [0, 125, 126, 65_535, 65_536]) {
      for (const key of [undefined, RFC_KEY]) {
        sizes.add(
          headerBytes(
            frame({
              opcode: 'binary',
              payload: new Uint8Array(length),
              ...(key === undefined ? {} : { maskingKey: key }),
            }),
          ),
        );
      }
    }
    expect([...sizes].sort((a, b) => a - b)).toEqual([2, 4, 6, 8, 10, 14]);
  });

  it('documents all three encodings for the panel', () => {
    expect(LENGTH_ENCODINGS.map((entry) => entry.encoding)).toEqual([
      '7-bit',
      '7+16',
      '7+64',
    ]);
    expect(LENGTH_ENCODINGS[2].detail).toContain('2^63-1');
  });
});

// ---------------------------------------------------------------------------
// Round trips
// ---------------------------------------------------------------------------

describe('encode/decode round trips', () => {
  const lengths = [0, 1, 5, 125, 126, 200, 65_535, 65_536, 70_000];

  it.each(lengths)('round-trips an unmasked %i-byte binary frame', (length) => {
    const payload = new Uint8Array(length).map((_, index) => index % 256);
    const original = binaryFrame(payload);
    const decoded = decodeFrame(encoded(original));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value.frame).toEqual(original);
    expect(decoded.value.totalBytes).toBe(frameBytes(original));
    expect(decoded.value.lengthEncoding).toBe(lengthEncodingFor(length));
  });

  it.each(lengths)('round-trips a masked %i-byte binary frame', (length) => {
    const payload = new Uint8Array(length).map((_, index) => (index * 7) % 256);
    const original = binaryFrame(payload, { maskingKey: maskingKeyFrom(length) });
    const decoded = decodeFrame(encoded(original));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    // The frame that comes back holds the *application* data, unmasked.
    expect(decoded.value.frame).toEqual(original);
    expect(decoded.value.frame.payload).toEqual(payload);
    // ...and the wire held something else entirely.
    if (length > 0) expect(decoded.value.maskedPayload).not.toEqual(payload);
  });

  it('round-trips every flag combination', () => {
    for (const fin of [true, false]) {
      for (const opcode of ['text', 'binary', 'continuation'] as const) {
        const original = frame({ opcode, fin, payload: utf8Bytes('flags') });
        const decoded = decodeFrame(encoded(original));
        expect(decoded.ok).toBe(true);
        if (decoded.ok) expect(decoded.value.frame).toEqual(original);
      }
    }
  });

  it('round-trips text through the convenience helpers', () => {
    const original = textFrame('hej, världen 🌍', { maskingKey: RFC_KEY });
    const decoded = decodeFrame(encoded(original));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(frameText(decoded.value.frame)).toBe('hej, världen 🌍');
  });

  it('reads several frames off one stream and reports the remainder', () => {
    const all = encodeFrames([textFrame('one'), pingFrame(), textFrame('two')]);
    expect(all.ok).toBe(true);
    if (!all.ok) return;

    const complete = decodeFrames(all.value);
    expect(complete.frames).toHaveLength(3);
    expect(complete.remainder).toHaveLength(0);

    // TCP has no idea where a frame ends: half a frame is the normal case, not an error.
    const partial = decodeFrames(all.value.slice(0, all.value.length - 2));
    expect(partial.frames).toHaveLength(2);
    expect(partial.remainder.length).toBeGreaterThan(0);
    expect(partial.error).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Masking
// ---------------------------------------------------------------------------

describe('masking', () => {
  it('is payload[i] XOR key[i mod 4]', () => {
    expect(applyMask(utf8Bytes('Hello'), RFC_KEY)).toEqual(
      bytes(0x7f, 0x9f, 0x4d, 0x51, 0x58),
    );
  });

  it('is its own inverse, which is why one function serves both ends', () => {
    const payload = utf8Bytes('the same function both ways');
    expect(applyMask(applyMask(payload, RFC_KEY), RFC_KEY)).toEqual(payload);
  });

  it('repeats the key past four bytes', () => {
    const zeros = new Uint8Array(8);
    expect([...applyMask(zeros, RFC_KEY)]).toEqual([
      0x37, 0xfa, 0x21, 0x3d, 0x37, 0xfa, 0x21, 0x3d,
    ]);
  });

  it('draws a deterministic key, so a scenario replays identically', () => {
    expect(maskingKeyFrom('frame-1')).toEqual(maskingKeyFrom('frame-1'));
    expect(maskingKeyFrom('frame-1')).not.toEqual(maskingKeyFrom('frame-2'));
    expect(maskingKeyFrom('frame-1').every((byte) => byte >= 0 && byte <= 255)).toBe(
      true,
    );
  });

  it('requires masking one way and forbids it the other', () => {
    const unmasked = textFrame('hi');
    const masked = textFrame('hi', { maskingKey: RFC_KEY });

    expect(validateFrame(unmasked, { direction: 'client-to-server' }).ok).toBe(false);
    expect(validateFrame(masked, { direction: 'client-to-server' }).ok).toBe(true);
    expect(validateFrame(masked, { direction: 'server-to-client' }).ok).toBe(false);
    expect(validateFrame(unmasked, { direction: 'server-to-client' }).ok).toBe(true);
  });

  it('explains the asymmetry in terms of the attack, not of privacy', () => {
    const client = explainMasking('client-to-server');
    expect(client.required).toBe(true);
    expect(client.detail).toContain('proxy');
    expect(client.detail).toContain('Not for privacy');

    const server = explainMasking('server-to-client');
    expect(server.required).toBe(false);
    expect(server.detail).toContain('fail the connection');
  });

  it('costs exactly four bytes more in the client direction', () => {
    expect(frameBytes(textFrame('hello', { maskingKey: RFC_KEY }))).toBe(
      frameBytes(textFrame('hello')) + 4,
    );
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('validateFrame', () => {
  it('caps a control frame at 125 bytes', () => {
    expect(validateFrame(pingFrame(new Uint8Array(MAX_CONTROL_PAYLOAD))).ok).toBe(true);
    const tooBig = validateFrame(pingFrame(new Uint8Array(MAX_CONTROL_PAYLOAD + 1)));
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) expect(tooBig.error).toContain('125');
  });

  it('refuses a fragmented control frame', () => {
    const result = validateFrame(frame({ opcode: 'ping', fin: false }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('may not be fragmented');
  });

  it('refuses an RSV bit with no extension negotiated', () => {
    const rsv = frame({ opcode: 'text', payload: utf8Bytes('x'), rsv1: true });
    expect(validateFrame(rsv).ok).toBe(false);
    expect(validateFrame(rsv, { extensionNegotiated: true }).ok).toBe(true);
  });

  it('refuses ill-formed UTF-8 in a complete text frame -- the 1007 case', () => {
    const result = validateFrame(frame({ opcode: 'text', payload: bytes(0xc3, 0x28) }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('1007');
  });

  it('does not validate UTF-8 on a first fragment, which may split a character', () => {
    // 0xF0 opens a four-byte sequence; the rest arrives in the continuation frame.
    expect(
      validateFrame(frame({ opcode: 'text', fin: false, payload: bytes(0xf0) })).ok,
    ).toBe(true);
  });

  it('refuses a MASK bit with no key, and a key with no MASK bit', () => {
    const noKey: WebSocketFrame = { ...textFrame('x'), masked: true };
    expect(validateFrame(noKey).ok).toBe(false);
    const noBit: WebSocketFrame = {
      ...textFrame('x', { maskingKey: RFC_KEY }),
      masked: false,
    };
    expect(validateFrame(noBit).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Decoding failures
// ---------------------------------------------------------------------------

describe('decodeFrame', () => {
  it('refuses a reserved opcode', () => {
    const result = decodeFrame(bytes(0x83, 0x00));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('reserved');
  });

  it('refuses a non-minimal length encoding', () => {
    // 100 bytes announced with the 16-bit escape. Decodes cleanly; still illegal.
    const wire = new Uint8Array(4 + 100);
    wire[0] = 0x82;
    wire[1] = 0x7e;
    wire[2] = 0x00;
    wire[3] = 0x64;
    const result = decodeFrame(wire);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('minimal');
  });

  it('refuses a 64-bit length whose top bit is set', () => {
    const wire = new Uint8Array(10);
    wire[0] = 0x82;
    wire[1] = 0x7f;
    wire[2] = 0x80;
    const result = frameLength(wire);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('most significant bit');
  });

  it('says how many bytes are missing rather than calling half a header illegal', () => {
    const partial = encoded(textFrame('hello')).slice(0, 4);
    const result = decodeFrame(partial);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('available');
  });

  it('reports a short header separately from an illegal one', () => {
    expect(frameLength(bytes(0x81)).ok).toBe(false);
    expect(frameLength(bytes(0x81, 0x7e)).ok).toBe(false);
    expect(frameLength(bytes(0x81, 0x05, 0, 0, 0, 0, 0)).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The bit-level layout
// ---------------------------------------------------------------------------

describe('frameLayout', () => {
  it('positions the fixed fields exactly where RFC 6455 s 5.2 draws them', () => {
    const layout = frameLayout(textFrame('Hello'));
    expect(layout.fields.map((field) => [field.id, field.bitOffset, field.bits])).toEqual(
      [
        ['fin', 0, 1],
        ['rsv1', 1, 1],
        ['rsv2', 2, 1],
        ['rsv3', 3, 1],
        ['opcode', 4, 4],
        ['mask', 8, 1],
        ['length-field', 9, 7],
        ['payload', 16, 40],
      ],
    );
    expect(layout.headerBytes).toBe(2);
  });

  it('inserts the 16-bit extension and shifts the payload', () => {
    const layout = frameLayout(binaryFrame(new Uint8Array(300)));
    const extended = layout.fields.find((field) => field.id === 'extended-length');
    expect(extended?.bitOffset).toBe(16);
    expect(extended?.bits).toBe(16);
    expect(layout.fields.at(-1)?.bitOffset).toBe(32);
    expect(layout.headerBytes).toBe(4);
  });

  it('inserts the 64-bit extension', () => {
    const layout = frameLayout(binaryFrame(new Uint8Array(65_536)));
    const extended = layout.fields.find((field) => field.id === 'extended-length');
    expect(extended?.bits).toBe(64);
    expect(layout.headerBytes).toBe(10);
    expect(layout.lengthEncoding).toBe('7+64');
  });

  it('puts the masking key after the length and before the payload', () => {
    const layout = frameLayout(textFrame('Hello', { maskingKey: RFC_KEY }));
    const key = layout.fields.find((field) => field.id === 'masking-key');
    expect(key?.bitOffset).toBe(16);
    expect(key?.bits).toBe(32);
    expect(key?.value).toBe('37 FA 21 3D');
    expect(layout.fields.at(-1)?.bitOffset).toBe(48);
    expect(layout.headerBytes).toBe(6);
  });

  it('omits the masking-key field entirely when the frame is unmasked', () => {
    const layout = frameLayout(textFrame('Hello'));
    expect(layout.fields.some((field) => field.id === 'masking-key')).toBe(false);
  });

  it('shows each bitfield in binary at its real width', () => {
    const layout = frameLayout(textFrame('Hello'));
    expect(layout.fields.find((field) => field.id === 'opcode')?.binary).toBe('0001');
    expect(layout.fields.find((field) => field.id === 'length-field')?.binary).toBe(
      '0000101',
    );
    expect(layout.fields.find((field) => field.id === 'fin')?.binary).toBe('1');
  });

  it('reports the overhead ratio the transport comparison lives on', () => {
    const layout = frameLayout(textFrame('Hello'));
    expect(layout.totalBytes).toBe(7);
    expect(layout.overheadRatio).toBeCloseTo(2 / 7, 5);
  });

  it('agrees with headerBytes and frameBytes', () => {
    for (const length of [0, 125, 126, 65_536]) {
      for (const key of [undefined, RFC_KEY]) {
        const value = frame({
          opcode: 'binary',
          payload: new Uint8Array(length),
          ...(key === undefined ? {} : { maskingKey: key }),
        });
        const layout = frameLayout(value);
        expect(layout.headerBytes).toBe(headerBytes(value));
        expect(layout.totalBytes).toBe(frameBytes(value));
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Fragmentation
// ---------------------------------------------------------------------------

describe('fragmentMessage and reassemble', () => {
  it('declares the type once and continues with the continuation opcode', () => {
    const result = fragmentMessage('text', utf8Bytes('Hello'), 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((value) => value.opcode)).toEqual([
      'text',
      'continuation',
      'continuation',
    ]);
    expect(result.value.map((value) => value.fin)).toEqual([false, false, true]);
  });

  it('round-trips a fragmented message', () => {
    const original = 'a message long enough to need several frames';
    const fragments = fragmentMessage('text', utf8Bytes(original), 7);
    expect(fragments.ok).toBe(true);
    if (!fragments.ok) return;

    const message = reassemble(fragments.value);
    expect(message.ok).toBe(true);
    if (!message.ok) return;
    expect(message.value.text).toBe(original);
    expect(message.value.frameCount).toBe(fragments.value.length);
  });

  it('sends a zero-length message as one frame with FIN set', () => {
    const result = fragmentMessage('binary', new Uint8Array(0), 16);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0].fin).toBe(true);
    }
  });

  it('requires a fresh masking key per frame', () => {
    const short = fragmentMessage('text', utf8Bytes('Hello'), 2, [RFC_KEY]);
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.error).toContain('fresh key per frame');

    const enough = fragmentMessage('text', utf8Bytes('Hello'), 2, [
      maskingKeyFrom(1),
      maskingKeyFrom(2),
      maskingKeyFrom(3),
    ]);
    expect(enough.ok).toBe(true);
    if (enough.ok) {
      const keys = enough.value.map((value) => value.maskingKey?.join(','));
      expect(new Set(keys).size).toBe(3);
    }
  });

  it('skips control frames interleaved between fragments', () => {
    const message = reassemble([
      textFrame('Hel', { fin: false }),
      pingFrame(utf8Bytes('still there?')),
      continuationFrame(utf8Bytes('lo')),
    ]);
    expect(message.ok).toBe(true);
    if (message.ok) {
      expect(message.value.text).toBe('Hello');
      expect(message.value.frameCount).toBe(2);
    }
  });

  it('validates UTF-8 across the whole message, not per fragment', () => {
    // The four bytes of an emoji, split down the middle. Neither half is valid alone.
    const emoji = utf8Bytes('🌍');
    const message = reassemble([
      frame({ opcode: 'text', fin: false, payload: emoji.slice(0, 2) }),
      frame({ opcode: 'continuation', fin: true, payload: emoji.slice(2) }),
    ]);
    expect(message.ok).toBe(true);
    if (message.ok) expect(message.value.text).toBe('🌍');
  });

  it('refuses a continuation with nothing to continue', () => {
    const result = reassemble([continuationFrame(utf8Bytes('lo'))]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('no message in progress');
  });

  it('refuses a new data frame while a message is still open', () => {
    const result = reassemble([
      textFrame('Hel', { fin: false }),
      textFrame('interrupting'),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('still open');
  });

  it('refuses a sequence that never sets FIN', () => {
    const result = reassemble([textFrame('Hel', { fin: false })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('incomplete');
  });

  it('counts the wire cost of fragmenting, which is one header per fragment', () => {
    const one = reassemble([textFrame('abcdefgh')]);
    const many = fragmentMessage('text', utf8Bytes('abcdefgh'), 2);
    expect(one.ok && many.ok).toBe(true);
    if (!one.ok || !many.ok) return;
    const split = reassemble(many.value);
    expect(split.ok).toBe(true);
    if (split.ok) {
      // Four frames instead of one: three extra two-byte headers.
      expect(split.value.wireBytes).toBe(one.value.wireBytes + 6);
    }
  });
});
