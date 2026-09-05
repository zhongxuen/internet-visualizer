/**
 * Scenario 7 -- four ways to be told something, raced on one clock.
 *
 * The same eight updates, arriving at the same eight moments, delivered four ways over the
 * same wire. Every byte counted comes from a message that was actually built: a realistic
 * browser `GET` with its cookies and `User-Agent`, the real handshake from `upgrade.ts`, real
 * frame headers from `frames.ts`. The polling figure is roughly twenty times the WebSocket
 * figure, and that number is only worth quoting because it was counted rather than claimed.
 *
 * ## The comparison is meant to be fair
 *
 * It would be easy and dishonest to make this a WebSocket advertisement. Each lane carries a
 * verdict saying what that transport is actually good at, and three of them are things a
 * WebSocket is bad at.
 *
 * - **Polling** is stateless. No connection affinity, no sticky routing, no draining on
 *   deploy, and it scales horizontally with literally no coordination. For data that changes
 *   every few minutes it is the right answer, and its worst property -- an average delay of
 *   half the interval -- is often nobody's problem.
 * - **Long polling** is the same infrastructure with the latency removed, at the cost of
 *   holding a request open per client. It works through anything that speaks HTTP/1.1, which
 *   in 2011 meant everything and today still means a surprising amount of corporate
 *   middleware.
 * - **Server-Sent Events** is plain HTTP with automatic reconnection and `Last-Event-ID`
 *   resumption built in, for about eight bytes an event. It is one-directional, which is the
 *   right shape for most live features -- a price ticker, a progress bar, a notification feed
 *   -- and it costs no state on the client beyond an `EventSource`. The reconnection and
 *   replay that the WebSocket scenario had to build by hand come free here.
 * - **WebSocket** wins on bytes and on latency and pays for it in state: sticky routing,
 *   connection draining on deploy, a keepalive to run, and a reconnection strategy to write.
 *
 * ## What the figures assume
 *
 * HTTP/1.1. Under HTTP/2, HPACK compresses a repeated header set down to a handful of bytes,
 * so the polling byte count is an upper bound -- but the **request count** and the number of
 * round trips do not change, and neither does the average delay of half the poll interval.
 * The shape of the argument survives the compression; only the size of it moves.
 */

import type { WebSocketScenario } from '../sim/exchange';

/**
 * The updates being raced for.
 *
 * Irregular on purpose. Evenly spaced updates flatter polling, because a poll interval can be
 * tuned to match them; real events arrive in clumps with quiet stretches between, and that is
 * where a fixed timer does its worst -- three polls returning nothing, then two updates
 * landing in one interval and one of them waiting for the next.
 */
const UPDATES = [
  { at: 1_400, text: 'BTC 41210.55', label: 'price tick' },
  { at: 3_100, text: 'BTC 41208.10', label: 'price tick' },
  { at: 11_800, text: 'BTC 41240.00', label: 'price tick' },
  { at: 12_600, text: 'ETH 2210.90', label: 'price tick' },
  { at: 26_000, text: 'BTC 41199.75', label: 'price tick' },
  { at: 34_400, text: 'order 8812 filled', label: 'order event' },
  { at: 47_500, text: 'BTC 41305.20', label: 'price tick' },
  { at: 52_900, text: 'ETH 2216.40', label: 'order event' },
];

/** Polling, long polling, SSE and WebSocket over the same sixty seconds. */
export const TRANSPORT_COMPARISON: WebSocketScenario = {
  id: 'transport-comparison',
  title: 'Four transports, one minute, eight updates',
  summary:
    'Polling, long polling, Server-Sent Events and a WebSocket delivering the same eight updates over the same sixty seconds, with a running request count and byte bill for each. Every byte comes from a message that was actually built, not estimated.',
  teaches: [
    'Polling’s average delay is half the interval, and no amount of network speed changes that',
    'Halving the poll interval halves the delay and doubles the requests -- there is no setting that gives both',
    'Long polling removes the delay but holds a request open per connected client',
    'SSE is one request, then events at about eight bytes each, with reconnection and Last-Event-ID for free',
    'A WebSocket pays a few hundred bytes once, then two to fourteen bytes of header per message',
    'The figures are HTTP/1.1: HPACK shrinks the polling bytes but not the request count or the latency',
  ],
  plan: {
    kind: 'comparison',
    options: {
      updates: UPDATES,
      durationMs: 60_000,
      // Five seconds is a realistic dashboard poll: often enough to feel live, rare enough
      // that nobody objects to it in review.
      pollIntervalMs: 5_000,
      longPollTimeoutMs: 30_000,
      rttMs: 80,
      turnaroundMs: 20,
      host: 'live.example.com',
      path: '/updates',
    },
  },
  notes: [
    {
      phase: 'race',
      text: 'Read the request counters first, then the byte bill. Polling issues a request every five seconds whether or not anything happened, and most of them return nothing -- but each one still carries the whole cookie jar and User-Agent up and a full response header set back. The wasted requests are the visible cost; the invisible one is the latency, because an update landing just after a poll waits nearly a whole interval and the average delay is half the interval no matter how fast the network is.',
    },
    {
      phase: 'transport-long-polling',
      text: 'Long polling is the same HTTP, held open. The delay collapses to one round trip because the server answers the instant it has something, and the request count falls to roughly one per update plus the occasional timeout. What it costs is a connection held per client for as long as nothing is happening, which on a server that thinks in requests rather than connections is a resource nobody budgeted for.',
    },
    {
      phase: 'transport-sse',
      text: 'One request, then the server writes events down the response body for as long as it likes. About eight bytes an event, no framing to learn, no handshake to verify -- and reconnection with Last-Event-ID resumption built into the browser rather than into your application. That last part is what the reconnection scenario had to build by hand. The catch is in the name: server-sent. Anything the client wants to say goes over a separate ordinary request, which for most live features is exactly the right shape.',
    },
    {
      phase: 'transport-websocket',
      text: 'The handshake is expensive -- larger than an ordinary GET, because of the four Sec-WebSocket-* fields -- and it is paid once. After it, a twelve-character update costs fourteen bytes from the server and eighteen from the client. That is the whole argument, and the bill above measures it. What it does not measure is the state: a WebSocket needs sticky routing, connection draining on deploy, a keepalive, and a reconnection strategy, and none of those appear in a byte count.',
      reference: { rfc: 6455, section: '1.1', title: 'The WebSocket Protocol' },
    },
  ],
};
