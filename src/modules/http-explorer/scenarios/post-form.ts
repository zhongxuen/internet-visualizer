/**
 * Scenario 2 -- a request with a body, and a method that promises much less.
 *
 * The mechanical difference from `simple-get` is small: there are bytes after the blank
 * line, and two fields describing them. The semantic difference is the whole point.
 *
 * A GET is **safe** -- it promises not to change anything -- and **idempotent** -- sending
 * it twice has the same effect as sending it once. A POST is neither. That is not a
 * quality-of-implementation matter; it is what the method *means* (RFC 9110 s9.2), and
 * every visible behaviour around forms follows from it:
 *
 * - the browser asks before re-submitting a POST, and never asks before re-issuing a GET;
 * - a proxy may retry a dropped GET automatically and must not retry a POST;
 * - a cache will store a GET response by default and will not store a POST's;
 * - the POST/Redirect/GET pattern exists purely so the reload button stops being dangerous.
 *
 * The second step is here to make the third promise concrete from the other direction:
 * `/newsletter` accepts POST and nothing else, and a GET to it comes back 405 with an
 * `Allow` field naming what it would have accepted. A status code that tells you what to
 * do instead is rarer than it should be.
 */

import { header } from '../sim/message';
import type { HttpScenario } from '../sim/exchange';

import { FIXTURE_ADDRESSES, HTTP_CLOCK } from './common';

/**
 * The body, percent-encoded the way a browser encodes a form.
 *
 * `@` becomes `%40` and the space in the topic becomes `+`, because
 * `application/x-www-form-urlencoded` is a URL query string that happens to be in the
 * body rather than in the request-line. That is all it is, and it is why the encoding
 * looks like something from a URL bar.
 */
const FORM_BODY = 'email=ada%40example.com&topic=protocols+and+wires&consent=on';

/** A form submission, and then a method the resource will not accept. */
export const POST_FORM: HttpScenario = {
  id: 'post-form',
  title: 'POST a form',
  summary:
    'A form submission with a urlencoded body, answered 201 with a Location field -- and ' +
    'then the same path asked with GET, answered 405 with an Allow field.',
  teaches: [
    'A body sits after the blank line, described by Content-Type and Content-Length',
    'POST is neither safe nor idempotent, and that is a promise, not an implementation detail',
    '201 Created means a resource now exists, and Location says where',
    '405 carries Allow, which names the methods that would have worked',
  ],
  seed: 'http:post-form',
  version: 'HTTP/1.1',
  secure: false,
  clock: HTTP_CLOCK,
  conditions: { rttMs: 70, bandwidthKbps: 20_000 },
  origins: [
    {
      host: 'example.com',
      label: 'example.com',
      ipv4: FIXTURE_ADDRESSES.example,
      server: 'nginx (simulated)',
      thinkMs: 45,
      routes: [
        {
          path: '/newsletter',
          methods: ['POST'],
          status: 201,
          thinkMs: 60,
          headers: [
            header('Location', '/newsletter/subscriptions/8817'),
            header('Content-Type', 'text/plain; charset=utf-8'),
            header('Cache-Control', 'no-store'),
          ],
          body: 'Subscription 8817 created for ada@example.com.\n',
        },
      ],
    },
  ],
  steps: [
    {
      kind: 'request',
      id: 'post-newsletter',
      title: 'POST /newsletter',
      host: 'example.com',
      target: '/newsletter',
      method: 'POST',
      headers: [header('Content-Type', 'application/x-www-form-urlencoded')],
      body: FORM_BODY,
      intent:
        'A form is submitted. The two fields describing the body are what make it ' +
        'readable at the far end; the method is what makes it consequential.',
      initiator: { pageOrigin: 'http://example.com', topLevelNavigation: true },
    },
    {
      kind: 'request',
      id: 'get-newsletter',
      title: 'GET /newsletter',
      host: 'example.com',
      target: '/newsletter',
      afterMs: 900,
      intent:
        'The same path, asked with a method it does not accept. The refusal is specific ' +
        'enough to act on.',
      initiator: { pageOrigin: 'http://example.com', topLevelNavigation: true },
    },
  ],
  notes: [
    {
      phase: 'post-newsletter',
      text: 'Content-Type says how to interpret the bytes and Content-Length says how many there are. Without the first the body is a mystery; without the second, on a connection that stays open, the server cannot tell where this request ends and the next one begins. Turn the CRLF toggle on and count: the blank line, then exactly Content-Length bytes, then nothing.',
      reference: { rfc: 9110, section: '8.3', title: 'HTTP Semantics: Content-Type' },
    },
    {
      phase: 'post-newsletter',
      text: 'POST is not safe and not idempotent. Safe means the request is a read and nothing observable changes; idempotent means sending it twice leaves the same state as sending it once. GET, HEAD, PUT and DELETE all promise the second one -- PUT and DELETE without promising the first. POST promises neither, which is why the browser interrupts a reload with a dialog here and never does on a page fetched with GET.',
      reference: {
        rfc: 9110,
        section: '9.2',
        title: 'HTTP Semantics: Common Method Properties',
      },
    },
    {
      phase: 'post-newsletter',
      text: '201 Created is a more useful answer than 200 OK: it says a resource now exists that did not before, and the Location field says where. A client can follow it without guessing a URL scheme, which is the difference between an API you can navigate and one you have to read documentation for.',
      reference: { rfc: 9110, section: '15.3.2', title: 'HTTP Semantics: 201 Created' },
    },
    {
      phase: 'get-newsletter',
      text: '405 Method Not Allowed is required to carry an Allow field, and this one does: the resource exists, the method does not apply to it, and here is the list that does. Compare 404, which says nothing about why. The difference between a 404 and a 405 is the difference between "there is nothing here" and "there is something here and you asked it the wrong question".',
      reference: {
        rfc: 9110,
        section: '15.5.6',
        title: 'HTTP Semantics: 405 Method Not Allowed',
      },
    },
    {
      phase: 'get-newsletter',
      text: 'Note what the 201 said about caching: no-store. A response to a POST is not cacheable by default anyway, but no-store goes further and forbids writing it down at all -- which is the right instruction for anything that names a person, and is a different instruction from no-cache. The conditional-request scenario takes that distinction apart.',
      reference: { rfc: 9111, section: '5.2.2.5', title: 'HTTP Caching: no-store' },
    },
  ],
};
