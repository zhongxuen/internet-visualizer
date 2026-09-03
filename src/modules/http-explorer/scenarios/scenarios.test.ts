/**
 * The seven scenarios, and the properties they must all hold.
 *
 * The determinism test is the one everything else rests on. A run that came out slightly
 * different each time could not be linked to, screenshotted, diffed, or described in a
 * sentence a second reader would recognise -- and an HTTP run has more places for that to
 * go wrong quietly than most: dates formatted from a clock, ages counted from "now",
 * and packet loss drawn from a generator are all things that would drift. So every
 * scenario is run twice and then ten times, and compared whole.
 *
 * The rest divides in two. First the properties every scenario shares: a coherent
 * topology, phases that tile the timeline, causally ordered events, an RFC citation on
 * every note that makes a claim, no citation of the obsolete 723x series, and not one
 * address that could belong to a real host. Then one section per scenario for the
 * specific thing it exists to teach -- because a suite that only checked the shared
 * invariants would pass just as happily on seven copies of the same GET.
 */

import { describe, expect, it } from 'vitest';

import { classifyIp, ip } from '@/core/net/address';
import type { SimEvent } from '@/core/types/events';

import {
  BROWSER_NODE,
  CDN_NODE,
  isSimpleCorsRequest,
  resolveLocation,
  runHttpScenario,
  type HttpExchange,
  type HttpRun,
  type HttpScenario,
} from '../sim/exchange';
import { headerValue, serializeMessage } from '../sim/message';

import {
  CONDITIONAL_REQUEST,
  COOKIE_SESSION,
  CORS_PREFLIGHT,
  DEFAULT_HTTP_SCENARIO_ID,
  HTTP2_MULTIPLEXING,
  HTTP_SCENARIOS,
  POST_FORM,
  REDIRECT_CHAIN,
  SIMPLE_GET,
  getHttpScenario,
} from './index';

const CASES = HTTP_SCENARIOS.map((scenario) => [scenario.id, scenario] as const);

function eventsOfKind<K extends SimEvent['kind']>(
  run: HttpRun,
  kind: K,
): Extract<SimEvent, { kind: K }>[] {
  return run.result.events.filter(
    (event): event is Extract<SimEvent, { kind: K }> => event.kind === kind,
  );
}

/** The exchange for one phase, by step id and hop. */
function exchangeAt(run: HttpRun, stepId: string, hop = 0): HttpExchange {
  const found = run.exchanges.find(
    (exchange) => exchange.stepId === stepId && exchange.hop === hop,
  );
  if (!found) {
    throw new Error(
      `no exchange for ${stepId} hop ${hop}; run has ${run.exchanges
        .map((each) => `${each.stepId}#${each.hop}`)
        .join(', ')}`,
    );
  }
  return found;
}

// ---------------------------------------------------------------------------
// Determinism -- the property everything else depends on
// ---------------------------------------------------------------------------

describe.each(CASES)('%s is deterministic', (_id, scenario: HttpScenario) => {
  it('produces a deep-equal run the second time', () => {
    expect(runHttpScenario(scenario)).toEqual(runHttpScenario(scenario));
  });

  it('produces a deep-equal run the tenth time', () => {
    // Not redundant: a generator whose state leaked into module scope would agree with
    // itself once and drift after that, which two runs cannot catch.
    const first = runHttpScenario(scenario);
    for (let attempt = 0; attempt < 9; attempt += 1) {
      expect(runHttpScenario(scenario)).toEqual(first);
    }
  });

  it('formats its dates from the scenario clock, not from the machine clock', () => {
    // The strongest available check that nothing calls Date.now(): every Date field a run
    // produces has to be identical across runs, and a wall-clock read would differ by
    // whole seconds between them once the suite is slow enough.
    const dates = (run: HttpRun) =>
      run.exchanges.map((exchange) => headerValue(exchange.response.headers, 'Date'));
    expect(dates(runHttpScenario(scenario))).toEqual(dates(runHttpScenario(scenario)));
  });
});

it('a different seed changes the version comparison and nothing else does', () => {
  const base = runHttpScenario(HTTP2_MULTIPLEXING);
  const reseeded = runHttpScenario(HTTP2_MULTIPLEXING, { seed: 'http:h2-different' });
  expect(reseeded.comparison?.losses).not.toEqual(base.comparison?.losses);
  // The seed is the only source of randomness in the whole module, so a scenario without
  // a comparison step cannot be affected by it at all.
  expect(runHttpScenario(SIMPLE_GET, { seed: 'anything-else' })).toEqual(
    runHttpScenario(SIMPLE_GET),
  );
});

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

describe('the catalogue', () => {
  it('has seven scenarios with unique ids, and can find each by id', () => {
    expect(HTTP_SCENARIOS).toHaveLength(7);
    const ids = HTTP_SCENARIOS.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const scenario of HTTP_SCENARIOS) {
      expect(getHttpScenario(scenario.id)).toBe(scenario);
    }
    expect(getHttpScenario('no-such-scenario')).toBeUndefined();
  });

  it('opens on a scenario it actually has', () => {
    expect(getHttpScenario(DEFAULT_HTTP_SCENARIO_ID)).toBeDefined();
  });

  it.each(CASES)('%s says what it teaches', (_id, scenario: HttpScenario) => {
    expect(scenario.title.length).toBeGreaterThan(0);
    expect(scenario.summary.length).toBeGreaterThan(40);
    expect(scenario.teaches.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Shared invariants
// ---------------------------------------------------------------------------

describe.each(CASES)('%s holds the shared invariants', (_id, scenario: HttpScenario) => {
  const run = runHttpScenario(scenario);

  it('links only nodes it has, with unique ids', () => {
    const ids = new Set(run.topology.nodes.map((node) => node.id));
    expect(ids.size).toBe(run.topology.nodes.length);
    for (const link of run.topology.links) {
      expect(ids).toContain(link.from);
      expect(ids).toContain(link.to);
    }
    expect(ids).toContain(BROWSER_NODE);
  });

  it('uses only addresses reserved for documentation', () => {
    // Nothing here is ever contacted, and the addresses are chosen so that this would
    // still be true if something one day tried.
    for (const node of run.topology.nodes) {
      if (node.ipv4) expect(classifyIp(ip(node.ipv4))).toBe('documentation');
      if (node.ipv6) expect(classifyIp(ip(node.ipv6))).toBe('documentation');
    }
  });

  it('emits events in non-decreasing time, all within the run', () => {
    let previous = -Infinity;
    for (const event of run.result.events) {
      expect(event.at).toBeGreaterThanOrEqual(previous);
      expect(event.at).toBeLessThanOrEqual(run.result.durationMs);
      previous = event.at;
    }
  });

  it('has phases that tile the timeline without gaps or overlaps', () => {
    expect(run.result.phases.length).toBeGreaterThan(0);
    run.result.phases.forEach((phase, index) => {
      expect(phase.index).toBe(index);
      expect(phase.endMs).toBeGreaterThan(phase.startMs);
      const next = run.result.phases[index + 1];
      if (next) expect(phase.endMs).toBe(next.startMs);
    });
    const last = run.result.phases[run.result.phases.length - 1];
    expect(last.endMs).toBe(run.result.durationMs);
  });

  it('transmits only PDUs it created, over links it has', () => {
    const linkIds = new Set(run.topology.links.map((link) => link.id));
    for (const event of eventsOfKind(run, 'transmit')) {
      expect(run.result.pdus).toHaveProperty(event.pduId);
      expect(linkIds).toContain(event.linkId);
      expect(event.durationMs).toBeGreaterThan(0);
    }
  });

  it('cites RFC 9110-9114 and never the obsolete 723x series', () => {
    const cited = [
      ...eventsOfKind(run, 'annotate')
        .map((event) => event.reference)
        .filter((reference) => reference !== undefined),
      ...(scenario.notes ?? [])
        .map((note) => note.reference)
        .filter((reference) => reference !== undefined),
    ];
    expect(cited.length).toBeGreaterThan(0);
    for (const reference of cited) {
      // RFC 7230-7235 were obsoleted by 9110-9114 in June 2022. Citing them is the most
      // common way an HTTP explanation dates itself.
      expect(reference.rfc >= 7230 && reference.rfc <= 7235).toBe(false);
      expect(reference.title.length).toBeGreaterThan(0);
    }
  });

  it('pins every note to a phase that exists, and cites it', () => {
    const phaseIds = new Set(run.result.phases.map((phase) => phase.id));
    for (const note of scenario.notes ?? []) {
      expect(phaseIds).toContain(note.phase);
      expect(note.text.length).toBeGreaterThan(60);
      expect(note.reference).toBeDefined();
    }
  });

  it('throws rather than silently dropping a note pinned to a phase it does not have', () => {
    expect(() =>
      runHttpScenario({
        ...scenario,
        notes: [
          { phase: 'no-such-phase', text: 'x', reference: { rfc: 9110, title: 't' } },
        ],
      }),
    ).toThrow(/no-such-phase/);
  });

  it('keeps every exchange causally ordered', () => {
    for (const exchange of run.exchanges) {
      expect(exchange.receivedAt).toBeGreaterThan(exchange.sentAt);
      expect(exchange.receivedAt).toBeLessThanOrEqual(run.result.durationMs);
      expect(exchange.response.status).toBeGreaterThanOrEqual(100);
    }
  });
});

// ---------------------------------------------------------------------------
// 1. simple-get -- the blank line
// ---------------------------------------------------------------------------

describe('simple-get', () => {
  const run = runHttpScenario(SIMPLE_GET);
  const exchange = exchangeAt(run, 'get-index');

  it('serializes the request with CRLF and a blank line before the body', () => {
    const wire = serializeMessage(exchange.request);
    expect(wire).toMatch(/^GET \/index\.html HTTP\/1\.1\r\n/);
    // The blank line: a CRLF immediately following the CRLF that ended the last field.
    expect(wire).toContain('\r\n\r\n');
    expect(wire).not.toMatch(/(^|[^\r])\n/);
  });

  it('sends Host, which is what makes name-based virtual hosting possible', () => {
    expect(headerValue(exchange.request.headers, 'Host')).toBe('example.com');
  });

  it('announces a Content-Length equal to the bytes actually sent', () => {
    const declared = Number(headerValue(exchange.response.headers, 'Content-Length'));
    expect(declared).toBe(new TextEncoder().encode(exchange.response.body ?? '').length);
  });

  it('gets a 200 from the origin with nothing cached', () => {
    expect(exchange.response.status).toBe(200);
    expect(exchange.servedBy).toBe('origin');
    expect(exchange.browserCache).toBe('MISS');
  });
});

// ---------------------------------------------------------------------------
// 2. post-form -- a body, and a method that promises less
// ---------------------------------------------------------------------------

describe('post-form', () => {
  const run = runHttpScenario(POST_FORM);
  const post = exchangeAt(run, 'post-newsletter');
  const rejected = exchangeAt(run, 'get-newsletter');

  it('puts the body after the blank line, described by two fields', () => {
    const wire = serializeMessage(post.request);
    const [head, body] = wire.split('\r\n\r\n');
    expect(head).toContain('Content-Type: application/x-www-form-urlencoded');
    expect(body).toBe(post.request.body);
    expect(Number(headerValue(post.request.headers, 'Content-Length'))).toBe(body.length);
  });

  it('is answered 201 with a Location naming what was created', () => {
    expect(post.response.status).toBe(201);
    expect(headerValue(post.response.headers, 'Location')).toMatch(/^\/newsletter\//);
  });

  it('does not store the response to a POST, and does store the 405', () => {
    // Two facts, and the second one surprises people. A POST response is not cacheable
    // by default, so the 201 is not written down. A 405 *is* heuristically cacheable
    // (RFC 9110 s15.1) -- "this method does not apply here" is a durable fact about the
    // resource, and caching it saves asking again.
    expect(post.cacheReason).toMatch(/not cacheable by default/);
    expect(run.browserCache.entries.map((entry) => entry.response.status)).toEqual([405]);
  });

  it('refuses the wrong method with 405 and an Allow field that names the right one', () => {
    expect(rejected.response.status).toBe(405);
    expect(headerValue(rejected.response.headers, 'Allow')).toBe('POST');
  });
});

// ---------------------------------------------------------------------------
// 3. redirect-chain -- three requests for one page
// ---------------------------------------------------------------------------

describe('redirect-chain', () => {
  const run = runHttpScenario(REDIRECT_CHAIN);

  it('costs three requests to fetch one page', () => {
    const chain = run.exchanges.filter((exchange) => exchange.stepId === 'follow-link');
    expect(chain.map((exchange) => exchange.response.status)).toEqual([301, 302, 200]);
    expect(chain.map((exchange) => exchange.kind)).toEqual([
      'request',
      'redirect',
      'redirect',
    ]);
  });

  it('changes host on the first hop, which costs a second connection', () => {
    expect(exchangeAt(run, 'follow-link', 0).host).toBe('example.com');
    expect(exchangeAt(run, 'follow-link', 1).host).toBe('www.example.com');
  });

  it('rewrites POST to GET on a 303, and drops the body with it', () => {
    const post = exchangeAt(run, 'post-comment', 0);
    const followed = exchangeAt(run, 'post-comment', 1);
    expect(post.request.method).toBe('POST');
    expect(post.response.status).toBe(303);

    expect(followed.request.method).toBe('GET');
    expect(followed.request.body).toBeUndefined();
    // The fields that described the body go with it; leaving them would announce content
    // that is not there.
    expect(headerValue(followed.request.headers, 'Content-Type')).toBeUndefined();
    expect(headerValue(followed.request.headers, 'Content-Length')).toBeUndefined();
  });

  it('caches the permanent redirect and refuses to cache the temporary one', () => {
    const keys = run.browserCache.entries.map((entry) => entry.key);
    expect(keys.some((key) => key.includes('example.com /old-post'))).toBe(true);
    expect(keys.some((key) => key.includes('www.example.com /old-post'))).toBe(false);
  });

  it('stops on the redirect when a step says not to follow', () => {
    const stopped = runHttpScenario({
      ...REDIRECT_CHAIN,
      notes: [],
      steps: [
        {
          ...REDIRECT_CHAIN.steps[0],
          kind: 'request',
          followRedirects: false,
        } as (typeof REDIRECT_CHAIN.steps)[0],
      ],
    });
    expect(stopped.exchanges).toHaveLength(1);
    expect(stopped.exchanges[0].response.status).toBe(301);
  });

  it('resolves a Location whether it is absolute or relative', () => {
    expect(resolveLocation('https://www.example.com/x', 'example.com')).toEqual({
      host: 'www.example.com',
      target: '/x',
    });
    expect(resolveLocation('/y', 'example.com')).toEqual({
      host: 'example.com',
      target: '/y',
    });
  });
});

// ---------------------------------------------------------------------------
// 4. conditional-request -- the 304 with no body
// ---------------------------------------------------------------------------

describe('conditional-request', () => {
  const run = runHttpScenario(CONDITIONAL_REQUEST);
  const cold = exchangeAt(run, 'cold');
  const warm = exchangeAt(run, 'warm');
  const atEdge = exchangeAt(run, 'revalidate-at-edge');
  const atOrigin = exchangeAt(run, 'revalidate-at-origin');

  it('walks the four cache states in order', () => {
    expect([cold, warm, atEdge, atOrigin].map((each) => each.browserCache)).toEqual([
      'MISS',
      'HIT',
      'REVALIDATED',
      'REVALIDATED',
    ]);
    expect([cold, warm, atEdge, atOrigin].map((each) => each.servedBy)).toEqual([
      'origin',
      'browser-cache',
      'cdn',
      'origin',
    ]);
  });

  it('touches no network at all on the hit', () => {
    const during = run.result.events.filter(
      (event) =>
        event.kind === 'transmit' &&
        event.at >= warm.sentAt &&
        event.at <= warm.receivedAt,
    );
    expect(during).toHaveLength(0);
    // The Age field is the only visible sign the bytes are not new.
    expect(Number(headerValue(warm.response.headers, 'Age'))).toBeGreaterThan(0);
  });

  it('sends validators once the copy is stale, and gets a real 304 back', () => {
    expect(headerValue(atEdge.request.headers, 'If-None-Match')).toBe('"css-7c1a"');
    expect(headerValue(atEdge.request.headers, 'If-Modified-Since')).toBeDefined();

    // The response the *client* was handed is the stored body, freshened; the response
    // that crossed the wire was a 304. That is the whole saving.
    const wire = eventsOfKind(run, 'pdu-created').filter(
      (event) =>
        event.at >= atEdge.sentAt &&
        event.at <= atEdge.receivedAt &&
        event.pdu.summary.includes('304'),
    );
    expect(wire.length).toBeGreaterThan(0);
    expect(wire[0].pdu.layers.at(-1)?.payloadPreview).toContain('304');
  });

  it('never puts a body or a Content-Length on a 304', () => {
    for (const pdu of Object.values(run.result.pdus)) {
      if (!pdu.summary.includes(' 304 ')) continue;
      const fields = pdu.layers.at(-1)?.fields ?? [];
      expect(fields.map((field) => field.name.toLowerCase())).not.toContain(
        'content-length',
      );
    }
  });

  it('reaches the origin only when the shared copy has gone stale too', () => {
    // The edge answered the third request by itself; the fourth had to ask upstream.
    expect(atEdge.cdnCache).toBe('REVALIDATED');
    expect(atEdge.servedBy).toBe('cdn');
    expect(atOrigin.servedBy).toBe('origin');
  });

  it('gives the browser max-age and the shared cache s-maxage', () => {
    const control = headerValue(cold.response.headers, 'Cache-Control');
    expect(control).toContain('max-age=30');
    expect(control).toContain('s-maxage=120');
    expect(run.cacheViews.browser[0].freshness.lifetime.source).toBe('max-age');
    expect(run.cacheViews.cdn[0].freshness.lifetime.source).toBe('s-maxage');
  });

  it('draws a CDN node, and only in the scenario that declares one', () => {
    expect(run.topology.nodes.map((node) => node.id)).toContain(CDN_NODE);
    expect(
      runHttpScenario(SIMPLE_GET).topology.nodes.map((node) => node.id),
    ).not.toContain(CDN_NODE);
  });
});

// ---------------------------------------------------------------------------
// 5. cookie-session -- the attribute that stops the attack
// ---------------------------------------------------------------------------

describe('cookie-session', () => {
  const run = runHttpScenario(COOKIE_SESSION);
  const login = exchangeAt(run, 'login', 0);
  const authenticated = exchangeAt(run, 'login', 1);
  const csrf = exchangeAt(run, 'csrf');

  it('stores both cookies from the login, with the session hardened', () => {
    expect(login.cookiesSet.every((result) => result.accepted)).toBe(true);
    const session = run.jar.cookies.find((cookie) => cookie.name === '__Host-session');
    expect(session).toMatchObject({
      secure: true,
      httpOnly: true,
      hostOnly: true,
      path: '/',
      sameSite: 'Lax',
    });
    // No Expires and no Max-Age: it dies with the browser session.
    expect(session?.expiresAt).toBeUndefined();
  });

  it('attaches both cookies to the same-site request, longest path first', () => {
    expect(authenticated.cookiesSent.map((cookie) => cookie.name)).toEqual([
      '__Host-session',
      'theme',
    ]);
    expect(headerValue(authenticated.request.headers, 'Cookie')).toContain(
      '__Host-session=',
    );
    expect(authenticated.response.status).toBe(200);
  });

  it('sends the cross-site POST but withholds the session cookie from it', () => {
    // The request was made. Nothing stopped it, and nothing could have.
    expect(csrf.request.method).toBe('POST');
    expect(csrf.sentAt).toBeGreaterThan(0);

    expect(csrf.cookiesSent).toEqual([]);
    expect(headerValue(csrf.request.headers, 'Cookie')).toBeUndefined();
    expect(csrf.cookiesExcluded.map((each) => each.cookie.name)).toEqual([
      '__Host-session',
      'theme',
    ]);
    for (const excluded of csrf.cookiesExcluded) {
      expect(excluded.reason).toMatch(/SameSite/);
    }
  });

  it('is refused by the application, not by the browser', () => {
    // The 403 came back over the wire. CORS blocking the response afterwards is a
    // separate thing that happened later and would not have saved the account.
    expect(csrf.response.status).toBe(403);
    expect(csrf.servedBy).toBe('origin');
  });

  it('keeps the account page out of any shared cache', () => {
    expect(headerValue(authenticated.response.headers, 'Cache-Control')).toContain(
      'no-store',
    );
    expect(run.browserCache.entries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. cors-preflight -- the request was sent; the response was blocked
// ---------------------------------------------------------------------------

describe('cors-preflight', () => {
  const run = runHttpScenario(CORS_PREFLIGHT);
  const blocked = exchangeAt(run, 'simple-blocked');
  const preflight = exchangeAt(run, 'json-put', 0);
  const put = exchangeAt(run, 'json-put', 1);
  const again = exchangeAt(run, 'json-put-again', 0);

  it('sends the simple request, gets a 200, and then blocks it from the page', () => {
    // Every one of these four assertions is a separate step of the story, and the
    // misconception this scenario exists for is the belief that the first three did not
    // happen.
    expect(blocked.sentAt).toBeGreaterThanOrEqual(0);
    expect(blocked.response.status).toBe(200);
    expect(blocked.servedBy).toBe('origin');
    expect(blocked.blockedFromPage).toBe(true);

    expect(blocked.cors.crossOrigin).toBe(true);
    expect(blocked.cors.simple).toBe(true);
    expect(blocked.cors.preflightRequired).toBe(false);
    expect(blocked.cors.reason).toMatch(/still sent/);
  });

  it('drops the response at the browser rather than anywhere upstream', () => {
    const drops = eventsOfKind(run, 'drop').filter(
      (event) => event.at >= blocked.sentAt && event.at <= blocked.receivedAt + 1,
    );
    expect(drops).toHaveLength(1);
    expect(drops[0].atNode).toBe(BROWSER_NODE);
    expect(drops[0].reason).toMatch(/CORS/);
  });

  it('preflights the JSON PUT, because application/json is not on the safelist', () => {
    expect(preflight.kind).toBe('preflight');
    expect(preflight.request.method).toBe('OPTIONS');
    expect(preflight.response.status).toBe(204);
    expect(headerValue(preflight.request.headers, 'Access-Control-Request-Method')).toBe(
      'PUT',
    );
    const asked = headerValue(
      preflight.request.headers,
      'Access-Control-Request-Headers',
    );
    expect(asked).toContain('content-type');
    expect(asked).toContain('x-request-id');
  });

  it('agrees with isSimpleCorsRequest about what is simple', () => {
    expect(isSimpleCorsRequest(blocked.request)).toBe(true);
    expect(isSimpleCorsRequest(put.request)).toBe(false);
  });

  it('lets the page read the PUT response, and says which origin may', () => {
    expect(put.response.status).toBe(200);
    expect(put.blockedFromPage).toBe(false);
    expect(headerValue(put.response.headers, 'Access-Control-Allow-Origin')).toBe(
      'https://app.example.com',
    );
    // A specific origin means the response is not interchangeable between callers.
    expect(headerValue(put.response.headers, 'Vary')).toBe('Origin');
  });

  it('skips the preflight the second time, because Max-Age remembered it', () => {
    expect(headerValue(preflight.response.headers, 'Access-Control-Max-Age')).toBe('600');
    expect(
      run.exchanges.filter((exchange) => exchange.kind === 'preflight'),
    ).toHaveLength(1);
    expect(again.hop).toBe(0);
    expect(again.request.method).toBe('PUT');
    expect(again.blockedFromPage).toBe(false);
  });

  it('costs two round trips the first time and one the second', () => {
    const first = put.receivedAt - preflight.sentAt;
    const second = again.receivedAt - again.sentAt;
    expect(first).toBeGreaterThan(second * 1.8);
  });
});

// ---------------------------------------------------------------------------
// 7. http2-multiplexing -- two kinds of blocking, scored differently
// ---------------------------------------------------------------------------

describe('http2-multiplexing', () => {
  const run = runHttpScenario(HTTP2_MULTIPLEXING);
  const comparison = run.comparison;

  if (!comparison) throw new Error('the comparison scenario produced no comparison');

  const h1 = comparison.runs['HTTP/1.1'];
  const h2 = comparison.runs['HTTP/2'];
  const h3 = comparison.runs['HTTP/3'];

  it('runs the same resources and the same losses through all three versions', () => {
    for (const run_ of [h1, h2, h3]) {
      expect(run_.streams).toHaveLength(
        HTTP2_MULTIPLEXING.steps[0].kind === 'compare'
          ? HTTP2_MULTIPLEXING.steps[0].resources.length
          : 0,
      );
      expect(run_.losses).toEqual(comparison.losses);
    }
    expect(comparison.losses).toHaveLength(1);
  });

  it('finishes h3 first, then h2, then h1', () => {
    expect(comparison.verdicts.map((verdict) => verdict.alias)).toEqual([
      'h3',
      'h2',
      'h1',
    ]);
  });

  it('queues eighteen requests under h1 and none under h2 or h3', () => {
    const queued = (run_: typeof h1) =>
      run_.streams.filter((stream) => stream.blockedMs > 0).length;
    expect(queued(h1)).toBe(h1.streams.length - 6);
    expect(queued(h2)).toBe(0);
    expect(queued(h3)).toBe(0);
    expect(h1.applicationHolMs).toBeGreaterThan(0);
    expect(h2.applicationHolMs).toBe(0);
  });

  it('stalls every h2 stream on one lost segment, and no h1 or h3 stream', () => {
    // The claim the whole scenario exists to make honestly: h2 removes application-layer
    // head-of-line blocking and is *worse* than h1 at the transport-layer kind.
    expect(h2.transportHolMs).toBeGreaterThan(0);
    expect(h1.transportHolMs).toBe(0);
    expect(h3.transportHolMs).toBe(0);

    const loser = comparison.losses[0].resourceId;
    const lost = h2.streams.find((stream) => stream.resourceId === loser);
    const stalledAt = lost?.stalls[0]?.atMs ?? 0;
    expect(stalledAt).toBeGreaterThan(0);

    // Every stream still in flight when the segment went missing was stalled by it --
    // "every stream", correctly scoped. The sixteen small files had already completed
    // and could not be held up by a hole in bytes they were no longer waiting for, which
    // is exactly why transport head-of-line blocking is intermittent in practice.
    const inFlight = h2.streams.filter(
      (stream) => stream.resourceId !== loser && stream.completedAt > stalledAt,
    );
    expect(inFlight.length).toBeGreaterThan(1);
    for (const stream of inFlight) {
      expect(stream.holStallMs).toBe(comparison.conditions.rttMs);
      expect(stream.stalls.map((stall) => stall.kind)).toEqual(['transport-hol']);
      expect(stream.stalls[0].causedBy).toBe(loser);
    }

    // And under h3 the same streams, hit by the same lost packet, waited for nothing.
    for (const stream of h3.streams.filter((each) => each.resourceId !== loser)) {
      expect(stream.holStallMs).toBe(0);
      expect(stream.stalls).toEqual([]);
    }
  });

  it('costs each version the same stall on its own lost packet', () => {
    // The loss itself is identical; only its blast radius differs.
    expect(h1.ownStallMs).toBe(h2.ownStallMs);
    expect(h2.ownStallMs).toBe(h3.ownStallMs);
  });

  it('gives h3 a one-round-trip head start on the handshake', () => {
    expect(h1.handshake.roundTrips).toBe(2);
    expect(h2.handshake.roundTrips).toBe(2);
    expect(h3.handshake.roundTrips).toBe(1);
    expect(h2.handshake.ms - h3.handshake.ms).toBe(comparison.conditions.rttMs);
  });

  it('decomposes the h2-to-h3 gap into exactly the handshake and the stall', () => {
    // Both are one round trip, which is why the numbers in the scenario's header comment
    // are round. If this assertion ever fails, the prose is wrong.
    const rtt = comparison.conditions.rttMs;
    expect(h2.completedAt - h3.completedAt).toBeCloseTo(2 * rtt, 1);
  });

  it('compresses h2 and h3 headers and leaves h1 headers alone', () => {
    expect(h1.requestHeaderBytesOnWire).toBe(h1.requestHeaderBytesRaw);
    expect(h2.requestHeaderBytesOnWire).toBeLessThan(h2.requestHeaderBytesRaw / 3);
    expect(h3.requestHeaderBytesOnWire).toBe(h2.requestHeaderBytesOnWire);
  });

  it('opens six connections for h1 and one for h2 and h3', () => {
    expect(h1.connections).toHaveLength(6);
    expect(h2.connections).toHaveLength(1);
    expect(h3.connections).toHaveLength(1);
    expect(h1.streams.every((stream) => stream.streamId === undefined)).toBe(true);
    expect(h2.streams.every((stream) => (stream.streamId ?? 0) % 2 === 1)).toBe(true);
  });

  it('puts the three runs on one timeline as three chapters', () => {
    expect(run.result.phases.map((phase) => phase.id)).toEqual([
      'page-load-h1',
      'page-load-h2',
      'page-load-h3',
    ]);
  });
});
