/**
 * `DNS_PROBE_FINISHED_NXDOMAIN` -- the name does not exist.
 *
 * `nope.example.com` is deliberately absent from the bundled `example.com` zone, so the
 * walk goes all the way down to the servers that are authoritative for that part of the
 * tree and they answer, definitively, that there is no such name.
 *
 * The distinction worth drawing is between this and `failure-timeout`. NXDOMAIN is an
 * *answer*: it arrives promptly, it is authoritative, and the resolver is allowed to
 * remember it for a while (RFC 2308). A timeout is the absence of an answer, which is why
 * it takes seconds rather than milliseconds. Users read both as "the site is down" and they
 * are completely different failures at completely different layers.
 *
 * Everything after DNS is reported as never reached, because it never was: TCP needs an
 * address, and there is not one.
 */

import type { SimulatorScenario } from '../sim/stage';

import { HEALTHY_TLS, SITE_ORIGIN } from './common';

export const FAILURE_DNS: SimulatorScenario = {
  id: 'failure-dns',
  title: 'Failure: the name does not exist',
  summary:
    'A name the hierarchy has never heard of. The walk completes, the answer is NXDOMAIN, and the browser shows an error page having sent nothing to the site at all.',
  teaches: [
    'That NXDOMAIN is a definite answer, not a failure to get one',
    'Why this fails in milliseconds and a connection timeout takes seconds',
    'That negative answers are cached too, so the second attempt is faster and still wrong',
  ],
  url: 'https://nope.example.com/',
  profileId: 'cable',
  seed: 'internet-simulator:failure-dns',
  origin: SITE_ORIGIN,
  tls: HEALTHY_TLS,
  notes: [
    {
      phase: 'dns',
      target: 'dns-authoritative',
      text: 'The servers responsible for example.com are the ones saying no, and they are entitled to: they hold the zone, so their absence of a record for this name is a fact rather than a guess. That is what makes the answer authoritative and cacheable.',
    },
  ],
};
