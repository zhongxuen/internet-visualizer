/**
 * The same page, seven minutes later.
 *
 * Every saving available to a browser, applied at once -- and each of them a different kind
 * of saving, which is the reason this run is worth watching rather than just measuring:
 *
 * - **The resolver already knows the name**, so the DNS stage is a memory lookup rather
 *   than a walk from the root.
 * - **TLS resumes from a ticket, at 0-RTT**, so there is no certificate, no signature to
 *   verify, and no waiting at all: the request rides in the first packet, encrypted under a
 *   key kept from last time. The TLS stage costs nothing, which is what the rail shows.
 * - **The document is stale but not gone**, so the request that goes out is conditional and
 *   the answer is a 304 with no body: one round trip instead of a 34 KB transfer.
 * - **The four assets are still fresh**, so they are not requested at all. A repeat visit's
 *   waterfall is mostly empty, and that emptiness is the whole lesson.
 *
 * Compared with `first-visit-https` on the same link, nothing about the page changed. All
 * that changed is how much of it had to be asked for again.
 */

import type { SimulatorScenario } from '../sim/stage';

import {
  GOOD_CHAIN,
  SCENARIO_EPOCH,
  SITE_HOST,
  SITE_ORIGIN,
  TRUST_STORE,
  WARM_STORE,
} from './common';

export const REPEAT_VISIT_CACHED: SimulatorScenario = {
  id: 'repeat-visit-cached',
  title: 'Repeat visit, warm',
  summary:
    'The same page a few minutes later: a cached name, a resumed TLS session, a 304 for the document, and four assets that are never requested at all.',
  teaches: [
    'That "cached" is not one thing -- a fresh hit, a 304, and a resumed handshake each save something different',
    'Why a stale entry still saves the body, and what the two validator fields do',
    'What TLS resumption removes from a handshake, and what it does not',
  ],
  url: `https://${SITE_HOST}/`,
  profileId: 'cable',
  seed: 'internet-simulator:repeat-visit',
  origin: SITE_ORIGIN,
  dns: { warm: true },
  tls: {
    version: '1.3',
    chain: GOOD_CHAIN,
    store: TRUST_STORE,
    validationAt: SCENARIO_EPOCH,
    alpn: 'h2',
    resume: true,
    earlyData: true,
  },
  stored: [...WARM_STORE],
  notes: [
    {
      phase: 'cache-check',
      text: 'Two different answers out of one cache. The document is stale, so it will be revalidated; the stylesheet, script, font, and image are still fresh, so they will not be asked for at all.',
    },
    {
      phase: 'tls',
      target: 'origin',
      text: 'No certificate crossed the wire. A resumed handshake authenticates with a key both ends already share, which removes the chain, the signature over it, and the verification that goes with them. At 0-RTT it also removes the waiting -- at the cost of replayability, which is why 0-RTT is only safe for a request that can be executed twice.',
    },
  ],
};
