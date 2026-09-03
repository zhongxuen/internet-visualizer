/**
 * NAPT -- the one device on the path that changes an IP address, and the table that
 * lets it change it back.
 *
 * "NAT" as usually drawn is one private address swapped for one public address. That is
 * not what a home router does and it would not work if it did: a house has one public
 * address and a dozen devices behind it. What it actually runs is **NAPT** -- network
 * address *and port* translation (RFC 3022 s2.2), sometimes called PAT or "overloading"
 * -- where the source port is rewritten along with the source address, and the
 * translated port is the only thing distinguishing one device's connection from
 * another's.
 *
 * That table is the clearest explanation there is of several things at once:
 *
 * - **Why replies find their way home.** A reply carries the public address and the
 *   translated port; the router looks the pair up and puts the original address and
 *   port back. No table row, no return path.
 * - **Why inbound connections need port forwarding.** An unsolicited packet from
 *   outside matches no row, so there is nothing to translate it *to* and it is dropped.
 *   Nothing is being blocked on purpose -- the router simply does not know which of the
 *   twelve machines behind it the packet was for. See {@link translateInbound}.
 * - **Why the address in the IPv4 header is otherwise sacred.** Every router on the
 *   path leaves it alone; this box is the exception, and the exception has to keep
 *   state to be able to undo itself.
 *
 * This file deals in {@link Flow} structs -- protocol plus two endpoints -- and knows
 * nothing about PDUs, headers, or layers. Translation is a function on a five-tuple;
 * keeping it that way is what makes it directly testable and lets `journey.ts` apply
 * the result to a TCP segment or a UDP datagram without this file caring which.
 */

import { parseIpv4 } from '@/core/net/address';
import { unwrap } from '@/core/net/result';
import { EPHEMERAL_PORT_RANGE, MAX_PORT, type Transport } from '@/core/net/ports';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** NAPT needs a port to rewrite, so it only handles the port-bearing protocols. */
export type NatProtocol = Transport;

/** One end of a flow: an address and a port. */
export interface FlowEndpoint {
  readonly ip: string;
  readonly port: number;
}

/**
 * The five-tuple that identifies a conversation: protocol, source, destination.
 *
 * A NAT's whole job is to be a function from one of these to another, in both
 * directions, consistently, for as long as the conversation lasts.
 */
export interface Flow {
  readonly protocol: NatProtocol;
  readonly source: FlowEndpoint;
  readonly destination: FlowEndpoint;
}

/**
 * One row of the translation table, in the vocabulary RFC 2663 uses.
 *
 * `insideLocal` is the address as the house sees it, `insideGlobal` is the same machine
 * as the Internet sees it, and `outside` is who it is talking to. Keeping the outside
 * endpoint in the row is not decoration: it is what makes the filtering
 * endpoint-dependent, so a reply from a *different* server cannot ride in on a port
 * opened for someone else.
 */
export interface NatBinding {
  readonly protocol: NatProtocol;
  /** The private address and port the device actually used. */
  readonly insideLocal: FlowEndpoint;
  /** The public address and the port the router allocated for it. */
  readonly insideGlobal: FlowEndpoint;
  /** The far end this flow is with. */
  readonly outside: FlowEndpoint;
  /** Virtual milliseconds at which the row was created. */
  readonly createdAt: number;
  /** Virtual milliseconds at which a packet last matched it, in either direction. */
  readonly lastUsedAt: number;
}

/**
 * The router's translation table.
 *
 * Immutable: every operation returns a new table, so the UI can hold the table as it
 * was at any point on the timeline and scrubbing backwards shows the rows that existed
 * then rather than the rows that exist now.
 */
export interface NatTable {
  /** The single public address every device behind this router shares. */
  readonly publicIp: string;
  /** Lowest port the router will allocate. */
  readonly firstPort: number;
  /** Highest port the router will allocate. */
  readonly lastPort: number;
  /**
   * Whether to keep the original source port when it happens to be free.
   *
   * Real NATs try to (RFC 4787 REQ-1), because some older protocols care. It defaults
   * to `false` here for a teaching reason: when the port is preserved the rewrite is
   * invisible, and the entire point of the module is that the port *changes*.
   */
  readonly preservePorts: boolean;
  /** The rows, in the order they were created. */
  readonly bindings: readonly NatBinding[];
}

/** What {@link createNatTable} needs. */
export interface NatTableInit {
  publicIp: string;
  firstPort?: number;
  lastPort?: number;
  preservePorts?: boolean;
}

/**
 * An empty table for a router with one public address.
 *
 * The default port range is the ephemeral range from `@/core/net/ports` -- 49152-65535,
 * the same range a host picks its own source ports from, and the reason a home router
 * runs out of translations at roughly sixteen thousand simultaneous flows per
 * destination rather than at some arbitrary vendor limit.
 */
export function createNatTable(init: NatTableInit): NatTable {
  const publicIp = unwrap(
    parseIpv4(init.publicIp),
    `NAT public address "${init.publicIp}"`,
  ).text;
  const firstPort = init.firstPort ?? EPHEMERAL_PORT_RANGE.first;
  const lastPort = init.lastPort ?? EPHEMERAL_PORT_RANGE.last;

  if (!Number.isInteger(firstPort) || firstPort < 1 || firstPort > MAX_PORT) {
    throw new RangeError(`NAT first port must be in 1..${MAX_PORT}, got ${firstPort}`);
  }
  if (!Number.isInteger(lastPort) || lastPort < firstPort || lastPort > MAX_PORT) {
    throw new RangeError(
      `NAT last port must be in ${firstPort}..${MAX_PORT}, got ${lastPort}`,
    );
  }

  return {
    publicIp,
    firstPort,
    lastPort,
    preservePorts: init.preservePorts ?? false,
    bindings: [],
  };
}

// ---------------------------------------------------------------------------
// Outbound
// ---------------------------------------------------------------------------

/** The result of offering an outbound packet to the NAT. */
export type NatOutbound =
  | {
      readonly kind: 'translated';
      /** The table with the row created, or its `lastUsedAt` refreshed. */
      readonly table: NatTable;
      /** The row this packet matched. */
      readonly binding: NatBinding;
      /** The flow as it leaves the WAN interface: source rewritten, destination untouched. */
      readonly flow: Flow;
      /** True when this packet is what created the row. */
      readonly created: boolean;
    }
  | {
      /**
       * Every port in the range is already bound for this destination. Rare, real, and
       * exactly what a house full of a thousand open connections to one server hits.
       */
      readonly kind: 'exhausted';
      readonly table: NatTable;
    };

/**
 * Translate a packet on its way out: rewrite the source address and source port, and
 * remember what was done so the reply can be undone.
 *
 * The **destination is never touched**. That is worth stating because it is what makes
 * the return path the interesting direction: the outbound rewrite is trivially
 * reversible only because the router wrote down what it did.
 *
 * A flow that already has a row reuses it -- the second packet of a connection must get
 * the same translated port as the first, or the far end would see two connections.
 */
export function translateOutbound(table: NatTable, flow: Flow, at: number): NatOutbound {
  const existing = findOutboundBinding(table, flow);
  if (existing) {
    const touched: NatBinding = { ...existing, lastUsedAt: at };
    return {
      kind: 'translated',
      table: { ...table, bindings: replaceBinding(table.bindings, existing, touched) },
      binding: touched,
      flow: translatedOutboundFlow(flow, touched),
      created: false,
    };
  }

  const port = allocatePort(table, flow);
  if (port === undefined) {
    return { kind: 'exhausted', table };
  }

  const binding: NatBinding = {
    protocol: flow.protocol,
    insideLocal: flow.source,
    insideGlobal: { ip: table.publicIp, port },
    outside: flow.destination,
    createdAt: at,
    lastUsedAt: at,
  };

  return {
    kind: 'translated',
    table: { ...table, bindings: [...table.bindings, binding] },
    binding,
    flow: translatedOutboundFlow(flow, binding),
    created: true,
  };
}

function translatedOutboundFlow(flow: Flow, binding: NatBinding): Flow {
  return {
    protocol: flow.protocol,
    source: binding.insideGlobal,
    destination: flow.destination,
  };
}

/**
 * Pick the public port for a new binding.
 *
 * Deterministic by construction: the lowest free port in the range, scanned from
 * `firstPort` upward. A real NAT randomises this (a predictable external port helps an
 * off-path attacker), but a simulation that picks a different port on every run cannot
 * be diffed, screenshotted, or tested.
 */
function allocatePort(table: NatTable, flow: Flow): number | undefined {
  const taken = new Set(
    table.bindings
      .filter((binding) => binding.protocol === flow.protocol)
      .map((binding) => binding.insideGlobal.port),
  );

  if (
    table.preservePorts &&
    flow.source.port >= table.firstPort &&
    flow.source.port <= table.lastPort &&
    !taken.has(flow.source.port)
  ) {
    return flow.source.port;
  }

  for (let port = table.firstPort; port <= table.lastPort; port += 1) {
    if (!taken.has(port)) {
      return port;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Inbound
// ---------------------------------------------------------------------------

/** The result of offering an inbound packet to the NAT. */
export type NatInbound =
  | {
      readonly kind: 'translated';
      readonly table: NatTable;
      readonly binding: NatBinding;
      /** The flow as it enters the LAN: destination put back, source untouched. */
      readonly flow: Flow;
    }
  | {
      /** No row matched. The packet is dropped -- see `reason`. */
      readonly kind: 'unmatched';
      readonly table: NatTable;
      readonly reason: string;
    };

/**
 * Translate a packet on its way in, by reversing a row.
 *
 * A match needs all four of: the same protocol, the packet addressed to the public
 * address and the allocated port, and coming *from* the outside endpoint the row was
 * created for. The last condition is what makes this filtering endpoint-dependent: a
 * port opened by talking to one server does not let a different host in behind it.
 *
 * When nothing matches, the packet is dropped, and the reason says why in the terms a
 * learner will meet again the first time they try to run a game server at home. This is
 * not a firewall rule -- there is no rule -- it is simply that the router has one public
 * address, a dozen machines behind it, and no way to guess which one an unsolicited
 * packet was meant for. A port-forwarding entry is a row added by hand to answer that
 * question in advance.
 */
export function translateInbound(table: NatTable, flow: Flow, at: number): NatInbound {
  if (flow.destination.ip !== table.publicIp) {
    return {
      kind: 'unmatched',
      table,
      reason: `not addressed to this router's public address (${table.publicIp})`,
    };
  }

  const binding = table.bindings.find(
    (candidate) =>
      candidate.protocol === flow.protocol &&
      candidate.insideGlobal.port === flow.destination.port &&
      candidate.outside.ip === flow.source.ip &&
      candidate.outside.port === flow.source.port,
  );

  if (!binding) {
    const portInUse = table.bindings.some(
      (candidate) =>
        candidate.protocol === flow.protocol &&
        candidate.insideGlobal.port === flow.destination.port,
    );
    return {
      kind: 'unmatched',
      table,
      reason: portInUse
        ? `port ${flow.destination.port} is bound, but to a conversation with a different host -- a reply from ${flow.source.ip}:${flow.source.port} does not belong to it`
        : `no translation table row for ${flow.protocol}/${flow.destination.port}: nothing behind this router asked for it, so there is no address to deliver it to (this is why an inbound service needs port forwarding)`,
    };
  }

  const touched: NatBinding = { ...binding, lastUsedAt: at };
  return {
    kind: 'translated',
    table: { ...table, bindings: replaceBinding(table.bindings, binding, touched) },
    binding: touched,
    flow: {
      protocol: flow.protocol,
      source: flow.source,
      destination: binding.insideLocal,
    },
  };
}

// ---------------------------------------------------------------------------
// Housekeeping and display
// ---------------------------------------------------------------------------

/** The row an outbound flow would use, if one exists. */
export function findOutboundBinding(table: NatTable, flow: Flow): NatBinding | undefined {
  return table.bindings.find(
    (binding) =>
      binding.protocol === flow.protocol &&
      binding.insideLocal.ip === flow.source.ip &&
      binding.insideLocal.port === flow.source.port &&
      binding.outside.ip === flow.destination.ip &&
      binding.outside.port === flow.destination.port,
  );
}

/**
 * Idle timeouts, as most home routers use them.
 *
 * The UDP number is the reason a device behind a NAT has to send a keepalive every
 * couple of minutes to stay reachable: with no connection to observe, the router can
 * only guess that a silent flow is over.
 */
export const NAT_IDLE_TIMEOUT_MS = {
  tcp: 24 * 60 * 60 * 1000,
  udp: 5 * 60 * 1000,
} as const;

/**
 * Drop rows that have gone quiet.
 *
 * A NAT has finite memory, so a row cannot live forever -- and once it is gone, the
 * reply that finally arrives has nowhere to go. Long-lived idle TCP connections dying
 * silently behind a home router is this function, in production.
 */
export function expireNatBindings(
  table: NatTable,
  now: number,
  timeouts: { tcp: number; udp: number } = NAT_IDLE_TIMEOUT_MS,
): { table: NatTable; expired: readonly NatBinding[] } {
  const expired = table.bindings.filter(
    (binding) => now - binding.lastUsedAt >= timeouts[binding.protocol],
  );
  if (expired.length === 0) {
    return { table, expired: [] };
  }
  return {
    table: {
      ...table,
      bindings: table.bindings.filter((binding) => !expired.includes(binding)),
    },
    expired,
  };
}

/** One row of the translation table as the UI renders it. */
export interface NatTableRow {
  readonly protocol: string;
  readonly insideLocal: string;
  readonly insideGlobal: string;
  readonly outside: string;
}

/** The table as display strings, in creation order. */
export function natTableRows(table: NatTable): readonly NatTableRow[] {
  return table.bindings.map((binding) => ({
    protocol: binding.protocol.toUpperCase(),
    insideLocal: formatEndpoint(binding.insideLocal),
    insideGlobal: formatEndpoint(binding.insideGlobal),
    outside: formatEndpoint(binding.outside),
  }));
}

/** `'192.168.1.112:49152'`. */
export function formatEndpoint(endpoint: FlowEndpoint): string {
  return `${endpoint.ip}:${endpoint.port}`;
}

/** `'tcp 192.168.1.112:49152 -> 203.0.113.30:443'`. */
export function describeFlow(flow: Flow): string {
  return `${flow.protocol} ${formatEndpoint(flow.source)} -> ${formatEndpoint(flow.destination)}`;
}

function replaceBinding(
  bindings: readonly NatBinding[],
  from: NatBinding,
  to: NatBinding,
): readonly NatBinding[] {
  return bindings.map((binding) => (binding === from ? to : binding));
}
