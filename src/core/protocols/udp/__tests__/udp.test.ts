import { describe, expect, it } from 'vitest';

import {
  UDP_HEADER_BYTES,
  UDP_MAX_LENGTH,
  buildUdpLayer,
  describeUdpDatagram,
  udpDatagram,
  udpLength,
  udpPdu,
} from '../udp';

/**
 * A DNS response big enough that IPv4 has to fragment it -- the case `udp.ts` exists to
 * make visible. Ports 53 and 49152 are the real pair: the resolver's well-known port and
 * an ephemeral one from the dynamic range.
 */
const DNS_RESPONSE = udpDatagram({
  sourcePort: 53,
  destinationPort: 49152,
  payloadBytes: 468,
  payloadPreview: 'example.com. 300 IN A 93.184.216.34',
});

describe('udpDatagram', () => {
  it('returns the datagram it validated', () => {
    expect(DNS_RESPONSE.sourcePort).toBe(53);
    expect(DNS_RESPONSE.payloadBytes).toBe(468);
  });

  it('accepts the whole legal port range, including zero', () => {
    expect(() =>
      udpDatagram({ sourcePort: 0, destinationPort: 65535, payloadBytes: 0 }),
    ).not.toThrow();
  });

  it.each([
    ['a source port above the 16-bit range', { sourcePort: 65536 }],
    ['a negative source port', { sourcePort: -1 }],
    ['a fractional source port', { sourcePort: 53.5 }],
    ['a destination port above the 16-bit range', { destinationPort: 65536 }],
    ['a negative destination port', { destinationPort: -1 }],
  ])('rejects %s', (_label, override) => {
    expect(() =>
      udpDatagram({
        sourcePort: 53,
        destinationPort: 49152,
        payloadBytes: 0,
        ...override,
      }),
    ).toThrow(RangeError);
  });

  /**
   * The `Length` field is 16 bits and counts the eight header bytes, so the largest
   * payload UDP can describe is `65535 - 8`. One more is not a big datagram, it is an
   * unrepresentable one.
   */
  it('rejects a payload the 16-bit Length field could not describe', () => {
    const largest = UDP_MAX_LENGTH - UDP_HEADER_BYTES;

    expect(() =>
      udpDatagram({ sourcePort: 53, destinationPort: 49152, payloadBytes: largest }),
    ).not.toThrow();
    expect(() =>
      udpDatagram({ sourcePort: 53, destinationPort: 49152, payloadBytes: largest + 1 }),
    ).toThrow(/0\.\.65527/);
  });

  it.each([
    ['a negative payload', -1],
    ['a fractional payload', 1.5],
  ])('rejects %s', (_label, payloadBytes) => {
    expect(() =>
      udpDatagram({ sourcePort: 53, destinationPort: 49152, payloadBytes }),
    ).toThrow(RangeError);
  });
});

describe('udpLength', () => {
  it('counts the eight header bytes as the Length field does', () => {
    expect(udpLength(DNS_RESPONSE)).toBe(468 + UDP_HEADER_BYTES);
    expect(
      udpLength(udpDatagram({ sourcePort: 1, destinationPort: 2, payloadBytes: 0 })),
    ).toBe(UDP_HEADER_BYTES);
  });
});

describe('describeUdpDatagram', () => {
  it('reads as the event log prints it', () => {
    expect(describeUdpDatagram(DNS_RESPONSE)).toBe('53 -> 49152 Len=468');
  });
});

describe('buildUdpLayer', () => {
  it('lays the four fields out in wire order, sixteen bits each', () => {
    const layer = buildUdpLayer(DNS_RESPONSE);

    expect(layer.layer).toBe('transport');
    expect(layer.protocol).toBe('UDP');
    expect(layer.fields.map((field) => field.name)).toEqual([
      'Source Port',
      'Destination Port',
      'Length',
      'Checksum',
    ]);
    expect(layer.fields.every((field) => field.bits === 16)).toBe(true);
    // Eight bytes of header, four fields, sixteen bits each. The whole point of UDP.
    expect(layer.fields.reduce((total, field) => total + (field.bits ?? 0), 0)).toBe(
      UDP_HEADER_BYTES * 8,
    );
  });

  it('prints the Length field as header plus payload, not payload alone', () => {
    const length = buildUdpLayer(DNS_RESPONSE).fields[2]!;

    expect(length.value).toBe('476');
    expect(length.note).toContain('8 + 468');
  });

  /**
   * Zero is not a placeholder in this field: over IPv4 the UDP checksum is optional, and
   * `0x0000` is how a sender says it did not compute one. The note has to say so, because
   * a learner reading a zeroed checksum will otherwise assume the simulation gave up.
   */
  it('shows the checksum as a legal zero and explains why', () => {
    const checksum = buildUdpLayer(DNS_RESPONSE).fields[3]!;

    expect(checksum.value).toBe('0x0000');
    expect(checksum.note).toMatch(/optional over IPv4/i);
    expect(checksum.note).toMatch(/mandatory over IPv6/i);
  });

  it('carries a payload preview only when the datagram has one', () => {
    expect(buildUdpLayer(DNS_RESPONSE).payloadPreview).toBe(
      'example.com. 300 IN A 93.184.216.34',
    );

    const bare = buildUdpLayer(
      udpDatagram({ sourcePort: 53, destinationPort: 49152, payloadBytes: 468 }),
    );
    // Absent, not `undefined`: the inspector renders on presence.
    expect('payloadPreview' in bare).toBe(false);
  });
});

describe('udpPdu', () => {
  it('wraps an application layer inside the transport layer, outermost first', () => {
    const application = {
      layer: 'application' as const,
      protocol: 'DNS',
      fields: [{ name: 'Answer', value: '93.184.216.34' }],
    };
    const pdu = udpPdu('dns-response', DNS_RESPONSE, application);

    expect(pdu.id).toBe('dns-response');
    expect(pdu.layers.map((layer) => layer.protocol)).toEqual(['UDP', 'DNS']);
    expect(pdu.sizeBytes).toBe(476);
    expect(pdu.summary).toBe('UDP 53 -> 49152 Len=468');
  });

  it('is a lone transport layer when nothing rides on it', () => {
    expect(udpPdu('probe', DNS_RESPONSE).layers).toHaveLength(1);
  });
});
