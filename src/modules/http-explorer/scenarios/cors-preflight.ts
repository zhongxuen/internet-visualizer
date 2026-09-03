/**
 * Scenario 6 -- the request was sent. The response was blocked. Those are different things.
 *
 * Almost every misconception about CORS collapses into one sentence: **CORS does not stop
 * a request from reaching a server.** It stops a *page* from reading the answer. The
 * request goes out, the server runs it, the response comes back complete -- and then the
 * browser, having received the whole thing, declines to hand it over.
 *
 * The first step exists to show exactly that. A cross-origin `GET` for a JSON endpoint
 * that sends no `Access-Control-Allow-Origin`: watch it leave, watch the server answer
 * 200, watch it arrive, and watch it get dropped at the browser. If that request had
 * deleted something, it would be deleted.
 *
 * ## Simple, and not simple
 *
 * A cross-origin request is **simple** when a plain HTML form of 1999 could already have
 * made it: `GET`, `HEAD` or `POST`, no author-set fields outside a short safelist, and a
 * `Content-Type` of `application/x-www-form-urlencoded`, `multipart/form-data` or
 * `text/plain`. Those go out with no permission asked, because permitting them grants an
 * attacker nothing that was not already possible.
 *
 * `application/json` is **not** on that list. That single omission is why nearly every
 * modern API call is preflighted: before the real request is allowed to leave, the browser
 * sends an `OPTIONS` asking whether it may, listing the method in
 * `Access-Control-Request-Method` and the offending fields in
 * `Access-Control-Request-Headers`. That is a whole extra round trip the page did not ask
 * for and cannot see in its own code.
 *
 * ## Which is what `Access-Control-Max-Age` is for
 *
 * The third step is the same `PUT` again, and there is no `OPTIONS` in front of it: the
 * preflight response said `Access-Control-Max-Age: 600`, so the browser remembers the
 * answer for ten minutes. One line of server configuration turns two round trips per
 * write back into one, and it is left unset almost everywhere.
 *
 * > CORS is defined by the WHATWG Fetch Standard, not by an RFC. RFC 9110 gives the field
 * > syntax these headers obey and says nothing about the policy, and people go looking for
 * > "the CORS RFC" and conclude they have missed a document. They have not; there isn't one.
 */

import { header } from '../sim/message';
import type { HttpScenario } from '../sim/exchange';

import { FIXTURE_ADDRESSES, HTTP_CLOCK } from './common';

/** The page making the calls. A different origin from the API, which is the whole point. */
const PAGE_ORIGIN = 'https://app.example.com';

const STATUS_JSON = '{"status":"ok","region":"lhr","queueDepth":3}\n';
const ITEM_JSON = '{"id":42,"title":"The blank line","updated":true}\n';

/** A blocked simple request, a preflighted one, and a repeat that skips the preflight. */
export const CORS_PREFLIGHT: HttpScenario = {
  id: 'cors-preflight',
  title: 'CORS and the preflight',
  summary:
    'A cross-origin GET that is sent, answered, and then blocked at the browser -- and a ' +
    'JSON PUT that has to ask permission first, in a round trip of its own.',
  teaches: [
    'The request is sent and executed; only the response is withheld from the page',
    'Simple means what a 1999 HTML form could do -- and application/json is not simple',
    'A preflight is a real extra round trip before the real request',
    'Access-Control-Max-Age caches the preflight, and almost nobody sets it',
    'CORS lives in the WHATWG Fetch Standard, not in an RFC',
  ],
  seed: 'http:cors-preflight',
  version: 'HTTP/1.1',
  secure: true,
  clock: HTTP_CLOCK,
  conditions: { rttMs: 110, bandwidthKbps: 18_000 },
  origins: [
    {
      host: 'api.example.com',
      label: 'api.example.com',
      ipv4: FIXTURE_ADDRESSES.api,
      server: 'simulated-api',
      thinkMs: 20,
      routes: [
        {
          // No `cors` policy at all, so this route sends no Access-Control-* fields.
          path: '/public/status',
          status: 200,
          headers: [
            header('Content-Type', 'application/json'),
            header('Cache-Control', 'no-store'),
          ],
          body: STATUS_JSON,
        },
        {
          path: '/items/42',
          methods: ['GET', 'PUT'],
          status: 200,
          thinkMs: 35,
          cors: {
            allowOrigins: [PAGE_ORIGIN],
            allowMethods: ['GET', 'PUT'],
            allowHeaders: ['content-type', 'x-request-id'],
            maxAgeSeconds: 600,
          },
          headers: [
            header('Content-Type', 'application/json'),
            header('Cache-Control', 'no-store'),
          ],
          body: ITEM_JSON,
        },
      ],
    },
  ],
  steps: [
    {
      kind: 'request',
      id: 'simple-blocked',
      title: 'A simple request, blocked',
      host: 'api.example.com',
      target: '/public/status',
      intent:
        'A cross-origin GET with nothing unusual on it. No permission is asked, because ' +
        'none is needed to send it -- and the answer is still not for this page.',
      initiator: { pageOrigin: PAGE_ORIGIN, withCredentials: false },
    },
    {
      kind: 'request',
      id: 'json-put',
      title: 'A JSON PUT, preflighted',
      host: 'api.example.com',
      target: '/items/42',
      method: 'PUT',
      afterMs: 1_500,
      headers: [
        header('Content-Type', 'application/json'),
        header('X-Request-Id', '7f3a1c6e'),
      ],
      body: '{"title":"The blank line"}',
      intent:
        'A JSON body and a custom field, neither of which is on the safelist. The browser ' +
        'asks first.',
      initiator: { pageOrigin: PAGE_ORIGIN, withCredentials: false },
    },
    {
      kind: 'request',
      id: 'json-put-again',
      title: 'The same PUT, ten seconds later',
      host: 'api.example.com',
      target: '/items/42',
      method: 'PUT',
      afterMs: 10_000,
      headers: [
        header('Content-Type', 'application/json'),
        header('X-Request-Id', '9b2d4a70'),
      ],
      body: '{"title":"Still the blank line"}',
      intent:
        'Identical in every way that matters, and this time there is no OPTIONS in front ' +
        'of it. The preflight answer is still remembered.',
      initiator: { pageOrigin: PAGE_ORIGIN, withCredentials: false },
    },
  ],
  notes: [
    {
      phase: 'simple-blocked',
      text: "Follow this one arrow at a time. The request leaves the browser. It arrives. The server runs it and answers 200 with a body. The response travels all the way back and lands here, complete, in the browser's memory -- and only then is it dropped, because it carried no Access-Control-Allow-Origin. Nothing was prevented. Something was hidden.",
      reference: {
        rfc: 9110,
        section: '5',
        title: 'HTTP Semantics (field syntax; CORS itself is the WHATWG Fetch Standard)',
      },
    },
    {
      phase: 'simple-blocked',
      text: 'This is why CORS is not a security control for the server. If GET /public/status had side effects, they happened. If this had been a POST with a urlencoded body -- equally simple, equally unpreflighted -- it would also have been sent and executed. Protecting a server from cross-origin requests takes a check the server performs: an origin check, a token, or a SameSite cookie, as in the session scenario.',
      reference: {
        rfc: 9110,
        section: '5',
        title: 'HTTP Semantics (field syntax; CORS itself is the WHATWG Fetch Standard)',
      },
    },
    {
      phase: 'json-put-preflight',
      text: 'An OPTIONS request that asks about a request rather than making one. Access-Control-Request-Method names the method the page wants to use; Access-Control-Request-Headers lists the fields that are not on the safelist -- here Content-Type, because application/json is not one of the three permitted values, and X-Request-Id, because no field with that name has ever been on any list. The server answers 204: no content, only permission.',
      reference: { rfc: 9110, section: '9.3.7', title: 'HTTP Semantics: OPTIONS' },
    },
    {
      phase: 'json-put',
      text: "Now the real request goes, and this time the response says Access-Control-Allow-Origin, so the page may read it. Count the round trips: two, for one API call. That cost is invisible in the page's own code, which contains a single fetch, and it is the most common reason a cross-origin API feels slower than a same-origin one that does more work.",
      reference: { rfc: 9110, section: '15.3.1', title: 'HTTP Semantics: 200 OK' },
    },
    {
      phase: 'json-put',
      text: 'Vary: Origin appears on the response because the allowed origin was a specific one rather than a wildcard. Without it, a shared cache in front of this API could store the response it produced for app.example.com and hand it, allow-header and all, to a request from somewhere else -- the cache defeating the policy by doing exactly its job.',
      reference: {
        rfc: 9111,
        section: '4.1',
        title: 'HTTP Caching: Calculating Secondary Keys with Vary',
      },
    },
    {
      phase: 'json-put-again',
      text: 'No preflight this time. The earlier 204 carried Access-Control-Max-Age: 600, so the browser remembered the answer for ten minutes and skipped straight to the PUT -- one round trip instead of two, for every write in that window. The field costs one line of server configuration and is unset on most deployments, which is a very cheap latency problem to still have.',
      reference: {
        rfc: 9110,
        section: '5',
        title: 'HTTP Semantics (field syntax; CORS itself is the WHATWG Fetch Standard)',
      },
    },
  ],
};
