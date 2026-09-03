/**
 * Scenario 5 -- a name that does not exist, and how long that is remembered.
 *
 * `nope.example.com` is asked for twice, and the shape of the run is deliberately
 * identical to `warm-cache`: a full walk, then nothing at all. That symmetry is the
 * point. **A negative answer is an answer**, cached like any other, and a resolver that
 * did not cache it would re-walk the tree for every typo, every stale link, and every
 * misconfigured mail server on the Internet -- which is a meaningful fraction of all DNS
 * traffic.
 *
 * ## What comes back, and where the lifetime comes from
 *
 * The authoritative server returns RCODE 3, NXDOMAIN, with an **empty answer section and
 * the zone's SOA record in the authority section**. The SOA is not decoration: its
 * MINIMUM field, together with the record's own TTL, is what tells the resolver how long
 * it may remember the bad news (RFC 2308 s5). A negative answer with no SOA carries no
 * permission to cache and has to be asked again next time.
 *
 * Here the SOA MINIMUM is 300, so the second lookup is answered from memory with five
 * minutes on the clock -- and the entire hierarchy is skipped exactly as it was for a
 * name that does exist.
 *
 * ## The distinction people miss
 *
 * NXDOMAIN means **the name does not exist**, at all, for any type. It is a statement
 * about the name, which is why the cache files it against the name alone and why asking
 * for the AAAA of a name whose A returned NXDOMAIN is answered from cache without a
 * query.
 *
 * That is a different fact from **NODATA**: RCODE 0, NOERROR, an empty answer section,
 * and an SOA in the authority section. The name is fine; it simply has no record of the
 * type you asked for. `example.com` has no SRV record and that is not an error -- and a
 * resolver caches the two separately, because "there is no such name" and "there is no
 * such record at this name" are answers to different questions.
 */

import type { DnsScenario } from './run';

/** A name that is not there, twice: once the hard way, once from memory. */
export const NXDOMAIN: DnsScenario = {
  id: 'nxdomain',
  title: 'NXDOMAIN',
  summary:
    'A name that does not exist, asked for twice. The first walk goes all the way to the authoritative server to be told no; the second is answered from the negative cache, with the SOA deciding how long "no" lasts.',
  teaches: [
    'Only the authoritative server can say a name does not exist',
    'The SOA in the authority section is what licenses caching the answer',
    'Negative caching (RFC 2308), and why DNS would drown without it',
    'NXDOMAIN is about the name; NODATA is about the type',
  ],
  seed: 'dns:nxdomain',
  lookups: [
    {
      name: 'nope.example.com',
      type: 'A',
      intent:
        'A name nobody ever published -- a typo, a stale link, a decommissioned host. The resolver has no way to know that until it asks.',
    },
    {
      name: 'nope.example.com',
      type: 'A',
      intent: 'The same non-existent name again. It costs nothing this time.',
    },
  ],
  notes: [
    {
      phase: 'root',
      text: 'The root cannot say this name does not exist. It only knows that .com is delegated, so it refers -- exactly as it would for a name that does exist. Non-existence is a fact about a zone, and only the server holding that zone is in a position to assert it.',
      reference: {
        rfc: 1034,
        section: '4.3.2',
        title: 'Domain Names -- Concepts and Facilities',
      },
    },
    {
      phase: 'authoritative',
      text: "RCODE 3, NXDOMAIN: an empty answer section, and the zone's SOA record in the authority section. The SOA is what makes the answer cacheable at all -- its MINIMUM field, capped against the record's own TTL, is the resolver's permission to remember this and for how long. Here that is 300 seconds.",
      reference: {
        rfc: 2308,
        section: '5',
        title: 'Negative Caching of DNS Queries (DNS NCACHE)',
      },
    },
    {
      phase: 'answer',
      text: 'NXDOMAIN is a statement about the name, not about the type, so it is filed against the name alone: asking for the AAAA of this name would now be answered from cache too, without a query. That is a different fact from NODATA -- NOERROR with an empty answer section -- which means the name is fine and simply has no record of that type.',
      reference: {
        rfc: 2308,
        section: '2.2',
        title: 'Negative Caching of DNS Queries (DNS NCACHE)',
      },
    },
    {
      phase: 'cache',
      text: 'Remembered, with a few seconds gone off the five minutes. A resolver that did not cache negative answers would re-walk the entire tree for every typo, every dead link, and every misconfigured mail server -- and those are a meaningful fraction of all the queries there are. Caching "no" matters roughly as much as caching "yes".',
      reference: {
        rfc: 2308,
        section: '1',
        title: 'Negative Caching of DNS Queries (DNS NCACHE)',
      },
    },
    {
      phase: 'answer-2',
      text: 'The same failure, delivered in three milliseconds instead of eighty, and with nothing on the wire past the resolver. When the five minutes are up the entry expires and the next asker pays for the full walk again -- which is why creating a name you have just been told does not exist can take a few minutes to become visible.',
    },
  ],
};
