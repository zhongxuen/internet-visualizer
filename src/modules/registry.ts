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

/**
 * Which section of the navigation a module belongs to. Declared here rather than
 * derived in the nav, so adding a module stays a one-file change and no component
 * ever hardcodes a list of module ids.
 */
export type ModuleGroup = 'explore' | 'tools' | 'learn';

export interface ModuleGroupMeta {
  key: ModuleGroup;
  label: string;
  /** One line describing the group, used as the nav menu's caption. */
  description: string;
}

/** Nav order. Groups render in this order; modules keep their MODULES order within. */
export const MODULE_GROUPS: readonly ModuleGroupMeta[] = [
  {
    key: 'explore',
    label: 'Explore',
    description: 'Simulations that take one protocol apart and animate it.',
  },
  {
    key: 'tools',
    label: 'Tools',
    description:
      'Hands-on network utilities. Simulated unless a live badge says otherwise.',
  },
  {
    key: 'learn',
    label: 'Learn',
    description: 'Guided lessons built on the same scenarios the modules run.',
  },
];

export interface ModuleMeta {
  id: string;
  title: string;
  route: string;
  summary: string;
  status: ModuleStatus;
  /** Navigation section. See MODULE_GROUPS. */
  group: ModuleGroup;
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
    group: 'explore',
    title: 'Network Map',
    route: '/network-map',
    summary: 'Explore a live graph of devices, routers, and the links between them.',
    status: 'planned',
    topics: ['TCP/IP', 'Routing', 'Topology'],
    usesRealNetwork: false,
  },
  {
    id: 'packet-journey',
    group: 'explore',
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
    group: 'explore',
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
    group: 'explore',
    title: 'HTTP Explorer',
    route: '/http-explorer',
    summary: 'Inspect the full request and response lifecycle, header by header.',
    status: 'planned',
    topics: ['HTTP', 'Cookies', 'Sessions', 'Caching'],
    usesRealNetwork: false,
  },
  {
    id: 'https-explorer',
    group: 'explore',
    title: 'HTTPS Explorer',
    route: '/https-explorer',
    summary: 'See the TLS handshake negotiate keys and verify a certificate chain.',
    status: 'planned',
    topics: ['HTTPS', 'SSL/TLS', 'Certificates'],
    usesRealNetwork: false,
  },
  {
    id: 'api-visualizer',
    group: 'explore',
    title: 'API Visualizer',
    route: '/api-visualizer',
    summary: 'Animate REST calls, status codes, auth headers, and error handling.',
    status: 'planned',
    topics: ['APIs', 'HTTP', 'Authentication'],
    usesRealNetwork: false,
  },
  {
    id: 'websocket-viewer',
    group: 'explore',
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
    group: 'explore',
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
    group: 'tools',
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
    group: 'learn',
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

/**
 * Resolve the module owning a pathname, so the shared module chrome can label itself
 * from the URL instead of every module passing its own metadata up to the layout.
 * Matches the module route and anything nested under it, e.g. /dns-explorer/root.
 */
export function getModuleByRoute(pathname: string): ModuleMeta | undefined {
  return MODULES.find((m) => pathname === m.route || pathname.startsWith(m.route + '/'));
}

/** Modules in one nav group, in registry order. */
export function modulesInGroup(group: ModuleGroup): ModuleMeta[] {
  return MODULES.filter((m) => m.group === group);
}

/** Modules that are actually shippable today. */
export function readyModules(): ModuleMeta[] {
  return MODULES.filter((m) => m.status === 'ready');
}
