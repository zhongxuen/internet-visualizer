/**
 * The single manifest of modules.
 *
 * Navigation, the home page, and the Learning Center all read from here. Adding a
 * module means adding a folder under `src/modules/` and one entry below -- nothing
 * else should hardcode a module list.
 *
 * Each phase flips its own entry to 'ready'. Do not mark a module 'ready' before its
 * acceptance criteria in `docs/implementation/` pass.
 */

export type ModuleStatus = 'planned' | 'in-progress' | 'ready';

export interface ModuleMeta {
  id: string;
  title: string;
  route: string;
  summary: string;
  status: ModuleStatus;
  /** Learning topics this module teaches, e.g. ['DNS', 'UDP'] */
  topics: string[];
  /**
   * True only for modules that can touch a real network.
   * Exactly one module (network-diagnostics) may ever set this.
   */
  usesRealNetwork: boolean;
}

export const MODULES: ModuleMeta[] = [
  {
    id: 'network-map',
    title: 'Network Map',
    route: '/network-map',
    summary: 'Explore a live graph of devices, routers, and the links between them.',
    status: 'planned',
    topics: ['TCP/IP', 'Routing', 'Topology'],
    usesRealNetwork: false,
  },
  {
    id: 'packet-journey',
    title: 'Packet Journey',
    route: '/packet-journey',
    summary:
      'Follow a single packet hop by hop, watching headers, TTL, and fragmentation change.',
    status: 'planned',
    topics: ['TCP/IP', 'UDP', 'Routing'],
    usesRealNetwork: false,
  },
  {
    id: 'dns-explorer',
    title: 'DNS Explorer',
    route: '/dns-explorer',
    summary:
      'Walk a domain lookup from stub resolver to root, TLD, and authoritative server.',
    status: 'planned',
    topics: ['DNS', 'UDP', 'Caching'],
    usesRealNetwork: false,
  },
  {
    id: 'http-explorer',
    title: 'HTTP Explorer',
    route: '/http-explorer',
    summary: 'Inspect the full request and response lifecycle, header by header.',
    status: 'planned',
    topics: ['HTTP', 'Cookies', 'Sessions', 'Caching'],
    usesRealNetwork: false,
  },
  {
    id: 'https-explorer',
    title: 'HTTPS Explorer',
    route: '/https-explorer',
    summary: 'See the TLS handshake negotiate keys and verify a certificate chain.',
    status: 'planned',
    topics: ['HTTPS', 'SSL/TLS', 'Certificates'],
    usesRealNetwork: false,
  },
  {
    id: 'api-visualizer',
    title: 'API Visualizer',
    route: '/api-visualizer',
    summary: 'Animate REST calls, status codes, auth headers, and error handling.',
    status: 'planned',
    topics: ['APIs', 'HTTP', 'Authentication'],
    usesRealNetwork: false,
  },
  {
    id: 'websocket-viewer',
    title: 'WebSocket Viewer',
    route: '/websocket-viewer',
    summary:
      'Watch an HTTP connection upgrade, then carry persistent bidirectional frames.',
    status: 'planned',
    topics: ['WebSockets', 'HTTP', 'TCP/IP'],
    usesRealNetwork: false,
  },
  {
    id: 'internet-simulator',
    title: 'Internet Simulator',
    route: '/internet-simulator',
    summary:
      'End to end: type a URL and watch DNS, TCP, TLS, and HTTP compose into a page load.',
    status: 'planned',
    topics: ['DNS', 'TCP/IP', 'SSL/TLS', 'HTTP', 'CDN', 'Load Balancers'],
    usesRealNetwork: false,
  },
  {
    id: 'network-diagnostics',
    title: 'Network Diagnostics',
    route: '/network-diagnostics',
    summary:
      'Learn ping, traceroute, DNS lookup, and WHOIS -- simulated by default, with an explicit opt-in live mode.',
    status: 'planned',
    // The only module permitted to reach a real network, and only in Live mode.
    // Flipped to true in phase 12, never before.
    topics: ['ICMP', 'DNS', 'Traceroute', 'WHOIS/RDAP'],
    usesRealNetwork: false,
  },
  {
    id: 'learning-center',
    title: 'Learning Center',
    route: '/learning-center',
    summary:
      'Guided lessons that reuse the same scenarios the modules run, so content never drifts.',
    status: 'planned',
    topics: ['DNS', 'HTTP', 'HTTPS', 'TCP/IP', 'UDP', 'CDN', 'APIs', 'WebSockets'],
    usesRealNetwork: false,
  },
];

/** Look up a module by its registry id. */
export function getModule(id: string): ModuleMeta | undefined {
  return MODULES.find((m) => m.id === id);
}

/** Modules that are actually shippable today. */
export function readyModules(): ModuleMeta[] {
  return MODULES.filter((m) => m.status === 'ready');
}
