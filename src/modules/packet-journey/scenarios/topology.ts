/**
 * The network every Packet Journey scenario runs on: the home LAN and the ISP path,
 * joined at the machine they already share.
 *
 * Neither shared topology is enough on its own. `HOME_LAN` has the client, the layer-2
 * devices, and the NAPT router, but its far end is the ISP access router -- there is
 * nothing to send a packet *to*. `ISP_PATH` has the whole route out to a server in
 * Frankfurt, but it starts at the home router: no laptop, no LAN, no frame to rewrite.
 * A journey needs both halves.
 *
 * They join without any invention, because two of their machines are the same machine
 * seen from either side:
 *
 * | `HOME_LAN`                    | `ISP_PATH`    |
 * | ----------------------------- | ------------- |
 * | `router` (WAN `203.0.113.7`)  | `home-router` |
 * | `isp-gateway` (`203.0.113.1`) | `access-node` |
 *
 * So the composition keeps the home LAN entire, drops `ISP_PATH`'s duplicates of those
 * two, and re-attaches the rest of the route to `isp-gateway`. Nothing is edited: the
 * shared objects are read, never mutated, and every node here is a copy.
 *
 * ## The two things added
 *
 * - **MAC addresses** for the machines beyond the house. `HOME_LAN` gives every device
 *   one because that scenario is about the LAN; `ISP_PATH` omits them because that one
 *   is about autonomous systems. Packet Journey needs one at every layer-3 hop -- the
 *   frame being re-addressed at each router is the module's central claim -- so each is
 *   allocated the next free value in the same documentation range the shared topologies
 *   draw from (`00:00:5e:00:53:00`-`ff`, RFC 7042 s2.1.2).
 * - **The ISP's recursive resolver**, one hop off the access router. `udp-dns-query` and
 *   `fragmented-packet` need a UDP service to talk to, and a resolver in the access
 *   network is both where it really sits and close enough to keep those runs short.
 *
 * The exchange branch (`ixp`, `peer-cdn`) is carried over untouched even though no
 * scenario routes across it. It is what the shared notes on `regional-pop` refer to, and
 * a network being larger than the path through it is a fact worth leaving visible.
 *
 * This lives in the module rather than in `src/core/topologies` because it is not a
 * shared teaching scenario -- it is the stage for one module's four runs. If a later
 * phase needs the same end-to-end network, promote it then, the way phase 05's four were.
 */

import { HOME_LAN, ISP_PATH } from '@/core/topologies';
import type { SimLink, SimNode, Topology } from '@/core/types/topology';

/** The ISP's recursive resolver, in the access network beside the gateway. */
const RESOLVER_ID = 'isp-resolver';

/**
 * MACs for the machines the shared topologies leave without one.
 *
 * `HOME_LAN` already uses `...:01` through `...:07`, so these continue from `08` and
 * stay inside RFC 7042's documentation range -- no address here can belong to a real NIC.
 */
const ALLOCATED_MACS: Record<string, string> = {
  'isp-gateway': '00:00:5e:00:53:08',
  [RESOLVER_ID]: '00:00:5e:00:53:09',
  'regional-pop': '00:00:5e:00:53:0a',
  ixp: '00:00:5e:00:53:0b',
  'peer-cdn': '00:00:5e:00:53:0c',
  'transit-sg': '00:00:5e:00:53:0d',
  'transit-fra': '00:00:5e:00:53:0e',
  'hosting-edge': '00:00:5e:00:53:0f',
  origin: '00:00:5e:00:53:10',
};

function nodeFrom(topology: Topology, id: string): SimNode {
  const found = topology.nodes.find((node) => node.id === id);
  if (!found) {
    throw new Error(`packet-journey topology: no node "${id}" in the shared topology`);
  }
  const mac = ALLOCATED_MACS[id];
  return mac ? { ...found, mac } : { ...found };
}

function linkFrom(
  topology: Topology,
  id: string,
  overrides: Partial<SimLink> = {},
): SimLink {
  const found = topology.links.find((link) => link.id === id);
  if (!found) {
    throw new Error(`packet-journey topology: no link "${id}" in the shared topology`);
  }
  return { ...found, ...overrides };
}

const home = HOME_LAN.topology;
const isp = ISP_PATH.topology;

/** The only machine here that neither shared scenario provides. */
const RESOLVER: SimNode = {
  id: RESOLVER_ID,
  kind: 'dns-resolver',
  label: 'ISP resolver',
  ipv4: '203.0.113.53',
  mac: ALLOCATED_MACS[RESOLVER_ID],
  detail: {
    Role: 'The recursive resolver the home router hands out over DHCP',
    Listens: 'UDP and TCP port 53',
    Why: 'One hop away, so a name lookup costs a few milliseconds rather than a trip abroad',
    Note: 'Simulated. No real resolver is contacted.',
  },
};

/** Everything past the access router, in the order the route visits it. */
const ISP_TAIL = [
  'regional-pop',
  'ixp',
  'peer-cdn',
  'transit-sg',
  'transit-fra',
  'hosting-edge',
  'origin',
];

/** The composed network: the house, the access network, and the route to Frankfurt. */
export const JOURNEY_TOPOLOGY: Topology = {
  nodes: [
    // The house, entire, exactly as the Network Map draws it.
    ...home.nodes.map((node) => nodeFrom(home, node.id)),
    RESOLVER,
    // `home-router` and `access-node` are deliberately absent: they are `router` and
    // `isp-gateway` above, under the home LAN's names for the same two machines.
    ...ISP_TAIL.map((id) => nodeFrom(isp, id)),
  ],
  links: [
    ...home.links.map((link) => linkFrom(home, link.id)),
    {
      id: 'resolver-link',
      from: 'isp-gateway',
      to: RESOLVER_ID,
      latencyMs: 1.2,
      bandwidthMbps: 10000,
      medium: 'fiber',
    },
    // `backhaul` starts at `access-node` in ISP_PATH, which is `isp-gateway` here.
    linkFrom(isp, 'backhaul', { from: 'isp-gateway' }),
    linkFrom(isp, 'peering-port'),
    linkFrom(isp, 'peering-cdn'),
    linkFrom(isp, 'transit-up'),
    linkFrom(isp, 'backbone'),
    linkFrom(isp, 'handoff'),
    linkFrom(isp, 'rack'),
  ],
};

/**
 * Laptop to the origin server in Frankfurt, every machine on the way.
 *
 * The layer-2 devices (`ap`, `lan-switch`, `modem`) are listed because a packet really
 * does cross them. The journey engine recognises them as transparent and shows the frame
 * passing through unchanged -- which is the distinction this module exists to teach, and
 * the one a path that skipped them would quietly erase.
 */
export const PATH_TO_ORIGIN = [
  'laptop',
  'ap',
  'lan-switch',
  'router',
  'modem',
  'isp-gateway',
  'regional-pop',
  'transit-sg',
  'transit-fra',
  'hosting-edge',
  'origin',
] as const;

/** Laptop to the ISP's resolver: the same house, then one hop past the gateway. */
export const PATH_TO_RESOLVER = [
  'laptop',
  'ap',
  'lan-switch',
  'router',
  'modem',
  'isp-gateway',
  RESOLVER_ID,
] as const;

/**
 * The access line's MTU.
 *
 * The router runs PPPoE over the fibre, which costs 8 of the 1500 bytes and leaves 1492
 * -- the most common non-1500 MTU on the Internet, and the reason path MTU discovery is
 * not a theoretical concern. `fragmented-packet` is built on this one number.
 */
export const ACCESS_LINK_MTU: Readonly<Record<string, number>> = {
  'access-uplink': 1492,
};

/** The public address the home router translates every device in the house onto. */
export const HOME_PUBLIC_IP = '203.0.113.7';

/** The laptop's private address, as the house sees it. */
export const LAPTOP_IP = '192.168.1.112';
