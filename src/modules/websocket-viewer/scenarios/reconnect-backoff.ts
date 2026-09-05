/**
 * Scenario 6 -- what happens after 1006.
 *
 * The connection vanishes without a Close frame: a phone changes network, a load balancer
 * drains a node, a laptop lid shuts. There is no code on the wire because there was no wire,
 * so the local API reports 1006 and the application is told only that it is on its own.
 *
 * What it does next is the entire scenario, and there are two separate lessons in it.
 *
 * **The exponent saves the client.** Retrying immediately, forever, against a server that is
 * not answering achieves nothing except heat. Doubling the wait each time means a client that
 * comes back quickly when the outage was brief and stops hammering when it was not.
 *
 * **The jitter saves the server**, and it is the half people leave out. WebSocket clients
 * disconnect in *herds*: one server restart drops every connection it had within the same
 * second. Without randomisation they all wait exactly one second, all reconnect in the same
 * instant, all fail together, all wait exactly two -- a synchronised wave that meets the
 * recovering server at every step and can keep it down indefinitely. The panel draws both
 * schedules, and the difference between them is the difference between an outage that ends
 * and one that does not.
 *
 * **And a new connection is a new connection.** The server has no memory of the old one, no
 * way to know which messages this client already saw, and no obligation to have kept them.
 * Whatever was missed has to be asked for explicitly, from a cursor the client kept for
 * itself -- which is a thing Server-Sent Events gets for free with `Last-Event-ID` and a
 * WebSocket application has to build. That is a real point in SSE's favour and this scenario
 * makes it rather than glossing it.
 */

import type { WebSocketScenario } from '../sim/exchange';

import { PAGE_ORIGIN, WS_HOST } from './common';

/** A drop with no Close frame, then exponential backoff with full jitter. */
export const RECONNECT_BACKOFF: WebSocketScenario = {
  id: 'reconnect-backoff',
  title: 'Dropped, and coming back politely',
  summary:
    'The transport vanishes with no Close frame, so the client is told 1006 and nothing else. It retries with an exponentially growing window and a delay drawn randomly from inside it -- and then has to ask for everything it missed, because the new connection remembers nothing.',
  teaches: [
    '1006 means no Close frame arrived; it is never sent on the wire and carries no reason',
    'The exponent protects the client; the randomisation protects the server, and is the half usually omitted',
    'Clients disconnect in herds, so a synchronised retry wave can keep a recovering server down',
    'Full jitter draws the delay uniformly from [0, cap] -- the cap grows, the delay is random inside it',
    'A reconnection is a new connection: new handshake, new key, and no memory of the old one',
    'Message replay after a gap is the application’s problem on a WebSocket, and SSE’s Last-Event-ID gets it for free',
  ],
  conditions: { rttMs: 85 },
  plan: {
    kind: 'reconnect',
    handshake: {
      resource: '/feed',
      host: WS_HOST,
      keySeed: 'reconnect',
      origin: PAGE_ORIGIN,
      policy: { allowedOrigins: [PAGE_ORIGIN] },
    },
    before: [
      { from: 'server', text: '{"seq":41,"event":"order.filled"}' },
      { from: 'server', text: '{"seq":42,"event":"order.filled"}' },
    ],
    dropAtMs: 900,
    dropReason: 'the load balancer drained this node mid-deploy',
    backoff: {
      baseMs: 1_000,
      factor: 2,
      maxMs: 30_000,
      // Full jitter: uniform in [0, cap]. `none` is the version everybody writes first and
      // the one that causes the outage.
      jitter: 'full',
      seed: 'reconnect-backoff',
    },
    attempts: 5,
    // The first two find a server that is still restarting.
    succeedsOn: 3,
    resumeCursor: '{"resume_from":42}',
    after: [
      { from: 'server', text: '{"seq":43,"event":"order.filled"}' },
      { from: 'server', text: '{"seq":44,"event":"order.cancelled"}' },
    ],
  },
  notes: [
    {
      phase: 'transport-lost',
      text: 'No Close frame, so no code came from the peer -- and the API still has to report something, so it reports 1006 with an empty reason and wasClean false. That is the entire content of the event: something ended and nobody said why. Note what the application cannot distinguish from here: a crashed server, a dropped Wi-Fi connection, a phone moving between cells, and a proxy evicting an idle flow all look exactly like this.',
      reference: { rfc: 6455, section: '7.4.1', title: 'The WebSocket Protocol' },
    },
    {
      phase: 'attempt-1',
      text: 'The window is 1000 ms and the delay is drawn from inside it, not set to it. That distinction is the whole mechanism: every client that dropped in the same second computes the same window and a different delay, so the herd spreads across it instead of arriving together. The panel below shows the same schedule with the randomisation removed -- a clean doubling, identical for every client, which is exactly what synchronises the wave.',
      reference: { rfc: 6455, section: '7.2.3', title: 'The WebSocket Protocol' },
    },
    {
      phase: 'attempt-3',
      text: 'A fresh handshake, with a fresh Sec-WebSocket-Key: a nonce reused across connections would let a cached 101 from the previous one be replayed as an answer to this one. Everything else is new too -- new TCP connection, new TLS session unless it resumed, new subprotocol negotiation, and a server that has never heard of this client.',
      reference: { rfc: 6455, section: '4.1', title: 'The WebSocket Protocol' },
    },
    {
      phase: 'resume',
      text: 'The client asks for everything after sequence 42, because nothing else will. A WebSocket has no equivalent of Last-Event-ID: the protocol delivers frames on a connection and has no opinion about what happened while there was not one. So an application that must not lose messages needs a sequence number on every message, a client that remembers the last one it saw, and a server that can replay from it -- three things to build and get right, and the honest cost of choosing a WebSocket over Server-Sent Events for a one-directional feed.',
    },
  ],
};
