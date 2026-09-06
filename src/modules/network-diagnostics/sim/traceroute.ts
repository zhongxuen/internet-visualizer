/**
 * Simulated `traceroute`: a list of routers, obtained entirely by breaking things.
 *
 * There is no "list the hops" message in IP. Traceroute gets its answer by abusing a
 * field designed to stop packets circulating forever: it sends a probe with TTL 1, which
 * the first router dutifully decrements to zero and therefore must discard, and RFC 792
 * requires that router to report the discard with an **ICMP Time Exceeded**. The report
 * carries the router's own source address. Repeat with TTL 2, 3, 4, and each router in
 * turn is forced to identify itself by killing a packet.
 *
 * That is the whole mechanism, and this file implements it literally rather than by
 * looking up a list of hops. The TTL arithmetic runs through
 * {@link forwardIpv4}, the same function Packet Journey animates, so a probe expires here
 * for exactly the reason a real one does -- `forwardIpv4` throws rather than forward a
 * packet whose TTL is already zero, recomputes the header checksum every time the TTL
 * changes, and reports `expired` when the decrement reaches zero. {@link TracerouteHop.walk}
 * is that arithmetic, hop by hop, TTL and checksum in and out, and it is what the view
 * puts on screen.
 *
 * ## Why the output is not a map
 *
 * Three properties of the real tool are modelled because leaving them out is how people
 * end up trusting the output more than it deserves. Each has a caveat in
 * {@link TRACEROUTE_CAVEATS} and a path in `paths.ts` that demonstrates it:
 *
 * 1. **`* * *` is usually policy.** A router that does not generate ICMP is not broken and
 *    the path through it is not broken. Everything after it still answers.
 * 2. **Every time is a round trip.** The column is headed by a forward hop, but the number
 *    includes a return path the output never shows -- and each hop's replies find their
 *    own way home, which is why a later hop can legitimately be *faster* than an earlier
 *    one. `long-haul` prints exactly that inversion.
 * 3. **Load balancing puts two addresses on one row**, and worse: consecutive rows may
 *    describe different paths, so the list can be a route no packet ever took.
 *
 * ## What is animated, and what is only tabulated
 *
 * A real traceroute sends three probes per TTL. All three are computed and all three
 * appear in the hop table and the printed output -- but only the first is put on the
 * canvas, with a `pdu-transform` at every router showing the TTL going down and the
 * checksum changing with it. Animating twenty-four near-identical flights would bury the
 * one thing worth watching.
 *
 * Everything is simulated. This file takes a bundled {@link DiagnosticPath} and has no way
 * to be pointed at a host.
 */

import {
  buildIpv4Layer,
  forwardIpv4,
  icmpTimeExceededLayer,
  ipv4Checksum,
  ipv4Header,
  IPV4_HEADER_BYTES,
  IP_PROTOCOLS,
  type Ipv4Header,
} from '@/core/protocols/ipv4/ipv4';
import { buildUdpLayer, udpDatagram, UDP_HEADER_BYTES } from '@/core/protocols/udp/udp';
import { createRng, type Rng } from '@/core/sim/rng';
import { summarizePhases, type SimResult } from '@/core/sim/result';
import type { RfcRef, SimEvent } from '@/core/types/events';
import type { PDU, ProtocolLayer } from '@/core/types/pdu';
import type { Topology } from '@/core/types/topology';

import {
  buildIcmpEchoLayer,
  buildIcmpUnreachableLayer,
  ICMP_CODE_ADMIN_PROHIBITED,
  ICMP_CODE_HOST_UNREACHABLE,
  ICMP_ECHO_REPLY,
  ICMP_ECHO_REQUEST,
  ICMP_HEADER_BYTES,
} from './ping';
import {
  buildTopology,
  conditionsOf,
  hopCount,
  nodeChain,
  oneWayMs,
  type DiagnosticPath,
  type PathHop,
} from './path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Probes per TTL. Three is what every implementation sends, and why rows have 3 times. */
export const PROBES_PER_HOP = 3;

/**
 * The first destination port classic Unix traceroute uses, from the unassigned range.
 *
 * The port is deliberately one nothing listens on, and it *increments per probe*: the
 * ICMP error quotes the first eight bytes of the UDP header, so the port number that
 * comes back is how the sender knows which probe an answer belongs to. UDP has no
 * identifier field to use instead.
 */
export const UDP_BASE_PORT = 33434;

/** The sender's own port. Fixed for the run, as the tool's is. */
export const UDP_SOURCE_PORT = 45678;

/** Hops traceroute gives up after, and prints in its banner. */
export const DEFAULT_MAX_TTL = 30;

/** How long a probe waits before printing a star. Real tools wait 5 s; this is a demo. */
export const DEFAULT_TIMEOUT_MS = 1000;

/** Gap between the three probes of one hop. */
const PROBE_SPACING_MS = 20;

/** Gap after a hop settles before the next TTL goes out. */
const HOP_GAP_MS = 60;

/** Quiet virtual milliseconds after the last hop, so the timeline has an end. */
const TAIL_MS = 400;

/** Payload of a classic UDP probe: enough to make the datagram 60 bytes on the wire. */
const UDP_PROBE_PAYLOAD_BYTES = 60 - IPV4_HEADER_BYTES - UDP_HEADER_BYTES;

/** Chance a load-balanced hop sends a given probe to the second router of the pair. */
const PARALLEL_SHARE = 0.5;

/** Chance a rate-limited destination answers a given probe. */
const RATE_LIMIT_ANSWER_CHANCE = 2 / 3;

const RFC_792_TIME_EXCEEDED: RfcRef = {
  rfc: 792,
  title: 'Internet Control Message Protocol',
};
const RFC_791_TTL: RfcRef = {
  rfc: 791,
  section: '3.2',
  title: 'Internet Protocol',
};

// ---------------------------------------------------------------------------
// How the probes are sent
// ---------------------------------------------------------------------------

/**
 * What the probe actually is.
 *
 * Worth exposing rather than hiding, because on the real Internet it changes the answer:
 * a filter that drops ICMP echo often passes UDP, and a filter that drops high UDP ports
 * often passes ICMP. A trace full of stars is frequently a trace run with the wrong
 * method, not a broken path.
 */
export type ProbeMethod =
  /** Classic Unix `traceroute`: a UDP datagram to a port nothing is listening on. */
  | 'udp'
  /** What Windows `tracert` and `traceroute -I` send: an ICMP Echo Request. */
  | 'icmp';

/** How each method gets its answer out of the *destination*, once the TTL is big enough. */
export const METHOD_NOTES: Readonly<Record<ProbeMethod, string>> = {
  udp: 'The probe is a UDP datagram aimed at an unassigned high port. Every router on the way answers with Time Exceeded; the destination has nothing listening on that port, so it answers with Destination Unreachable, code 3 (Port Unreachable) -- which is how traceroute knows it has arrived.',
  icmp: 'The probe is an ICMP Echo Request. Routers answer Time Exceeded exactly as before, and the destination answers with an Echo Reply. Filters treat the two methods differently, so a path full of stars under one is often clean under the other.',
};

// ---------------------------------------------------------------------------
// One probe
// ---------------------------------------------------------------------------

/** How one probe ended. */
export type HopOutcome =
  /** A router's TTL hit zero and it reported it. This is the normal, useful case. */
  | 'time-exceeded'
  /** The destination itself answered: port unreachable (UDP) or echo reply (ICMP). */
  | 'destination'
  /** ICMP type 3 code 13 -- a filter refused, and said so. Printed `!X`. */
  | 'prohibited'
  /** ICMP type 3 code 1 -- the last router found nothing at the address. Printed `!H`. */
  | 'host-unreachable'
  /** Nothing came back before the deadline. Printed `*`. */
  | 'silent';

/** One probe, and whatever answered it. */
export interface TracerouteProbe {
  /** The TTL this probe carried when it left. */
  readonly ttl: number;
  /** 0, 1, or 2 -- which of the three probes for this hop. */
  readonly index: number;
  /** The destination port, which is also this probe's identity for a UDP trace. */
  readonly port: number;
  readonly sentAt: number;
  readonly settledAt: number;
  readonly outcome: HopOutcome;
  /** Round trip in milliseconds. Absent when nothing came back. */
  readonly rttMs?: number;
  /** Address that answered. */
  readonly responder?: string;
  /** `SimNode.id` that answered, for highlighting it on the diagram. */
  readonly responderId?: string;
}

// ---------------------------------------------------------------------------
// The TTL arithmetic, made visible
// ---------------------------------------------------------------------------

/**
 * What one router did to one probe.
 *
 * Straight out of `forwardIpv4`, which is the point: the checksum really does change at
 * every hop, because the checksum covers the header and the TTL is in the header.
 */
export interface TtlStep {
  readonly nodeId: string;
  readonly label: string;
  readonly address: string;
  readonly ttlIn: number;
  readonly ttlOut: number;
  readonly checksumIn: number;
  readonly checksumOut: number;
  /**
   * True at the router where the decrement reached zero.
   *
   * The packet goes no further; RFC 791 requires it to be discarded, and RFC 792
   * requires this router to send Time Exceeded back. Whether it actually does is
   * `PathHop.respondsToTtl`, and that difference is the entire `* * *` story.
   */
  readonly expired: boolean;
}

// ---------------------------------------------------------------------------
// One row of the output
// ---------------------------------------------------------------------------

/** One hop: three probes, and the row they print. */
export interface TracerouteHop {
  /** The TTL these probes carried, which is also the row number. */
  readonly ttl: number;
  readonly probes: readonly TracerouteProbe[];
  /**
   * The forwarding arithmetic for the first probe, one entry per router it reached.
   *
   * The last entry has `expired: true` unless the probe reached the destination.
   */
  readonly walk: readonly TtlStep[];
  /** Distinct responder addresses in first-seen order. Two of them is load balancing. */
  readonly responders: readonly string[];
  /** True when no probe was answered: the `* * *` row. */
  readonly silent: boolean;
  /** True on the row where the destination itself answered. */
  readonly isDestination: boolean;
  /** `!H`, `!X`, or absent -- the annotation a real traceroute appends. */
  readonly flag?: string;
  /** The row as the tool prints it. */
  readonly line: string;
  /** Why this row looks the way it does, when it needs saying. */
  readonly note?: string;
}

// ---------------------------------------------------------------------------
// The caveats
// ---------------------------------------------------------------------------

/** One reason the printed list is less than a map of the path. */
export interface TracerouteCaveat {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
}

/**
 * Everything traceroute output does not tell you, in the order people get caught by it.
 *
 * Shown beside every trace rather than only the ones that demonstrate them, because the
 * clean trace is where a false confidence gets formed. {@link caveatsFor} marks which ones
 * a particular run puts on screen.
 */
export const TRACEROUTE_CAVEATS: readonly TracerouteCaveat[] = [
  {
    id: 'stars',
    title: '`* * *` almost never means a broken hop',
    detail:
      'A router that returns nothing is usually one configured not to generate ICMP, or behind a filter that drops it on the way back. Generating ICMP is control-plane work on hardware built to forward, so operators switch it off or rate-limit it hard. The proof that the path is fine is the rows *after* the stars: if hop 5 is silent and hop 6 answers, hop 5 forwarded the probe perfectly.',
  },
  {
    id: 'round-trip',
    title: 'Every number is a round trip, and only half of it is drawn',
    detail:
      'A hop is revealed by a reply, so its time includes the way back -- and the way back is chosen independently by every router on the path. A hop whose replies take a longer route home reads slow for a reason nothing in the output can show, which is why a later hop is sometimes faster than an earlier one. That is not an error and not congestion.',
  },
  {
    id: 'load-balancing',
    title: 'Two addresses on one row means two paths, not an unstable one',
    detail:
      'Where traffic is spread across parallel routers, each probe may land on a different one, and traceroute prints whichever answered. Worse: consecutive rows can then belong to different paths, so the list read top to bottom may describe a route no single packet ever took.',
  },
  {
    id: 'asymmetry',
    title: 'The return path is not the forward path',
    detail:
      'Routing on the Internet is decided independently in each direction. Traceroute can only show the forward direction, and a problem on the way back appears -- if it appears at all -- as an inexplicable time on a hop that is working perfectly. Tracing from the other end is a different measurement, not a confirmation.',
  },
  {
    id: 'icmp-priority',
    title: 'ICMP is deprioritised, so hop times are not traffic times',
    detail:
      'Routers answer probes from a rate-limited control plane, well behind the traffic they forward in hardware. A hop that reports 200 ms may be forwarding your packets in 2 ms. Only the last row -- the destination -- measures anything resembling the path your traffic experiences.',
  },
];

/**
 * The caveats this particular run demonstrates on screen, in caveat order.
 *
 * Asymmetry is decided from the path rather than from a time inversion in the output.
 * An inversion is only *evidence* of an asymmetric return, and a noisy link produces
 * plenty of inversions that have nothing to do with routing -- `flaky-wifi` prints
 * several. Claiming asymmetry there would teach the wrong inference from the right
 * observation.
 */
export function caveatsFor(
  path: DiagnosticPath,
  hops: readonly TracerouteHop[],
): TracerouteCaveat[] {
  const ids = new Set<string>(['icmp-priority', 'round-trip']);
  if (hops.some((hop) => hop.silent)) ids.add('stars');
  if (hops.some((hop) => hop.responders.length > 1)) ids.add('load-balancing');

  const skewed = hops.some((hop) => {
    if (hop.silent) return false;
    const router = path.hops[hop.ttl - 1];
    const skew = router ? router.returnSkewMs : path.destination.returnSkewMs;
    return (skew ?? 0) > 0;
  });
  if (skewed) ids.add('asymmetry');

  return TRACEROUTE_CAVEATS.filter((caveat) => ids.has(caveat.id));
}

/** The fastest probe on a row, or `undefined` when the row is all stars. */
export function bestTime(hop: TracerouteHop): number | undefined {
  const times = hop.probes
    .map((probe) => probe.rttMs)
    .filter((rtt): rtt is number => rtt !== undefined);
  return times.length > 0 ? Math.min(...times) : undefined;
}

// ---------------------------------------------------------------------------
// Running one
// ---------------------------------------------------------------------------

/** How to run a trace. */
export interface TracerouteOptions {
  readonly method?: ProbeMethod;
  /** The banner's hop ceiling. Only printed -- these paths are all far shorter. */
  readonly maxTtl?: number;
  readonly timeoutMs?: number;
  readonly seed?: number | string;
}

/** One complete trace, ready to draw. */
export interface TracerouteRun {
  readonly path: DiagnosticPath;
  readonly method: ProbeMethod;
  readonly maxTtl: number;
  readonly hops: readonly TracerouteHop[];
  /** True when the destination never answered, so the trace ended without arriving. */
  readonly reachedDestination: boolean;
  readonly caveats: readonly TracerouteCaveat[];
  /** The whole output, line for line, as the terminal would show it. */
  readonly output: readonly string[];
  readonly topology: Topology;
  readonly result: SimResult;
}

/**
 * Walk `path` with increasing TTLs and report what each one killed.
 *
 * Pure and total: the same path, options, and seed produce a deep-equal `TracerouteRun`.
 */
export function runTraceroute(
  path: DiagnosticPath,
  options: TracerouteOptions = {},
): TracerouteRun {
  const method = options.method ?? 'udp';
  const maxTtl = options.maxTtl ?? DEFAULT_MAX_TTL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const conditions = conditionsOf(path);

  const rng = createRng(options.seed ?? `diagnostics:traceroute:${path.id}:${method}`);
  const jitterRng = rng.fork('jitter');
  const lossRng = rng.fork('loss');
  const balanceRng = rng.fork('balance');
  const limitRng = rng.fork('rate-limit');

  const finalTtl = hopCount(path);

  const events: SimEvent[] = [];
  const pdus: Record<string, PDU> = {};
  const hops: TracerouteHop[] = [];

  let clock = 0;

  for (let ttl = 1; ttl <= finalTtl; ttl += 1) {
    const walk = walkTtl(path, ttl, method);
    const probes: TracerouteProbe[] = [];
    let settledLatest = clock;

    for (let index = 0; index < PROBES_PER_HOP; index += 1) {
      const sentAt = round2(clock + index * PROBE_SPACING_MS);
      const probe = sendProbe({
        path,
        ttl,
        index,
        method,
        sentAt,
        timeoutMs,
        conditions,
        rngs: { jitterRng, lossRng, balanceRng, limitRng },
      });
      probes.push(probe);
      settledLatest = Math.max(settledLatest, probe.settledAt);

      // Only the first probe of each hop is put on the canvas. See the file header.
      if (index === 0) {
        animate(events, pdus, path, walk, probe, method);
      }
    }

    const hop = summarizeHop(path, ttl, probes, walk, finalTtl);
    hops.push(hop);

    events.push({
      kind: 'phase',
      at: round2(clock),
      id: `ttl-${ttl}`,
      title: `TTL ${ttl}`,
      description: describeHop(path, hop, walk),
    });

    const annotation = annotationFor(path, hop, walk);
    if (annotation) {
      events.push({
        kind: 'annotate',
        at: round2(clock),
        targetId: annotation.targetId,
        text: annotation.text,
        ...(annotation.reference ? { reference: annotation.reference } : {}),
      });
    }

    events.push({
      kind: 'log',
      at: round2(settledLatest),
      level: hop.silent ? 'warn' : hop.isDestination ? 'info' : 'info',
      text: hop.line.trim(),
    });

    clock = round2(settledLatest + HOP_GAP_MS);
  }

  const reachedDestination = hops[hops.length - 1]?.isDestination ?? false;
  const durationMs = round2(clock + TAIL_MS);
  const sorted = [...events].sort((a, b) => a.at - b.at);

  return {
    path,
    method,
    maxTtl,
    hops,
    reachedDestination,
    caveats: caveatsFor(path, hops),
    output: formatOutput(path, hops, maxTtl, reachedDestination),
    topology: buildTopology(path),
    result: {
      events: sorted,
      phases: summarizePhases(sorted, durationMs),
      durationMs,
      pdus,
    },
  };
}

// ---------------------------------------------------------------------------
// The TTL walk
// ---------------------------------------------------------------------------

/** The IPv4 header a probe leaves with. */
function probeHeader(path: DiagnosticPath, ttl: number, method: ProbeMethod): Ipv4Header {
  return ipv4Header({
    sourceIp: path.source.address,
    destinationIp: path.destination.address,
    ttl,
    protocol: method === 'udp' ? IP_PROTOCOLS.udp : IP_PROTOCOLS.icmp,
    payloadBytes:
      method === 'udp'
        ? UDP_HEADER_BYTES + UDP_PROBE_PAYLOAD_BYTES
        : ICMP_HEADER_BYTES + 24,
    // Traceroute varies the identification field per probe in some implementations; a
    // fixed value keeps the checksum arithmetic on screen legible, and nothing in this
    // module fragments.
    identification: 0x4444,
  });
}

/**
 * Forward the probe hop by hop until its TTL runs out or it reaches the destination.
 *
 * This is the whole mechanism, and it is `forwardIpv4` doing it -- the same function
 * Packet Journey uses to animate a router decrementing a hop limit. Nothing here decides
 * that a hop "should" be revealed; the hop is revealed because the arithmetic reached
 * zero there.
 */
export function walkTtl(
  path: DiagnosticPath,
  ttl: number,
  method: ProbeMethod = 'udp',
): TtlStep[] {
  const steps: TtlStep[] = [];
  let header = probeHeader(path, ttl, method);

  for (let index = 0; index < path.hops.length; index += 1) {
    const router = path.hops[index]!;
    const hop = forwardIpv4(header);
    steps.push({
      nodeId: router.id,
      label: router.label,
      address: router.address,
      ttlIn: header.ttl,
      ttlOut: hop.header.ttl,
      checksumIn: hop.previousChecksum,
      checksumOut: hop.checksum,
      expired: hop.expired,
    });
    if (hop.expired) return steps;
    header = hop.header;
  }

  // Survived every router: the datagram is delivered to the destination, which is a host
  // and does not decrement anything. Its TTL on arrival is what is left.
  steps.push({
    nodeId: path.destination.id,
    label: path.destination.label,
    address: path.destination.address,
    ttlIn: header.ttl,
    ttlOut: header.ttl,
    checksumIn: ipv4Checksum(header),
    checksumOut: ipv4Checksum(header),
    expired: false,
  });

  return steps;
}

// ---------------------------------------------------------------------------
// Sending one probe
// ---------------------------------------------------------------------------

interface SendArgs {
  readonly path: DiagnosticPath;
  readonly ttl: number;
  readonly index: number;
  readonly method: ProbeMethod;
  readonly sentAt: number;
  readonly timeoutMs: number;
  readonly conditions: ReturnType<typeof conditionsOf>;
  readonly rngs: {
    readonly jitterRng: Rng;
    readonly lossRng: Rng;
    readonly balanceRng: Rng;
    readonly limitRng: Rng;
  };
}

function sendProbe(args: SendArgs): TracerouteProbe {
  const { path, ttl, index, sentAt, timeoutMs, conditions, rngs } = args;
  const port = UDP_BASE_PORT + (ttl - 1) * PROBES_PER_HOP + index;
  const lost = () =>
    ({
      ttl,
      index,
      port,
      sentAt,
      settledAt: round2(sentAt + timeoutMs),
      outcome: 'silent',
    }) as const;

  if (rngs.lossRng.chance(conditions.lossRate)) return lost();

  const router = path.hops[ttl - 1];

  if (router) {
    if (!router.respondsToTtl) return lost();

    // A load-balanced hop answers from whichever of the pair this probe landed on.
    const useParallel =
      router.parallel !== undefined && rngs.balanceRng.chance(PARALLEL_SHARE);
    const responderId = useParallel ? router.parallel!.id : router.id;
    const responder = useParallel ? router.parallel!.address : router.address;

    return {
      ttl,
      index,
      port,
      sentAt,
      ...timing(args, ttl, router.returnSkewMs ?? 0),
      outcome: 'time-exceeded',
      responder,
      responderId,
    };
  }

  // Past the last router: the destination decides.
  const lastRouter = path.hops[path.hops.length - 1];

  switch (path.destination.icmp) {
    case 'filtered-silent':
      return lost();

    case 'rate-limited':
      if (!rngs.limitRng.chance(RATE_LIMIT_ANSWER_CHANCE)) return lost();
      break;

    case 'filtered-prohibited':
    case 'host-down': {
      // The answer comes from the last router, not the destination, so the timing is the
      // router's -- and the responder address is the single most useful thing on the row.
      const responderTtl = Math.max(1, path.hops.length);
      return {
        ttl,
        index,
        port,
        sentAt,
        ...timing(args, responderTtl, lastRouter?.returnSkewMs ?? 0),
        outcome:
          path.destination.icmp === 'host-down' ? 'host-unreachable' : 'prohibited',
        responder: lastRouter?.address ?? path.destination.address,
        responderId: lastRouter?.id ?? path.destination.id,
      };
    }

    default:
      break;
  }

  return {
    ttl,
    index,
    port,
    sentAt,
    ...timing(args, ttl, path.destination.returnSkewMs ?? 0),
    outcome: 'destination',
    responder: path.destination.address,
    responderId: path.destination.id,
  };
}

/**
 * When a probe answered from `ttl` gets home.
 *
 * `skewMs` is the responding machine's own return-path penalty and is deliberately *not*
 * accumulated down the path: each hop's replies are routed home independently, which is
 * exactly why a later hop can come back faster than an earlier one.
 */
function timing(
  args: SendArgs,
  ttl: number,
  skewMs: number,
): { settledAt: number; rttMs: number } {
  const { path, sentAt, conditions, rngs } = args;
  const jitter = rngs.jitterRng.next() * conditions.jitterMs;
  const rttMs = round3(
    oneWayMs(path, ttl) * 2 + conditions.icmpGenerationMs + skewMs + jitter,
  );
  return { settledAt: round2(sentAt + rttMs), rttMs };
}

// ---------------------------------------------------------------------------
// Turning probes into a row
// ---------------------------------------------------------------------------

function summarizeHop(
  path: DiagnosticPath,
  ttl: number,
  probes: readonly TracerouteProbe[],
  walk: readonly TtlStep[],
  finalTtl: number,
): TracerouteHop {
  const responders: string[] = [];
  for (const probe of probes) {
    if (probe.responder && !responders.includes(probe.responder)) {
      responders.push(probe.responder);
    }
  }

  const silent = responders.length === 0;
  const isDestination = probes.some((probe) => probe.outcome === 'destination');
  const flag = probes.some((probe) => probe.outcome === 'host-unreachable')
    ? '!H'
    : probes.some((probe) => probe.outcome === 'prohibited')
      ? '!X'
      : undefined;

  const router = path.hops[ttl - 1];
  const note = silent
    ? (router?.note ??
      `Nothing answered. The probes still reached this far -- every later hop proves it.`)
    : responders.length > 1
      ? router?.note
      : ttl === finalTtl
        ? path.destination.note
        : router?.note;

  return {
    ttl,
    probes,
    walk,
    responders,
    silent,
    isDestination,
    ...(flag ? { flag } : {}),
    line: formatRow(ttl, probes, flag),
    ...(note ? { note } : {}),
  };
}

/**
 * One printed row.
 *
 * Real traceroute prints an address only when it differs from the previous probe's, which
 * is why a load-balanced hop reads as two addresses interleaved with times rather than as
 * three separate rows.
 */
function formatRow(
  ttl: number,
  probes: readonly TracerouteProbe[],
  flag: string | undefined,
): string {
  const cells: string[] = [];
  let shown: string | undefined;

  for (const probe of probes) {
    if (probe.rttMs === undefined || !probe.responder) {
      cells.push('*');
      continue;
    }
    if (probe.responder !== shown) {
      cells.push(probe.responder);
      shown = probe.responder;
    }
    cells.push(`${probe.rttMs.toFixed(3)} ms${flag ? ` ${flag}` : ''}`);
  }

  return `${String(ttl).padStart(2, ' ')}  ${cells.join('  ')}`;
}

function describeHop(
  path: DiagnosticPath,
  hop: TracerouteHop,
  walk: readonly TtlStep[],
): string {
  const expired = walk.find((step) => step.expired);

  if (hop.isDestination) {
    return `TTL ${hop.ttl} is finally large enough to survive every router: the probe arrives at ${path.destination.label} with ${walk[walk.length - 1]?.ttlOut ?? 1} left. The destination answers for itself, and the trace stops.`;
  }

  if (hop.silent && expired) {
    return `The probe reaches ${expired.label}, whose decrement takes the TTL to 0 -- so the datagram is discarded exactly as before. What does not happen is the report: this router generates no ICMP, so the row is three stars. Everything after it still answers, which is the proof that nothing is wrong here.`;
  }

  if (hop.flag === '!H') {
    return `The probe survives every router and is handed to the last one for delivery. Its ARP for ${path.destination.address} goes unanswered, so it returns Destination Unreachable, code 1. The address is empty -- and the answer came from ${hop.responders[0]}, not from the target.`;
  }

  if (hop.flag === '!X') {
    return `${hop.responders[0]} refuses to forward the probe and reports it: Destination Unreachable, code 13. The trace stops here because policy, not distance, ends it.`;
  }

  if (hop.responders.length > 1) {
    return `Two addresses on one row. The probes were spread across a load-balanced pair, so ${hop.responders.join(' and ')} each answered some of them. Neither is the "real" hop ${hop.ttl}; both are.`;
  }

  return expired
    ? `The probe leaves with TTL ${hop.ttl} and is decremented at every router. At ${expired.label} it reaches 0, so the datagram is discarded and an ICMP Time Exceeded goes back carrying that router's own address -- which is the only reason we know it is here.`
    : `TTL ${hop.ttl}.`;
}

function annotationFor(
  path: DiagnosticPath,
  hop: TracerouteHop,
  walk: readonly TtlStep[],
): { targetId: string; text: string; reference?: RfcRef } | undefined {
  const expired = walk.find((step) => step.expired);

  if (hop.ttl === 1) {
    return {
      targetId: path.source.id,
      text: `Traceroute has no "list the hops" message to send, because IP has none. It sends an ordinary datagram with the hop limit set to 1 and lets the first router kill it: RFC 791 requires a router that decrements the TTL to zero to discard the packet, and RFC 792 requires it to report the discard. The report carries the router's source address, and that is the entire discovery mechanism.`,
      reference: RFC_791_TTL,
    };
  }

  if (hop.silent && expired) {
    return {
      targetId: expired.nodeId,
      text: `The TTL expired here just as it did at every other hop -- the difference is only that nothing was sent back. A router is not obliged to generate ICMP, and plenty do not: it is control-plane work on a box built to forward in hardware. Read the rows below this one; they came through this router.`,
      reference: RFC_792_TIME_EXCEEDED,
    };
  }

  if (hop.responders.length > 1) {
    return {
      targetId: path.hops[hop.ttl - 1]?.id ?? path.destination.id,
      text: `Both of these answered probes with the same TTL, so both are hop ${hop.ttl}. This is also the point where the output stops being a path: the row above and the row below may have been measured through different members of this pair, and reading the list top to bottom would describe a route no packet took.`,
    };
  }

  const router = path.hops[hop.ttl - 1];
  if (router?.returnSkewMs) {
    return {
      targetId: router.id,
      text: `This time is high, and the extra ${router.returnSkewMs} ms is on the way back, not on the way out. Each router picks its own route home for the replies it generates, so a hop can read slow while forwarding traffic perfectly -- and the hop after it can read faster.`,
    };
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------

/**
 * Put one probe on the canvas: out to where it dies, then the ICMP report back.
 *
 * The `pdu-transform` at each router is the reason this is worth animating -- the
 * inspector diffs the header before and after, so the TTL going down and the checksum
 * changing with it are visible field by field.
 */
function animate(
  events: SimEvent[],
  pdus: Record<string, PDU>,
  path: DiagnosticPath,
  walk: readonly TtlStep[],
  probe: TracerouteProbe,
  method: ProbeMethod,
): void {
  const chain = nodeChain(path);
  const conditions = conditionsOf(path);
  const id = `probe-ttl-${probe.ttl}`;

  let header = probeHeader(path, probe.ttl, method);
  let pdu = probePdu(id, header, probe, method, path);
  pdus[id] = pdu;

  events.push({ kind: 'pdu-created', at: probe.sentAt, pdu, atNode: chain[0]! });
  events.push({
    kind: 'node-state',
    at: probe.sentAt,
    nodeId: chain[0]!,
    state: 'active',
    note: `probe with TTL ${probe.ttl}`,
  });

  let at = probe.sentAt;

  for (let index = 0; index < walk.length; index += 1) {
    const step = walk[index]!;
    const from = chain[index]!;
    // The animated probe follows the primary router of a load-balanced pair; which one a
    // given probe took is in the hop table, where it belongs.
    const to = step.nodeId;
    const linkMs = path.hops[index]?.linkMs ?? path.destination.linkMs;

    events.push({
      kind: 'transmit',
      at: round2(at),
      pduId: id,
      from,
      to,
      durationMs: round2(linkMs),
      linkId: `${from}-${to}`,
    });
    at = round2(at + linkMs);

    if (step.nodeId === path.destination.id) break;

    const forwarded = forwardIpv4(header);
    const next = {
      ...pdu,
      layers: [buildIpv4Layer(forwarded.header), ...pdu.layers.slice(1)],
    };
    events.push({
      kind: 'pdu-transform',
      at: round2(at),
      pduId: id,
      before: pdu,
      after: next,
      atNode: step.nodeId,
      reason: `TTL ${step.ttlIn} -> ${step.ttlOut}, header checksum ${hex16(step.checksumIn)} -> ${hex16(step.checksumOut)}. The checksum covers the header, and the TTL is in the header.`,
    });
    header = forwarded.header;
    pdu = next;

    if (step.expired) {
      events.push({
        kind: 'node-state',
        at: round2(at),
        nodeId: step.nodeId,
        state: 'error',
        note: 'TTL reached 0',
      });
      events.push({
        kind: 'drop',
        at: round2(at),
        pduId: id,
        atNode: step.nodeId,
        reason: `TTL reached 0. RFC 791 requires the datagram to be discarded here${
          probe.outcome === 'silent'
            ? ', and RFC 792 requires a report -- which this router does not send.'
            : ', and RFC 792 requires the report that reveals this router.'
        }`,
      });
      break;
    }
  }

  if (probe.outcome === 'silent' || probe.rttMs === undefined) return;

  // The reply, coming home from whichever machine answered.
  const responderIndex = chain.indexOf(probe.responderId ?? '');
  const answeredFrom = responderIndex >= 0 ? responderIndex : walk.length;
  const replyId = `reply-ttl-${probe.ttl}`;
  const reply = replyPdu(replyId, probe, path, method);
  pdus[replyId] = reply;

  const generatedAt = round2(at + conditions.icmpGenerationMs);
  events.push({
    kind: 'pdu-created',
    at: generatedAt,
    pdu: reply,
    atNode: chain[answeredFrom] ?? path.destination.id,
  });

  // The reply is scheduled to land exactly when the measured round trip says it does, so
  // the animation and the number in the hop table cannot disagree.
  const arrival = round2(probe.sentAt + probe.rttMs);
  const legs = Math.max(1, answeredFrom);
  const perLeg = round2(Math.max(0.1, (arrival - generatedAt) / legs));
  let back = generatedAt;

  for (let index = answeredFrom; index >= 1; index -= 1) {
    const from = chain[index]!;
    const to = chain[index - 1]!;
    events.push({
      kind: 'transmit',
      at: round2(back),
      pduId: replyId,
      from,
      to,
      durationMs: perLeg,
      linkId: `${to}-${from}`,
    });
    back = round2(back + perLeg);
  }
}

function hex16(value: number): string {
  return `0x${value.toString(16).padStart(4, '0')}`;
}

/** The probe itself: an IPv4 header wrapping either a UDP datagram or an echo request. */
function probePdu(
  id: string,
  header: Ipv4Header,
  probe: TracerouteProbe,
  method: ProbeMethod,
  path: DiagnosticPath,
): PDU {
  const inner: ProtocolLayer =
    method === 'udp'
      ? buildUdpLayer(
          udpDatagram({
            sourcePort: UDP_SOURCE_PORT,
            destinationPort: probe.port,
            payloadBytes: UDP_PROBE_PAYLOAD_BYTES,
            payloadPreview: `Padding. Nothing is listening on port ${probe.port}, which is the point -- the port number is how the sender tells this probe from the other ${PROBES_PER_HOP - 1}.`,
          }),
        )
      : buildIcmpEchoLayer({
          type: ICMP_ECHO_REQUEST,
          code: 0,
          identifier: UDP_SOURCE_PORT & 0xffff,
          sequence: probe.ttl,
          payloadBytes: 24,
        });

  return {
    id,
    layers: [buildIpv4Layer(header), inner],
    sizeBytes: IPV4_HEADER_BYTES + header.payloadBytes,
    summary: `${method === 'udp' ? 'UDP' : 'ICMP'} probe, TTL ${header.ttl} -> ${path.destination.address}`,
  };
}

/** Whatever came back: Time Exceeded, an unreachable, or the destination's own answer. */
function replyPdu(
  id: string,
  probe: TracerouteProbe,
  path: DiagnosticPath,
  method: ProbeMethod,
): PDU {
  const source = probe.responder ?? path.destination.address;
  const quoted = ipv4Header({
    sourceIp: path.source.address,
    destinationIp: path.destination.address,
    ttl: 0,
    protocol: method === 'udp' ? IP_PROTOCOLS.udp : IP_PROTOCOLS.icmp,
    payloadBytes: 8,
  });

  const layer: ProtocolLayer =
    probe.outcome === 'time-exceeded'
      ? icmpTimeExceededLayer(quoted)
      : probe.outcome === 'host-unreachable'
        ? buildIcmpUnreachableLayer(ICMP_CODE_HOST_UNREACHABLE, path.destination.address)
        : probe.outcome === 'prohibited'
          ? buildIcmpUnreachableLayer(
              ICMP_CODE_ADMIN_PROHIBITED,
              path.destination.address,
            )
          : method === 'udp'
            ? portUnreachableLayer(probe.port)
            : buildIcmpEchoLayer({
                type: ICMP_ECHO_REPLY,
                code: 0,
                identifier: UDP_SOURCE_PORT & 0xffff,
                sequence: probe.ttl,
                payloadBytes: 24,
              });

  const payloadBytes = ICMP_HEADER_BYTES + IPV4_HEADER_BYTES + 8;

  return {
    id,
    layers: [
      buildIpv4Layer(
        ipv4Header({
          sourceIp: source,
          destinationIp: path.source.address,
          ttl: 64,
          protocol: IP_PROTOCOLS.icmp,
          payloadBytes,
        }),
      ),
      layer,
    ],
    sizeBytes: IPV4_HEADER_BYTES + payloadBytes,
    summary: `${summarizeReply(probe)} ${source} -> ${path.source.address}`,
  };
}

function summarizeReply(probe: TracerouteProbe): string {
  switch (probe.outcome) {
    case 'time-exceeded':
      return 'ICMP Time Exceeded';
    case 'host-unreachable':
      return 'ICMP Host Unreachable';
    case 'prohibited':
      return 'ICMP Administratively Prohibited';
    default:
      return 'Destination answer';
  }
}

/** ICMP type 3, code 3 -- the "you have arrived" signal of a UDP trace. */
function portUnreachableLayer(port: number): ProtocolLayer {
  return {
    layer: 'network',
    protocol: 'ICMP',
    fields: [
      { name: 'Type', value: '3 (Destination Unreachable)', bits: 8 },
      {
        name: 'Code',
        value: '3 (Port Unreachable)',
        bits: 8,
        note: 'Nothing is listening on the port the probe was aimed at. Traceroute chose an unassigned port precisely so this would happen -- it is how the tool recognises the destination.',
      },
      { name: 'Unused', value: '0', bits: 32 },
    ],
    payloadPreview: `IPv4 header + the first 8 bytes of the UDP header, so the sender can match port ${port} to the probe it sent`,
  };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function formatOutput(
  path: DiagnosticPath,
  hops: readonly TracerouteHop[],
  maxTtl: number,
  reachedDestination: boolean,
): string[] {
  const lines = [
    `traceroute to ${path.destination.hostname} (${path.destination.address}), ${maxTtl} hops max, 60 byte packets`,
    ...hops.map((hop) => hop.line),
  ];

  if (!reachedDestination) {
    lines.push(
      '',
      `The destination never answered. A real traceroute would go on printing "* * *" up to hop ${maxTtl} before giving up; the trace stops here because there is nothing further to learn from it.`,
    );
  }

  return lines;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Re-exported so a view can name the hop type without reaching into `path.ts`. */
export type { PathHop };
