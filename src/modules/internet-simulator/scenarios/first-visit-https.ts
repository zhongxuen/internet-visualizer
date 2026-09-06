/**
 * Cold everything.
 *
 * The baseline the other seven are measured against, and the answer to "why does a site
 * take most of a second to appear when the file is only 34 KB?". Nothing is cached
 * anywhere: the resolver has to walk from the root, the connection has to be opened, the
 * handshake has to be done in full with a certificate, and only then is the request sent.
 *
 * Read the stage rail rather than the total. Four of the eight stages -- DNS, TCP, TLS, and
 * the request itself -- move no content at all. They are the price of being allowed to ask.
 */

import type { SimulatorScenario } from '../sim/stage';

import { HEALTHY_TLS, SITE_HOST, SITE_ORIGIN } from './common';

export const FIRST_VISIT_HTTPS: SimulatorScenario = {
  id: 'first-visit-https',
  title: 'First visit, cold',
  summary:
    'A browser that has never seen this site: a full DNS walk, a TCP handshake, a full TLS handshake, and only then the page and everything it asks for.',
  teaches: [
    'How much of a page load happens before the request has even been sent',
    'Why a render-blocking stylesheet decides when the first frame appears',
    'That the largest contentful paint carries the cost of every stage before it',
  ],
  url: `https://${SITE_HOST}/`,
  profileId: 'cable',
  seed: 'internet-simulator:first-visit',
  origin: SITE_ORIGIN,
  tls: HEALTHY_TLS,
  notes: [
    {
      phase: 'dns',
      target: 'resolver',
      text: 'None of this is the page. This is the browser finding out where to send the request, and on a cold cache it takes several exchanges with machines that do not have the answer and only know who might.',
    },
    {
      phase: 'render',
      text: 'The document arrived and the page load started again: five more requests, four of which the parser only found out about by reading the HTML.',
    },
  ],
};
