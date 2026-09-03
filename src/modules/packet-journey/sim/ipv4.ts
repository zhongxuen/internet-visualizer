/**
 * IPv4 -- the layer that survives the whole journey, and the arithmetic that proves it.
 *
 * Where `ethernet.ts` is rewritten at every hop, this header is the constant: the same
 * source and destination address arrive at the far end that left the sender. The three
 * exceptions are the three things this file has to get exactly right, because a learner
 * who half-remembers them ends up with a wrong mental model of the entire Internet:
 *
 * 1. **TTL decrements at every router**, and at zero the packet is discarded and an
 *    ICMP Time Exceeded goes back to the sender. That is not a safety valve nobody
 *    hits -- it is the mechanism `traceroute` is built out of (phase 12).
 * 2. **The header checksum must be recomputed** whenever the TTL changes, because it
 *    covers the header and nothing else. {@link ipv4Checksum} computes the real
 *    one's-complement sum over the real 20 serialized bytes rather than displaying a
 *    plausible-looking constant, so the value visibly changes at each hop and a learner
 *    can verify it by hand against RFC 1071.
 * 3. **Addresses change only at a NAT**, which is `nat.ts`, and nowhere else.
 *
 * Fragmentation lives here too, for the same reason: the offsets and the More Fragments
 * flag are arithmetic, and arithmetic is testable. See {@link fragmentIpv4}.
 *
 * ## Payload bytes, not payload
 *
 * A header carries `payloadBytes`, a count, and `totalLength` is derived from it. The
 * simulation models how large things are and never what the bytes contain, so nothing
 * here can fall out of sync with a payload buffer that does not exist.
 */

import { parseIpv4 } from '@/core/net/address';
import { unwrap } from '@/core/net/result';
import { toHex } from '@/core/net/bytes';
import type { PDU, ProtocolLayer } from '@/core/types/pdu';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** A header with no options: five 32-bit words. Every header this file emits is one. */
export const IPV4_HEADER_BYTES = 20;

/** `IHL` counts 32-bit words, so a 20-byte header is 5. */
export const IPV4_IHL_NO_OPTIONS = 5;

/** The widest `Total Length` a 16-bit field can express, header included. */
export const IPV4_MAX_TOTAL_LENGTH = 65535;

/**
 * The TTL most stacks start at. Not a rule -- Linux and macOS use 64, Windows 128,
 * older routers 255 -- which is why a traceroute has to count hops rather than read it.
 */
export const DEFAULT_TTL = 64;

/** The protocol numbers this simulation carries, by name. */
export const IP_PROTOCOLS = {
  icmp: 1,
  tcp: 6,
  udp: 17,
} as const;

/** Key of {@link IP_PROTOCOLS}. */
export type IpProtocolName = keyof typeof IP_PROTOCOLS;

const PROTOCOL_LABELS: Record<number, string> = {
  1: 'ICMP',
  6: 'TCP',
  17: 'UDP',
};

/** `Don't Fragment` -- bit 1 of the three flag bits. */
const FLAG_DF = 0x4000;
/** `More Fragments` -- bit 2 of the three flag bits. */
const FLAG_MF = 0x2000;

/**
 * Fragment offsets count **8-byte units**, which is the single most common source of
 * an off-by-eight in this area: a fragment starting at byte 1480 has offset 185.
 */
export const FRAGMENT_UNIT_BYTES = 8;

// ---------------------------------------------------------------------------
// The header
// ---------------------------------------------------------------------------

/**
 * An IPv4 header, as state rather than as display.
 *
 * `totalLength` and the checksum are both *derived* ({@link ipv4TotalLength},
 * {@link ipv4Checksum}) rather than stored, so they cannot drift from the fields they
 * are computed over -- which is exactly the mistake a hand-authored header makes when
 * somebody decrements the TTL and forgets the checksum.
 */
export interface Ipv4Header {
  /** Dotted-quad source. Unchanged end to end, except where a NAT rewrites it. */
  readonly sourceIp: string;
  /** Dotted-quad destination. Unchanged end to end, except at a NAT on the return path. */
  readonly destinationIp: string;
  /** Hop limit, 0-255. Every router subtracts one. */
  readonly ttl: number;
  /** IANA protocol number of whatever is inside: 1 ICMP, 6 TCP, 17 UDP. */
  readonly protocol: number;
  /** Groups the fragments of one original datagram together, 0-65535. */
  readonly identification: number;
  /** Set means "discard rather than fragment me" -- how path MTU discovery works. */
  readonly dontFragment: boolean;
  /** Set on every fragment except the last, so a receiver knows more is coming. */
  readonly moreFragments: boolean;
  /** Where this fragment's payload sits in the original, in 8-byte units. */
  readonly fragmentOffset: number;
  /** Bytes carried after the 20-byte header. `totalLength` is this plus 20. */
  readonly payloadBytes: number;
  /** Differentiated services code point, 0-63. Zero unless a scenario is about QoS. */
  readonly dscp: number;
  /** Explicit congestion notification, 0-3. */
  readonly ecn: number;
}

/** The fields a caller must supply to {@link ipv4Header}; the rest have defaults. */
export interface Ipv4HeaderInit {
  sourceIp: string;
  destinationIp: string;
  protocol: number;
  payloadBytes: number;
  ttl?: number;
  identification?: number;
  dontFragment?: boolean;
  moreFragments?: boolean;
  fragmentOffset?: number;
  dscp?: number;
  ecn?: number;
}

/**
 * Build a header, validating every field against the width it has on the wire.
 *
 * Addresses go through `parseIpv4`, which rejects the shorthands (`127.1`, leading
 * zeros) that a real filter has to worry about; here it simply means a typo in a
 * scenario file throws at import time instead of drawing a wrong address.
 */
export function ipv4Header(init: Ipv4HeaderInit): Ipv4Header {
  const header: Ipv4Header = {
    sourceIp: unwrap(parseIpv4(init.sourceIp), `IPv4 source "${init.sourceIp}"`).text,
    destinationIp: unwrap(
      parseIpv4(init.destinationIp),
      `IPv4 destination "${init.destinationIp}"`,
    ).text,
    ttl: init.ttl ?? DEFAULT_TTL,
    protocol: init.protocol,
    identification: init.identification ?? 0,
    dontFragment: init.dontFragment ?? false,
    moreFragments: init.moreFragments ?? false,
    fragmentOffset: init.fragmentOffset ?? 0,
    payloadBytes: init.payloadBytes,
    dscp: init.dscp ?? 0,
    ecn: init.ecn ?? 0,
  };

  assertRange(header.ttl, 0, 255, 'TTL');
  assertRange(header.protocol, 0, 255, 'protocol');
  assertRange(header.identification, 0, 0xffff, 'identification');
  assertRange(header.fragmentOffset, 0, 0x1fff, 'fragment offset');
  assertRange(header.dscp, 0, 63, 'DSCP');
  assertRange(header.ecn, 0, 3, 'ECN');
  assertRange(
    header.payloadBytes,
    0,
    IPV4_MAX_TOTAL_LENGTH - IPV4_HEADER_BYTES,
    'payload',
  );

  return header;
}

function assertRange(value: number, min: number, max: number, name: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(
      `IPv4 ${name} must be an integer in ${min}..${max}, got ${value}`,
    );
  }
}

/** Header plus payload, in bytes -- what the `Total Length` field carries. */
export function ipv4TotalLength(header: Ipv4Header): number {
  return IPV4_HEADER_BYTES + header.payloadBytes;
}

/** The name a capture would print for a protocol number, or the number itself. */
export function protocolLabel(protocol: number): string {
  return PROTOCOL_LABELS[protocol] ?? `protocol ${protocol}`;
}

/** The three flag bits and the 13-bit offset, packed as they sit on the wire. */
export function flagsAndOffset(header: Ipv4Header): number {
  return (
    (header.dontFragment ? FLAG_DF : 0) |
    (header.moreFragments ? FLAG_MF : 0) |
    header.fragmentOffset
  );
}

// ---------------------------------------------------------------------------
// Serialization and checksum
// ---------------------------------------------------------------------------

/**
 * The header as its 20 bytes, in network order.
 *
 * `checksum` defaults to zero because that is how the checksum itself is computed: the
 * field is zeroed, the sum is taken, and the result is written back in.
 */
export function ipv4HeaderBytes(header: Ipv4Header, checksum = 0): number[] {
  const totalLength = ipv4TotalLength(header);
  const source = unwrap(parseIpv4(header.sourceIp)).octets;
  const destination = unwrap(parseIpv4(header.destinationIp)).octets;
  const fragment = flagsAndOffset(header);

  return [
    (4 << 4) | IPV4_IHL_NO_OPTIONS,
    (header.dscp << 2) | header.ecn,
    (totalLength >> 8) & 0xff,
    totalLength & 0xff,
    (header.identification >> 8) & 0xff,
    header.identification & 0xff,
    (fragment >> 8) & 0xff,
    fragment & 0xff,
    header.ttl,
    header.protocol,
    (checksum >> 8) & 0xff,
    checksum & 0xff,
    ...source,
    ...destination,
  ];
}

/**
 * The Internet checksum of RFC 1071: the one's-complement of the one's-complement sum
 * of the data taken as 16-bit words.
 *
 * Deliberately the real algorithm rather than a hash that looks like one. It is cheap,
 * it is verifiable by hand, and the property that makes it worth showing -- that a
 * receiver can sum the header *including* the checksum and expect `0xffff` -- only
 * holds if it is actually computed.
 */
export function internetChecksum(bytes: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 2) {
    sum += ((bytes[i] << 8) | (bytes[i + 1] ?? 0)) >>> 0;
  }
  while (sum > 0xffff) {
    sum = (sum & 0xffff) + (sum >>> 16);
  }
  return ~sum & 0xffff;
}

/**
 * The header checksum for this header, recomputed from scratch.
 *
 * Covers the header only -- not the payload -- which is precisely why every router that
 * touches the TTL has to redo it, and why a corrupt payload sails straight through IPv4
 * to be caught (or not) by the transport layer above.
 */
export function ipv4Checksum(header: Ipv4Header): number {
  return internetChecksum(ipv4HeaderBytes(header));
}

/**
 * Verify a header the way a receiver does: sum all twenty bytes *with* the checksum in
 * place and check the result is zero.
 */
export function ipv4ChecksumValid(header: Ipv4Header, checksum: number): boolean {
  return internetChecksum(ipv4HeaderBytes(header, checksum)) === 0;
}

// ---------------------------------------------------------------------------
// Forwarding
// ---------------------------------------------------------------------------

/** What one router did to a packet: the new header, and whether it survived. */
export interface Ipv4Hop {
  /** The header as it leaves the router: TTL one lower, everything else identical. */
  readonly header: Ipv4Header;
  /** The recomputed checksum, which differs from the incoming one because TTL changed. */
  readonly checksum: number;
  /** The checksum the packet arrived with, so the UI can show both sides of the change. */
  readonly previousChecksum: number;
  /**
   * True when the TTL reached zero here. The packet goes no further and the router
   * sends back an ICMP Time Exceeded -- see {@link icmpTimeExceededLayer}.
   */
  readonly expired: boolean;
}

/**
 * Forward a packet one hop: subtract one from the TTL and recompute the checksum.
 *
 * A packet arriving with TTL 1 leaves with TTL 0, which means it does not leave at all:
 * RFC 791 says a router that decrements the TTL to zero discards the datagram. The
 * caller gets `expired: true` and a header it can quote inside the ICMP reply.
 */
export function forwardIpv4(header: Ipv4Header): Ipv4Hop {
  if (header.ttl <= 0) {
    throw new RangeError('cannot forward a packet whose TTL is already 0');
  }
  const next: Ipv4Header = { ...header, ttl: header.ttl - 1 };
  return {
    header: next,
    checksum: ipv4Checksum(next),
    previousChecksum: ipv4Checksum(header),
    expired: next.ttl === 0,
  };
}

/**
 * The same hop, applied to a whole PDU: the network layer is replaced in place and the
 * PDU keeps its id, its size, and every other layer.
 *
 * Nothing about the link layer is touched here -- that is `rewriteEthernetHeader`, and
 * a real router does both. Keeping them separate is what lets the inspector show that
 * one hop changed *two* headers for two entirely different reasons.
 */
export function applyIpv4Hop(pdu: PDU, header: Ipv4Header): { pdu: PDU; hop: Ipv4Hop } {
  const hop = forwardIpv4(header);
  const index = networkLayerIndex(pdu);
  if (index < 0) {
    return { pdu, hop };
  }
  const layers = [...pdu.layers];
  layers[index] = buildIpv4Layer(hop.header);
  return { pdu: { ...pdu, layers }, hop };
}

// ---------------------------------------------------------------------------
// Fragmentation
// ---------------------------------------------------------------------------

/** The outcome of offering a datagram to a link with a given MTU. */
export type Ipv4Fragmentation =
  /** It fitted. One header out, byte-for-byte the one that went in. */
  | { readonly kind: 'whole'; readonly fragments: readonly [Ipv4Header] }
  /** It did not fit and was split; `fragments` is in offset order. */
  | { readonly kind: 'fragmented'; readonly fragments: readonly Ipv4Header[] }
  /**
   * It did not fit and `Don't Fragment` was set, so the router drops it and reports the
   * MTU it could not exceed. This is path MTU discovery: the sender learns the number
   * from the ICMP message and retries smaller.
   */
  | { readonly kind: 'blocked'; readonly nextHopMtu: number };

/**
 * Split a datagram to fit an MTU, or report why it cannot be.
 *
 * The two rules that are easy to get wrong, and that the tests pin down:
 *
 * - **Every fragment except the last carries a full 8-byte-aligned payload.** The
 *   per-fragment payload is `floor((mtu - 20) / 8) * 8`, not `mtu - 20`, because the
 *   offset field counts eight-byte units and cannot express anything else. With a
 *   1500-byte MTU that is 1480, not 1480-ish.
 * - **More Fragments is set on all but the last**, and the last inherits the flag from
 *   the header it came from -- so re-fragmenting an already-fragmented packet at a
 *   second, smaller link keeps its MF set, exactly as it must.
 *
 * Each fragment is a real datagram with its own header, which is why the fragments of
 * one datagram can take different paths and why reassembly happens only at the
 * destination ({@link reassembleIpv4}) and never at a router in between.
 */
export function fragmentIpv4(header: Ipv4Header, mtu: number): Ipv4Fragmentation {
  if (!Number.isInteger(mtu) || mtu <= IPV4_HEADER_BYTES + FRAGMENT_UNIT_BYTES) {
    throw new RangeError(
      `MTU must be an integer larger than ${IPV4_HEADER_BYTES + FRAGMENT_UNIT_BYTES}, got ${mtu}`,
    );
  }

  if (ipv4TotalLength(header) <= mtu) {
    return { kind: 'whole', fragments: [header] };
  }

  if (header.dontFragment) {
    return { kind: 'blocked', nextHopMtu: mtu };
  }

  const perFragment =
    Math.floor((mtu - IPV4_HEADER_BYTES) / FRAGMENT_UNIT_BYTES) * FRAGMENT_UNIT_BYTES;

  const fragments: Ipv4Header[] = [];
  for (let offset = 0; offset < header.payloadBytes; offset += perFragment) {
    const bytes = Math.min(perFragment, header.payloadBytes - offset);
    const isLast = offset + bytes >= header.payloadBytes;
    fragments.push({
      ...header,
      payloadBytes: bytes,
      // Offsets are relative to the original datagram, so a re-fragmented fragment
      // adds to the offset it already carried rather than restarting at zero.
      fragmentOffset: header.fragmentOffset + offset / FRAGMENT_UNIT_BYTES,
      moreFragments: isLast ? header.moreFragments : true,
      // A fragment is never itself marked "do not fragment": it has already been split.
      dontFragment: false,
    });
  }

  return { kind: 'fragmented', fragments };
}

/** The result of trying to put a set of fragments back together. */
export type Ipv4Reassembly =
  /** Every byte accounted for; `header` is the original datagram, restored. */
  | { readonly kind: 'complete'; readonly header: Ipv4Header }
  /** Something is missing or inconsistent; `reason` says what, for the event log. */
  | { readonly kind: 'incomplete'; readonly reason: string };

/**
 * Reassemble fragments into the original datagram.
 *
 * **This only ever happens at the destination host.** A router in the middle forwards
 * fragments like any other packet and has no idea they belong together -- it does not
 * hold them, does not reorder them, and cannot rejoin them, because the fragments may
 * not even take the same path. That is the fact this function exists to make concrete,
 * and the reason a single lost fragment costs the whole datagram.
 *
 * The TTL of the result is the lowest of the fragments', since that is the one that
 * saw the longest path.
 */
export function reassembleIpv4(fragments: readonly Ipv4Header[]): Ipv4Reassembly {
  if (fragments.length === 0) {
    return { kind: 'incomplete', reason: 'no fragments' };
  }

  const [first] = fragments;
  const mismatched = fragments.find(
    (fragment) =>
      fragment.identification !== first.identification ||
      fragment.sourceIp !== first.sourceIp ||
      fragment.destinationIp !== first.destinationIp ||
      fragment.protocol !== first.protocol,
  );
  if (mismatched) {
    return {
      kind: 'incomplete',
      reason:
        'fragments belong to different datagrams: identification, addresses, and protocol must all match',
    };
  }

  const ordered = [...fragments].sort((a, b) => a.fragmentOffset - b.fragmentOffset);

  let expectedOffset = ordered[0].fragmentOffset;
  const base = expectedOffset;
  for (let i = 0; i < ordered.length; i += 1) {
    const fragment = ordered[i];
    if (fragment.fragmentOffset !== expectedOffset) {
      return {
        kind: 'incomplete',
        reason: `gap at offset ${expectedOffset * FRAGMENT_UNIT_BYTES}: a fragment is missing`,
      };
    }
    const isLast = i === ordered.length - 1;
    if (!isLast && !fragment.moreFragments) {
      return {
        kind: 'incomplete',
        reason: 'a fragment before the end has More Fragments clear',
      };
    }
    if (!isLast && fragment.payloadBytes % FRAGMENT_UNIT_BYTES !== 0) {
      return {
        kind: 'incomplete',
        reason: 'only the last fragment may carry a payload that is not a multiple of 8',
      };
    }
    if (isLast && fragment.moreFragments) {
      return {
        kind: 'incomplete',
        reason: 'the last fragment has More Fragments set: the tail has not arrived',
      };
    }
    expectedOffset += fragment.payloadBytes / FRAGMENT_UNIT_BYTES;
  }

  return {
    kind: 'complete',
    header: {
      ...first,
      payloadBytes: ordered.reduce((total, f) => total + f.payloadBytes, 0),
      fragmentOffset: base,
      moreFragments: false,
      dontFragment: false,
      ttl: Math.min(...ordered.map((f) => f.ttl)),
    },
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** The IPv4 header as the inspector shows it, in wire order, checksum computed. */
export function buildIpv4Layer(header: Ipv4Header): ProtocolLayer {
  const totalLength = ipv4TotalLength(header);
  const checksum = ipv4Checksum(header);

  return {
    layer: 'network',
    protocol: 'IPv4',
    fields: [
      { name: 'Version', value: '4', bits: 4 },
      {
        name: 'IHL',
        value: `${IPV4_IHL_NO_OPTIONS} (${IPV4_HEADER_BYTES} bytes)`,
        bits: 4,
        note: 'Header length in 32-bit words. Five means no options, which is almost every packet.',
      },
      { name: 'DSCP', value: String(header.dscp), bits: 6 },
      { name: 'ECN', value: String(header.ecn), bits: 2 },
      {
        name: 'Total Length',
        value: String(totalLength),
        bits: 16,
        note: `Header plus payload: ${IPV4_HEADER_BYTES} + ${header.payloadBytes} bytes.`,
      },
      {
        name: 'Identification',
        value: String(header.identification),
        bits: 16,
        note: 'Shared by every fragment of one datagram, so the destination knows which pieces belong together.',
      },
      {
        name: 'Flags',
        value: formatIpv4Flags(header),
        bits: 3,
        note: "Don't Fragment makes a router drop an oversized packet and report the MTU instead of splitting it. More Fragments is set on every fragment but the last.",
      },
      {
        name: 'Fragment Offset',
        value: `${header.fragmentOffset} (byte ${header.fragmentOffset * FRAGMENT_UNIT_BYTES})`,
        bits: 13,
        note: 'Counted in 8-byte units, which is why every fragment except the last carries a multiple of 8 bytes.',
      },
      {
        name: 'TTL',
        value: String(header.ttl),
        bits: 8,
        note: 'Every router subtracts one. At zero the packet is dropped and an ICMP Time Exceeded goes back -- which is how traceroute maps a path.',
      },
      {
        name: 'Protocol',
        value: `${header.protocol} (${protocolLabel(header.protocol)})`,
        bits: 8,
      },
      {
        name: 'Header Checksum',
        value: toHex(checksum, { bits: 16 }),
        bits: 16,
        note: 'Covers the header only, so every router that decrements the TTL must recompute it.',
      },
      {
        name: 'Source',
        value: header.sourceIp,
        bits: 32,
        note: 'Set by the sender and unchanged all the way to the destination -- unless a NAT rewrites it.',
      },
      {
        name: 'Destination',
        value: header.destinationIp,
        bits: 32,
        note: 'The far end of the journey. Routers read it to choose a next hop; none of them change it.',
      },
    ],
  };
}

/** `'DF'`, `'MF'`, `'DF, MF'`, or `'none'` -- the flags as a capture prints them. */
export function formatIpv4Flags(header: Ipv4Header): string {
  const set: string[] = [];
  if (header.dontFragment) set.push('DF');
  if (header.moreFragments) set.push('MF');
  return set.length > 0 ? set.join(', ') : 'none';
}

/**
 * Wrap a segment in an IPv4 header.
 *
 * `payloadBytes` is taken from the PDU rather than from the header passed in: the thing
 * being carried is the authority on how large it is, and letting a caller state a
 * length that disagrees with it is how a `Total Length` field goes wrong.
 */
export function encapsulateIpv4(pdu: PDU, header: Ipv4Header): PDU {
  const sized: Ipv4Header = { ...header, payloadBytes: pdu.sizeBytes };
  return {
    ...pdu,
    layers: [buildIpv4Layer(sized), ...pdu.layers],
    sizeBytes: ipv4TotalLength(sized),
  };
}

/** Strip the IPv4 header, exposing the segment inside. */
export function decapsulateIpv4(pdu: PDU): PDU {
  const index = networkLayerIndex(pdu);
  if (index !== 0) {
    return pdu;
  }
  return {
    ...pdu,
    layers: pdu.layers.slice(1),
    sizeBytes: pdu.sizeBytes - IPV4_HEADER_BYTES,
  };
}

function networkLayerIndex(pdu: PDU): number {
  return pdu.layers.findIndex(
    (layer) => layer.layer === 'network' && layer.protocol === 'IPv4',
  );
}

// ---------------------------------------------------------------------------
// The two ICMP messages IPv4 forwarding generates
// ---------------------------------------------------------------------------

/**
 * ICMP Time Exceeded (type 11, code 0): what a router sends back when it decremented a
 * TTL to zero.
 *
 * The message quotes the start of the datagram it dropped, which is how the sender
 * knows *which* packet died. Sending one of these per hop, with the TTL raised by one
 * each time, is the entirety of how traceroute works.
 */
export function icmpTimeExceededLayer(dropped: Ipv4Header): ProtocolLayer {
  return {
    layer: 'network',
    protocol: 'ICMP',
    fields: [
      { name: 'Type', value: '11 (Time Exceeded)', bits: 8 },
      { name: 'Code', value: '0 (TTL exceeded in transit)', bits: 8 },
      { name: 'Unused', value: '0', bits: 32 },
    ],
    payloadPreview: `IPv4 header + first 8 bytes of ${dropped.sourceIp} -> ${dropped.destinationIp}`,
  };
}

/**
 * ICMP Destination Unreachable, Fragmentation Needed (type 3, code 4): what a router
 * sends back when a packet is too large for the next link and `Don't Fragment` is set.
 *
 * The next-hop MTU in this message is the number path MTU discovery is built on -- the
 * sender retries at that size instead of guessing. When a firewall blocks these, the
 * connection hangs rather than failing, which is the classic "PMTU black hole".
 */
export function icmpFragmentationNeededLayer(
  dropped: Ipv4Header,
  nextHopMtu: number,
): ProtocolLayer {
  return {
    layer: 'network',
    protocol: 'ICMP',
    fields: [
      { name: 'Type', value: '3 (Destination Unreachable)', bits: 8 },
      { name: 'Code', value: '4 (Fragmentation needed, DF set)', bits: 8 },
      { name: 'Unused', value: '0', bits: 16 },
      {
        name: 'Next-Hop MTU',
        value: String(nextHopMtu),
        bits: 16,
        note: 'The size the sender must drop to. Path MTU discovery is just retrying at this number.',
      },
    ],
    payloadPreview: `IPv4 header + first 8 bytes of the ${ipv4TotalLength(dropped)}-byte datagram that was dropped`,
  };
}
