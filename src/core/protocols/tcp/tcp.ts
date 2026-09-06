/**
 * TCP -- the connection, and the arithmetic that makes it reliable.
 *
 * The one thing this file has to be right about is **sequence and acknowledgement
 * numbers**, because every other property of TCP falls out of them. A learner who can
 * see that the server's `Ack` is exactly the client's `Seq` plus the bytes it sent has
 * understood ordering, duplicate detection, and retransmission all at once. A learner
 * shown round numbers that nearly add up has understood nothing.
 *
 * ## The model
 *
 * Sending and receiving are **separate operations** ({@link sendSegment},
 * {@link deliverSegment}) rather than one atomic exchange, and that split is the whole
 * design. It is what makes loss expressible: a dropped segment is one that was sent and
 * never delivered. The sender's `sndNxt` has moved on, the receiver's `rcvNxt` has not,
 * and the gap between them is exactly what the retransmission timer exists to close.
 * The lossy-link scenario needs nothing more than "call send, skip deliver".
 *
 * {@link transmitSegment} is the two together, for the ordinary case where nothing is
 * lost, and {@link tcpExchange} composes a whole conversation out of it.
 *
 * ## What is not modelled
 *
 * Congestion control, selective acknowledgement, timestamps, and window scaling. The
 * window is a constant. This module is about what the numbers in the header mean, not
 * about how fast a real stack would go.
 */

import { toHex } from '@/core/net/bytes';
import type { PDU, ProtocolLayer } from '@/core/types/pdu';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** A TCP header with no options: five 32-bit words. */
export const TCP_HEADER_BYTES = 20;

/** The sequence space is 32 bits wide and wraps. */
export const TCP_SEQ_SPACE = 0x1_0000_0000;

/**
 * The usual maximum segment size on Ethernet: 1500 (MTU) - 20 (IPv4) - 20 (TCP).
 *
 * MSS is negotiated at handshake time precisely so that TCP hands IP something that
 * fits, and IPv4 fragmentation never has to happen for a TCP connection on a
 * well-behaved path.
 */
export const DEFAULT_MSS = 1460;

/** A plain, unscaled receive window. Constant here -- see the file note. */
export const DEFAULT_WINDOW = 64240;

// ---------------------------------------------------------------------------
// Sequence arithmetic
// ---------------------------------------------------------------------------

/**
 * Add to a sequence number, wrapping at 2^32 the way the wire does.
 *
 * Not a nicety: a connection that transfers a few gigabytes wraps for real, and the
 * arithmetic being modular is why TCP compares sequence numbers by signed difference
 * rather than by `<`.
 */
export function seqAdd(seq: number, delta: number): number {
  return (seq + delta) % TCP_SEQ_SPACE;
}

/**
 * The six control bits this simulation uses, in wire order.
 *
 * A real header has nine (NS, CWR, and ECE carry explicit congestion notification);
 * they are omitted because nothing here models congestion.
 */
export interface TcpFlags {
  readonly urg?: boolean;
  readonly ack?: boolean;
  readonly psh?: boolean;
  readonly rst?: boolean;
  readonly syn?: boolean;
  readonly fin?: boolean;
}

/** One TCP segment: the header fields that matter, plus how much data it carries. */
export interface TcpSegment {
  readonly sourcePort: number;
  readonly destinationPort: number;
  /** Sequence number of the first byte of data (or of the SYN/FIN, which each take one). */
  readonly seq: number;
  /** Next sequence number expected from the peer. Meaningless unless the ACK flag is set. */
  readonly ack: number;
  readonly flags: TcpFlags;
  /** Bytes the receiver is willing to accept beyond `ack`. */
  readonly windowSize: number;
  /** Application bytes carried. Zero for a pure ACK, a SYN, or a FIN. */
  readonly payloadBytes: number;
  /** A short excerpt of the application data, for the inspector. Display only. */
  readonly payloadPreview?: string;
}

/**
 * How much of the sequence space this segment consumes.
 *
 * The rule that surprises everyone: **SYN and FIN each occupy one sequence number**
 * even though they carry no data. That is why the ACK of a SYN is `ISN + 1`, and why a
 * FIN is acknowledged with one more than the last data byte.
 */
export function segmentLength(segment: TcpSegment): number {
  return segment.payloadBytes + (segment.flags.syn ? 1 : 0) + (segment.flags.fin ? 1 : 0);
}

/** The sequence number the sender will use next -- and the `Ack` the peer will reply with. */
export function nextSeq(segment: TcpSegment): number {
  return seqAdd(segment.seq, segmentLength(segment));
}

/** The control bits as one number, the way a capture shows `[SYN, ACK] (0x012)`. */
export function tcpFlagBits(flags: TcpFlags): number {
  return (
    (flags.fin ? 0x001 : 0) |
    (flags.syn ? 0x002 : 0) |
    (flags.rst ? 0x004 : 0) |
    (flags.psh ? 0x008 : 0) |
    (flags.ack ? 0x010 : 0) |
    (flags.urg ? 0x020 : 0)
  );
}

/**
 * `'SYN, ACK'`, `'PSH, ACK'`, `'FIN, ACK'`, or `'none'`.
 *
 * Listed in ascending bit order, which is the order a packet analyser prints them --
 * so a learner reading the inspector beside a real capture sees the same strings.
 */
export function formatTcpFlags(flags: TcpFlags): string {
  const set: string[] = [];
  if (flags.fin) set.push('FIN');
  if (flags.syn) set.push('SYN');
  if (flags.rst) set.push('RST');
  if (flags.psh) set.push('PSH');
  if (flags.ack) set.push('ACK');
  if (flags.urg) set.push('URG');
  return set.length > 0 ? set.join(', ') : 'none';
}

/** `'49152 -> 443 [SYN] Seq=1000 Win=64240 Len=0'` -- the tcpdump one-liner. */
export function describeTcpSegment(segment: TcpSegment): string {
  const ack = segment.flags.ack ? ` Ack=${segment.ack}` : '';
  return (
    `${segment.sourcePort} -> ${segment.destinationPort} ` +
    `[${formatTcpFlags(segment.flags)}] Seq=${segment.seq}${ack} ` +
    `Win=${segment.windowSize} Len=${segment.payloadBytes}`
  );
}

/**
 * Split a payload into MSS-sized chunks.
 *
 * A stream is not a message: 4000 bytes handed to a socket leaves as three segments,
 * and the receiver has no way to tell where the original write boundaries were. That is
 * the difference between TCP and UDP in one function.
 */
export function splitForMss(bytes: number, mss: number = DEFAULT_MSS): number[] {
  if (!Number.isInteger(mss) || mss <= 0) {
    throw new RangeError(`MSS must be a positive integer, got ${mss}`);
  }
  if (bytes <= 0) {
    return [];
  }
  const chunks: number[] = [];
  for (let sent = 0; sent < bytes; sent += mss) {
    chunks.push(Math.min(mss, bytes - sent));
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Connection state
// ---------------------------------------------------------------------------

/**
 * The states of the TCP state machine this module walks through.
 *
 * Shown as a label on each endpoint in the UI, because "the client is in `FIN_WAIT_2`"
 * explains a half-closed connection far better than any prose can.
 */
export type TcpState =
  | 'CLOSED'
  | 'LISTEN'
  | 'SYN_SENT'
  | 'SYN_RECEIVED'
  | 'ESTABLISHED'
  | 'FIN_WAIT_1'
  | 'FIN_WAIT_2'
  | 'CLOSING'
  | 'CLOSE_WAIT'
  | 'LAST_ACK'
  | 'TIME_WAIT';

/** Which end of the connection. The two are not symmetric: one opens, one listens. */
export type TcpRole = 'client' | 'server';

/** One end of a connection: its state and its four sequence variables. */
export interface TcpEndpoint {
  readonly state: TcpState;
  readonly port: number;
  /** Initial send sequence number. Random in a real stack; fixed here so runs repeat. */
  readonly iss: number;
  /** Next sequence number this end will send. */
  readonly sndNxt: number;
  /** Oldest sequence number sent but not yet acknowledged. `sndNxt` when all is caught up. */
  readonly sndUna: number;
  /** Next sequence number this end expects to receive -- what it puts in its `Ack`. */
  readonly rcvNxt: number;
  /** How much this end is willing to receive beyond `rcvNxt`. */
  readonly window: number;
}

/** Both ends, tracked together so the arithmetic can be checked from either side. */
export interface TcpConnection {
  readonly client: TcpEndpoint;
  readonly server: TcpEndpoint;
}

/** What {@link openTcpConnection} needs to know. */
export interface TcpConnectionInit {
  clientPort: number;
  serverPort: number;
  /** The client's initial sequence number. Fixed per scenario -- determinism. */
  clientIsn: number;
  /** The server's initial sequence number. Independent of the client's, and different. */
  serverIsn: number;
  window?: number;
}

/**
 * A connection before anything has been sent: the client `CLOSED`, the server `LISTEN`.
 *
 * The two initial sequence numbers are independent and are chosen by each end for
 * itself. In a real stack they are unpredictable on purpose -- a guessable ISN lets an
 * off-path attacker inject data into somebody else's connection (RFC 6528). Here they
 * are given by the scenario, because a simulation that cannot be replayed byte for byte
 * cannot be tested.
 */
export function openTcpConnection(init: TcpConnectionInit): TcpConnection {
  const window = init.window ?? DEFAULT_WINDOW;
  return {
    client: {
      state: 'CLOSED',
      port: init.clientPort,
      iss: init.clientIsn,
      sndNxt: init.clientIsn,
      sndUna: init.clientIsn,
      rcvNxt: 0,
      window,
    },
    server: {
      state: 'LISTEN',
      port: init.serverPort,
      iss: init.serverIsn,
      sndNxt: init.serverIsn,
      sndUna: init.serverIsn,
      rcvNxt: 0,
      window,
    },
  };
}

/** The other end. */
export function peerOf(role: TcpRole): TcpRole {
  return role === 'client' ? 'server' : 'client';
}

/** What a caller wants to send; the sequence numbers are worked out from the state. */
export interface TcpSendSpec {
  syn?: boolean;
  ack?: boolean;
  fin?: boolean;
  rst?: boolean;
  psh?: boolean;
  /** Application bytes to put in this segment. */
  bytes?: number;
  /** A short excerpt for the inspector. */
  preview?: string;
}

/** A segment leaving one end, and the connection with that end's state advanced. */
export interface TcpSendResult {
  readonly connection: TcpConnection;
  readonly segment: TcpSegment;
}

/**
 * Put a segment on the wire.
 *
 * The sender fills `Seq` from its own `sndNxt` and `Ack` from its own `rcvNxt` -- it
 * never has to be told either -- then advances `sndNxt` by the sequence space the
 * segment consumes. Nothing about the receiver changes: as far as this function is
 * concerned the segment may yet be lost. That is {@link deliverSegment}'s business.
 */
export function sendSegment(
  connection: TcpConnection,
  from: TcpRole,
  spec: TcpSendSpec,
): TcpSendResult {
  const sender = connection[from];
  const flags: TcpFlags = {
    syn: spec.syn ?? false,
    ack: spec.ack ?? false,
    fin: spec.fin ?? false,
    rst: spec.rst ?? false,
    psh: spec.psh ?? false,
  };

  const segment: TcpSegment = {
    sourcePort: sender.port,
    destinationPort: connection[peerOf(from)].port,
    seq: sender.sndNxt,
    // A segment with no ACK flag carries no meaningful acknowledgement; a real stack
    // leaves the field as whatever it was, and a capture shows it as ignorable.
    ack: flags.ack ? sender.rcvNxt : 0,
    flags,
    windowSize: sender.window,
    payloadBytes: spec.bytes ?? 0,
    ...(spec.preview === undefined ? {} : { payloadPreview: spec.preview }),
  };

  const advanced: TcpEndpoint = {
    ...sender,
    sndNxt: nextSeq(segment),
    state: stateAfterSend(sender.state, flags),
  };

  return { connection: withEndpoint(connection, from, advanced), segment };
}

/**
 * Hand a segment to the end it was addressed to.
 *
 * Two things happen here and nowhere else:
 *
 * - `rcvNxt` advances past the segment, **but only if it arrived in order**. A
 *   retransmission of something already received is a duplicate: the receiver
 *   re-acknowledges the same number and consumes nothing, which is why calling this
 *   twice with the same segment is safe and is exactly what the lossy scenario relies on.
 * - `sndUna` advances to the incoming `Ack`, which is how the sender learns its data
 *   arrived and may stop holding it for retransmission.
 */
export function deliverSegment(
  connection: TcpConnection,
  to: TcpRole,
  segment: TcpSegment,
): { connection: TcpConnection; accepted: boolean } {
  const receiver = connection[to];

  // The very first segment of a connection establishes where the peer's sequence space
  // starts, so there is nothing to compare against yet.
  const isInitialSyn = Boolean(segment.flags.syn) && receiver.rcvNxt === 0;
  const inOrder = isInitialSyn || segment.seq === receiver.rcvNxt;

  const rcvNxt = inOrder ? nextSeq(segment) : receiver.rcvNxt;
  const sndUna =
    segment.flags.ack && aheadOf(segment.ack, receiver.sndUna)
      ? segment.ack
      : receiver.sndUna;

  const updated: TcpEndpoint = {
    ...receiver,
    rcvNxt,
    sndUna,
    state: stateAfterReceive(receiver, segment, inOrder),
  };

  return { connection: withEndpoint(connection, to, updated), accepted: inOrder };
}

/**
 * Send and deliver in one step: the ordinary, nothing-was-lost path.
 *
 * A scenario that wants to drop this segment calls {@link sendSegment} on its own and
 * simply never calls {@link deliverSegment} -- then calls it later with the same
 * segment to model the retransmission.
 */
export function transmitSegment(
  connection: TcpConnection,
  from: TcpRole,
  spec: TcpSendSpec,
): TcpSendResult {
  const sent = sendSegment(connection, from, spec);
  const delivered = deliverSegment(sent.connection, peerOf(from), sent.segment);
  return { connection: delivered.connection, segment: sent.segment };
}

/**
 * Retransmit a segment that was already sent.
 *
 * The sequence number is **not** re-derived: a retransmission carries the numbers the
 * original carried, which is the whole reason the receiver can recognise it as a
 * duplicate rather than as new data. `sndNxt` does not move again either -- it already
 * counted these bytes the first time.
 */
export function retransmitSegment(
  connection: TcpConnection,
  from: TcpRole,
  segment: TcpSegment,
): { connection: TcpConnection; segment: TcpSegment } {
  const delivered = deliverSegment(connection, peerOf(from), segment);
  return { connection: delivered.connection, segment };
}

function withEndpoint(
  connection: TcpConnection,
  role: TcpRole,
  endpoint: TcpEndpoint,
): TcpConnection {
  return role === 'client'
    ? { ...connection, client: endpoint }
    : { ...connection, server: endpoint };
}

/** True if `a` is later than `b` in the wrapping sequence space (RFC 793's comparison). */
function aheadOf(a: number, b: number): boolean {
  return (a - b + TCP_SEQ_SPACE) % TCP_SEQ_SPACE < TCP_SEQ_SPACE / 2 && a !== b;
}

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

function stateAfterSend(state: TcpState, flags: TcpFlags): TcpState {
  if (flags.rst) {
    return 'CLOSED';
  }
  if (flags.syn && !flags.ack && state === 'CLOSED') {
    return 'SYN_SENT';
  }
  if (flags.syn && flags.ack && state === 'LISTEN') {
    return 'SYN_RECEIVED';
  }
  if (flags.fin) {
    // An active close from ESTABLISHED, or the passive closer answering a FIN it
    // already acknowledged. These are the two halves of the four-way teardown.
    if (state === 'ESTABLISHED') return 'FIN_WAIT_1';
    if (state === 'CLOSE_WAIT') return 'LAST_ACK';
  }
  return state;
}

function stateAfterReceive(
  receiver: TcpEndpoint,
  segment: TcpSegment,
  inOrder: boolean,
): TcpState {
  if (segment.flags.rst) {
    return 'CLOSED';
  }
  if (!inOrder) {
    // A duplicate or out-of-order segment changes no state; the receiver just
    // re-acknowledges what it has.
    return receiver.state;
  }

  const acksOurLast = Boolean(segment.flags.ack) && segment.ack === receiver.sndNxt;

  switch (receiver.state) {
    case 'SYN_SENT':
      // SYN-ACK: the client is open for business and only has to confirm it.
      return segment.flags.syn && segment.flags.ack ? 'ESTABLISHED' : receiver.state;
    case 'SYN_RECEIVED':
      return acksOurLast ? 'ESTABLISHED' : receiver.state;
    case 'ESTABLISHED':
      // The peer is done sending. This end may still have data to send, which is the
      // half-open state CLOSE_WAIT exists to represent.
      return segment.flags.fin ? 'CLOSE_WAIT' : receiver.state;
    case 'FIN_WAIT_1':
      if (segment.flags.fin) return acksOurLast ? 'TIME_WAIT' : 'CLOSING';
      return acksOurLast ? 'FIN_WAIT_2' : receiver.state;
    case 'FIN_WAIT_2':
      return segment.flags.fin ? 'TIME_WAIT' : receiver.state;
    case 'CLOSING':
      return acksOurLast ? 'TIME_WAIT' : receiver.state;
    case 'LAST_ACK':
      return acksOurLast ? 'CLOSED' : receiver.state;
    default:
      return receiver.state;
  }
}

// ---------------------------------------------------------------------------
// A whole conversation
// ---------------------------------------------------------------------------

/** One application write, from one end. */
export interface TcpPayload {
  readonly from: TcpRole;
  readonly bytes: number;
  readonly preview?: string;
}

/** What {@link tcpExchange} needs. */
export interface TcpExchangeOptions extends TcpConnectionInit {
  /** The application writes, in order. Each is segmented to `mss` and acknowledged. */
  readonly payloads: readonly TcpPayload[];
  /** Bytes per data segment. Defaults to the Ethernet-derived 1460. */
  readonly mss?: number;
  /** Which end sends the first FIN. Defaults to the client. */
  readonly closedBy?: TcpRole;
}

/** One segment in the conversation, with both endpoints' states at that moment. */
export interface TcpExchangeStep {
  readonly from: TcpRole;
  readonly segment: TcpSegment;
  readonly clientState: TcpState;
  readonly serverState: TcpState;
  /** One line of commentary for the event log. */
  readonly note: string;
}

/** The whole conversation, and the connection as it ends up. */
export interface TcpExchange {
  readonly steps: readonly TcpExchangeStep[];
  readonly connection: TcpConnection;
}

/**
 * Open a connection, move some data, and close it -- the complete life of a TCP flow.
 *
 * Three-way handshake, then each payload segmented and acknowledged, then the four-way
 * teardown. Every number is derived from the one before it, so the resulting `steps`
 * are an arithmetically consistent conversation rather than a plausible-looking script,
 * and two calls with the same options produce deep-equal output.
 */
export function tcpExchange(options: TcpExchangeOptions): TcpExchange {
  const mss = options.mss ?? DEFAULT_MSS;
  const closedBy = options.closedBy ?? 'client';
  const steps: TcpExchangeStep[] = [];
  let connection = openTcpConnection(options);

  const record = (from: TcpRole, spec: TcpSendSpec, note: string): void => {
    const result = transmitSegment(connection, from, spec);
    connection = result.connection;
    steps.push({
      from,
      segment: result.segment,
      clientState: connection.client.state,
      serverState: connection.server.state,
      note,
    });
  };

  // --- Three-way handshake ---------------------------------------------------
  record(
    'client',
    { syn: true },
    `Client opens: SYN, Seq = its ISN ${options.clientIsn}. The SYN itself takes one sequence number.`,
  );
  record(
    'server',
    { syn: true, ack: true },
    `Server agrees: SYN with its own ISN ${options.serverIsn}, and Ack = ${seqAdd(options.clientIsn, 1)} -- the client's ISN plus one.`,
  );
  record(
    'client',
    { ack: true },
    'Client confirms with a pure ACK. Both ends are ESTABLISHED and the handshake cost one round trip.',
  );

  // --- Data ------------------------------------------------------------------
  for (const payload of options.payloads) {
    const chunks = splitForMss(payload.bytes, mss);
    chunks.forEach((bytes, index) => {
      const last = index === chunks.length - 1;
      record(
        payload.from,
        {
          ack: true,
          psh: last,
          bytes,
          ...(payload.preview === undefined || index > 0
            ? {}
            : { preview: payload.preview }),
        },
        chunks.length > 1
          ? `${cap(payload.from)} sends ${bytes} bytes (segment ${index + 1} of ${chunks.length}; the ${payload.bytes}-byte write does not fit one MSS).`
          : `${cap(payload.from)} sends ${bytes} bytes of application data.`,
      );
      record(
        peerOf(payload.from),
        { ack: true },
        `${cap(peerOf(payload.from))} acknowledges: Ack is the sender's Seq plus the ${bytes} bytes it just received.`,
      );
    });
  }

  // --- Four-way teardown -----------------------------------------------------
  const other = peerOf(closedBy);
  record(
    closedBy,
    { fin: true, ack: true },
    `${cap(closedBy)} has nothing more to send: FIN. Like a SYN, it takes one sequence number.`,
  );
  record(
    other,
    { ack: true },
    `${cap(other)} acknowledges the FIN. The connection is now half-closed -- ${other} may still send.`,
  );
  record(
    other,
    { fin: true, ack: true },
    `${cap(other)} is done too, and sends its own FIN. Each direction is closed separately, which is why teardown takes four segments and the handshake took three.`,
  );
  record(
    closedBy,
    { ack: true },
    `${cap(closedBy)} acknowledges and waits in TIME_WAIT, long enough that a straggling duplicate cannot be mistaken for part of the next connection.`,
  );

  return { steps, connection };
}

function cap(role: TcpRole): string {
  return role === 'client' ? 'Client' : 'Server';
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * The TCP header as the inspector shows it, in wire order.
 *
 * The checksum reads `0x0000 (not modelled)` on purpose. It covers a pseudo-header plus
 * every byte of payload, and this simulation models payload *lengths* rather than
 * payload bytes -- so a value here would be a decoration, not a checksum. The IPv4
 * header checksum, which covers only fields that do exist here, is computed for real
 * (`ipv4.ts`).
 */
export function buildTcpLayer(segment: TcpSegment): ProtocolLayer {
  const fields = [
    {
      name: 'Source Port',
      value: String(segment.sourcePort),
      bits: 16,
      note: 'Chosen by the client from the ephemeral range. Together with the four other tuple members it identifies this connection.',
    },
    { name: 'Destination Port', value: String(segment.destinationPort), bits: 16 },
    {
      name: 'Sequence Number',
      value: String(segment.seq),
      bits: 32,
      note: 'The position of this segment in the byte stream. SYN and FIN each occupy one number even though they carry no data.',
    },
    {
      name: 'Acknowledgement Number',
      value: segment.flags.ack ? String(segment.ack) : '0 (ignored, ACK not set)',
      bits: 32,
      note: 'The next byte expected from the other end -- which is also confirmation that everything before it arrived.',
    },
    {
      name: 'Data Offset',
      value: `${TCP_HEADER_BYTES / 4} (${TCP_HEADER_BYTES} bytes)`,
      bits: 4,
    },
    {
      name: 'Flags',
      value: `${formatTcpFlags(segment.flags)} (${toHex(tcpFlagBits(segment.flags), { bits: 12 })})`,
      bits: 9,
    },
    {
      name: 'Window Size',
      value: String(segment.windowSize),
      bits: 16,
      note: 'How much more the sender of this segment can receive. Flow control: the receiver, not the sender, sets the pace.',
    },
    {
      name: 'Checksum',
      value: '0x0000 (not modelled)',
      bits: 16,
      note: 'A real TCP checksum covers a pseudo-header and every payload byte. This simulation models segment sizes rather than payload bytes, so it is left uncomputed rather than faked.',
    },
    { name: 'Urgent Pointer', value: '0', bits: 16 },
  ];

  return {
    layer: 'transport',
    protocol: 'TCP',
    fields,
    ...(segment.payloadPreview === undefined
      ? {}
      : { payloadPreview: segment.payloadPreview }),
  };
}

/**
 * The innermost PDU: a TCP segment, optionally wrapping an application layer.
 *
 * The starting point for encapsulation -- hand the result to `encapsulateIpv4` and then
 * `encapsulateEthernet` and the stack reads `[Ethernet, IPv4, TCP, HTTP]`, outermost
 * first, exactly as it does on the wire.
 */
export function tcpPdu(
  id: string,
  segment: TcpSegment,
  application?: ProtocolLayer,
): PDU {
  return {
    id,
    layers: application
      ? [buildTcpLayer(segment), application]
      : [buildTcpLayer(segment)],
    sizeBytes: TCP_HEADER_BYTES + segment.payloadBytes,
    summary: `TCP ${describeTcpSegment(segment)}`,
  };
}
