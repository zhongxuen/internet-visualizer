/**
 * Scenario 6 -- an answer that can be proved, and everything that costs.
 *
 * `example.org` is signed and its parent publishes a matching DS, so this is the
 * complete, working chain of trust: root -> org -> example.org, every link checked, and
 * the AD bit set on the answer that finally reaches the stub.
 *
 * Eleven queries for one address. That is the honest number, and it is the point.
 *
 * ## The three things this run shows that a plain lookup cannot
 *
 * **The chain is a chain of keys, not of servers.** Each zone signs its own data with a
 * zone-signing key; the zone's DNSKEY RRset is signed by a key-signing key; and the
 * *parent* publishes a DS record -- a digest of that key-signing key -- to say "this is
 * the key my child signs with". Validation walks down checking DS against DNSKEY at each
 * cut. It bottoms out at the root's DS, which is not published anywhere it could be
 * looked up, because a lookup is exactly what it exists to secure: a validating resolver
 * ships with it and updates it out of band (RFC 5011).
 *
 * **The side quest, which has nothing to do with DNSSEC.** `example.org` is served by
 * nameservers under `dns-provider.net`, outside the zone being delegated, so the `org`
 * servers publish no glue for them -- and a name is not something you can send a packet
 * to. Before the walk can continue, the resolver stops and resolves
 * `ns1.dns-provider.net` from the root, all over again. This is how most of the web is
 * actually delegated and it appears in no simplified diagram of DNS anywhere.
 *
 * **What failure looks like.** A validating resolver that cannot verify an answer must
 * return **SERVFAIL** and hand over nothing at all, rather than pass along data it cannot
 * vouch for (RFC 4035 s5.5). The fixtures contain `broken.example.org` for exactly this:
 * a zone whose parent publishes a DS matching no key the child holds. One mismatched
 * digest takes the whole name off the Internet for everybody behind a validating
 * resolver, and leaves it perfectly reachable for everybody else -- which is why DNSSEC
 * outages are so confusing to diagnose from one vantage point.
 *
 * ## What the AD bit does and does not mean
 *
 * AD says *the resolver* checked the signatures and they held. The stub did not check
 * anything; it is trusting the resolver and the network path to it. That is why AD is
 * only meaningful over a channel the stub already trusts, and why DoT and DoH matter to
 * DNSSEC even though they secure a completely different thing.
 */

import type { DnsScenario } from './run';

/** The full chain of trust, walked and checked, on a name that is properly signed. */
export const DNSSEC_VALIDATED: DnsScenario = {
  id: 'dnssec-validated',
  title: 'DNSSEC validated',
  summary:
    'A signed name, validated from the root down: a DNSKEY and a DS at every zone cut, a nameserver address resolved from scratch along the way, and eleven queries to answer one question.',
  teaches: [
    'DS in the parent, DNSKEY in the child -- how a chain of trust is linked',
    'The root trust anchor is configured, never looked up',
    'A delegation without glue costs a whole extra walk of the tree',
    'A validating resolver returns SERVFAIL rather than data it cannot prove',
  ],
  seed: 'dns:dnssec-validated',
  dnssec: true,
  lookups: [
    {
      name: 'example.org',
      type: 'A',
      intent:
        'The same kind of question as every other scenario, with one bit set: DO, asking for the signatures as well as the data.',
    },
  ],
  notes: [
    {
      phase: 'question',
      text: 'The stub sets DO -- DNSSEC OK -- which asks for signatures alongside the data. Everything that follows is the resolver doing two jobs at once: finding the answer, and assembling the proof that the answer is genuine.',
      reference: {
        rfc: 4035,
        section: '3.2.1',
        title: 'Protocol Modifications for the DNS Security Extensions',
      },
    },
    {
      phase: 'tld',
      text: 'The org servers delegate example.org to nameservers under dns-provider.net -- outside the zone being delegated, so there is no glue to publish and none is published. The referral names servers whose addresses the resolver does not have.',
      reference: {
        rfc: 1034,
        section: '4.2.1',
        title: 'Domain Names -- Concepts and Facilities',
      },
    },
    {
      phase: 'ns-address',
      text: 'A name is not something you can send a packet to. So the walk stops, and a second walk begins from the root -- for ns1.dns-provider.net this time -- purely to find out where to send the next query. This is how most of the web is really delegated, and it is invisible in every simplified diagram of DNS.',
      reference: {
        rfc: 1034,
        section: '5.3.3',
        title: 'Domain Names -- Concepts and Facilities',
      },
    },
    {
      phase: 'authoritative',
      text: 'The answer, at last, with an RRSIG beside it. Having the data and being able to believe it are two different things, and the second one has not started yet.',
      reference: {
        rfc: 4034,
        section: '3',
        title: 'Resource Records for the DNS Security Extensions',
      },
    },
    {
      phase: 'validate',
      text: "Now the chain. At each zone cut the resolver asks the child for its DNSKEY and the parent for the DS that vouches for it, and checks that the DS really is a digest of the child's key-signing key. Root vouches for org, org vouches for example.org, and example.org's zone-signing key covers the address that came back. Break any one link and the whole thing is worthless below that point.",
      reference: {
        rfc: 4035,
        section: '5.3',
        title: 'Protocol Modifications for the DNS Security Extensions',
      },
    },
    {
      phase: 'validate',
      target: 'stub',
      text: "The walk bottoms out at the root's DS, which is not fetched from anywhere -- it is configured. That is deliberate: it is the one key whose authenticity cannot be established by a lookup, because a lookup is the thing it exists to secure. Real resolvers ship it as a trust anchor and update it out of band under RFC 5011.",
      reference: {
        rfc: 4033,
        section: '2',
        title: 'DNS Security Introduction and Requirements',
      },
    },
    {
      phase: 'answer',
      text: 'Eleven queries for one address, and the AD bit set on the reply. AD means the resolver checked the signatures and they held -- the stub checked nothing and is trusting the resolver, and the path to it, absolutely. That is why an encrypted channel to the resolver matters to DNSSEC even though it secures something entirely different.',
      reference: {
        rfc: 4035,
        section: '3.2.3',
        title: 'Protocol Modifications for the DNS Security Extensions',
      },
    },
    {
      phase: 'answer',
      target: 'resolver',
      text: 'Had any link failed, this answer would have been SERVFAIL with nothing attached: a validating resolver must refuse to pass on data it cannot prove rather than hand it over with a caveat. One mismatched digest takes a name off the Internet for everyone behind a validating resolver and leaves it perfectly reachable for everyone else, which is why DNSSEC outages look like madness from a single vantage point.',
      reference: {
        rfc: 4035,
        section: '5.5',
        title: 'Protocol Modifications for the DNS Security Extensions',
      },
    },
  ],
};
