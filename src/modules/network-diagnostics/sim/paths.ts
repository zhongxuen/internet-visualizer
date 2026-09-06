/**
 * The six networks the probe tools run against.
 *
 * Each one exists to make exactly one lie easy to catch. The first is the baseline where
 * the tools mean what a beginner thinks they mean; the other five are the cases where
 * they do not, and between them they cover every {@link IcmpPolicy}:
 *
 * | Path              | ICMP at the far end   | What it is here to show                       |
 * | ----------------- | --------------------- | --------------------------------------------- |
 * | `local-cdn`       | `echo`                | the baseline: short, clean, honest             |
 * | `flaky-wifi`      | `echo`                | loss at hop 1 -- the far end is not the fault  |
 * | `long-haul`       | `rate-limited`        | a silent hop, an asymmetric return, two paths  |
 * | `filtered-host`   | `filtered-silent`     | 100% loss from a host that is serving traffic  |
 * | `prohibited-host` | `filtered-prohibited` | a refusal, which is at least an answer         |
 * | `dead-host`       | `host-down`           | what *down* actually looks like                |
 *
 * The last three are the reason the module exists. `filtered-host` and `dead-host` are
 * one bit apart in what a beginner reads off the screen -- "no reply" -- and completely
 * different facts about the world, and the only way to tell them apart is to look at
 * *who* answered rather than at whether anything did.
 *
 * Addresses: `192.168.0.0/16` (RFC 1918) for the LAN, and `192.0.2.0/24`,
 * `198.51.100.0/24`, `203.0.113.0/24` (RFC 5737) everywhere else. Host names are under
 * `.example` (RFC 2606). None of these is a machine.
 */

import type { DiagnosticPath } from './path';

/** The laptop every path probes from. */
const LAPTOP = {
  id: 'laptop',
  label: 'Your laptop',
  address: '192.168.1.24',
  initialTtl: 64,
} as const;

/** The three hops out of the house, shared by the paths that start at home. */
const HOME_ROUTER = {
  id: 'home-router',
  label: 'Home router',
  address: '192.168.1.1',
  linkMs: 0.4,
  medium: 'wifi',
  respondsToTtl: true,
  note: 'The only hop on any of these paths that you own.',
} as const;

const ISP_ACCESS = {
  id: 'isp-access',
  label: 'ISP access node',
  address: '203.0.113.1',
  linkMs: 5.5,
  medium: 'fiber',
  respondsToTtl: true,
  note: 'Where the subscriber line becomes ISP traffic. Most of a broadband round trip is already spent by here.',
} as const;

const ISP_POP = {
  id: 'isp-pop',
  label: 'Regional POP router',
  address: '203.0.113.254',
  linkMs: 2.5,
  medium: 'fiber',
  respondsToTtl: true,
} as const;

// ---------------------------------------------------------------------------

/** The baseline: five short hops to content sitting on the local exchange. */
export const LOCAL_CDN: DiagnosticPath = {
  id: 'local-cdn',
  title: 'CDN one hop away',
  summary:
    'A short, healthy path to a cache on the local Internet exchange. Every router answers, the destination answers, and both tools mean exactly what they appear to mean. Read this one first so the other five have something to disagree with.',
  teaches: [
    'What a clean ping and a clean traceroute look like',
    'Round-trip time is round trip, not distance',
    'Reading hop count off the reply TTL',
  ],
  source: LAPTOP,
  hops: [
    HOME_ROUTER,
    ISP_ACCESS,
    ISP_POP,
    {
      id: 'ixp-edge',
      label: 'Exchange peering router',
      address: '198.51.100.10',
      linkMs: 1,
      medium: 'fiber',
      respondsToTtl: true,
      note: 'The ISP port on the exchange. The cache is one settlement-free hop past it.',
    },
  ],
  destination: {
    id: 'cdn-edge',
    label: 'CDN edge cache',
    hostname: 'assets.example',
    address: '198.51.100.60',
    linkMs: 0.9,
    medium: 'fiber',
    icmp: 'echo',
    replyTtl: 64,
    tcpOpen: true,
    note: 'Being close is the entire product, so this operator has every reason to answer probes.',
  },
  conditions: { jitterMs: 1.6, lossRate: 0, icmpGenerationMs: 0.4 },
};

/** The same short path, with a bad first metre. */
export const FLAKY_WIFI: DiagnosticPath = {
  id: 'flaky-wifi',
  title: 'Flaky Wi-Fi',
  summary:
    'The same five hops, except the laptop is at the far end of the house. Roughly one probe in three never comes back and the times that do swing by tens of milliseconds -- and every bit of that happens before the packet has left the building.',
  teaches: [
    'Loss and jitter are properties of a hop, not of the destination',
    'Why the first hop is the one to check first',
    'Retransmission hides loss from applications but not from ping',
  ],
  source: LAPTOP,
  hops: [
    {
      ...HOME_ROUTER,
      linkMs: 3,
      note: 'A congested 2.4 GHz channel three rooms away. Every number the tools print on this path is downstream of this one link.',
    },
    ISP_ACCESS,
    ISP_POP,
    {
      id: 'ixp-edge',
      label: 'Exchange peering router',
      address: '198.51.100.10',
      linkMs: 1,
      medium: 'fiber',
      respondsToTtl: true,
    },
  ],
  destination: {
    id: 'cdn-edge',
    label: 'CDN edge cache',
    hostname: 'assets.example',
    address: '198.51.100.60',
    linkMs: 0.9,
    medium: 'fiber',
    icmp: 'echo',
    replyTtl: 64,
    tcpOpen: true,
    note: 'Answering normally throughout. It has no idea anything is wrong.',
  },
  conditions: { jitterMs: 26, lossRate: 0.3, icmpGenerationMs: 0.4 },
};

/** Eight hops, and three separate reasons the output is not a map. */
export const LONG_HAUL: DiagnosticPath = {
  id: 'long-haul',
  title: 'Across an ocean',
  summary:
    'Singapore to Frankfurt: a silent transit router, a backbone whose replies come home a different way, a load-balanced pair that puts two addresses on one row, and an origin that rate-limits ICMP. Every caveat in the traceroute panel is visible somewhere in this trace.',
  teaches: [
    'TTL expiry is what reveals a hop',
    'A * * * hop is usually policy, not a fault',
    'Traceroute times a round trip and draws only the way out',
    'Load balancing puts two addresses on one hop',
  ],
  source: LAPTOP,
  hops: [
    HOME_ROUTER,
    { ...ISP_ACCESS, linkMs: 6 },
    { ...ISP_POP, linkMs: 3 },
    {
      id: 'transit-ingress',
      label: 'Transit provider ingress',
      address: '192.0.2.11',
      linkMs: 2,
      medium: 'fiber',
      respondsToTtl: false,
      note: 'Forwards perfectly and answers nothing. Generating ICMP is control-plane work on a box built to forward in hardware, and this operator has it switched off.',
    },
    {
      id: 'backbone-fra',
      label: 'Backbone router (Frankfurt)',
      address: '192.0.2.12',
      linkMs: 82,
      medium: 'fiber',
      respondsToTtl: true,
      returnSkewMs: 14,
      note: '13 000 km of glass, about 82 ms of it. Its replies take a longer route home than the probes took getting here, so this row reads high for a reason the output cannot show.',
    },
    {
      id: 'hosting-edge-a',
      label: 'Hosting edge A',
      address: '192.0.2.20',
      linkMs: 1.5,
      medium: 'fiber',
      respondsToTtl: true,
      returnSkewMs: 28,
      parallel: {
        id: 'hosting-edge-b',
        label: 'Hosting edge B',
        address: '192.0.2.21',
      },
      note: 'Two routers sharing the load. Probes land on whichever one the flow hash picks, so this hop has two addresses and neither is wrong -- and both send their replies home the long way, which is why this row reads slower than the hop after it.',
    },
    {
      id: 'rack-router',
      label: 'Top-of-rack router',
      address: '192.0.2.30',
      linkMs: 0.3,
      medium: 'ethernet',
      respondsToTtl: true,
    },
  ],
  destination: {
    id: 'origin',
    label: 'app.example origin',
    hostname: 'app.example',
    address: '192.0.2.80',
    linkMs: 0.2,
    medium: 'ethernet',
    icmp: 'rate-limited',
    replyTtl: 64,
    tcpOpen: true,
    note: 'Answers roughly two echoes in three. Its ICMP budget is small on purpose -- replying to probes is the first work a busy host sheds, and it says nothing about the traffic that matters.',
  },
  conditions: { jitterMs: 6, lossRate: 0, icmpGenerationMs: 0.4 },
};

/** The headline case: 100% packet loss from a host that is serving requests. */
export const FILTERED_HOST: DiagnosticPath = {
  id: 'filtered-host',
  title: 'Filtered host',
  summary:
    'Ping reports 100% packet loss. The host is up, healthy, and answering HTTPS the whole time -- a firewall in front of it simply has a rule about ICMP type 8, and the firewall does not answer TTL expiry either, so the last two hops of the trace are stars as well.',
  teaches: [
    'No echo reply is not evidence that a host is down',
    'A filter drops the probe, not the service',
    'Checking a port is a different question from checking ICMP',
  ],
  source: LAPTOP,
  hops: [
    HOME_ROUTER,
    ISP_ACCESS,
    ISP_POP,
    {
      id: 'provider-border',
      label: 'Hosting provider border',
      address: '198.51.100.1',
      linkMs: 8,
      medium: 'fiber',
      respondsToTtl: true,
    },
    {
      id: 'edge-firewall',
      label: 'Edge firewall',
      address: '198.51.100.9',
      linkMs: 1.2,
      medium: 'fiber',
      respondsToTtl: false,
      note: 'Passes the HTTPS the host is busy serving, drops every echo request, and stays quiet about both. Silence from a filter is a policy, not a symptom.',
    },
  ],
  destination: {
    id: 'status-host',
    label: 'status.example web server',
    hostname: 'status.example',
    address: '198.51.100.80',
    linkMs: 0.5,
    medium: 'ethernet',
    icmp: 'filtered-silent',
    replyTtl: 64,
    tcpOpen: true,
    note: 'Up, serving, and invisible to ping. This is the ordinary state of a large fraction of the public Internet.',
  },
  conditions: { jitterMs: 2.5, lossRate: 0, icmpGenerationMs: 0.4 },
};

/** The same refusal, made out loud. */
export const PROHIBITED_HOST: DiagnosticPath = {
  id: 'prohibited-host',
  title: 'Administratively prohibited',
  summary:
    'The same policy as the filtered host, except this operator configured the ACL to answer instead of to drop: ICMP Destination Unreachable, code 13. Nothing gets through, but the reply names the machine that made the decision, which turns an unanswerable question into a one-line answer.',
  teaches: [
    'Drop and reject are both filtering; only one of them tells you so',
    'ICMP type 3 code 13 is a policy statement, not a fault',
    'Who replied matters more than whether anything replied',
  ],
  source: LAPTOP,
  hops: [
    HOME_ROUTER,
    ISP_ACCESS,
    {
      id: 'campus-border',
      label: 'Campus border router',
      address: '203.0.113.60',
      linkMs: 4,
      medium: 'fiber',
      respondsToTtl: true,
      note: 'The ACL lives here. It answers TTL expiry happily -- refusing to forward something is not the same as refusing to speak.',
    },
  ],
  destination: {
    id: 'internal-host',
    label: 'internal.example',
    hostname: 'internal.example',
    address: '203.0.113.90',
    linkMs: 0.6,
    medium: 'ethernet',
    icmp: 'filtered-prohibited',
    replyTtl: 64,
    tcpOpen: false,
    note: 'Behind the ACL. Every reply about it comes from the border router, never from the host itself.',
  },
  conditions: { jitterMs: 2, lossRate: 0, icmpGenerationMs: 0.4 },
};

/** And finally, an address with nothing on it. */
export const DEAD_HOST: DiagnosticPath = {
  id: 'dead-host',
  title: 'Nothing at that address',
  summary:
    'The one path where the host really is gone. The last router on the way can reach the subnet but gets no answer to its ARP, so it replies for the host: Destination Unreachable, code 1. Down, on a network that is otherwise fine, is not silence -- it is a different machine telling you it could not deliver.',
  teaches: [
    'What genuinely unreachable looks like on the wire',
    'ICMP type 3 code 1 comes from the router, not the host',
    'Distinguishing "no answer" from "an answer saying no"',
  ],
  source: LAPTOP,
  hops: [
    HOME_ROUTER,
    ISP_ACCESS,
    ISP_POP,
    {
      id: 'branch-router',
      label: 'Branch office router',
      address: '203.0.113.129',
      linkMs: 7,
      medium: 'fiber',
      respondsToTtl: true,
      note: 'Directly attached to the subnet the address belongs to, which is why it -- and only it -- can tell you the address is empty.',
    },
  ],
  destination: {
    id: 'absent-host',
    label: 'retired.example (absent)',
    hostname: 'retired.example',
    address: '203.0.113.150',
    linkMs: 0.4,
    medium: 'ethernet',
    icmp: 'host-down',
    replyTtl: 64,
    tcpOpen: false,
    note: 'Decommissioned last month. The DNS record outlived the machine, which is how most of these are found.',
  },
  conditions: { jitterMs: 2, lossRate: 0, icmpGenerationMs: 0.4 },
};

/** Every path, in the order the picker offers them: baseline first, hardest last. */
export const DIAGNOSTIC_PATHS: readonly DiagnosticPath[] = [
  LOCAL_CDN,
  FLAKY_WIFI,
  LONG_HAUL,
  FILTERED_HOST,
  PROHIBITED_HOST,
  DEAD_HOST,
];

/** The path a tool opens on. */
export const DEFAULT_PATH_ID = LOCAL_CDN.id;

/** Look one up by id. */
export function getPath(id: string): DiagnosticPath | undefined {
  return DIAGNOSTIC_PATHS.find((path) => path.id === id);
}
