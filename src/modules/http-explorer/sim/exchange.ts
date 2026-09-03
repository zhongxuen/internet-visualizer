/**
 * Running an exchange -- turning a declared conversation into something that can be drawn.
 *
 * The other five files in `sim/` each answer one question and answer it as data:
 * `message.ts` says what a request *is*, `semantics.ts` what a method promises,
 * `caching.ts` whether a stored copy may be reused, `cookies.ts` which cookies travel,
 * `versions.ts` when each byte arrives. None of them knows that anything will ever be
 * *shown*. This file is the one-way bridge from all five to the `SimResult` the
 * visualization layer consumes -- one-way on purpose, because the rule the project is
 * arranged around is that networking logic never learns about rendering.
 *
 * So the split is:
 *
 * - **`sim/*.ts`** decide what HTTP does.
 * - **this file** decides what a learner sees while it happens: which chapter of the
 *   story they are in, which machine lights up, which note is pinned to it, and which
 *   RFC that note cites.
 * - **the seven scenario files** decide only *what conversation takes place* -- a
 *   screenful of data each, and no logic at all.
 *
 * ## The client this models
 *
 * A browser, not a `curl`. That distinction is the whole content of three of the seven
 * scenarios, because the interesting behaviour is not in the protocol at all -- it is in
 * the policy layered over it:
 *
 * - a **cookie jar** that decides what to attach and, more importantly, what to withhold;
 * - a **private cache** in front of a shared one, each with its own freshness arithmetic;
 * - **CORS**, which is not in the protocol, is not enforced by the server, and blocks a
 *   response the browser has already received in full.
 *
 * Each of those is a place where the bytes on the wire tell you almost nothing about
 * what the page actually got, which is why they are worth animating.
 *
 * ## Where time comes from
 *
 * Every duration is derived, never authored. A leg of the network costs its link's
 * one-way latency plus the time to clock the message onto the wire at the declared
 * bandwidth; a connection costs its handshake from `versions.ts`; a cache hit costs a
 * lookup and no network at all. That last one is the point of the cache panel: a `HIT`
 * is not "faster", it is a hop that does not happen, and the timeline should show a gap
 * where five events would have been.
 *
 * ## Determinism
 *
 * Nothing here reads a clock or draws a random number of its own. The only randomness in
 * the module is packet loss in the version comparison, which comes from the scenario's
 * seed through `versions.ts`. Two runs of one scenario are deep-equal, which
 * `scenarios.test.ts` asserts and which is what makes a run linkable, screenshottable,
 * and describable in a sentence the next reader will recognise.
 *
 * > **Safety:** every origin here is a bundled fixture. There is no code path from a
 * > scenario, or from the request builder in phase 8.3, to a real network.
 */

import { summarizePhases, type SimResult } from '@/core/sim/result';
import type { LogLevel, RfcRef, SimEvent } from '@/core/types/events';
import type { HeaderField, PDU, ProtocolLayer } from '@/core/types/pdu';
import type { SimLink, SimNode, Topology } from '@/core/types/topology';

import {
  applyRevalidation,
  createCache,
  currentAgeSeconds,
  dateHeader,
  describeCache,
  evaluateConditional,
  lookupCache,
  notModifiedResponse,
  revalidationRequest,
  serveFromCache,
  storeResponse,
  type CacheEntryView,
  type CacheOutcome,
  type CacheTier,
  type HttpCache,
} from './caching';
import {
  cookieHeaderValue,
  cookiesFor,
  createJar,
  isPublicSuffix,
  purgeExpired,
  storeSetCookies,
  type Cookie,
  type CookieExclusion,
  type CookieJar,
  type CookieStoreResult,
} from './cookies';
import {
  EPOCH_CLOCK,
  byteLength,
  header,
  headerValue,
  parseTarget,
  request as buildRequest,
  response as buildResponse,
  serializeMessage,
  setHeader,
  withContentLength,
  type HeaderList,
  type HttpClock,
  type HttpMessage,
  type HttpMethod,
  type HttpRequest,
  type HttpResponse,
  type HttpVersion,
  type HttpHeader,
} from './message';
import {
  forbidsContent,
  isRedirect,
  isSafe,
  methodAfterRedirect,
  reasonPhrase,
  redirectTarget,
} from './semantics';
import {
  VERSION_PROFILES,
  compareVersions,
  handshakeCost,
  withDefaults,
  type NetworkConditions,
  type ResourceRequest,
  type VersionComparison,
} from './versions';

// ---------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------

const RFC_9110: RfcRef = { rfc: 9110, title: 'HTTP Semantics' };
const RFC_9111: RfcRef = { rfc: 9111, title: 'HTTP Caching' };
const RFC_9112: RfcRef = { rfc: 9112, title: 'HTTP/1.1' };
const RFC_6265: RfcRef = { rfc: 6265, title: 'HTTP State Management Mechanism' };

/** The redirection status codes, so a redirect note can cite the right section. */
const RFC_9110_REDIRECTS: RfcRef = { ...RFC_9110, section: '15.4' };

/** Where a conditional request's precedence rules live. */
const RFC_9110_CONDITIONALS: RfcRef = { ...RFC_9110, section: '13.2.2' };

/**
 * CORS has no RFC, and saying so is part of teaching it.
 *
 * It is defined by the WHATWG Fetch Standard, which is a living document rather than a
 * numbered one. RFC 9110 defines the *syntax* a field line must have; it says nothing
 * about `Access-Control-Allow-Origin`, and no RFC does. People go looking for the CORS
 * RFC and conclude they have missed something.
 */
const FETCH_STANDARD: RfcRef = {
  rfc: 9110,
  section: '5',
  title: 'HTTP Semantics (field syntax; CORS itself is the WHATWG Fetch Standard)',
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The browser. On every diagram, and the only node that holds a cookie jar. */
export const BROWSER_NODE = 'browser';

/** The shared cache in the middle, when a scenario declares one. */
export const CDN_NODE = 'cdn';

/**
 * Virtual milliseconds left on the timeline after the last byte arrives.
 *
 * The closing chapter needs somewhere to live: with no tail it would start and end at
 * the same instant, and the stepper would land on a phase of zero duration.
 */
export const HTTP_TAIL_MS = 60;

/** What a browser cache lookup costs. Not zero, and not remotely a network hop. */
export const BROWSER_CACHE_LOOKUP_MS = 1;

/** What an edge cache lookup costs once the request has arrived there. */
export const CDN_LOOKUP_MS = 2;

/**
 * The share of the round trip that lies between the browser and the edge.
 *
 * A quarter, which is roughly what a CDN buys: the edge is near, the origin is not. It
 * is also what makes a CDN `HIT` visibly cheaper than a `MISS` on the timeline rather
 * than merely labelled so.
 */
export const EDGE_RTT_SHARE = 0.25;

/** Headers a browser sends on everything, unless a step overrides them. */
export const DEFAULT_REQUEST_HEADERS: HeaderList = [
  header('User-Agent', 'InternetVisualizer/1.0 (simulated)'),
  header('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'),
  header('Accept-Language', 'en-GB,en;q=0.9'),
  header('Accept-Encoding', 'gzip, br'),
];

/** What a route allows when it does not say. The two methods every resource supports. */
const DEFAULT_ROUTE_METHODS: readonly HttpMethod[] = ['GET', 'HEAD'];

/** How long an origin takes to answer when nothing says otherwise. */
const DEFAULT_THINK_MS = 12;

// ---------------------------------------------------------------------------
// CORS -- the browser's policy, not the server's
// ---------------------------------------------------------------------------

/**
 * The request fields a cross-origin request may carry without a preflight.
 *
 * A deliberately tiny list. Everything else -- `Authorization`, `X-Requested-With`, any
 * header a framework invented -- costs an extra round trip before the real request is
 * allowed to leave, which is the single most common reason a cross-origin API feels slow.
 */
export const CORS_SAFELISTED_REQUEST_HEADERS: readonly string[] = [
  'accept',
  'accept-language',
  'content-language',
  'content-type',
  'range',
];

/**
 * The only three `Content-Type` values a simple request may use.
 *
 * `application/json` is **not** among them, which is why essentially every modern API
 * call is preflighted. The three that are here are the ones an HTML form could already
 * produce before CORS existed, so allowing them added no new capability to the web.
 */
export const CORS_SAFELISTED_CONTENT_TYPES: readonly string[] = [
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
];

/** The methods a simple request may use -- again, what a form could already do. */
export const CORS_SIMPLE_METHODS: readonly HttpMethod[] = ['GET', 'HEAD', 'POST'];

/**
 * Fields the user agent sets on its own behalf.
 *
 * They never force a preflight, because forbidding the author from setting them is what
 * makes them trustworthy: a page cannot forge its own `Origin`, which is the entire
 * reason a server may believe one.
 */
const BROWSER_SET_FIELDS: readonly string[] = [
  'host',
  'origin',
  'referer',
  'user-agent',
  'connection',
  'cookie',
  'content-length',
  'accept-encoding',
  'accept-charset',
  'date',
  'te',
  'upgrade',
  'via',
];

/** What an origin will permit cross-origin callers to do with a route. */
export interface CorsPolicy {
  /** Origins allowed, or `['*']`. Absent entirely means the route sends no CORS fields. */
  readonly allowOrigins?: readonly string[];
  readonly allowMethods?: readonly HttpMethod[];
  readonly allowHeaders?: readonly string[];
  /** Whether cookies may be attached, and the response read, on a credentialed request. */
  readonly allowCredentials?: boolean;
  /** `Access-Control-Max-Age`: how long the preflight result may be cached. */
  readonly maxAgeSeconds?: number;
}

/** What CORS decided about one exchange, and why. */
export interface CorsDecision {
  readonly crossOrigin: boolean;
  /** The `Origin` field the browser sent, when it sent one. */
  readonly requestOrigin?: string;
  /** Whether this request was simple enough to skip the preflight. */
  readonly simple: boolean;
  /** Whether a preflight was required before it. */
  readonly preflightRequired: boolean;
  /** Whether the **page** is allowed to read the response. */
  readonly allowed: boolean;
  readonly reason: string;
}

/** The scheme and host a page or a request belongs to, e.g. `https://app.example.com`. */
function originOf(host: string, secure: boolean): string {
  return `${secure ? 'https' : 'http'}://${host}`;
}

/** The host part of an origin string, lower-cased. */
function hostOf(origin: string): string {
  return origin
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .toLowerCase();
}

/**
 * The registrable domain: the shortest suffix of a host that is not a public suffix.
 *
 * `www.example.com` and `shop.example.com` both reduce to `example.com`, which is what
 * makes them the **same site** even though they are different origins. Cookies are scoped
 * by site and CORS by origin, and conflating the two is why `SameSite` surprises people:
 * a request from `www.` to `api.` on one domain is cross-origin and same-site, so CORS
 * applies to it and `SameSite` does not.
 */
function registrableDomain(host: string): string {
  const labels = host.toLowerCase().split('.');
  for (let index = labels.length - 1; index >= 0; index -= 1) {
    const candidate = labels.slice(index).join('.');
    if (!isPublicSuffix(candidate)) return candidate;
  }
  return host.toLowerCase();
}

/**
 * Whether a request is simple enough to be sent without asking permission first.
 *
 * The rule is the WHATWG Fetch Standard's, and the shape of it is historical rather than
 * logical: a request is simple when an HTML form of 1999 could already have made it, so
 * permitting it grants an attacker nothing they did not already have. That is also why
 * a simple request is **sent and executed** even when the response is then blocked --
 * the damage, if any, was already possible.
 */
export function isSimpleCorsRequest(request: HttpRequest): boolean {
  if (!CORS_SIMPLE_METHODS.includes(request.method)) return false;

  for (const field of request.headers) {
    const name = field.name.toLowerCase();
    // Fields the browser itself sets are not the author's and never force a preflight.
    if (BROWSER_SET_FIELDS.includes(name)) continue;
    if (!CORS_SAFELISTED_REQUEST_HEADERS.includes(name)) return false;
    if (name === 'content-type') {
      const value = field.value.split(';')[0].trim().toLowerCase();
      if (!CORS_SAFELISTED_CONTENT_TYPES.includes(value)) return false;
    }
  }
  return true;
}

/**
 * The author-supplied fields a preflight has to ask about, lower-cased and sorted.
 *
 * `Content-Type` is on the safelist by *name* and still ends up here whenever its value
 * is not one of the three a 1999 form could produce -- which is to say, on every
 * `application/json` request ever made. That single row of the safelist is why almost
 * every cross-origin API call costs two round trips instead of one.
 */
function nonSafelistedHeaders(request: HttpRequest): string[] {
  const names = request.headers
    .filter((field) => {
      const name = field.name.toLowerCase();
      if (BROWSER_SET_FIELDS.includes(name)) return false;
      if (!CORS_SAFELISTED_REQUEST_HEADERS.includes(name)) return true;
      if (name !== 'content-type') return false;
      const value = field.value.split(';')[0].trim().toLowerCase();
      return !CORS_SAFELISTED_CONTENT_TYPES.includes(value);
    })
    .map((field) => field.name.toLowerCase());
  return [...new Set(names)].sort();
}

/**
 * The browser's verdict once the response is in its hands.
 *
 * This runs **after** the response has arrived, which is the entire lesson of the CORS
 * scenario. The request went out, the server ran it, the response came back; and then
 * the browser refused to hand it to the page. CORS is not, and has never been, a way to
 * stop a request from reaching a server.
 */
function judgeCors(
  request: HttpRequest,
  responseMessage: HttpResponse,
  requestOrigin: string | undefined,
  withCredentials: boolean,
): CorsDecision {
  const simple = isSimpleCorsRequest(request);

  if (requestOrigin === undefined) {
    return {
      crossOrigin: false,
      simple,
      preflightRequired: false,
      allowed: true,
      reason: 'same-origin: CORS does not apply',
    };
  }

  const allow = headerValue(responseMessage.headers, 'Access-Control-Allow-Origin');
  const credentials =
    headerValue(responseMessage.headers, 'Access-Control-Allow-Credentials') === 'true';

  const base = {
    crossOrigin: true,
    requestOrigin,
    simple,
    preflightRequired: !simple,
  };

  if (allow === undefined) {
    return {
      ...base,
      allowed: false,
      reason:
        'the response carried no Access-Control-Allow-Origin, so the browser withheld ' +
        'it from the page -- the request was still sent, and the server still ran it',
    };
  }
  if (allow !== '*' && allow !== requestOrigin) {
    return {
      ...base,
      allowed: false,
      reason: `Access-Control-Allow-Origin was ${allow}, which is not ${requestOrigin}`,
    };
  }
  if (withCredentials && allow === '*') {
    return {
      ...base,
      allowed: false,
      reason:
        'a credentialed request may not be answered with Access-Control-Allow-Origin: ' +
        '*, because the wildcard would let any site read a logged-in response',
    };
  }
  if (withCredentials && !credentials) {
    return {
      ...base,
      allowed: false,
      reason:
        'cookies were attached but the response did not say ' +
        'Access-Control-Allow-Credentials: true',
    };
  }
  return {
    ...base,
    allowed: true,
    reason: `Access-Control-Allow-Origin: ${allow} permits ${requestOrigin} to read this`,
  };
}

// ---------------------------------------------------------------------------
// The origin -- a bundled fixture, and never a real host
// ---------------------------------------------------------------------------

/** One resource an origin serves, declared rather than computed. */
export interface OriginRoute {
  /** The path this route answers on. Compared exactly, after the query is stripped. */
  readonly path: string;
  /** Methods allowed here; anything else gets a 405 with `Allow`. Defaults to GET, HEAD. */
  readonly methods?: readonly HttpMethod[];
  readonly status: number;
  readonly reason?: string;
  /** Response fields, before `Date`, `Content-Length` and CORS are folded in. */
  readonly headers?: HeaderList;
  readonly body?: string;
  /** How long this route takes to produce a first byte. */
  readonly thinkMs?: number;
  /**
   * Whether the route evaluates preconditions. With this on, a request carrying
   * `If-None-Match` or `If-Modified-Since` can come back as a 304 with no body at all.
   */
  readonly conditional?: boolean;
  /** A cookie this route requires; without it the client gets {@link OriginRoute.denied}. */
  readonly requiresCookie?: string;
  /** The answer when `requiresCookie` is not satisfied. Defaults to a bare 401. */
  readonly denied?: {
    readonly status: number;
    readonly reason?: string;
    readonly headers?: HeaderList;
    readonly body?: string;
  };
  /** Raw `Set-Cookie` field values this route sends, in order. */
  readonly setCookies?: readonly string[];
  /** What cross-origin callers may do here. Absent means: no CORS fields at all. */
  readonly cors?: CorsPolicy;
}

/** A simulated server. Bundled with the scenario; nothing here resolves or connects. */
export interface OriginFixture {
  readonly host: string;
  /** Shown on the diagram. Defaults to the host. */
  readonly label?: string;
  /** RFC 5737 documentation space, so no address can be mistaken for a real host. */
  readonly ipv4?: string;
  /** The `Server` field this origin announces. */
  readonly server?: string;
  readonly routes: readonly OriginRoute[];
  /** Default think time for routes that do not say. */
  readonly thinkMs?: number;
}

/** What the origin decided, before anything is put on a wire. */
interface OriginReply {
  readonly response: HttpResponse;
  readonly thinkMs: number;
  readonly note: string;
  readonly level: LogLevel;
}

function routeFor(origin: OriginFixture, path: string): OriginRoute | undefined {
  return origin.routes.find((route) => route.path === path);
}

/**
 * Narrow a full response to a 304 when the client already holds this exact version.
 *
 * Used where a cache revalidated upstream on its own account and then finds that the
 * validator the *client* sent matches what came back. Sending the body would be sending
 * bytes the client told you it already had.
 */
function confirmForClient(
  request: HttpRequest,
  message: HttpResponse,
  clock: HttpClock,
): HttpResponse {
  if (message.status !== 200) return message;
  return evaluateConditional(request, message, clock).status === 304
    ? notModifiedResponse(message)
    : message;
}

/** Whether the request carries anything the origin should evaluate as a precondition. */
function hasValidators(request: HttpRequest): boolean {
  return request.headers.some((field) =>
    ['if-none-match', 'if-modified-since', 'if-match', 'if-unmodified-since'].includes(
      field.name.toLowerCase(),
    ),
  );
}

/** The `Access-Control-*` fields a policy adds to a real (non-preflight) response. */
function corsResponseHeaders(
  policy: CorsPolicy | undefined,
  requestOrigin: string | undefined,
): HeaderList {
  if (!policy || requestOrigin === undefined) return [];
  const allowed = policy.allowOrigins ?? [];
  const match = allowed.includes('*')
    ? '*'
    : allowed.includes(requestOrigin)
      ? requestOrigin
      : undefined;
  if (match === undefined) return [];

  const out: HttpHeader[] = [header('Access-Control-Allow-Origin', match)];
  if (policy.allowCredentials) {
    out.push(header('Access-Control-Allow-Credentials', 'true'));
  }
  if (match !== '*') {
    // Without this, a shared cache could hand the response for one origin to another.
    out.push(header('Vary', 'Origin'));
  }
  return out;
}

/**
 * Answer one request.
 *
 * The order of the checks is the order a server actually applies them, and two of them
 * are where the interesting scenarios live: the conditional check is what turns a 200
 * into a bodiless 304, and the cookie check is what makes a session mean anything.
 */
function serveOrigin(
  origin: OriginFixture,
  request: HttpRequest,
  clock: HttpClock,
  at: number,
): OriginReply {
  const { path } = parseTarget(request.target);
  const route = routeFor(origin, path);
  const requestOrigin = headerValue(request.headers, 'Origin');
  const serverField = header('Server', origin.server ?? 'simulated-origin');
  const thinkMs = route?.thinkMs ?? origin.thinkMs ?? DEFAULT_THINK_MS;

  const finish = (
    message: HttpResponse,
    note: string,
    level: LogLevel = 'info',
    extraThink = 0,
  ): OriginReply => {
    let out: HttpResponse = {
      ...message,
      reason: message.reason || reasonPhrase(message.status),
      version: request.version,
      headers: [
        ...message.headers,
        dateHeader(at, clock),
        serverField,
        ...corsResponseHeaders(route?.cors, requestOrigin),
      ],
    };
    // A 204 or a 304 must not announce a length for content it structurally cannot have.
    if (!forbidsContent(out.status)) out = withContentLength(out);
    return { response: out, thinkMs: thinkMs + extraThink, note, level };
  };

  if (!route) {
    return finish(
      buildResponse({
        status: 404,
        headers: [header('Content-Type', 'text/plain; charset=utf-8')],
        body: `No resource at ${path} on this simulated origin.\n`,
      }),
      `nothing is published at ${path}`,
      'warn',
    );
  }

  // A preflight: not a request for the resource, but a question about one.
  if (request.method === 'OPTIONS' && route.cors) {
    const policy = route.cors;
    const asked = headerValue(request.headers, 'Access-Control-Request-Method');
    const askedHeaders = headerValue(request.headers, 'Access-Control-Request-Headers');
    const allowedMethods = policy.allowMethods ?? [...DEFAULT_ROUTE_METHODS];
    const allowedHeaders = policy.allowHeaders ?? [];

    const methodOk = asked === undefined || allowedMethods.includes(asked as HttpMethod);
    const headersOk =
      askedHeaders === undefined ||
      askedHeaders
        .split(',')
        .map((name) => name.trim().toLowerCase())
        .filter((name) => name !== '')
        .every((name) => allowedHeaders.map((each) => each.toLowerCase()).includes(name));

    const headers: HttpHeader[] = [
      header('Access-Control-Allow-Methods', allowedMethods.join(', ')),
    ];
    if (allowedHeaders.length > 0) {
      headers.push(header('Access-Control-Allow-Headers', allowedHeaders.join(', ')));
    }
    if (policy.maxAgeSeconds !== undefined) {
      headers.push(header('Access-Control-Max-Age', `${policy.maxAgeSeconds}`));
    }

    return finish(
      buildResponse({ status: methodOk && headersOk ? 204 : 403, headers }),
      methodOk && headersOk
        ? `preflight approved: ${asked ?? 'the method'} may be used here, with ${askedHeaders ?? 'no extra fields'}`
        : 'preflight refused: the method or a field the caller wants to send is not allowed here',
      methodOk && headersOk ? 'info' : 'warn',
    );
  }

  const allowedMethods = route.methods ?? DEFAULT_ROUTE_METHODS;
  if (!allowedMethods.includes(request.method)) {
    return finish(
      buildResponse({
        status: 405,
        headers: [header('Allow', allowedMethods.join(', '))],
      }),
      `${request.method} is not allowed on ${path}; the Allow field lists what is`,
      'warn',
    );
  }

  if (route.requiresCookie !== undefined) {
    const jarField = headerValue(request.headers, 'Cookie') ?? '';
    const present = jarField
      .split(';')
      .map((pair) => pair.trim().split('=')[0])
      .includes(route.requiresCookie);
    if (!present) {
      const denied = route.denied ?? { status: 401 };
      return finish(
        buildResponse({
          status: denied.status,
          ...(denied.reason === undefined ? {} : { reason: denied.reason }),
          headers: denied.headers ?? [
            header('Content-Type', 'text/plain; charset=utf-8'),
          ],
          body: denied.body ?? 'Not signed in.\n',
        }),
        `no ${route.requiresCookie} cookie arrived, so the origin never saw a session`,
        'warn',
      );
    }
  }

  const representation = buildResponse({
    status: route.status,
    ...(route.reason === undefined ? {} : { reason: route.reason }),
    version: request.version,
    headers: [...(route.headers ?? [])],
    ...(route.body === undefined ? {} : { body: route.body }),
  });

  if (route.conditional && hasValidators(request)) {
    const verdict = evaluateConditional(request, representation, clock);
    if (verdict.status === 304) {
      return finish(notModifiedResponse(representation), verdict.reason);
    }
    if (verdict.status === 412) {
      return finish(buildResponse({ status: 412 }), verdict.reason, 'warn');
    }
  }

  const withCookies: HttpResponse = {
    ...representation,
    headers: [
      ...representation.headers,
      ...(route.setCookies ?? []).map((field) => header('Set-Cookie', field)),
    ],
  };

  return finish(
    withCookies,
    route.status >= 400
      ? `the origin refused: ${route.status} ${reasonPhrase(route.status)}`
      : `the origin served ${path}`,
    route.status >= 500 ? 'error' : route.status >= 400 ? 'warn' : 'info',
  );
}

// ---------------------------------------------------------------------------
// What a scenario declares
// ---------------------------------------------------------------------------

/** Who caused this request, which is most of what the cookie jar and CORS decide on. */
export interface Initiator {
  /**
   * The origin of the page making the request, e.g. `https://app.example.com`. Absent
   * means the browser itself is navigating, so the request is same-site by definition.
   */
  readonly pageOrigin?: string;
  /** True when the browser is navigating the top-level window: a link, or a form submit. */
  readonly topLevelNavigation?: boolean;
  /** Whether cookies are attached to a cross-origin request (`credentials: 'include'`). */
  readonly withCredentials?: boolean;
}

/** One thing the client does. */
export interface RequestStep {
  readonly kind: 'request';
  /** Stable id; becomes the phase id, so scenario notes can pin to it. */
  readonly id: string;
  readonly method?: HttpMethod;
  /** Host to send to. Must name one of the scenario's origins. */
  readonly host: string;
  readonly target: string;
  /** Fields on top of {@link DEFAULT_REQUEST_HEADERS}. */
  readonly headers?: HeaderList;
  readonly body?: string;
  /** One sentence naming why this request is being made. Becomes the chapter's text. */
  readonly intent: string;
  /** A short chapter title. Defaults to the method and target. */
  readonly title?: string;
  /** Virtual milliseconds of idling before this request. How a cached copy goes stale. */
  readonly afterMs?: number;
  readonly initiator?: Initiator;
  /** Send `Cache-Control: no-cache`, as a reload does: revalidate whatever is stored. */
  readonly reload?: boolean;
  /** Follow `Location` on a 3xx. On by default; turn it off to stop on the redirect. */
  readonly followRedirects?: boolean;
  /** How many hops to follow before giving up. Browsers stop around twenty. */
  readonly maxRedirects?: number;
}

/** Run the same page load over all three versions and put them on one timeline. */
export interface CompareStep {
  readonly kind: 'compare';
  readonly id: string;
  readonly host: string;
  readonly intent: string;
  readonly title?: string;
  readonly afterMs?: number;
  readonly resources: readonly ResourceRequest[];
  readonly conditions?: Partial<NetworkConditions>;
}

/** Everything a scenario can ask the client to do. */
export type ExchangeStep = RequestStep | CompareStep;

/**
 * A teaching note a scenario pins to one of its own phases.
 *
 * Pinned by phase id rather than by timestamp, because a scenario author knows which
 * chapter a point belongs to and does not know -- and should not have to know -- what
 * millisecond that chapter begins at. An id the run does not have is a bug in the
 * scenario, and throws rather than being dropped: the catalogue test runs every
 * scenario, so a typo surfaces on the first `npm test` after it is made.
 */
export interface ScenarioNote {
  readonly phase: string;
  /** What it explains: a node id. Defaults to the browser, which is always present. */
  readonly target?: string;
  readonly text: string;
  readonly reference?: RfcRef;
}

/** One run of the HTTP Explorer. */
export interface HttpScenario {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  /** What a learner should be able to say afterwards. */
  readonly teaches: readonly string[];
  /** Seeds packet loss in the version comparison; nothing else in the module draws. */
  readonly seed: string;
  /** The version the conversation is held in. The comparison step overrides it. */
  readonly version?: HttpVersion;
  /** Whether the connection is encrypted. `Secure` cookies need this to be true. */
  readonly secure?: boolean;
  /** The link everything is fetched over. */
  readonly conditions?: Partial<NetworkConditions>;
  /**
   * Virtual time zero as an epoch millisecond, so `Date` and `Expires` read as real
   * dates on a timeline that starts at zero. Fixed per scenario, never `Date.now()`.
   */
  readonly clock?: HttpClock;
  /** The servers taking part. The first one anchors the diagram. */
  readonly origins: readonly OriginFixture[];
  /** A shared cache between the browser and the origin. */
  readonly cdn?: { readonly label: string; readonly ipv4?: string };
  readonly steps: readonly ExchangeStep[];
  readonly notes?: readonly ScenarioNote[];
}

/** What a test or a control panel may vary without editing the scenario. */
export type HttpScenarioOverrides = Partial<
  Pick<HttpScenario, 'seed' | 'version' | 'secure' | 'conditions'>
>;

// ---------------------------------------------------------------------------
// What comes out
// ---------------------------------------------------------------------------

/** Which tier actually produced the bytes the client got. */
export type ServedBy =
  /** The private cache, with no network hop at all. */
  | 'browser-cache'
  /** The shared cache at the edge. */
  | 'cdn'
  /** The origin server. */
  | 'origin';

/** Why this exchange happened. */
export type ExchangeKind =
  /** The request the step asked for. */
  | 'request'
  /** An `OPTIONS` sent to ask permission before the real one. */
  | 'preflight'
  /** A hop taken because the previous response carried a `Location`. */
  | 'redirect';

/** One request and its answer, with everything the panels need to explain it. */
export interface HttpExchange {
  readonly id: string;
  /** The step that caused it. */
  readonly stepId: string;
  /** `0` for the step's own request; `1` and up for preflights and redirect hops. */
  readonly hop: number;
  readonly kind: ExchangeKind;
  readonly host: string;
  /** As it went on the wire, cookies and conditional fields included. */
  readonly request: HttpRequest;
  /** As the client finally saw it, `Age` included when it came from a cache. */
  readonly response: HttpResponse;
  readonly sentAt: number;
  readonly receivedAt: number;
  readonly servedBy: ServedBy;
  readonly browserCache: CacheOutcome;
  /** Absent when the scenario has no shared cache, or the browser never asked for one. */
  readonly cdnCache?: CacheOutcome;
  /** The sentence the cache panel shows under the badge. */
  readonly cacheReason: string;
  readonly cookiesSent: readonly Cookie[];
  readonly cookiesExcluded: readonly CookieExclusion[];
  readonly cookiesSet: readonly CookieStoreResult[];
  readonly cors: CorsDecision;
  /** True when the response arrived and the browser refused to give it to the page. */
  readonly blockedFromPage: boolean;
  readonly note: string;
}

/** A finished run. */
export interface HttpRun {
  readonly scenario: HttpScenario;
  readonly topology: Topology;
  readonly result: SimResult;
  /** Every exchange, in order, including preflights and redirect hops. */
  readonly exchanges: readonly HttpExchange[];
  readonly browserCache: HttpCache;
  /** Absent unless the scenario declared a CDN. */
  readonly cdnCache?: HttpCache;
  readonly jar: CookieJar;
  /** Present only for a scenario with a `compare` step. */
  readonly comparison?: VersionComparison;
  /** Both caches as the panel draws them, at the end of the run. */
  readonly cacheViews: Readonly<Record<CacheTier, CacheEntryView[]>>;
}

// ---------------------------------------------------------------------------
// PDUs
// ---------------------------------------------------------------------------

/** Ports, so the transport layer of the inspector says something true. */
const CLIENT_PORT = 49_152;

function serverPort(secure: boolean): number {
  return secure ? 443 : 80;
}

/** Header fields as the inspector lists them: in wire order, values verbatim. */
function fieldsOf(headers: HeaderList): HeaderField[] {
  return headers.map((field) => ({ name: field.name, value: field.value }));
}

/** The first line, which is what a packet analyser shows as the summary. */
function startLine(message: HttpMessage): string {
  return 'method' in message
    ? `${message.method} ${message.target} ${message.version}`
    : `${message.version} ${message.status} ${message.reason}`;
}

/**
 * One HTTP message, as an encapsulated PDU.
 *
 * The stack is real rather than decorative: an h1 request over TLS genuinely is an HTTP
 * message inside a TLS record inside a TCP segment, and the inspector shows the layers
 * in that order because that is the order a receiving stack peels them off.
 */
function httpPdu(
  id: string,
  message: HttpMessage,
  context: { version: HttpVersion; secure: boolean; streamId?: number },
): PDU {
  const profile = VERSION_PROFILES[context.version];
  const wire = serializeMessage(message);
  const isReq = 'method' in message;

  const transport: ProtocolLayer = {
    layer: 'transport',
    protocol: profile.transport,
    fields: [
      {
        name: 'Source Port',
        value: `${isReq ? CLIENT_PORT : serverPort(context.secure)}`,
        bits: 16,
      },
      {
        name: 'Destination Port',
        value: `${isReq ? serverPort(context.secure) : CLIENT_PORT}`,
        bits: 16,
      },
      ...(profile.transport === 'QUIC'
        ? [
            {
              name: 'Stream ID',
              value: `${context.streamId ?? 0}`,
              note: 'QUIC streams are independent: a packet lost on one does not hold up any other.',
            },
          ]
        : []),
    ],
  };

  const layers: ProtocolLayer[] = [transport];

  if (context.secure) {
    layers.push({
      layer: 'session',
      protocol: 'TLS 1.3',
      fields: [
        { name: 'Content Type', value: 'application/data (23)', bits: 8 },
        {
          name: 'Length',
          value: `${byteLength(wire)} bytes of plaintext`,
          bits: 16,
          note: 'Everything above this line is encrypted on the wire. The wire view shows the plaintext the two ends see, not the bytes an observer would.',
        },
      ],
    });
  }

  layers.push({
    layer: 'application',
    protocol: context.version,
    fields:
      profile.framing === 'binary'
        ? [
            {
              name: 'Frame',
              value: message.body === undefined ? 'HEADERS' : 'HEADERS + DATA',
              note: `A ${profile.headerCompression}-compressed header block, then the body as DATA frames. There is no blank line and no CRLF: the length is in the frame header.`,
            },
            {
              name: 'Stream ID',
              value: `${context.streamId ?? 1}`,
              bits: 31,
              note: 'Client-initiated streams are odd, server-initiated ones even, so neither end has to ask before opening one.',
            },
            ...fieldsOf(message.headers),
          ]
        : fieldsOf(message.headers),
    payloadPreview: startLine(message),
  });

  return {
    id,
    layers,
    sizeBytes: byteLength(wire),
    summary: startLine(message),
  };
}

// ---------------------------------------------------------------------------
// The build
// ---------------------------------------------------------------------------

interface Build {
  readonly events: SimEvent[];
  readonly pdus: Record<string, PDU>;
  readonly nodes: SimNode[];
  readonly links: SimLink[];
  readonly nodeIds: Set<string>;
  readonly linkIds: Set<string>;
  readonly version: HttpVersion;
  readonly secure: boolean;
  readonly conditions: NetworkConditions;
  readonly clock: HttpClock;
  readonly edgeLatencyMs: number;
  readonly originLatencyMs: number;
  readonly hasCdn: boolean;
  /** Hosts already connected to, so a handshake is paid for once and not per request. */
  readonly connected: Set<string>;
}

function ensureNode(build: Build, node: SimNode): string {
  if (!build.nodeIds.has(node.id)) {
    build.nodeIds.add(node.id);
    build.nodes.push(node);
  }
  return node.id;
}

function ensureLink(build: Build, from: string, to: string, latencyMs: number): string {
  const id = `${from}-${to}`;
  if (!build.linkIds.has(id)) {
    build.linkIds.add(id);
    build.links.push({
      id,
      from,
      to,
      latencyMs,
      bandwidthMbps: build.conditions.bandwidthKbps / 1000,
      medium: 'fiber',
    });
  }
  return id;
}

/** Virtual milliseconds to clock a message onto the wire at the scenario's bandwidth. */
function serializationMs(build: Build, message: HttpMessage): number {
  // kbps is bits per millisecond, so this is bytes -> bits -> milliseconds.
  return round2(
    (byteLength(serializeMessage(message)) * 8) / build.conditions.bandwidthKbps,
  );
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

/** Everything the client carries between steps. */
interface ClientState {
  jar: CookieJar;
  browserCache: HttpCache;
  cdnCache: HttpCache | undefined;
  /**
   * Preflight results, keyed by origin, method and asked-for fields, expiring at the
   * virtual millisecond `Access-Control-Max-Age` puts them at.
   *
   * This is the cache almost nobody configures. Without it every cross-origin write in
   * an application pays two round trips instead of one, forever -- and the field that
   * fixes it is one line of server config that costs nothing.
   */
  preflights: Map<string, number>;
}

/** The key a preflight result is remembered under. */
function preflightKey(
  target: string,
  method: HttpMethod,
  fields: readonly string[],
): string {
  return `${target}|${method}|${fields.join(',')}`;
}

/** The result of one network exchange, before it is turned into events. */
interface ExchangeOutcome {
  readonly exchange: HttpExchange;
  /** Virtual millisecond the client is free to do the next thing. */
  readonly endsAt: number;
}

/**
 * Send one request and get one response, emitting everything that happens on the way.
 *
 * The order here is the order a browser really works in, and each step is somewhere a
 * scenario makes its point:
 *
 * 1. attach cookies (and record the ones deliberately withheld);
 * 2. ask the private cache -- a hit ends the story with no network at all;
 * 3. cross the wire, through the shared cache if there is one;
 * 4. store what came back, in both caches and in the jar;
 * 5. **then** ask whether the page is allowed to see it.
 *
 * Step 5 happening last is not an implementation detail. It is the CORS lesson.
 */
function runExchange(
  build: Build,
  state: ClientState,
  init: {
    id: string;
    stepId: string;
    hop: number;
    kind: ExchangeKind;
    origin: OriginFixture;
    method: HttpMethod;
    target: string;
    headers: HeaderList;
    body?: string;
    initiator: Initiator;
    reload: boolean;
    at: number;
  },
): ExchangeOutcome {
  const { origin, initiator } = init;
  const host = origin.host;
  const { path } = parseTarget(init.target);
  const pageOrigin = initiator.pageOrigin;
  const targetOrigin = originOf(host, build.secure);
  const navigation = initiator.topLevelNavigation ?? false;
  const crossOrigin = pageOrigin !== undefined && pageOrigin !== targetOrigin;
  const sameSite =
    pageOrigin === undefined ||
    registrableDomain(hostOf(pageOrigin)) === registrableDomain(host);

  /**
   * Whether CORS has anything to say about this request.
   *
   * It does not apply to a top-level navigation. Clicking a link to another site is not
   * a fetch the page will read the bytes of -- the browser is replacing the document --
   * so there is nothing to withhold and no permission to ask for. Conflating "the
   * browser went somewhere else" with "a script read something else" is the second most
   * common CORS misconception after the one this module's sixth scenario is built around.
   */
  const corsApplies = crossOrigin && !navigation;
  // Credentials ride along on a navigation whatever the origin; on a fetch they are the
  // author's choice, and default to same-origin only.
  const withCredentials = initiator.withCredentials ?? (navigation || !crossOrigin);

  const browserId = ensureNode(build, {
    id: BROWSER_NODE,
    kind: 'client',
    label: 'Browser',
    detail: {
      role: 'the user agent: cookie jar, private cache, and the CORS policy',
      'HTTP version': build.version,
      channel: build.secure ? 'TLS 1.3' : 'cleartext',
    },
  });
  const originId = ensureNode(build, {
    id: host,
    kind: 'server',
    label: origin.label ?? host,
    ...(origin.ipv4 ? { ipv4: origin.ipv4 } : {}),
    detail: {
      role: 'simulated origin server -- bundled fixture, never contacted',
      routes: `${origin.routes.length} published path(s)`,
    },
  });
  const cdnId = build.hasCdn ? CDN_NODE : undefined;

  const nearLink = cdnId
    ? ensureLink(build, browserId, cdnId, build.edgeLatencyMs)
    : ensureLink(build, browserId, originId, build.originLatencyMs);
  const farLink = cdnId
    ? ensureLink(build, cdnId, originId, build.originLatencyMs)
    : nearLink;

  let at = init.at;

  // --- Connection setup, once per host -------------------------------------

  if (!build.connected.has(host)) {
    build.connected.add(host);
    const cost = handshakeCost(build.version, build.conditions);
    if (cost.ms > 0) {
      build.events.push(
        {
          kind: 'node-state',
          at,
          nodeId: originId,
          state: 'processing',
          note: 'connecting',
        },
        {
          kind: 'log',
          at,
          level: 'info',
          text: `${VERSION_PROFILES[build.version].alias}: ${cost.explanation}`,
        },
        {
          kind: 'annotate',
          at,
          targetId: originId,
          text: cost.steps.map((step) => `${step.label} -- ${step.note}`).join(' '),
          reference: VERSION_PROFILES[build.version].transportRfc ?? RFC_9112,
        },
      );
      at += cost.ms;
      build.events.push({ kind: 'node-state', at, nodeId: originId, state: 'idle' });
    }
  }

  // --- The request, as the client assembles it -----------------------------

  const jar = purgeExpired(state.jar, at);
  const selection = cookiesFor(jar, {
    host,
    path,
    secureChannel: build.secure,
    method: init.method,
    sameSite,
    topLevelNavigation: navigation,
    now: at,
  });
  state.jar = jar;

  const attachCookies = withCredentials && selection.cookies.length > 0;
  let request: HttpRequest = buildRequest({
    method: init.method,
    target: init.target,
    version: build.version,
    headers: [
      header('Host', host),
      ...init.headers,
      ...(crossOrigin && pageOrigin !== undefined && (corsApplies || !isSafe(init.method))
        ? [header('Origin', pageOrigin)]
        : []),
      ...(attachCookies ? [header('Cookie', cookieHeaderValue(selection.cookies))] : []),
      ...(init.reload ? [header('Cache-Control', 'no-cache')] : []),
    ],
    ...(init.body === undefined ? {} : { body: init.body }),
  });
  if (init.body !== undefined) request = withContentLength(request);

  // --- The private cache ---------------------------------------------------

  const browserLookup = lookupCache(state.browserCache, request, at, build.clock);
  const cacheReason = browserLookup.reason;

  if (browserLookup.kind === 'hit' && browserLookup.entry) {
    const served = serveFromCache(browserLookup.entry, at, {
      shared: false,
      clock: build.clock,
    });
    const endsAt = at + BROWSER_CACHE_LOOKUP_MS;

    build.events.push(
      {
        kind: 'node-state',
        at,
        nodeId: browserId,
        state: 'processing',
        note: 'cache hit',
      },
      {
        kind: 'log',
        at,
        level: 'info',
        text: `browser cache HIT for ${init.method} ${init.target} -- ${browserLookup.reason}`,
      },
      {
        kind: 'annotate',
        at,
        targetId: browserId,
        text:
          'Nothing crossed the network. This is what a cache is worth: not a faster ' +
          `request but no request, and the ${browserLookup.freshness?.age ?? 0}s of Age on ` +
          'the response is the only visible sign the bytes are not new.',
        reference: { ...RFC_9111, section: '4' },
      },
      { kind: 'node-state', at: endsAt, nodeId: browserId, state: 'idle' },
    );

    const cors = judgeCors(
      request,
      served,
      corsApplies ? pageOrigin : undefined,
      withCredentials,
    );
    return {
      endsAt,
      exchange: {
        id: init.id,
        stepId: init.stepId,
        hop: init.hop,
        kind: init.kind,
        host,
        request,
        response: served,
        sentAt: at,
        receivedAt: endsAt,
        servedBy: 'browser-cache',
        browserCache: 'HIT',
        cacheReason: browserLookup.reason,
        cookiesSent: selection.cookies,
        cookiesExcluded: selection.excluded,
        cookiesSet: [],
        cors,
        blockedFromPage: !cors.allowed,
        note: `served from the browser cache: ${browserLookup.reason}`,
      },
    };
  }

  const revalidating =
    browserLookup.kind === 'stale' && browserLookup.entry !== undefined;
  if (revalidating && browserLookup.entry) {
    request = revalidationRequest(browserLookup.entry, request);
    build.events.push({
      kind: 'annotate',
      at,
      targetId: browserId,
      text:
        `The stored copy is unusable as it stands -- ${browserLookup.reason} -- but it is ` +
        'not thrown away. The validators go out with the request, and the answer is ' +
        'either the whole resource again or a 304 with no body at all, which costs a ' +
        'round trip and not a byte of content.',
      reference: RFC_9110_CONDITIONALS,
    });
  }

  // --- Onto the wire -------------------------------------------------------

  const sentAt = at;
  const requestPdu = httpPdu(`${init.id}-req`, request, {
    version: build.version,
    secure: build.secure,
    streamId: 1,
  });
  build.pdus[requestPdu.id] = requestPdu;

  const requestWireMs = serializationMs(build, request);
  build.events.push(
    { kind: 'pdu-created', at: sentAt, pdu: requestPdu, atNode: browserId },
    {
      kind: 'log',
      at: sentAt,
      level: 'info',
      text: `${browserId} -> ${cdnId ?? originId}: ${startLine(request)}${
        revalidating ? ' (conditional)' : ''
      }`,
    },
  );

  let cdnOutcome: CacheOutcome | undefined;
  let servedBy: ServedBy = 'origin';
  let responseMessage: HttpResponse;
  let receivedAt: number;
  let note: string;
  let level: LogLevel = 'info';

  const firstLegMs = round2(
    (cdnId ? build.edgeLatencyMs : build.originLatencyMs) + requestWireMs,
  );

  build.events.push({
    kind: 'transmit',
    at: sentAt,
    pduId: requestPdu.id,
    from: browserId,
    to: cdnId ?? originId,
    durationMs: firstLegMs,
    linkId: nearLink,
  });

  if (cdnId) {
    // --- Through the shared cache ------------------------------------------
    const atEdge = round2(sentAt + firstLegMs);
    const edgeCache = state.cdnCache ?? createCache('cdn');
    const edgeLookup = lookupCache(edgeCache, request, atEdge, build.clock);
    const decidedAt = round2(atEdge + CDN_LOOKUP_MS);

    build.events.push({
      kind: 'node-state',
      at: atEdge,
      nodeId: cdnId,
      state: 'processing',
      note: `cache ${edgeLookup.kind}`,
    });

    // A conditional request the *browser* issued is the edge's chance to answer without
    // touching the origin at all -- if what it still holds is what the browser already
    // has. Checked before the plain hit, because sending the whole body to a client that
    // has just told you it already has this exact version would be the wasteful answer.
    const edgeCanConfirm =
      revalidating &&
      edgeLookup.kind === 'hit' &&
      edgeLookup.entry !== undefined &&
      evaluateConditional(request, edgeLookup.entry.response, build.clock).status === 304;

    if (edgeCanConfirm && edgeLookup.entry) {
      // The edge is *generating* this 304 rather than relaying one, so it stamps its own
      // Date (RFC 9110 s6.6.1) and the Age the stored copy has accumulated. Both matter:
      // without them the browser would freshen its entry against the origin's original
      // Date and find it stale again on the very next request.
      const confirmed = notModifiedResponse(edgeLookup.entry.response);
      responseMessage = {
        ...confirmed,
        headers: setHeader(
          setHeader(confirmed.headers, 'Date', dateHeader(decidedAt, build.clock).value),
          'Age',
          `${currentAgeSeconds(edgeLookup.entry, decidedAt, build.clock)}`,
        ),
      };
      cdnOutcome = 'REVALIDATED';
      servedBy = 'cdn';
      note =
        'the edge still held the same version the browser did, and confirmed it with a ' +
        '304 without going back to the origin at all';
    } else if (edgeLookup.kind === 'hit' && edgeLookup.entry) {
      responseMessage = serveFromCache(edgeLookup.entry, decidedAt, {
        shared: true,
        clock: build.clock,
      });
      cdnOutcome = 'HIT';
      servedBy = 'cdn';
      note = `the edge answered: ${edgeLookup.reason}`;
    } else {
      const atOrigin = round2(decidedAt + build.originLatencyMs + requestWireMs);
      build.events.push(
        {
          kind: 'transmit',
          at: decidedAt,
          pduId: requestPdu.id,
          from: cdnId,
          to: originId,
          durationMs: round2(build.originLatencyMs + requestWireMs),
          linkId: farLink,
        },
        {
          kind: 'log',
          at: decidedAt,
          level: 'info',
          text: `cdn ${edgeLookup.kind.toUpperCase()}: ${edgeLookup.reason} -- forwarding to ${originId}`,
        },
      );

      const reply = serveOrigin(origin, request, build.clock, atOrigin);
      const answeredAt = round2(atOrigin + reply.thinkMs);
      const responseWireMs = serializationMs(build, reply.response);

      build.events.push(
        {
          kind: 'node-state',
          at: atOrigin,
          nodeId: originId,
          state: 'processing',
          note: `${init.method} ${path}`,
        },
        {
          kind: 'node-state',
          at: answeredAt,
          nodeId: originId,
          state: reply.response.status >= 400 ? 'error' : 'idle',
        },
      );

      const backAtEdge = round2(answeredAt + build.originLatencyMs + responseWireMs);
      const originPdu = httpPdu(`${init.id}-res-origin`, reply.response, {
        version: build.version,
        secure: build.secure,
        streamId: 1,
      });
      build.pdus[originPdu.id] = originPdu;
      build.events.push(
        { kind: 'pdu-created', at: answeredAt, pdu: originPdu, atNode: originId },
        {
          kind: 'transmit',
          at: answeredAt,
          pduId: originPdu.id,
          from: originId,
          to: cdnId,
          durationMs: round2(build.originLatencyMs + responseWireMs),
          linkId: farLink,
        },
      );

      if (edgeLookup.kind === 'stale' && edgeLookup.entry) {
        const applied = applyRevalidation(edgeCache, {
          entry: edgeLookup.entry,
          request,
          response: reply.response,
          requestedAt: decidedAt,
          receivedAt: backAtEdge,
          now: backAtEdge,
          clock: build.clock,
        });
        state.cdnCache = applied.cache;
        // The edge has just confirmed its copy with the origin. If that copy is also the
        // one the browser asked about, the browser gets a 304 rather than a body it
        // already has -- one revalidation upstream answering a different one downstream.
        responseMessage = revalidating
          ? confirmForClient(request, applied.response, build.clock)
          : applied.response;
        cdnOutcome = applied.outcome;
        note = `${reply.note}; at the edge, ${applied.reason}`;
      } else {
        const stored = storeResponse(edgeCache, {
          request,
          response: reply.response,
          requestedAt: decidedAt,
          receivedAt: backAtEdge,
        });
        state.cdnCache = stored.cache;
        responseMessage = reply.response;
        cdnOutcome = 'MISS';
        note = `${reply.note}; the edge ${stored.stored.storable ? 'stored a copy' : `did not store it (${stored.stored.reason})`}`;
      }
      level = reply.level;
      receivedAt = round2(
        backAtEdge + build.edgeLatencyMs + serializationMs(build, responseMessage),
      );

      const edgePdu = httpPdu(`${init.id}-res`, responseMessage, {
        version: build.version,
        secure: build.secure,
        streamId: 1,
      });
      build.pdus[edgePdu.id] = edgePdu;
      build.events.push(
        { kind: 'pdu-created', at: backAtEdge, pdu: edgePdu, atNode: cdnId },
        {
          kind: 'transmit',
          at: backAtEdge,
          pduId: edgePdu.id,
          from: cdnId,
          to: browserId,
          durationMs: round2(receivedAt - backAtEdge),
          linkId: nearLink,
        },
        { kind: 'node-state', at: backAtEdge, nodeId: cdnId, state: 'idle' },
      );

      return finishExchange(build, state, {
        ...init,
        request,
        responseMessage,
        sentAt,
        receivedAt,
        servedBy,
        browserLookup,
        cdnOutcome,
        cacheReason,
        selection,
        note,
        level,
        crossOrigin,
        pageOrigin,
        withCredentials,
        revalidating,
        path,
        browserId,
      });
    }

    // The edge answered by itself: nothing beyond it ever heard about this request.
    const responseWireMs = serializationMs(build, responseMessage);
    receivedAt = round2(decidedAt + build.edgeLatencyMs + responseWireMs);
    const edgePdu = httpPdu(`${init.id}-res`, responseMessage, {
      version: build.version,
      secure: build.secure,
      streamId: 1,
    });
    build.pdus[edgePdu.id] = edgePdu;
    build.events.push(
      { kind: 'pdu-created', at: decidedAt, pdu: edgePdu, atNode: cdnId },
      {
        kind: 'transmit',
        at: decidedAt,
        pduId: edgePdu.id,
        from: cdnId,
        to: browserId,
        durationMs: round2(receivedAt - decidedAt),
        linkId: nearLink,
      },
      {
        kind: 'annotate',
        at: decidedAt,
        targetId: cdnId,
        text:
          'The origin was never asked. A shared cache serving one stored copy to ' +
          'everybody is the difference between a site that survives being linked to ' +
          'and one that does not.',
        reference: { ...RFC_9111, section: '3' },
      },
      { kind: 'node-state', at: decidedAt, nodeId: cdnId, state: 'idle' },
    );
  } else {
    // --- Straight to the origin --------------------------------------------
    const atOrigin = round2(sentAt + firstLegMs);
    const reply = serveOrigin(origin, request, build.clock, atOrigin);
    const answeredAt = round2(atOrigin + reply.thinkMs);
    const responseWireMs = serializationMs(build, reply.response);

    responseMessage = reply.response;
    note = reply.note;
    level = reply.level;
    receivedAt = round2(answeredAt + build.originLatencyMs + responseWireMs);

    const responsePdu = httpPdu(`${init.id}-res`, responseMessage, {
      version: build.version,
      secure: build.secure,
      streamId: 1,
    });
    build.pdus[responsePdu.id] = responsePdu;

    build.events.push(
      {
        kind: 'node-state',
        at: atOrigin,
        nodeId: originId,
        state: 'processing',
        note: `${init.method} ${path}`,
      },
      { kind: 'pdu-created', at: answeredAt, pdu: responsePdu, atNode: originId },
      {
        kind: 'transmit',
        at: answeredAt,
        pduId: responsePdu.id,
        from: originId,
        to: browserId,
        durationMs: round2(receivedAt - answeredAt),
        linkId: nearLink,
      },
      {
        kind: 'node-state',
        at: answeredAt,
        nodeId: originId,
        state: responseMessage.status >= 400 ? 'error' : 'idle',
      },
    );
  }

  return finishExchange(build, state, {
    ...init,
    request,
    responseMessage,
    sentAt,
    receivedAt,
    servedBy,
    browserLookup,
    cdnOutcome,
    cacheReason,
    selection,
    note,
    level,
    crossOrigin: corsApplies,
    pageOrigin,
    withCredentials,
    revalidating,
    path,
    browserId,
  });
}

/**
 * Everything the client does once the bytes are back: store, freshen, and judge.
 *
 * Split out because it is identical whether the answer came from the edge or from the
 * origin, and because it is where the last of the four state machines -- the jar, the
 * private cache, the redirect rule, and CORS -- gets its turn.
 */
function finishExchange(
  build: Build,
  state: ClientState,
  init: {
    id: string;
    stepId: string;
    hop: number;
    kind: ExchangeKind;
    origin: OriginFixture;
    method: HttpMethod;
    request: HttpRequest;
    responseMessage: HttpResponse;
    sentAt: number;
    receivedAt: number;
    servedBy: ServedBy;
    browserLookup: ReturnType<typeof lookupCache>;
    cdnOutcome: CacheOutcome | undefined;
    cacheReason: string;
    selection: ReturnType<typeof cookiesFor>;
    note: string;
    level: LogLevel;
    crossOrigin: boolean;
    pageOrigin: string | undefined;
    withCredentials: boolean;
    revalidating: boolean;
    path: string;
    browserId: string;
  },
): ExchangeOutcome {
  const host = init.origin.host;
  let response = init.responseMessage;
  let browserOutcome: CacheOutcome;
  let cacheReason: string;

  // --- The private cache, updated -----------------------------------------

  if (init.revalidating && init.browserLookup.entry) {
    const applied = applyRevalidation(state.browserCache, {
      entry: init.browserLookup.entry,
      request: init.request,
      response,
      requestedAt: init.sentAt,
      receivedAt: init.receivedAt,
      now: init.receivedAt,
      clock: build.clock,
    });
    state.browserCache = applied.cache;
    response = applied.response;
    browserOutcome = applied.outcome;
    cacheReason = applied.reason;
  } else {
    const stored = storeResponse(state.browserCache, {
      request: init.request,
      response,
      requestedAt: init.sentAt,
      receivedAt: init.receivedAt,
    });
    state.browserCache = stored.cache;
    browserOutcome = init.servedBy === 'browser-cache' ? 'HIT' : 'MISS';
    cacheReason = stored.stored.storable
      ? `${init.cacheReason}; stored in the browser cache (${stored.stored.reason})`
      : `${init.cacheReason}; not stored (${stored.stored.reason})`;
  }

  // --- The jar ------------------------------------------------------------

  const jarResult = storeSetCookies(state.jar, response.headers, {
    host,
    path: init.path,
    secureChannel: build.secure,
    now: init.receivedAt,
    clock: build.clock,
  });
  state.jar = jarResult.jar;

  for (const result of jarResult.results) {
    build.events.push({
      kind: 'log',
      at: init.receivedAt,
      level: result.accepted ? 'info' : 'warn',
      text: `Set-Cookie ${result.accepted ? 'accepted' : 'rejected'}: ${result.reason}`,
    });
  }
  if (jarResult.results.length > 0) {
    build.events.push({
      kind: 'annotate',
      at: init.receivedAt,
      targetId: init.browserId,
      text: jarResult.results
        .map((result) => `${result.cookie?.name ?? 'cookie'}: ${result.reason}`)
        .join(' '),
      reference: { ...RFC_6265, section: '5.3' },
    });
  }

  // --- CORS, last ---------------------------------------------------------

  const cors = judgeCors(
    init.request,
    response,
    init.crossOrigin ? init.pageOrigin : undefined,
    init.withCredentials,
  );

  build.events.push({
    kind: 'log',
    at: init.receivedAt,
    level: init.level,
    text: `${init.servedBy} -> browser: ${response.status} ${response.reason} (${byteLength(serializeMessage(response))} bytes on the wire) -- ${init.note}`,
  });

  if (!cors.allowed) {
    // The response is here, in the browser, complete. The page is not getting it.
    build.events.push(
      {
        kind: 'drop',
        at: init.receivedAt,
        pduId: `${init.id}-res`,
        atNode: init.browserId,
        reason: `blocked by CORS: ${cors.reason}`,
      },
      {
        kind: 'node-state',
        at: init.receivedAt,
        nodeId: init.browserId,
        state: 'error',
        note: 'CORS',
      },
      {
        kind: 'annotate',
        at: init.receivedAt,
        targetId: init.browserId,
        text:
          `The request was sent. The server ran it and answered ${response.status}. The ` +
          'response arrived here in full -- and the browser then refused to hand it to ' +
          'the page. CORS protects the *reader*, not the server: if that request ' +
          'changed something, it is already changed.',
        reference: FETCH_STANDARD,
      },
      {
        kind: 'node-state',
        at: init.receivedAt + 1,
        nodeId: init.browserId,
        state: 'idle',
      },
    );
  }

  const exchange: HttpExchange = {
    id: init.id,
    stepId: init.stepId,
    hop: init.hop,
    kind: init.kind,
    host,
    request: init.request,
    response,
    sentAt: init.sentAt,
    receivedAt: init.receivedAt,
    servedBy: init.servedBy,
    browserCache: browserOutcome,
    ...(init.cdnOutcome === undefined ? {} : { cdnCache: init.cdnOutcome }),
    cacheReason,
    cookiesSent: init.selection.cookies,
    cookiesExcluded: init.selection.excluded,
    cookiesSet: jarResult.results,
    cors,
    blockedFromPage: !cors.allowed,
    note: init.note,
  };

  return { exchange, endsAt: init.receivedAt };
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/** Resolve a `Location` against the request that produced it. */
export function resolveLocation(
  location: string,
  currentHost: string,
): { host: string; target: string } {
  if (/^https?:\/\//i.test(location)) {
    const withoutScheme = location.replace(/^https?:\/\//i, '');
    const slash = withoutScheme.indexOf('/');
    return slash === -1
      ? { host: withoutScheme, target: '/' }
      : { host: withoutScheme.slice(0, slash), target: withoutScheme.slice(slash) };
  }
  return {
    host: currentHost,
    target: location.startsWith('/') ? location : `/${location}`,
  };
}

interface PhaseDraft {
  readonly id: string;
  readonly at: number;
  readonly title: string;
  readonly description: string;
}

/** How many redirect hops to follow before treating the chain as a loop. */
const DEFAULT_MAX_REDIRECTS = 20;

/**
 * Run one `request` step: the preflight, the request, and any redirects it leads to.
 *
 * Each of those is its own chapter, because each is its own round trip and a learner who
 * merges them has lost the only thing worth knowing about redirect chains -- that they
 * are not free.
 */
function runRequestStep(
  build: Build,
  state: ClientState,
  origins: Map<string, OriginFixture>,
  step: RequestStep,
  startAt: number,
  exchanges: HttpExchange[],
  phases: PhaseDraft[],
): number {
  let at = startAt;
  let host = step.host;
  let method = step.method ?? 'GET';
  let target = step.target;
  let body = step.body;
  let headers: HeaderList = [...DEFAULT_REQUEST_HEADERS, ...(step.headers ?? [])];
  const initiator = step.initiator ?? {};
  const maxRedirects = step.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  let hop = 0;

  for (let follow = 0; follow <= maxRedirects; follow += 1) {
    const origin = origins.get(host);
    if (!origin) {
      throw new Error(
        `scenario step "${step.id}" sends to host "${host}", which is not one of its origins`,
      );
    }

    const pageOrigin = initiator.pageOrigin;
    const crossOrigin =
      pageOrigin !== undefined &&
      pageOrigin !== originOf(host, build.secure) &&
      !(initiator.topLevelNavigation ?? false);

    // --- The preflight, when the request is not simple ---------------------

    const probe = buildRequest({ method, target, version: build.version, headers });
    const asked = nonSafelistedHeaders(probe);
    const cacheKeyForPreflight = preflightKey(`${host}${target}`, method, asked);
    const rememberedUntil = state.preflights.get(cacheKeyForPreflight);
    const preflightRemembered = rememberedUntil !== undefined && rememberedUntil > at;

    if (crossOrigin && !isSimpleCorsRequest(probe) && preflightRemembered) {
      build.events.push({
        kind: 'log',
        at,
        level: 'info',
        text:
          `preflight for ${method} ${target} still remembered until ${rememberedUntil} ms ` +
          '-- no OPTIONS this time',
      });
    }

    if (crossOrigin && !isSimpleCorsRequest(probe) && !preflightRemembered) {
      const preflightHeaders: HeaderList = [
        header('Access-Control-Request-Method', method),
        ...(asked.length > 0
          ? [header('Access-Control-Request-Headers', asked.join(', '))]
          : []),
      ];
      const preflightId = `${step.id}-preflight`;
      phases.push({
        id: preflightId,
        at,
        title: 'CORS preflight',
        description:
          `Before the ${method} is allowed to leave, the browser asks whether it may ` +
          'be sent at all. This is a whole round trip that the page did not ask for and ' +
          'cannot see.',
      });

      const preflight = runExchange(build, state, {
        id: `${step.id}-h${hop}`,
        stepId: step.id,
        hop,
        kind: 'preflight',
        origin,
        method: 'OPTIONS',
        target,
        headers: preflightHeaders,
        initiator: { ...initiator, withCredentials: false },
        reload: false,
        at,
      });
      exchanges.push(preflight.exchange);
      at = preflight.endsAt;
      hop += 1;

      const allowed = preflight.exchange.response.status < 300;
      const maxAge = Number(
        headerValue(preflight.exchange.response.headers, 'Access-Control-Max-Age') ?? '0',
      );
      if (allowed && Number.isFinite(maxAge) && maxAge > 0) {
        state.preflights.set(cacheKeyForPreflight, at + maxAge * 1000);
      }

      build.events.push({
        kind: 'annotate',
        at: preflight.exchange.receivedAt,
        targetId: BROWSER_NODE,
        text: allowed
          ? 'Permission granted, and the real request may now be sent. Note the cost: ' +
            'two round trips for one API call, which is why Access-Control-Max-Age ' +
            'exists and why so few deployments set it.'
          : 'Permission refused, so the real request is never sent at all. This is the ' +
            'one case where CORS does stop a request -- and only because the browser ' +
            'volunteered to ask first.',
        reference: FETCH_STANDARD,
      });

      if (!allowed) return at;
    }

    // --- The request itself ------------------------------------------------

    // Keyed on the redirect count, not on the hop count: a preflight is a hop and is
    // emphatically not a redirect, and a step that had one would otherwise name its own
    // main request `-redirect-0`.
    const phaseId = follow === 0 ? step.id : `${step.id}-redirect-${follow}`;
    phases.push({
      id: phaseId,
      at,
      title: step.title ?? `${method} ${target}`,
      description:
        follow === 0 ? step.intent : `Following the redirect to ${host}${target}.`,
    });

    const outcome = runExchange(build, state, {
      id: `${step.id}-h${hop}`,
      stepId: step.id,
      hop,
      kind: follow === 0 ? 'request' : 'redirect',
      origin,
      method,
      target,
      headers,
      ...(body === undefined ? {} : { body }),
      initiator,
      reload: step.reload ?? false,
      at,
    });
    exchanges.push(outcome.exchange);
    at = outcome.endsAt;
    hop += 1;

    const { response } = outcome.exchange;
    const location = redirectTarget(response);
    const following = step.followRedirects ?? true;

    if (!isRedirect(response.status) || location === undefined || !following) {
      return at;
    }

    const next = resolveLocation(location, host);
    const nextMethod = methodAfterRedirect(method, response.status);

    build.events.push({
      kind: 'annotate',
      at: outcome.exchange.receivedAt,
      targetId: BROWSER_NODE,
      text:
        `${response.status} ${response.reason}: the answer is a forwarding address, not ` +
        `content. The browser now makes a second request, to ${next.host}${next.target}` +
        (nextMethod === method
          ? `, keeping the ${method}.`
          : `, and rewrites the ${method} to a ${nextMethod} -- dropping the body with it. ` +
            'RFC 9110 documents that browsers do this to 301 and 302 rather than ' +
            'pretending otherwise, and 307 and 308 exist precisely so a client that ' +
            'means "keep the method" can say so.'),
      reference: RFC_9110_REDIRECTS,
    });

    host = next.host;
    target = next.target;
    if (nextMethod !== method) {
      method = nextMethod;
      body = undefined;
      headers = headers.filter(
        (field) => !['content-type', 'content-length'].includes(field.name.toLowerCase()),
      );
    }
  }

  throw new Error(`scenario step "${step.id}" exceeded ${maxRedirects} redirects`);
}

/**
 * Run a `compare` step: the same page load over h1, h2 and h3.
 *
 * The three runs go on the timeline **one after another**, as three chapters, rather
 * than racing in three lanes -- because three simultaneous runs would need three
 * browsers and three servers on one diagram, which teaches the wrong thing about what is
 * being compared. The side-by-side race the version view draws reads
 * {@link HttpRun.comparison} instead, where all three start at zero. Same numbers, two
 * presentations, and the sim emits neither of them as pixels.
 */
function runCompareStep(
  build: Build,
  origin: OriginFixture,
  step: CompareStep,
  startAt: number,
  seed: string,
  phases: PhaseDraft[],
): { endsAt: number; comparison: VersionComparison } {
  const comparison = compareVersions({
    resources: step.resources,
    conditions: { ...build.conditions, ...step.conditions },
    seed,
  });

  const browserId = ensureNode(build, {
    id: BROWSER_NODE,
    kind: 'client',
    label: 'Browser',
    detail: { role: 'the user agent, fetching the same page three ways' },
  });
  const originId = ensureNode(build, {
    id: origin.host,
    kind: 'server',
    label: origin.label ?? origin.host,
    ...(origin.ipv4 ? { ipv4: origin.ipv4 } : {}),
    detail: { role: 'simulated origin, speaking all three versions' },
  });
  const linkId = ensureLink(build, browserId, originId, build.originLatencyMs);

  let at = startAt;

  for (const version of ['HTTP/1.1', 'HTTP/2', 'HTTP/3'] as const) {
    const run = comparison.runs[version];
    const profile = VERSION_PROFILES[version];
    const verdict = comparison.verdicts.find((each) => each.version === version);

    phases.push({
      id: `${step.id}-${profile.alias}`,
      at,
      title: `${version} (${profile.alias})`,
      description: `${step.resources.length} resources over ${profile.transport}. ${run.explanation}`,
    });

    build.events.push(
      {
        kind: 'log',
        at,
        level: 'info',
        text: `${profile.alias}: ${run.handshake.explanation}`,
      },
      {
        kind: 'annotate',
        at,
        targetId: originId,
        text: profile.summary,
        reference: profile.rfc,
      },
      {
        kind: 'node-state',
        at,
        nodeId: originId,
        state: 'active',
        note: profile.alias,
      },
    );

    for (const stream of run.streams) {
      const requestAt = round2(at + stream.startedAt);
      const firstByteAt = round2(at + stream.firstByteAt);
      const doneAt = round2(at + stream.completedAt);

      const pdu: PDU = {
        id: `${step.id}-${profile.alias}-${stream.resourceId}`,
        layers: [
          {
            layer: 'transport',
            protocol: profile.transport,
            fields: [
              { name: 'Source Port', value: `${CLIENT_PORT}`, bits: 16 },
              { name: 'Destination Port', value: `${serverPort(true)}`, bits: 16 },
              {
                name: 'Connection',
                value: stream.connectionId,
                note:
                  profile.connectionsPerOrigin === 1
                    ? 'One connection carries everything.'
                    : `One of ${profile.connectionsPerOrigin}: HTTP/1.1 buys concurrency by opening more sockets.`,
              },
            ],
          },
          {
            layer: 'application',
            protocol: version,
            fields: [
              ...(stream.streamId === undefined
                ? []
                : [{ name: 'Stream ID', value: `${stream.streamId}`, bits: 31 }]),
              {
                name: 'Header block',
                value: `${stream.requestHeaderBytesOnWire} of ${stream.requestHeaderBytesRaw} bytes`,
                note:
                  profile.headerCompression === 'none'
                    ? 'Sent in full, every time, on every request.'
                    : `${profile.headerCompression}: indexed against a table both ends keep in step.`,
              },
              { name: 'Blocked', value: `${stream.blockedMs} ms` },
              {
                name: 'Stalled',
                value: `${round2(stream.ownStallMs + stream.holStallMs)} ms`,
              },
            ],
            payloadPreview: `GET ${stream.target}`,
          },
        ],
        sizeBytes: stream.responseBytes + stream.requestHeaderBytesOnWire,
        summary: `${stream.label} (${stream.responseBytes} bytes)`,
      };
      build.pdus[pdu.id] = pdu;

      build.events.push(
        { kind: 'pdu-created', at: requestAt, pdu, atNode: browserId },
        {
          kind: 'transmit',
          at: requestAt,
          pduId: pdu.id,
          from: browserId,
          to: originId,
          durationMs: round2(Math.max(1, firstByteAt - requestAt)),
          linkId,
        },
        {
          kind: 'transmit',
          at: firstByteAt,
          pduId: pdu.id,
          from: originId,
          to: browserId,
          durationMs: round2(Math.max(1, doneAt - firstByteAt)),
          linkId,
        },
      );

      if (stream.blockedMs > 0) {
        build.events.push({
          kind: 'log',
          at: round2(at + stream.queuedAt),
          level: 'warn',
          text: `${profile.alias}: ${stream.label} waited ${stream.blockedMs} ms for a slot -- application-layer head-of-line blocking`,
        });
      }
      for (const stall of stream.stalls) {
        build.events.push(
          {
            kind: 'log',
            at: round2(at + stall.atMs),
            level: stall.kind === 'transport-hol' ? 'error' : 'warn',
            text: `${profile.alias}: ${stream.label} stalled ${stall.ms} ms -- ${stall.explanation}`,
          },
          {
            kind: 'annotate',
            at: round2(at + stall.atMs),
            targetId: pdu.id,
            text: stall.explanation,
            reference:
              stall.kind === 'transport-hol'
                ? { rfc: 9000, section: '2.2', title: 'QUIC: Streams' }
                : profile.rfc,
          },
        );
      }
    }

    const finishedAt = round2(at + run.completedAt);
    build.events.push(
      { kind: 'node-state', at: finishedAt, nodeId: originId, state: 'idle' },
      {
        kind: 'log',
        at: finishedAt,
        level: 'info',
        text: `${profile.alias} finished at ${run.completedAt} ms${
          verdict && verdict.deltaMs > 0
            ? `, ${verdict.deltaMs} ms behind ${comparison.fastest}`
            : ' -- fastest of the three'
        }`,
      },
    );

    at = round2(finishedAt + HTTP_TAIL_MS);
  }

  return { endsAt: at, comparison };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * Sort by time, keeping emission order within one instant.
 *
 * The tie-break matters: a `pdu-created` and the `transmit` referencing it happen at the
 * same virtual millisecond, and the log reads as nonsense the other way round.
 * `Array.prototype.sort` has been required to be stable since ES2019.
 */
function sortEvents(events: readonly SimEvent[]): SimEvent[] {
  return [...events].sort((a, b) => a.at - b.at);
}

/**
 * Run one scenario end to end.
 *
 * The steps share a cookie jar, two caches, a set of open connections and a clock, which
 * is what makes a multi-step scenario more than several runs stapled together: the third
 * request is made by a client that has already learned two things, and the timeline shows
 * exactly what each was worth.
 */
export function runHttpScenario(
  scenario: HttpScenario,
  overrides: HttpScenarioOverrides = {},
): HttpRun {
  const settings = { ...scenario, ...overrides };
  const version = settings.version ?? 'HTTP/1.1';
  const secure = settings.secure ?? false;
  const conditions = withDefaults({ ...settings.conditions, secure });
  const clock = scenario.clock ?? EPOCH_CLOCK;
  const hasCdn = scenario.cdn !== undefined;

  const build: Build = {
    events: [],
    pdus: {},
    nodes: [],
    links: [],
    nodeIds: new Set(),
    linkIds: new Set(),
    version,
    secure,
    conditions,
    clock,
    // With an edge in the picture the round trip splits; without one the browser pays
    // all of it. This is the whole arithmetic of "put it closer to the user".
    edgeLatencyMs: hasCdn ? round2((conditions.rttMs * EDGE_RTT_SHARE) / 2) : 0,
    originLatencyMs: hasCdn
      ? round2((conditions.rttMs * (1 - EDGE_RTT_SHARE)) / 2)
      : round2(conditions.rttMs / 2),
    hasCdn,
    connected: new Set(),
  };

  if (hasCdn && scenario.cdn) {
    ensureNode(build, {
      id: CDN_NODE,
      kind: 'cdn-edge',
      label: scenario.cdn.label,
      ...(scenario.cdn.ipv4 ? { ipv4: scenario.cdn.ipv4 } : {}),
      detail: {
        role: 'shared cache at the edge -- holds one copy for everybody',
        'obeys s-maxage': 'yes, unlike the browser cache',
      },
    });
  }

  const origins = new Map(scenario.origins.map((origin) => [origin.host, origin]));
  const state: ClientState = {
    jar: createJar(),
    browserCache: createCache('browser'),
    cdnCache: hasCdn ? createCache('cdn') : undefined,
    preflights: new Map(),
  };

  const exchanges: HttpExchange[] = [];
  const phases: PhaseDraft[] = [];
  let comparison: VersionComparison | undefined;
  let at = 0;

  for (const step of scenario.steps) {
    at = round2(at + (step.afterMs ?? 0));
    if (step.afterMs !== undefined && step.afterMs > 0) {
      build.events.push({
        kind: 'log',
        at,
        level: 'info',
        text: `${step.afterMs} ms pass with the client idle`,
      });
    }

    if (step.kind === 'compare') {
      const origin = origins.get(step.host) ?? scenario.origins[0];
      const compared = runCompareStep(build, origin, step, at, settings.seed, phases);
      at = compared.endsAt;
      comparison = compared.comparison;
      continue;
    }

    at = runRequestStep(build, state, origins, step, at, exchanges, phases);
  }

  const durationMs = round2(at + HTTP_TAIL_MS);

  for (const phase of phases) {
    build.events.push({
      kind: 'phase',
      at: phase.at,
      id: phase.id,
      title: phase.title,
      description: phase.description,
    });
  }

  // Scenario notes are pinned by phase id, so the phases have to exist before the notes
  // can be placed -- hence one pass to find the boundaries and a second to fold them in.
  const asDeclared = Object.keys(overrides).length === 0;
  const provisional = summarizePhases(sortEvents(build.events), durationMs);
  for (const note of scenario.notes ?? []) {
    const phase = provisional.find((candidate) => candidate.id === note.phase);
    if (!phase) {
      // An override changed the shape of the run, which is what an override is for; a
      // note about a chapter that no longer happens is dropped rather than forced in.
      if (!asDeclared) continue;
      throw new Error(
        `scenario "${scenario.id}" pins a note to phase "${note.phase}", which this run does not have. It has: ${provisional.map((each) => each.id).join(', ')}`,
      );
    }
    build.events.push({
      kind: 'annotate',
      at: phase.startMs,
      targetId: note.target ?? BROWSER_NODE,
      text: note.text,
      ...(note.reference ? { reference: note.reference } : {}),
    });
  }

  const events = sortEvents(build.events);

  return {
    scenario,
    topology: { nodes: build.nodes, links: build.links },
    result: {
      events,
      phases: summarizePhases(events, durationMs),
      durationMs,
      pdus: build.pdus,
    },
    exchanges,
    browserCache: state.browserCache,
    ...(state.cdnCache ? { cdnCache: state.cdnCache } : {}),
    jar: state.jar,
    ...(comparison ? { comparison } : {}),
    cacheViews: {
      browser: describeCache(state.browserCache, durationMs, clock),
      cdn: state.cdnCache ? describeCache(state.cdnCache, durationMs, clock) : [],
    },
  };
}
