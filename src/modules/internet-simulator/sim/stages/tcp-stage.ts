/**
 * Stage 4 -- one round trip, spent agreeing to talk.
 *
 * The sequence arithmetic and the state machine are `@/core/protocols/tcp`'s, unchanged.
 * What this stage adds is the observation that in a page load the handshake is *pure
 * latency*: three segments, none of them carrying a byte the user asked for, and the
 * client cannot send its request until the last of them is on its way. On fiber that is
 * 5 ms and nobody notices. On satellite it is 600 ms before a single request byte exists,
 * and it is the reason connection reuse, TLS 1.3, and QUIC all exist.
 *
 * Only the handshake happens here. The data segments belong to the HTTP stage and the
 * teardown never happens at all, because the connection stays open for the subresources --
 * which is itself the lesson: HTTP/1.1 made keep-alive the default precisely so this stage
 * would happen once per page instead of once per file.
 *
 * ## Modelling a connection that is never answered
 *
 * `core/tcp` deliberately splits *sending* a segment from *delivering* it, and documents
 * that a scenario wanting to drop something calls `sendSegment` and simply never calls
 * `deliverSegment`. That is exactly what the timeout case does here: the SYN is sent, the
 * server never receives it, and the client retransmits on a doubling timer (RFC 6298 s5.5)
 * until it gives up. The connection stays in `SYN_SENT` the whole time, which is what makes
 * the state readout worth watching.
 */

import {
  deliverSegment,
  describeTcpSegment,
  peerOf,
  openTcpConnection,
  sendSegment,
  tcpPdu,
  type TcpConnection,
  type TcpSegment,
} from '@/core/protocols/tcp/tcp';
import { EPHEMERAL_PORT_RANGE } from '@/core/net/ports';
import type { RfcRef, SimEvent } from '@/core/types/events';
import type { PDU } from '@/core/types/pdu';

import {
  BROWSER_NODE,
  linkId,
  requireState,
  round2,
  type StageContext,
  type Stage,
  type StageOutput,
} from '../stage';
import { firstHopNode } from '../topology';

/** How long a listening socket takes to accept and answer a SYN. */
export const ACCEPT_MS = 1;

/** The first retransmission timeout, doubled on every retry (RFC 6298 s5.5). */
export const DEFAULT_INITIAL_RTO_MS = 1000;

/** How many times a browser retransmits an unanswered SYN before giving up. */
export const DEFAULT_SYN_RETRIES = 3;

const RFC_9293: RfcRef = {
  rfc: 9293,
  section: '3.5',
  title: 'Transmission Control Protocol (TCP)',
};
const RFC_6298: RfcRef = {
  rfc: 6298,
  section: '5',
  title: 'Computing TCP’s Retransmission Timer',
};

/** One segment of the handshake, placed on the timeline. */
export interface TcpStep {
  readonly segment: TcpSegment;
  readonly from: string;
  readonly to: string;
  /** Local virtual millisecond it leaves. */
  readonly at: number;
  /** True when it never arrived. */
  readonly lost: boolean;
  readonly note: string;
}

/** What the TCP stage established. */
export interface TcpResult {
  /** Both ends, with their states and sequence variables as the handshake left them. */
  readonly connection: TcpConnection;
  readonly steps: readonly TcpStep[];
  readonly clientPort: number;
  readonly serverPort: number;
  /** The node the connection terminates at: the edge if there is one, else the origin. */
  readonly peerNode: string;
  /** The address the connection was made to. */
  readonly peerAddress: string;
  /** True when the connection came up. */
  readonly established: boolean;
  /** Virtual milliseconds spent purely getting permission to send anything. */
  readonly setupMs: number;
}

/** An ephemeral source port, drawn from the seeded stream so a run repeats. */
function ephemeralPort(context: StageContext): number {
  const span = EPHEMERAL_PORT_RANGE.last - EPHEMERAL_PORT_RANGE.first + 1;
  return EPHEMERAL_PORT_RANGE.first + context.rng.int(span);
}

/** Open the connection, or fail trying. */
export const tcpStage: Stage = (context): StageOutput => {
  const url = requireState(context.state, 'url', 'tcp');
  const dns = context.state.dns;
  const spec = context.scenario.tcp ?? {};
  const profile = context.profile;
  const oneWay = round2(profile.rttMs / 2);

  const peerNode = firstHopNode(context.scenario);
  const peerAddress =
    context.scenario.cdn?.address ?? dns?.addresses[0] ?? context.scenario.origin.address;

  const clientPort = ephemeralPort(context);
  const serverPort = url.port;

  let connection = openTcpConnection({
    clientPort,
    serverPort,
    // Fixed per run rather than unpredictable. A real stack must randomise these, because
    // a guessable ISN lets an off-path attacker inject data (RFC 6528); a simulation that
    // cannot be replayed cannot be tested.
    clientIsn: 100_000 + context.rng.int(900_000),
    serverIsn: 2_000_000 + context.rng.int(900_000),
  });

  const events: SimEvent[] = [
    {
      kind: 'phase',
      at: 0,
      id: 'tcp',
      title: 'Open the connection',
      description:
        'Three segments, one round trip, and not one byte the user asked for. Both ends agree they exist, agree where each other’s numbering starts, and only then may anything be sent.',
    },
    { kind: 'node-state', at: 0, nodeId: BROWSER_NODE, state: 'active' },
  ];
  const pdus: Record<string, PDU> = {};
  const steps: TcpStep[] = [];

  const link = linkId(BROWSER_NODE, peerNode);

  const emit = (
    id: string,
    segment: TcpSegment,
    from: string,
    to: string,
    at: number,
    lost: boolean,
    note: string,
  ): void => {
    const pdu = tcpPdu(id, segment);
    pdus[id] = pdu;
    events.push({ kind: 'pdu-created', at, pdu, atNode: from });
    events.push({
      kind: 'transmit',
      at,
      pduId: id,
      from,
      to,
      durationMs: oneWay,
      linkId: link,
    });
    if (lost) {
      events.push({
        kind: 'drop',
        at: round2(at + oneWay),
        pduId: id,
        atNode: to,
        reason:
          'Nothing answers on this address and port. The segment is discarded silently -- a filtered port gives no reply at all, which is why this fails by timeout rather than by refusal.',
      });
    }
    // Logged when the segment is *sent*, not when it lands: the log is the story of what
    // each end did, and the client's final ACK is the moment it considers itself connected
    // whether or not the ACK has arrived yet.
    events.push({
      kind: 'log',
      at,
      level: lost ? 'warn' : 'info',
      text: `${describeTcpSegment(segment)} -- ${note}`,
    });
    steps.push({ segment, from, to, at, lost, note });
  };

  // --- The connection that is never answered ---------------------------------
  if (spec.blackholed) {
    const retries = spec.synRetries ?? DEFAULT_SYN_RETRIES;
    const initialRto = spec.initialRtoMs ?? DEFAULT_INITIAL_RTO_MS;

    const sent = sendSegment(connection, 'client', { syn: true });
    connection = sent.connection;

    let clock = 0;
    emit(
      'tcp-syn-0',
      sent.segment,
      BROWSER_NODE,
      peerNode,
      clock,
      true,
      'SYN sent. The client is now in SYN_SENT and will stay there until something answers or the timer runs out.',
    );
    events.push({
      kind: 'annotate',
      at: 0,
      targetId: BROWSER_NODE,
      text: 'A refused connection answers with RST and fails instantly. A *filtered* one answers with nothing at all, so the client has no way to tell "wrong port" from "still in flight" and must wait out the timer. That is why this takes seconds while a refusal takes milliseconds.',
      reference: RFC_9293,
    });

    let rto = initialRto;
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      clock = round2(clock + rto);
      // The retransmission carries the numbers the original carried; `sndNxt` does not
      // move again, which is exactly what makes it a duplicate rather than new data.
      emit(
        `tcp-syn-${attempt}`,
        sent.segment,
        BROWSER_NODE,
        peerNode,
        clock,
        true,
        `Retransmission ${attempt} of ${retries}, after waiting ${rto} ms. Same sequence number, same segment -- and the timer doubles again.`,
      );
      rto *= 2;
    }
    clock = round2(clock + rto);

    events.push({ kind: 'node-state', at: clock, nodeId: BROWSER_NODE, state: 'error' });
    events.push({
      kind: 'log',
      at: clock,
      level: 'error',
      text: `Gave up after ${retries + 1} SYNs and ${clock} ms with no reply.`,
    });

    return {
      events,
      pdus,
      durationMs: clock,
      summary: `No answer after ${retries + 1} SYNs`,
      state: {
        tcp: {
          connection,
          steps,
          clientPort,
          serverPort,
          peerNode,
          peerAddress,
          established: false,
          setupMs: clock,
        },
      },
      failure: {
        code: 'ERR_CONNECTION_TIMED_OUT',
        title: 'This site can’t be reached',
        message: `${url.host} took too long to respond.`,
        explanation: `DNS worked: there is an address, and it is ${peerAddress}. What failed is the connection to it. The browser sent a SYN and then retransmitted it ${retries} more times on a timer that doubles each attempt -- ${initialRto} ms, ${initialRto * 2} ms, ${initialRto * 4} ms -- and nothing ever came back. Silence is the signature of a packet filter: a host that is up but refusing would send RST and the failure would be instant. Because nothing was ever established, TLS, HTTP, and the CDN never got a turn.`,
        reference: RFC_6298,
      },
    };
  }

  // --- The three-way handshake -----------------------------------------------
  const syn = sendSegment(connection, 'client', { syn: true });
  connection = deliverSegment(syn.connection, peerOf('client'), syn.segment).connection;
  emit(
    'tcp-syn',
    syn.segment,
    BROWSER_NODE,
    peerNode,
    0,
    false,
    `SYN with the client's initial sequence number. The SYN itself consumes one sequence number, which is why the reply acknowledges ISN + 1.`,
  );

  const synAckAt = round2(oneWay + ACCEPT_MS);
  const synAck = sendSegment(connection, 'server', { syn: true, ack: true });
  connection = deliverSegment(
    synAck.connection,
    peerOf('server'),
    synAck.segment,
  ).connection;
  emit(
    'tcp-syn-ack',
    synAck.segment,
    peerNode,
    BROWSER_NODE,
    synAckAt,
    false,
    'SYN-ACK: the server accepts, and sends its own independent starting number in the same segment. Two directions, numbered separately.',
  );

  const ackAt = round2(profile.rttMs + ACCEPT_MS);
  const ack = sendSegment(connection, 'client', { ack: true });
  connection = deliverSegment(ack.connection, peerOf('client'), ack.segment).connection;
  emit(
    'tcp-ack',
    ack.segment,
    BROWSER_NODE,
    peerNode,
    ackAt,
    false,
    'A pure ACK. The client is ESTABLISHED the moment it sends this, so it does not wait for the ACK to arrive before sending the request behind it.',
  );

  const setupMs = ackAt;

  events.push({
    kind: 'annotate',
    at: synAckAt,
    targetId: peerNode,
    text: `One round trip -- ${profile.rttMs} ms on this link -- and nothing has been asked for yet. Everything a browser does to avoid opening a second connection is an attempt to avoid paying this again.`,
    reference: RFC_9293,
  });
  events.push({
    kind: 'log',
    at: setupMs,
    level: 'info',
    text: `Connection established: ${peerAddress}:${serverPort} from port ${clientPort}. Client ESTABLISHED at ${setupMs} ms.`,
  });

  return {
    events,
    pdus,
    durationMs: setupMs,
    summary: `${profile.rttMs} ms handshake to ${peerAddress}:${serverPort}`,
    state: {
      tcp: {
        connection,
        steps,
        clientPort,
        serverPort,
        peerNode,
        peerAddress,
        established: true,
        setupMs,
      },
    },
  };
};
