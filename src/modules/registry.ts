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

import type { Level } from '@/core/types/story';

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
 * The beginner's chapters, which replace groups in the navigation and on the home page
 * (docs/implementation/uiux.md §5.5). A chapter is named by the question a newcomer
 * would ask, not by what kind of code a module is.
 *
 * `group` and `MODULE_GROUPS` stay beside these until the navigation moves over.
 */
export type ModuleChapter = 'basics' | 'websites' | 'apps' | 'tools' | 'learn';

export interface ModuleChapterMeta {
  key: ModuleChapter;
  label: string;
  /** The chapter's question, as the home page and the Explore menu ask it. */
  question: string;
  /**
   * Registry ids in reading order, which is not registry order: a beginner opens a
   * website end to end before taking it apart, so the Internet Simulator leads its
   * chapter. `tests/registry.test.ts` asserts this lists exactly the modules whose
   * `chapter` is `key`, so the two can never disagree.
   */
  moduleIds: readonly string[];
}

/** Chapter order, §5.5. */
export const MODULE_CHAPTERS: readonly ModuleChapterMeta[] = [
  {
    key: 'basics',
    label: 'How data travels',
    question: 'How does data get from one place to another?',
    moduleIds: ['network-map', 'packet-journey'],
  },
  {
    key: 'websites',
    label: 'Opening a website',
    question: 'What happens when I open a website?',
    moduleIds: ['internet-simulator', 'dns-explorer', 'http-explorer', 'https-explorer'],
  },
  {
    key: 'apps',
    label: 'Apps and servers',
    question: 'How do apps talk to servers?',
    moduleIds: ['api-visualizer', 'websocket-viewer'],
  },
  {
    key: 'tools',
    label: 'Real tools',
    question: 'How do people check a network?',
    moduleIds: ['network-diagnostics'],
  },
  {
    key: 'learn',
    label: 'Lessons',
    question: 'Where do I start?',
    moduleIds: ['learning-center'],
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
  /**
   * The question this module answers, ending in '?'. This and `plainSummary` are the
   * plain voice (docs/implementation/uiux.md §5.1); `title` and `summary` stay the
   * technical one.
   */
  question: string;
  /** At most 30 words, for someone who has never heard of the protocol. */
  plainSummary: string;
  level: Level;
  /** Which chapter it is listed under. See MODULE_CHAPTERS. */
  chapter: ModuleChapter;
  /** Roughly how long a first visit takes. Absent for the Learning Center, whose lessons carry their own. */
  minutes?: number;
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
    question: 'What is a network made of?',
    plainSummary:
      "See what's inside a network (laptops, phones, routers and cables) from one home to a whole data centre, and what each one does.",
    level: 'beginner',
    chapter: 'basics',
    minutes: 8,
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
    question: 'How does a message travel across the internet?',
    plainSummary:
      "Follow one small piece of data from your laptop, through your router and your internet provider, to a website's server and back.",
    level: 'beginner',
    chapter: 'basics',
    minutes: 10,
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
    question: "How does your computer find a website's address?",
    plainSummary:
      'Websites have names, but computers need numbers. Watch your computer ask a chain of servers until one knows the number.',
    level: 'beginner',
    chapter: 'websites',
    minutes: 8,
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
    question: 'What does your browser actually say to a website?',
    plainSummary:
      'Read the real messages your browser and a website send each other: the request, the reply, and the notes attached to both.',
    level: 'intermediate',
    chapter: 'websites',
    minutes: 10,
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
    question: 'How does the padlock keep what you send private?',
    plainSummary:
      "Watch your browser and a website agree on a secret, check the site's ID, and see what a snooper can and can't read.",
    level: 'intermediate',
    chapter: 'websites',
    minutes: 10,
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
    question: 'How do apps ask servers for data?',
    plainSummary:
      'Watch an app ask a server for data, prove who it is, and handle the answers, including the ones that say no.',
    level: 'intermediate',
    chapter: 'apps',
    minutes: 10,
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
    question: 'How do chat apps get new messages instantly?',
    plainSummary:
      'See how a chat app keeps a line open to the server, so a message arrives the moment it is sent.',
    level: 'advanced',
    chapter: 'apps',
    minutes: 8,
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
    question: 'What happens when you type a web address and press Enter?',
    plainSummary:
      'Type a web address and watch every step your browser takes: finding the site, connecting, locking the line, and drawing the page.',
    level: 'beginner',
    chapter: 'websites',
    minutes: 10,
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
    question: 'How do people check whether a website is reachable?',
    plainSummary:
      'Learn the tools people use to test a connection: ping, traceroute, DNS lookup and WHOIS. Simulated unless you switch on Live mode.',
    level: 'intermediate',
    chapter: 'tools',
    minutes: 8,
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
    question: 'Where do I start?',
    plainSummary:
      'Short lessons that explain one idea at a time, each with a simulation you can play.',
    level: 'beginner',
    chapter: 'learn',
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

/** Look up a chapter by its key. */
export function getChapter(key: ModuleChapter): ModuleChapterMeta | undefined {
  return MODULE_CHAPTERS.find((c) => c.key === key);
}

/** Modules in one chapter, in the chapter's reading order (see `moduleIds`). */
export function modulesInChapter(key: ModuleChapter): ModuleMeta[] {
  return (getChapter(key)?.moduleIds ?? []).flatMap((id) => getModule(id) ?? []);
}

/** Modules that are actually shippable today. */
export function readyModules(): ModuleMeta[] {
  return MODULES.filter((m) => m.status === 'ready');
}
