/**
 * Scenario 3 -- 301, then 302, then 200, and what each one costs.
 *
 * A redirect is not a detour the server takes on your behalf. It is an answer that
 * contains no content, and it obliges the **client** to make another request -- another
 * connection if the host changed, another round trip either way. A three-hop chain to
 * fetch one page is three times the latency of fetching it directly, every time anyone
 * follows the link.
 *
 * ## The two axes
 *
 * People remember "301 is permanent, 302 is temporary" and stop, which leaves out the
 * axis that actually bites. The codes vary independently along two:
 *
 * | Code | Permanent | Method on the next hop        |
 * | ---- | --------- | ----------------------------- |
 * | 301  | yes       | rewritten to GET *in practice* |
 * | 302  | no        | rewritten to GET *in practice* |
 * | 303  | no        | rewritten to GET, by the spec  |
 * | 307  | no        | preserved                      |
 * | 308  | yes       | preserved                      |
 *
 * The "in practice" rows are the interesting ones. RFC 9110 s15.4.3 says a client ought
 * to preserve the method across a 301 or a 302 -- and then documents that user agents
 * rewrite POST to GET anyway, because that is what they have always done and changing it
 * would break the web. 307 and 308 exist for no other reason than to give a server a way
 * to say "I really do mean keep the method", unambiguously.
 *
 * The second step shows the rewrite being used deliberately rather than suffered: a POST
 * answered with **303 See Other** turns into a GET of the result page. That is
 * POST/Redirect/GET, and it is why a reload after submitting a form re-fetches a
 * confirmation page instead of submitting the form a second time.
 */

import { header } from '../sim/message';
import type { HttpScenario } from '../sim/exchange';

import { FIXTURE_ADDRESSES, HTTP_CLOCK, daysBefore } from './common';

const ARTICLE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>HTTP basics</title></head>
  <body>
    <h1>HTTP basics</h1>
    <p>Three requests were made to show you this one page.</p>
  </body>
</html>
`;

/** A two-hop redirect to a moved page, and then POST/Redirect/GET on a form. */
export const REDIRECT_CHAIN: HttpScenario = {
  id: 'redirect-chain',
  title: 'Redirect chain',
  summary:
    'One link followed through 301 and 302 before anything is served -- and then a POST ' +
    'answered with 303, which turns the follow-up into a GET and makes reloading safe.',
  teaches: [
    'A redirect costs a whole round trip, and a chain costs one per hop',
    '301 is permanent and cacheable; 302 is temporary and usually should not be cached',
    'Browsers rewrite POST to GET on 301 and 302, which is why 307 and 308 exist',
    '303 turns a POST into a GET on purpose: the POST/Redirect/GET pattern',
  ],
  seed: 'http:redirect-chain',
  version: 'HTTP/1.1',
  secure: false,
  clock: HTTP_CLOCK,
  conditions: { rttMs: 80, bandwidthKbps: 20_000 },
  origins: [
    {
      host: 'example.com',
      label: 'example.com (apex)',
      ipv4: FIXTURE_ADDRESSES.example,
      server: 'nginx (simulated)',
      thinkMs: 8,
      routes: [
        {
          path: '/old-post',
          status: 301,
          headers: [
            header('Location', 'http://www.example.com/old-post'),
            // A permanent redirect is worth caching: the answer will not change, and a
            // cached 301 removes this hop from every later visit.
            header('Cache-Control', 'max-age=86400'),
            header('Content-Type', 'text/html; charset=utf-8'),
          ],
          body: '<p>Moved to <a href="http://www.example.com/old-post">www</a>.</p>\n',
        },
      ],
    },
    {
      host: 'www.example.com',
      label: 'www.example.com',
      ipv4: FIXTURE_ADDRESSES.www,
      server: 'nginx (simulated)',
      thinkMs: 10,
      routes: [
        {
          path: '/old-post',
          status: 302,
          headers: [
            header('Location', '/posts/http-basics'),
            // Temporary, so writing it down would be a mistake: the whole point of a 302
            // is that tomorrow's answer may be different.
            header('Cache-Control', 'no-store'),
          ],
        },
        {
          path: '/posts/http-basics',
          status: 200,
          conditional: true,
          headers: [
            header('Content-Type', 'text/html; charset=utf-8'),
            header('Cache-Control', 'max-age=600'),
            header('ETag', '"post-http-basics-11"'),
            header('Last-Modified', daysBefore(12)),
          ],
          body: ARTICLE,
          thinkMs: 24,
        },
        {
          path: '/posts/http-basics/comments',
          methods: ['POST'],
          status: 303,
          thinkMs: 55,
          headers: [
            header('Location', '/posts/http-basics'),
            header('Cache-Control', 'no-store'),
          ],
        },
      ],
    },
  ],
  steps: [
    {
      kind: 'request',
      id: 'follow-link',
      title: 'GET /old-post',
      host: 'example.com',
      target: '/old-post',
      intent:
        'Someone follows an old link. Two of the three requests that follow exist only ' +
        'to be told where to go next.',
      initiator: { pageOrigin: 'http://example.com', topLevelNavigation: true },
    },
    {
      kind: 'request',
      id: 'post-comment',
      title: 'POST a comment',
      host: 'www.example.com',
      target: '/posts/http-basics/comments',
      method: 'POST',
      afterMs: 1_200,
      headers: [header('Content-Type', 'application/x-www-form-urlencoded')],
      body: 'body=The+blank+line+finally+made+sense.&author=ada',
      intent:
        'A comment is posted, and the answer is a 303: go and GET the article, which is ' +
        'a page you can safely reload.',
      initiator: { pageOrigin: 'http://www.example.com', topLevelNavigation: true },
    },
  ],
  notes: [
    {
      phase: 'follow-link',
      text: '301 Moved Permanently: the resource has a new home and this one will not come back. That is a claim worth caching -- the response says max-age=86400, so this hop disappears for a day and a client that stored it goes straight to www next time. It is also a claim worth being careful with, because a browser that has cached a 301 will not re-check it, and undoing one on a live site is famously painful.',
      reference: {
        rfc: 9110,
        section: '15.4.2',
        title: 'HTTP Semantics: 301 Moved Permanently',
      },
    },
    {
      phase: 'follow-link',
      text: 'Notice the host changed. That means a second connection: a fresh TCP handshake to a different server before the second request can even be sent. A redirect between paths on one host is one round trip; a redirect across hosts is a round trip plus a connection setup, which on an encrypted connection is two more.',
      reference: { rfc: 9112, section: '9.3', title: 'HTTP/1.1: Persistent Connections' },
    },
    {
      phase: 'follow-link-redirect-1',
      text: '302 Found is the temporary one, and it says no-store for exactly that reason: caching a temporary answer defeats its purpose. This is also the code the method-rewriting problem is named after. RFC 9110 says a client ought to keep the method across a 302, then records that user agents change POST to GET regardless, and gives up trying to fix it. 307 Temporary Redirect is the same code with the ambiguity removed.',
      reference: { rfc: 9110, section: '15.4.3', title: 'HTTP Semantics: 302 Found' },
    },
    {
      phase: 'follow-link-redirect-2',
      text: 'The third request is the first one that returns any content. Two full round trips were spent discovering where to ask. That is the cost of a redirect chain, it is paid by every visitor who follows the old link, and it is why collapsing chains is one of the cheapest performance wins there is: this page would have arrived in a third of the time from a single hop.',
      reference: { rfc: 9110, section: '15.4', title: 'HTTP Semantics: Redirection 3xx' },
    },
    {
      phase: 'post-comment',
      text: '303 See Other is the one redirect whose method rewrite is not a browser quirk but the specification: whatever you sent, go and GET the resource at Location. The comment was created by the POST; the browser is then sent to a page it can reload, bookmark, and share without re-posting anything. That is POST/Redirect/GET, and it is the reason a modern form submission does not leave you one refresh away from a duplicate.',
      reference: { rfc: 9110, section: '15.4.4', title: 'HTTP Semantics: 303 See Other' },
    },
    {
      phase: 'post-comment-redirect-1',
      text: 'Look at what the second request lost: the method changed from POST to GET, and the body -- along with Content-Type and Content-Length, which described it -- went with it. That is correct here and is the trap on 301 and 302, where the same rewrite happens to a request that meant to keep its body. If a server needs the method preserved, 307 and 308 are the codes that say so.',
      reference: {
        rfc: 9110,
        section: '15.4.8',
        title: 'HTTP Semantics: 307 Temporary Redirect',
      },
    },
  ],
};
