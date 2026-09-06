/**
 * UDP -- the transport layer with almost nothing in it.
 *
 * Eight bytes against TCP's twenty, and that ratio is the lesson. There is no sequence
 * number because nothing is ordered, no acknowledgement because nothing is confirmed,
 * no window because nothing is paced, and no connection state at all -- which is why
 * this file has no state machine and `tcp.ts` is mostly state machine. A datagram
 * either arrives whole or does not arrive; the application is told nothing either way.
 *
 * What UDP does provide is the pair of port numbers, and that turns out to be enough
 * for DNS, QUIC, and every real-time protocol worth naming: the reliability they need
 * is the reliability they build themselves, at a cost they choose.
 *
 * One consequence worth showing in the packet journey: a UDP datagram larger than the
 * path MTU is fragmented by IPv4, with no MSS negotiation to prevent it, so a large DNS
 * response really does arrive in pieces. That is `fragmentIpv4` in `ipv4.ts`, driven
 * from a datagram built here.
 */

import type { PDU, ProtocolLayer } from '@/core/types/pdu';

/** Source port, destination port, length, checksum -- and that is the entire header. */
export const UDP_HEADER_BYTES = 8;

/** The `Length` field is 16 bits and counts the header too. */
export const UDP_MAX_LENGTH = 65535;

/** One UDP datagram. No flags, no state, no history. */
export interface UdpDatagram {
  readonly sourcePort: number;
  readonly destinationPort: number;
  /** Application bytes carried. The `Length` field is this plus 8. */
  readonly payloadBytes: number;
  /** A short excerpt of the application data, for the inspector. Display only. */
  readonly payloadPreview?: string;
}

/** Build a datagram, validating the ports and the length. */
export function udpDatagram(init: UdpDatagram): UdpDatagram {
  assertPort(init.sourcePort, 'source port');
  assertPort(init.destinationPort, 'destination port');
  if (
    !Number.isInteger(init.payloadBytes) ||
    init.payloadBytes < 0 ||
    init.payloadBytes > UDP_MAX_LENGTH - UDP_HEADER_BYTES
  ) {
    throw new RangeError(
      `UDP payload must be an integer in 0..${UDP_MAX_LENGTH - UDP_HEADER_BYTES}, got ${init.payloadBytes}`,
    );
  }
  return init;
}

function assertPort(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new RangeError(`UDP ${name} must be an integer in 0..65535, got ${value}`);
  }
}

/** Header plus payload -- what the `Length` field carries. */
export function udpLength(datagram: UdpDatagram): number {
  return UDP_HEADER_BYTES + datagram.payloadBytes;
}

/** `'53 -> 49152 Len=468'` -- the one-liner for the event log. */
export function describeUdpDatagram(datagram: UdpDatagram): string {
  return `${datagram.sourcePort} -> ${datagram.destinationPort} Len=${datagram.payloadBytes}`;
}

/**
 * The UDP header as the inspector shows it, in wire order.
 *
 * The checksum reads `0x0000`, which is not a placeholder here but a legal on-wire
 * value: over IPv4 the UDP checksum is optional, and zero is how a sender says it did
 * not compute one. (Over IPv6 it is mandatory, which is one of the quieter differences
 * between the two.)
 */
export function buildUdpLayer(datagram: UdpDatagram): ProtocolLayer {
  return {
    layer: 'transport',
    protocol: 'UDP',
    fields: [
      {
        name: 'Source Port',
        value: String(datagram.sourcePort),
        bits: 16,
        note: 'Where a reply should go. With no connection to remember, this is all the state there is.',
      },
      { name: 'Destination Port', value: String(datagram.destinationPort), bits: 16 },
      {
        name: 'Length',
        value: String(udpLength(datagram)),
        bits: 16,
        note: `Header plus payload: ${UDP_HEADER_BYTES} + ${datagram.payloadBytes} bytes.`,
      },
      {
        name: 'Checksum',
        value: '0x0000',
        bits: 16,
        note: 'Optional over IPv4, where zero legally means "not computed". Mandatory over IPv6.',
      },
    ],
    ...(datagram.payloadPreview === undefined
      ? {}
      : { payloadPreview: datagram.payloadPreview }),
  };
}

/**
 * The innermost PDU: a UDP datagram, optionally wrapping an application layer.
 *
 * Hand the result to `encapsulateIpv4` and then `encapsulateEthernet` to build the full
 * stack, outermost header first.
 */
export function udpPdu(
  id: string,
  datagram: UdpDatagram,
  application?: ProtocolLayer,
): PDU {
  return {
    id,
    layers: application
      ? [buildUdpLayer(datagram), application]
      : [buildUdpLayer(datagram)],
    sizeBytes: udpLength(datagram),
    summary: `UDP ${describeUdpDatagram(datagram)}`,
  };
}
