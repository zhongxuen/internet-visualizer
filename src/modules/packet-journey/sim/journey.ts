/**
 * The journey -- everything in this folder, composed into one run.
 *
 * `ethernet.ts`, `ipv4.ts`, `tcp.ts`, `udp.ts`, and `nat.ts` each know one layer and
 * nothing about time or topology. This file is where they meet a network: it walks a
 * packet from an application on one machine to an application on another and emits the
 * `SimEvent` stream that the visualization layer renders. It is the scenario `run()` the
 * phase doc asks for, and it is the only file in the module that knows what a hop is.
 *
 * ## The one idea the whole file is arranged around
 *
 * **A hop is between two layer-3 machines, not between two boxes on the diagram.**
 *
 * A frame leaving the laptop crosses an access point and a switch before it reaches the
 * router, and neither of them touches it: they forward by MAC address, never open the IP
 * header, and are invisible to a traceroute. So {@link resolveJourneyPath} groups the
 * links between consecutive layer-3 machines into one {@link JourneyHop}, and everything
 * that happens *per hop* -- the TTL decrement, the checksum, the MAC rewrite, the MTU
 * test -- happens once per hop rather than once per box. A model that decremented the
 * TTL at a switch would be teaching the single most common misconception about how the
 * Internet works, using an animation as evidence.
 *
 * ## What happens at a router, in order
 *
 * 1. **TTL decrement and checksum recomputation** ({@link forwardIpv4}). At zero the
 *    packet dies here and an ICMP Time Exceeded goes back -- which is all traceroute is.
 * 2. **NAPT translation**, if this is the NAT ({@link translateOutbound} /
 *    {@link translateInbound}). The only place on the path an IP address changes.
 * 3. **The frame is rebuilt** for the next hop ({@link rewriteFraming}). New source MAC,
 *    new destination MAC, same everything inside.
 * 4. **The MTU test.** Too large and it is either split ({@link fragmentIpv4}) or, with
 *    Don't Fragment set, dropped with an ICMP Fragmentation Needed carrying the MTU --
 *    path MTU discovery, in one exchange.
 *
 * ## Determinism
 *
 * Every number in a run comes from the scenario or from {@link createRng} seeded by it.
 * There is no `Math.random()`, no `Date.now()`, and no dependence on iteration order of
 * anything unordered, so two runs of the same scenario are deep-equal -- which
 * `scenarios/scenarios.test.ts` asserts for all four. Loss draws from its own forked
 * stream, so adding a randomised detail elsewhere later cannot silently move which
 * packet is the one that gets dropped.
 */

import { formatBytes, toHex } from '@/core/net/bytes';
import { createRng, type Rng } from '@/core/sim/rng';
import { summarizePhases, type SimResult } from '@/core/sim/result';
import type { NodeState, RfcRef, SimEvent } from '@/core/types/events';
import type { PDU, ProtocolLayer } from '@/core/types/pdu';
import type { SimLink, SimNode, Topology } from '@/core/types/topology';

import {
  ETHERNET_HEADER_BYTES,
  ETHERNET_MTU,
  buildEthernetLayer,
  encapsulateEthernet,
  decapsulateEthernet,
  ethernetFraming,
  rewriteFraming,
  type EthernetFraming,
} from './ethernet';
import {
  DEFAULT_TTL,
  IP_PROTOCOLS,
  buildIpv4Layer,
  decapsulateIpv4,
  encapsulateIpv4,
  forwardIpv4,
  fragmentIpv4,
  icmpFragmentationNeededLayer,
  icmpTimeExceededLayer,
  ipv4Header,
  ipv4TotalLength,
  reassembleIpv4,
  FRAGMENT_UNIT_BYTES,
  type Ipv4Header,
} from './ipv4';
import {
  createNatTable,
  describeFlow,
  formatEndpoint,
  translateInbound,
  translateOutbound,
  type Flow,
  type NatBinding,
  type NatTable,
} from './nat';
import {
  DEFAULT_MSS,
  buildTcpLayer,
  describeTcpSegment,
  deliverSegment,
  openTcpConnection,
  peerOf,
  sendSegment,
  splitForMss,
  tcpPdu,
  type TcpConnection,
  type TcpRole,
  type TcpSegment,
  type TcpSendSpec,
} from './tcp';
import {
  buildUdpLayer,
  describeUdpDatagram,
  udpDatagram,
  udpPdu,
  type UdpDatagram,
} from './udp';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Virtual milliseconds a host spends building or parsing a packet.
 *
 * Small on purpose. On a path where one hop costs 82 ms, the honest lesson is that the
 * machines are not the slow part.
 */
export const HOST_PROCESSING_MS = 0.4;

/** Virtual milliseconds a router spends on a forwarding decision. */
export const ROUTER_PROCESSING_MS = 0.15;

/** How long the timeline runs past the last event, so the ending can be read. */
export const JOURNEY_TAIL_MS = 40;

/**
 * The initial retransmission timeout, before any round trip has been measured.
 *
 * RFC 6298 s2.1 says one second, and this uses it rather than something more watchable,
 * because "the first timeout is a whole second" is the reason a connection that loses
 * its very first SYN feels broken rather than slow.
 */
export const INITIAL_RTO_MS = 1000;

/** RFC 6298 s2.4: however small the measured round trip, the timer never goes below this. */
export const MIN_RTO_MS = 200;

/** How many times a sender retries before the journey gives up. */
export const DEFAULT_MAX_RETRANSMISSIONS = 4;

/** RFC 793's ISN for the client, when a scenario does not choose one. */
const DEFAULT_CLIENT_ISN = 1_000_000;
/** The server's, independent of the client's and deliberately unlike it. */
const DEFAULT_SERVER_ISN = 3_500_000;

/** Where IPv4 identification numbers start. Each datagram takes the next one. */
const FIRST_IDENTIFICATION = 30_000;

// ---------------------------------------------------------------------------
// Scenario shape
// ---------------------------------------------------------------------------

/** Which end of the conversation a write comes from. */
export type JourneyRole = TcpRole;

/** The transports a journey can run over. */
export type JourneyTransport = 'tcp' | 'udp';

/** A chapter of the run, shown by the phase stepper. */
export interface JourneyPhase {
  readonly id: string;
  readonly title: string;
  readonly description: string;
}

/** A teaching note pinned to a node while a chapter is on screen. */
export interface JourneyNote {
  /** What it explains. Defaults to the machine doing the sending. */
  readonly targetId?: string;
  readonly text: string;
  readonly reference?: RfcRef;
}

/**
 * One application write: somebody calls `send()` with this many bytes.
 *
 * Over TCP the engine segments it, acknowledges it, and keeps the sequence arithmetic
 * straight. Over UDP it is one datagram, fragmented by IPv4 if it does not fit.
 */
export interface JourneyWrite {
  readonly from: JourneyRole;
  /** Application bytes. Transport and network headers are added on top of this. */
  readonly bytes: number;
  /** The application header to nest inside the segment, e.g. an HTTP request line. */
  readonly application?: ProtocolLayer;
  /** A short excerpt of the payload, for the inspector. */
  readonly preview?: string;
  /** Set Don't Fragment: the packet is to be dropped rather than split. */
  readonly dontFragment?: boolean;
  /** The chapter this write opens, if it opens one. */
  readonly phase?: JourneyPhase;
  /** A note to pin when the write leaves. */
  readonly note?: JourneyNote;
}

/** The router that performs NAPT, and the single public address it owns. */
export interface JourneyNatSpec {
  /** `SimNode.id` of the translating router. */
  readonly nodeId: string;
  /** The public address every device behind it shares. */
  readonly publicIp: string;
  /** Lowest port it will allocate. Fixed per scenario so runs are comparable. */
  readonly firstPort?: number;
}

/** A link that loses packets, and how often. */
export interface JourneyLoss {
  /** `SimLink.id` of the unreliable hop. */
  readonly linkId: string;
  /** Probability that any one packet crossing it is lost, `0`-`1`. */
  readonly rate: number;
  /** Retries before the sender gives up. Defaults to {@link DEFAULT_MAX_RETRANSMISSIONS}. */
  readonly maxRetransmissions?: number;
}

/** One complete Packet Journey scenario: a network, a path, and some traffic. */
export interface JourneyScenario {
  /** Stable id, unique in the module: `'tcp-web-request'`. */
  readonly id: string;
  readonly title: string;
  /** One or two sentences setting the scene, shown by the scenario picker. */
  readonly summary: string;
  /** What a learner should walk away understanding, as short phrases. */
  readonly teaches: readonly string[];
  readonly topology: Topology;
  /**
   * Every machine from sender to receiver, layer-2 devices included. They are grouped
   * into hops by {@link resolveJourneyPath}, not skipped.
   */
  readonly path: readonly string[];
  readonly transport: JourneyTransport;
  /** The client's ephemeral source port. */
  readonly clientPort: number;
  /** The service port on the far end. */
  readonly serverPort: number;
  /** The application writes, in order. */
  readonly writes: readonly JourneyWrite[];
  /** The translating router, if the path crosses one. */
  readonly nat?: JourneyNatSpec;
  /** Default link MTU. Defaults to Ethernet's 1500. */
  readonly mtu?: number;
  /** Per-link MTU overrides, e.g. a PPPoE access line at 1492. */
  readonly linkMtu?: Readonly<Record<string, number>>;
  /** Starting TTL. Defaults to 64. */
  readonly ttl?: number;
  /** Seeds the RNG. The same seed replays the same run exactly. */
  readonly seed: number | string;
  /** The unreliable link, if the scenario has one. */
  readonly loss?: JourneyLoss;
  /** Bytes per TCP data segment. Defaults to 1460. */
  readonly mss?: number;
  /** The client's initial sequence number. */
  readonly clientIsn?: number;
  /** The server's, independent of the client's. */
  readonly serverIsn?: number;
}

/**
 * The knobs the module UI turns.
 *
 * `JourneyControls` (phase 6.3) hands one of these to {@link runJourney} and re-runs the
 * simulation; nothing is mutated and the scenario is left as authored.
 */
export type JourneyOverrides = Partial<
  Pick<
    JourneyScenario,
    'transport' | 'mtu' | 'linkMtu' | 'ttl' | 'seed' | 'loss' | 'writes' | 'mss'
  >
>;

// ---------------------------------------------------------------------------
// The path
// ---------------------------------------------------------------------------

/** One physical link a packet crosses, in the direction it crosses it. */
export interface JourneyLinkStep {
  readonly linkId: string;
  readonly from: string;
  readonly to: string;
  readonly latencyMs: number;
  readonly bandwidthMbps?: number;
  readonly mtu: number;
}

/**
 * One layer-3 hop: from one machine that reads IP headers to the next one.
 *
 * `steps` is usually a single link, but is several when layer-2 devices sit in between --
 * `laptop -> ap -> lan-switch -> router` is **one hop** made of three links.
 */
export interface JourneyHop {
  /** `SimNode.id` of the layer-3 machine that puts the frame on the wire. */
  readonly from: string;
  /** `SimNode.id` of the next layer-3 machine. */
  readonly to: string;
  /** The links crossed, in order, including those through transparent devices. */
  readonly steps: readonly JourneyLinkStep[];
  /** The smallest MTU on this hop -- what actually constrains the packet. */
  readonly mtu: number;
}

/** A resolved path: the machines named, and the hops they add up to. */
export interface JourneyPath {
  readonly nodes: readonly string[];
  readonly hops: readonly JourneyHop[];
}

/**
 * True for a machine that forwards frames without reading the IP header.
 *
 * Switches and access points. They do not decrement the TTL, do not rewrite the MAC
 * addresses of a frame passing through, and do not appear in a traceroute -- which is
 * exactly why a hop must not end at one.
 */
function isTransparent(node: SimNode): boolean {
  return node.kind === 'switch';
}

function nodeOf(topology: Topology, id: string): SimNode {
  const node = topology.nodes.find((candidate) => candidate.id === id);
  if (!node) {
    throw new Error(`journey path names "${id}", which is not in the topology`);
  }
  return node;
}

function linkBetween(topology: Topology, from: string, to: string): SimLink {
  const link = topology.links.find(
    (candidate) =>
      (candidate.from === from && candidate.to === to) ||
      (candidate.from === to && candidate.to === from),
  );
  if (!link) {
    throw new Error(`journey path steps from "${from}" to "${to}", which are not linked`);
  }
  return link;
}

/**
 * Turn a list of machines into a list of layer-3 hops.
 *
 * Consecutive links are gathered until the path reaches a machine that reads IP headers;
 * that closes a hop. The hop's MTU is the smallest of its links', because the narrowest
 * link is what a packet has to fit through -- the whole of what path MTU discovery is
 * trying to find out.
 */
export function resolveJourneyPath(
  topology: Topology,
  nodes: readonly string[],
  linkMtu: Readonly<Record<string, number>> = {},
  defaultMtu: number = ETHERNET_MTU,
): JourneyPath {
  if (nodes.length < 2) {
    throw new Error('a journey path needs at least two machines');
  }
  if (isTransparent(nodeOf(topology, nodes[0]))) {
    throw new Error(`a journey cannot start at "${nodes[0]}", which is a layer-2 device`);
  }

  const hops: JourneyHop[] = [];
  let steps: JourneyLinkStep[] = [];
  let hopStart = nodes[0];

  for (let i = 1; i < nodes.length; i += 1) {
    const from = nodes[i - 1];
    const to = nodes[i];
    const link = linkBetween(topology, from, to);
    const step: JourneyLinkStep = {
      linkId: link.id,
      from,
      to,
      latencyMs: link.latencyMs,
      mtu: linkMtu[link.id] ?? defaultMtu,
      ...(link.bandwidthMbps === undefined ? {} : { bandwidthMbps: link.bandwidthMbps }),
    };
    steps.push(step);

    if (!isTransparent(nodeOf(topology, to))) {
      hops.push({
        from: hopStart,
        to,
        steps,
        mtu: Math.min(...steps.map((entry) => entry.mtu)),
      });
      steps = [];
      hopStart = to;
    }
  }

  if (steps.length > 0) {
    throw new Error(
      `a journey cannot end at "${nodes[nodes.length - 1]}", which is a layer-2 device`,
    );
  }

  return { nodes: [...nodes], hops };
}

/** The same hops walked the other way, for the return leg. */
export function reverseHops(hops: readonly JourneyHop[]): JourneyHop[] {
  return [...hops].reverse().map((hop) => ({
    from: hop.to,
    to: hop.from,
    mtu: hop.mtu,
    steps: [...hop.steps]
      .reverse()
      .map((step) => ({ ...step, from: step.to, to: step.from })),
  }));
}

/** Round-trip time across the whole path for a packet of this size, in virtual ms. */
export function pathRoundTripMs(path: JourneyPath, sizeBytes: number): number {
  const oneWay = path.hops.reduce(
    (total, hop) =>
      total + hop.steps.reduce((sum, step) => sum + transmissionMs(step, sizeBytes), 0),
    0,
  );
  return round3(oneWay * 2);
}

/**
 * How long a PDU takes to get from one end of a link to the other.
 *
 * Propagation delay (how far away the far end is) plus serialization delay (how long the
 * interface takes to clock the bytes out). The second term is why a big packet is slower
 * than a small one on a slow link and indistinguishable from it on a fast one.
 */
function transmissionMs(step: JourneyLinkStep, sizeBytes: number): number {
  const serialization = step.bandwidthMbps
    ? (sizeBytes * 8) / (step.bandwidthMbps * 1000)
    : 0;
  return round3(step.latencyMs + serialization);
}

/** Milliseconds, to three places. Keeps timeline arithmetic readable and exact. */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// The packet as it travels
// ---------------------------------------------------------------------------

/** What a packet is carrying, held as state so a hop can rewrite one field of it. */
type JourneyTransportUnit =
  | { readonly kind: 'tcp'; readonly segment: TcpSegment }
  | { readonly kind: 'udp'; readonly datagram: UdpDatagram }
  | { readonly kind: 'icmp'; readonly layer: ProtocolLayer; readonly label: string };

/**
 * A packet in flight, as **state rather than as a rendered PDU**.
 *
 * The PDU is derived from this by {@link renderPacket} whenever an event needs one, which
 * is what keeps the hop table, the inspector, and the encapsulation panel from ever
 * disagreeing: there is one description of the packet, and three views of it.
 */
interface JourneyPacket {
  readonly id: string;
  readonly header: Ipv4Header;
  readonly framing: EthernetFraming;
  readonly unit: JourneyTransportUnit;
  readonly application?: ProtocolLayer;
  /** Prefixed to the summary, e.g. `'[Retransmission] '`. */
  readonly tag?: string;
}

/** The IANA protocol number for whatever this packet carries. */
function protocolOf(unit: JourneyTransportUnit): number {
  switch (unit.kind) {
    case 'tcp':
      return IP_PROTOCOLS.tcp;
    case 'udp':
      return IP_PROTOCOLS.udp;
    default:
      return IP_PROTOCOLS.icmp;
  }
}

/** The transport (and application) headers -- present only on the first fragment. */
function innerLayers(packet: JourneyPacket): ProtocolLayer[] {
  if (packet.header.fragmentOffset !== 0) {
    // Everything after the first fragment is raw payload: the transport header was in
    // the piece that went before it. This is why a firewall cannot filter a later
    // fragment on port number, and why the destination has to hold the pieces until the
    // first one turns up.
    return [];
  }
  switch (packet.unit.kind) {
    case 'tcp':
      return [
        buildTcpLayer(packet.unit.segment),
        ...(packet.application ? [packet.application] : []),
      ];
    case 'udp':
      return [
        buildUdpLayer(packet.unit.datagram),
        ...(packet.application ? [packet.application] : []),
      ];
    default:
      return [packet.unit.layer];
  }
}

/** The one-line description a packet analyser would print for this packet. */
function summarize(packet: JourneyPacket): string {
  const { header } = packet;
  const tag = packet.tag ?? '';

  if (header.fragmentOffset !== 0) {
    return `${tag}IPv4 fragment of #${header.identification}, offset ${
      header.fragmentOffset * FRAGMENT_UNIT_BYTES
    }, ${header.payloadBytes} bytes${header.moreFragments ? ', more to come' : ', last'}`;
  }

  const fragment = header.moreFragments
    ? ` [fragment 1 of #${header.identification}]`
    : '';

  switch (packet.unit.kind) {
    case 'tcp':
      return `${tag}TCP ${describeTcpSegment(packet.unit.segment)}${fragment}`;
    case 'udp':
      return `${tag}UDP ${describeUdpDatagram(packet.unit.datagram)}${fragment}`;
    default:
      return `${tag}ICMP ${packet.unit.label} ${header.sourceIp} -> ${header.destinationIp}`;
  }
}

/** The packet as the renderer sees it: Ethernet, IPv4, then whatever is inside. */
function renderPacket(packet: JourneyPacket): PDU {
  return {
    id: packet.id,
    layers: [
      buildEthernetLayer(packet.framing),
      buildIpv4Layer(packet.header),
      ...innerLayers(packet),
    ],
    sizeBytes: ETHERNET_HEADER_BYTES + ipv4TotalLength(packet.header),
    summary: summarize(packet),
  };
}

/** The five-tuple this packet belongs to, or `undefined` if it carries no ports. */
function flowOf(packet: JourneyPacket): Flow | undefined {
  if (packet.header.fragmentOffset !== 0) return undefined;
  const ports =
    packet.unit.kind === 'tcp'
      ? {
          source: packet.unit.segment.sourcePort,
          destination: packet.unit.segment.destinationPort,
        }
      : packet.unit.kind === 'udp'
        ? {
            source: packet.unit.datagram.sourcePort,
            destination: packet.unit.datagram.destinationPort,
          }
        : undefined;
  if (!ports) return undefined;

  return {
    protocol: packet.unit.kind === 'tcp' ? 'tcp' : 'udp',
    source: { ip: packet.header.sourceIp, port: ports.source },
    destination: { ip: packet.header.destinationIp, port: ports.destination },
  };
}

/** Rewrite the source address and port: what a NAT does on the way out. */
function applyOutboundTranslation(
  packet: JourneyPacket,
  binding: NatBinding,
): JourneyPacket {
  const header = { ...packet.header, sourceIp: binding.insideGlobal.ip };
  const port = binding.insideGlobal.port;
  return { ...packet, header, unit: withSourcePort(packet.unit, port) };
}

/** Put the private address and port back: the same row, read the other way. */
function applyInboundTranslation(
  packet: JourneyPacket,
  binding: NatBinding,
): JourneyPacket {
  const header = { ...packet.header, destinationIp: binding.insideLocal.ip };
  const port = binding.insideLocal.port;
  return { ...packet, header, unit: withDestinationPort(packet.unit, port) };
}

function withSourcePort(unit: JourneyTransportUnit, port: number): JourneyTransportUnit {
  if (unit.kind === 'tcp')
    return { ...unit, segment: { ...unit.segment, sourcePort: port } };
  if (unit.kind === 'udp')
    return { ...unit, datagram: { ...unit.datagram, sourcePort: port } };
  return unit;
}

function withDestinationPort(
  unit: JourneyTransportUnit,
  port: number,
): JourneyTransportUnit {
  if (unit.kind === 'tcp')
    return { ...unit, segment: { ...unit.segment, destinationPort: port } };
  if (unit.kind === 'udp')
    return { ...unit, datagram: { ...unit.datagram, destinationPort: port } };
  return unit;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/** A scenario with every default filled in, so nothing downstream has to guess. */
interface ResolvedConfig extends JourneyScenario {
  readonly mtu: number;
  readonly linkMtu: Readonly<Record<string, number>>;
  readonly ttl: number;
  readonly mss: number;
  readonly clientIsn: number;
  readonly serverIsn: number;
}

/** Everything one run accumulates. Mutable, local, and never shared between runs. */
interface JourneyRun {
  readonly config: ResolvedConfig;
  readonly topology: Topology;
  readonly path: JourneyPath;
  readonly events: SimEvent[];
  readonly pdus: Record<string, PDU>;
  /** Its own stream, so other draws cannot shift which packet is lost. */
  readonly lossRng: Rng;
  nat?: NatTable;
  /**
   * The row the client's flow was translated onto, as the far end sees it.
   *
   * This is the whole illusion NAPT creates: the server believes it is talking to
   * `203.0.113.7:60000` and addresses its replies there, because that is the only
   * address it has ever seen. The private one behind it is not its business, and the
   * router is the only machine that can put it back.
   */
  binding?: NatBinding;
  /** Virtual time the next application action happens at. */
  clock: number;
  /** Furthest virtual time any event reaches, used to size the timeline. */
  end: number;
  /** Smoothed round trip, once one has been measured. Drives the RTO. */
  srtt?: number;
  pduSeq: number;
  identification: number;
}

/** What a datagram picked up on its way across: NAT state and what arrived. */
interface DatagramMemo {
  /** The NAT row this datagram matched, shared by all of its fragments. */
  binding?: NatBinding;
  /** Headers of the pieces that reached the far end, so they can be reassembled. */
  readonly arrived: Ipv4Header[];
  /** The last packet state of each piece, for the arrival narration. */
  readonly arrivedPackets: JourneyPacket[];
}

/** Whether a delivery succeeded, and when it finished either way. */
interface DeliveryResult {
  readonly delivered: boolean;
  readonly at: number;
  readonly reason?: string;
}

// --- Event helpers ---------------------------------------------------------

function emit(run: JourneyRun, event: SimEvent): void {
  run.events.push(event);
  const reach = event.kind === 'transmit' ? event.at + event.durationMs : event.at;
  run.end = Math.max(run.end, reach);
}

function phase(run: JourneyRun, at: number, chapter: JourneyPhase): void {
  emit(run, { kind: 'phase', at: round3(at), ...chapter });
}

function log(
  run: JourneyRun,
  at: number,
  level: 'info' | 'warn' | 'error',
  text: string,
): void {
  emit(run, { kind: 'log', at: round3(at), level, text });
}

function annotate(
  run: JourneyRun,
  at: number,
  note: JourneyNote,
  fallbackTarget: string,
): void {
  emit(run, {
    kind: 'annotate',
    at: round3(at),
    targetId: note.targetId ?? fallbackTarget,
    text: note.text,
    ...(note.reference ? { reference: note.reference } : {}),
  });
}

function nodeState(
  run: JourneyRun,
  at: number,
  nodeId: string,
  state: NodeState,
  note?: string,
): void {
  emit(run, {
    kind: 'node-state',
    at: round3(at),
    nodeId,
    state,
    ...(note === undefined ? {} : { note }),
  });
}

function created(run: JourneyRun, at: number, atNode: string, pdu: PDU): void {
  run.pdus[pdu.id] = pdu;
  emit(run, { kind: 'pdu-created', at: round3(at), pdu, atNode });
}

function transformed(
  run: JourneyRun,
  at: number,
  atNode: string,
  before: PDU,
  after: PDU,
  reason: string,
): void {
  emit(run, {
    kind: 'pdu-transform',
    at: round3(at),
    pduId: after.id,
    before,
    after,
    atNode,
    reason,
  });
}

function dropped(
  run: JourneyRun,
  at: number,
  atNode: string,
  pduId: string,
  reason: string,
): void {
  emit(run, { kind: 'drop', at: round3(at), pduId, atNode, reason });
  nodeState(run, at, atNode, 'error', reason);
}

// --- Topology lookups ------------------------------------------------------

function macOf(run: JourneyRun, nodeId: string): string {
  const node = nodeOf(run.topology, nodeId);
  if (!node.mac) {
    throw new Error(
      `"${nodeId}" is on the journey path but has no MAC address; a layer-3 hop cannot be framed without one`,
    );
  }
  return node.mac;
}

function ipOf(run: JourneyRun, nodeId: string): string {
  const node = nodeOf(run.topology, nodeId);
  if (!node.ipv4) {
    throw new Error(`"${nodeId}" is an endpoint of the journey but has no IPv4 address`);
  }
  return node.ipv4;
}

function labelOf(run: JourneyRun, nodeId: string): string {
  return nodeOf(run.topology, nodeId).label;
}

/** Framing for one hop: this machine's MAC, and the next machine's. */
function framingFor(run: JourneyRun, hop: JourneyHop): EthernetFraming {
  return ethernetFraming(macOf(run, hop.from), macOf(run, hop.to));
}

// ---------------------------------------------------------------------------
// Carrying a packet across hops
// ---------------------------------------------------------------------------

/**
 * Walk one packet along `hops`, doing at every router exactly what a router does.
 *
 * `hops[0].from` is where the packet already is; the forwarding work (TTL, NAT, reframe,
 * MTU) happens at the *start* of every hop after the first, because that is the machine
 * doing the forwarding. The origin's frame was built when the packet was created.
 *
 * Recurses on fragmentation: each fragment continues along the remaining hops on its own,
 * because from the moment it is split each piece is a full datagram that routers treat
 * independently -- and may not even send the same way.
 */
function carry(
  run: JourneyRun,
  hops: readonly JourneyHop[],
  start: JourneyPacket,
  at: number,
  direction: 'outbound' | 'inbound',
  memo: DatagramMemo,
): DeliveryResult {
  let packet = start;
  let now = at;

  for (let index = 0; index < hops.length; index += 1) {
    const hop = hops[index];
    // The packet exactly as it reached this machine. An ICMP error has to quote *this*
    // -- before the TTL was touched and before any translation -- because it is what the
    // sender will recognise as its own.
    const arrived = packet;

    if (index > 0) {
      // --- This machine forwards. It arrived here; now it has to leave. ----------
      nodeState(run, now, hop.from, 'processing', 'routing decision');
      now += ROUTER_PROCESSING_MS;

      // 1. TTL and the checksum that covers it.
      const forwarded = forwardIpv4(packet.header);
      const decremented: JourneyPacket = { ...packet, header: forwarded.header };
      if (forwarded.expired) {
        dropped(
          run,
          now,
          hop.from,
          packet.id,
          `TTL reached 0 at ${labelOf(run, hop.from)}; the packet goes no further`,
        );
        sendIcmpBack(
          run,
          hops,
          index,
          arrived,
          icmpTimeExceededLayer(arrived.header),
          'Time Exceeded',
          now,
          direction,
        );
        return { delivered: false, at: now, reason: 'TTL expired' };
      }
      transformed(
        run,
        now,
        hop.from,
        renderPacket(packet),
        renderPacket(decremented),
        `TTL ${packet.header.ttl} -> ${forwarded.header.ttl}, header checksum recomputed ${toHex(
          forwarded.previousChecksum,
          { bits: 16 },
        )} -> ${toHex(forwarded.checksum, { bits: 16 })}. The addresses are untouched.`,
      );
      packet = decremented;

      // 2. NAPT, at the one machine on the path that changes an address.
      const translated = applyNat(run, hop.from, packet, now, direction, memo);
      if (!translated.ok) {
        return { delivered: false, at: now, reason: translated.reason };
      }
      packet = translated.packet;

      // 3. The frame is thrown away and rebuilt for the next wire.
      const reframed: JourneyPacket = {
        ...packet,
        framing: rewriteFraming(packet.framing, {
          sourceMac: macOf(run, hop.from),
          destinationMac: macOf(run, hop.to),
        }),
      };
      transformed(
        run,
        now,
        hop.from,
        renderPacket(packet),
        renderPacket(reframed),
        `Frame re-addressed for the next hop: ${packet.framing.sourceMac} -> ${packet.framing.destinationMac} becomes ${reframed.framing.sourceMac} -> ${reframed.framing.destinationMac}. Both IP addresses are unchanged.`,
      );
      packet = reframed;
      nodeState(run, now, hop.from, 'active');
    }

    // --- Will it fit on this hop? ---------------------------------------------
    const totalLength = ipv4TotalLength(packet.header);
    if (totalLength > hop.mtu) {
      const split = fragmentIpv4(packet.header, hop.mtu);

      if (split.kind === 'blocked') {
        dropped(
          run,
          now,
          hop.from,
          packet.id,
          `${totalLength} bytes will not fit the ${hop.mtu}-byte MTU of ${hop.steps
            .map((step) => step.linkId)
            .join(' + ')}, and Don't Fragment is set`,
        );
        log(
          run,
          now,
          'warn',
          `${labelOf(run, hop.from)}: cannot forward ${totalLength} bytes onto a ${hop.mtu}-byte link with DF set -- reporting the MTU instead`,
        );
        if (index > 0) {
          sendIcmpBack(
            run,
            hops,
            index,
            arrived,
            icmpFragmentationNeededLayer(arrived.header, hop.mtu),
            'Fragmentation Needed',
            now,
            direction,
          );
        }
        return { delivered: false, at: now, reason: 'fragmentation needed' };
      }

      if (split.kind === 'fragmented') {
        return fanOutFragments(
          run,
          hops,
          index,
          packet,
          split.fragments,
          now,
          direction,
          memo,
        );
      }
    }

    // --- On the wire, one physical link at a time -----------------------------
    const sizeBytes = ETHERNET_HEADER_BYTES + totalLength;
    for (const step of hop.steps) {
      const duration = transmissionMs(step, sizeBytes);
      emit(run, {
        kind: 'transmit',
        at: round3(now),
        pduId: packet.id,
        from: step.from,
        to: step.to,
        durationMs: duration,
        linkId: step.linkId,
      });
      now += duration;

      const { loss } = run.config;
      if (loss && step.linkId === loss.linkId && run.lossRng.chance(loss.rate)) {
        dropped(
          run,
          now,
          step.to,
          packet.id,
          `lost in transit on ${step.linkId}: the sender is told nothing and will only find out when its timer expires`,
        );
        return { delivered: false, at: now, reason: 'lost on the link' };
      }

      if (step.to !== hop.to) {
        // A layer-2 device. It forwards the frame by destination MAC and never opens
        // the IP header -- no TTL decrement, no rewrite, nothing to see in a traceroute.
        nodeState(run, now, step.to, 'processing', 'forwarding by MAC address');
        nodeState(run, now + 0.001, step.to, 'idle');
      }
    }
  }

  memo.arrived.push(packet.header);
  memo.arrivedPackets.push(packet);
  return { delivered: true, at: now };
}

/**
 * Split a packet at the hop it does not fit, and send each piece on independently.
 *
 * Each fragment leaves after the one before it has finished being clocked onto the wire,
 * which is why they arrive spread out rather than together.
 */
function fanOutFragments(
  run: JourneyRun,
  hops: readonly JourneyHop[],
  index: number,
  packet: JourneyPacket,
  fragments: readonly Ipv4Header[],
  now: number,
  direction: 'outbound' | 'inbound',
  memo: DatagramMemo,
): DeliveryResult {
  const hop = hops[index];
  const remaining = hops.slice(index);
  const sizes = fragments.map((header) => header.payloadBytes);

  log(
    run,
    now,
    'info',
    `${labelOf(run, hop.from)}: ${ipv4TotalLength(packet.header)} bytes do not fit the ${
      hop.mtu
    }-byte MTU, so the datagram is split into ${fragments.length} fragments of ${sizes.join(
      ' + ',
    )} payload bytes`,
  );
  emit(run, {
    kind: 'annotate',
    at: round3(now),
    targetId: hop.from,
    text: `Fragment offsets count 8-byte units, not bytes. The second piece starts at byte ${
      (fragments[1]?.fragmentOffset ?? 0) * FRAGMENT_UNIT_BYTES
    } of the original and so carries offset ${
      fragments[1]?.fragmentOffset ?? 0
    } -- which is also why every fragment but the last has to carry a multiple of 8 bytes. More Fragments is set on all but the last, and only the destination may put them back together.`,
    reference: { rfc: 791, section: '3.2', title: 'Internet Protocol' },
  });

  let departure = now;
  let latest = now;
  let delivered = true;
  let reason: string | undefined;

  fragments.forEach((header, position) => {
    const piece: JourneyPacket = {
      ...packet,
      id: `${packet.id}-f${position + 1}`,
      header,
    };
    const pdu = renderPacket(piece);
    created(run, departure, hop.from, pdu);

    const result = carry(run, remaining, piece, departure, direction, memo);
    latest = Math.max(latest, result.at);
    if (!result.delivered) {
      delivered = false;
      reason = result.reason ?? reason;
    }

    // The next fragment cannot leave until this one is off the interface.
    departure += transmissionMs(hop.steps[0], pdu.sizeBytes);
  });

  return delivered
    ? { delivered: true, at: latest }
    : { delivered: false, at: latest, ...(reason === undefined ? {} : { reason }) };
}

/** The NAPT step, when this machine is the translating router. */
function applyNat(
  run: JourneyRun,
  nodeId: string,
  packet: JourneyPacket,
  at: number,
  direction: 'outbound' | 'inbound',
  memo: DatagramMemo,
): { ok: true; packet: JourneyPacket } | { ok: false; reason: string } {
  const spec = run.config.nat;
  if (!spec || spec.nodeId !== nodeId || !run.nat) {
    return { ok: true, packet };
  }

  const flow = flowOf(packet);

  // A fragment past the first carries no ports, so it cannot be looked up on its own.
  // A real NAPT tracks it by IP identification against the row the first fragment made,
  // which is what the shared memo is standing in for here.
  if (!flow) {
    // A NAPT keys a portless fragment off the IPv4 identification of the datagram it
    // belongs to; `memo` is that lookup, scoped to one datagram, with the run-level row
    // as the fallback for a reply whose first fragment opened it.
    const known = memo.binding ?? run.binding;
    if (!known) {
      return {
        ok: false,
        reason: 'a later fragment arrived before the row it belongs to existed',
      };
    }
    const translated =
      direction === 'outbound'
        ? { ...packet, header: { ...packet.header, sourceIp: known.insideGlobal.ip } }
        : {
            ...packet,
            header: { ...packet.header, destinationIp: known.insideLocal.ip },
          };
    transformed(
      run,
      at,
      nodeId,
      renderPacket(packet),
      renderPacket(translated),
      `NAPT: this fragment carries no ports, so it is matched to the row by IPv4 identification #${packet.header.identification} instead`,
    );
    return { ok: true, packet: translated };
  }

  if (direction === 'outbound') {
    const result = translateOutbound(run.nat, flow, at);
    if (result.kind === 'exhausted') {
      dropped(run, at, nodeId, packet.id, 'no free translation port: the table is full');
      return { ok: false, reason: 'NAT port exhaustion' };
    }
    run.nat = result.table;
    memo.binding = result.binding;
    run.binding = result.binding;

    const translated = applyOutboundTranslation(packet, result.binding);
    transformed(
      run,
      at,
      nodeId,
      renderPacket(packet),
      renderPacket(translated),
      `NAPT: source ${formatEndpoint(flow.source)} becomes ${formatEndpoint(
        result.binding.insideGlobal,
      )}. The destination is untouched.`,
    );
    if (result.created) {
      log(
        run,
        at,
        'info',
        `NAT table: new row ${describeFlow(flow)} via ${formatEndpoint(result.binding.insideGlobal)}`,
      );
      emit(run, {
        kind: 'annotate',
        at: round3(at),
        targetId: nodeId,
        text: `The router wrote this row down so it can undo the rewrite when the reply comes back. A packet arriving from outside that matches no row has no address to be delivered to -- which is the whole reason an inbound service needs port forwarding.`,
        reference: {
          rfc: 3022,
          section: '2.2',
          title: 'Traditional IP Network Address Translator',
        },
      });
    }
    return { ok: true, packet: translated };
  }

  const result = translateInbound(run.nat, flow, at);
  if (result.kind === 'unmatched') {
    dropped(run, at, nodeId, packet.id, result.reason);
    return { ok: false, reason: result.reason };
  }
  run.nat = result.table;
  memo.binding = result.binding;

  const translated = applyInboundTranslation(packet, result.binding);
  transformed(
    run,
    at,
    nodeId,
    renderPacket(packet),
    renderPacket(translated),
    `NAPT reversed: destination ${formatEndpoint(flow.destination)} becomes ${formatEndpoint(
      result.binding.insideLocal,
    )}, from the row this conversation created on the way out.`,
  );
  return { ok: true, packet: translated };
}

/**
 * Send an ICMP error back to whoever sent the packet that could not be forwarded.
 *
 * It retraces the hops already crossed, which is why the sender learns about a problem
 * that happened somewhere it has never heard of. `quoted` is the packet **as it arrived**
 * at this router -- before the TTL decrement and before any translation -- because that
 * is what the sender will recognise.
 */
function sendIcmpBack(
  run: JourneyRun,
  hops: readonly JourneyHop[],
  index: number,
  quoted: JourneyPacket,
  layer: ProtocolLayer,
  label: string,
  at: number,
  direction: 'outbound' | 'inbound',
): void {
  const back = reverseHops(hops.slice(0, index));
  if (back.length === 0) return;

  const origin = back[0].from;
  const header = ipv4Header({
    sourceIp: ipOf(run, origin),
    destinationIp: quoted.header.sourceIp,
    protocol: IP_PROTOCOLS.icmp,
    payloadBytes: 8 + 28,
    ttl: run.config.ttl,
    identification: run.identification++,
  });
  const packet: JourneyPacket = {
    id: nextPduId(run, 'icmp'),
    header,
    framing: framingFor(run, back[0]),
    unit: { kind: 'icmp', layer, label },
  };

  created(run, at + ROUTER_PROCESSING_MS, origin, renderPacket(packet));
  log(
    run,
    at + ROUTER_PROCESSING_MS,
    'warn',
    `${labelOf(run, origin)}: sending ICMP ${label} back to ${quoted.header.sourceIp}`,
  );

  const result = carry(
    run,
    back,
    packet,
    at + ROUTER_PROCESSING_MS,
    direction === 'outbound' ? 'inbound' : 'outbound',
    freshMemo(),
  );

  if (result.delivered) {
    const learner = back[back.length - 1].to;
    log(
      run,
      result.at,
      'info',
      `${labelOf(run, learner)}: ICMP ${label} received from ${header.sourceIp}`,
    );
    emit(run, {
      kind: 'annotate',
      at: round3(result.at),
      targetId: learner,
      text:
        label === 'Fragmentation Needed'
          ? 'The sender did not know the path had a narrower link on it. It knows now, because the router that could not forward the packet reported the number it could not exceed -- and retrying at that size is the entirety of path MTU discovery. When a firewall blocks these messages, the connection hangs instead of failing, which is the classic PMTU black hole.'
          : 'The sender learns that its packet died in transit, and where. Sending a packet with TTL 1, then 2, then 3, and reading the address off each of these replies is the whole of traceroute.',
      reference:
        label === 'Fragmentation Needed'
          ? { rfc: 1191, title: 'Path MTU Discovery' }
          : { rfc: 792, title: 'Internet Control Message Protocol' },
    });
  }
}

function freshMemo(): DatagramMemo {
  return { arrived: [], arrivedPackets: [] };
}

function nextPduId(run: JourneyRun, prefix: string): string {
  run.pduSeq += 1;
  return `${prefix}-${String(run.pduSeq).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Sending one datagram, end to end
// ---------------------------------------------------------------------------

/**
 * Build the stack, hand it to the path, and take it apart again at the far end.
 *
 * The encapsulation and decapsulation steps are emitted as `pdu-transform` events rather
 * than done silently, because watching a header be prepended and then stripped -- with
 * the byte count moving each time -- is the entire content of the `EncapsulationPanel`.
 */
function deliverDatagram(
  run: JourneyRun,
  hops: readonly JourneyHop[],
  id: string,
  unit: JourneyTransportUnit,
  application: ProtocolLayer | undefined,
  at: number,
  options: { dontFragment?: boolean; tag?: string },
): DeliveryResult {
  const originId = hops[0].from;
  const destinationId = hops[hops.length - 1].to;
  const direction = originId === run.path.nodes[0] ? 'outbound' : 'inbound';

  nodeState(run, at, originId, 'processing', 'building headers');

  // A reply is addressed to what the far end actually saw, which behind a NAPT is the
  // router's public address and the port it allocated -- not the private address, which
  // the server has never been told and could not route to if it had been.
  const replyTo = direction === 'inbound' ? run.binding : undefined;
  const outgoing = replyTo ? withDestinationPort(unit, replyTo.insideGlobal.port) : unit;
  const destinationIp = replyTo ? replyTo.insideGlobal.ip : ipOf(run, destinationId);

  // 1. The innermost PDU: the transport header around the application data.
  const inner =
    outgoing.kind === 'tcp'
      ? tcpPdu(id, outgoing.segment, application)
      : outgoing.kind === 'udp'
        ? udpPdu(id, outgoing.datagram, application)
        : {
            id,
            layers: [outgoing.layer],
            sizeBytes: 8,
            summary: `ICMP ${outgoing.label}`,
          };
  created(run, at, originId, inner);

  // 2. The IPv4 header goes on the front. `payloadBytes` comes from what it is carrying.
  const header = ipv4Header({
    sourceIp: ipOf(run, originId),
    destinationIp,
    protocol: protocolOf(outgoing),
    payloadBytes: inner.sizeBytes,
    ttl: run.config.ttl,
    identification: run.identification++,
    ...(options.dontFragment ? { dontFragment: true } : {}),
  });
  const withIp = encapsulateIpv4(inner, header);
  transformed(
    run,
    at,
    originId,
    inner,
    withIp,
    `IPv4 header prepended: ${inner.sizeBytes} bytes become ${withIp.sizeBytes}. This header is the one that survives every hop.`,
  );

  // 3. The Ethernet frame goes around that -- addressed to the next machine on the wire,
  //    which is the gateway and not the far end.
  const framing = framingFor(run, hops[0]);
  const withEthernet = encapsulateEthernet(withIp, framing);
  const packet: JourneyPacket = {
    id,
    header,
    framing,
    unit: outgoing,
    ...(application ? { application } : {}),
    ...(options.tag ? { tag: options.tag } : {}),
  };
  transformed(
    run,
    at,
    originId,
    withIp,
    renderPacket(packet),
    `Ethernet frame prepended: ${withIp.sizeBytes} bytes become ${withEthernet.sizeBytes}, addressed to ${framing.destinationMac} -- the next machine on this wire, not the destination.`,
  );
  run.pdus[id] = renderPacket(packet);
  nodeState(run, at + HOST_PROCESSING_MS, originId, 'active');

  // 4. Across the network.
  const memo = freshMemo();
  const result = carry(run, hops, packet, at + HOST_PROCESSING_MS, direction, memo);
  if (!result.delivered) {
    return result;
  }

  // 5. Arrival: reassemble if it came in pieces, then unwrap.
  const arrivalTime = result.at;
  nodeState(run, arrivalTime, destinationId, 'processing', 'receiving');

  let landed = memo.arrivedPackets[memo.arrivedPackets.length - 1];
  if (memo.arrived.length > 1) {
    const rejoined = reassembleIpv4(memo.arrived);
    if (rejoined.kind !== 'complete') {
      dropped(
        run,
        arrivalTime,
        destinationId,
        id,
        `reassembly failed: ${rejoined.reason}`,
      );
      return { delivered: false, at: arrivalTime, reason: rejoined.reason };
    }
    landed = { ...landed, id, header: rejoined.header };
    created(run, arrivalTime, destinationId, renderPacket(landed));
    log(
      run,
      arrivalTime,
      'info',
      `${labelOf(run, destinationId)}: ${memo.arrived.length} fragments reassembled into one ${ipv4TotalLength(
        rejoined.header,
      )}-byte datagram`,
    );
    emit(run, {
      kind: 'annotate',
      at: round3(arrivalTime),
      targetId: destinationId,
      text: 'Only the destination reassembles. Every router in between forwarded the fragments as ordinary packets and had no idea they belonged together -- which is why losing any one of them costs the whole datagram.',
      reference: { rfc: 791, section: '3.2', title: 'Internet Protocol' },
    });
  }

  const arrived = renderPacket(landed);
  const withoutFrame = decapsulateEthernet(arrived);
  transformed(
    run,
    arrivalTime,
    destinationId,
    arrived,
    withoutFrame,
    `Ethernet header stripped: the frame did its one job, getting the packet across the last wire. ${arrived.sizeBytes} bytes become ${withoutFrame.sizeBytes}.`,
  );
  const withoutIp = decapsulateIpv4(withoutFrame);
  transformed(
    run,
    arrivalTime,
    destinationId,
    withoutFrame,
    withoutIp,
    `IPv4 header stripped: ${withoutFrame.sizeBytes} bytes become ${withoutIp.sizeBytes}, and what is left is what the application sent.`,
  );

  return { delivered: true, at: arrivalTime };
}

// ---------------------------------------------------------------------------
// TCP
// ---------------------------------------------------------------------------

const HANDSHAKE_PHASE: JourneyPhase = {
  id: 'handshake',
  title: 'TCP handshake',
  description:
    'SYN, SYN-ACK, ACK. Each end tells the other where its sequence numbers start, and the SYN itself takes one of them.',
};

const TEARDOWN_PHASE: JourneyPhase = {
  id: 'teardown',
  title: 'Connection teardown',
  description:
    'FIN, ACK, FIN, ACK. Each direction closes separately, which is why teardown takes four segments where the handshake took three.',
};

/** RFC 6298: three times the smoothed round trip, never below 200 ms, doubled per retry. */
function rtoMs(run: JourneyRun, attempt: number): number {
  const base =
    run.srtt === undefined ? INITIAL_RTO_MS : Math.max(MIN_RTO_MS, round3(3 * run.srtt));
  return round3(base * 2 ** (attempt - 1));
}

function hopsFor(run: JourneyRun, role: JourneyRole): readonly JourneyHop[] {
  return role === 'client' ? run.path.hops : reverseHops(run.path.hops);
}

/**
 * Open a connection, move the scenario's writes, close it -- with every segment actually
 * crossing the network in between.
 *
 * This is deliberately *not* `tcpExchange`, which sends and delivers in one atomic step.
 * A journey has to put a segment on the wire, watch it cross five routers, and only then
 * hand it to the receiver -- and sometimes not hand it over at all. Splitting
 * `sendSegment` from `deliverSegment` is what makes the lossy scenario expressible at
 * all: the sender's `sndNxt` has moved and the receiver's `rcvNxt` has not.
 */
function runTcpJourney(run: JourneyRun): void {
  const { config } = run;
  let connection: TcpConnection = openTcpConnection({
    clientPort: config.clientPort,
    serverPort: config.serverPort,
    clientIsn: config.clientIsn,
    serverIsn: config.serverIsn,
  });

  const send = (
    role: JourneyRole,
    spec: TcpSendSpec,
    note: string,
    application?: ProtocolLayer,
  ): boolean => {
    const sent = sendSegment(connection, role, spec);
    connection = sent.connection;
    const departure = run.clock;

    let attempt = 0;
    let attemptAt = departure;
    let result = attemptTcpSend(run, role, sent.segment, application, attemptAt, attempt);

    const maxRetries = config.loss?.maxRetransmissions ?? DEFAULT_MAX_RETRANSMISSIONS;
    while (!result.delivered && attempt < maxRetries) {
      attempt += 1;
      const timeout = rtoMs(run, attempt);
      // The timer restarts from the last attempt, not from the first: RFC 6298 s5.5
      // doubles the interval on every expiry, so the waits stack up rather than
      // overlapping. This is why a connection over a badly lossy path degrades so fast.
      const retryAt = round3(attemptAt + timeout);
      attemptAt = retryAt;
      log(
        run,
        retryAt,
        'warn',
        `${cap(role)}: no acknowledgement after ${timeout} ms -- the retransmission timer expired. Resending the same segment, with the same sequence number.`,
      );
      emit(run, {
        kind: 'annotate',
        at: retryAt,
        targetId: endpointNode(run, role),
        text: `Nothing told the sender the segment was lost. It found out by waiting: no ACK arrived before the timer ran out, so it sends the same bytes again with the same sequence number, and the receiver will recognise a duplicate if the first copy turns up after all.`,
        reference: {
          rfc: 6298,
          section: '5',
          title: 'Computing TCP’s Retransmission Timer',
        },
      });
      result = attemptTcpSend(run, role, sent.segment, application, retryAt, attempt);
    }

    if (!result.delivered) {
      log(
        run,
        result.at,
        'error',
        `${cap(role)}: gave up after ${maxRetries} retransmissions. A real stack would reset the connection here.`,
      );
      run.clock = result.at + HOST_PROCESSING_MS;
      return false;
    }

    // Only now has the far end seen it. Everything about the receiver's state -- its
    // rcvNxt, its ACK, its place in the state machine -- follows from this call.
    const delivered = deliverSegment(connection, peerOf(role), sent.segment);
    connection = delivered.connection;

    // Karn's algorithm (RFC 6298 s3): a segment that had to be retransmitted gives no
    // usable round-trip sample, because there is no way to tell whether the ACK answers
    // the original or the copy -- and guessing wrong poisons the timer in whichever
    // direction hurts most. Only a first-attempt delivery is measured.
    //
    // What is measured is the one-way delivery doubled, because on this symmetric path
    // that is exactly what the acknowledgement's round trip would have come to.
    if (attempt === 0 && run.srtt === undefined) {
      run.srtt = round3(2 * (result.at - departure));
    }

    log(
      run,
      result.at,
      'info',
      `${describeTcpSegment(sent.segment)} -- ${note} [client ${connection.client.state}, server ${connection.server.state}]`,
    );
    run.clock = result.at + HOST_PROCESSING_MS;
    return true;
  };

  // --- Three-way handshake ---------------------------------------------------
  phase(run, run.clock, HANDSHAKE_PHASE);
  annotate(
    run,
    run.clock,
    {
      text: `The client picks an initial sequence number and offers it. Nothing is sent with the SYN except the offer -- but the SYN still consumes sequence number ${config.clientIsn}, which is why the server's Ack will be ${config.clientIsn + 1}.`,
      reference: { rfc: 9293, section: '3.5', title: 'Transmission Control Protocol' },
    },
    endpointNode(run, 'client'),
  );
  if (!send('client', { syn: true }, 'client opens the connection')) return;
  if (!send('server', { syn: true, ack: true }, 'server agrees and states its own ISN'))
    return;
  if (!send('client', { ack: true }, 'handshake complete, both ends ESTABLISHED')) return;

  // --- The application's data ------------------------------------------------
  for (const write of config.writes) {
    if (write.phase) phase(run, run.clock, write.phase);
    if (write.note) annotate(run, run.clock, write.note, endpointNode(run, write.from));

    const chunks = splitForMss(write.bytes, config.mss);
    for (let index = 0; index < chunks.length; index += 1) {
      const bytes = chunks[index];
      const last = index === chunks.length - 1;
      const ok = send(
        write.from,
        {
          ack: true,
          psh: last,
          bytes,
          ...(write.preview !== undefined && index === 0
            ? { preview: write.preview }
            : {}),
        },
        chunks.length > 1
          ? `${cap(write.from)} sends ${bytes} bytes (segment ${index + 1} of ${chunks.length})`
          : `${cap(write.from)} sends ${bytes} bytes of application data`,
        index === 0 ? write.application : undefined,
      );
      if (!ok) return;
      if (
        !send(
          peerOf(write.from),
          { ack: true },
          'acknowledged: Ack is the sender’s Seq plus the bytes received',
        )
      ) {
        return;
      }
    }
  }

  // --- Four-way teardown -----------------------------------------------------
  phase(run, run.clock, TEARDOWN_PHASE);
  if (!send('client', { fin: true, ack: true }, 'client has nothing more to send'))
    return;
  if (
    !send(
      'server',
      { ack: true },
      'server acknowledges the FIN; the connection is half-closed',
    )
  )
    return;
  if (!send('server', { fin: true, ack: true }, 'server is done too')) return;
  send('client', { ack: true }, 'client acknowledges and waits in TIME_WAIT');
}

function attemptTcpSend(
  run: JourneyRun,
  role: JourneyRole,
  segment: TcpSegment,
  application: ProtocolLayer | undefined,
  at: number,
  attempt: number,
): DeliveryResult {
  const id = nextPduId(run, role === 'client' ? 'c' : 's');
  return deliverDatagram(
    run,
    hopsFor(run, role),
    id,
    { kind: 'tcp', segment },
    application,
    at,
    attempt > 0 ? { tag: `[Retransmission ${attempt}] ` } : {},
  );
}

function endpointNode(run: JourneyRun, role: JourneyRole): string {
  const { nodes } = run.path;
  return role === 'client' ? nodes[0] : nodes[nodes.length - 1];
}

function cap(role: JourneyRole): string {
  return role === 'client' ? 'Client' : 'Server';
}

// ---------------------------------------------------------------------------
// UDP
// ---------------------------------------------------------------------------

/**
 * Send each write as one datagram, and say nothing about whether it arrived.
 *
 * The contrast with the TCP driver above is the lesson: there is no connection to open,
 * no acknowledgement to wait for, and no retransmission when something goes missing. If
 * a datagram is lost, this loop does not even find out.
 */
function runUdpJourney(run: JourneyRun): void {
  const { config } = run;

  for (const write of config.writes) {
    if (write.phase) phase(run, run.clock, write.phase);
    if (write.note) annotate(run, run.clock, write.note, endpointNode(run, write.from));

    const outbound = write.from === 'client';
    const datagram = udpDatagram({
      sourcePort: outbound ? config.clientPort : config.serverPort,
      destinationPort: outbound ? config.serverPort : config.clientPort,
      payloadBytes: write.bytes,
      ...(write.preview === undefined ? {} : { payloadPreview: write.preview }),
    });

    const result = deliverDatagram(
      run,
      hopsFor(run, write.from),
      nextPduId(run, outbound ? 'q' : 'r'),
      { kind: 'udp', datagram },
      write.application,
      run.clock,
      write.dontFragment ? { dontFragment: true } : {},
    );

    if (result.delivered) {
      log(
        run,
        result.at,
        'info',
        `${describeUdpDatagram(datagram)} delivered -- ${formatBytes(write.bytes)} of application data, with nothing sent back to confirm it`,
      );
    } else {
      log(
        run,
        result.at,
        'warn',
        `datagram did not arrive (${result.reason ?? 'dropped'}). UDP has no retransmission: whether anything happens next is the application’s problem.`,
      );
    }
    run.clock = result.at + HOST_PROCESSING_MS;
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function resolveConfig(
  scenario: JourneyScenario,
  overrides: JourneyOverrides,
): ResolvedConfig {
  const merged = { ...scenario, ...stripUndefined(overrides) };
  return {
    ...merged,
    mtu: merged.mtu ?? ETHERNET_MTU,
    linkMtu: merged.linkMtu ?? {},
    ttl: merged.ttl ?? DEFAULT_TTL,
    mss: merged.mss ?? DEFAULT_MSS,
    clientIsn: merged.clientIsn ?? DEFAULT_CLIENT_ISN,
    serverIsn: merged.serverIsn ?? DEFAULT_SERVER_ISN,
  };
}

function stripUndefined(overrides: JourneyOverrides): JourneyOverrides {
  return Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined),
  ) as JourneyOverrides;
}

/**
 * A finished run, plus the state that has nowhere to live in a `SimResult`.
 *
 * `SimResult` is the contract every module shares, and it has no slot for "the NAT
 * translation table at the end of the run" -- nor should it, since only one module has
 * one. So the journey returns both, and `runJourney` is the narrow door for callers that
 * only want the events.
 */
export interface JourneyRunResult {
  /** The event stream, sorted by virtual time. */
  readonly result: SimResult;
  /** The path, so a hop table can name the hops without resolving them again. */
  readonly path: JourneyPath;
  /** The translation table as the run left it, if the path crossed a NAT. */
  readonly natTable?: NatTable;
}

/**
 * Run a scenario, keeping everything it produced.
 *
 * Pure and deterministic: same scenario and same seed in, deep-equal output. Events are
 * emitted as the run discovers them -- a fragment sent second may finish its journey
 * before an earlier one has -- and sorted by virtual time at the end. The sort is stable,
 * so events sharing an instant keep the order they happened in.
 */
export function runJourneyDetailed(
  scenario: JourneyScenario,
  overrides: JourneyOverrides = {},
): JourneyRunResult {
  const config = resolveConfig(scenario, overrides);
  const path = resolveJourneyPath(
    config.topology,
    config.path,
    config.linkMtu,
    config.mtu,
  );
  const rng = createRng(config.seed);

  const run: JourneyRun = {
    config,
    topology: config.topology,
    path,
    events: [],
    pdus: {},
    // Its own stream, so adding a randomised detail elsewhere later cannot move which
    // packet is the one that gets lost.
    lossRng: rng.fork('loss'),
    clock: 0,
    end: 0,
    pduSeq: 0,
    identification: FIRST_IDENTIFICATION,
    ...(config.nat
      ? {
          nat: createNatTable({
            publicIp: config.nat.publicIp,
            ...(config.nat.firstPort === undefined
              ? {}
              : { firstPort: config.nat.firstPort }),
          }),
        }
      : {}),
  };

  if (config.transport === 'tcp') {
    runTcpJourney(run);
  } else {
    runUdpJourney(run);
  }

  // Everything settles: the diagram goes quiet a millisecond after the last event.
  const settled = round3(run.end + 1);
  for (const nodeId of path.nodes) {
    nodeState(run, settled, nodeId, 'idle');
  }

  const events = [...run.events].sort((a, b) => a.at - b.at);
  const durationMs = round3(run.end + JOURNEY_TAIL_MS);

  return {
    result: {
      events,
      phases: summarizePhases(events, durationMs),
      durationMs,
      pdus: run.pdus,
    },
    path,
    ...(run.nat ? { natTable: run.nat } : {}),
  };
}

/**
 * Run a scenario and produce the event stream the renderer plays.
 *
 * The narrow form of {@link runJourneyDetailed}, for everything that only wants events.
 */
export function runJourney(
  scenario: JourneyScenario,
  overrides: JourneyOverrides = {},
): SimResult {
  return runJourneyDetailed(scenario, overrides).result;
}
