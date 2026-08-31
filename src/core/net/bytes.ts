/**
 * Bytes -- turning numbers, buffers, and headers into the text a packet analyser shows.
 *
 * Everything here is presentation of *facts about the wire*, which is why it lives in
 * `src/core` and not in a component: a hex dump is not a design decision, it is what
 * the bytes are. Components decide the font and the colour; this file decides what the
 * string says, and can therefore be tested without a DOM.
 *
 * Three groups of helpers:
 *
 * - **Numbers to notation** -- `toHex`, `toBinary`. A header field means more in the
 *   base its specification uses: TTL in decimal, flags in binary, EtherType in hex.
 * - **Buffers** -- `bytesToHex`, `hexToBytes`, `hexDump`, `formatBytes`.
 * - **Headers** -- finding and rendering the fields of a `PDU`, so the inspector and
 *   the tests read the same structure.
 */

import type { HeaderField, LayerKey, PDU, ProtocolLayer } from '@/core/types/pdu';
import { fail, ok, type ParseResult } from './result';

// ---------------------------------------------------------------------------
// Numbers to notation
// ---------------------------------------------------------------------------

/** Options for {@link toHex}. */
export interface HexOptions {
  /** Width of the field in bits; the output is padded to `bits / 4` digits. Default 8. */
  bits?: number;
  /** Prefix the result with `0x`. Default `true`. */
  prefix?: boolean;
  /** Upper-case digits. Default `false` -- lower case is the packet-analyser norm. */
  uppercase?: boolean;
}

/**
 * Render an unsigned integer as fixed-width hexadecimal.
 *
 * The width comes from the header field, not from the value, because that is the point:
 * an EtherType is `0x0800` and not `0x800`, and seeing the leading zero is what tells a
 * learner the field is 16 bits wide.
 */
export function toHex(value: number, options: HexOptions = {}): string {
  const { bits = 8, prefix = true, uppercase = false } = options;
  assertFitsInBits(value, bits, 'hex');
  const digits = Math.ceil(bits / 4);
  const text = value.toString(16).padStart(digits, '0');
  return `${prefix ? '0x' : ''}${uppercase ? text.toUpperCase() : text}`;
}

/** Options for {@link toBinary}. */
export interface BinaryOptions {
  /** Width of the field in bits; the output is padded to this many digits. Default 8. */
  bits?: number;
  /** Insert `separator` every `group` digits. `0` disables grouping. Default 4. */
  group?: number;
  /** What to insert between groups. Default a single space. */
  separator?: string;
  /** Prefix the result with `0b`. Default `false`. */
  prefix?: boolean;
}

/**
 * Render an unsigned integer as fixed-width binary, grouped for readability.
 *
 * Binary is the only honest way to show a bitfield: TCP flags, an IPv4 subnet mask, or
 * the two bits of DSCP/ECN inside a Type of Service octet only make sense as bits.
 */
export function toBinary(value: number, options: BinaryOptions = {}): string {
  const { bits = 8, group = 4, separator = ' ', prefix = false } = options;
  assertFitsInBits(value, bits, 'binary');
  const text = value.toString(2).padStart(bits, '0');
  const grouped = group > 0 ? chunk(text, group).join(separator) : text;
  return `${prefix ? '0b' : ''}${grouped}`;
}

function assertFitsInBits(value: number, bits: number, what: string): void {
  if (!Number.isInteger(bits) || bits < 1 || bits > 32) {
    throw new RangeError(`${what} width must be an integer 1-32 bits, got ${bits}`);
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(
      `cannot render ${value} as ${what}: expected a non-negative integer`,
    );
  }
  if (value > 2 ** bits - 1) {
    throw new RangeError(`${value} does not fit in ${bits} bits`);
  }
}

function chunk(text: string, size: number): string[] {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    parts.push(text.slice(i, i + size));
  }
  return parts;
}

// ---------------------------------------------------------------------------
// Buffers
// ---------------------------------------------------------------------------

/** Options for {@link bytesToHex}. */
export interface BytesToHexOptions {
  /** Placed between octets. Default `' '`; use `''` for a solid run of digits. */
  separator?: string;
  /** Upper-case digits. Default `false`. */
  uppercase?: boolean;
}

/** Render a byte sequence as hex pairs, e.g. `'48 54 54 50'`. */
export function bytesToHex(
  bytes: Iterable<number>,
  options: BytesToHexOptions = {},
): string {
  const { separator = ' ', uppercase = false } = options;
  const pairs: string[] = [];
  for (const byte of bytes) {
    if (!Number.isInteger(byte) || byte < 0 || byte > 0xff) {
      throw new RangeError(`${byte} is not a byte (0-255)`);
    }
    const pair = byte.toString(16).padStart(2, '0');
    pairs.push(uppercase ? pair.toUpperCase() : pair);
  }
  return pairs.join(separator);
}

/**
 * Parse a hex string back into bytes.
 *
 * Whitespace, colons, and hyphens between pairs are ignored, so anything copied out of
 * a packet capture parses. An odd number of digits is rejected rather than padded --
 * half a byte is a mistake, not an input to guess at.
 */
export function hexToBytes(input: string): ParseResult<number[]> {
  if (typeof input !== 'string') {
    return fail('expected a string');
  }
  const cleaned = input.replace(/[\s:-]+/g, '');
  if (cleaned.length === 0) {
    return ok([]);
  }
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) {
    return fail('contains a character that is not a hexadecimal digit');
  }
  if (cleaned.length % 2 !== 0) {
    return fail(`odd number of hex digits (${cleaned.length}); each byte needs two`);
  }
  const bytes: number[] = [];
  for (let i = 0; i < cleaned.length; i += 2) {
    bytes.push(parseInt(cleaned.slice(i, i + 2), 16));
  }
  return ok(bytes);
}

/** Encode text as UTF-8 bytes -- the payload side of a `hexDump`. */
export function textToBytes(text: string): number[] {
  return [...new TextEncoder().encode(text)];
}

/** Options for {@link hexDump}. */
export interface HexDumpOptions {
  /** Bytes per line. Default 16, as in `xxd` and Wireshark. */
  width?: number;
  /** Offset the first byte is labelled with. Default 0. */
  offset?: number;
}

/**
 * The classic three-column dump: offset, hex, printable ASCII.
 *
 * ```text
 * 00000000  47 45 54 20 2f 20 48 54  54 50 2f 31 2e 31 0d 0a  |GET / HTTP/1.1..|
 * ```
 *
 * Non-printable bytes show as `.` in the text column, which is the convention every
 * tool uses and is worth a learner recognising.
 */
export function hexDump(
  bytes: readonly number[],
  options: HexDumpOptions = {},
): string[] {
  const { width = 16, offset = 0 } = options;
  if (!Number.isInteger(width) || width < 1) {
    throw new RangeError(`hex dump width must be a positive integer, got ${width}`);
  }

  const lines: string[] = [];
  for (let start = 0; start < bytes.length; start += width) {
    const row = bytes.slice(start, start + width);
    const address = (offset + start).toString(16).padStart(8, '0');

    // Split the hex column in half, the way `hexdump -C` does, so the eye can count.
    const half = Math.ceil(width / 2);
    const left = bytesToHex(row.slice(0, half)).padEnd(half * 3 - 1, ' ');
    const right = bytesToHex(row.slice(half)).padEnd(
      Math.max(0, (width - half) * 3 - 1),
      ' ',
    );

    const text = row
      .map((byte) => (byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.'))
      .join('');

    lines.push(`${address}  ${left}  ${right}  |${text}|`);
  }
  return lines;
}

/** Options for {@link formatBytes}. */
export interface FormatBytesOptions {
  /** Use IEC units (KiB, powers of 1024) instead of SI (kB, powers of 1000). */
  binary?: boolean;
  /** Digits after the decimal point for scaled units. Default 1. */
  precision?: number;
}

const SI_UNITS = ['B', 'kB', 'MB', 'GB', 'TB', 'PB'] as const;
const IEC_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] as const;

/**
 * Human-readable byte size: `1500` becomes `'1.5 kB'`.
 *
 * SI by default, because that is what a network measures in -- a 1 Gbps link is
 * 1,000,000,000 bits per second, not 2^30. Pass `binary: true` for the 1024-based IEC
 * units a file system uses. Trailing zeros are dropped, so exact values read cleanly
 * (`1000` is `'1 kB'`, not `'1.0 kB'`).
 */
export function formatBytes(bytes: number, options: FormatBytesOptions = {}): string {
  const { binary = false, precision = 1 } = options;
  if (!Number.isFinite(bytes)) {
    throw new RangeError(`cannot format ${bytes} as a byte size`);
  }

  const base = binary ? 1024 : 1000;
  const units = binary ? IEC_UNITS : SI_UNITS;
  const sign = bytes < 0 ? '-' : '';
  let value = Math.abs(bytes);

  let unit = 0;
  while (value >= base && unit < units.length - 1) {
    value /= base;
    unit += 1;
  }

  // Bytes are whole things; only scaled units get a fraction.
  const text = unit === 0 ? String(value) : trimZeros(value.toFixed(precision));
  return `${sign}${text} ${units[unit]}`;
}

function trimZeros(text: string): string {
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

/** The outermost layer of `pdu` at `key`, or `undefined` if the stack has none. */
export function findLayer(pdu: PDU, key: LayerKey): ProtocolLayer | undefined {
  return pdu.layers.find((layer) => layer.layer === key);
}

/** The outermost layer speaking `protocol` (case-insensitive), e.g. `'TCP'`. */
export function findLayerByProtocol(
  pdu: PDU,
  protocol: string,
): ProtocolLayer | undefined {
  const wanted = protocol.toLowerCase();
  return pdu.layers.find((layer) => layer.protocol.toLowerCase() === wanted);
}

/**
 * Find a header field by name, case-insensitively.
 *
 * Accepts a whole PDU or a single layer. Given a PDU it searches outermost layer first,
 * which is the order the field would be read off the wire -- so a `'Source'` in an
 * Ethernet header wins over one in an IPv4 header. Pass the layer when you mean a
 * specific one.
 */
export function findField(
  source: PDU | ProtocolLayer,
  name: string,
): HeaderField | undefined {
  const wanted = name.toLowerCase();
  const layers = 'layers' in source ? source.layers : [source];
  for (const layer of layers) {
    const field = layer.fields.find(
      (candidate) => candidate.name.toLowerCase() === wanted,
    );
    if (field) {
      return field;
    }
  }
  return undefined;
}

/** The value of a header field, or `undefined` if the field is not present. */
export function fieldValue(
  source: PDU | ProtocolLayer,
  name: string,
): string | undefined {
  return findField(source, name)?.value;
}

/** One field on one line: `'TTL = 64 (8 bits)'`. */
export function renderHeaderField(field: HeaderField): string {
  const width = field.bits === undefined ? '' : ` (${field.bits} bits)`;
  return `${field.name} = ${field.value}${width}`;
}

/**
 * A field list with the `=` signs aligned, the way a protocol decoder prints one.
 *
 * Alignment is done here rather than with CSS so that the same rows can be asserted on
 * in a test, written to a text export, and rendered in a monospace panel.
 */
export function renderHeaderFields(fields: readonly HeaderField[]): string[] {
  const width = fields.reduce(
    (longest, field) => Math.max(longest, field.name.length),
    0,
  );
  return fields.map((field) => {
    const bits = field.bits === undefined ? '' : ` (${field.bits} bits)`;
    return `${field.name.padEnd(width)} = ${field.value}${bits}`;
  });
}

/** One layer as a titled block: `'IPv4 [network]'` and its indented fields. */
export function renderLayer(layer: ProtocolLayer): string[] {
  const lines = [`${layer.protocol} [${layer.layer}]`];
  for (const line of renderHeaderFields(layer.fields)) {
    lines.push(`  ${line}`);
  }
  if (layer.payloadPreview !== undefined) {
    lines.push(`  payload: ${layer.payloadPreview}`);
  }
  return lines;
}

/**
 * The whole encapsulation stack as text, outermost header first.
 *
 * This is the plain-text twin of the packet inspector: the same data, in the same
 * order, with no rendering involved -- which makes it the easiest thing to assert on
 * when testing that a module builds the packet it claims to.
 */
export function renderPdu(pdu: PDU): string[] {
  const lines = [`${pdu.summary} (${formatBytes(pdu.sizeBytes)})`];
  for (const layer of pdu.layers) {
    lines.push(...renderLayer(layer));
  }
  return lines;
}
