import { describe, expect, it } from 'vitest';
import type { PDU } from '@/core/types/pdu';
import {
  bytesToHex,
  fieldValue,
  findField,
  findLayer,
  findLayerByProtocol,
  formatBytes,
  hexDump,
  hexToBytes,
  renderHeaderField,
  renderHeaderFields,
  renderLayer,
  renderPdu,
  textToBytes,
  toBinary,
  toHex,
} from '../bytes';

/** A small but realistic stack: an HTTP request inside TCP inside IPv4 inside Ethernet. */
const REQUEST: PDU = {
  id: 'pdu-1',
  sizeBytes: 128,
  summary: 'HTTP GET / -> 93.184.216.34',
  layers: [
    {
      layer: 'link',
      protocol: 'Ethernet',
      fields: [
        { name: 'Destination', value: 'aa:bb:cc:dd:ee:ff', bits: 48 },
        { name: 'Source', value: '3c:22:fb:00:11:22', bits: 48 },
        { name: 'EtherType', value: '0x0800', bits: 16, note: 'IPv4' },
      ],
    },
    {
      layer: 'network',
      protocol: 'IPv4',
      fields: [
        { name: 'Source', value: '192.168.1.10', bits: 32 },
        { name: 'Destination', value: '93.184.216.34', bits: 32 },
        { name: 'TTL', value: '64', bits: 8, note: 'Decremented at every router.' },
      ],
    },
    {
      layer: 'transport',
      protocol: 'TCP',
      fields: [
        { name: 'Source Port', value: '49152', bits: 16 },
        { name: 'Destination Port', value: '80', bits: 16 },
        { name: 'Flags', value: 'PSH, ACK' },
      ],
    },
    {
      layer: 'application',
      protocol: 'HTTP/1.1',
      fields: [{ name: 'Method', value: 'GET' }],
      payloadPreview: 'GET / HTTP/1.1',
    },
  ],
};

describe('toHex', () => {
  it('pads to the width of the header field, not the width of the value', () => {
    expect(toHex(0x0800, { bits: 16 })).toBe('0x0800');
    expect(toHex(64)).toBe('0x40');
    expect(toHex(5)).toBe('0x05');
    expect(toHex(0xdeadbeef, { bits: 32 })).toBe('0xdeadbeef');
  });

  it('honours the prefix and case options', () => {
    expect(toHex(255, { prefix: false })).toBe('ff');
    expect(toHex(255, { uppercase: true })).toBe('0xFF');
    expect(toHex(255, { prefix: false, uppercase: true })).toBe('FF');
  });

  it('rounds an odd bit width up to whole hex digits', () => {
    // A 4-bit IPv4 version field is one digit; a 6-bit DSCP still needs two.
    expect(toHex(4, { bits: 4 })).toBe('0x4');
    expect(toHex(46, { bits: 6 })).toBe('0x2e');
  });

  it('refuses values that do not fit, which is how a bad field is caught', () => {
    expect(() => toHex(256)).toThrow(/does not fit in 8 bits/);
    expect(() => toHex(-1)).toThrow(RangeError);
    expect(() => toHex(1.5)).toThrow(RangeError);
    expect(() => toHex(1, { bits: 0 })).toThrow(RangeError);
    expect(() => toHex(1, { bits: 33 })).toThrow(RangeError);
  });
});

describe('toBinary', () => {
  it('renders fixed-width bits grouped in nibbles', () => {
    expect(toBinary(64)).toBe('0100 0000');
    expect(toBinary(0)).toBe('0000 0000');
    expect(toBinary(255)).toBe('1111 1111');
  });

  it('can render an ungrouped or differently grouped field', () => {
    expect(toBinary(255, { group: 0 })).toBe('11111111');
    expect(toBinary(2, { bits: 4, group: 0 })).toBe('0010');
    expect(toBinary(0b1010_1010, { group: 2, separator: '-' })).toBe('10-10-10-10');
    expect(toBinary(1, { bits: 4, group: 0, prefix: true })).toBe('0b0001');
  });

  it('shows a subnet mask octet the way a subnetting lesson needs it', () => {
    expect(toBinary(224, { group: 0 })).toBe('11100000');
  });

  it('refuses values that do not fit the field', () => {
    expect(() => toBinary(16, { bits: 4 })).toThrow(/does not fit in 4 bits/);
    expect(() => toBinary(-1)).toThrow(RangeError);
  });
});

describe('bytesToHex and hexToBytes', () => {
  it('renders bytes as space-separated pairs by default', () => {
    expect(bytesToHex([0x48, 0x54, 0x54, 0x50])).toBe('48 54 54 50');
    expect(bytesToHex([0x00, 0x0f])).toBe('00 0f');
  });

  it('honours the separator and case options', () => {
    expect(bytesToHex([0xaa, 0xbb], { separator: '' })).toBe('aabb');
    expect(bytesToHex([0xaa, 0xbb], { separator: ':' })).toBe('aa:bb');
    expect(bytesToHex([0xaa, 0xbb], { uppercase: true })).toBe('AA BB');
    expect(bytesToHex([])).toBe('');
  });

  it('rejects anything that is not a byte', () => {
    expect(() => bytesToHex([256])).toThrow(RangeError);
    expect(() => bytesToHex([-1])).toThrow(RangeError);
    expect(() => bytesToHex([1.5])).toThrow(RangeError);
  });

  it('parses hex back to bytes, ignoring capture-tool separators', () => {
    expect(hexToBytes('48 54 54 50')).toEqual({ ok: true, value: [72, 84, 84, 80] });
    expect(hexToBytes('aa:bb-cc')).toEqual({ ok: true, value: [170, 187, 204] });
    expect(hexToBytes('AABB')).toEqual({ ok: true, value: [170, 187] });
    expect(hexToBytes('')).toEqual({ ok: true, value: [] });
  });

  it('round-trips', () => {
    const bytes = [0x00, 0x1f, 0xff, 0x80];
    const parsed = hexToBytes(bytesToHex(bytes));
    expect(parsed.ok && parsed.value).toEqual(bytes);
  });

  it.each([
    ['abc', 'odd number of digits'],
    ['zz', 'not hexadecimal'],
    ['0x48', 'a 0x prefix is not part of a dump'],
    ['48,54', 'unsupported separator'],
  ])('rejects %s (%s)', (input) => {
    expect(hexToBytes(input).ok).toBe(false);
  });

  it('rejects a non-string at runtime', () => {
    const result = hexToBytes(null as unknown as string);
    expect(result.ok ? '' : result.error).toBe('expected a string');
  });

  it('encodes text as UTF-8 bytes', () => {
    expect(textToBytes('GET')).toEqual([0x47, 0x45, 0x54]);
    expect(textToBytes('é')).toEqual([0xc3, 0xa9]);
  });
});

describe('hexDump', () => {
  it('produces the classic offset / hex / ASCII layout', () => {
    expect(hexDump(textToBytes('GET / HTTP/1.1\r\n'))).toEqual([
      '00000000  47 45 54 20 2f 20 48 54  54 50 2f 31 2e 31 0d 0a  |GET / HTTP/1.1..|',
    ]);
  });

  it('wraps at the requested width and keeps counting the offset', () => {
    const lines = hexDump(textToBytes('abcdefghijklmnopqrstuvwxyz'));
    expect(lines).toHaveLength(2);
    expect(lines[0].startsWith('00000000')).toBe(true);
    expect(lines[1].startsWith('00000010')).toBe(true);
    expect(lines[1].endsWith('|qrstuvwxyz|')).toBe(true);
  });

  it('can start from a non-zero offset', () => {
    expect(hexDump([0x41], { offset: 0x100 })[0].startsWith('00000100')).toBe(true);
  });

  it('pads a short final line so the ASCII column stays aligned', () => {
    const [full] = hexDump(textToBytes('0123456789abcdef'));
    const [partial] = hexDump(textToBytes('ABC'));
    expect(partial.indexOf('|')).toBe(full.indexOf('|'));
    expect(partial.endsWith('|ABC|')).toBe(true);
  });

  it('shows non-printable bytes as dots in the text column', () => {
    expect(hexDump([0x00, 0x7f, 0x20, 0x7e], { width: 4 })[0].endsWith('|.. ~|')).toBe(
      true,
    );
  });

  it('returns no lines for no bytes', () => {
    expect(hexDump([])).toEqual([]);
  });

  it('refuses a nonsensical width', () => {
    expect(() => hexDump([1], { width: 0 })).toThrow(RangeError);
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [1, '1 B'],
    [512, '512 B'],
    [999, '999 B'],
    [1000, '1 kB'],
    [1500, '1.5 kB'],
    [1_234_567, '1.2 MB'],
    [1_000_000_000, '1 GB'],
    [1.5e12, '1.5 TB'],
    [1.5e15, '1.5 PB'],
    [1.5e18, '1500 PB'],
  ])('formats %d as %s in SI units', (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });

  it.each([
    [1024, '1 KiB'],
    [1536, '1.5 KiB'],
    [1_048_576, '1 MiB'],
    [1023, '1023 B'],
  ])('formats %d as %s in IEC units', (input, expected) => {
    expect(formatBytes(input, { binary: true })).toBe(expected);
  });

  it('keeps the requested precision but drops trailing zeros', () => {
    expect(formatBytes(1536, { precision: 2 })).toBe('1.54 kB');
    expect(formatBytes(1500, { precision: 3 })).toBe('1.5 kB');
    expect(formatBytes(1500, { precision: 0 })).toBe('2 kB');
  });

  it('handles a negative delta', () => {
    expect(formatBytes(-1500)).toBe('-1.5 kB');
  });

  it('refuses a value that is not a number', () => {
    expect(() => formatBytes(Number.NaN)).toThrow(RangeError);
    expect(() => formatBytes(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('finding header fields', () => {
  it('finds a layer by its place in the stack', () => {
    expect(findLayer(REQUEST, 'network')?.protocol).toBe('IPv4');
    expect(findLayer(REQUEST, 'session')).toBeUndefined();
  });

  it('finds a layer by protocol name, case-insensitively', () => {
    expect(findLayerByProtocol(REQUEST, 'tcp')?.layer).toBe('transport');
    expect(findLayerByProtocol(REQUEST, 'HTTP/1.1')?.layer).toBe('application');
    expect(findLayerByProtocol(REQUEST, 'TLS')).toBeUndefined();
  });

  it('searches a PDU outermost layer first, the order bytes are read', () => {
    // Both Ethernet and IPv4 have a "Source"; the frame is read first.
    expect(fieldValue(REQUEST, 'Source')).toBe('3c:22:fb:00:11:22');
  });

  it('searches one layer when a layer is what you pass', () => {
    const network = findLayer(REQUEST, 'network');
    expect(network && fieldValue(network, 'Source')).toBe('192.168.1.10');
    expect(network && fieldValue(network, 'ttl')).toBe('64');
  });

  it('returns undefined for a field that is not in the stack', () => {
    expect(findField(REQUEST, 'Window Size')).toBeUndefined();
    expect(fieldValue(REQUEST, 'Window Size')).toBeUndefined();
  });

  it('returns the whole field, notes included', () => {
    expect(findField(REQUEST, 'TTL')).toEqual({
      name: 'TTL',
      value: '64',
      bits: 8,
      note: 'Decremented at every router.',
    });
  });
});

describe('rendering headers', () => {
  it('renders one field with its width', () => {
    expect(renderHeaderField({ name: 'TTL', value: '64', bits: 8 })).toBe(
      'TTL = 64 (8 bits)',
    );
  });

  it('omits the width when the field does not declare one', () => {
    expect(renderHeaderField({ name: 'Flags', value: 'SYN' })).toBe('Flags = SYN');
  });

  it('aligns the equals signs down a field list', () => {
    const transport = findLayer(REQUEST, 'transport');
    expect(transport && renderHeaderFields(transport.fields)).toEqual([
      'Source Port      = 49152 (16 bits)',
      'Destination Port = 80 (16 bits)',
      'Flags            = PSH, ACK',
    ]);
  });

  it('renders an empty field list as no rows', () => {
    expect(renderHeaderFields([])).toEqual([]);
  });

  it('titles a layer with its protocol and its place in the stack', () => {
    const application = findLayer(REQUEST, 'application');
    expect(application && renderLayer(application)).toEqual([
      'HTTP/1.1 [application]',
      '  Method = GET',
      '  payload: GET / HTTP/1.1',
    ]);
  });

  it('renders the whole stack outermost header first', () => {
    const lines = renderPdu(REQUEST);
    expect(lines[0]).toBe('HTTP GET / -> 93.184.216.34 (128 B)');
    expect(lines.filter((line) => !line.startsWith(' '))).toEqual([
      'HTTP GET / -> 93.184.216.34 (128 B)',
      'Ethernet [link]',
      'IPv4 [network]',
      'TCP [transport]',
      'HTTP/1.1 [application]',
    ]);
    expect(lines).toContain(`  ${'TTL'.padEnd('Destination'.length)} = 64 (8 bits)`);
  });
});
