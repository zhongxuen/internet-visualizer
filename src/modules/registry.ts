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

/**
 * The fourteen "Learning Topics" the project spec names, verbatim and in its order.
 *
 * The spec itself (`md-files/internet-visualizer.md`) is git-ignored and local-only, so
 * a test cannot read it. This array is the committed copy of that list, and it lives
 * beside `ModuleMeta.topics` because these are the same strings: a module's `topics`
 * and a lesson's `topics` are both drawn from here, which is what lets the Learning
 * Center's coverage test say "every topic the spec asks for is taught somewhere".
 *
 * Two things it is deliberately not:
 *
 *  - It is **not** the union of every `topics` array below. Modules legitimately name
 *    finer-grained subjects the spec never listed -- `Routing`, `Caching`,
 *    `Certificates`, `Traceroute` -- and the curriculum is free to use those too.
 *  - It is **not** a superset either: `Reverse Proxy` is in the spec and in no module's
 *    `topics`, because the concept is taught by the Network Map's datacenter topology
 *    rather than by a module of its own.
 *
 * Edit this only when the spec's list itself changes.
 */
export const SPEC_LEARNING_TOPICS: readonly string[] = [
  'DNS',
  'HTTP',
  'HTTPS',
  'TCP/IP',
  'UDP',
  'SSL/TLS',
  'CDN',
  'Load Balancers',
  'Reverse Proxy',
  'APIs',
  'WebSockets',
  'Cookies',
  'Sessions',
  'Authentication',
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
    summary:
      'Explore how a network is built up, from one house to a datacenter, machine by machine.',
    status: 'ready',
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
    status: 'ready',
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
    status: 'ready',
    topics: ['DNS', 'UDP', 'Caching'],
    usesRealNetwork: false,
  },
  {
    id: 'http-explorer',
    group: 'explore',
    title: 'HTTP Explorer',
    route: '/http-explorer',
    summary: 'Inspect the full request and response lifecycle, header by header.',
    status: 'ready',
    topics: ['HTTP', 'Cookies', 'Sessions', 'Caching'],
    usesRealNetwork: false,
  },
  {
    id: 'https-explorer',
    group: 'explore',
    title: 'HTTPS Explorer',
    route: '/https-explorer',
    summary: 'See the TLS handshake negotiate keys and verify a certificate chain.',
    status: 'ready',
    topics: ['HTTPS', 'SSL/TLS', 'Certificates'],
    usesRealNetwork: false,
  },
  {
    id: 'api-visualizer',
    group: 'explore',
    title: 'API Visualizer',
    route: '/api-visualizer',
    summary: 'Animate REST calls, status codes, auth headers, and error handling.',
    status: 'ready',
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
    status: 'ready',
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
    status: 'ready',
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
    // Both halves shipped in phase 12: Learn mode's four simulated tools, and Live
    // mode's three read-only lookups behind the acknowledgement gate.
    status: 'ready',
    topics: ['ICMP', 'DNS', 'Traceroute', 'WHOIS/RDAP'],
    // The one module this may ever be true for, and it is true now: Live mode reaches a
    // real network through the Route Handlers under src/app/api/diagnostics. It is a
    // statement about capability -- the badge that tracks what the module is doing right
    // now lives in the mode switch inside the module. `tests/registry.test.ts` asserts
    // that no other entry sets this.
    usesRealNetwork: true,
  },
  {
    id: 'learning-center',
    group: 'learn',
    title: 'Learning Center',
    // `/learn`, not `/learning-center`: this is the only module whose routes are a
    // small site rather than one page -- an index, a glossary, and a lesson per track
    // entry -- and every one of those URLs is read by a person and typed into a link
    // in a lesson. It is also the one module that does not wear `ModuleChrome`: a
    // lesson's `h1` is the lesson, so its routes live at `app/learn/` outside the
    // `(modules)` group. Everything else about the entry is unchanged, and
    // `getModuleByRoute` still resolves the whole subtree to this module.
    route: '/learn',
    summary:
      'Guided lessons that reuse the same scenarios the modules run, so content never drifts.',
    // Phase 13 shipped the framework (13.1), EmbeddedSim (13.2), and the seven tracks
    // with thirty-three lessons between them (13.3). Every topic in
    // SPEC_LEARNING_TOPICS is taught by at least one of them, asserted in
    // `learning-center/content/coverage.test.ts`.
    status: 'ready',
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
