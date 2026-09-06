/**
 * Caching -- the arithmetic behind `HIT`, `MISS`, and `REVALIDATED`.
 *
 * An HTTP cache answers exactly one question: *may I reuse this stored response instead
 * of asking the server?* RFC 9111 answers it with two numbers -- the response's
 * **freshness lifetime** and its **current age** -- and one comparison:
 *
 * ```
 * fresh  <=>  freshness_lifetime > current_age
 * ```
 *
 * Both numbers are computed here, from the fields the server actually sent, and both are
 * exposed rather than hidden inside a boolean, because the panel that shows *why* a
 * response was a HIT is worth more than the HIT.
 *
 * ## no-cache is not no-store
 *
 * This is the single most commonly inverted pair of directives in HTTP, so the model
 * makes the difference structural rather than incidental -- see
 * {@link NO_CACHE_VS_NO_STORE}, which the UI renders directly:
 *
 * - **`no-store`** -- do not write this to storage at all. Nothing is kept, so there is
 *   nothing to revalidate later. This is the one for a bank statement.
 * - **`no-cache`** -- **store it**, but do not reuse it without asking the origin first.
 *   The stored copy is the *whole point*: the revalidation usually comes back `304 Not
 *   Modified` with no body, and the cached bytes are served. `no-cache` is a caching
 *   strategy, not the absence of one.
 *
 * A response marked `no-cache` that never changes costs one round trip and zero bytes of
 * content per request. The same response marked `no-store` costs a full download every
 * time. People reach for `no-store` meaning `no-cache` constantly.
 *
 * ## Two caches, not one
 *
 * A response passes through a **private** cache (the browser, holding one user's data)
 * and often a **shared** one (a CDN or proxy, holding everybody's). They obey different
 * rules -- `private` and `s-maxage` exist precisely to tell them apart -- so
 * {@link HttpCache} carries its {@link CacheTier} and every decision consults it. That
 * split is what `CacheStatePanel` draws.
 *
 * ## Time
 *
 * Timestamps are virtual milliseconds on the simulation clock; ages, lifetimes, and
 * every delta-seconds directive are **seconds**, as on the wire. Absolute `Date` and
 * `Expires` fields are converted through {@link HttpClock} in `message.ts`, which is the
 * only place wall-clock time enters the module.
 */

import {
  dateHeaderAt,
  EPOCH_CLOCK,
  formatHttpDate,
  header,
  headerValue,
  pickHeaders,
  removeHeader,
  response,
  setHeader,
  toEpoch,
  type HeaderList,
  type HttpClock,
  type HttpHeader,
  type HttpMethod,
  type HttpRequest,
  type HttpResponse,
} from './message';
import {
  isCacheableByDefault,
  isFinalStatus,
  isHeuristicallyCacheable,
} from './semantics';

// ---------------------------------------------------------------------------
// Cache-Control
// ---------------------------------------------------------------------------

/** One directive exactly as it was written, for the wire view. */
export interface CacheDirective {
  readonly name: string;
  /** `undefined` for a valueless directive such as `no-store`. */
  readonly value?: string;
}

/**
 * A parsed `Cache-Control` field.
 *
 * Every flag defaults to `false` and every delta to `undefined`, so an absent field and
 * an empty one behave identically and no caller has to check which it had.
 */
export interface CacheControl {
  /** The directives in the order they were sent, unparsed. */
  readonly directives: readonly CacheDirective[];
  /** Do not store this at all (RFC 9111 s5.2.2.5). */
  readonly noStore: boolean;
  /** Store it, but revalidate before every reuse (RFC 9111 s5.2.2.4). */
  readonly noCache: boolean;
  /** Qualified `no-cache="Set-Cookie"`: only these fields must be revalidated away. */
  readonly noCacheFields: readonly string[];
  /** Once stale, a cache must not serve it without revalidating (s5.2.2.2). */
  readonly mustRevalidate: boolean;
  /** `must-revalidate` for shared caches only (s5.2.2.8). */
  readonly proxyRevalidate: boolean;
  /** Reject the response rather than store it if the status is not understood (s5.2.2.3). */
  readonly mustUnderstand: boolean;
  /** Any cache may store it, even when it would otherwise not be allowed to (s5.2.2.9). */
  readonly isPublic: boolean;
  /** For one user: a shared cache must not store it (s5.2.2.7). */
  readonly isPrivate: boolean;
  /** Qualified `private="Set-Cookie"`: only these fields are per-user. */
  readonly privateFields: readonly string[];
  /** Freshness lifetime in seconds, for any cache (s5.2.2.1). */
  readonly maxAge?: number;
  /** Freshness lifetime for **shared** caches, overriding `max-age` (s5.2.2.10). */
  readonly sMaxage?: number;
  /** Request only: how stale a response the client will accept (s5.2.1.2). */
  readonly maxStale?: number;
  /** `max-stale` with no value: any staleness at all. */
  readonly maxStaleUnlimited: boolean;
  /** Request only: the response must stay fresh for at least this long (s5.2.1.3). */
  readonly minFresh?: number;
  /** Request only: answer from cache or return 504; do not go to the origin (s5.2.1.7). */
  readonly onlyIfCached: boolean;
  /** No proxy may re-encode the content (s5.2.2.6). */
  readonly noTransform: boolean;
  /** The representation will never change, so do not revalidate on reload (RFC 8246). */
  readonly immutable: boolean;
  /** Serve stale for this long while refreshing in the background (RFC 5861 s3). */
  readonly staleWhileRevalidate?: number;
  /** Serve stale for this long if the origin errors (RFC 5861 s4). */
  readonly staleIfError?: number;
}

/** Every flag off, every delta absent -- what an absent `Cache-Control` means. */
export const EMPTY_CACHE_CONTROL: CacheControl = {
  directives: [],
  noStore: false,
  noCache: false,
  noCacheFields: [],
  mustRevalidate: false,
  proxyRevalidate: false,
  mustUnderstand: false,
  isPublic: false,
  isPrivate: false,
  privateFields: [],
  maxStaleUnlimited: false,
  onlyIfCached: false,
  noTransform: false,
  immutable: false,
};

/** Split on commas that are not inside a quoted-string (RFC 9110 s5.6.4). */
function splitDirectives(value: string): string[] {
  const out: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (quoted) {
      if (char === '\\' && i + 1 < value.length) {
        current += char + value[i + 1];
        i += 1;
        continue;
      }
      if (char === '"') quoted = false;
      current += char;
      continue;
    }
    if (char === '"') {
      quoted = true;
      current += char;
      continue;
    }
    if (char === ',') {
      out.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  out.push(current);
  return out.map((part) => part.trim()).filter((part) => part.length > 0);
}

/** Strip the quotes and the backslash escapes from a quoted-string. */
function unquote(value: string): string {
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) return value;
  return value.slice(1, -1).replace(/\\(.)/g, '$1');
}

/**
 * A `delta-seconds` value: a non-negative integer (RFC 9111 s1.2.2).
 *
 * Anything else -- a negative number, `max-age=none`, a float -- makes the directive
 * invalid, and an invalid directive is treated as if it had not been sent at all
 * (RFC 9111 s5.2). Silently reading it as zero would be worse than ignoring it: zero
 * means "always stale", which is a real instruction the server did not give.
 */
export function parseDeltaSeconds(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const text = unquote(value.trim());
  if (!/^\d+$/.test(text)) return undefined;
  return Number(text);
}

/** Parse a `Cache-Control` field value. Unknown directives are kept but ignored. */
export function parseCacheControl(value: string | undefined): CacheControl {
  if (value === undefined || value.trim() === '') return EMPTY_CACHE_CONTROL;

  const directives: CacheDirective[] = [];
  for (const part of splitDirectives(value)) {
    const equals = part.indexOf('=');
    if (equals === -1) {
      directives.push({ name: part.toLowerCase() });
    } else {
      directives.push({
        name: part.slice(0, equals).trim().toLowerCase(),
        value: part.slice(equals + 1).trim(),
      });
    }
  }

  const find = (name: string) => directives.find((d) => d.name === name);
  const has = (name: string) => find(name) !== undefined;
  const fieldList = (name: string): string[] => {
    const raw = find(name)?.value;
    if (raw === undefined) return [];
    return unquote(raw)
      .split(',')
      .map((field) => field.trim().toLowerCase())
      .filter((field) => field.length > 0);
  };
  const maxStale = find('max-stale');

  return {
    directives,
    noStore: has('no-store'),
    noCache: has('no-cache'),
    noCacheFields: fieldList('no-cache'),
    mustRevalidate: has('must-revalidate'),
    proxyRevalidate: has('proxy-revalidate'),
    mustUnderstand: has('must-understand'),
    isPublic: has('public'),
    isPrivate: has('private'),
    privateFields: fieldList('private'),
    maxAge: parseDeltaSeconds(find('max-age')?.value),
    sMaxage: parseDeltaSeconds(find('s-maxage')?.value),
    maxStale: parseDeltaSeconds(maxStale?.value),
    maxStaleUnlimited: maxStale !== undefined && maxStale.value === undefined,
    minFresh: parseDeltaSeconds(find('min-fresh')?.value),
    onlyIfCached: has('only-if-cached'),
    noTransform: has('no-transform'),
    immutable: has('immutable'),
    staleWhileRevalidate: parseDeltaSeconds(find('stale-while-revalidate')?.value),
    staleIfError: parseDeltaSeconds(find('stale-if-error')?.value),
  };
}

/** The `Cache-Control` of a message, parsed. */
export function cacheControlOf(headers: HeaderList): CacheControl {
  return parseCacheControl(headerValue(headers, 'Cache-Control'));
}

/**
 * The two directives everyone swaps, side by side.
 *
 * Exported as data rather than written into a component so the wording is testable and
 * so the caching panel, the header explainer, and the learning centre cannot drift apart
 * on the one explanation in this module that most needs to be identical everywhere.
 */
export const NO_CACHE_VS_NO_STORE: readonly {
  readonly directive: 'no-cache' | 'no-store';
  readonly stored: boolean;
  readonly reusedWithoutAsking: boolean;
  readonly meaning: string;
  readonly costPerRequest: string;
  readonly useItFor: string;
  readonly misconception: string;
  readonly rfc: string;
}[] = [
  {
    directive: 'no-cache',
    stored: true,
    reusedWithoutAsking: false,
    meaning:
      'Keep the copy, but check with the origin before serving it. Almost every check ' +
      'comes back 304 Not Modified and the stored bytes are served.',
    costPerRequest: 'One round trip. No content, as long as nothing changed.',
    useItFor:
      'Anything that must be current but rarely changes -- an HTML shell, an avatar, ' +
      'a config file.',
    misconception:
      'It does not mean "do not cache". It means "do not reuse without revalidating", ' +
      'and the cache is what makes the revalidation cheap.',
    rfc: 'RFC 9111 s5.2.2.4',
  },
  {
    directive: 'no-store',
    stored: false,
    reusedWithoutAsking: false,
    meaning:
      'Never write it to storage -- not to disk, not to memory, not in the browser and ' +
      'not in any proxy along the way.',
    costPerRequest: 'A full round trip and the entire body, every single time.',
    useItFor:
      'Content that must not survive the response: a bank statement, a password reset ' +
      'page, a one-time token.',
    misconception:
      'Reaching for it to force freshness. It buys nothing over no-cache except the ' +
      'bandwidth of every future response.',
    rfc: 'RFC 9111 s5.2.2.5',
  },
];

// ---------------------------------------------------------------------------
// Entity tags
// ---------------------------------------------------------------------------

/** A parsed `ETag`: an opaque validator, plus whether it is weak (RFC 9110 s8.8.3). */
export interface ETag {
  /** The opaque string between the quotes. Never interpret it. */
  readonly value: string;
  /**
   * Weak tags (`W/"..."`) say two representations are *equivalent*, not identical --
   * same article, differently compressed. Strong tags say byte-for-byte identical, which
   * is what a byte-range request needs before it can stitch a partial download together.
   */
  readonly weak: boolean;
}

/** Parse one entity-tag. Returns `undefined` if it is not a well-formed one. */
export function parseETag(value: string): ETag | undefined {
  const text = value.trim();
  const weak = text.startsWith('W/');
  const quoted = weak ? text.slice(2) : text;
  if (quoted.length < 2 || !quoted.startsWith('"') || !quoted.endsWith('"')) {
    return undefined;
  }
  return { value: quoted.slice(1, -1), weak };
}

/** Render an entity-tag back to its field value. */
export function formatETag(tag: ETag): string {
  return `${tag.weak ? 'W/' : ''}"${tag.value}"`;
}

/** Parse a comma-separated list, as `If-None-Match` and `If-Match` carry. */
export function parseETagList(value: string): ETag[] {
  return splitDirectives(value)
    .map(parseETag)
    .filter((tag): tag is ETag => tag !== undefined);
}

/**
 * Strong comparison: both tags strong, and the opaque values equal (RFC 9110 s8.8.3.2).
 *
 * `If-Match` and `If-Range` use this. A weak tag never matches strongly, not even
 * against itself -- weakness is a statement that byte equality is not being claimed.
 */
export function etagStrongMatch(a: ETag, b: ETag): boolean {
  return !a.weak && !b.weak && a.value === b.value;
}

/**
 * Weak comparison: the opaque values are equal, whatever the weakness flags say.
 *
 * `If-None-Match` uses this (RFC 9110 s13.1.2), which is why a weakly-tagged response
 * still produces a 304: for "has this changed at all?", equivalence is enough.
 */
export function etagWeakMatch(a: ETag, b: ETag): boolean {
  return a.value === b.value;
}

// ---------------------------------------------------------------------------
// The cache
// ---------------------------------------------------------------------------

/** Which of the two caches in the picture this is. */
export type CacheTier =
  /** The browser: private, holds one user's responses. */
  | 'browser'
  /** A CDN or proxy: shared, holds everybody's. */
  | 'cdn';

/** Shared caches obey `s-maxage`, refuse `private`, and are wary of `Authorization`. */
export function isShared(tier: CacheTier): boolean {
  return tier === 'cdn';
}

/** Labels for the cache panel. */
export const CACHE_TIER_LABELS: Readonly<Record<CacheTier, string>> = {
  browser: 'Browser cache (private)',
  cdn: 'CDN cache (shared)',
};

/** What the panel prints against an exchange. */
export type CacheOutcome =
  /** Served from store with no request to the origin at all. */
  | 'HIT'
  /** Nothing usable stored; the origin answered in full. */
  | 'MISS'
  /** A stored copy was checked and confirmed: 304, no body, cached bytes served. */
  | 'REVALIDATED'
  /** The request or response forbade the cache from taking part. */
  | 'BYPASS';

/** One stored response, with everything the freshness arithmetic needs. */
export interface CacheEntry {
  /** `METHOD host target` -- the primary cache key (RFC 9111 s2). */
  readonly key: string;
  readonly method: HttpMethod;
  readonly host: string;
  readonly target: string;
  readonly response: HttpResponse;
  /** Virtual millisecond the cache **sent** the request (RFC 9111 s4.2.3). */
  readonly requestedAt: number;
  /** Virtual millisecond the response **arrived**. */
  readonly receivedAt: number;
  /**
   * The request fields named by `Vary`, as they were on the request that produced this
   * entry. The secondary cache key (RFC 9111 s4.1).
   */
  readonly varyKey: HeaderList;
  /** How many times this entry has been confirmed with a 304. */
  readonly revalidations: number;
}

/** A cache: its tier, and what it currently holds. */
export interface HttpCache {
  readonly tier: CacheTier;
  readonly entries: readonly CacheEntry[];
}

/** An empty cache of one tier. */
export function createCache(tier: CacheTier): HttpCache {
  return { tier, entries: [] };
}

/** The primary cache key for a request (RFC 9111 s2). */
export function cacheKey(method: HttpMethod, host: string, target: string): string {
  return `${method} ${host.toLowerCase()} ${target}`;
}

// ---------------------------------------------------------------------------
// Storability -- RFC 9111 s3
// ---------------------------------------------------------------------------

/** Whether a response may be written to a cache, and why or why not. */
export interface Storability {
  readonly storable: boolean;
  /** A sentence for the panel, phrased for whichever answer it is. */
  readonly reason: string;
}

/**
 * Whether this exchange may be stored by this cache.
 *
 * The list is RFC 9111 s3, in order. Two of the conditions are the ones that surprise
 * people:
 *
 * - **`no-cache` is not here.** A `no-cache` response is perfectly storable; the
 *   directive constrains *reuse*, not storage. Only `no-store` stops the write.
 * - **A shared cache will not store a response to a request with `Authorization`**
 *   (s3.5) unless the response explicitly permits it with `public`, `s-maxage`, or
 *   `must-revalidate`. Without that rule a CDN would happily serve one user's account
 *   page to the next visitor.
 */
export function isStorable(
  cache: HttpCache,
  request: HttpRequest,
  responseMessage: HttpResponse,
): Storability {
  const shared = isShared(cache.tier);
  const requestControl = cacheControlOf(request.headers);
  const responseControl = cacheControlOf(responseMessage.headers);

  if (!isCacheableByDefault(request.method)) {
    return {
      storable: false,
      reason: `${request.method} responses are not cacheable by default`,
    };
  }
  if (!isFinalStatus(responseMessage.status)) {
    return { storable: false, reason: 'interim 1xx responses are never stored' };
  }
  if (requestControl.noStore) {
    return { storable: false, reason: 'the request said Cache-Control: no-store' };
  }
  if (responseControl.noStore) {
    return { storable: false, reason: 'the response said Cache-Control: no-store' };
  }
  if (shared && responseControl.isPrivate && responseControl.privateFields.length === 0) {
    return {
      storable: false,
      reason: 'Cache-Control: private keeps this out of a shared cache',
    };
  }
  if (
    shared &&
    headerValue(request.headers, 'Authorization') !== undefined &&
    !responseControl.isPublic &&
    responseControl.sMaxage === undefined &&
    !responseControl.mustRevalidate
  ) {
    return {
      storable: false,
      reason:
        'the request carried Authorization and the response did not opt back in with ' +
        'public, s-maxage, or must-revalidate (RFC 9111 s3.5)',
    };
  }

  const hasExplicitFreshness =
    responseControl.maxAge !== undefined ||
    (shared && responseControl.sMaxage !== undefined) ||
    headerValue(responseMessage.headers, 'Expires') !== undefined ||
    responseControl.isPublic ||
    (!shared && responseControl.isPrivate);

  if (hasExplicitFreshness) {
    return { storable: true, reason: 'the response carries explicit cache directives' };
  }
  if (isHeuristicallyCacheable(responseMessage.status)) {
    return {
      storable: true,
      reason: `${responseMessage.status} is heuristically cacheable (RFC 9110 s15.1)`,
    };
  }
  return {
    storable: false,
    reason:
      `${responseMessage.status} is not heuristically cacheable and the response gave ` +
      'no explicit freshness information',
  };
}

// ---------------------------------------------------------------------------
// Age -- RFC 9111 s4.2.3
// ---------------------------------------------------------------------------

/** The `Age` field of a response in seconds, or 0 if absent or malformed. */
export function ageHeaderSeconds(headers: HeaderList): number {
  return parseDeltaSeconds(headerValue(headers, 'Age')) ?? 0;
}

/**
 * How old the stored response is, in seconds.
 *
 * Straight from the pseudocode in RFC 9111 s4.2.3, and worth reading once because two of
 * the terms are not obvious:
 *
 * ```
 * apparent_age         = max(0, response_time - date_value)
 * corrected_age_value  = age_value + (response_time - request_time)
 * corrected_initial_age= max(apparent_age, corrected_age_value)
 * current_age          = corrected_initial_age + (now - response_time)
 * ```
 *
 * `apparent_age` is what the clocks say, and it is wrong whenever the two machines
 * disagree. `corrected_age_value` is what the *chain of caches* says by way of the `Age`
 * field, plus the time this request itself spent in flight. Taking the maximum means a
 * skewed clock can make a response look older than it is but never younger -- the safe
 * direction, since the failure mode is one extra revalidation rather than stale data.
 */
export function currentAgeSeconds(
  entry: CacheEntry,
  now: number,
  clock: HttpClock = EPOCH_CLOCK,
): number {
  const ageValue = ageHeaderSeconds(entry.response.headers);
  const dateValue = dateHeaderAt(entry.response.headers, 'Date', clock);

  const apparentAgeMs =
    dateValue === undefined ? 0 : Math.max(0, entry.receivedAt - dateValue);
  const responseDelayMs = Math.max(0, entry.receivedAt - entry.requestedAt);
  const correctedAgeValueMs = ageValue * 1000 + responseDelayMs;
  const correctedInitialAgeMs = Math.max(apparentAgeMs, correctedAgeValueMs);
  const residentTimeMs = Math.max(0, now - entry.receivedAt);

  return Math.floor((correctedInitialAgeMs + residentTimeMs) / 1000);
}

// ---------------------------------------------------------------------------
// Freshness -- RFC 9111 s4.2.1 and s4.2.2
// ---------------------------------------------------------------------------

/** Which rule produced the freshness lifetime. Shown in the panel, because it varies. */
export type FreshnessSource =
  /** `s-maxage`, and this is a shared cache. */
  | 's-maxage'
  /** `max-age`. */
  | 'max-age'
  /** `Expires` minus `Date`. */
  | 'expires'
  /** Nothing explicit: 10% of the time since `Last-Modified`. */
  | 'heuristic'
  /** No basis at all -- lifetime zero, stale from the moment it arrived. */
  | 'none';

/** The fraction of the time since `Last-Modified` a heuristic lifetime uses. */
export const HEURISTIC_FRACTION = 0.1;

/** The ceiling this cache puts on a heuristic lifetime: one day. */
export const HEURISTIC_CAP_SECONDS = 86400;

/** A freshness lifetime and the rule it came from. */
export interface FreshnessLifetime {
  /** Seconds the response may be reused for, counted from when it was generated. */
  readonly seconds: number;
  readonly source: FreshnessSource;
  /** One line naming the rule and the numbers that fed it. */
  readonly explanation: string;
}

/**
 * How long the response may be reused for, in seconds.
 *
 * The precedence is fixed by RFC 9111 s4.2.1 and the order is the whole rule:
 *
 * 1. `s-maxage`, **if this is a shared cache**. A private cache ignores it entirely,
 *    which is how a CDN is told to hold something for an hour while the browser holds it
 *    for a minute.
 * 2. `max-age`.
 * 3. `Expires` minus `Date`. Absolute, so a clock disagreement between the two machines
 *    lands directly in the arithmetic -- which is why `max-age` was introduced and why
 *    it wins.
 * 4. A heuristic (s4.2.2): 10% of the time since `Last-Modified`, capped at a day, and
 *    only for a status that is heuristically cacheable. Something last changed a year
 *    ago is unlikely to change in the next hour.
 * 5. Nothing. Zero, and every request revalidates.
 */
export function freshnessLifetime(
  entry: CacheEntry,
  options: { shared: boolean; clock?: HttpClock },
): FreshnessLifetime {
  const clock = options.clock ?? EPOCH_CLOCK;
  const control = cacheControlOf(entry.response.headers);

  if (options.shared && control.sMaxage !== undefined) {
    return {
      seconds: control.sMaxage,
      source: 's-maxage',
      explanation: `s-maxage=${control.sMaxage} (shared caches only)`,
    };
  }
  if (control.maxAge !== undefined) {
    return {
      seconds: control.maxAge,
      source: 'max-age',
      explanation: `max-age=${control.maxAge}`,
    };
  }

  const expires = dateHeaderAt(entry.response.headers, 'Expires', clock);
  if (expires !== undefined) {
    // With no Date field there is nothing to subtract from, so RFC 9111 s4.2.1 uses the
    // time the response was received instead.
    const dateValue =
      dateHeaderAt(entry.response.headers, 'Date', clock) ?? entry.receivedAt;
    const seconds = Math.max(0, Math.floor((expires - dateValue) / 1000));
    return {
      seconds,
      source: 'expires',
      explanation: `Expires minus Date = ${seconds}s`,
    };
  }

  const lastModified = dateHeaderAt(entry.response.headers, 'Last-Modified', clock);
  if (lastModified !== undefined && isHeuristicallyCacheable(entry.response.status)) {
    const dateValue =
      dateHeaderAt(entry.response.headers, 'Date', clock) ?? entry.receivedAt;
    const sinceChangeSeconds = Math.max(0, Math.floor((dateValue - lastModified) / 1000));
    const seconds = Math.min(
      Math.floor(sinceChangeSeconds * HEURISTIC_FRACTION),
      HEURISTIC_CAP_SECONDS,
    );
    return {
      seconds,
      source: 'heuristic',
      explanation:
        `${Math.round(HEURISTIC_FRACTION * 100)}% of the ${sinceChangeSeconds}s since ` +
        `Last-Modified, capped at ${HEURISTIC_CAP_SECONDS}s`,
    };
  }

  return {
    seconds: 0,
    source: 'none',
    explanation: 'no max-age, no Expires, and nothing to base a heuristic on',
  };
}

/** Everything the panel needs to say why an entry is fresh or stale. */
export interface Freshness {
  /** Seconds, per {@link currentAgeSeconds}. */
  readonly age: number;
  readonly lifetime: FreshnessLifetime;
  /** `lifetime > age`, and nothing else (RFC 9111 s4.2). */
  readonly isFresh: boolean;
  /** Seconds of freshness left; zero once stale. */
  readonly remaining: number;
  /** Seconds past the lifetime; zero while fresh. */
  readonly staleFor: number;
}

/** Compute both numbers and compare them. */
export function evaluateFreshness(
  entry: CacheEntry,
  now: number,
  options: { shared: boolean; clock?: HttpClock },
): Freshness {
  const age = currentAgeSeconds(entry, now, options.clock ?? EPOCH_CLOCK);
  const lifetime = freshnessLifetime(entry, options);
  const isFresh = lifetime.seconds > age;
  return {
    age,
    lifetime,
    isFresh,
    remaining: isFresh ? lifetime.seconds - age : 0,
    staleFor: isFresh ? 0 : age - lifetime.seconds,
  };
}

/**
 * Whether the cache is forbidden from serving this entry once it goes stale.
 *
 * `must-revalidate` (and `proxy-revalidate` in a shared cache) turn a stale entry from
 * "usable in a pinch" into "unusable" -- if the origin cannot be reached, the cache must
 * answer 504 rather than hand over an old copy. That is the right trade for a bank
 * balance and the wrong one for a stylesheet.
 */
export function mustRevalidateWhenStale(entry: CacheEntry, shared: boolean): boolean {
  const control = cacheControlOf(entry.response.headers);
  return control.mustRevalidate || (shared && control.proxyRevalidate);
}

// ---------------------------------------------------------------------------
// Vary -- the secondary cache key, RFC 9111 s4.1
// ---------------------------------------------------------------------------

/** The field names a response's `Vary` lists, lower-cased. `['*']` for `Vary: *`. */
export function varyFieldNames(headers: HeaderList): string[] {
  const raw = headerValue(headers, 'Vary');
  if (raw === undefined) return [];
  return raw
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name.length > 0);
}

/** The selecting request fields to store alongside a response. */
export function selectingHeaders(
  request: HttpRequest,
  responseMessage: HttpResponse,
): HeaderList {
  const names = varyFieldNames(responseMessage.headers);
  if (names.includes('*')) return [];
  return names.map((name) => header(name, headerValue(request.headers, name) ?? ''));
}

/**
 * Whether a stored entry may answer this request.
 *
 * `Vary: Accept-Encoding` means the gzip copy must not be served to a client that cannot
 * decompress it. `Vary: *` means no stored response ever matches -- the server is saying
 * the choice depends on something not in the request at all, so no cache can reproduce
 * the decision.
 */
export function varyMatches(entry: CacheEntry, request: HttpRequest): boolean {
  if (varyFieldNames(entry.response.headers).includes('*')) return false;
  return entry.varyKey.every(
    (stored) => (headerValue(request.headers, stored.name) ?? '') === stored.value,
  );
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/** What a lookup found. */
export type CacheLookupKind =
  /** Fresh and usable: serve it, send nothing. */
  | 'hit'
  /** Stored but not usable as-is: revalidate it. */
  | 'stale'
  /** Nothing stored under this key. */
  | 'miss'
  /** The cache is not allowed to take part in this exchange at all. */
  | 'bypass';

/** The result of asking a cache for a request. */
export interface CacheLookup {
  readonly kind: CacheLookupKind;
  readonly entry?: CacheEntry;
  readonly freshness?: Freshness;
  /** Why -- the sentence the panel shows under the badge. */
  readonly reason: string;
  /**
   * Whether the stale entry could still be served without waiting, under
   * `stale-while-revalidate` (RFC 5861 s3). Only meaningful for `kind: 'stale'`.
   */
  readonly canServeStale: boolean;
}

/**
 * Ask a cache whether it can answer this request.
 *
 * The order matters and follows RFC 9111 s4. Note where `no-cache` lands: an entry
 * carrying it is found, is stored, is often *fresh* -- and is still returned as `stale`,
 * because the directive is about reuse and not about storage. That single branch is the
 * whole no-cache / no-store distinction in code.
 */
export function lookupCache(
  cache: HttpCache,
  request: HttpRequest,
  now: number,
  clock: HttpClock = EPOCH_CLOCK,
): CacheLookup {
  const shared = isShared(cache.tier);
  const requestControl = cacheControlOf(request.headers);

  if (!isCacheableByDefault(request.method)) {
    return {
      kind: 'bypass',
      reason: `${request.method} is not served from cache`,
      canServeStale: false,
    };
  }
  if (requestControl.noStore) {
    return {
      kind: 'bypass',
      reason: 'the request said no-store, so the cache stays out of it',
      canServeStale: false,
    };
  }

  const host = headerValue(request.headers, 'Host') ?? '';
  const key = cacheKey(request.method, host, request.target);
  const entry = cache.entries.find(
    (candidate) => candidate.key === key && varyMatches(candidate, request),
  );

  if (!entry) {
    const shadowed = cache.entries.some((candidate) => candidate.key === key);
    return {
      kind: 'miss',
      reason: shadowed
        ? 'a response is stored for this URI but its Vary fields do not match'
        : 'nothing stored for this URI',
      canServeStale: false,
    };
  }

  const freshness = evaluateFreshness(entry, now, { shared, clock });
  const entryControl = cacheControlOf(entry.response.headers);

  if (requestControl.noCache) {
    return {
      kind: 'stale',
      entry,
      freshness,
      reason: 'the request said no-cache -- a forced revalidation, as on a reload',
      canServeStale: false,
    };
  }
  if (entryControl.noCache) {
    return {
      kind: 'stale',
      entry,
      freshness,
      reason:
        'the stored response says no-cache: it is kept, but never reused without ' +
        'checking with the origin first',
      canServeStale: false,
    };
  }
  if (
    requestControl.minFresh !== undefined &&
    freshness.remaining < requestControl.minFresh
  ) {
    return {
      kind: 'stale',
      entry,
      freshness,
      reason:
        `the client asked for min-fresh=${requestControl.minFresh}s and only ` +
        `${freshness.remaining}s of freshness are left`,
      canServeStale: false,
    };
  }
  if (freshness.isFresh) {
    return {
      kind: 'hit',
      entry,
      freshness,
      reason: `fresh: ${freshness.lifetime.explanation}, age ${freshness.age}s`,
      canServeStale: false,
    };
  }

  // Stale, but a client may explicitly accept it (RFC 9111 s5.2.1.2).
  const acceptsStale =
    requestControl.maxStaleUnlimited ||
    (requestControl.maxStale !== undefined &&
      freshness.staleFor <= requestControl.maxStale);
  if (acceptsStale && !mustRevalidateWhenStale(entry, shared)) {
    return {
      kind: 'hit',
      entry,
      freshness,
      reason: `stale by ${freshness.staleFor}s, and the request sent max-stale`,
      canServeStale: true,
    };
  }

  const staleWindow = entryControl.staleWhileRevalidate ?? 0;
  return {
    kind: 'stale',
    entry,
    freshness,
    reason:
      `stale by ${freshness.staleFor}s (${freshness.lifetime.explanation}, age ` +
      `${freshness.age}s)`,
    canServeStale:
      staleWindow > freshness.staleFor && !mustRevalidateWhenStale(entry, shared),
  };
}

// ---------------------------------------------------------------------------
// Serving
// ---------------------------------------------------------------------------

/**
 * The response a cache hands back, stamped with the `Age` it has accumulated.
 *
 * RFC 9111 s5.1 requires the field on anything served from store. It is also the only
 * visible difference between a cached response and a fresh one, which makes it the
 * field to look at when a page will not update.
 */
export function serveFromCache(
  entry: CacheEntry,
  now: number,
  options: { shared: boolean; clock?: HttpClock },
): HttpResponse {
  const age = currentAgeSeconds(entry, now, options.clock ?? EPOCH_CLOCK);
  return {
    ...entry.response,
    headers: setHeader(entry.response.headers, 'Age', `${age}`),
  };
}

// ---------------------------------------------------------------------------
// Storing
// ---------------------------------------------------------------------------

/** Write a response into the cache, replacing any entry with the same key. */
export function storeResponse(
  cache: HttpCache,
  init: {
    request: HttpRequest;
    response: HttpResponse;
    requestedAt: number;
    receivedAt: number;
  },
): { cache: HttpCache; stored: Storability } {
  const stored = isStorable(cache, init.request, init.response);
  if (!stored.storable) return { cache, stored };

  const host = headerValue(init.request.headers, 'Host') ?? '';
  const entry: CacheEntry = {
    key: cacheKey(init.request.method, host, init.request.target),
    method: init.request.method,
    host,
    target: init.request.target,
    response: init.response,
    requestedAt: init.requestedAt,
    receivedAt: init.receivedAt,
    varyKey: selectingHeaders(init.request, init.response),
    revalidations: 0,
  };

  const index = cache.entries.findIndex(
    (existing) => existing.key === entry.key && varyMatches(existing, init.request),
  );
  const entries =
    index === -1
      ? [...cache.entries, entry]
      : cache.entries.map((existing, i) => (i === index ? entry : existing));

  return { cache: { ...cache, entries }, stored };
}

/** Drop an entry, as a 200 to a revalidation or an unsafe request must (s4.4). */
export function invalidate(cache: HttpCache, key: string): HttpCache {
  const entries = cache.entries.filter((entry) => entry.key !== key);
  return entries.length === cache.entries.length ? cache : { ...cache, entries };
}

// ---------------------------------------------------------------------------
// Conditional requests -- RFC 9110 s13
// ---------------------------------------------------------------------------

/**
 * The validators to attach to a revalidation request.
 *
 * `If-None-Match` from the stored `ETag`, `If-Modified-Since` from the stored
 * `Last-Modified`, and **both** when both are stored (RFC 9111 s4.3.1) -- the server
 * picks whichever it can evaluate. An entity tag is the stronger of the two, because
 * `Last-Modified` has one-second resolution and a file rewritten twice in the same
 * second looks unchanged.
 */
export function conditionalHeaders(entry: CacheEntry): HeaderList {
  const out: HttpHeader[] = [];
  const etag = headerValue(entry.response.headers, 'ETag');
  if (etag !== undefined) out.push(header('If-None-Match', etag));
  const lastModified = headerValue(entry.response.headers, 'Last-Modified');
  if (lastModified !== undefined) out.push(header('If-Modified-Since', lastModified));
  return out;
}

/** A revalidation request: the original, plus the validators. */
export function revalidationRequest(entry: CacheEntry, base: HttpRequest): HttpRequest {
  return { ...base, headers: [...base.headers, ...conditionalHeaders(entry)] };
}

/** What a server decided a conditional request should get. */
export interface ConditionalVerdict {
  /** 200 to send the representation, 304 to confirm the client's copy, 412 to refuse. */
  readonly status: 200 | 304 | 412;
  /** Which precondition decided it, and how. */
  readonly reason: string;
}

/**
 * Evaluate the preconditions on a request against the current representation.
 *
 * The precedence is RFC 9110 s13.2.2 and it is not negotiable: `If-Match`, then
 * `If-Unmodified-Since`, then `If-None-Match`, then `If-Modified-Since`. In particular
 * **`If-Modified-Since` is only consulted when `If-None-Match` is absent** -- a client
 * that sends both gets a decision made on the entity tag alone, because the tag is
 * exact and the date is a heuristic.
 *
 * The two families do different jobs, and the status codes say which:
 *
 * - `If-None-Match` / `If-Modified-Since` are for **caching**. Failure is a 304: good
 *   news, your copy is current.
 * - `If-Match` / `If-Unmodified-Since` are for **writes**. Failure is a 412: someone
 *   changed it since you read it, so your update would have clobbered theirs.
 */
export function evaluateConditional(
  request: HttpRequest,
  current: HttpResponse,
  clock: HttpClock = EPOCH_CLOCK,
): ConditionalVerdict {
  const currentTagRaw = headerValue(current.headers, 'ETag');
  const currentTag = currentTagRaw === undefined ? undefined : parseETag(currentTagRaw);
  const lastModified = dateHeaderAt(current.headers, 'Last-Modified', clock);
  const isRead = request.method === 'GET' || request.method === 'HEAD';

  const ifMatch = headerValue(request.headers, 'If-Match');
  if (ifMatch !== undefined) {
    const matched =
      ifMatch.trim() === '*'
        ? currentTag !== undefined
        : currentTag !== undefined &&
          parseETagList(ifMatch).some((tag) => etagStrongMatch(tag, currentTag));
    if (!matched) {
      return { status: 412, reason: 'If-Match did not match the current entity tag' };
    }
  }

  const ifUnmodifiedSince = dateHeaderAt(request.headers, 'If-Unmodified-Since', clock);
  if (ifMatch === undefined && ifUnmodifiedSince !== undefined) {
    if (lastModified !== undefined && lastModified > ifUnmodifiedSince) {
      return {
        status: 412,
        reason: 'the representation changed after If-Unmodified-Since',
      };
    }
  }

  const ifNoneMatch = headerValue(request.headers, 'If-None-Match');
  if (ifNoneMatch !== undefined) {
    const matched =
      ifNoneMatch.trim() === '*'
        ? currentTag !== undefined
        : currentTag !== undefined &&
          parseETagList(ifNoneMatch).some((tag) => etagWeakMatch(tag, currentTag));
    if (matched) {
      return isRead
        ? {
            status: 304,
            reason: `If-None-Match matched ${currentTagRaw} -- the copy is still current`,
          }
        : { status: 412, reason: 'If-None-Match matched on a state-changing request' };
    }
    return { status: 200, reason: 'If-None-Match did not match: the resource changed' };
  }

  const ifModifiedSince = dateHeaderAt(request.headers, 'If-Modified-Since', clock);
  if (ifModifiedSince !== undefined && isRead) {
    if (lastModified !== undefined && lastModified <= ifModifiedSince) {
      return {
        status: 304,
        reason: 'not modified since the date the client held',
      };
    }
    return { status: 200, reason: 'modified since the date the client held' };
  }

  return { status: 200, reason: 'no preconditions to evaluate' };
}

/**
 * The header fields a 304 is allowed to carry (RFC 9110 s15.4.5).
 *
 * A 304 sends the fields that would have gone with a 200 and that might have changed --
 * so the cache can update what it holds -- and nothing else. `Content-Length` in
 * particular must not appear, because there is no content for it to describe.
 */
export const NOT_MODIFIED_HEADERS: readonly string[] = [
  'Cache-Control',
  'Content-Location',
  'Date',
  'ETag',
  'Expires',
  'Vary',
];

/**
 * Build the 304.
 *
 * **No body, ever** -- that is the entire saving, and it is why a conditional request is
 * worth a round trip. The status also forbids content structurally
 * (`forbidsContent` in `semantics.ts`), so a 304 with a body is not something this
 * module can produce.
 */
export function notModifiedResponse(current: HttpResponse): HttpResponse {
  return response({
    status: 304,
    reason: 'Not Modified',
    version: current.version,
    headers: pickHeaders(current.headers, NOT_MODIFIED_HEADERS),
  });
}

/**
 * Update a stored entry from a 304 (RFC 9111 s4.3.4, "freshening a stored response").
 *
 * The 304's fields overwrite the stored ones -- a new `Date` and a new `Cache-Control`
 * are exactly how a revalidation buys another `max-age` -- and the stored **body is
 * kept**, because the 304 did not send one. Content fields on the 304 are ignored, since
 * they would describe a body that does not exist.
 *
 * The timestamps are reset to this exchange, which is what makes the entry young again:
 * the age arithmetic in {@link currentAgeSeconds} counts from `receivedAt`.
 */
export function freshenEntry(
  entry: CacheEntry,
  notModified: HttpResponse,
  init: { requestedAt: number; receivedAt: number },
): CacheEntry {
  let headers = entry.response.headers;
  for (const field of notModified.headers) {
    if (field.name.toLowerCase().startsWith('content-')) continue;
    headers = setHeader(headers, field.name, field.value);
  }
  // Any Age the stored copy carried belongs to the old exchange, not this one.
  headers = removeHeader(headers, 'Age');

  return {
    ...entry,
    response: { ...entry.response, headers },
    requestedAt: init.requestedAt,
    receivedAt: init.receivedAt,
    revalidations: entry.revalidations + 1,
  };
}

// ---------------------------------------------------------------------------
// Revalidation
// ---------------------------------------------------------------------------

/** What a revalidation did, and what the cache holds afterwards. */
export interface RevalidationResult {
  readonly cache: HttpCache;
  readonly outcome: CacheOutcome;
  /** What the client is given. */
  readonly response: HttpResponse;
  readonly reason: string;
}

/**
 * Apply what the origin said about a stale entry.
 *
 * Two paths, and the difference between them is the point of conditional requests:
 *
 * - **304** -- the stored entry is freshened and its *stored body* is served. The
 *   outcome is `REVALIDATED`, and no content crossed the network.
 * - **anything else** -- the stored entry is replaced by whatever came back. The outcome
 *   is `MISS`, because the client is being given bytes off the wire.
 */
export function applyRevalidation(
  cache: HttpCache,
  init: {
    entry: CacheEntry;
    request: HttpRequest;
    response: HttpResponse;
    requestedAt: number;
    receivedAt: number;
    now: number;
    clock?: HttpClock;
  },
): RevalidationResult {
  const clock = init.clock ?? EPOCH_CLOCK;

  if (init.response.status === 304) {
    const freshened = freshenEntry(init.entry, init.response, {
      requestedAt: init.requestedAt,
      receivedAt: init.receivedAt,
    });
    const entries = cache.entries.map((existing) =>
      existing.key === freshened.key ? freshened : existing,
    );
    return {
      cache: { ...cache, entries },
      outcome: 'REVALIDATED',
      response: serveFromCache(freshened, init.now, {
        shared: isShared(cache.tier),
        clock,
      }),
      reason: 'the origin confirmed the stored copy with a 304 and sent no content',
    };
  }

  const replaced = storeResponse(invalidate(cache, init.entry.key), {
    request: init.request,
    response: init.response,
    requestedAt: init.requestedAt,
    receivedAt: init.receivedAt,
  });
  return {
    cache: replaced.cache,
    outcome: 'MISS',
    response: init.response,
    reason: `the origin sent a new ${init.response.status}, replacing the stored copy`,
  };
}

// ---------------------------------------------------------------------------
// Panel helpers
// ---------------------------------------------------------------------------

/** A `Date` field for a virtual millisecond, so scenarios do not format dates by hand. */
export function dateHeader(
  virtualMs: number,
  clock: HttpClock = EPOCH_CLOCK,
): HttpHeader {
  return header('Date', formatHttpDate(toEpoch(clock, virtualMs)));
}

/** One row of the cache panel. */
export interface CacheEntryView {
  readonly key: string;
  readonly status: number;
  readonly freshness: Freshness;
  readonly revalidations: number;
  /** `fresh for 42s` or `stale by 8s`. */
  readonly label: string;
}

/** The cache as the panel draws it, at a moment on the timeline. */
export function describeCache(
  cache: HttpCache,
  now: number,
  clock: HttpClock = EPOCH_CLOCK,
): CacheEntryView[] {
  const shared = isShared(cache.tier);
  return cache.entries.map((entry) => {
    const freshness = evaluateFreshness(entry, now, { shared, clock });
    return {
      key: entry.key,
      status: entry.response.status,
      freshness,
      revalidations: entry.revalidations,
      label: freshness.isFresh
        ? `fresh for ${freshness.remaining}s`
        : `stale by ${freshness.staleFor}s`,
    };
  });
}
