/**
 * The paths the two probe tools walk, and the per-hop facts that make them interesting.
 *
 * `ping.ts` and `traceroute.ts` are the same experiment run two ways -- send something,
 * see what comes back, and be careful about what the silence means -- so they share one
 * description of the wire rather than each inventing a topology. A path here is a source
 * host, an ordered list of routers, and a destination, with every hop carrying the two
 * properties a real traceroute output depends on and a diagram normally hides:
 *
 * - **`respondsToTtl`** -- whether this router bothers to answer a TTL expiry at all. A
 *   router that does not is not broken and the path through it is not broken; the probe
 *   simply gets nothing, and the tool prints `* * *`.
 * - **`returnSkewMs`** -- how much longer the ICMP reply takes coming back than the probe
 *   took getting there. Traceroute measures a *round* trip and can only draw the forward
 *   half, so any hop whose reply comes home a different way reports a time that belongs
 *   to a path the output never shows.
 *
 * Everything here is fiction, and deliberately unmistakable fiction. Every address comes
 * from a range RFC 5737 and RFC 1918 reserve for documentation and private use, every
 * host name is under a TLD RFC 2606 reserves, and no function in this module -- or in any
 * file that imports it -- can be handed a host to contact. Learn mode has no network.
 */

import type { LinkMedium, SimLink, SimNode, Topology } from '@/core/types/topology';

// ---------------------------------------------------------------------------
// How a destination treats an echo request
// ---------------------------------------------------------------------------

/**
 * What the far end does with an ICMP Echo Request.
 *
 * The point of naming four of these rather than a `reachable: boolean` is that only the
 * first one means "up" and only the last one means "down" -- and the two in the middle,
 * which are the common cases on the real Internet, mean nothing about the host at all.
 */
export type IcmpPolicy =
  /** Answers every echo. The textbook case, and increasingly the rare one. */
  | 'echo'
  /**
   * Drops echo requests and says nothing. The host is fine; a filter in front of it has
   * a rule about ICMP type 8. Indistinguishable, from the sender's side, from a machine
   * that has been unplugged -- which is the entire lesson of the ping tool.
   */
  | 'filtered-silent'
  /**
   * Drops echo requests and admits it: ICMP Destination Unreachable, code 13,
   * Communication Administratively Prohibited. Honest, and therefore rare, because
   * saying "there is a firewall here" is itself information some operators withhold.
   */
  | 'filtered-prohibited'
  /**
   * Answers, but not every time: the host rate-limits ICMP, so echo replies are the
   * first thing it drops under load. Produces partial loss that looks exactly like a
   * congested link and is not one.
   */
  | 'rate-limited'
  /**
   * The host is genuinely gone. The last-hop router still answers -- ICMP Destination
   * Unreachable, code 1, Host Unreachable, because its ARP for the address goes
   * unanswered -- so "down" on a reachable network is not silence. It is a *different
   * machine* telling you it could not deliver.
   */
  | 'host-down';

/** One-line summary of a policy, for the panel that explains the result. */
export const ICMP_POLICY_LABELS: Readonly<Record<IcmpPolicy, string>> = {
  echo: 'Answers echo requests',
  'filtered-silent': 'Drops echo requests silently',
  'filtered-prohibited': 'Rejects echo requests with an administrative prohibition',
  'rate-limited': 'Answers echo requests, but rate-limits them',
  'host-down': 'Not there -- the last router reports it unreachable',
};

// ---------------------------------------------------------------------------
// Hops
// ---------------------------------------------------------------------------

/** A second router occupying the same position in the path, for a load-balanced hop. */
export interface ParallelRouter {
  readonly id: string;
  readonly label: string;
  readonly address: string;
}

/** One router on the way, and everything that decides what traceroute prints for it. */
export interface PathHop {
  /** `SimNode.id`, unique within the path. */
  readonly id: string;
  readonly label: string;
  /** Dotted quad, always from a documentation or private range. */
  readonly address: string;
  /** One-way propagation delay of the link *reaching* this hop, virtual milliseconds. */
  readonly linkMs: number;
  /** What the link reaching this hop physically is; drawn, never used in arithmetic. */
  readonly medium?: LinkMedium;
  /**
   * Whether this router answers a TTL expiry with ICMP Time Exceeded.
   *
   * False is not a fault. Generating ICMP is control-plane work on a box built to
   * forward in hardware, and plenty of operators disable it or filter it outbound. The
   * probe is still forwarded correctly by every hop after it -- which is why a `* * *`
   * in the middle of an otherwise complete trace tells you nothing is wrong.
   */
  readonly respondsToTtl: boolean;
  /**
   * Milliseconds the ICMP reply from this hop takes *beyond* the forward propagation,
   * because it comes back a different way.
   *
   * Traceroute times a round trip and prints it in a column headed by a forward hop, so
   * a positive skew here is the mechanism behind the classic confusing output: hop 7
   * slower than hop 8, with nothing at all wrong at hop 7.
   *
   * Deliberately **not** accumulated down the path. Each router chooses its own route
   * home for the replies it generates, so this belongs to the hop that answers and to no
   * other -- which is precisely what makes the inversion possible.
   */
  readonly returnSkewMs?: number;
  /**
   * A sibling router at the same position. Probes are spread across the pair by the
   * seeded generator, so one hop row shows two addresses -- which is a load balancer
   * doing its job, not an unstable network.
   */
  readonly parallel?: ParallelRouter;
  /** Why this hop is worth looking at. Shown beside its row. */
  readonly note?: string;
}

/** Where the probes come from. Always a simulated machine on a simulated LAN. */
export interface PathSource {
  readonly id: string;
  readonly label: string;
  readonly address: string;
  /** The TTL this host stamps on an outgoing packet, before anything decrements it. */
  readonly initialTtl: number;
}

/** The far end. */
export interface PathDestination {
  readonly id: string;
  readonly label: string;
  readonly hostname: string;
  readonly address: string;
  /** One-way propagation delay of the last link. */
  readonly linkMs: number;
  readonly medium?: LinkMedium;
  readonly icmp: IcmpPolicy;
  /**
   * Milliseconds this host's replies take beyond the forward propagation, for the same
   * reason a router's do. See {@link PathHop.returnSkewMs}.
   */
  readonly returnSkewMs?: number;
  /**
   * The TTL this host *stamps* on its own replies, before anything decrements it.
   *
   * Not what ping prints. Ping prints what is left when the reply arrives, and the
   * difference between the two is the number of routers on the way back -- which is why
   * `ttl=57` from a host that starts at 64 is the closest thing ping has to a hop count.
   */
  readonly replyTtl: number;
  /**
   * Whether a TCP connection to port 443 completes.
   *
   * Carried next to the ICMP policy on purpose: the two together are the whole argument
   * of the ping panel. A host can be silent on one and answering on the other, and only
   * one of those two facts is about whether the host is up.
   */
  readonly tcpOpen: boolean;
  readonly note?: string;
}

/**
 * Per-probe variability, as a bound and a rate rather than a distribution object.
 *
 * Jitter is drawn uniformly from `[0, jitterMs)` and added to the round trip. Uniform
 * rather than a bell curve: the numbers are small, the point is that they *move*, and a
 * generator a reader can follow beats a plausible-looking one they cannot.
 */
export interface PathConditions {
  /** Upper bound on the jitter added to any one round trip. */
  readonly jitterMs: number;
  /** Chance a probe is lost on the wire, independent of what the far end does. */
  readonly lossRate: number;
  /** Milliseconds a router spends generating an ICMP message; small, but not zero. */
  readonly icmpGenerationMs: number;
}

/** A quiet wired path: a little jitter, no loss. */
export const DEFAULT_CONDITIONS: PathConditions = {
  jitterMs: 3,
  lossRate: 0,
  icmpGenerationMs: 0.4,
};

/** A network to probe, with everything both tools need to probe it. */
export interface DiagnosticPath {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  /** What a learner should walk away with, as short phrases. */
  readonly teaches: readonly string[];
  readonly source: PathSource;
  /** The routers between source and destination, in the order a packet visits them. */
  readonly hops: readonly PathHop[];
  readonly destination: PathDestination;
  readonly conditions?: PathConditions;
}

// ---------------------------------------------------------------------------
// Derived geometry
// ---------------------------------------------------------------------------

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The conditions a path runs under, defaults filled in. */
export function conditionsOf(path: DiagnosticPath): PathConditions {
  return { ...DEFAULT_CONDITIONS, ...path.conditions };
}

/** How many TTL steps the destination is away: every router, plus the destination. */
export function hopCount(path: DiagnosticPath): number {
  return path.hops.length + 1;
}

/**
 * One-way propagation delay from the source to the machine at `ttl`, in milliseconds.
 *
 * `ttl` is 1-based and matches the TTL that expires there: TTL 1 dies at the first
 * router, so `oneWayMs(path, 1)` is the first link alone.
 */
export function oneWayMs(path: DiagnosticPath, ttl: number): number {
  let total = 0;
  for (let index = 0; index < ttl; index += 1) {
    const hop = path.hops[index];
    total += hop ? hop.linkMs : path.destination.linkMs;
  }
  return round2(total);
}

/** The machine a packet with this TTL reaches, or `undefined` past the destination. */
export function machineAt(
  path: DiagnosticPath,
  ttl: number,
): { id: string; label: string; address: string } | undefined {
  if (ttl < 1) return undefined;
  const hop = path.hops[ttl - 1];
  if (hop) return { id: hop.id, label: hop.label, address: hop.address };
  if (ttl === hopCount(path)) {
    const { id, label, address } = path.destination;
    return { id, label, address };
  }
  return undefined;
}

/** Node ids from the source outward, one per TTL step, destination last. */
export function nodeChain(path: DiagnosticPath): string[] {
  return [path.source.id, ...path.hops.map((hop) => hop.id), path.destination.id];
}

/** `SimLink.id` of the link a packet crosses to reach the machine at `ttl`. */
export function linkIdAt(path: DiagnosticPath, ttl: number): string {
  const chain = nodeChain(path);
  const from = chain[ttl - 1] ?? path.source.id;
  const to = chain[ttl] ?? path.destination.id;
  return `${from}-${to}`;
}

// ---------------------------------------------------------------------------
// The drawable network
// ---------------------------------------------------------------------------

/**
 * The path as a `Topology`.
 *
 * A load-balanced hop becomes two nodes wired in parallel between its neighbours, which
 * is what it physically is -- the breadth-first layout then stacks them in one column,
 * and the diamond in the diagram is the reason two addresses show up on one traceroute
 * row.
 */
export function buildTopology(path: DiagnosticPath): Topology {
  const nodes: SimNode[] = [
    {
      id: path.source.id,
      kind: 'client',
      label: path.source.label,
      ipv4: path.source.address,
      detail: {
        Role: 'The machine running the probe',
        'Initial TTL': `${path.source.initialTtl} on every outgoing packet`,
        Simulated: 'Nothing here leaves your browser.',
      },
    },
  ];
  const links: SimLink[] = [];

  /** The node ids a packet can arrive from, given the hop index it is arriving at. */
  const previousOf = (index: number): string[] => {
    if (index === 0) return [path.source.id];
    const before = path.hops[index - 1];
    if (!before) return [path.source.id];
    return before.parallel ? [before.id, before.parallel.id] : [before.id];
  };

  path.hops.forEach((hop, index) => {
    nodes.push({
      id: hop.id,
      kind: 'router',
      label: hop.label,
      ipv4: hop.address,
      detail: {
        'Hop (TTL)': String(index + 1),
        'Answers TTL expiry': hop.respondsToTtl ? 'yes' : 'no -- prints as *',
        ...(hop.returnSkewMs
          ? { 'Return path': `${hop.returnSkewMs} ms longer than the way out` }
          : {}),
        ...(hop.note ? { Note: hop.note } : {}),
      },
    });

    if (hop.parallel) {
      nodes.push({
        id: hop.parallel.id,
        kind: 'router',
        label: hop.parallel.label,
        ipv4: hop.parallel.address,
        detail: {
          'Hop (TTL)': String(index + 1),
          Role: 'The other half of a load-balanced pair',
          'Answers TTL expiry': hop.respondsToTtl ? 'yes' : 'no -- prints as *',
        },
      });
    }

    const arrivals = hop.parallel ? [hop.id, hop.parallel.id] : [hop.id];
    for (const from of previousOf(index)) {
      for (const to of arrivals) {
        links.push({
          id: `${from}-${to}`,
          from,
          to,
          latencyMs: hop.linkMs,
          ...(hop.medium ? { medium: hop.medium } : {}),
        });
      }
    }
  });

  nodes.push({
    id: path.destination.id,
    kind: path.destination.icmp === 'echo' ? 'server' : 'firewall',
    label: path.destination.label,
    ipv4: path.destination.address,
    detail: {
      Hostname: path.destination.hostname,
      ICMP: ICMP_POLICY_LABELS[path.destination.icmp],
      'TCP 443': path.destination.tcpOpen
        ? 'accepts connections'
        : 'refused / no listener',
      'Reply TTL': String(path.destination.replyTtl),
      ...(path.destination.note ? { Note: path.destination.note } : {}),
    },
  });

  for (const from of previousOf(path.hops.length)) {
    links.push({
      id: `${from}-${path.destination.id}`,
      from,
      to: path.destination.id,
      latencyMs: path.destination.linkMs,
      ...(path.destination.medium ? { medium: path.destination.medium } : {}),
    });
  }

  return { nodes, links };
}
