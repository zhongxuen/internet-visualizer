import { describe, expect, it } from 'vitest';

import type { PDU } from '@/core/types/pdu';

import {
  ETHERNET_FCS_BYTES,
  ETHERNET_HEADER_BYTES,
  ETHERNET_MIN_PAYLOAD,
  ETHERNET_MTU,
  ETHER_TYPES,
  buildEthernetLayer,
  decapsulateEthernet,
  encapsulateEthernet,
  ethernetFraming,
  ethernetPadding,
  exceedsMtu,
  frameOnWireBytes,
  rewriteEthernetHeader,
  rewriteFraming,
} from './ethernet';

/**
 * The link layer, tested for the one claim the module is built to demonstrate: the
 * Ethernet header is addressed to the *next machine on the wire*, is rewritten at every
 * hop, and the packet inside it -- id included -- never changes.
 *
 * `journey.test.ts` covers the walk end to end. This file covers the primitives it walks
 * with, which is where the arithmetic lives: the 14-byte header a capture shows, the
 * 46-byte payload floor, and the 64-byte minimum frame those two produce together.
 */

/** Two interfaces either side of one wire, in the vendor-neutral documentation range. */
const HOST_MAC = '02:00:00:00:00:01';
const ROUTER_MAC = '02:00:00:00:00:02';
const NEXT_HOP_MAC = '02:00:00:00:00:03';

/** A packet with no link layer yet -- what a host hands its NIC. */
const PACKET: PDU = {
  id: 'packet-1',
  layers: [
    { layer: 'network', protocol: 'IPv4', fields: [{ name: 'TTL', value: '64' }] },
    { layer: 'transport', protocol: 'UDP', fields: [{ name: 'Length', value: '28' }] },
  ],
  sizeBytes: 48,
  summary: 'IPv4 UDP',
};

describe('ethernetFraming', () => {
  it('canonicalises both addresses so a scenario cannot ship two spellings of one MAC', () => {
    const framing = ethernetFraming('02-00-00-00-00-01', '0200.0000.0002');

    expect(framing.sourceMac).toBe(HOST_MAC);
    expect(framing.destinationMac).toBe(ROUTER_MAC);
  });

  /**
   * At import time, not at render time. A typo that survives into the hop table reads as
   * a plausible address and is invisible; a typo that throws names the scenario file.
   */
  it('throws on an address that is not a MAC', () => {
    expect(() => ethernetFraming('nope', ROUTER_MAC)).toThrow();
    expect(() => ethernetFraming(HOST_MAC, '02:00:00:00:00')).toThrow();
  });

  it('carries IPv4 unless told otherwise', () => {
    expect(ethernetFraming(HOST_MAC, ROUTER_MAC).etherType).toBe('ipv4');
    expect(ethernetFraming(HOST_MAC, ROUTER_MAC, 'arp').etherType).toBe('arp');
  });
});

describe('rewriteFraming', () => {
  /**
   * The whole of what a router does at layer 2. Both addresses change; the EtherType
   * does not, because the thing inside the frame did not.
   */
  it('replaces both addresses and keeps the EtherType', () => {
    const arp = ethernetFraming(HOST_MAC, ROUTER_MAC, 'arp');

    expect(
      rewriteFraming(arp, { sourceMac: ROUTER_MAC, destinationMac: NEXT_HOP_MAC }),
    ).toEqual({
      sourceMac: ROUTER_MAC,
      destinationMac: NEXT_HOP_MAC,
      etherType: 'arp',
    });
  });
});

describe('the 46-byte payload floor', () => {
  it('pads a short payload up to the minimum and leaves a long one alone', () => {
    expect(ethernetPadding(0)).toBe(ETHERNET_MIN_PAYLOAD);
    expect(ethernetPadding(20)).toBe(26);
    expect(ethernetPadding(ETHERNET_MIN_PAYLOAD)).toBe(0);
    expect(ethernetPadding(1500)).toBe(0);
  });

  /**
   * The answer to "why is a 20-byte packet still 64 bytes on the wire?": 14 bytes of
   * header, 46 of padded payload, 4 of FCS. The 64-byte minimum frame is a consequence
   * of the floor, not a separate rule.
   */
  it('clocks a minimum frame of 64 bytes onto the wire', () => {
    expect(frameOnWireBytes(20)).toBe(64);
    expect(frameOnWireBytes(0)).toBe(64);
    expect(frameOnWireBytes(ETHERNET_MTU)).toBe(
      ETHERNET_HEADER_BYTES + ETHERNET_MTU + ETHERNET_FCS_BYTES,
    );
  });
});

describe('exceedsMtu', () => {
  it('is exclusive at the MTU, which is the largest payload that fits', () => {
    expect(exceedsMtu(ETHERNET_MTU)).toBe(false);
    expect(exceedsMtu(ETHERNET_MTU + 1)).toBe(true);
  });

  /** A tunnel or a PPPoE link is smaller, and that is where fragmentation shows up. */
  it('takes a smaller MTU for a link that has one', () => {
    expect(exceedsMtu(1450, 1492)).toBe(false);
    expect(exceedsMtu(1500, 1492)).toBe(true);
  });
});

describe('buildEthernetLayer', () => {
  it('lays the three fields out in wire order and adds to 14 bytes', () => {
    const fields = buildEthernetLayer(ethernetFraming(HOST_MAC, ROUTER_MAC)).fields;

    expect(fields.map((field) => field.name)).toEqual([
      'Destination MAC',
      'Source MAC',
      'EtherType',
    ]);
    // Destination first: it is what a receiving NIC reads first.
    expect(fields[0]!.value).toBe(ROUTER_MAC);
    expect(fields[1]!.value).toBe(HOST_MAC);
    expect(fields.reduce((total, field) => total + (field.bits ?? 0), 0)).toBe(
      ETHERNET_HEADER_BYTES * 8,
    );
  });

  it.each([
    ['ipv4', '0x0800', 'IPv4'],
    ['arp', '0x0806', 'ARP'],
    ['ipv6', '0x86dd', 'IPv6'],
  ] as const)('prints the %s EtherType as hex and name', (name, hex, label) => {
    const layer = buildEthernetLayer(ethernetFraming(HOST_MAC, ROUTER_MAC, name));

    expect(layer.fields[2]!.value).toBe(`${hex} (${label})`);
    expect(ETHER_TYPES[name]).toBe(Number(hex));
  });

  /** The note is the teaching, so it is asserted rather than left to drift. */
  it('says outright that the destination is the next machine, not the far end', () => {
    const fields = buildEthernetLayer(ethernetFraming(HOST_MAC, ROUTER_MAC)).fields;

    expect(fields[0]!.note).toMatch(/not the far end/i);
    expect(fields[1]!.note).toMatch(/rewritten at every hop/i);
  });
});

describe('encapsulateEthernet / decapsulateEthernet', () => {
  it('pushes the link header to the front and adds its 14 bytes', () => {
    const framed = encapsulateEthernet(PACKET, ethernetFraming(HOST_MAC, ROUTER_MAC));

    expect(framed.layers.map((layer) => layer.protocol)).toEqual([
      'Ethernet II',
      'IPv4',
      'UDP',
    ]);
    expect(framed.sizeBytes).toBe(PACKET.sizeBytes + ETHERNET_HEADER_BYTES);
    // Same packet, re-enveloped: the id and the summary are not a router's to change.
    expect(framed.id).toBe(PACKET.id);
    expect(framed.summary).toBe(PACKET.summary);
  });

  it('round-trips exactly', () => {
    const framed = encapsulateEthernet(PACKET, ethernetFraming(HOST_MAC, ROUTER_MAC));

    expect(decapsulateEthernet(framed)).toStrictEqual(PACKET);
  });

  /**
   * Defensive by design: a caller can strip a frame without first checking whether there
   * is one. The guard is `index !== 0` rather than "has a link layer", because a link
   * header anywhere but the outside is not something to peel off.
   */
  it('leaves a packet that has no outermost frame untouched', () => {
    expect(decapsulateEthernet(PACKET)).toBe(PACKET);
  });
});

describe('rewriteEthernetHeader', () => {
  /**
   * The claim the whole module rests on. A router replaces the envelope; the id, the
   * size, the summary and every inner layer are the same objects they were, which is
   * what lets the UI follow one id across every hop of the timeline.
   */
  it('swaps both MACs and changes nothing else about the packet', () => {
    const framed = encapsulateEthernet(PACKET, ethernetFraming(HOST_MAC, ROUTER_MAC));
    const forwarded = rewriteEthernetHeader(
      framed,
      ethernetFraming(ROUTER_MAC, NEXT_HOP_MAC),
    );

    expect(forwarded.layers[0]!.fields[0]!.value).toBe(NEXT_HOP_MAC);
    expect(forwarded.layers[0]!.fields[1]!.value).toBe(ROUTER_MAC);

    expect(forwarded.id).toBe(framed.id);
    expect(forwarded.sizeBytes).toBe(framed.sizeBytes);
    expect(forwarded.summary).toBe(framed.summary);
    expect(forwarded.layers.slice(1)).toStrictEqual(framed.layers.slice(1));
  });

  /** Nothing to rewrite means nothing to strip: it frames the packet instead. */
  it('encapsulates a packet that has no frame yet', () => {
    const framed = rewriteEthernetHeader(PACKET, ethernetFraming(HOST_MAC, ROUTER_MAC));

    expect(framed.layers[0]!.protocol).toBe('Ethernet II');
    expect(framed.sizeBytes).toBe(PACKET.sizeBytes + ETHERNET_HEADER_BYTES);
  });

  /**
   * A frame that is not outermost -- one captured inside a tunnel, say -- is still the
   * link layer of this packet, so it is the one rewritten. Only `decapsulateEthernet`
   * insists on index 0, because peeling is what needs the header to be on the outside.
   */
  it('rewrites a link layer that is not the outermost one', () => {
    const tunnelled: PDU = {
      ...PACKET,
      layers: [
        { layer: 'network', protocol: 'IPv4', fields: [] },
        buildEthernetLayer(ethernetFraming(HOST_MAC, ROUTER_MAC)),
      ],
    };

    const rewritten = rewriteEthernetHeader(
      tunnelled,
      ethernetFraming(ROUTER_MAC, NEXT_HOP_MAC),
    );

    expect(rewritten.layers).toHaveLength(2);
    expect(rewritten.layers[1]!.fields[0]!.value).toBe(NEXT_HOP_MAC);
    expect(rewritten.sizeBytes).toBe(tunnelled.sizeBytes);
  });
});
