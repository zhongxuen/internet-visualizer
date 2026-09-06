/**
 * The edge already had it.
 *
 * `shop.example.com` is a CNAME out to `edge.cdn.example.net` in the bundled zones, which
 * is exactly how a site is pointed at a CDN in practice: the name resolves to a machine
 * near the user, and the connection terminates there rather than at the origin.
 *
 * The stage rail makes the payoff visible. The CDN stage is a shared-cache lookup and a
 * response, and the origin -- a 140 ms round trip and a 45 ms think away -- is never
 * contacted at all. Note the `Age` field on what comes back: it is the only visible
 * difference between this and a fresh answer, and it is how you tell a CDN hit from a
 * fast origin.
 */

import type { SimulatorScenario } from '../sim/stage';

import { ADDRESSES, CDN_HOST, HEALTHY_TLS, SITE_ORIGIN } from './common';

export const CDN_HIT: SimulatorScenario = {
  id: 'cdn-hit',
  title: 'CDN hit',
  summary:
    'The connection ends at an edge a few milliseconds away, and the edge has the page already. The origin never hears about this request.',
  teaches: [
    'That a CDN edge is an ordinary shared HTTP cache, obeying the same RFC 9111 rules',
    'What the Age field tells you, and why it is the giveaway',
    'How much of a page load is distance rather than work',
  ],
  url: `https://${CDN_HOST}/`,
  profileId: 'cable',
  seed: 'internet-simulator:cdn-hit',
  origin: SITE_ORIGIN,
  cdn: {
    address: ADDRESSES.edge,
    label: 'CDN edge (shop)',
    originRttMs: 140,
    warm: { storedSecondsAgo: 18 },
  },
  tls: HEALTHY_TLS,
  notes: [
    {
      phase: 'dns',
      target: 'resolver',
      text: 'Pointing a name at a CDN costs an extra walk: shop.example.com is an alias, so the resolver has to resolve the alias too, in a different part of the tree. The 30-second TTL on it -- short, so the CDN can move traffic quickly -- means this happens often.',
    },
    {
      phase: 'cdn',
      target: 'edge',
      text: 'A shared cache holds everybody’s copy, which is why it is already warm for a visitor who has never been here. It is also why its rules differ from the browser’s private cache: a shared cache refuses to store anything marked private.',
    },
  ],
};
