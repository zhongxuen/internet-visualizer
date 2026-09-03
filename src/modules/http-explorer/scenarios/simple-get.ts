/**
 * Scenario 1 -- one request, one response, and the blank line between them.
 *
 * Everything else in this module is a variation on this picture, so it goes first and it
 * does exactly one thing: put a whole HTTP/1.1 exchange on screen as the bytes it
 * actually is. A start-line, some field lines, **an empty line**, and then the body.
 *
 * That empty line is the entire framing mechanism of HTTP/1.1. It is not a stylistic
 * separator between "the headers section" and "the content"; it is the only signal a
 * parser has that the fields are over, and `Content-Length` is the only signal it has for
 * where the body ends. Everything strange about HTTP/1.1 -- chunked transfer encoding,
 * header injection, request smuggling -- descends from those two facts, and none of it
 * makes any sense until you have seen the blank line once.
 *
 * The exchange is deliberately cleartext. This is the one scenario where what the wire
 * view shows and what an observer on the path would see are the same thing, and it is
 * worth being able to say that plainly before phase 09 takes it away.
 */

import { header } from '../sim/message';
import type { HttpScenario } from '../sim/exchange';

import { FIXTURE_ADDRESSES, HTTP_CLOCK, daysBefore } from './common';

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>example.com</title>
  </head>
  <body>
    <h1>It works</h1>
    <p>You are looking at 512 bytes that crossed a network as text.</p>
  </body>
</html>
`;

/** A cleartext GET, answered in full, with nothing cached and nothing clever. */
export const SIMPLE_GET: HttpScenario = {
  id: 'simple-get',
  title: 'A simple GET',
  summary:
    'One request and one response over cleartext HTTP/1.1, shown as the literal bytes: ' +
    'the request-line, the field lines, the blank line that ends them, and the body.',
  teaches: [
    'The blank line is the framing: it is what ends the fields, not a separator',
    'Host is mandatory in HTTP/1.1, and is what makes name-based virtual hosting work',
    'Content-Length counts octets, not characters',
    'A 200 with Cache-Control and ETag has already set up every later scenario',
  ],
  seed: 'http:simple-get',
  version: 'HTTP/1.1',
  secure: false,
  clock: HTTP_CLOCK,
  conditions: { rttMs: 60, bandwidthKbps: 20_000 },
  origins: [
    {
      host: 'example.com',
      label: 'example.com',
      ipv4: FIXTURE_ADDRESSES.example,
      server: 'nginx (simulated)',
      thinkMs: 14,
      routes: [
        {
          path: '/index.html',
          status: 200,
          conditional: true,
          headers: [
            header('Content-Type', 'text/html; charset=utf-8'),
            header('Cache-Control', 'max-age=300'),
            header('ETag', '"9f2c-home-v4"'),
            header('Last-Modified', daysBefore(3)),
          ],
          body: PAGE,
        },
      ],
    },
  ],
  steps: [
    {
      kind: 'request',
      id: 'get-index',
      title: 'GET /index.html',
      host: 'example.com',
      target: '/index.html',
      intent:
        'A browser asks for one page. The connection has to be opened first, which is a ' +
        'round trip nobody asked for and everybody pays.',
      initiator: { pageOrigin: 'http://example.com', topLevelNavigation: true },
    },
  ],
  notes: [
    {
      phase: 'get-index',
      text: 'Read the request in the wire view with the CRLF toggle on. Every line ends in a carriage return and a line feed -- two bytes, not one -- and then there is a line consisting of nothing but those two bytes. That empty line is where the fields stop and the body starts. It is the whole of HTTP/1.1 framing, and a server that let a field value contain a stray CRLF would let a client invent one.',
      reference: { rfc: 9112, section: '2.1', title: 'HTTP/1.1: Message Format' },
    },
    {
      phase: 'get-index',
      text: 'Host is the one field HTTP/1.1 made mandatory, and it is the reason a single address can serve a thousand sites. The request-line carries only a path, so without Host the server would have no way of knowing which site the path belongs to -- which is exactly the situation HTTP/1.0 was in, and why one site meant one IP address.',
      reference: { rfc: 9112, section: '3.2', title: 'HTTP/1.1: Request Target' },
    },
    {
      phase: 'get-index',
      text: 'Content-Length is a count of octets, not of characters. The distinction is invisible until a body contains anything outside ASCII: "cafe" with an accent is four characters and five bytes, and a server that sent the character count would truncate its own response by one byte and leave the connection out of step for whatever came next.',
      reference: { rfc: 9110, section: '8.6', title: 'HTTP Semantics: Content-Length' },
    },
    {
      phase: 'get-index',
      text: 'The response carries Cache-Control: max-age=300 and an ETag, neither of which does anything here. They are what the next three scenarios are made of: the first says how long this copy may be reused without asking, the second gives the server a way to say "still that one" in a reply with no body at all.',
      reference: { rfc: 9111, section: '5.2', title: 'HTTP Caching: Cache-Control' },
    },
  ],
};
