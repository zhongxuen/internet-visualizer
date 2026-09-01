/**
 * ISP path -- home router to a server on the other side of the world.
 *
 * The scenario where distance starts to cost something. A request leaves a house in
 * Singapore and has two very different ways out: one hop to a CDN sitting on the local
 * Internet exchange, or a paid transit path across 13 000 km of fibre to Frankfurt. The
 * two are drawn side by side because the contrast -- 11 ms against 95 ms one way -- is
 * the reason content delivery networks exist at all.
 *
 * Accuracy choices worth defending:
 *
 * - The **IXP is a switch**, not a router. An exchange is a layer-2 fabric; the BGP
 *   sessions run between the members' own routers across it. Drawing it as a router is
 *   the usual mistake and it hides who is actually peering with whom.
 * - Every AS number comes from **AS64496-AS64511**, reserved for documentation, so no
 *   real operator is implicated in a made-up peering arrangement.
 * - The long hop is 82 ms one way, which is what 13 000 km of glass actually costs. See
 *   the note on that link for the arithmetic.
 * - Routers hold one address here for readability. A real router has one per interface;
 *   where a second interface matters to the story it is named in `detail`.
 */

import type { Topology } from '../types/topology';

import { rfc, type ScenarioTopology } from './types';

const topology: Topology = {
  nodes: [
    {
      id: 'home-router',
      kind: 'router',
      label: 'Home router (NAPT)',
      ipv4: '192.168.1.1',
      detail: {
        'LAN interface': '192.168.1.1/24',
        'WAN interface': '203.0.113.7/24',
        'Default route': 'Everything not on the LAN goes to 203.0.113.1',
        'Knows about': 'Two networks. It has never heard of BGP.',
      },
    },
    {
      id: 'access-node',
      kind: 'router',
      label: 'ISP access node',
      ipv4: '203.0.113.1',
      detail: {
        Role: 'Terminates thousands of subscriber lines',
        AS: 'AS64496, the access ISP',
        Location: 'Singapore',
      },
    },
    {
      id: 'regional-pop',
      kind: 'router',
      label: 'Regional POP router',
      ipv4: '203.0.113.254',
      detail: {
        AS: 'AS64496, the access ISP',
        Location: 'Singapore',
        'IXP port': '198.51.100.10, on the exchange peering LAN',
        'Transit port': 'Up to AS64497',
        Decides: 'Peering for what it can, transit for everything else',
      },
    },
    {
      id: 'ixp',
      kind: 'switch',
      label: 'Internet exchange (SG)',
      detail: {
        'What it is':
          'A layer-2 switching fabric. Members plug in and talk to each other.',
        'Peering LAN': '198.51.100.0/24',
        'Does not route': 'BGP runs between members across it, not on it',
        Cost: 'Settlement-free. Each side pays only for its own port.',
      },
    },
    {
      id: 'peer-cdn',
      kind: 'cdn-edge',
      label: 'CDN edge (SG)',
      ipv4: '198.51.100.60',
      detail: {
        AS: 'AS64500, a content network',
        Reached: 'By peering, one hop across the exchange',
        Why: 'Being local is the entire product',
      },
    },
    {
      id: 'transit-sg',
      kind: 'router',
      label: 'Transit provider (SG)',
      ipv4: '192.0.2.11',
      detail: {
        AS: 'AS64497, a global transit network',
        Sells: 'Reachability to everywhere AS64496 cannot peer with directly',
        Billing: 'Per megabit of 95th-percentile traffic',
      },
    },
    {
      id: 'transit-fra',
      kind: 'router',
      label: 'Transit provider (FRA)',
      ipv4: '192.0.2.12',
      detail: {
        AS: 'AS64497, a global transit network',
        Location: 'Frankfurt',
        'Reached over': 'The provider backbone from Singapore',
      },
    },
    {
      id: 'hosting-edge',
      kind: 'router',
      label: 'Hosting provider edge',
      ipv4: '192.0.2.20',
      detail: {
        AS: 'AS64499, the hosting provider',
        Announces: '192.0.2.0/24 to its transit provider',
        Location: 'Frankfurt',
      },
    },
    {
      id: 'origin',
      kind: 'server',
      label: 'app.example origin',
      ipv4: '192.0.2.80',
      detail: {
        Serves: 'The application itself, the part no cache can answer for',
        Location: 'Frankfurt',
        Note: 'Simulated. No real host is contacted.',
      },
    },
  ],
  links: [
    {
      id: 'access',
      from: 'home-router',
      to: 'access-node',
      latencyMs: 6,
      bandwidthMbps: 1000,
      medium: 'fiber',
    },
    {
      id: 'backhaul',
      from: 'access-node',
      to: 'regional-pop',
      latencyMs: 3,
      bandwidthMbps: 10000,
      medium: 'fiber',
    },
    {
      id: 'peering-port',
      from: 'regional-pop',
      to: 'ixp',
      latencyMs: 1,
      bandwidthMbps: 100000,
      medium: 'fiber',
    },
    {
      id: 'peering-cdn',
      from: 'ixp',
      to: 'peer-cdn',
      latencyMs: 0.8,
      bandwidthMbps: 100000,
      medium: 'fiber',
    },
    {
      id: 'transit-up',
      from: 'regional-pop',
      to: 'transit-sg',
      latencyMs: 2,
      bandwidthMbps: 100000,
      medium: 'fiber',
    },
    {
      id: 'backbone',
      from: 'transit-sg',
      to: 'transit-fra',
      latencyMs: 82,
      bandwidthMbps: 400000,
      medium: 'fiber',
    },
    {
      id: 'handoff',
      from: 'transit-fra',
      to: 'hosting-edge',
      latencyMs: 1.5,
      bandwidthMbps: 100000,
      medium: 'fiber',
    },
    {
      id: 'rack',
      from: 'hosting-edge',
      to: 'origin',
      latencyMs: 0.3,
      bandwidthMbps: 25000,
      medium: 'ethernet',
    },
  ],
};

export const ISP_PATH: ScenarioTopology = {
  id: 'isp-path',
  title: 'ISP path',
  summary:
    'Singapore to Frankfurt, and Singapore to a CDN one hop away. Autonomous systems, peering against transit, and the price of distance.',
  teaches: [
    'Autonomous systems and AS numbers',
    'Peering vs transit',
    'What an Internet exchange actually is',
    'Why latency grows with distance',
    'BGP, conceptually',
  ],
  topology,
  notes: [
    {
      targetId: 'home-router',
      text: 'The home router knows two networks: the one inside the house and everything else. It has no routing table worth the name and no opinion about the path a packet takes; it forwards anything non-local to its default route and the ISP decides the rest. Every device on the far side of this diagram is running the protocol it has never heard of.',
      reference: rfc(3022, 'Traditional IP Network Address Translator (Traditional NAT)'),
    },
    {
      targetId: 'access-node',
      text: 'This is where the subscriber line becomes ISP traffic, and where the packet enters AS64496: one autonomous system, one operator, one consistent routing policy. An AS number identifies who is responsible for a set of prefixes, which is what makes it possible for the rest of the Internet to hold an opinion about routing to them.',
      reference: rfc(
        1930,
        'Guidelines for creation, selection, and registration of an Autonomous System (AS)',
      ),
    },
    {
      targetId: 'regional-pop',
      text: 'The point of presence is where the ISP makes the choice that shapes the rest of this diagram. It has learned routes by BGP from two places, peers at the exchange and its transit provider, and for any destination it prefers the peer if one exists because that path is free and shorter. Everything else goes up to transit and gets billed.',
      reference: rfc(4271, 'A Border Gateway Protocol 4 (BGP-4)'),
    },
    {
      targetId: 'ixp',
      text: 'An exchange is a large layer-2 switch in a building that many networks happen to be in. It routes nothing: members connect a router to it, share a subnet, and open BGP sessions with each other across it, so the exchange only ever forwards frames. Drawing it as a router hides the fact that peering is an arrangement between two members, not a service the exchange provides.',
      reference: rfc(7947, 'Internet Exchange BGP Route Server'),
    },
    {
      targetId: 'peer-cdn',
      text: 'The content network is a different AS sitting on the same exchange, reachable in one hop for the cost of a port at each end and no traffic charge. Round trip from the house is about 22 ms against roughly 190 ms to Frankfurt, which is the entire argument for putting content close to the people asking for it.',
      reference: rfc(4786, 'Operation of Anycast Services (BCP 126)'),
    },
    {
      targetId: 'transit-sg',
      text: 'Transit is reachability you pay for: AS64497 promises to carry traffic to every destination on the Internet, not just to its own customers. The ISP buys it because it cannot peer directly with everyone, and it prefers peering wherever it can precisely because transit is metered.',
      reference: rfc(4271, 'A Border Gateway Protocol 4 (BGP-4)', '9.1.2'),
    },
    {
      targetId: 'transit-fra',
      text: 'The same autonomous system, 13 000 km away. Nothing about the packet changes here beyond a decremented hop count; what changed was the clock, and by more than everything else on this path combined.',
    },
    {
      targetId: 'hosting-edge',
      text: 'The hosting provider announces 192.0.2.0/24 to its transit provider, which passes the announcement on, until routers worldwide know that traffic for that prefix should be sent this way. A destination is only reachable because somebody, somewhere, is claiming responsibility for it in BGP.',
      reference: rfc(4632, 'Classless Inter-domain Routing (CIDR)'),
    },
    {
      targetId: 'origin',
      text: 'The origin is the machine that can answer questions no cache can: anything personalised, anything just written, anything computed. It is 95 ms away one way, about 190 ms for a round trip, and a page that needs several of those in sequence will feel it.',
      reference: rfc(9110, 'HTTP Semantics'),
    },
    {
      targetId: 'access',
      text: 'The access hop costs 6 ms one way, more than every metre of cable inside the house put together. This is the number that dominates a broadband connection, and no amount of local network tuning changes it.',
    },
    {
      targetId: 'backbone',
      text: 'About 13 000 km of fibre. Light moves through glass at roughly two-thirds of its speed in vacuum, near 200 000 km/s, so the cable alone accounts for about 65 ms each way; amplifiers and router hops make up the remaining 17. No protocol can improve on this: it is the shape of the planet, not a tuning problem.',
    },
  ],
};
