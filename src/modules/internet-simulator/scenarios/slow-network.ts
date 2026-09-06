/**
 * The same cold page load, on a 200 ms mobile link.
 *
 * Identical in every respect to `first-visit-https` except the profile, which makes it the
 * controlled experiment: everything that differs between the two runs is caused by latency
 * and bandwidth alone.
 *
 * 3G is slow twice over -- 200 ms of round trip *and* 1.6 Mbit/s of capacity -- and the two
 * do different damage. The handshakes grow with the latency: DNS, TCP, and TLS between them
 * cost several round trips, and each one is now a fifth of a second, so more time is spent
 * asking permission than the whole document takes to arrive. The transfers grow with the
 * bandwidth, and they grow further still, which is why the setup's *share* of this load
 * actually falls even though its cost multiplied.
 *
 * Which is why the profile control is the thing to reach for on this scenario. Switch it to
 * **Satellite**: more bandwidth than 3G, three times the latency, and a slower page load in
 * which the handshakes now dominate outright. That comparison isolates round trips as the
 * thing a page load is really made of, and it is the argument for every optimisation
 * elsewhere in this module -- connection reuse, TLS 1.3, 0-RTT resumption, HTTP/3, and
 * putting an edge near the user. None of them make the wire faster. They all remove round
 * trips.
 */

import type { SimulatorScenario } from '../sim/stage';

import { HEALTHY_TLS, SITE_HOST, SITE_ORIGIN } from './common';

export const SLOW_NETWORK: SimulatorScenario = {
  id: 'slow-network',
  title: 'Slow network',
  summary:
    'The cold first visit again, over a 200 ms mobile link with a fraction of the capacity. The page is unchanged; both halves of the cost went up, and not by the same amount.',
  teaches: [
    'That latency and bandwidth make a page load slow in different ways',
    'Why every handshake optimisation of the last decade targeted round trips',
    'That a satellite link with more bandwidth than 3G is still slower, and why',
  ],
  url: `https://${SITE_HOST}/`,
  profileId: '3g',
  seed: 'internet-simulator:slow-network',
  origin: SITE_ORIGIN,
  tls: HEALTHY_TLS,
  notes: [
    {
      phase: 'tcp',
      text: 'One round trip, and on this link that is 200 ms in which nothing whatsoever happens. This is the cost that keep-alive, TLS resumption, and QUIC all exist to avoid paying twice.',
    },
    {
      phase: 'render',
      text: 'This is where bandwidth finally bites: 346 KB of subresources over a 1.6 Mbit/s link. Everything before this stage was latency, and no amount of capacity would have helped it.',
    },
  ],
};
