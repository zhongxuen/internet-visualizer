/**
 * Scenario 4 -- something gets lost, and TCP puts it back.
 *
 * The same connection as `tcp-web-request`, over the same path, with one difference: the
 * 13 000 km backbone hop between Singapore and Frankfurt drops packets. What that does
 * to the conversation is the whole lesson.
 *
 * **Nothing tells the sender.** No router reports the loss, no ICMP comes back, nothing
 * fails. The segment simply stops existing somewhere in the middle of an ocean, and the
 * only evidence is an acknowledgement that never arrives. So the sender finds out the
 * one way it can -- by waiting, and giving up on waiting:
 *
 * - `sendSegment` moved the sender's `sndNxt` past the bytes. The receiver's `rcvNxt`
 *   never moved, because it never saw them. The gap between the two is the problem.
 * - The retransmission timer expires (RFC 6298: one second before any round trip has
 *   been measured, then three times the smoothed round trip, doubling per retry) and the
 *   sender resends **the same segment, with the same sequence number**.
 * - The receiver takes it as new data if it never arrived, or recognises it as a
 *   duplicate and re-acknowledges if the first copy turned up after all. Either way the
 *   stream is intact and the application above never learns any of this happened.
 *
 * ## Deterministic
 *
 * `rate` is a probability, but the draw is not random: `seed` fixes the stream, and the
 * loss decisions come from their own fork of it (`journey.ts`), so the same packet is
 * lost on every run and two runs are deep-equal. That is what makes the scenario
 * teachable -- the drop lands in the same place every time, so it can be pointed at.
 */

import type { ProtocolLayer } from '@/core/types/pdu';

import type { JourneyScenario } from '../sim/journey';

import { HOME_PUBLIC_IP, JOURNEY_TOPOLOGY, PATH_TO_ORIGIN } from './topology';

/** The request. Small, and none the wiser about what the network is doing to it. */
const HTTP_REQUEST: ProtocolLayer = {
  layer: 'application',
  protocol: 'HTTP/1.1',
  fields: [
    { name: 'Request line', value: 'GET /api/status HTTP/1.1' },
    { name: 'Host', value: 'app.example' },
    { name: 'Accept', value: 'application/json' },
    { name: 'Connection', value: 'keep-alive' },
  ],
  payloadPreview: 'GET /api/status HTTP/1.1\r\nHost: app.example\r\n...',
};

/** The answer, once it gets through. */
const HTTP_RESPONSE: ProtocolLayer = {
  layer: 'application',
  protocol: 'HTTP/1.1',
  fields: [
    { name: 'Status line', value: 'HTTP/1.1 200 OK' },
    { name: 'Content-Type', value: 'application/json' },
    { name: 'Content-Length', value: '318' },
  ],
  payloadPreview: '{"status":"ok","region":"eu-central-1","uptimeSeconds":918273}',
};

/**
 * How often the backbone loses a packet: roughly one in twelve.
 *
 * Bad, but not absurd -- a real intercontinental link losing one packet in five would be
 * an incident rather than a Tuesday, and at that rate the retransmission timer doubles
 * until the run is a minute long and the lesson is lost in the waiting.
 */
const LOSS_RATE = 0.08;

/**
 * The seed, chosen rather than picked at random.
 *
 * The draw is deterministic, so the seed decides *which* packet is lost -- and this one
 * puts the loss on the request's data segment, after the handshake has completed and
 * before anything else can go wrong. That makes the run tell one story cleanly: a
 * segment leaves, nothing comes back, the timer expires, the same bytes go again. Two
 * runs are identical, which is what lets the drop be pointed at rather than waited for.
 */
const LOSS_SEED = 81;

/** A connection across a link that loses packets, and the timer that repairs it. */
export const LOSSY_LINK: JourneyScenario = {
  id: 'lossy-link',
  title: 'Lossy link',
  summary:
    'The same request, over a backbone hop that drops packets. Nothing reports the loss -- the sender finds out when its timer expires, and sends the same bytes again.',
  teaches: [
    'Loss is silent: no router reports it and no error comes back',
    'The retransmission timeout: three times the measured round trip, doubling per retry',
    'A retransmission carries the original sequence number, not a new one',
    'Duplicate detection: the receiver re-acknowledges rather than double-counting',
  ],
  topology: JOURNEY_TOPOLOGY,
  path: PATH_TO_ORIGIN,
  transport: 'tcp',
  clientPort: 49154,
  serverPort: 80,
  nat: { nodeId: 'router', publicIp: HOME_PUBLIC_IP, firstPort: 60000 },
  seed: LOSS_SEED,
  clientIsn: 2_140_500,
  serverIsn: 4_009_800,
  loss: { linkId: 'backbone', rate: LOSS_RATE, maxRetransmissions: 4 },
  writes: [
    {
      from: 'client',
      bytes: 286,
      application: HTTP_REQUEST,
      preview: 'GET /api/status HTTP/1.1',
      phase: {
        id: 'request',
        title: 'Request across a lossy hop',
        description:
          'The request goes out over a backbone link that drops roughly one packet in twelve. This is the one that does not make it -- the seed decides that, the same way on every run.',
      },
      note: {
        text: 'The sender cannot tell a lost segment from a slow one. Both look identical from here: an acknowledgement that has not arrived yet. All it can do is decide how long "yet" is, which is exactly what the retransmission timer is.',
        reference: {
          rfc: 6298,
          section: '5',
          title: 'Computing TCP’s Retransmission Timer',
        },
      },
    },
    {
      from: 'server',
      bytes: 402,
      application: HTTP_RESPONSE,
      preview: 'HTTP/1.1 200 OK',
      phase: {
        id: 'response',
        title: 'The answer, eventually',
        description:
          'The response crosses the same unreliable hop in the other direction. Whatever it costs in time, the application above sees an intact byte stream and nothing else.',
      },
      note: {
        text: 'Every retransmission is invisible above the transport layer. The browser asked for a resource and got one; the extra half-second it took is the only trace, which is why "the internet is slow" is so often a loss problem rather than a bandwidth one.',
      },
    },
  ],
};
