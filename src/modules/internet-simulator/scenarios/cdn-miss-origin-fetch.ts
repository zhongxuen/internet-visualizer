/**
 * The edge did not have it, and had to go and ask.
 *
 * The same page and the same edge as `cdn-hit`, with exactly one thing removed: the edge's
 * cache is empty. Everything else is identical, so the difference between the two runs is
 * precisely what a miss costs -- one round trip out to the origin, plus the origin's own
 * think time, paid by a user who is sitting there waiting.
 *
 * This is the run that explains cache-hit ratios. A CDN does not make the origin faster; it
 * makes reaching the origin *rare*. The first visitor after an eviction pays this, and
 * everybody after them gets `cdn-hit`.
 */

import type { SimulatorScenario } from '../sim/stage';

import { ADDRESSES, CDN_HOST, HEALTHY_TLS, SITE_ORIGIN } from './common';

export const CDN_MISS_ORIGIN_FETCH: SimulatorScenario = {
  id: 'cdn-miss-origin-fetch',
  title: 'CDN miss, origin fetch',
  summary:
    'The same edge with an empty cache: the request is forwarded to the origin, and the user waits out the whole round trip plus the origin’s own work.',
  teaches: [
    'What a cache miss costs, measured against the hit rather than asserted',
    'That the client sees one request and one response however many hops were behind it',
    'Why the next visitor gets the fast version, and this one paid for it',
  ],
  url: `https://${CDN_HOST}/`,
  profileId: 'cable',
  seed: 'internet-simulator:cdn-miss',
  origin: SITE_ORIGIN,
  cdn: {
    address: ADDRESSES.edge,
    label: 'CDN edge (shop)',
    originRttMs: 140,
  },
  tls: HEALTHY_TLS,
  notes: [
    {
      phase: 'cdn',
      target: 'edge',
      text: 'Watch where the time goes: the edge is a few milliseconds away and the origin is 140 ms behind it. On a miss the user pays for both, and the edge has bought nothing at all except the chance to be faster next time.',
    },
  ],
};
