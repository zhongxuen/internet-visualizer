/**
 * Scenario 2 -- the same question twice, and the difference between the two.
 *
 * This is `cold-cache`'s first lookup with one thing changed: it is asked again. The
 * contrast is the entire scenario, and it is best seen on one timeline rather than by
 * remembering what the previous run looked like.
 *
 * - **First time.** Three servers, two referrals, one answer, ~80 ms of virtual time.
 * - **Second time.** No servers. No referrals. No packet leaves the resolver at all.
 *   Three milliseconds, almost all of which is the two hops to the client and back.
 *
 * The diagram makes the same point structurally: the second lookup draws no arrows past
 * the resolver, because there is nothing to draw. A cache is not a speed-up bolted onto
 * DNS, it is the mechanism that makes the hierarchy usable -- without it every lookup on
 * Earth would terminate at thirteen root server addresses.
 *
 * ## The detail worth pausing on
 *
 * The TTL comes back **smaller the second time**. A cached record is handed on with what
 * is left of its lifetime, not with the value the zone published (RFC 1035 s4.1.3), so a
 * TTL is a countdown that every cache it passes through continues rather than restarts.
 * That is why a record's real lifetime in the wild is up to twice its TTL, and why
 * lowering a TTL before a migration has to happen a full TTL *before* the migration.
 *
 * What is cached is also more than the answer. The delegations for `com` and for
 * `example.com`, and the glue addresses that came with them, are all in the cache now --
 * each with its own much longer lifetime, since infrastructure changes far less often
 * than the records it points at. That is why `cold-cache`'s second question skips
 * straight to the authoritative server even though its answer was never cached.
 */

import type { DnsScenario } from './run';

/** One question, asked twice, on one timeline. */
export const WARM_CACHE: DnsScenario = {
  id: 'warm-cache',
  title: 'Warm cache',
  summary:
    'The identical question asked twice in a row. The first walk contacts three servers; the second contacts none and is over before the first had finished talking to the root.',
  teaches: [
    'A cache hit short-circuits the whole hierarchy, not part of it',
    'TTLs count down as an answer is passed on, and never restart',
    'Delegations and glue are cached separately, and for far longer',
    'Why DNS scales: almost every query in the world is answered from memory',
  ],
  seed: 'dns:warm-cache',
  lookups: [
    {
      name: 'example.com',
      type: 'A',
      intent: 'A cold resolver, so this is the full walk -- root, TLD, then the zone.',
    },
    {
      name: 'example.com',
      type: 'A',
      intent: 'The same question, a few milliseconds later. Watch what does not happen.',
    },
  ],
  notes: [
    {
      phase: 'authoritative',
      text: 'This answer arrives with a TTL of 3600: one hour during which no resolver holding it needs to ask again. Everything the walk learned on the way -- the com delegation, the example.com delegation, the glue for both -- is cached too, with lifetimes of two days, because nameservers move far less often than the records they serve.',
      reference: {
        rfc: 1035,
        section: '3.2.1',
        title: 'Domain Names -- Implementation and Specification',
      },
    },
    {
      phase: 'question-2',
      text: 'The same name, the same type, a few milliseconds later. Compare what follows this arrow with what followed the first one.',
    },
    {
      phase: 'cache',
      text: 'No root server. No TLD server. No authoritative server. Nothing is put on a wire, which is why there is no packet to watch: the answer was already in memory and the resolver simply reads it out. This is what the overwhelming majority of DNS queries on the Internet look like, and it is the only reason thirteen root server addresses are enough.',
      reference: {
        rfc: 1034,
        section: '4.3.4',
        title: 'Domain Names -- Concepts and Facilities',
      },
    },
    {
      phase: 'answer-2',
      text: 'The TTL on this answer is lower than on the first one, by exactly the time that has passed. A cache hands on what is left of a lifetime rather than reissuing it, so a TTL is a countdown that continues across every cache it crosses -- which is why lowering a TTL before a migration has to be done a full TTL ahead of the migration.',
      reference: {
        rfc: 1035,
        section: '4.1.3',
        title: 'Domain Names -- Implementation and Specification',
      },
    },
  ],
};
