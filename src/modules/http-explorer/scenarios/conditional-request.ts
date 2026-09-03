/**
 * Scenario 4 -- one stylesheet, four requests, and four different answers.
 *
 * The same `GET /app.css` is asked four times over three minutes, and every time the
 * answer comes from somewhere else. That progression is the scenario:
 *
 * | # | When   | Browser cache | Edge cache    | Bytes on the wire |
 * | - | ------ | ------------- | ------------- | ----------------- |
 * | 1 | 0 s    | `MISS`        | `MISS`        | the whole file    |
 * | 2 | +3 s   | **`HIT`**     | never asked   | **none at all**   |
 * | 3 | +43 s  | `REVALIDATED` | `REVALIDATED` | a 304, no body    |
 * | 4 | +173 s | `REVALIDATED` | `REVALIDATED` | a 304, no body    |
 *
 * Two caches, because they answer to different directives and the difference is the
 * point: `Cache-Control: max-age=30, s-maxage=120` gives the browser half a minute and
 * the CDN two full ones. `s-maxage` is ignored by a private cache and obeyed by a shared
 * one, which is how one response tells the edge to hold something for a long time and the
 * browser to check back often.
 *
 * ## What a 304 is
 *
 * Request 3 is the one worth watching. The browser's copy is stale -- but stale does not
 * mean wrong, it means unverified. So it is not thrown away: the request goes out
 * carrying `If-None-Match: "css-7c1a"`, which means *"only send it if it isn't this one"*.
 * The answer is **304 Not Modified**, and a 304 has no body. Ever. The client redraws the
 * page from bytes it already had, and the round trip cost the headers and nothing else.
 *
 * On request 3 the *edge* answers that 304, because it still holds the same version the
 * browser does -- so the origin is not contacted at all. On request 4 the edge's own copy
 * has gone stale too, so it asks the origin, gets a 304 of its own, and passes one on.
 * The same status code, produced at two different tiers, for two different reasons.
 *
 * ## The distinction everybody gets wrong
 *
 * `no-cache` and `no-store` are not degrees of the same thing.
 *
 * - **`no-store`** means do not write this down. It is about storage, and it is what you
 *   want on a bank balance or a page with someone's name on it.
 * - **`no-cache`** means store it, and never reuse it without asking first. It is about
 *   *reuse*, and it is compatible with caching every byte of the response to disk.
 *
 * So a `no-cache` response is cached, and a response with `max-age=3600` that has gone
 * stale behaves exactly like one -- both revalidate, and both can come back as a 304 with
 * no content. A response marked `no-store` never gets that far, because there is nothing
 * stored to validate.
 */

import { header } from '../sim/message';
import type { HttpScenario } from '../sim/exchange';

import { FIXTURE_ADDRESSES, HTTP_CLOCK, daysBefore } from './common';

const STYLESHEET = `:root { color-scheme: dark; --ink: #e6edf3; }
body { background: #0d1117; color: var(--ink); font: 16px/1.6 system-ui, sans-serif; }
a { color: #58a6ff; }
pre { overflow-x: auto; }
`;

/** One file, four requests, and every cache state a browser can be in. */
export const CONDITIONAL_REQUEST: HttpScenario = {
  id: 'conditional-request',
  title: 'Conditional request',
  summary:
    'The same stylesheet asked for four times: a miss, a hit that touches no network at ' +
    'all, and then two revalidations that come back 304 with no body.',
  teaches: [
    'Fresh means lifetime is greater than age, and nothing else',
    'A cache hit is not a faster request -- it is no request',
    'A 304 has no body: that is the entire saving, and it is worth a round trip',
    'max-age is for the browser, s-maxage for the shared cache in front of it',
    'no-cache means "always ask first"; no-store means "never write it down"',
  ],
  seed: 'http:conditional-request',
  version: 'HTTP/1.1',
  secure: true,
  clock: HTTP_CLOCK,
  conditions: { rttMs: 90, bandwidthKbps: 16_000 },
  cdn: { label: 'edge-lhr (shared cache)', ipv4: FIXTURE_ADDRESSES.edge },
  origins: [
    {
      host: 'assets.example.com',
      label: 'assets.example.com (origin)',
      ipv4: FIXTURE_ADDRESSES.assets,
      server: 'nginx (simulated)',
      thinkMs: 18,
      routes: [
        {
          path: '/app.css',
          status: 200,
          conditional: true,
          headers: [
            header('Content-Type', 'text/css; charset=utf-8'),
            // Half a minute for the browser, two minutes for the edge. One response,
            // two different instructions, because s-maxage is invisible to a private cache.
            header('Cache-Control', 'max-age=30, s-maxage=120'),
            header('ETag', '"css-7c1a"'),
            header('Last-Modified', daysBefore(9)),
            header('Vary', 'Accept-Encoding'),
          ],
          body: STYLESHEET,
        },
      ],
    },
  ],
  steps: [
    {
      kind: 'request',
      id: 'cold',
      title: 'First request',
      host: 'assets.example.com',
      target: '/app.css',
      intent:
        'Nothing is stored anywhere, so this costs a connection, two hops, and the whole ' +
        'file.',
      initiator: { pageOrigin: 'https://assets.example.com', topLevelNavigation: true },
    },
    {
      kind: 'request',
      id: 'warm',
      title: 'Again, immediately',
      host: 'assets.example.com',
      target: '/app.css',
      // Long enough that the Age field on the served copy is a visible number rather
      // than a rounded-down zero, and still far inside the 30-second max-age.
      afterMs: 3_000,
      intent:
        'The stored copy is still fresh, so the browser answers out of its own memory. ' +
        'Watch the timeline: there is nothing to watch.',
      initiator: { pageOrigin: 'https://assets.example.com', topLevelNavigation: true },
    },
    {
      kind: 'request',
      id: 'revalidate-at-edge',
      title: 'After max-age expires',
      host: 'assets.example.com',
      target: '/app.css',
      afterMs: 40_000,
      intent:
        'Forty seconds on, the browser copy is stale but the edge copy is not. The ' +
        'validators go out and a 304 comes back -- from the edge, without the origin ' +
        'hearing about it.',
      initiator: { pageOrigin: 'https://assets.example.com', topLevelNavigation: true },
    },
    {
      kind: 'request',
      id: 'revalidate-at-origin',
      title: 'After s-maxage expires too',
      host: 'assets.example.com',
      target: '/app.css',
      afterMs: 130_000,
      intent:
        'Now both copies are stale. The question travels all the way to the origin, which ' +
        'confirms the file has not changed -- and still sends no body.',
      initiator: { pageOrigin: 'https://assets.example.com', topLevelNavigation: true },
    },
  ],
  notes: [
    {
      phase: 'cold',
      text: 'A response is fresh while its freshness lifetime exceeds its age, and that is the whole definition -- two numbers, compared. The lifetime comes from max-age here; the age starts at whatever the Age field says and grows by one second per second. Everything else about caching is bookkeeping around that comparison.',
      reference: { rfc: 9111, section: '4.2', title: 'HTTP Caching: Freshness' },
    },
    {
      phase: 'warm',
      text: 'No packet left the machine. That is what a cache is: not a faster request but the absence of one, and the only visible trace is the Age field on the response saying how long the copy has been sitting there. A hit cannot be made faster by a better network, which is why it is the only optimisation that always works.',
      reference: {
        rfc: 9111,
        section: '4',
        title: 'HTTP Caching: Constructing Responses from Caches',
      },
    },
    {
      phase: 'revalidate-at-edge',
      text: 'Stale does not mean wrong; it means unverified. The stored copy is kept and its ETag goes out as If-None-Match, which asks the server to send the file only if it is not the one already held. The edge still has the same version, so it answers 304 Not Modified and the origin is never told this request happened.',
      reference: { rfc: 9110, section: '13.1.2', title: 'HTTP Semantics: If-None-Match' },
    },
    {
      phase: 'revalidate-at-edge',
      target: 'cdn',
      text: 'This is what s-maxage buys. The browser was told to check back after thirty seconds and the edge after a hundred and twenty, from the same response -- because a private cache ignores s-maxage entirely and a shared one prefers it. One header, two policies, and the origin is protected from the difference.',
      reference: { rfc: 9111, section: '5.2.2.10', title: 'HTTP Caching: s-maxage' },
    },
    {
      phase: 'revalidate-at-origin',
      text: 'Read the 304 in the wire view. It has a status line, a handful of fields, the blank line -- and then it stops. There is no body and no Content-Length, because a 304 structurally cannot carry content: it exists to say "the one you have". The client redraws from bytes it already had, and the entire exchange cost one round trip of headers.',
      reference: {
        rfc: 9110,
        section: '15.4.5',
        title: 'HTTP Semantics: 304 Not Modified',
      },
    },
    {
      phase: 'revalidate-at-origin',
      text: 'no-cache and no-store are not the same instruction and are not degrees of one. no-store forbids writing the response down at all. no-cache permits storing every byte and forbids reusing it without checking first -- so a no-cache response behaves exactly like the stale one here, revalidating each time and often coming back as a bodiless 304. Marking a stylesheet no-store to "make sure it updates" throws away the 304 path and re-downloads the file forever.',
      reference: { rfc: 9111, section: '5.2.2.4', title: 'HTTP Caching: no-cache' },
    },
    {
      phase: 'revalidate-at-origin',
      text: 'Vary: Accept-Encoding is the secondary cache key. It tells every cache that the stored copy is only valid for a request whose Accept-Encoding matches the one that fetched it -- otherwise a client that asked for gzip could be handed the brotli copy. Vary on a field that changes per user, such as Cookie or User-Agent, quietly turns a shared cache into a per-user one, which is the same as turning it off.',
      reference: {
        rfc: 9111,
        section: '4.1',
        title: 'HTTP Caching: Calculating Secondary Keys with Vary',
      },
    },
  ],
};
