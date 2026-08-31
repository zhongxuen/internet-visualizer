/**
 * Topology -- the "who is on the wire" half of the domain model.
 *
 * A topology is the static picture: the machines that take part in a scenario and the
 * links between them. It carries no timing and no traffic; those live in
 * `./events.ts`. A module declares its topology once, and every renderer (network map,
 * packet journey, inspector) reads the same object.
 *
 * Everything here is simulated. No address in a topology is ever contacted.
 */

/**
 * What role a machine plays on the network.
 *
 * The kind is behavioural, not cosmetic: it tells a simulation what the node is
 * expected to do with a packet (a router forwards and decrements TTL, a switch
 * forwards by MAC without touching layer 3, a NAT rewrites addresses and ports), and
 * it tells the UI which icon to draw.
 */
export type NodeKind =
  /** An end user's machine -- the browser, the CLI, the origin of a request. */
  | 'client'
  /** Layer 3 forwarder: routes between networks by IP, decrements TTL. */
  | 'router'
  /** Layer 2 forwarder: moves frames within one network segment by MAC address. */
  | 'switch'
  /** An origin server terminating the application protocol (HTTP, WebSocket, ...). */
  | 'server'
  /** Recursive/caching DNS resolver -- the resolver a client is configured to ask. */
  | 'dns-resolver'
  /** A DNS root server: knows the TLD servers, answers with referrals only. */
  | 'dns-root'
  /** A top-level-domain server (`.com`, `.org`): refers down to the authoritative NS. */
  | 'dns-tld'
  /** The authoritative name server for a zone -- the final, non-referral answer. */
  | 'dns-authoritative'
  /** A CDN point of presence serving cached content close to the client. */
  | 'cdn-edge'
  /** Distributes connections across a pool of backends (L4 or L7). */
  | 'load-balancer'
  /** An intermediary that terminates and re-issues the request on the client's behalf. */
  | 'proxy'
  /** Enforces a traffic policy: permits, drops, or resets flows. */
  | 'firewall'
  /** Network address translation -- rewrites private addresses to a public one. */
  | 'nat';

/**
 * One machine in the topology.
 *
 * Addresses are optional because not every node has (or needs) one at every layer: a
 * layer-2 switch has a MAC but is transparent at layer 3, and a teaching scenario may
 * deliberately omit IPv6 to keep the diagram readable.
 */
export interface SimNode {
  /**
   * Stable identifier, unique within a topology. Referenced by `SimLink.from`/`to` and
   * by every event that happens at a node, so it must not change between runs of the
   * same scenario -- event streams are compared for determinism.
   */
  id: string;
  /** The role this machine plays; drives both simulated behaviour and its icon. */
  kind: NodeKind;
  /** Human-readable name shown on the diagram, e.g. `'a.root-servers.net'`. */
  label: string;
  /**
   * IPv4 address in dotted-quad form, e.g. `'192.0.2.10'`.
   * Scenarios should prefer the documentation ranges reserved by RFC 5737
   * (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`) so no example address can be
   * mistaken for a real host.
   */
  ipv4?: string;
  /**
   * IPv6 address in RFC 4291 text form, e.g. `'2001:db8::10'`.
   * `2001:db8::/32` is the documentation prefix (RFC 3849) -- use it for the same reason.
   */
  ipv6?: string;
  /**
   * Layer-2 hardware address, e.g. `'02:00:5e:10:00:01'`. Only meaningful for nodes
   * that appear on a shared segment; the frame's source/destination MAC changes at
   * every hop while the IP addresses stay put, which is the point of showing it.
   */
  mac?: string;
  /**
   * Free-form key/value facts about the node, rendered in the inspector panel.
   * For teaching detail that has no fixed slot: OS, TTL defaults, cache size,
   * cipher support, AS number.
   */
  detail?: Record<string, string>;
}

/**
 * The physical or logical medium carrying a link. Affects the plausible latency and
 * bandwidth of a hop, and lets the UI draw a wireless hop differently from fiber.
 */
export type LinkMedium = 'ethernet' | 'wifi' | 'fiber' | 'cellular';

/**
 * A connection between two nodes.
 *
 * Links are undirected in the diagram but carry direction at use time: a `transmit`
 * event names its own `from` and `to`, and the same link can be traversed either way.
 */
export interface SimLink {
  /** Stable identifier, unique within a topology; referenced by `transmit` events. */
  id: string;
  /** `SimNode.id` of one endpoint -- the "source" side as drawn. */
  from: string;
  /** `SimNode.id` of the other endpoint. */
  to: string;
  /**
   * One-way propagation delay in **virtual milliseconds** -- how long a bit takes to
   * reach the far end. This is the "distance" of the hop; a round trip across a link
   * costs `2 * latencyMs` before any processing time is added.
   */
  latencyMs: number;
  /**
   * Link capacity in megabits per second, used to compute serialization delay
   * (the time to clock a whole PDU onto the wire: `sizeBytes * 8 / bandwidthMbps`).
   * Omit when a scenario only cares about propagation delay.
   */
  bandwidthMbps?: number;
  /** What the hop physically is. Purely descriptive; does not change the arithmetic. */
  medium?: LinkMedium;
}

/**
 * The complete static network a scenario runs on.
 *
 * Invariant every scenario is expected to hold: each `SimLink.from`/`to` names a node
 * present in `nodes`, and ids are unique within their own collection.
 */
export interface Topology {
  /** Every machine taking part, in the order they should be introduced to the learner. */
  nodes: SimNode[];
  /** Every link between those machines. */
  links: SimLink[];
}
