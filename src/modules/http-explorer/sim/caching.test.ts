import { describe, expect, it } from 'vitest';

import {
  header,
  headerValue,
  request,
  response,
  type HeaderList,
  type HttpRequest,
  type HttpResponse,
} from './message';
import {
  applyRevalidation,
  cacheControlOf,
  cacheKey,
  conditionalHeaders,
  createCache,
  currentAgeSeconds,
  dateHeader,
  describeCache,
  etagStrongMatch,
  etagWeakMatch,
  evaluateConditional,
  evaluateFreshness,
  formatETag,
  freshenEntry,
  freshnessLifetime,
  HEURISTIC_CAP_SECONDS,
  isStorable,
  lookupCache,
  mustRevalidateWhenStale,
  NO_CACHE_VS_NO_STORE,
  notModifiedResponse,
  parseCacheControl,
  parseDeltaSeconds,
  parseETag,
  parseETagList,
  selectingHeaders,
  serveFromCache,
  storeResponse,
  varyFieldNames,
  varyMatches,
  type CacheEntry,
  type HttpCache,
} from './caching';

const HOST = 'example.com';
const SECOND = 1000;

function get(target = '/', headers: HeaderList = []): HttpRequest {
  return request({
    method: 'GET',
    target,
    headers: [header('Host', HOST), ...headers],
  });
}

function ok200(headers: HeaderList = [], body = 'hello'): HttpResponse {
  return response({ status: 200, reason: 'OK', headers, body });
}

/** A stored entry built by hand, for the arithmetic that does not need a whole cache. */
function entryOf(
  stored: HttpResponse,
  times: { requestedAt?: number; receivedAt?: number } = {},
): CacheEntry {
  return {
    key: cacheKey('GET', HOST, '/'),
    method: 'GET',
    host: HOST,
    target: '/',
    response: stored,
    requestedAt: times.requestedAt ?? 0,
    receivedAt: times.receivedAt ?? 0,
    varyKey: [],
    revalidations: 0,
  };
}

/** Store one exchange in a cache of the given tier and hand back both. */
function cacheWith(
  stored: HttpResponse,
  options: {
    tier?: 'browser' | 'cdn';
    request?: HttpRequest;
    requestedAt?: number;
    receivedAt?: number;
  } = {},
): HttpCache {
  const result = storeResponse(createCache(options.tier ?? 'browser'), {
    request: options.request ?? get(),
    response: stored,
    requestedAt: options.requestedAt ?? 0,
    receivedAt: options.receivedAt ?? 0,
  });
  return result.cache;
}

// ---------------------------------------------------------------------------

describe('parsing Cache-Control', () => {
  it('reads flags and deltas, and keeps the directives in wire order', () => {
    const control = parseCacheControl('public, max-age=600, s-maxage=3600');
    expect(control.isPublic).toBe(true);
    expect(control.maxAge).toBe(600);
    expect(control.sMaxage).toBe(3600);
    expect(control.directives.map((d) => d.name)).toEqual([
      'public',
      'max-age',
      's-maxage',
    ]);
  });

  it('splits on commas outside quoted strings only', () => {
    const control = parseCacheControl('no-cache="Set-Cookie, X-Token", max-age=0');
    expect(control.noCache).toBe(true);
    expect(control.noCacheFields).toEqual(['set-cookie', 'x-token']);
    expect(control.maxAge).toBe(0);
  });

  it('treats an invalid delta-seconds as absent, never as zero', () => {
    expect(parseCacheControl('max-age=abc').maxAge).toBeUndefined();
    expect(parseCacheControl('max-age=-5').maxAge).toBeUndefined();
    expect(parseCacheControl('max-age=1.5').maxAge).toBeUndefined();
    expect(parseCacheControl('max-age=0').maxAge).toBe(0);
    expect(parseDeltaSeconds(undefined)).toBeUndefined();
    expect(parseDeltaSeconds('"30"')).toBe(30);
  });

  it('distinguishes max-stale with a value from max-stale without one', () => {
    expect(parseCacheControl('max-stale').maxStaleUnlimited).toBe(true);
    expect(parseCacheControl('max-stale=60')).toMatchObject({
      maxStale: 60,
      maxStaleUnlimited: false,
    });
  });

  it('keeps directives it does not understand, so the wire view can show them', () => {
    const control = parseCacheControl('max-age=60, x-future-directive=7');
    expect(control.directives).toContainEqual({
      name: 'x-future-directive',
      value: '7',
    });
  });

  it('reads the extension directives too', () => {
    const control = parseCacheControl(
      'max-age=60, immutable, stale-while-revalidate=30, stale-if-error=600',
    );
    expect(control.immutable).toBe(true);
    expect(control.staleWhileRevalidate).toBe(30);
    expect(control.staleIfError).toBe(600);
  });

  it('turns an absent field into all-false, all-absent', () => {
    const control = cacheControlOf([]);
    expect(control.noCache).toBe(false);
    expect(control.noStore).toBe(false);
    expect(control.maxAge).toBeUndefined();
  });
});

describe('no-cache is not no-store', () => {
  it('documents both directives, and only no-cache keeps a stored copy', () => {
    const noCache = NO_CACHE_VS_NO_STORE.find((e) => e.directive === 'no-cache');
    const noStore = NO_CACHE_VS_NO_STORE.find((e) => e.directive === 'no-store');
    expect(noCache?.stored).toBe(true);
    expect(noStore?.stored).toBe(false);
    expect(noCache?.reusedWithoutAsking).toBe(false);
    expect(noStore?.reusedWithoutAsking).toBe(false);
  });

  it('stores a no-cache response -- the directive constrains reuse, not storage', () => {
    const stored = ok200([header('Cache-Control', 'no-cache'), dateHeader(0)]);
    const verdict = isStorable(createCache('browser'), get(), stored);
    expect(verdict.storable).toBe(true);
  });

  it('refuses to store a no-store response at all', () => {
    const stored = ok200([header('Cache-Control', 'no-store')]);
    const verdict = isStorable(createCache('browser'), get(), stored);
    expect(verdict.storable).toBe(false);
    expect(verdict.reason).toContain('no-store');
    expect(cacheWith(stored).entries).toHaveLength(0);
  });

  it('revalidates a stored no-cache response even while it is still fresh', () => {
    const cache = cacheWith(
      ok200([header('Cache-Control', 'no-cache, max-age=600'), dateHeader(0)]),
    );
    const found = lookupCache(cache, get(), 10 * SECOND);

    expect(found.freshness?.isFresh).toBe(true);
    expect(found.kind).toBe('stale');
    expect(found.reason).toContain('no-cache');
  });

  it('lets a client force revalidation with no-cache on the request', () => {
    const cache = cacheWith(
      ok200([header('Cache-Control', 'max-age=600'), dateHeader(0)]),
    );
    const found = lookupCache(
      cache,
      get('/', [header('Cache-Control', 'no-cache')]),
      SECOND,
    );
    expect(found.kind).toBe('stale');
    expect(found.reason).toContain('reload');
  });
});

describe('current age (RFC 9111 s4.2.3)', () => {
  it('counts the time resident in the cache', () => {
    const entry = entryOf(ok200());
    expect(currentAgeSeconds(entry, 5 * SECOND)).toBe(5);
  });

  it('adds the Age the response already carried, plus this request time in flight', () => {
    const entry = entryOf(ok200([header('Age', '10')]), {
      requestedAt: 0,
      receivedAt: 2 * SECOND,
    });
    // corrected_age_value = 10s (Age) + 2s (response delay), resident time 0.
    expect(currentAgeSeconds(entry, 2 * SECOND)).toBe(12);
    expect(currentAgeSeconds(entry, 5 * SECOND)).toBe(15);
  });

  it('uses the apparent age when the Date says the response is older than the Age does', () => {
    // Generated at t=0, arrived at t=4s, with no Age field to say why.
    const entry = entryOf(ok200([dateHeader(0)]), {
      requestedAt: 4 * SECOND,
      receivedAt: 4 * SECOND,
    });
    expect(currentAgeSeconds(entry, 4 * SECOND)).toBe(4);
  });

  it('never lets clock skew make a response look younger than it is', () => {
    // A Date in the future would give a negative apparent age; it is floored at zero.
    const entry = entryOf(ok200([dateHeader(60 * SECOND)]), { receivedAt: 0 });
    expect(currentAgeSeconds(entry, 0)).toBe(0);
    expect(currentAgeSeconds(entry, 10 * SECOND)).toBe(10);
  });
});

describe('freshness lifetime (RFC 9111 s4.2.1)', () => {
  const shared = { shared: true };
  const priv = { shared: false };

  it('prefers s-maxage in a shared cache and ignores it in a private one', () => {
    const entry = entryOf(
      ok200([header('Cache-Control', 'max-age=60, s-maxage=3600'), dateHeader(0)]),
    );
    expect(freshnessLifetime(entry, shared)).toMatchObject({
      seconds: 3600,
      source: 's-maxage',
    });
    expect(freshnessLifetime(entry, priv)).toMatchObject({
      seconds: 60,
      source: 'max-age',
    });
  });

  it('falls back to max-age', () => {
    const entry = entryOf(ok200([header('Cache-Control', 'max-age=120'), dateHeader(0)]));
    expect(freshnessLifetime(entry, priv)).toMatchObject({
      seconds: 120,
      source: 'max-age',
    });
  });

  it('subtracts Date from Expires when there is no max-age', () => {
    const entry = entryOf(
      ok200([dateHeader(0), header('Expires', dateHeader(300 * SECOND).value)]),
    );
    expect(freshnessLifetime(entry, priv)).toMatchObject({
      seconds: 300,
      source: 'expires',
    });
  });

  it('uses the arrival time when Expires has no Date to subtract from', () => {
    const entry = entryOf(ok200([header('Expires', dateHeader(300 * SECOND).value)]), {
      receivedAt: 100 * SECOND,
    });
    expect(freshnessLifetime(entry, priv)).toMatchObject({
      seconds: 200,
      source: 'expires',
    });
  });

  it('never returns a negative lifetime for an Expires already in the past', () => {
    const entry = entryOf(
      ok200([dateHeader(500 * SECOND), header('Expires', dateHeader(0).value)]),
    );
    expect(freshnessLifetime(entry, priv).seconds).toBe(0);
  });

  it('applies the 10% heuristic to the time since Last-Modified', () => {
    const entry = entryOf(
      ok200([dateHeader(1000 * SECOND), header('Last-Modified', dateHeader(0).value)]),
    );
    expect(freshnessLifetime(entry, priv)).toMatchObject({
      seconds: 100,
      source: 'heuristic',
    });
  });

  it('caps the heuristic at a day', () => {
    const entry = entryOf(
      ok200([
        dateHeader(10_000_000 * SECOND),
        header('Last-Modified', dateHeader(0).value),
      ]),
    );
    expect(freshnessLifetime(entry, priv)).toMatchObject({
      seconds: HEURISTIC_CAP_SECONDS,
      source: 'heuristic',
    });
  });

  it('applies no heuristic to a status that is not heuristically cacheable', () => {
    const found = response({
      status: 302,
      reason: 'Found',
      headers: [dateHeader(1000 * SECOND), header('Last-Modified', dateHeader(0).value)],
    });
    expect(freshnessLifetime(entryOf(found), priv)).toMatchObject({
      seconds: 0,
      source: 'none',
    });
  });

  it('gives a lifetime of zero when the response said nothing at all', () => {
    expect(freshnessLifetime(entryOf(ok200([dateHeader(0)])), priv)).toMatchObject({
      seconds: 0,
      source: 'none',
    });
  });
});

describe('fresh or stale', () => {
  const entry = entryOf(ok200([header('Cache-Control', 'max-age=10'), dateHeader(0)]));

  it('is fresh while the lifetime is strictly greater than the age', () => {
    expect(evaluateFreshness(entry, 9 * SECOND, { shared: false })).toMatchObject({
      age: 9,
      isFresh: true,
      remaining: 1,
      staleFor: 0,
    });
  });

  it('goes stale the moment the age reaches the lifetime, not after it', () => {
    expect(evaluateFreshness(entry, 10 * SECOND, { shared: false })).toMatchObject({
      age: 10,
      isFresh: false,
      remaining: 0,
      staleFor: 0,
    });
  });

  it('counts how far past the lifetime it has gone', () => {
    expect(evaluateFreshness(entry, 25 * SECOND, { shared: false }).staleFor).toBe(15);
  });

  it('reports must-revalidate, and proxy-revalidate only in a shared cache', () => {
    const strict = entryOf(
      ok200([header('Cache-Control', 'max-age=1, must-revalidate')]),
    );
    const proxyOnly = entryOf(
      ok200([header('Cache-Control', 'max-age=1, proxy-revalidate')]),
    );
    expect(mustRevalidateWhenStale(strict, false)).toBe(true);
    expect(mustRevalidateWhenStale(proxyOnly, false)).toBe(false);
    expect(mustRevalidateWhenStale(proxyOnly, true)).toBe(true);
  });
});

describe('storability (RFC 9111 s3)', () => {
  const browser = createCache('browser');
  const cdn = createCache('cdn');

  it('stores a GET 200 with explicit freshness', () => {
    expect(
      isStorable(browser, get(), ok200([header('Cache-Control', 'max-age=60')])).storable,
    ).toBe(true);
  });

  it('does not store a response to POST', () => {
    const post = request({
      method: 'POST',
      target: '/',
      headers: [header('Host', HOST)],
      body: 'x',
    });
    const verdict = isStorable(
      browser,
      post,
      ok200([header('Cache-Control', 'max-age=60')]),
    );
    expect(verdict.storable).toBe(false);
    expect(verdict.reason).toContain('POST');
  });

  it('does not store an interim 1xx', () => {
    expect(
      isStorable(browser, get(), response({ status: 100, reason: 'Continue' })).storable,
    ).toBe(false);
  });

  it('honours no-store on the request as well as on the response', () => {
    const noStoreRequest = get('/', [header('Cache-Control', 'no-store')]);
    expect(
      isStorable(browser, noStoreRequest, ok200([header('Cache-Control', 'max-age=60')]))
        .storable,
    ).toBe(false);
  });

  it('keeps a private response out of a shared cache but not out of the browser', () => {
    const stored = ok200([header('Cache-Control', 'private, max-age=60')]);
    expect(isStorable(cdn, get(), stored).storable).toBe(false);
    expect(isStorable(browser, get(), stored).storable).toBe(true);
  });

  it('keeps an authorized request out of a shared cache unless the response opts in', () => {
    const authorized = get('/', [header('Authorization', 'Bearer token')]);
    const plain = ok200([header('Cache-Control', 'max-age=60')]);
    expect(isStorable(cdn, authorized, plain).storable).toBe(false);
    expect(isStorable(browser, authorized, plain).storable).toBe(true);

    for (const directive of ['public, max-age=60', 's-maxage=60', 'must-revalidate']) {
      const optedIn = ok200([header('Cache-Control', directive)]);
      expect(isStorable(cdn, authorized, optedIn).storable).toBe(true);
    }
  });

  it('stores a heuristically cacheable status with no directives at all', () => {
    const notFound = response({
      status: 404,
      reason: 'Not Found',
      headers: [dateHeader(0), header('Last-Modified', dateHeader(0).value)],
    });
    expect(isStorable(browser, get(), notFound).storable).toBe(true);
  });

  it('refuses a status that is neither heuristically cacheable nor explicit', () => {
    const found = response({ status: 302, reason: 'Found', headers: [dateHeader(0)] });
    const verdict = isStorable(browser, get(), found);
    expect(verdict.storable).toBe(false);
    expect(verdict.reason).toContain('302');
  });
});

describe('lookup', () => {
  it('hits a fresh entry with the reason spelled out', () => {
    const cache = cacheWith(
      ok200([header('Cache-Control', 'max-age=60'), dateHeader(0)]),
    );
    const found = lookupCache(cache, get(), 10 * SECOND);
    expect(found.kind).toBe('hit');
    expect(found.reason).toContain('max-age=60');
    expect(found.freshness?.remaining).toBe(50);
  });

  it('goes stale once the lifetime is up', () => {
    const cache = cacheWith(
      ok200([header('Cache-Control', 'max-age=60'), dateHeader(0)]),
    );
    expect(lookupCache(cache, get(), 90 * SECOND).kind).toBe('stale');
  });

  it('misses when nothing is stored for the URI', () => {
    const cache = cacheWith(ok200([header('Cache-Control', 'max-age=60')]));
    const found = lookupCache(cache, get('/other'), 0);
    expect(found.kind).toBe('miss');
    expect(found.entry).toBeUndefined();
  });

  it('bypasses entirely for a method that is not served from cache', () => {
    const cache = cacheWith(ok200([header('Cache-Control', 'max-age=60')]));
    const put = request({ method: 'PUT', target: '/', headers: [header('Host', HOST)] });
    expect(lookupCache(cache, put, 0).kind).toBe('bypass');
  });

  it('bypasses when the request itself said no-store', () => {
    const cache = cacheWith(ok200([header('Cache-Control', 'max-age=60')]));
    const found = lookupCache(cache, get('/', [header('Cache-Control', 'no-store')]), 0);
    expect(found.kind).toBe('bypass');
  });

  it('serves a stale entry when the client sent max-stale', () => {
    const cache = cacheWith(
      ok200([header('Cache-Control', 'max-age=10'), dateHeader(0)]),
    );
    const found = lookupCache(
      cache,
      get('/', [header('Cache-Control', 'max-stale=60')]),
      30 * SECOND,
    );
    expect(found.kind).toBe('hit');
    expect(found.canServeStale).toBe(true);
  });

  it('refuses max-stale on an entry marked must-revalidate', () => {
    const cache = cacheWith(
      ok200([header('Cache-Control', 'max-age=10, must-revalidate'), dateHeader(0)]),
    );
    const found = lookupCache(
      cache,
      get('/', [header('Cache-Control', 'max-stale')]),
      30 * SECOND,
    );
    expect(found.kind).toBe('stale');
    expect(found.canServeStale).toBe(false);
  });

  it('revalidates early when the client asked for min-fresh', () => {
    const cache = cacheWith(
      ok200([header('Cache-Control', 'max-age=60'), dateHeader(0)]),
    );
    const found = lookupCache(
      cache,
      get('/', [header('Cache-Control', 'min-fresh=30')]),
      45 * SECOND,
    );
    expect(found.kind).toBe('stale');
    expect(found.reason).toContain('min-fresh');
  });

  it('allows a stale entry to be served under stale-while-revalidate', () => {
    const cache = cacheWith(
      ok200([
        header('Cache-Control', 'max-age=10, stale-while-revalidate=60'),
        dateHeader(0),
      ]),
    );
    const found = lookupCache(cache, get(), 30 * SECOND);
    expect(found.kind).toBe('stale');
    expect(found.canServeStale).toBe(true);
  });
});

describe('Vary -- the secondary cache key', () => {
  const varied = ok200([
    header('Cache-Control', 'max-age=600'),
    header('Vary', 'Accept-Encoding'),
    dateHeader(0),
  ]);
  const gzip = get('/', [header('Accept-Encoding', 'gzip')]);
  const identity = get('/', [header('Accept-Encoding', 'identity')]);

  it('lists the selecting field names', () => {
    expect(varyFieldNames(varied.headers)).toEqual(['accept-encoding']);
    expect(selectingHeaders(gzip, varied)).toEqual([header('accept-encoding', 'gzip')]);
  });

  it('serves the entry only to a request whose selecting fields match', () => {
    const cache = cacheWith(varied, { request: gzip });
    expect(lookupCache(cache, gzip, SECOND).kind).toBe('hit');

    const missed = lookupCache(cache, identity, SECOND);
    expect(missed.kind).toBe('miss');
    expect(missed.reason).toContain('Vary');
  });

  it('never matches a response that said Vary: *', () => {
    const anything = ok200([
      header('Cache-Control', 'max-age=600'),
      header('Vary', '*'),
      dateHeader(0),
    ]);
    const cache = cacheWith(anything);
    expect(varyMatches(cache.entries[0], get())).toBe(false);
    expect(lookupCache(cache, get(), SECOND).kind).toBe('miss');
  });
});

describe('entity tags', () => {
  it('parses strong and weak tags and rejects anything unquoted', () => {
    expect(parseETag('"v1"')).toEqual({ value: 'v1', weak: false });
    expect(parseETag('W/"v1"')).toEqual({ value: 'v1', weak: true });
    expect(parseETag('v1')).toBeUndefined();
    expect(formatETag({ value: 'v1', weak: true })).toBe('W/"v1"');
  });

  it('parses a comma-separated list', () => {
    expect(parseETagList('"a", W/"b"')).toEqual([
      { value: 'a', weak: false },
      { value: 'b', weak: true },
    ]);
  });

  it('matches weakly on value alone and strongly only when both tags are strong', () => {
    const strong = { value: 'v1', weak: false };
    const weak = { value: 'v1', weak: true };
    expect(etagWeakMatch(strong, weak)).toBe(true);
    expect(etagStrongMatch(strong, strong)).toBe(true);
    expect(etagStrongMatch(strong, weak)).toBe(false);
    expect(etagStrongMatch(weak, weak)).toBe(false);
  });
});

describe('conditional requests (RFC 9110 s13)', () => {
  const current = ok200([
    header('ETag', '"v2"'),
    header('Last-Modified', dateHeader(0).value),
  ]);

  it('returns 304 when If-None-Match matches', () => {
    const verdict = evaluateConditional(
      get('/', [header('If-None-Match', '"v2"')]),
      current,
    );
    expect(verdict.status).toBe(304);
  });

  it('uses weak comparison for If-None-Match, so W/ still confirms the copy', () => {
    const verdict = evaluateConditional(
      get('/', [header('If-None-Match', 'W/"v2"')]),
      current,
    );
    expect(verdict.status).toBe(304);
  });

  it('returns 200 when the tag no longer matches', () => {
    const verdict = evaluateConditional(
      get('/', [header('If-None-Match', '"v1"')]),
      current,
    );
    expect(verdict.status).toBe(200);
    expect(verdict.reason).toContain('changed');
  });

  it('does not consult If-Modified-Since when If-None-Match is present', () => {
    // The date says "unchanged" and would give a 304; the tag says changed and wins.
    const verdict = evaluateConditional(
      get('/', [
        header('If-None-Match', '"v1"'),
        header('If-Modified-Since', dateHeader(500 * SECOND).value),
      ]),
      current,
    );
    expect(verdict.status).toBe(200);
  });

  it('falls back to If-Modified-Since when there is no entity tag to compare', () => {
    const dated = ok200([header('Last-Modified', dateHeader(100 * SECOND).value)]);
    expect(
      evaluateConditional(
        get('/', [header('If-Modified-Since', dateHeader(100 * SECOND).value)]),
        dated,
      ).status,
    ).toBe(304);
    expect(
      evaluateConditional(
        get('/', [header('If-Modified-Since', dateHeader(50 * SECOND).value)]),
        dated,
      ).status,
    ).toBe(200);
  });

  it('answers 412 rather than 304 when a matching If-None-Match arrives on a write', () => {
    const put = request({
      method: 'PUT',
      target: '/',
      headers: [header('Host', HOST), header('If-None-Match', '*')],
      body: 'x',
    });
    expect(evaluateConditional(put, current).status).toBe(412);
  });

  it('uses strong comparison for If-Match, so a weak tag never satisfies it', () => {
    expect(
      evaluateConditional(get('/', [header('If-Match', '"v2"')]), current).status,
    ).toBe(200);
    expect(
      evaluateConditional(get('/', [header('If-Match', 'W/"v2"')]), current).status,
    ).toBe(412);
    expect(
      evaluateConditional(get('/', [header('If-Match', '"v1"')]), current).status,
    ).toBe(412);
  });

  it('fails If-Unmodified-Since when the resource changed after the given date', () => {
    const changed = ok200([header('Last-Modified', dateHeader(500 * SECOND).value)]);
    expect(
      evaluateConditional(
        get('/', [header('If-Unmodified-Since', dateHeader(100 * SECOND).value)]),
        changed,
      ).status,
    ).toBe(412);
  });

  it('returns 200 when there are no preconditions at all', () => {
    expect(evaluateConditional(get(), current).status).toBe(200);
  });
});

describe('the 304 path', () => {
  const stored = ok200(
    [
      header('Cache-Control', 'max-age=10'),
      header('ETag', '"v1"'),
      header('Last-Modified', dateHeader(0).value),
      header('Content-Type', 'text/html'),
      dateHeader(0),
    ],
    '<h1>hello</h1>',
  );

  it('sends both validators when both were stored', () => {
    expect(conditionalHeaders(entryOf(stored))).toEqual([
      header('If-None-Match', '"v1"'),
      header('If-Modified-Since', dateHeader(0).value),
    ]);
  });

  it('builds a 304 with no body and only the fields a 304 may carry', () => {
    const notModified = notModifiedResponse(stored);
    expect(notModified.status).toBe(304);
    expect(notModified.body).toBeUndefined();
    expect(notModified.headers.map((f) => f.name)).toEqual([
      'Cache-Control',
      'ETag',
      'Date',
    ]);
    expect(headerValue(notModified.headers, 'Content-Type')).toBeUndefined();
    expect(headerValue(notModified.headers, 'Content-Length')).toBeUndefined();
  });

  it('freshens the entry from the 304 while keeping the stored body', () => {
    const entry = entryOf(stored);
    const notModified = response({
      status: 304,
      reason: 'Not Modified',
      headers: [dateHeader(20 * SECOND), header('Cache-Control', 'max-age=600')],
    });

    const freshened = freshenEntry(entry, notModified, {
      requestedAt: 20 * SECOND,
      receivedAt: 20 * SECOND,
    });

    expect(freshened.response.body).toBe('<h1>hello</h1>');
    expect(headerValue(freshened.response.headers, 'Cache-Control')).toBe('max-age=600');
    expect(freshened.revalidations).toBe(1);
    expect(evaluateFreshness(freshened, 20 * SECOND, { shared: false })).toMatchObject({
      age: 0,
      isFresh: true,
    });
  });

  it('drops the stale Age field, which belonged to the previous exchange', () => {
    const entry = entryOf(
      ok200([header('Age', '300'), header('Cache-Control', 'max-age=60')]),
    );
    const freshened = freshenEntry(
      entry,
      response({ status: 304, reason: 'Not Modified', headers: [dateHeader(0)] }),
      { requestedAt: 0, receivedAt: 0 },
    );
    expect(headerValue(freshened.response.headers, 'Age')).toBeUndefined();
    expect(currentAgeSeconds(freshened, 0)).toBe(0);
  });

  it('walks the whole conditional exchange: 200, stale, 304, REVALIDATED', () => {
    // 1. The first request is a miss and the response is stored.
    const first = storeResponse(createCache('browser'), {
      request: get(),
      response: stored,
      requestedAt: 0,
      receivedAt: 0,
    });
    expect(first.stored.storable).toBe(true);

    // 2. Twenty seconds later the ten-second lifetime is gone.
    const found = lookupCache(first.cache, get(), 20 * SECOND);
    expect(found.kind).toBe('stale');

    // 3. The cache revalidates and the origin confirms the copy.
    const revalidation = conditionalHeaders(found.entry!);
    expect(revalidation).toContainEqual(header('If-None-Match', '"v1"'));

    const verdict = evaluateConditional(get('/', revalidation), stored);
    expect(verdict.status).toBe(304);

    const notModified = notModifiedResponse(stored);
    const result = applyRevalidation(first.cache, {
      entry: found.entry!,
      request: get(),
      response: notModified,
      requestedAt: 20 * SECOND,
      receivedAt: 20 * SECOND,
      now: 20 * SECOND,
    });

    // 4. No content crossed the wire, and the client still gets the body.
    expect(notModified.body).toBeUndefined();
    expect(result.outcome).toBe('REVALIDATED');
    expect(result.response.body).toBe('<h1>hello</h1>');
    expect(result.cache.entries[0].revalidations).toBe(1);
  });

  it('replaces the entry and reports a MISS when the origin sends a new 200', () => {
    const cache = cacheWith(stored);
    const replacement = ok200(
      [
        header('Cache-Control', 'max-age=10'),
        header('ETag', '"v2"'),
        dateHeader(20 * SECOND),
      ],
      'new body',
    );

    const result = applyRevalidation(cache, {
      entry: cache.entries[0],
      request: get(),
      response: replacement,
      requestedAt: 20 * SECOND,
      receivedAt: 20 * SECOND,
      now: 20 * SECOND,
    });

    expect(result.outcome).toBe('MISS');
    expect(result.response.body).toBe('new body');
    expect(result.cache.entries).toHaveLength(1);
    expect(headerValue(result.cache.entries[0].response.headers, 'ETag')).toBe('"v2"');
  });
});

describe('serving and describing', () => {
  it('stamps the Age it has accumulated onto anything served from store', () => {
    const cache = cacheWith(
      ok200([header('Cache-Control', 'max-age=600'), dateHeader(0)]),
    );
    const served = serveFromCache(cache.entries[0], 42 * SECOND, { shared: false });
    expect(headerValue(served.headers, 'Age')).toBe('42');
    expect(served.body).toBe('hello');
  });

  it('replaces an existing entry rather than growing the cache', () => {
    const first = cacheWith(ok200([header('Cache-Control', 'max-age=60')]));
    const second = storeResponse(first, {
      request: get(),
      response: ok200([header('Cache-Control', 'max-age=60')], 'again'),
      requestedAt: SECOND,
      receivedAt: SECOND,
    });
    expect(second.cache.entries).toHaveLength(1);
    expect(second.cache.entries[0].response.body).toBe('again');
  });

  it('describes each entry as fresh-for or stale-by, for the cache panel', () => {
    const cache = cacheWith(
      ok200([header('Cache-Control', 'max-age=60'), dateHeader(0)]),
    );
    expect(describeCache(cache, 10 * SECOND)[0]).toMatchObject({
      status: 200,
      revalidations: 0,
      label: 'fresh for 50s',
    });
    expect(describeCache(cache, 100 * SECOND)[0].label).toBe('stale by 40s');
  });

  it('keys on method, host, and target together', () => {
    expect(cacheKey('GET', 'EXAMPLE.com', '/a')).toBe('GET example.com /a');
    expect(cacheKey('GET', HOST, '/a')).not.toBe(cacheKey('HEAD', HOST, '/a'));
  });
});

describe('the browser and CDN caches are separate', () => {
  const stored = ok200([
    header('Cache-Control', 'max-age=60, s-maxage=3600'),
    dateHeader(0),
  ]);

  it('gives the same response different lifetimes in each tier', () => {
    const browser = cacheWith(stored, { tier: 'browser' });
    const cdn = cacheWith(stored, { tier: 'cdn' });

    // Ten minutes in: the browser copy is long stale, the CDN copy is still fresh.
    expect(lookupCache(browser, get(), 600 * SECOND).kind).toBe('stale');
    expect(lookupCache(cdn, get(), 600 * SECOND).kind).toBe('hit');
  });
});
