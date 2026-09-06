/**
 * The stage contract -- what every stage of a page load agrees to, and nothing else.
 *
 * The Internet Simulator does not know how DNS resolves a name, how TCP counts sequence
 * numbers, how TLS derives a key, or how a cache decides a response is stale. All of
 * that is in `@/core/protocols`, was written for the modules that came before this one,
 * and is imported here unchanged. What this module contributes is *composition*: eight
 * stages, run in order, each handed the state the previous ones produced, each emitting
 * its events in its own local virtual time, and a pipeline that shifts them onto one
 * shared timeline.
 *
 * That is why the contract below is so small. A stage is a pure function from
 * {@link StageContext} to {@link StageOutput}. It may not read a clock, may not know its
 * own offset on the timeline, and may not reach into a later stage. Everything it wants
 * to say about time it says relative to its own start, and the pipeline does the
 * arithmetic. The property that falls out is the one the phase doc asks for: the stage
 * rail's proportions are the stages' real virtual durations, because there is nowhere
 * else for a duration to come from.
 *
 * ## Local time, and why it is not a detail
 *
 * A stage that knew its absolute start would have to be re-run to be re-placed, and the
 * network-profile control re-places every stage on every change. Keeping stages local
 * means the pipeline can compose, skip, or truncate them without any stage being aware
 * of it -- a fresh browser-cache hit skips five stages, and none of the five had to be
 * written to know that could happen.
 *
 * Specified in docs/implementation/11-module-internet-simulator.md.
 */

import type { SimEvent, RfcRef } from '@/core/types/events';
import type { PDU } from '@/core/types/pdu';
import type { Topology } from '@/core/types/topology';
import type { Rng } from '@/core/sim/rng';
import type { HttpClock } from '@/core/protocols/http/message';
import type { CertificateChain, TrustStore } from '@/core/protocols/tls/certificates';
import type { HttpCache } from '@/core/protocols/http/caching';

import type { CacheCheck } from './stages/cache-check';
import type { CdnResult } from './stages/cdn-stage';
import type { DnsResult } from './stages/dns-stage';
import type { HttpResult } from './stages/http-stage';
import type { RenderResult } from './stages/render-stage';
import type { TcpResult } from './stages/tcp-stage';
import type { TlsResult } from './stages/tls-stage';
import type { ParsedUrl } from './stages/url-parse';
import type { PageModel } from './page';

// ---------------------------------------------------------------------------
// The eight stages
// ---------------------------------------------------------------------------

/**
 * The stages of a page load, in the order the browser performs them.
 *
 * These ids are the stable vocabulary of the whole module: they key the rail, they tag
 * every event, they name the deep link into each stage's dedicated module, and they are
 * what a URL fragment would carry. They do not change.
 */
export type StageId =
  'url-parse' | 'cache-check' | 'dns' | 'tcp' | 'tls' | 'http' | 'cdn' | 'render';

/** Every stage id, in pipeline order. */
export const STAGE_IDS: readonly StageId[] = [
  'url-parse',
  'cache-check',
  'dns',
  'tcp',
  'tls',
  'http',
  'cdn',
  'render',
];

/** What each stage is called on the rail. */
export const STAGE_TITLES: Readonly<Record<StageId, string>> = {
  'url-parse': 'URL',
  'cache-check': 'Cache',
  dns: 'DNS',
  tcp: 'TCP',
  tls: 'TLS',
  http: 'HTTP',
  cdn: 'CDN',
  render: 'Render',
};

/**
 * The module a learner is sent to when they want the long version of a stage.
 *
 * The handoff the phase doc calls "what turns a demo into a learning path". `undefined`
 * where no dedicated module exists: URL parsing and rendering are browser behaviour
 * rather than protocols, and the CDN's own logic is HTTP caching, which is why it points
 * at the HTTP Explorer rather than at a module of its own.
 */
export const STAGE_MODULE_ROUTES: Readonly<Record<StageId, string | undefined>> = {
  'url-parse': undefined,
  'cache-check': '/http-explorer',
  dns: '/dns-explorer',
  tcp: '/packet-journey',
  tls: '/https-explorer',
  http: '/http-explorer',
  cdn: '/http-explorer',
  render: undefined,
};

// ---------------------------------------------------------------------------
// The topology
// ---------------------------------------------------------------------------

/**
 * The machines a page load can touch.
 *
 * Deliberately few. The DNS Explorer draws every rung of the resolution ladder and the
 * Packet Journey draws every router between two hosts; this module draws the *shape of a
 * page load*, and a diagram with twenty nodes on it would hide that shape rather than
 * show it. Nodes appear only when a run actually speaks to them, so a warm-cache run has
 * no root server on its diagram and needs no caption explaining why.
 */
export const BROWSER_NODE = 'browser';
/** The recursive resolver the client is configured to ask. */
export const RESOLVER_NODE = 'resolver';
/** A root server, present only when the resolution had to start at the top. */
export const DNS_ROOT_NODE = 'dns-root';
/** A TLD server (`.com`), present only when the resolution reached one. */
export const DNS_TLD_NODE = 'dns-tld';
/** The zone's authoritative server. */
export const DNS_AUTH_NODE = 'dns-authoritative';
/** The CDN point of presence, present only in scenarios that put one in front. */
export const EDGE_NODE = 'edge';
/** The origin server -- the machine that actually holds the page. */
export const ORIGIN_NODE = 'origin';

/** `SimLink.id` for a hop between two nodes, both directions sharing one link. */
export function linkId(from: string, to: string): string {
  return `${from}-${to}`;
}

// ---------------------------------------------------------------------------
// Network profiles
// ---------------------------------------------------------------------------

/** The five presets from the phase doc. */
export type NetworkProfileId = 'fiber' | 'cable' | '4g' | '3g' | 'satellite';

/** A link a page load is fetched across. */
export interface NetworkProfile {
  readonly id: NetworkProfileId;
  readonly label: string;
  /** Round-trip time to the first hop, virtual milliseconds. */
  readonly rttMs: number;
  /**
   * Bottleneck capacity in kilobits per second -- which is also **bits per
   * millisecond**, so every serialization figure in this module is a plain
   * `bytes * 8 / bandwidthKbps`.
   */
  readonly bandwidthKbps: number;
  /** Per-segment loss probability, compounded over a transfer by `core/http/versions`. */
  readonly lossRate: number;
  /** One line for the control: what this link is, and what it costs. */
  readonly note: string;
}

/**
 * The five links, ordered fastest first.
 *
 * The numbers are chosen so the lesson is legible rather than so they are averages. Note
 * that satellite has more bandwidth than 3G and is far slower to load a page: bandwidth
 * moves bytes, and a page load is mostly round trips. That single comparison is the
 * argument for TLS 1.3, 0-RTT, HTTP/3, and connection reuse all at once.
 */
export const NETWORK_PROFILES: readonly NetworkProfile[] = [
  {
    id: 'fiber',
    label: 'Fiber',
    rttMs: 5,
    bandwidthKbps: 200_000,
    lossRate: 0,
    note: 'A 5 ms round trip. Handshakes are almost free, so the transfer sizes dominate.',
  },
  {
    id: 'cable',
    label: 'Cable',
    rttMs: 25,
    bandwidthKbps: 50_000,
    lossRate: 0,
    note: 'A typical wired home connection: 25 ms out and back, and plenty of capacity.',
  },
  {
    id: '4g',
    label: '4G',
    rttMs: 60,
    bandwidthKbps: 20_000,
    lossRate: 0,
    note: 'Mobile, with the radio adding latency the wire does not have.',
  },
  {
    id: '3g',
    label: '3G',
    rttMs: 200,
    bandwidthKbps: 1_600,
    lossRate: 0.01,
    note: 'Slow and lossy. Every avoidable round trip now costs a fifth of a second.',
  },
  {
    id: 'satellite',
    label: 'Satellite',
    rttMs: 600,
    bandwidthKbps: 12_000,
    lossRate: 0.002,
    note: 'Geostationary: 600 ms of physics, and no amount of bandwidth buys it back.',
  },
];

/** The profile a scenario runs on unless it says otherwise. */
export const DEFAULT_PROFILE_ID: NetworkProfileId = 'cable';

/** Look a profile up by id, falling back to {@link DEFAULT_PROFILE_ID}. */
export function networkProfile(id: NetworkProfileId): NetworkProfile {
  return (
    NETWORK_PROFILES.find((profile) => profile.id === id) ??
    NETWORK_PROFILES.find((profile) => profile.id === DEFAULT_PROFILE_ID)!
  );
}

/**
 * Virtual milliseconds to clock `bytes` onto a link.
 *
 * Serialization delay, kept separate from propagation delay everywhere in this module,
 * because they behave differently: propagation is what a round trip costs and does not
 * care how big the message is, serialization is what size costs and does not care how
 * far away the far end is. Conflating them is why "just add more bandwidth" is such a
 * durable misconception.
 */
export function serializeMs(bytes: number, profile: NetworkProfile): number {
  return round2((bytes * 8) / profile.bandwidthKbps);
}

/** Two decimal places: fine enough for a timeline, coarse enough to read. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// The wall clock
// ---------------------------------------------------------------------------

/**
 * The instant virtual time zero corresponds to.
 *
 * HTTP dates, certificate validity windows, and cache ages are absolute facts about the
 * world; a page load's timeline starts at zero. This constant is the bridge, and it is a
 * literal rather than a reading of the machine's clock, so every run replays identically.
 * `Date.UTC` here computes a fixed number from fixed arguments -- it does not ask what
 * time it is.
 */
export const PAGE_LOAD_EPOCH = Date.UTC(2026, 2, 1, 12, 0, 0);

/** The clock every cache calculation and `Date` header in this module is stamped from. */
export const SIM_CLOCK: HttpClock = { origin: PAGE_LOAD_EPOCH };

// ---------------------------------------------------------------------------
// What a scenario declares
// ---------------------------------------------------------------------------

/** What a subresource is for, which is what decides when it blocks. */
export type ResourceKind = 'stylesheet' | 'script' | 'image' | 'font' | 'fetch';

/** One thing the document asks for once it has been parsed. */
export interface SubresourceSpec {
  readonly id: string;
  /** What to call it on the waterfall, e.g. `app.css`. */
  readonly label: string;
  /** Origin-form request-target, e.g. `/assets/app.css`. */
  readonly target: string;
  readonly kind: ResourceKind;
  /** Response body size in bytes. */
  readonly bytes: number;
  /**
   * Whether first paint has to wait for this.
   *
   * True for a stylesheet in `<head>` and for a classic synchronous script above it.
   * This is the most common real-world performance lesson there is, so a scenario that
   * wants to teach it simply sets the flag and the render stage does the rest.
   */
  readonly renderBlocking?: boolean;
  /** The element that ends up being the largest contentful paint. At most one per page. */
  readonly lcpCandidate?: boolean;
  /** How long the server spends producing the first byte of it. */
  readonly serverThinkMs?: number;
  /** A `Cache-Control` value, so a repeat visit can find it already stored. */
  readonly cacheControl?: string;
  /** An entity tag, so a stale copy can be revalidated rather than re-downloaded. */
  readonly etag?: string;
}

/** The document itself: what the origin serves for the URL that was typed. */
export interface DocumentSpec {
  readonly status?: number;
  /** Response body size in bytes. The `body` string below is an excerpt, not the bytes. */
  readonly bytes: number;
  /** A short excerpt for the wire view; this module models payload *lengths*. */
  readonly excerpt: string;
  readonly cacheControl?: string;
  readonly etag?: string;
  readonly lastModifiedAgoSeconds?: number;
  readonly contentType?: string;
  /** How long the origin spends producing the first byte. */
  readonly serverThinkMs?: number;
}

/** The origin server a scenario runs against. */
export interface OriginSpec {
  /** Documentation-range address (RFC 5737); nothing here is ever contacted. */
  readonly address: string;
  readonly label?: string;
  readonly document: DocumentSpec;
  readonly subresources?: readonly SubresourceSpec[];
}

/** A CDN point of presence in front of the origin. */
export interface CdnSpec {
  readonly address: string;
  readonly label?: string;
  /** Round-trip time from the edge back to the origin. The edge is near, the origin is not. */
  readonly originRttMs: number;
  /** How long the edge spends deciding, on a hit. */
  readonly lookupMs?: number;
  /** Seed the edge's shared cache with the document, as a previous visitor would have. */
  readonly warm?: EdgeWarmth;
}

/** What the shared cache at the edge already holds when this run starts. */
export interface EdgeWarmth {
  /** How long ago the edge stored it, in seconds. Drives the `Age` field it will send. */
  readonly storedSecondsAgo: number;
}

/** One entry already in the browser's private cache when the run starts. */
export interface StoredResourceSpec {
  /** Origin-form target, matching either the document or one of the subresources. */
  readonly target: string;
  /** How long ago this was stored, in seconds. */
  readonly storedSecondsAgo: number;
}

/** Whether a service worker is in the picture, and what it does with the fetch. */
export interface ServiceWorkerSpec {
  readonly scriptTarget: string;
  /**
   * `cache-first` answers from its own cache and never touches the network;
   * `network-first` passes the request through and only falls back on failure.
   */
  readonly strategy: 'cache-first' | 'network-first';
  /** Whether its cache actually holds this document. */
  readonly holdsDocument: boolean;
}

/** A teaching note pinned to a phase id, folded in once the boundaries are known. */
export interface ScenarioNote {
  readonly phase: string;
  /** Node, link, or PDU id it explains. Defaults to the browser. */
  readonly target?: string;
  readonly text: string;
  readonly reference?: RfcRef;
}

/** How this run's TLS is set up, when the URL is `https`. */
export interface TlsSpec {
  readonly version?: '1.2' | '1.3';
  /** Leaf first, then intermediates. Never the root. */
  readonly chain: CertificateChain;
  readonly store: TrustStore;
  /** Epoch ms the chain is judged at. Defaults to {@link PAGE_LOAD_EPOCH}. */
  readonly validationAt?: number;
  /** Resume from a ticket kept from a previous visit -- no certificate, one flight less. */
  readonly resume?: boolean;
  /** Send the request as 0-RTT early data. Requires `resume`. */
  readonly earlyData?: boolean;
  /** Application protocol negotiated in ALPN. Defaults to `h2`. */
  readonly alpn?: 'h2' | 'http/1.1' | 'h3';
}

/** How this run's DNS is set up. */
export interface DnsSpec {
  /**
   * Ask the same name once before the run starts, so the resolver already knows it.
   *
   * A warm cache is modelled as a previous question rather than as pre-seeded entries,
   * for the same reason the DNS Explorer does it: entries nobody watched arrive are a
   * claim, and a previous lookup is that claim demonstrated.
   */
  readonly warm?: boolean;
  /** Validate the chain of trust, which costs extra queries. */
  readonly dnssec?: boolean;
  /** Servers that will not answer, by name or address. */
  readonly unresponsive?: readonly string[];
}

/** How this run's TCP is set up. */
export interface TcpSpec {
  /** The server never answers the SYN: the connection-timeout scenario. */
  readonly blackholed?: boolean;
  /** How many times the SYN is retransmitted before the browser gives up. */
  readonly synRetries?: number;
  /** The first retransmission timeout, doubled on each retry (RFC 6298 s5). */
  readonly initialRtoMs?: number;
}

/** One authored end-to-end page load. */
export interface SimulatorScenario {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  /** The sentences this run exists to make land. */
  readonly teaches: readonly string[];
  /** The URL as a user would type it. */
  readonly url: string;
  /** The link this run is authored for; the profile control overrides it. */
  readonly profileId?: NetworkProfileId;
  /** Everything random in the run is drawn from this. */
  readonly seed?: string;
  readonly origin: OriginSpec;
  readonly cdn?: CdnSpec;
  readonly tls?: TlsSpec;
  readonly dns?: DnsSpec;
  readonly tcp?: TcpSpec;
  /** The host is on the HSTS preload list, so `http://` never leaves the browser. */
  readonly hstsPreloaded?: boolean;
  readonly serviceWorker?: ServiceWorkerSpec;
  /** What the browser's private cache already holds. */
  readonly stored?: readonly StoredResourceSpec[];
  readonly notes?: readonly ScenarioNote[];
}

// ---------------------------------------------------------------------------
// The stage contract
// ---------------------------------------------------------------------------

/**
 * Everything the stages before this one produced.
 *
 * Optional throughout, because a stage that did not run leaves nothing behind: a fresh
 * cache hit means `dns` through `cdn` are all absent, and the render stage has to cope
 * with that rather than assume a network fetch happened. Every stage that needs an
 * earlier one guards for it and says so -- see {@link requireState}.
 */
export interface PipelineState {
  /** What is being loaded. Built once, before any stage runs, so every stage agrees. */
  readonly page?: PageModel;
  readonly url?: ParsedUrl;
  readonly cache?: CacheCheck;
  readonly dns?: DnsResult;
  readonly tcp?: TcpResult;
  readonly tls?: TlsResult;
  readonly http?: HttpResult;
  readonly cdn?: CdnResult;
  readonly render?: RenderResult;
  /** The browser's private cache as it stands right now; stages hand it forward. */
  readonly browserCache?: HttpCache;
}

/** What a stage is given. */
export interface StageContext {
  readonly stage: StageId;
  readonly scenario: SimulatorScenario;
  readonly profile: NetworkProfile;
  readonly clock: HttpClock;
  /** Built once, up front, from what the scenario declares. */
  readonly topology: Topology;
  /** Seeded from the scenario; a stage draws from it rather than from `Math.random`. */
  readonly rng: Rng;
  readonly state: PipelineState;
}

/**
 * The browser's own ending -- what a user sees instead of a page.
 *
 * Every failure scenario ends in one of these, and every one of them is an error string
 * users have seen. Connecting `DNS_PROBE_FINISHED_NXDOMAIN` to the stage that produced it
 * is the whole point of showing it.
 */
export interface BrowserFailure {
  /** The stage that could not continue. */
  readonly stage: StageId;
  /** The browser's own code, e.g. `DNS_PROBE_FINISHED_NXDOMAIN`. */
  readonly code: string;
  /** The heading on the error page, e.g. `This site can't be reached`. */
  readonly title: string;
  /** What a browser tells the user. */
  readonly message: string;
  /** What actually failed, in protocol terms, and where. */
  readonly explanation: string;
  readonly reference?: RfcRef;
}

/** What a stage hands back. */
export interface StageOutput {
  /**
   * Events timed from this stage's own start.
   *
   * The pipeline shifts every `at` by the accumulated offset. A `transmit` keeps its
   * `durationMs` untouched, which means a packet may still be in flight when the next
   * stage begins -- that is not a bookkeeping error, it is what pipelining looks like.
   */
  readonly events: readonly SimEvent[];
  /** PDUs this stage created, keyed by id. Ids are prefixed with the stage id. */
  readonly pdus?: Readonly<Record<string, PDU>>;
  /** How much virtual time this stage takes before the next one may begin. */
  readonly durationMs: number;
  /** One line for the rail: what happened here. */
  readonly summary: string;
  /** Merged into {@link PipelineState} for the stages that follow. */
  readonly state?: PipelineState;
  /** Set when this stage did nothing at all, and why. Implies `durationMs` of 0. */
  readonly skipped?: string;
  /** Set when the run ends here. Later stages are not called. */
  readonly failure?: Omit<BrowserFailure, 'stage'>;
  /** Stages this one has established will not need to run, and why. */
  readonly skipAhead?: Readonly<Partial<Record<StageId, string>>>;
}

/** A stage: a pure function of its context. */
export type Stage = (context: StageContext) => StageOutput;

/**
 * Read a required piece of earlier state, or fail loudly.
 *
 * Reaching for state a previous stage did not produce is a pipeline bug, not a runtime
 * condition -- the pipeline stops at the first failure precisely so this cannot happen --
 * so this throws with the stage named rather than returning `undefined` for a caller to
 * mishandle silently.
 */
export function requireState<K extends keyof PipelineState>(
  state: PipelineState,
  key: K,
  stage: StageId,
): NonNullable<PipelineState[K]> {
  const value = state[key];
  if (value === undefined) {
    throw new Error(
      `the ${stage} stage needs "${key}" from an earlier stage, which did not run`,
    );
  }
  return value as NonNullable<PipelineState[K]>;
}

/** Move one event forward on the timeline. `durationMs` is a length, so it does not move. */
export function shiftEvent(event: SimEvent, offsetMs: number): SimEvent {
  return { ...event, at: round2(event.at + offsetMs) };
}
