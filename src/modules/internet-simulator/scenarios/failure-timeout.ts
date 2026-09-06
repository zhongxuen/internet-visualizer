/**
 * `ERR_CONNECTION_TIMED_OUT` -- the address is right and nothing is listening.
 *
 * DNS succeeds: the name resolves, and the browser has an address. What it does not have is
 * anybody willing to answer at it. The SYN goes out, nothing comes back, and the client
 * retransmits on a timer that doubles each attempt -- one second, two, four, eight -- and
 * finally gives up.
 *
 * The reason this takes fifteen seconds rather than fifteen milliseconds is the *silence*.
 * A host that is up and refusing sends RST and the failure is instant; a packet filter drops
 * the segment and says nothing, which leaves the client unable to distinguish "nothing is
 * there" from "still in flight". It has no choice but to wait out the timer, and the timer
 * doubles because a network that lost one segment is more likely to lose the next
 * (RFC 6298 s5.5).
 *
 * The connection sits in `SYN_SENT` for the whole thing, which is what makes the state
 * readout worth watching: it is the one page load in the set where the interesting thing on
 * screen is a state that never changes.
 */

import type { SimulatorScenario } from '../sim/stage';

import { HEALTHY_TLS, SITE_HOST, SITE_ORIGIN } from './common';

export const FAILURE_TIMEOUT: SimulatorScenario = {
  id: 'failure-timeout',
  title: 'Failure: the connection times out',
  summary:
    'The name resolves and the address is correct, but nothing answers the SYN. Four attempts on a doubling timer, then the browser gives up.',
  teaches: [
    'Why a filtered port fails slowly and a refused one fails instantly',
    'What exponential backoff is for, and what it costs when there is nothing to back off from',
    'That a working DNS answer tells you nothing about whether the host is reachable',
  ],
  url: `https://${SITE_HOST}/`,
  profileId: 'cable',
  seed: 'internet-simulator:failure-timeout',
  origin: SITE_ORIGIN,
  tls: HEALTHY_TLS,
  tcp: { blackholed: true, synRetries: 3, initialRtoMs: 1000 },
  notes: [
    {
      phase: 'tcp',
      text: 'Every segment on this diagram is the same segment. A retransmission carries the sequence number the original carried -- that is what lets a receiver recognise it as a duplicate rather than as new data, and it is why the state machine has not moved.',
    },
  ],
};
