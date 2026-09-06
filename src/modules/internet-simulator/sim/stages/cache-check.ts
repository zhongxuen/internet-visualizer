/**
 * Stage 2 -- the three things a browser asks before it will touch the network.
 *
 * People think of a page load as beginning with DNS. It does not. Three local checks come
 * first, each of which can change or cancel everything after it, and each of which is
 * invisible in a network waterfall precisely because it *avoided* the network:
 *
 * 1. **HSTS.** If the host is on the preload list, an `http://` URL is rewritten to
 *    `https://` inside the browser, before a single packet exists. The redirect that used
 *    to cost a round trip -- and that could be intercepted, which is the whole point --
 *    now costs nothing and cannot be seen.
 * 2. **The service worker.** A registered worker gets a `fetch` event and may answer it
 *    from its own storage. A cache-first worker is why a well-built site opens instantly
 *    with the network switched off.
 * 3. **The private cache.** `@/core/protocols/http/caching` decides whether a stored copy
 *    may be reused, and the answer is not binary: fresh means send nothing at all, stale
 *    means send a *conditional* request that may come back as a bodiless 304.
 *
 * The distinction between those last two outcomes is the entire repeat-visit lesson. A
 * fresh hit skips DNS, TCP, TLS, HTTP, and the CDN. A stale entry skips none of them and
 * still saves the body, which is usually most of the bytes.
 *
 * All three verdicts come from core. This stage decides only the *order* they are asked
 * in -- which is browser behaviour, not protocol -- and what to say about each answer.
 */

import {
  cacheControlOf,
  conditionalHeaders,
  createCache,
  isShared,
  lookupCache,
  serveFromCache,
  type CacheLookup,
  type HttpCache,
} from '@/core/protocols/http/caching';
import type {
  HeaderList,
  HttpRequest,
  HttpResponse,
} from '@/core/protocols/http/message';
import type { RfcRef, SimEvent } from '@/core/types/events';

import { MEMORY_CACHE_MS, requestFor, resourceFor } from '../page';
import {
  BROWSER_NODE,
  requireState,
  round2,
  type Stage,
  type StageId,
  type StageOutput,
} from '../stage';

/** How long looking in a local index takes. A memory lookup, and nothing else. */
export const CACHE_LOOKUP_MS = MEMORY_CACHE_MS;

/** How long a dormant service worker takes to start before it can answer. */
export const SERVICE_WORKER_STARTUP_MS = 12;

const RFC_6797: RfcRef = {
  rfc: 6797,
  section: '8.3',
  title: 'HTTP Strict Transport Security (HSTS)',
};
const RFC_9111_REUSE: RfcRef = {
  rfc: 9111,
  section: '4',
  title: 'HTTP Caching',
};

/** What the browser decided before it opened a socket. */
export type CacheOutcome =
  /** A fresh stored copy. Nothing crosses the wire at all. */
  | 'fresh'
  /** A stored copy that has to be checked: the request goes out with validators. */
  | 'revalidate'
  /** Nothing stored. The full request goes out. */
  | 'miss'
  /** A service worker answered from its own storage. */
  | 'service-worker'
  /** The cache is not allowed to take part in this exchange. */
  | 'bypass';

/** Everything the pre-flight checks established. */
export interface CacheCheck {
  readonly outcome: CacheOutcome;
  /** True when the URL was rewritten from `http` to `https` locally. */
  readonly hstsUpgraded: boolean;
  /** True when a service worker was consulted at all. */
  readonly serviceWorkerRan: boolean;
  /** The core cache verdict, kept whole so a panel can show its reasoning. */
  readonly lookup: CacheLookup;
  /** The request as it will now go out -- with validators attached, when revalidating. */
  readonly request: HttpRequest;
  /** The validators added, so the UI can point at them. Empty unless revalidating. */
  readonly validators: HeaderList;
  /** What the user is shown, when nothing has to be fetched. */
  readonly served?: HttpResponse;
  /** True when no packet will be sent for the document. */
  readonly skipsNetwork: boolean;
  readonly browserCache: HttpCache;
  /** One sentence naming the reason, for the badge. */
  readonly reason: string;
}

/** The stages a fresh hit makes unnecessary, with the sentence explaining each. */
const SKIPPED_BY_A_HIT: Readonly<Partial<Record<StageId, string>>> = {
  dns: 'No name had to be resolved: the answer was already on this machine.',
  tcp: 'No connection was opened. There was nothing to connect to.',
  tls: 'No handshake, no certificate, no key exchange. Nothing was encrypted because nothing was sent.',
  http: 'No request was sent, so there were no request headers and no bytes uploaded.',
  cdn: 'The edge was never asked, and neither was the origin.',
};

/** Run the three local checks, in the order a browser runs them. */
export const cacheCheckStage: Stage = (context): StageOutput => {
  const url = requireState(context.state, 'url', 'cache-check');
  const page = requireState(context.state, 'page', 'cache-check');
  const scenario = context.scenario;

  const events: SimEvent[] = [
    {
      kind: 'phase',
      at: 0,
      id: 'cache-check',
      title: 'Ask the local caches first',
      description:
        'Three checks happen before any packet exists: the HSTS list, the service worker, and the browser’s own cache. Each one can make the rest of the page load unnecessary.',
    },
    { kind: 'node-state', at: 0, nodeId: BROWSER_NODE, state: 'processing' },
  ];

  let clock = 0;

  // --- 1. HSTS ---------------------------------------------------------------
  const hstsUpgraded = scenario.hstsPreloaded === true && url.scheme === 'http';
  if (scenario.hstsPreloaded === true) {
    events.push({
      kind: 'log',
      at: clock,
      level: 'info',
      text: hstsUpgraded
        ? `HSTS preload: ${url.host} is on the list, so http:// became https:// before anything was sent.`
        : `HSTS preload: ${url.host} is on the list. The URL was already https, so there is nothing to upgrade.`,
    });
    if (hstsUpgraded) {
      events.push({
        kind: 'annotate',
        at: clock,
        targetId: BROWSER_NODE,
        text: 'This is an internal 307, not a network redirect. The cleartext request that used to happen here is what an attacker on the path would have intercepted -- which is why the list exists.',
        reference: RFC_6797,
      });
    }
  }

  // --- 2. Service worker -----------------------------------------------------
  const worker = scenario.serviceWorker;
  let served: HttpResponse | undefined;
  let outcome: CacheOutcome | undefined;
  let reason = '';

  if (worker) {
    clock = round2(clock + SERVICE_WORKER_STARTUP_MS);
    events.push({
      kind: 'log',
      at: clock,
      level: 'info',
      text: `Service worker at ${worker.scriptTarget} started (${SERVICE_WORKER_STARTUP_MS} ms) and received the fetch event.`,
    });
    if (worker.strategy === 'cache-first' && worker.holdsDocument) {
      outcome = 'service-worker';
      reason =
        'a cache-first service worker answered from its own storage, so the request never reached the network stack';
      events.push({
        kind: 'annotate',
        at: clock,
        targetId: BROWSER_NODE,
        text: 'A service worker sits in front of the HTTP cache and answers with whatever it likes. This is why a well-built site still opens with the network switched off.',
      });
    } else {
      events.push({
        kind: 'log',
        at: clock,
        level: 'info',
        text:
          worker.strategy === 'network-first'
            ? 'The worker is network-first: it passes the request through and only falls back to storage if the fetch fails.'
            : 'The worker had nothing stored for this URL, so it passed the request through.',
      });
    }
  }

  // --- 3. The private cache --------------------------------------------------
  const version = scenario.tls?.alpn === 'http/1.1' ? 'HTTP/1.1' : 'HTTP/2';
  const documentResource = resourceFor(page, url.target) ?? page.document;
  const baseRequest = requestFor(documentResource, page.host, version);

  const browserCache = context.state.browserCache ?? createCache('browser');

  clock = round2(clock + CACHE_LOOKUP_MS);
  const lookup = lookupCache(browserCache, baseRequest, clock, context.clock);

  let validators: HeaderList = [];
  let request = baseRequest;

  if (outcome === undefined) {
    switch (lookup.kind) {
      case 'hit':
        outcome = 'fresh';
        reason = lookup.reason;
        break;
      case 'stale':
        outcome = 'revalidate';
        reason = lookup.reason;
        break;
      case 'bypass':
        outcome = 'bypass';
        reason = lookup.reason;
        break;
      default:
        outcome = 'miss';
        reason = lookup.reason;
    }
  }

  if (outcome === 'revalidate' && lookup.entry) {
    validators = conditionalHeaders(lookup.entry);
    request = { ...baseRequest, headers: [...baseRequest.headers, ...validators] };
  }

  if (outcome === 'fresh' && lookup.entry) {
    served = serveFromCache(lookup.entry, clock, {
      shared: isShared(browserCache.tier),
      clock: context.clock,
    });
  }
  if (outcome === 'service-worker') {
    // The worker's storage is its own; it is not the HTTP cache and obeys none of its
    // rules, which is exactly why a worker can answer while offline and a cache cannot.
    served = documentResource.response;
  }

  const skipsNetwork = outcome === 'fresh' || outcome === 'service-worker';

  events.push({
    kind: 'log',
    at: clock,
    level: 'info',
    text: `Browser cache: ${lookup.kind.toUpperCase()} -- ${lookup.reason}.`,
  });

  if (outcome === 'revalidate') {
    events.push({
      kind: 'annotate',
      at: clock,
      targetId: BROWSER_NODE,
      text: `Stale is not the same as gone. The stored copy stays, and the request goes out carrying ${validators
        .map((field) => field.name)
        .join(
          ' and ',
        )} -- if nothing has changed the answer is a 304 with no body at all.`,
      reference: RFC_9111_REUSE,
    });
  }

  if (outcome === 'fresh') {
    events.push({
      kind: 'annotate',
      at: clock,
      targetId: BROWSER_NODE,
      text: 'Fresh means the browser is allowed to reuse it without asking anyone. No name is resolved, no socket is opened, nothing is encrypted, and nothing is sent -- the whole rest of this pipeline is skipped.',
      reference: RFC_9111_REUSE,
    });
  }

  const control = cacheControlOf(documentResource.response.headers);
  if (control.noStore) {
    events.push({
      kind: 'log',
      at: clock,
      level: 'warn',
      text: 'The origin marked this response no-store, so nothing about it will be written to disk on the way back either.',
    });
  }

  const check: CacheCheck = {
    outcome,
    hstsUpgraded,
    serviceWorkerRan: worker !== undefined,
    lookup,
    request,
    validators,
    ...(served ? { served } : {}),
    skipsNetwork,
    browserCache,
    reason,
  };

  const summary = skipsNetwork
    ? outcome === 'service-worker'
      ? 'Answered by the service worker'
      : 'Fresh hit -- nothing sent'
    : outcome === 'revalidate'
      ? 'Stale -- will revalidate'
      : outcome === 'bypass'
        ? 'Cache bypassed'
        : 'Nothing stored';

  return {
    events,
    durationMs: clock,
    summary,
    state: { cache: check, browserCache },
    ...(skipsNetwork ? { skipAhead: SKIPPED_BY_A_HIT } : {}),
  };
};
