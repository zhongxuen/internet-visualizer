/**
 * Scenario 2 -- an open connection is not the same as a working one.
 *
 * This is the scenario that answers the question nobody asks until production: the socket
 * says OPEN, the code is fine, and no messages are arriving. TCP will not tell you. A
 * connection whose peer has vanished stays writable for minutes -- writes go into a send
 * buffer and succeed, retransmissions run quietly underneath, and the operating system only
 * gives up long after the user has.
 *
 * So liveness has to be asked for, and the protocol provides exactly one way to ask: a ping,
 * which the peer is *obliged* to answer with a pong carrying the identical bytes back.
 *
 * Two things are worth watching for.
 *
 * **The beat is the server's job, in a browser deployment.** Not by convention -- by API. The
 * browser `WebSocket` interface has no `ping()` method and never has. A page can send an
 * application-level heartbeat as a text frame, which costs more and means less, or it can
 * rely on the server pinging it, which browsers answer automatically without telling the page
 * it happened.
 *
 * **Twenty-five seconds is not arbitrary.** It has to be comfortably shorter than the
 * shortest idle timeout anywhere on the path, and the shortest one is usually a NAT table or
 * a load balancer at thirty to sixty seconds. Longer, and the connection is silently evicted
 * between beats; shorter, and a mobile client wakes its radio for ten bytes, which is a
 * battery decision rather than a networking one.
 *
 * The run ends with the beat that gets no answer, because that is the case the mechanism
 * exists for. The server declares the connection dead after the pong timeout and reports
 * 1006 -- a code that never crossed the wire, because nothing crossed the wire. That is the
 * whole point of it.
 */

import type { WebSocketScenario } from '../sim/exchange';

import { PAGE_ORIGIN, WS_HOST } from './common';

/** A keepalive over two minutes, ending in the beat that is never answered. */
export const PING_PONG_KEEPALIVE: WebSocketScenario = {
  id: 'ping-pong-keepalive',
  title: 'Ping, pong, and the beat that is not answered',
  summary:
    'A ping every 25 seconds costs eight bytes and buys two things: proof the peer is alive, and enough traffic that the NAT tables on the path do not evict a flow they think is idle. The fifth beat gets no pong, and the connection is declared dead with a code that was never sent.',
  teaches: [
    'A pong must echo the ping’s application data back byte for byte, which is what lets a sender match a pong to its ping and measure a round trip',
    'Answering a ping is an obligation, not a courtesy -- and browsers do it without telling the page',
    'Browsers cannot send pings: the WebSocket API has no method for it, so the beat is the server’s job',
    'The interval must beat the shortest idle timeout on the path, usually a NAT or load balancer at 30-60 seconds',
    'An open socket is not a working one: TCP writes to a vanished peer keep succeeding for minutes',
    'When the pong never comes, the local API reports 1006 -- never sent on the wire, and carrying no reason because there was nothing to carry one',
  ],
  plan: {
    kind: 'keepalive',
    handshake: {
      resource: '/live',
      host: WS_HOST,
      keySeed: 'keepalive',
      origin: PAGE_ORIGIN,
      policy: { allowedOrigins: [PAGE_ORIGIN] },
    },
    keepalive: {
      // 25 s: comfortably inside a 30 s NAT idle timeout, and cheap enough that a phone can
      // afford it.
      intervalMs: 25_000,
      timeoutMs: 10_000,
      durationMs: 130_000,
      // Five beats fit in the window; the fifth is never answered.
      failAfterPing: 4,
    },
    chatter: [
      {
        at: 8_000,
        from: 'server',
        text: 'price BTC 41210.55',
      },
      {
        at: 41_000,
        from: 'client',
        text: 'subscribe ETH',
      },
      {
        at: 62_000,
        from: 'server',
        text: 'price ETH 2210.90',
      },
    ],
  },
  notes: [
    {
      phase: 'ping-1',
      target: 'server',
      text: 'A ping with no payload is two bytes from the server; the client’s pong carries a masking key, so it is six. Eight bytes every twenty-five seconds is what liveness costs -- about twenty bytes a minute, or a rounding error next to one HTTP request. The round trip a pong measures is also worth more than a fresh ping to the same host: it is measured on this connection, through the same proxies and the same queues the application’s own messages travel through.',
      reference: { rfc: 6455, section: '5.5.2', title: 'The WebSocket Protocol' },
    },
    {
      phase: 'ping-3',
      text: 'Application traffic has been flowing between the beats, and the beats keep going anyway. That is deliberate: "the connection is busy" is not something the NAT box on the path can see from outside if the traffic all happens to be in one direction, and a keepalive that stops when it thinks it is unnecessary is a keepalive that stops right before it was needed.',
    },
    {
      phase: 'ping-5',
      target: 'server',
      text: 'No pong. The peer may have crashed, changed networks, or driven into a tunnel -- from here the three are indistinguishable, and that is exactly the point. TCP has not reported anything and will not for minutes, so the only thing that noticed is the pong that did not come back.',
      reference: { rfc: 6455, section: '7.1.7', title: 'The WebSocket Protocol' },
    },
    {
      phase: 'declared-dead',
      text: 'The close code is 1006, and 1006 is never sent on the wire. There was no Close frame -- that is what 1006 means. It is a value the local API invents at the moment it gives up, so looking it up in a table of protocol codes finds nothing to explain, because it is the name for the absence of an explanation. 1005 and 1015 work the same way. What the code does tell you is that wasClean is false, and the reconnection scenario is what happens next.',
      reference: { rfc: 6455, section: '7.4.1', title: 'The WebSocket Protocol' },
    },
  ],
};
