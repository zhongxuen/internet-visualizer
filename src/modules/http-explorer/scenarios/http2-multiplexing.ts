/**
 * Scenario 7 -- the same page, three times, and the two different reasons it is slow.
 *
 * Twenty-four resources are fetched from one origin over HTTP/1.1, then HTTP/2, then
 * HTTP/3, across an identical link with an identical packet loss. The three runs are
 * three chapters on one timeline, so the widths can be compared directly; the
 * side-by-side race the version view draws reads the same numbers with all three started
 * at zero.
 *
 * The result, and the whole reason the fixture is tuned the way it is, decomposes exactly:
 *
 * | Version  | Last byte | Behind   | Why, precisely                                |
 * | -------- | --------- | -------- | --------------------------------------------- |
 * | HTTP/3   | ~1228 ms  | --       |                                               |
 * | HTTP/2   | ~1788 ms  | +560 ms  | 280 ms extra handshake + 280 ms transport HOL |
 * | HTTP/1.1 | ~2260 ms  | +1032 ms | the above, plus ~472 ms of application HOL    |
 *
 * Two round numbers, and both of them are exactly one round trip. That is not a
 * coincidence; it is the point of the scenario. Each gap is exactly one thing.
 *
 * ## What each version is fighting
 *
 * **HTTP/1.1** loses to its own queue. A connection carries one exchange at a time, and a
 * browser opens six, so requests seven through twenty-four sit doing nothing until a
 * connection frees. That is **application-layer head-of-line blocking**: the network is
 * idle, the server is idle, and the request is not allowed out. Domain sharding -- serving
 * assets from `img1.`, `img2.`, `img3.` to buy eighteen connections instead of six -- was
 * an entire industry built on working around this one sentence.
 *
 * **HTTP/2** deletes that queue. All twenty-four requests are streams on one connection
 * and all twenty-four go at once. It also stops re-sending the same half-kilobyte of
 * headers twenty-four times: HPACK indexes them against a table both ends keep in step,
 * so the second request onwards costs a handful of bytes.
 *
 * And then it loses a packet, and **every stream stops**. All of them share one TCP byte
 * stream; TCP delivers in order or not at all; so the streams whose own bytes arrived
 * safely sit in the kernel's receive buffer, complete and undeliverable, until the
 * retransmission of somebody else's segment turns up. That is **transport-layer
 * head-of-line blocking**, HTTP/2 does not fix it, and HTTP/2 is *worse at it than
 * HTTP/1.1* -- because h1's six connections mean one lost segment stalls one request
 * instead of all of them.
 *
 * **HTTP/3** is HTTP/2 with the transport replaced. QUIC knows what a stream is, so it
 * recovers loss per stream: the lost packet stalls the stream it belonged to and every
 * other stream is delivered untouched. It also arrives a round trip earlier, because
 * QUIC's handshake carries the TLS 1.3 handshake inside it instead of after it.
 *
 * So the honest summary is not "each version is faster than the last". It is:
 *
 * | Problem                | h1          | h2             | h3      |
 * | ---------------------- | ----------- | -------------- | ------- |
 * | Application-layer HOL  | yes, badly  | **fixed**      | fixed   |
 * | Transport-layer HOL    | per-request | **worse**      | **fixed** |
 * | Setup round trips      | 2           | 2              | **1**   |
 * | Header bytes repeated  | every time  | **once**       | once    |
 *
 * h2 wins here because on this page the queue costs 472 ms and the retransmission costs
 * 280 ms. Widen the queue or clean up the link and h2's lead grows; make the link bad
 * enough and it disappears, because the row it loses on becomes more expensive than the
 * row it wins on. Both of those are real deployments.
 *
 * ## Why this seed
 *
 * The loss is drawn once per resource and fed to all three runs, so the comparison is
 * three protocols meeting one network event rather than three networks. This seed puts
 * that event on `app.js` -- a 142 KB file that is **not** on the critical path, because
 * `hero.avif` at 760 KB finishes later than it does under every version.
 *
 * That detail is what makes the transport-HOL gap measurable rather than theoretical.
 * Under HTTP/3 the stall costs the page nothing at all: `app.js` waits 280 ms for its
 * retransmission, the other streams take the bandwidth it is not using, and it still
 * finishes before the hero image does. Under HTTP/2 the same 280 ms is paid by every
 * stream including the hero, the link goes completely idle for the duration, and the page
 * load moves 280 ms to the right. Had the loss landed on the hero image instead, both
 * versions would have paid the same 280 ms and the difference would have been invisible
 * -- which is itself worth knowing, and is why transport head-of-line blocking is
 * intermittent in practice rather than constant.
 */

import type { HttpScenario } from '../sim/exchange';
import type { ResourceRequest } from '../sim/versions';

import { FIXTURE_ADDRESSES, HTTP_CLOCK } from './common';

/**
 * A page's worth of assets -- twenty-four, which is modest by real standards and four
 * times the six connections HTTP/1.1 has to fetch them with.
 *
 * The distribution matters as much as the count, and each third of it does one job. The
 * sixteen small files make HTTP/1.1's queue expensive. The six medium ones keep several
 * transfers genuinely in flight, so that a lost packet has something to block. The one
 * large image guarantees a critical path that the loss is not on, which is what lets the
 * h2/h3 difference show up in the total rather than cancelling out.
 */
export const PAGE_RESOURCES: readonly ResourceRequest[] = [
  {
    id: 'document',
    label: 'index.html',
    target: '/',
    responseBytes: 46_000,
    serverThinkMs: 40,
    requestHeaderBytes: 620,
  },
  { id: 'hero', label: 'hero.avif', target: '/img/hero.avif', responseBytes: 760_000 },
  { id: 'app-css', label: 'app.css', target: '/s/app.css', responseBytes: 138_000 },
  { id: 'vendor-js', label: 'vendor.js', target: '/s/vendor.js', responseBytes: 146_000 },
  { id: 'app-js', label: 'app.js', target: '/s/app.js', responseBytes: 142_000 },
  {
    id: 'search-json',
    label: 'search.json',
    target: '/api/search.json',
    responseBytes: 136_000,
  },
  {
    id: 'photo-1',
    label: 'photo-1.avif',
    target: '/img/photo-1.avif',
    responseBytes: 144_000,
  },
  {
    id: 'photo-2',
    label: 'photo-2.avif',
    target: '/img/photo-2.avif',
    responseBytes: 140_000,
  },
  {
    id: 'font-body',
    label: 'inter.woff2',
    target: '/f/inter.woff2',
    responseBytes: 12_000,
  },
  {
    id: 'font-mono',
    label: 'mono.woff2',
    target: '/f/mono.woff2',
    responseBytes: 11_000,
  },
  { id: 'icons', label: 'icons.svg', target: '/img/icons.svg', responseBytes: 10_000 },
  { id: 'logo', label: 'logo.svg', target: '/img/logo.svg', responseBytes: 9_000 },
  {
    id: 'analytics',
    label: 'analytics.js',
    target: '/s/analytics.js',
    responseBytes: 11_000,
  },
  { id: 'consent', label: 'consent.js', target: '/s/consent.js', responseBytes: 10_000 },
  ...Array.from({ length: 10 }, (_unused, index) => ({
    id: `thumb-${index + 1}`,
    label: `thumb-${index + 1}.avif`,
    target: `/img/thumb-${index + 1}.avif`,
    responseBytes: 11_000,
  })),
];

/** One page load, run over all three versions on one link with one packet lost. */
export const HTTP2_MULTIPLEXING: HttpScenario = {
  id: 'http2-multiplexing',
  title: 'h1 vs h2 vs h3',
  summary:
    'Twenty-four resources fetched three ways over the same link: HTTP/1.1 queueing behind ' +
    'six connections, HTTP/2 multiplexing them all and then stalling every stream on one ' +
    'lost segment, and HTTP/3 recovering that loss on one stream alone.',
  teaches: [
    'Application-layer HOL is the request queue; HTTP/2 removes it entirely',
    'Transport-layer HOL is TCP delivering in order; HTTP/2 makes it worse, not better',
    'Only HTTP/3 fixes the second one, and only because QUIC replaced TCP',
    "QUIC's handshake includes TLS, so h3 starts a round trip before h1 and h2",
    'HPACK and QPACK are shared tables: the saving starts on the second request',
  ],
  seed: 'http:h2-multiplexing:5',
  version: 'HTTP/2',
  secure: true,
  clock: HTTP_CLOCK,
  conditions: {
    // A decent mobile connection: latency high enough for the queue to cost real
    // wall-clock, and a loss rate low enough that a single packet goes missing rather
    // than a dozen. Both numbers are load-bearing -- see the note on the seed below.
    rttMs: 280,
    bandwidthKbps: 22_000,
    lossRate: 0.0005,
    secure: true,
    resumed: false,
  },
  origins: [
    {
      host: 'www.example.com',
      label: 'www.example.com',
      ipv4: FIXTURE_ADDRESSES.www,
      server: 'simulated-origin (h1, h2, h3)',
      routes: [],
    },
  ],
  steps: [
    {
      kind: 'compare',
      id: 'page-load',
      host: 'www.example.com',
      title: 'The same page, three ways',
      intent:
        'One page, one link, one lost packet, and three protocols reacting to it ' +
        'differently.',
      resources: PAGE_RESOURCES,
    },
  ],
  notes: [
    {
      phase: 'page-load-h1',
      text: 'Six connections, twenty-four requests. Watch the event log: eighteen of them report waiting for a slot before a single byte of theirs leaves the machine. Nothing is wrong with the network during that wait -- the request is simply not allowed out yet, because an HTTP/1.1 connection carries one exchange at a time and all six are busy. This is what domain sharding was invented to work around, and what HTTP/2 removed.',
      reference: { rfc: 9112, section: '9.4', title: 'HTTP/1.1: Concurrency' },
    },
    {
      phase: 'page-load-h1',
      text: 'Every one of those twenty-four requests re-sent its headers in full: the same User-Agent, the same Accept, the same Accept-Encoding, the same cookies if there were any. HTTP/1.1 has no way to say "as before", so a page with a large cookie can spend more upstream bandwidth on repeated headers than on everything it actually asked for.',
      reference: { rfc: 9112, section: '5', title: 'HTTP/1.1: Field Syntax' },
    },
    {
      phase: 'page-load-h2',
      text: 'No request waited for another. All twenty-four are streams on one connection, interleaved frame by frame, and the application-layer queue is gone completely -- that is what HTTP/2 was built to do, and it does it. Compare the two bars: HTTP/2 finished around 472 ms ahead of HTTP/1.1, and that number is the queue and nothing else. The header blocks are HPACK-compressed against a table both ends keep in step, so the first request pays for the vocabulary and the other twenty-three pay a few bytes each.',
      reference: { rfc: 9113, section: '5.1', title: 'HTTP/2: Stream States' },
    },
    {
      phase: 'page-load-h2',
      text: 'Then a segment goes missing, and every stream stops -- including streams whose own bytes had already arrived. They are sitting in the receive buffer, complete, and TCP will not deliver them because TCP delivers one ordered byte stream or nothing. HTTP/2 moved multiplexing above the transport and the transport did not get the memo. This is the half of "HTTP/2 fixes head-of-line blocking" that gets left out, and on this dimension h2 is worse than h1: the segment lost from app.js stalled one request under HTTP/1.1 and every stream on the connection under HTTP/2, for a full round trip each.',
      reference: { rfc: 9113, section: '5.1.1', title: 'HTTP/2: Stream Identifiers' },
    },
    {
      phase: 'page-load-h3',
      text: 'The same packet is lost -- it is drawn once and fed to all three runs, so this is one network event seen three ways. QUIC recovers it on the stream it belonged to and delivers every other stream untouched, so app.js waits 280 ms and the page load waits for none of it: the other streams take the bandwidth app.js is not using, and it still finishes before the hero image. That is half of HTTP/3s lead here; the other half is the round trip it saved on the handshake, and the two happen to be the same 280 ms. QUIC knows what a stream is and TCP never could. That is the whole reason HTTP/3 had to leave TCP behind, and the reason it had to be built on UDP: fixing this inside TCP would have meant changing every middlebox on the Internet.',
      reference: { rfc: 9000, section: '2.2', title: 'QUIC: Sending and Receiving Data' },
    },
    {
      phase: 'page-load-h3',
      text: 'It also started sooner. h1 and h2 pay a TCP handshake and then a TLS 1.3 handshake -- two round trips before the first request byte. QUIC carries the TLS handshake inside its own connection setup, so it costs one. On a resumed connection the gap widens: h3 can send at 0-RTT, in the very first packet, while TCP still has to complete its handshake before TLS has anything to resume onto.',
      reference: {
        rfc: 9114,
        section: '3.1',
        title: 'HTTP/3: Connection Setup and Management',
      },
    },
  ],
};
