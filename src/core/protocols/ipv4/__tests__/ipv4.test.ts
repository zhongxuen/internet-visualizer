import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TTL,
  IPV4_HEADER_BYTES,
  IP_PROTOCOLS,
  applyIpv4Hop,
  buildIpv4Layer,
  encapsulateIpv4,
  decapsulateIpv4,
  forwardIpv4,
  fragmentIpv4,
  internetChecksum,
  ipv4Checksum,
  ipv4ChecksumValid,
  ipv4Header,
  ipv4HeaderBytes,
  ipv4TotalLength,
  reassembleIpv4,
  type Ipv4Header,
} from './ipv4';

/**
 * The worked example from the IPv4 header checksum literature, chosen because it can be
 * verified against a source outside this repository: a 115-byte UDP datagram from
 * 192.168.0.1 to 192.168.0.199, DF set, TTL 64, whose header checksum is 0xb861.
 *
 * If this test fails, the checksum is wrong -- not the expectation.
 */
const REFERENCE = ipv4Header({
  sourceIp: '192.168.0.1',
  destinationIp: '192.168.0.199',
  protocol: IP_PROTOCOLS.udp,
  payloadBytes: 115 - IPV4_HEADER_BYTES,
  ttl: 64,
  identification: 0,
  dontFragment: true,
});

/** A packet leaving a laptop for a web server, before any router has seen it. */
function outbound(overrides: Partial<Ipv4Header> = {}): Ipv4Header {
  return ipv4Header({
    sourceIp: '192.168.1.112',
    destinationIp: '203.0.113.30',
    protocol: IP_PROTOCOLS.tcp,
    payloadBytes: 40,
    identification: 0x1c46,
    ...overrides,
  });
}

describe('checksum', () => {
  it('computes the Internet checksum of RFC 1071 over the real 20 header bytes', () => {
    expect(ipv4Checksum(REFERENCE)).toBe(0xb861);
  });

  it('serializes the header to exactly 20 bytes with the checksum field zeroed', () => {
    const bytes = ipv4HeaderBytes(REFERENCE);
    expect(bytes).toHaveLength(IPV4_HEADER_BYTES);
    expect(bytes.slice(0, 4)).toEqual([0x45, 0x00, 0x00, 0x73]);
    expect(bytes.slice(10, 12)).toEqual([0x00, 0x00]);
    expect(bytes.slice(12)).toEqual([192, 168, 0, 1, 192, 168, 0, 199]);
  });

  /**
   * The property that makes the checksum worth showing at all: a receiver does not
   * recompute and compare, it sums everything including the checksum and expects zero.
   */
  it('sums to zero when the computed checksum is put back in place', () => {
    expect(ipv4ChecksumValid(REFERENCE, ipv4Checksum(REFERENCE))).toBe(true);
    expect(ipv4ChecksumValid(REFERENCE, 0xb862)).toBe(false);
  });

  it('folds the carry out of the top of the 16-bit sum', () => {
    // 0xffff + 0xffff = 0x1fffe, folded to 0xffff, complemented to 0x0000.
    expect(internetChecksum([0xff, 0xff, 0xff, 0xff])).toBe(0x0000);
    // 0x0001 + 0xf203 + 0xf4f5 = 0x1e6f9, folded to 0xe6fa, complemented to 0x1905.
    expect(internetChecksum([0x00, 0x01, 0xf2, 0x03, 0xf4, 0xf5])).toBe(0x1905);
  });
});

describe('forwardIpv4', () => {
  it('decrements the TTL by exactly one per hop', () => {
    const first = forwardIpv4(outbound());
    expect(first.header.ttl).toBe(DEFAULT_TTL - 1);
    expect(forwardIpv4(first.header).header.ttl).toBe(DEFAULT_TTL - 2);
  });

  /** The requirement the whole module turns on: routers rewrite frames, not addresses. */
  it('leaves the source and destination addresses untouched', () => {
    const before = outbound();
    const after = forwardIpv4(before).header;
    expect(after.sourceIp).toBe(before.sourceIp);
    expect(after.destinationIp).toBe(before.destinationIp);
  });

  it('recomputes the header checksum, because the TTL it covers just changed', () => {
    const before = outbound();
    const hop = forwardIpv4(before);
    expect(hop.previousChecksum).toBe(ipv4Checksum(before));
    expect(hop.checksum).not.toBe(hop.previousChecksum);
    expect(hop.checksum).toBe(ipv4Checksum(hop.header));
    expect(ipv4ChecksumValid(hop.header, hop.checksum)).toBe(true);
  });

  /**
   * The TTL is the *high* byte of its 16-bit word, so losing one drops the sum by
   * 0x100 and lifts the complement by the same. Worth pinning, because it is the change
   * a learner can follow by eye down the hop table: 0x603f, 0x613f, 0x623f.
   */
  it('moves the checksum by 0x100 for each TTL the packet loses', () => {
    const before = outbound();
    expect(ipv4Checksum(before)).toBe(0x603f);

    const first = forwardIpv4(before);
    expect(first.checksum).toBe(0x613f);
    expect(forwardIpv4(first.header).checksum).toBe(0x623f);
  });

  it('reports expiry when the TTL reaches zero, and refuses to forward past it', () => {
    const arriving = outbound({ ttl: 1 });
    const hop = forwardIpv4(arriving);
    expect(hop.header.ttl).toBe(0);
    expect(hop.expired).toBe(true);
    expect(() => forwardIpv4(hop.header)).toThrow(RangeError);
  });

  it('does not report expiry while the packet still has life left', () => {
    expect(forwardIpv4(outbound({ ttl: 2 })).expired).toBe(false);
  });
});

describe('applyIpv4Hop', () => {
  it('replaces the network layer in place, keeping the id, size, and other layers', () => {
    const header = outbound();
    const packet = encapsulateIpv4(
      {
        id: 'packet-1',
        layers: [{ layer: 'transport', protocol: 'TCP', fields: [] }],
        sizeBytes: 40,
        summary: 'TCP',
      },
      header,
    );

    const { pdu, hop } = applyIpv4Hop(packet, header);

    expect(pdu.id).toBe('packet-1');
    expect(pdu.sizeBytes).toBe(packet.sizeBytes);
    expect(pdu.layers).toHaveLength(2);
    expect(pdu.layers[1]).toEqual(packet.layers[1]);
    expect(field(pdu.layers[0].fields, 'TTL')).toBe(String(DEFAULT_TTL - 1));
    expect(field(pdu.layers[0].fields, 'Source')).toBe('192.168.1.112');
    expect(hop.expired).toBe(false);
  });
});

describe('encapsulation', () => {
  it('takes the payload length from the PDU it is wrapping', () => {
    const segment = {
      id: 'segment',
      layers: [{ layer: 'transport' as const, protocol: 'TCP', fields: [] }],
      sizeBytes: 1460,
      summary: 'TCP',
    };
    const packet = encapsulateIpv4(segment, outbound({ payloadBytes: 0 }));

    expect(packet.sizeBytes).toBe(1460 + IPV4_HEADER_BYTES);
    expect(field(packet.layers[0].fields, 'Total Length')).toBe('1480');
    expect(decapsulateIpv4(packet).sizeBytes).toBe(1460);
  });
});

describe('fragmentIpv4', () => {
  /**
   * A 4000-byte datagram over a 1500-byte link. The payload per fragment is
   * floor((1500 - 20) / 8) * 8 = 1480, so it splits 1480 / 1480 / 1020, and the offsets
   * count 8-byte units: 0, 185, 370. The eights are the part people get wrong.
   */
  it('splits on an 8-byte boundary with the right offsets and lengths', () => {
    const result = fragmentIpv4(outbound({ payloadBytes: 3980 }), 1500);

    expect(result.kind).toBe('fragmented');
    if (result.kind !== 'fragmented') return;

    expect(result.fragments.map((f) => f.payloadBytes)).toEqual([1480, 1480, 1020]);
    expect(result.fragments.map((f) => f.fragmentOffset)).toEqual([0, 185, 370]);
    expect(result.fragments.map(ipv4TotalLength)).toEqual([1500, 1500, 1040]);
  });

  it('sets More Fragments on every fragment except the last', () => {
    const result = fragmentIpv4(outbound({ payloadBytes: 3980 }), 1500);
    if (result.kind !== 'fragmented') throw new Error('expected fragmentation');

    expect(result.fragments.map((f) => f.moreFragments)).toEqual([true, true, false]);
  });

  it('gives every fragment the same identification, addresses, and TTL', () => {
    const original = outbound({ payloadBytes: 3980, ttl: 61 });
    const result = fragmentIpv4(original, 1500);
    if (result.kind !== 'fragmented') throw new Error('expected fragmentation');

    for (const fragment of result.fragments) {
      expect(fragment.identification).toBe(original.identification);
      expect(fragment.sourceIp).toBe(original.sourceIp);
      expect(fragment.destinationIp).toBe(original.destinationIp);
      expect(fragment.ttl).toBe(61);
    }
  });

  it('leaves a datagram that already fits completely alone', () => {
    const original = outbound({ payloadBytes: 1400 });
    const result = fragmentIpv4(original, 1500);

    expect(result.kind).toBe('whole');
    if (result.kind !== 'whole') return;
    expect(result.fragments[0]).toEqual(original);
  });

  it('refuses to fragment when DF is set, reporting the MTU for path MTU discovery', () => {
    const result = fragmentIpv4(
      outbound({ payloadBytes: 3980, dontFragment: true }),
      1500,
    );

    expect(result).toEqual({ kind: 'blocked', nextHopMtu: 1500 });
  });

  /**
   * Re-fragmenting at a second, smaller link. Offsets are relative to the *original*
   * datagram, and the last piece keeps the More Fragments flag it arrived with -- so a
   * receiver still knows the tail has not arrived.
   */
  it('keeps offsets relative to the original when a fragment is fragmented again', () => {
    const middle = outbound({
      payloadBytes: 1480,
      fragmentOffset: 185,
      moreFragments: true,
    });
    const result = fragmentIpv4(middle, 620);
    if (result.kind !== 'fragmented') throw new Error('expected fragmentation');

    expect(result.fragments.map((f) => f.payloadBytes)).toEqual([600, 600, 280]);
    expect(result.fragments.map((f) => f.fragmentOffset)).toEqual([185, 260, 335]);
    expect(result.fragments.map((f) => f.moreFragments)).toEqual([true, true, true]);
  });

  it('clears DF on the fragments it produces', () => {
    const result = fragmentIpv4(outbound({ payloadBytes: 3980 }), 1500);
    if (result.kind !== 'fragmented') throw new Error('expected fragmentation');
    expect(result.fragments.every((f) => !f.dontFragment)).toBe(true);
  });

  it('rejects an MTU too small to carry one 8-byte unit', () => {
    expect(() => fragmentIpv4(outbound({ payloadBytes: 3980 }), 24)).toThrow(RangeError);
  });
});

describe('reassembleIpv4', () => {
  const original = outbound({ payloadBytes: 3980 });

  function fragments(): Ipv4Header[] {
    const result = fragmentIpv4(original, 1500);
    if (result.kind !== 'fragmented') throw new Error('expected fragmentation');
    return [...result.fragments];
  }

  it('restores the original payload length from a complete set', () => {
    const result = reassembleIpv4(fragments());

    expect(result.kind).toBe('complete');
    if (result.kind !== 'complete') return;
    expect(result.header.payloadBytes).toBe(3980);
    expect(result.header.moreFragments).toBe(false);
    expect(result.header.fragmentOffset).toBe(0);
    expect(result.header.sourceIp).toBe(original.sourceIp);
  });

  it('does not care what order the fragments arrived in', () => {
    const shuffled = fragments();
    const forward = reassembleIpv4(shuffled);
    const reversed = reassembleIpv4([...shuffled].reverse());
    expect(reversed).toEqual(forward);
  });

  /** One lost fragment costs the whole datagram -- there is no partial delivery. */
  it('reports a gap when a fragment is missing from the middle', () => {
    const [first, , last] = fragments();
    const result = reassembleIpv4([first, last]);

    expect(result.kind).toBe('incomplete');
    if (result.kind !== 'incomplete') return;
    expect(result.reason).toContain('missing');
  });

  it('waits when the last fragment has not arrived', () => {
    const [first, middle] = fragments();
    expect(reassembleIpv4([first, middle]).kind).toBe('incomplete');
  });

  it('refuses to join fragments of different datagrams', () => {
    const [first] = fragments();
    const stranger: Ipv4Header = { ...first, identification: first.identification + 1 };
    const result = reassembleIpv4([first, stranger]);

    expect(result.kind).toBe('incomplete');
    if (result.kind !== 'incomplete') return;
    expect(result.reason).toContain('different datagrams');
  });

  it('takes the lowest TTL of the fragments, since that one saw the longest path', () => {
    const [first, middle, last] = fragments();
    const result = reassembleIpv4([first, { ...middle, ttl: 58 }, { ...last, ttl: 60 }]);

    if (result.kind !== 'complete') throw new Error('expected reassembly');
    expect(result.header.ttl).toBe(58);
  });
});

describe('buildIpv4Layer', () => {
  it('renders the computed checksum rather than a stored one', () => {
    const layer = buildIpv4Layer(REFERENCE);
    expect(field(layer.fields, 'Header Checksum')).toBe('0xb861');
  });

  it('renders the fragment offset in bytes as well as units', () => {
    const layer = buildIpv4Layer(outbound({ fragmentOffset: 185, moreFragments: true }));
    expect(field(layer.fields, 'Fragment Offset')).toBe('185 (byte 1480)');
    expect(field(layer.fields, 'Flags')).toBe('MF');
  });
});

describe('ipv4Header', () => {
  it('rejects an address that is not an unambiguous dotted quad', () => {
    expect(() =>
      ipv4Header({
        sourceIp: '192.168.001.1',
        destinationIp: '203.0.113.30',
        protocol: IP_PROTOCOLS.tcp,
        payloadBytes: 0,
      }),
    ).toThrow(/leading zero/);
  });

  it('rejects a TTL that does not fit the 8-bit field', () => {
    expect(() => outbound({ ttl: 256 })).toThrow(RangeError);
  });
});

function field(fields: readonly { name: string; value: string }[], name: string): string {
  const found = fields.find((entry) => entry.name === name);
  if (!found) throw new Error(`no field named ${name}`);
  return found.value;
}
