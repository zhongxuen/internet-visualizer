/**
 * The one-way bridge from the protocol logic to something that can be drawn.
 *
 * Everything in `sim/` next to this file is a pure function of its arguments and knows
 * nothing about React, a canvas, or a clock. This file is where a *scenario* -- a declared
 * list of things that happen -- becomes a `SimResult`: an ordered event stream on a virtual
 * millisecond clock, a topology to draw it on, and the PDUs the inspector opens.
 *
 * The arrow points one way. `frames.ts` does not import this file, and nothing here decides
 * what anything looks like; it decides *when* things happen and *what* they are. That split
 * is the rule this whole project is arranged around, and a WebSocket module is where it pays
 * best -- the frame layout is a fact about RFC 6455 and belongs in a unit test, while
 * "the pong comes back 40 ms later" is a fact about a wire and belongs on a timeline.
 *
 * ## Why the state machine runs both endpoints
 *
 * A WebSocket after the handshake has no request/response pairing at all: two independent
 * streams that happen to share a TCP connection. Modelling it as a list of "exchanges" the
 * way the HTTP modules do would be a lie about the protocol.
 *
 * So this file keeps two `ConnectionState`s, one per endpoint, and pushes every frame
 * through `lifecycle.step` on both sides -- as a `send` at the origin and a `receive` at the
 * destination. The obligations then fall out rather than being scripted: a ping produces a
 * pong because `stepReceive` says it must, a Close produces an echoing Close for the same
 * reason, and a scenario that forgot to write them down still gets them. What a scenario
 * declares is only what an *application* chooses to do.
 *
 * The one adjustment this file makes to an automatic reply is masking. `lifecycle.ts`
 * produces the obligated frame without a masking key, because it does not know which side it
 * is running on; a reply leaving the client is re-framed here with a fresh key from
 * `maskingKeyFrom`. That is the correct place for it -- masking is a property of the
 * direction a frame travels, and this is the file that knows the direction.
 *
 * ## Why there is a proxy in the middle
 *
 * Every topology here is `client -- proxy -- server`, and the proxy is not decoration. It is
 * the machine the whole masking rule exists because of: a transparent intermediary that
 * routed the handshake as ordinary HTTP, never understood the `101`, and keeps trying to
 * parse what flows past it. Drawing it makes "why is the client masked and the server not"
 * a question with a visible answer instead of a paragraph.
 *
 * Simulated only. Every address is from the RFC 5737 documentation ranges, every host name
 * is under a TLD RFC 2606 reserves, and there is no `fetch` and no `WebSocket` anywhere in
 * this module.
 */

import { bytesToHex } from '@/core/net/bytes';
import { summarizePhases, type SimResult } from '@/core/sim/result';
import type { RfcRef, SimEvent } from '@/core/types/events';
import type { HeaderField, PDU, ProtocolLayer } from '@/core/types/pdu';
import type { SimLink, SimNode, Topology } from '@/core/types/topology';

import {
  compareTransports,
  type ComparisonOptions,
  type TransportComparison,
} from './comparison';
import { utf8Bytes } from './digest';
import {
  binaryFrame,
  encodeFrame,
  fragmentMessage,
  frameBytes,
  frameLayout,
  frameText,
  headerBytes,
  isControlOpcode,
  maskingKeyFrom,
  pingFrame,
  textFrame,
  type Direction,
  type FrameLayout,
  type MaskingKey,
  type WebSocketFrame,
} from './frames';
import {
  backoffSchedule,
  closeFrame,
  connectingConnection,
  explainBackoff,
  parseClosePayload,
  simulateKeepalive,
  step,
  type BackoffAttempt,
  type BackoffOptions,
  type CloseInfo,
  type ConnectionState,
  type KeepaliveOptions,
  type KeepaliveRun,
  type LifecycleEvent,
} from './lifecycle';
import {
  renderMessage,
  startLine,
  type HeaderList,
  type HttpRequest,
  type HttpResponse,
} from './message';
import {
  buildClientHandshake,
  deriveAccept,
  generateKey,
  handleUpgrade,
  handshakeCost,
  handshakeResource,
  upgradeTokens,
  type AcceptDerivation,
  type HandshakeCheck,
  type HandshakeCost,
  type ServerPolicy,
} from './upgrade';

// ---------------------------------------------------------------------------
// The machines
// ---------------------------------------------------------------------------

/** The page holding the socket. */
export const CLIENT_NODE = 'client';
/**
 * A transparent intermediary that never understood the upgrade.
 *
 * Present in every topology because it is the reason masking exists. It forwarded the
 * handshake as an ordinary `GET`, saw a `101` it had no opinion about, and is now relaying
 * bytes it still believes are HTTP.
 */
export const PROXY_NODE = 'proxy';
/** The endpoint that answered `101`. */
export const SERVER_NODE = 'server';

/** RFC 5737 documentation addresses. None of these is a host that exists. */
export const NODE_ADDRESSES: Readonly<Record<string, string>> = {
  [CLIENT_NODE]: '203.0.113.10',
  [PROXY_NODE]: '198.51.100.5',
  [SERVER_NODE]: '192.0.2.20',
};

/** The client's ephemeral port. */
const CLIENT_PORT = 51844;
/** The port every WebSocket in this module runs over -- the same 443 HTTPS uses. */
const SERVER_PORT = 443;

/** Which endpoint an action belongs to. */
export type Endpoint = 'client' | 'server';

/** The direction a frame sent by `from` travels. */
export function directionOf(from: Endpoint): Direction {
  return from === 'client' ? 'client-to-server' : 'server-to-client';
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

/** The wire a scenario runs on. */
export interface NetworkConditions {
  readonly rttMs: number;
  readonly bandwidthKbps: number;
}

/** 80 ms is an ordinary same-continent round trip. */
export const DEFAULT_RTT_MS = 80;
/** 20 Mbps. Fast enough that framing, not bandwidth, is what the numbers show. */
export const DEFAULT_BANDWIDTH_KBPS = 20_000;
/** How long the proxy spends relaying, each way. */
export const DEFAULT_RELAY_MS = 1;
/** Virtual milliseconds of quiet after the last event, so the timeline has an end. */
export const TAIL_MS = 120;

/** How much of the one-way delay is the client-to-proxy leg. */
const EDGE_SHARE = 0.75;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// The handshake a scenario asks for
// ---------------------------------------------------------------------------

/** Everything needed to build one opening handshake. */
export interface HandshakeSetup {
  /** Path and query, e.g. `/chat?room=lobby`. */
  readonly resource: string;
  readonly host: string;
  /** A literal key -- pass the RFC 6455 vector to make the derivation checkable by hand. */
  readonly key?: string;
  /** Seed for {@link generateKey} when no literal key is given. */
  readonly keySeed?: string;
  readonly origin?: string;
  readonly subprotocols?: readonly string[];
  readonly extensions?: readonly string[];
  /** Claim something other than 13 to produce a `426`. */
  readonly version?: number;
  readonly extraHeaders?: HeaderList;
  readonly policy?: ServerPolicy;
}

/** One opening handshake, with everything the panel needs to explain it. */
export interface HandshakeRecord {
  readonly id: string;
  readonly request: HttpRequest;
  readonly response: HttpResponse;
  readonly accepted: boolean;
  readonly checks: readonly HandshakeCheck[];
  /** The Sec-WebSocket-Accept computation, kept whole. */
  readonly derivation: AcceptDerivation;
  /** The subprotocol agreed, if any. Absent is a success, not a failure. */
  readonly subprotocol?: string;
  readonly extensions: readonly string[];
  readonly cost: HandshakeCost;
  readonly sentAt: number;
  readonly receivedAt: number;
  /** The `Connection` and `Upgrade` token lists, on both messages. */
  readonly tokens: {
    readonly requestConnection: readonly string[];
    readonly requestUpgrade: readonly string[];
    readonly responseConnection: readonly string[];
    readonly responseUpgrade: readonly string[];
  };
  /** Where the request was aimed, and whether a credential ended up in the query. */
  readonly resource: {
    readonly path: string;
    readonly query: string;
    readonly credentialInQuery: boolean;
  };
  /** Why this handshake exists in the run -- "the first one", "attempt 3". */
  readonly label: string;
}

// ---------------------------------------------------------------------------
// The frames a scenario produces
// ---------------------------------------------------------------------------

/** One frame on the wire, timed and positioned. */
export interface FrameRecord {
  readonly id: string;
  /** Position in the run, counting both directions. */
  readonly index: number;
  /** The phase it belongs to. */
  readonly stepId: string;
  readonly from: Endpoint;
  readonly direction: Direction;
  readonly frame: WebSocketFrame;
  readonly layout: FrameLayout;
  /** The bytes as they go on the wire -- masked, when the frame is masked. */
  readonly wireHex: string;
  readonly wireBytes: number;
  readonly headerBytes: number;
  readonly sentAt: number;
  /** When it landed -- or when it was lost, if it never did. */
  readonly receivedAt: number;
  /**
   * False when the frame left the sender and never arrived.
   *
   * The keepalive scenario needs exactly this: a ping that goes out into a connection whose
   * far end has already vanished. Modelling it as "sent but not delivered" rather than "not
   * sent" is the honest version, because the sending endpoint cannot tell the difference --
   * the write succeeded, and that is the whole problem.
   */
  readonly delivered: boolean;
  readonly title: string;
  /** One sentence: why this frame, in this shape, at this moment. */
  readonly why: string;
  readonly notes: readonly string[];
  /**
   * True when the state machine produced this frame rather than the scenario.
   *
   * A pong and an echoing Close are protocol obligations, and marking them lets the message
   * stream draw them differently from something an application chose to send.
   */
  readonly automatic: boolean;
  /** Set on the frame that completed a message at the receiver. */
  readonly message?: {
    readonly opcode: 'text' | 'binary';
    readonly bytes: number;
    readonly frameCount: number;
    readonly text?: string;
  };
  /** Set on a Close frame. */
  readonly close?: CloseInfo;
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

/** Something an application decides to do on an open connection. */
export type SessionStep =
  | {
      readonly kind: 'message';
      readonly id: string;
      readonly title: string;
      readonly from: Endpoint;
      readonly intent: string;
      /** Text messages carry this. */
      readonly text?: string;
      /** Binary messages carry this instead. */
      readonly bytes?: Uint8Array;
      /** Split into continuation frames of at most this many payload bytes. */
      readonly fragmentBytes?: number;
      /**
       * Have the peer slip a ping in immediately after this fragment index (0-based).
       *
       * The reason control frames may not themselves be fragmented: a ping arriving between
       * fragment two and fragment three of a 40 MB upload has to be answerable *now*, and it
       * is. Without this the rule reads as an arbitrary restriction instead of the thing
       * that makes a long message survivable.
       */
      readonly interleavePingAfter?: number;
      /** Virtual milliseconds to wait after the previous step finished. */
      readonly afterMs?: number;
      readonly notes?: readonly string[];
    }
  | {
      readonly kind: 'ping';
      readonly id: string;
      readonly title: string;
      readonly from: Endpoint;
      readonly intent: string;
      /** Application data the pong must echo back byte for byte. */
      readonly text?: string;
      /**
       * Send it into a connection whose far end is already gone.
       *
       * The frame leaves, the write succeeds, and nothing arrives -- which is exactly what a
       * dead peer looks like from the sending side, and the reason a keepalive exists at all.
       */
      readonly unanswered?: boolean;
      readonly afterMs?: number;
      readonly notes?: readonly string[];
    }
  | {
      readonly kind: 'close';
      readonly id: string;
      readonly title: string;
      readonly from: Endpoint;
      readonly intent: string;
      readonly code?: number;
      readonly reason?: string;
      readonly afterMs?: number;
      readonly notes?: readonly string[];
    }
  | {
      readonly kind: 'lost';
      readonly id: string;
      readonly title: string;
      readonly intent: string;
      /** What happened to the transport: `'the Wi-Fi dropped'`. */
      readonly reason: string;
      readonly afterMs?: number;
      readonly notes?: readonly string[];
    };

/** A handshake and then a scripted conversation. */
export interface SessionPlan {
  readonly kind: 'session';
  readonly handshake: HandshakeSetup;
  readonly steps: readonly SessionStep[];
}

/** A handshake and then a keepalive, with the pings derived rather than written out. */
export interface KeepalivePlan {
  readonly kind: 'keepalive';
  readonly handshake: HandshakeSetup;
  readonly keepalive: KeepaliveOptions;
  /** Application traffic alongside the beats, so the trace is not only pings. */
  readonly chatter?: readonly {
    /** Virtual milliseconds after the connection opened. */
    readonly at: number;
    readonly from: Endpoint;
    readonly text: string;
  }[];
}

/** A connection that dies, and a client that comes back politely. */
export interface ReconnectPlan {
  readonly kind: 'reconnect';
  readonly handshake: HandshakeSetup;
  /** Messages exchanged before the drop. */
  readonly before: readonly { readonly from: Endpoint; readonly text: string }[];
  /** The earliest moment the transport may vanish. */
  readonly dropAtMs: number;
  readonly dropReason: string;
  readonly backoff: BackoffOptions;
  /** How many attempts to schedule. */
  readonly attempts: number;
  /** Which attempt reaches a server that is answering again (1-based). */
  readonly succeedsOn: number;
  /** The cursor the client sends first on the new connection, if it resumes. */
  readonly resumeCursor?: string;
  /** Messages after the reconnection. */
  readonly after: readonly { readonly from: Endpoint; readonly text: string }[];
}

/** Four transports over one schedule of updates. */
export interface ComparisonPlan {
  readonly kind: 'comparison';
  readonly options: ComparisonOptions;
}

/** Everything a scenario can run. */
export type WebSocketPlan = SessionPlan | KeepalivePlan | ReconnectPlan | ComparisonPlan;

/** The `kind` discriminator, so a picker can branch without spelling the union. */
export type WebSocketPlanKind = WebSocketPlan['kind'];

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

/** A teaching note pinned to a phase. */
export interface ScenarioNote {
  /** The phase id it appears at. */
  readonly phase: string;
  /** The node, link, or PDU it explains. Defaults to the client. */
  readonly target?: string;
  readonly text: string;
  readonly reference?: RfcRef;
}

/** One authored run. */
export interface WebSocketScenario {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  /** The sentences this run exists to make land. */
  readonly teaches: readonly string[];
  readonly plan: WebSocketPlan;
  readonly conditions?: Partial<NetworkConditions>;
  readonly relayMs?: number;
  readonly notes?: readonly ScenarioNote[];
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** Whole-run artefacts beyond the frames. */
export type WebSocketDetail =
  | {
      readonly kind: 'session';
      readonly client: ConnectionState;
      readonly server: ConnectionState;
    }
  | {
      readonly kind: 'keepalive';
      readonly client: ConnectionState;
      readonly server: ConnectionState;
      readonly keepalive: KeepaliveRun;
    }
  | {
      readonly kind: 'reconnect';
      readonly client: ConnectionState;
      readonly server: ConnectionState;
      readonly schedule: readonly BackoffAttempt[];
      /** The same schedule with the randomisation removed -- the herd. */
      readonly withoutJitter: readonly BackoffAttempt[];
      readonly explain: ReturnType<typeof explainBackoff>;
    }
  | { readonly kind: 'comparison'; readonly comparison: TransportComparison };

/** A finished run. */
export interface WebSocketRun {
  readonly scenario: WebSocketScenario;
  readonly topology: Topology;
  readonly result: SimResult;
  /** Every opening handshake. More than one only in the reconnection scenario. */
  readonly handshakes: readonly HandshakeRecord[];
  /** Every frame, in the order it went on the wire. */
  readonly frames: readonly FrameRecord[];
  readonly detail: WebSocketDetail;
}

// ---------------------------------------------------------------------------
// The topology
// ---------------------------------------------------------------------------

function node(
  id: string,
  kind: SimNode['kind'],
  label: string,
  detail: Record<string, string>,
): SimNode {
  return { id, kind, label, ipv4: NODE_ADDRESSES[id], detail };
}

function link(from: string, to: string, latencyMs: number, kbps: number): SimLink {
  return {
    id: `${from}-${to}`,
    from,
    to,
    latencyMs,
    bandwidthMbps: kbps / 1000,
    medium: 'fiber',
  };
}

/**
 * The three machines, and the two wires between them.
 *
 * The same shape for every scenario, because the lesson does not change: one TCP connection,
 * end to end, with something in the middle that still thinks it is watching HTTP.
 */
function buildTopology(conditions: NetworkConditions, host: string): Topology {
  const oneWay = conditions.rttMs / 2;
  const edgeMs = round2(oneWay * EDGE_SHARE);
  const coreMs = round2(oneWay * (1 - EDGE_SHARE));

  return {
    nodes: [
      node(CLIENT_NODE, 'client', 'Browser', {
        role: 'holds the socket; page script decides what to send',
        masks: 'every frame it sends, without exception',
        why: 'script here can choose payload bytes, so the wire bytes must not be choosable',
      }),
      node(PROXY_NODE, 'proxy', 'Transparent proxy', {
        role: 'relays bytes it still believes are HTTP',
        'saw the handshake': 'yes -- an ordinary GET, which it routed and logged',
        'understood the 101': 'no. This is the machine masking exists to protect',
      }),
      node(SERVER_NODE, 'server', host, {
        role: 'answered 101 and now speaks frames on the same connection',
        masks: 'nothing. A masked frame from a server must fail the connection',
      }),
    ],
    links: [
      link(CLIENT_NODE, PROXY_NODE, edgeMs, conditions.bandwidthKbps),
      link(PROXY_NODE, SERVER_NODE, coreMs, conditions.bandwidthKbps),
    ],
  };
}

// ---------------------------------------------------------------------------
// PDUs
// ---------------------------------------------------------------------------

function ipLayer(from: string, to: string): ProtocolLayer {
  return {
    layer: 'network',
    protocol: 'IPv4',
    fields: [
      { name: 'Source', value: NODE_ADDRESSES[from] ?? '203.0.113.0', bits: 32 },
      { name: 'Destination', value: NODE_ADDRESSES[to] ?? '203.0.113.0', bits: 32 },
    ],
  };
}

function tcpLayer(outbound: boolean): ProtocolLayer {
  return {
    layer: 'transport',
    protocol: 'TCP',
    fields: [
      {
        name: 'Source Port',
        value: `${outbound ? CLIENT_PORT : SERVER_PORT}`,
        bits: 16,
      },
      {
        name: 'Destination Port',
        value: `${outbound ? SERVER_PORT : CLIENT_PORT}`,
        bits: 16,
        note: 'Still 443, and still the same connection. The upgrade changed what is carried, not what carries it -- which is the whole reason WebSockets deploy through firewalls that have never heard of them.',
      },
    ],
  };
}

function headerFields(headers: HeaderList): HeaderField[] {
  return headers.map((field) => ({ name: field.name, value: field.value }));
}

/** The handshake request or response, as a PDU. */
function httpPdu(
  id: string,
  message: HttpRequest | HttpResponse,
  from: string,
  to: string,
): PDU {
  const outbound = 'method' in message;
  return {
    id,
    layers: [
      ipLayer(from, to),
      tcpLayer(outbound),
      {
        layer: 'application',
        protocol: 'HTTP/1.1',
        fields: headerFields(message.headers),
        payloadPreview: startLine(message),
      },
    ],
    sizeBytes: renderMessage(message).length,
    summary: startLine(message),
  };
}

/**
 * A frame, as a PDU whose application layer is the bit-accurate field list.
 *
 * The inspector therefore shows exactly the fields the frame inspector shows, at the same
 * bit widths, because both read `frameLayout`. There is one description of the frame format
 * in this module and it lives in `frames.ts`.
 */
function framePdu(record: FrameRecord): PDU {
  const outbound = record.from === 'client';
  const application: ProtocolLayer = {
    layer: 'application',
    protocol: 'WebSocket',
    fields: record.layout.fields.map((field) => ({
      name: field.name,
      value: field.value,
      bits: field.bits,
      note: field.explain,
    })),
    payloadPreview: framePreview(record.frame),
  };

  return {
    id: record.id,
    layers: [
      ipLayer(outbound ? CLIENT_NODE : SERVER_NODE, outbound ? SERVER_NODE : CLIENT_NODE),
      tcpLayer(outbound),
      application,
    ],
    sizeBytes: record.wireBytes,
    summary: frameSummary(record.frame, record.wireBytes),
  };
}

/** A short readable form of what a frame carries. */
export function framePreview(value: WebSocketFrame): string {
  if (value.opcode === 'text' || value.opcode === 'continuation') {
    const text = frameText(value);
    return text.length > 60 ? `${text.slice(0, 57)}...` : text;
  }
  if (value.opcode === 'close') {
    const parsed = parseClosePayload(value.payload);
    if (!parsed.ok) return 'malformed close payload';
    return parsed.value.code === undefined
      ? 'close, no code'
      : `close ${parsed.value.code}${parsed.value.reason === '' ? '' : ` ${parsed.value.reason}`}`;
  }
  return `${value.payload.length} bytes`;
}

/** The one-line label the animated packet and the log row carry. */
export function frameSummary(value: WebSocketFrame, bytes: number): string {
  return `${value.opcode} frame, ${value.fin ? 'FIN' : 'no FIN'}, ${value.payload.length}B payload in ${bytes}B`;
}

// ---------------------------------------------------------------------------
// The build
// ---------------------------------------------------------------------------

interface PhaseDraft {
  readonly at: number;
  readonly id: string;
  readonly title: string;
  readonly description: string;
}

interface Build {
  readonly events: SimEvent[];
  readonly pdus: Record<string, PDU>;
  readonly topology: Topology;
  readonly conditions: NetworkConditions;
  readonly relayMs: number;
  readonly phases: PhaseDraft[];
  readonly frames: FrameRecord[];
  readonly handshakes: HandshakeRecord[];
  readonly scenarioId: string;
  /** Bumped for every masked frame, so every key is fresh and every run reproducible. */
  maskCounter: number;
  client: ConnectionState;
  server: ConnectionState;
}

function linkBetween(build: Build, a: string, b: string): SimLink {
  const found = build.topology.links.find(
    (candidate) =>
      (candidate.from === a && candidate.to === b) ||
      (candidate.from === b && candidate.to === a),
  );
  if (!found) throw new Error(`no link between "${a}" and "${b}"`);
  return found;
}

function serializationMs(build: Build, bytes: number): number {
  // kbps is bits per millisecond, so this is bytes -> bits -> milliseconds.
  return round2((bytes * 8) / build.conditions.bandwidthKbps);
}

function startPhase(build: Build, draft: PhaseDraft): void {
  build.phases.push(draft);
}

function log(
  build: Build,
  at: number,
  level: 'info' | 'warn' | 'error',
  text: string,
): void {
  build.events.push({ kind: 'log', at, level, text });
}

/** Fold the state machine's own log lines into the event stream. */
function pushLifecycleEvents(build: Build, events: readonly LifecycleEvent[]): void {
  for (const event of events) {
    log(build, event.at, event.level, event.text);
  }
}

/** The path a message from `from` takes -- always through the proxy. */
function pathFrom(from: Endpoint): readonly string[] {
  return from === 'client'
    ? [CLIENT_NODE, PROXY_NODE, SERVER_NODE]
    : [SERVER_NODE, PROXY_NODE, CLIENT_NODE];
}

/**
 * Fly one PDU along a path and report when it lands.
 *
 * The same PDU id crosses both hops, because it is the same bytes: a proxy relaying a frame
 * has not made a new one, and the shared id is what lets the inspector follow it across the
 * diagram.
 */
function pushFlight(
  build: Build,
  options: {
    readonly pduId: string;
    readonly bytes: number;
    readonly path: readonly string[];
    readonly at: number;
    readonly arriveNote?: string;
  },
): number {
  const serialization = serializationMs(build, options.bytes);
  let at = options.at;

  for (let index = 0; index < options.path.length - 1; index += 1) {
    const from = options.path[index] as string;
    const to = options.path[index + 1] as string;
    const wire = linkBetween(build, from, to);
    const durationMs = round2(wire.latencyMs + serialization);

    build.events.push({
      kind: 'transmit',
      at,
      pduId: options.pduId,
      from,
      to,
      durationMs,
      linkId: wire.id,
    });
    at = round2(at + durationMs);

    const isDestination = index + 2 === options.path.length;
    build.events.push({
      kind: 'node-state',
      at,
      nodeId: to,
      state: 'processing',
      note: isDestination
        ? (options.arriveNote ?? 'reading the frame')
        : 'relaying bytes it believes are HTTP',
    });
    if (!isDestination) at = round2(at + build.relayMs);
  }

  return at;
}

// ---------------------------------------------------------------------------
// The handshake
// ---------------------------------------------------------------------------

function runHandshake(
  build: Build,
  setup: HandshakeSetup,
  options: { readonly id: string; readonly label: string; readonly at: number },
): { record: HandshakeRecord; endsAt: number } {
  // The handshake id is part of the seed, not just the scenario's, so a reconnection gets a
  // different nonce from the connection it replaces. That is a requirement rather than a
  // nicety: a key reused across connections would let a cached `101` from the first one be
  // replayed as an answer to the second.
  const key =
    setup.key ??
    generateKey(`${build.scenarioId}:${setup.keySeed ?? 'handshake'}:${options.id}`);
  const request = buildClientHandshake({
    resource: setup.resource,
    host: setup.host,
    key,
    ...(setup.origin === undefined ? {} : { origin: setup.origin }),
    ...(setup.subprotocols === undefined ? {} : { subprotocols: setup.subprotocols }),
    ...(setup.extensions === undefined ? {} : { extensions: setup.extensions }),
    ...(setup.version === undefined ? {} : { version: setup.version }),
    ...(setup.extraHeaders === undefined ? {} : { extraHeaders: setup.extraHeaders }),
  });
  const outcome = handleUpgrade(request, setup.policy ?? {});
  const response = outcome.response;

  const requestPduId = `${options.id}-request`;
  const responsePduId = `${options.id}-response`;

  const requestPdu = httpPdu(requestPduId, request, CLIENT_NODE, SERVER_NODE);
  build.pdus[requestPduId] = requestPdu;
  build.events.push({
    kind: 'pdu-created',
    at: options.at,
    pdu: requestPdu,
    atNode: CLIENT_NODE,
  });
  build.events.push({
    kind: 'node-state',
    at: options.at,
    nodeId: CLIENT_NODE,
    state: 'active',
    note: 'opening handshake',
  });

  const arrivedAt = pushFlight(build, {
    pduId: requestPduId,
    bytes: requestPdu.sizeBytes,
    path: pathFrom('client'),
    at: options.at,
    arriveNote: 'checking the handshake',
  });

  // The server's whole decision is one SHA-1 over sixty-odd bytes and a handful of string
  // comparisons, which is why an upgrade costs a server almost nothing.
  const replyAt = round2(arrivedAt + 3);
  const responsePdu = httpPdu(responsePduId, response, SERVER_NODE, CLIENT_NODE);
  build.pdus[responsePduId] = responsePdu;
  build.events.push({
    kind: 'pdu-created',
    at: replyAt,
    pdu: responsePdu,
    atNode: SERVER_NODE,
  });

  const receivedAt = pushFlight(build, {
    pduId: responsePduId,
    bytes: responsePdu.sizeBytes,
    path: pathFrom('server'),
    at: replyAt,
    arriveNote:
      outcome.kind === 'accepted'
        ? 'verifying Sec-WebSocket-Accept'
        : 'handshake refused',
  });

  const accepted = outcome.kind === 'accepted';
  log(
    build,
    receivedAt,
    accepted ? 'info' : 'error',
    accepted
      ? `${response.status} ${response.reason}. The client recomputes SHA-1(key + GUID) itself and compares the base64 byte for byte. From the blank line at the end of this response, the same TCP connection carries frames and no HTTP parser reads it again.`
      : `${response.status} ${response.reason}${outcome.kind === 'rejected' ? `: ${outcome.reason}` : ''} A refused handshake is still HTTP -- the connection never switched protocols, so this is an ordinary response every intermediary on the path understands.`,
  );

  const record: HandshakeRecord = {
    id: options.id,
    request,
    response,
    accepted,
    checks: outcome.checks,
    derivation: outcome.kind === 'accepted' ? outcome.derivation : deriveAccept(key),
    ...(outcome.kind === 'accepted' && outcome.subprotocol !== undefined
      ? { subprotocol: outcome.subprotocol }
      : {}),
    extensions:
      outcome.kind === 'accepted' ? outcome.extensions.map((offer) => offer.raw) : [],
    cost: handshakeCost(request, response),
    sentAt: options.at,
    receivedAt,
    tokens: {
      requestConnection: upgradeTokens(request.headers).connection,
      requestUpgrade: upgradeTokens(request.headers).upgrade,
      responseConnection: upgradeTokens(response.headers).connection,
      responseUpgrade: upgradeTokens(response.headers).upgrade,
    },
    resource: handshakeResource(request),
    label: options.label,
  };

  build.handshakes.push(record);
  return { record, endsAt: receivedAt };
}

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

/** A fresh masking key, unique per frame and reproducible across runs. */
function nextMaskingKey(build: Build): MaskingKey {
  build.maskCounter += 1;
  return maskingKeyFrom(`${build.scenarioId}:${build.maskCounter}`);
}

/**
 * Re-frame an obligated reply with a masking key when it leaves the client.
 *
 * `lifecycle.ts` builds the pong and the echoing Close without one, because a reducer does
 * not know which end it is running on. Masking is a property of the direction a frame
 * travels, and this file is the one that knows the direction.
 */
function forDirection(
  build: Build,
  value: WebSocketFrame,
  from: Endpoint,
): WebSocketFrame {
  if (from === 'server' || value.masked) return value;
  return { ...value, masked: true, maskingKey: nextMaskingKey(build) };
}

/** What a frame is called in the log and on the stream. */
function frameTitle(value: WebSocketFrame, automatic: boolean): string {
  switch (value.opcode) {
    case 'ping':
      return 'Ping';
    case 'pong':
      return automatic ? 'Pong (obligated)' : 'Pong';
    case 'close':
      return automatic ? 'Close (echo)' : 'Close';
    case 'continuation':
      return value.fin ? 'Continuation, FIN' : 'Continuation';
    default: {
      const noun = value.opcode === 'text' ? 'Text' : 'Binary';
      return value.fin ? `${noun} message` : `${noun}, FIN 0`;
    }
  }
}

interface SendOptions {
  readonly stepId: string;
  readonly from: Endpoint;
  readonly frame: WebSocketFrame;
  readonly at: number;
  readonly why: string;
  readonly notes?: readonly string[];
  readonly automatic?: boolean;
  readonly title?: string;
  /** The frame leaves the sender and never reaches the peer. */
  readonly undelivered?: boolean;
}

/**
 * Put one frame on the wire and run both endpoints over it.
 *
 * Returns when the frame has landed. Anything the receiver is now obliged to send -- a pong,
 * an echoing Close -- goes out from here too, recursively, because those are the protocol's
 * frames rather than the scenario's and no scenario should have to remember them.
 */
function sendFrame(build: Build, options: SendOptions, depth = 0): number {
  const direction = directionOf(options.from);
  const value = options.frame;
  const encoded = encodeFrame(value, { direction });
  const closeInfo =
    value.opcode === 'close' ? parseClosePayload(value.payload) : undefined;

  const record: FrameRecord = {
    id: `${options.stepId}-f${build.frames.length}`,
    index: build.frames.length,
    stepId: options.stepId,
    from: options.from,
    direction,
    frame: value,
    layout: frameLayout(value),
    wireHex: encoded.ok
      ? bytesToHex(encoded.value, { uppercase: true })
      : `illegal frame: ${encoded.error}`,
    wireBytes: frameBytes(value),
    headerBytes: headerBytes(value),
    sentAt: options.at,
    // Overwritten below, once the flight has been timed.
    receivedAt: options.at,
    delivered: options.undelivered !== true,
    title: options.title ?? frameTitle(value, options.automatic === true),
    why: options.why,
    notes: options.notes ?? [],
    automatic: options.automatic === true,
    ...(closeInfo?.ok ? { close: closeInfo.value } : {}),
  };

  // The sender's own state machine first: it is what decides whether this was even legal.
  const sender = options.from === 'client' ? build.client : build.server;
  const sendResult = step(sender, { kind: 'send', at: options.at, frame: value });
  if (options.from === 'client') build.client = sendResult.state;
  else build.server = sendResult.state;
  pushLifecycleEvents(build, sendResult.events);

  const pdu = framePdu(record);
  build.pdus[record.id] = pdu;
  build.events.push({
    kind: 'pdu-created',
    at: options.at,
    pdu,
    atNode: options.from === 'client' ? CLIENT_NODE : SERVER_NODE,
  });
  build.events.push({
    kind: 'node-state',
    at: options.at,
    nodeId: options.from === 'client' ? CLIENT_NODE : SERVER_NODE,
    state: 'active',
    note: value.masked ? 'masking the payload' : 'writing the frame',
  });

  const wholePath = pathFrom(options.from);

  if (options.undelivered === true) {
    // One hop, and then nothing. The sender's own state machine has already counted the
    // frame as sent, which is the point: from where it is standing, this write succeeded.
    const lostAt = pushFlight(build, {
      pduId: record.id,
      bytes: record.wireBytes,
      path: wholePath.slice(0, 2),
      at: options.at,
      arriveNote: 'nothing on the far side',
    });
    build.events.push({
      kind: 'drop',
      at: lostAt,
      pduId: record.id,
      atNode: PROXY_NODE,
      reason: 'the far end is gone; the frame has nowhere to be delivered',
    });
    build.frames.push({ ...record, receivedAt: lostAt });
    return lostAt;
  }

  const receivedAt = pushFlight(build, {
    pduId: record.id,
    bytes: record.wireBytes,
    path: wholePath,
    at: options.at,
    arriveNote: isControlOpcode(value.opcode) ? 'control frame' : 'reading the frame',
  });

  const receiverRole: Endpoint = options.from === 'client' ? 'server' : 'client';
  const receiverState = receiverRole === 'client' ? build.client : build.server;
  const receiveResult = step(receiverState, {
    kind: 'receive',
    at: receivedAt,
    frame: value,
  });
  if (receiverRole === 'client') build.client = receiveResult.state;
  else build.server = receiveResult.state;
  pushLifecycleEvents(build, receiveResult.events);

  const completed = receiveResult.events.find((event) => event.message !== undefined);
  const framesInStep =
    build.frames.filter(
      (each) => each.stepId === record.stepId && !isControlOpcode(each.frame.opcode),
    ).length + 1;

  build.frames.push({
    ...record,
    receivedAt,
    ...(completed?.message === undefined
      ? {}
      : {
          message: {
            opcode: completed.message.opcode,
            bytes: completed.message.bytes,
            frameCount: framesInStep,
            ...(completed.message.text === undefined
              ? {}
              : { text: completed.message.text }),
          },
        }),
  });

  let endsAt = receivedAt;
  // Bounded in practice -- a ping produces one pong, a Close produces one echo -- but the
  // guard is here so a reducer bug shows up as a missing frame rather than a hung page.
  if (depth < 3) {
    for (const reply of receiveResult.emit) {
      endsAt = Math.max(
        endsAt,
        sendFrame(
          build,
          {
            stepId: options.stepId,
            from: receiverRole,
            frame: forDirection(build, reply, receiverRole),
            at: round2(receivedAt + 2),
            why: replyReason(reply),
            automatic: true,
          },
          depth + 1,
        ),
      );
    }
  }

  return endsAt;
}

function replyReason(value: WebSocketFrame): string {
  if (value.opcode === 'pong') {
    return 'An obligation, not a courtesy: RFC 6455 s 5.5.2 requires a pong carrying the ping’s bytes back unchanged, as soon as is practical. A browser fulfils it without telling the page it happened.';
  }
  if (value.opcode === 'close') {
    return 'The endpoint that did not start the closing handshake echoes a Close back and then sends nothing further. Both directions have now said goodbye, which is exactly what makes a close clean.';
  }
  return 'Sent by the protocol rather than by the application.';
}

// ---------------------------------------------------------------------------
// Running a session
// ---------------------------------------------------------------------------

function messageFrames(
  build: Build,
  stepDef: Extract<SessionStep, { kind: 'message' }>,
): readonly WebSocketFrame[] {
  const isText = stepDef.bytes === undefined;
  const payload = isText ? utf8Bytes(stepDef.text ?? '') : (stepDef.bytes as Uint8Array);
  const masked = stepDef.from === 'client';

  if (stepDef.fragmentBytes !== undefined) {
    const chunks = Math.max(1, Math.ceil(payload.length / stepDef.fragmentBytes));
    // A fresh key per frame, never one key reused across a message: an attacker who could
    // guess one key would otherwise have guessed the whole message.
    const keys = masked
      ? Array.from({ length: chunks }, () => nextMaskingKey(build))
      : undefined;
    const result = fragmentMessage(
      isText ? 'text' : 'binary',
      payload,
      stepDef.fragmentBytes,
      keys,
    );
    if (!result.ok) throw new Error(`scenario "${build.scenarioId}": ${result.error}`);
    return result.value;
  }

  const options = masked ? { maskingKey: nextMaskingKey(build) } : {};
  return [
    isText ? textFrame(stepDef.text ?? '', options) : binaryFrame(payload, options),
  ];
}

function fragmentReason(index: number, total: number): string {
  if (index === 0) {
    return `Fragment 1 of ${total}. The opcode is declared once, here, with FIN 0 -- so the sender could begin transmitting before it knew how long the message would be.`;
  }
  if (index === total - 1) {
    return `Fragment ${index + 1} of ${total}. FIN is set, so the receiver may finally deliver the whole message -- and only now is the UTF-8 validated, because a multi-byte character may straddle a boundary.`;
  }
  return `Fragment ${index + 1} of ${total}. A continuation frame says nothing about what it continues; on its own it is meaningless.`;
}

function runSessionSteps(
  build: Build,
  steps: readonly SessionStep[],
  startAt: number,
): number {
  let at = startAt;

  for (const stepDef of steps) {
    at = round2(at + (stepDef.afterMs ?? 120));
    startPhase(build, {
      at,
      id: stepDef.id,
      title: stepDef.title,
      description: stepDef.intent,
    });

    if (stepDef.kind === 'lost') {
      for (const role of ['client', 'server'] as const) {
        const result = step(role === 'client' ? build.client : build.server, {
          kind: 'transport-lost',
          at,
          reason: stepDef.reason,
        });
        if (role === 'client') build.client = result.state;
        else build.server = result.state;
        pushLifecycleEvents(build, result.events);
      }
      build.events.push({
        kind: 'node-state',
        at,
        nodeId: PROXY_NODE,
        state: 'error',
        note: stepDef.reason,
      });
      build.events.push({
        kind: 'node-state',
        at,
        nodeId: CLIENT_NODE,
        state: 'error',
        note: 'readyState CLOSED, code 1006',
      });
      continue;
    }

    if (stepDef.kind === 'ping') {
      const options =
        stepDef.from === 'client' ? { maskingKey: nextMaskingKey(build) } : {};
      at = sendFrame(build, {
        stepId: stepDef.id,
        from: stepDef.from,
        frame: pingFrame(utf8Bytes(stepDef.text ?? ''), options),
        at,
        why: stepDef.intent,
        ...(stepDef.unanswered === true ? { undelivered: true } : {}),
        ...(stepDef.notes === undefined ? {} : { notes: stepDef.notes }),
      });
      continue;
    }

    if (stepDef.kind === 'close') {
      const options =
        stepDef.from === 'client' ? { maskingKey: nextMaskingKey(build) } : {};
      const built = closeFrame(stepDef.code, stepDef.reason ?? '', options);
      if (!built.ok) throw new Error(`scenario "${build.scenarioId}": ${built.error}`);
      at = sendFrame(build, {
        stepId: stepDef.id,
        from: stepDef.from,
        frame: built.value,
        at,
        why: stepDef.intent,
        ...(stepDef.notes === undefined ? {} : { notes: stepDef.notes }),
      });

      // Both Close frames have crossed. The server, not the client, closes the TCP
      // connection -- which is what keeps TIME_WAIT on the side holding one socket rather
      // than the side holding fifty thousand.
      at = round2(at + 4);
      for (const role of ['client', 'server'] as const) {
        const result = step(role === 'client' ? build.client : build.server, {
          kind: 'transport-closed',
          at,
        });
        if (role === 'client') build.client = result.state;
        else build.server = result.state;
        pushLifecycleEvents(build, result.events);
      }
      continue;
    }

    const frames = messageFrames(build, stepDef);
    const peer: Endpoint = stepDef.from === 'client' ? 'server' : 'client';

    for (let index = 0; index < frames.length; index += 1) {
      at = sendFrame(build, {
        stepId: stepDef.id,
        from: stepDef.from,
        frame: frames[index] as WebSocketFrame,
        at: index === 0 ? at : round2(at + 12),
        why: frames.length === 1 ? stepDef.intent : fragmentReason(index, frames.length),
        ...(index === 0 && stepDef.notes !== undefined ? { notes: stepDef.notes } : {}),
      });

      if (stepDef.interleavePingAfter === index) {
        const options = peer === 'client' ? { maskingKey: nextMaskingKey(build) } : {};
        at = sendFrame(build, {
          stepId: stepDef.id,
          from: peer,
          frame: pingFrame(utf8Bytes('alive?'), options),
          at: round2(at + 6),
          why: 'A ping, arriving in the middle of a half-sent message -- and answered immediately, without waiting for the message to finish. This is why RFC 6455 s 5.5 forbids fragmenting a control frame: a ping that could itself be split could be stuck behind the very message it is checking on.',
          title: 'Ping between fragments',
        });
      }
    }
  }

  return at;
}

// ---------------------------------------------------------------------------
// The plans
// ---------------------------------------------------------------------------

/** Open the connection on both endpoints once the `101` has landed. */
function openBoth(build: Build, at: number): void {
  const client = step(build.client, { kind: 'handshake-complete', at });
  build.client = client.state;
  pushLifecycleEvents(build, client.events);
  build.server = step(build.server, { kind: 'handshake-complete', at }).state;
}

function runSessionPlan(
  build: Build,
  plan: SessionPlan,
): { detail: WebSocketDetail; endsAt: number } {
  startPhase(build, {
    at: 0,
    id: 'handshake',
    title: 'The upgrade',
    description:
      'An ordinary HTTP/1.1 GET asks to stop being HTTP. Everything up to the 101 is a request any proxy on the path can route, log, and authenticate.',
  });
  const handshake = runHandshake(build, plan.handshake, {
    id: 'handshake',
    label: 'Opening handshake',
    at: 0,
  });

  let at = handshake.endsAt;
  openBoth(build, at);
  at = runSessionSteps(build, plan.steps, at);

  return {
    detail: { kind: 'session', client: build.client, server: build.server },
    endsAt: at,
  };
}

function runKeepalivePlan(
  build: Build,
  plan: KeepalivePlan,
): { detail: WebSocketDetail; endsAt: number } {
  startPhase(build, {
    at: 0,
    id: 'handshake',
    title: 'The upgrade',
    description:
      'One handshake, and then a connection that has to be kept alive on purpose -- because an idle TCP flow is exactly what a NAT table evicts first.',
  });
  const handshake = runHandshake(build, plan.handshake, {
    id: 'handshake',
    label: 'Opening handshake',
    at: 0,
  });

  const openedAt = handshake.endsAt;
  openBoth(build, openedAt);

  const run = simulateKeepalive(plan.keepalive);

  // The beats and the application traffic are merged onto one clock, so the trace shows
  // both on the same line. That matters: a busy connection still needs the beat, because
  // "busy" is not something the NAT on the path can see from outside.
  type Timed = { readonly at: number; readonly step: SessionStep };
  const timed: Timed[] = [];

  for (const entry of plan.chatter ?? []) {
    timed.push({
      at: entry.at,
      step: {
        kind: 'message',
        id: `chat-${entry.at}`,
        title: `${entry.from === 'client' ? 'Client' : 'Server'} message`,
        from: entry.from,
        intent:
          'Ordinary application traffic, sharing the connection with the keepalive and costing a fraction of what one HTTP request would.',
        text: entry.text,
      },
    });
  }

  for (const beat of run.beats) {
    timed.push({
      at: beat.sentAt,
      step: {
        kind: 'ping',
        id: `ping-${beat.index}`,
        title: `Ping ${beat.index}${beat.timedOut ? ' (unanswered)' : ''}`,
        from: 'server',
        ...(beat.timedOut ? { unanswered: true } : {}),
        intent: beat.timedOut
          ? 'This ping is never answered. After the pong timeout the server declares the connection dead -- there is nothing else it can do, because a TCP write to a peer that has vanished can keep succeeding for minutes.'
          : 'The server pings. Browsers cannot: the WebSocket API has no method for it, so in a browser deployment the beat is always the server’s job.',
      },
    });
  }

  timed.sort((a, b) => a.at - b.at);

  let cursor = 0;
  const steps = timed.map((entry) => {
    const gap = Math.max(0, round2(entry.at - cursor));
    cursor = entry.at;
    return { ...entry.step, afterMs: gap };
  });

  let at = runSessionSteps(build, steps, openedAt);

  if (run.deadAt !== undefined) {
    const deadAt = round2(openedAt + run.deadAt);
    startPhase(build, {
      at: deadAt,
      id: 'declared-dead',
      title: 'Declared dead',
      description:
        'The pong never came. The server gives up after the timeout, and the local API reports 1006 -- the code that is never on the wire and carries no reason, because there was nothing left to carry one.',
    });
    for (const role of ['client', 'server'] as const) {
      const result = step(role === 'client' ? build.client : build.server, {
        kind: 'transport-lost',
        at: deadAt,
        reason:
          role === 'server'
            ? 'no pong within the keepalive timeout'
            : 'the peer stopped answering',
      });
      if (role === 'client') build.client = result.state;
      else build.server = result.state;
      pushLifecycleEvents(build, result.events);
    }
    build.events.push({
      kind: 'node-state',
      at: deadAt,
      nodeId: SERVER_NODE,
      state: 'error',
      note: 'no pong; connection declared dead',
    });
    at = Math.max(at, deadAt);
  }

  return {
    detail: {
      kind: 'keepalive',
      client: build.client,
      server: build.server,
      keepalive: run,
    },
    endsAt: at,
  };
}

function plainMessages(
  entries: readonly { readonly from: Endpoint; readonly text: string }[],
  prefix: string,
  intent: string,
): SessionStep[] {
  return entries.map((entry, index) => ({
    kind: 'message',
    id: `${prefix}-${index}`,
    title: `${entry.from === 'client' ? 'Client' : 'Server'} message`,
    from: entry.from,
    intent,
    text: entry.text,
  }));
}

function runReconnectPlan(
  build: Build,
  plan: ReconnectPlan,
): { detail: WebSocketDetail; endsAt: number } {
  startPhase(build, {
    at: 0,
    id: 'handshake',
    title: 'The first connection',
    description: 'The upgrade that is about to be taken away without warning.',
  });
  const first = runHandshake(build, plan.handshake, {
    id: 'handshake',
    label: 'First connection',
    at: 0,
  });

  let at = first.endsAt;
  openBoth(build, at);
  at = runSessionSteps(
    build,
    plainMessages(
      plan.before,
      'before',
      'Ordinary traffic on a connection that is about to disappear.',
    ),
    at,
  );

  const dropAt = round2(Math.max(at + 40, plan.dropAtMs));
  startPhase(build, {
    at: dropAt,
    id: 'transport-lost',
    title: 'The transport vanishes',
    description:
      'No Close frame, no warning, no reason string. The local API reports 1006, and there is nothing to look it up in -- 1006 is never sent on the wire. It is the name for the absence of an explanation.',
  });
  for (const role of ['client', 'server'] as const) {
    const result = step(role === 'client' ? build.client : build.server, {
      kind: 'transport-lost',
      at: dropAt,
      reason: plan.dropReason,
    });
    if (role === 'client') build.client = result.state;
    else build.server = result.state;
    pushLifecycleEvents(build, result.events);
  }
  build.events.push({
    kind: 'node-state',
    at: dropAt,
    nodeId: PROXY_NODE,
    state: 'error',
    note: plan.dropReason,
  });

  const schedule = backoffSchedule(plan.attempts, plan.backoff);
  const withoutJitter = backoffSchedule(plan.attempts, {
    ...plan.backoff,
    jitter: 'none',
  });

  at = dropAt;
  let reconnected = false;

  for (const attempt of schedule) {
    const attemptAt = round2(dropAt + attempt.elapsedMs);
    const succeeds = attempt.attempt === plan.succeedsOn;
    const next = schedule[attempt.attempt];

    startPhase(build, {
      at: attemptAt,
      id: `attempt-${attempt.attempt}`,
      title: `Reconnect attempt ${attempt.attempt}`,
      description: succeeds
        ? `Waited ${Math.round(attempt.delayMs)} ms out of a ${Math.round(attempt.capMs)} ms window. This one reaches a server that is answering again -- and it is a brand new connection, with none of the old one's state.`
        : `Waited ${Math.round(attempt.delayMs)} ms out of a ${Math.round(attempt.capMs)} ms window. The delay is drawn from inside the window rather than being equal to it, and that randomisation is the half that protects the server.`,
    });

    if (!succeeds) {
      log(
        build,
        attemptAt,
        'warn',
        `Attempt ${attempt.attempt} fails: the server is still restarting. The window doubles to ${Math.round(next?.capMs ?? attempt.capMs * 2)} ms and the next delay is drawn from inside it.`,
      );
      build.events.push({
        kind: 'node-state',
        at: attemptAt,
        nodeId: CLIENT_NODE,
        state: 'error',
        note: `attempt ${attempt.attempt} refused`,
      });
      at = attemptAt;
      continue;
    }

    build.client = connectingConnection('client');
    build.server = connectingConnection('server');
    const again = runHandshake(build, plan.handshake, {
      id: `attempt-${attempt.attempt}`,
      label: `Reconnection (attempt ${attempt.attempt})`,
      at: attemptAt,
    });
    at = again.endsAt;
    openBoth(build, at);
    reconnected = true;
    break;
  }

  if (reconnected) {
    const resume: SessionStep[] =
      plan.resumeCursor === undefined
        ? []
        : [
            {
              kind: 'message',
              id: 'resume',
              title: 'Resume from a cursor',
              from: 'client',
              intent:
                'A new connection is a new connection. The server has no memory of the old one and no way to know what this client already saw, so whatever was missed during the gap has to be asked for explicitly, in the first frame, from a cursor the client kept. Server-Sent Events gets this for free with Last-Event-ID; a WebSocket application has to build it.',
              text: plan.resumeCursor,
            },
          ];
    at = runSessionSteps(
      build,
      [
        ...resume,
        ...plainMessages(
          plan.after,
          'after',
          'Traffic on the new connection, which knows nothing about the old one.',
        ),
      ],
      at,
    );
  }

  return {
    detail: {
      kind: 'reconnect',
      client: build.client,
      server: build.server,
      schedule,
      withoutJitter,
      explain: explainBackoff(),
    },
    endsAt: at,
  };
}

/**
 * The race.
 *
 * The canvas stays deliberately quiet here. Four transports running at once on one diagram
 * would be four animations competing for the same three machines, and the thing worth
 * looking at is the comparison panel: four lanes on one clock, with a running request count
 * and byte bill above each. So this plan emits the phases and the summary lines, and lets
 * `TransportComparison` draw the race against the same playhead.
 */
function runComparisonPlan(
  build: Build,
  plan: ComparisonPlan,
): { detail: WebSocketDetail; endsAt: number } {
  const comparison = compareTransports(plan.options);

  startPhase(build, {
    at: 0,
    id: 'race',
    title: 'Four transports, one schedule of updates',
    description:
      'The same updates delivered four ways over the same wire. Every byte counted comes from a message that was actually built -- a realistic browser GET with its cookies, the real handshake, real frame headers.',
  });

  for (const run of comparison.runs) {
    log(
      build,
      0,
      'info',
      `${run.label}: ${run.requests} request${run.requests === 1 ? '' : 's'}, ${run.totalBytes} bytes, ${Math.round(run.overheadRatio * 100)}% of it overhead, average delivery ${run.averageLatencyMs} ms.`,
    );
  }

  // One phase per transport after the first, so the stepper walks them and the panel can
  // highlight one lane at a time without inventing a second notion of "current".
  const slice = comparison.options.durationMs / comparison.runs.length;
  comparison.runs.forEach((run, index) => {
    if (index === 0) return;
    startPhase(build, {
      at: round2(index * slice),
      id: `transport-${run.transport}`,
      title: run.label,
      description: run.verdict,
    });
  });

  return {
    detail: { kind: 'comparison', comparison },
    endsAt: comparison.options.durationMs,
  };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * Sort by time, keeping emission order within one instant.
 *
 * `pdu-created` and the `transmit` that references it share a virtual millisecond, and the
 * log reads as nonsense the other way round. `Array.prototype.sort` has been required to be
 * stable since ES2019.
 */
function sortEvents(events: readonly SimEvent[]): SimEvent[] {
  return [...events].sort((a, b) => a.at - b.at);
}

/** The host a scenario is aimed at, for the server node's label. */
function scenarioHost(plan: WebSocketPlan): string {
  return plan.kind === 'comparison'
    ? (plan.options.host ?? 'live.example.com')
    : plan.handshake.host;
}

/**
 * Run one scenario end to end.
 *
 * Pure and total: the same scenario produces a deep-equal `WebSocketRun` every time. Every
 * timestamp is arithmetic on declared latencies, every masking key and handshake nonce comes
 * from the seeded generator in `core/sim/rng`, and no clock is read anywhere in this module.
 */
export function runWebSocketScenario(scenario: WebSocketScenario): WebSocketRun {
  const conditions: NetworkConditions = {
    rttMs: scenario.conditions?.rttMs ?? DEFAULT_RTT_MS,
    bandwidthKbps: scenario.conditions?.bandwidthKbps ?? DEFAULT_BANDWIDTH_KBPS,
  };

  const build: Build = {
    events: [],
    pdus: {},
    topology: buildTopology(conditions, scenarioHost(scenario.plan)),
    conditions,
    relayMs: scenario.relayMs ?? DEFAULT_RELAY_MS,
    phases: [],
    frames: [],
    handshakes: [],
    scenarioId: scenario.id,
    maskCounter: 0,
    client: connectingConnection('client'),
    server: connectingConnection('server'),
  };

  const plan = scenario.plan;
  const run =
    plan.kind === 'session'
      ? runSessionPlan(build, plan)
      : plan.kind === 'keepalive'
        ? runKeepalivePlan(build, plan)
        : plan.kind === 'reconnect'
          ? runReconnectPlan(build, plan)
          : runComparisonPlan(build, plan);

  const durationMs = round2(run.endsAt + TAIL_MS);

  for (const phase of build.phases) {
    build.events.push({
      kind: 'phase',
      at: phase.at,
      id: phase.id,
      title: phase.title,
      description: phase.description,
    });
  }

  // Notes are pinned by phase id, so the boundaries have to exist before a note can be
  // placed: one pass to find them, a second to fold the notes in.
  const provisional = summarizePhases(sortEvents(build.events), durationMs);
  for (const note of scenario.notes ?? []) {
    const phase = provisional.find((candidate) => candidate.id === note.phase);
    if (!phase) {
      throw new Error(
        `scenario "${scenario.id}" pins a note to phase "${note.phase}", which this run does not have. It has: ${provisional.map((each) => each.id).join(', ')}`,
      );
    }
    build.events.push({
      kind: 'annotate',
      at: phase.startMs,
      targetId: note.target ?? CLIENT_NODE,
      text: note.text,
      ...(note.reference ? { reference: note.reference } : {}),
    });
  }

  const events = sortEvents(build.events);

  return {
    scenario,
    topology: build.topology,
    result: {
      events,
      phases: summarizePhases(events, durationMs),
      durationMs,
      pdus: build.pdus,
    },
    handshakes: build.handshakes,
    frames: build.frames,
    detail: run.detail,
  };
}
