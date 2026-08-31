/**
 * PDU -- the "what is on the wire" half of the domain model.
 *
 * A *protocol data unit* is whatever one layer hands to the layer below it: a frame at
 * the link layer, a packet at the network layer, a segment at the transport layer, a
 * message at the application layer. They are the same object seen from different
 * depths, which is why one type models all of them.
 *
 * The important design choice here is that **encapsulation is explicit**. A PDU is not
 * an opaque blob with a label; it is an ordered stack of layers, each with its real
 * named header fields. That is what lets Packet Journey show a TCP segment being
 * wrapped in an IPv4 header and then an Ethernet frame, and show a router stripping the
 * frame off again -- rather than just animating a dot along a line.
 */

/**
 * Which layer of the stack a header belongs to.
 *
 * A deliberately coarse five-name model (closer to the TCP/IP stack than to the seven
 * OSI layers) because those are the boundaries a packet actually crosses in these
 * simulations:
 *
 * - `link` -- Ethernet, Wi-Fi. Addresses one hop, rewritten at every hop.
 * - `network` -- IPv4, IPv6, ICMP. Addresses end to end, survives every hop.
 * - `transport` -- TCP, UDP, QUIC. Ports, ordering, reliability.
 * - `session` -- TLS records. Sits between transport and application.
 * - `application` -- DNS, HTTP, WebSocket. What the user actually asked for.
 */
export type LayerKey = 'link' | 'network' | 'transport' | 'session' | 'application';

/**
 * One named field inside a protocol header.
 *
 * These are the real fields from the RFC, not a paraphrase -- `TTL`, `Flags`,
 * `Window Size`, `SNI` -- because the inspector is where a learner connects the
 * animation to the specification.
 */
export interface HeaderField {
  /** The field's name as the specification writes it, e.g. `'TTL'`. */
  name: string;
  /**
   * The field's value, already rendered for display, e.g. `'64'`, `'0x8000'`,
   * `'SYN, ACK'`. A string rather than a number so flags, addresses, and enumerations
   * can all be shown the way a packet analyser would show them.
   */
  value: string;
  /**
   * Width of the field in bits, e.g. `8` for IPv4 TTL, `16` for a port. Lets the UI
   * draw a to-scale header diagram and teaches why fields have the ranges they do.
   */
  bits?: number;
  /** One short sentence explaining what the field is for, shown on hover. */
  note?: string;
}

/**
 * One protocol header in the encapsulation stack, plus whatever it is carrying.
 */
export interface ProtocolLayer {
  /** Which layer of the stack this header sits at. */
  layer: LayerKey;
  /**
   * The concrete protocol and version, as a packet analyser would name it:
   * `'Ethernet'`, `'IPv4'`, `'TCP'`, `'TLS'`, `'HTTP/1.1'`.
   */
  protocol: string;
  /** The header's fields, in wire order (the order they appear in the packet). */
  fields: HeaderField[];
  /**
   * A short, human-readable excerpt of this layer's payload, e.g. the first request
   * line of an HTTP message. Display only -- truncate it; a PDU is not a byte buffer.
   */
  payloadPreview?: string;
}

/**
 * A single unit of data travelling across the topology.
 *
 * `layers` is ordered **outermost first**: index 0 is the header a receiving NIC reads
 * first, and the last entry is the innermost payload. Encapsulating pushes onto the
 * front of that list; decapsulating pops from the front. So a browser request on the
 * wire reads `[Ethernet, IPv4, TCP, TLS, HTTP/1.1]`.
 */
export interface PDU {
  /**
   * Stable identifier for this unit of data. Events reference PDUs by id rather than
   * by value, so one packet can be followed across every hop of its journey, and a
   * transform (NAT rewrite, TTL decrement) keeps the same id while the contents change.
   */
  id: string;
  /** The encapsulation stack, outermost header first, innermost payload last. */
  layers: ProtocolLayer[];
  /**
   * Total size on the wire in bytes, headers included. Drives serialization delay
   * (`sizeBytes * 8 / bandwidthMbps`) and makes MTU and fragmentation demonstrable.
   */
  sizeBytes: number;
  /**
   * One-line description in packet-analyser style, e.g. `'TCP SYN 49152 -> 443'`.
   * This is the label on the animated packet and the row text in the event log.
   */
  summary: string;
}
