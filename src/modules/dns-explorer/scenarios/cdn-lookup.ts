/**
 * Scenario 4 -- an alias that leaves the zone, and a CDN at the end of it.
 *
 * `shop.example.com` is a CNAME to `edge.cdn.example.net`, and that one label change is
 * worth seven queries instead of three. `cname-chain` had every name in one zone, so the
 * authoritative server followed the chain itself. Here the target is in a zone
 * `ns1.example.com` knows nothing about, so all it can do is hand back the alias -- and
 * the resolver has to **start again at the root** for a name it has never heard of.
 *
 * Watch the ladder restart. Root, `.com`, `example.com` gives a CNAME; then root again,
 * `.net`, `example.net`, and finally the CDN's own nameservers. That second climb is the
 * real cost of pointing a name at somebody else's infrastructure, and it is entirely
 * invisible in the answer the application receives.
 *
 * ## Why anyone pays that cost
 *
 * Because of what is at the bottom. The CDN's zone answers with **two addresses and a
 * 30-second TTL**, and both of those are steering mechanisms rather than accidents.
 *
 * The short TTL is the control knob: half a minute after the CDN decides an edge is
 * unhealthy or overloaded, nothing on Earth is still being sent to it. An hour-long TTL
 * on the same record would mean an hour of traffic going somewhere broken. The price is
 * paid in queries -- a name with a 30-second TTL is asked for 120 times an hour per
 * cache, against once for a 3600-second one -- and CDNs pay it happily, because query
 * volume is their cheapest resource and stranded traffic is their most expensive
 * problem.
 *
 * The **geographic** half is the more interesting one, and it is the reason a CNAME is
 * used here at all. `example.com` cannot answer differently for different users -- it
 * publishes one zone and that is that. By delegating the name to the CDN, it hands over
 * the decision: `ns1.cdn.example.net` sees where the query came from and picks which
 * edge addresses to put in the answer. Same question, same server, different answer, by
 * design. {@link CDN_VANTAGES} lists what this fixture's edges would be steered to from
 * three places; the simulated zone publishes the whole RRset so that the steering is
 * visible as a choice rather than hidden inside it.
 *
 * The thing that catches people out: the CDN sees the **resolver's** address, not the
 * client's. Someone in Sydney using a resolver in Virginia is steered to Virginia. That
 * single mismatch is why EDNS Client Subnet (RFC 7871) exists, why it is a privacy
 * trade-off rather than an obvious win, and why "just use 8.8.8.8" is not always the
 * free upgrade it sounds like.
 */

import type { RfcRef } from '@/core/types/events';

import type { DnsScenario } from './run';

/** The size limit and terminology reference the geographic note leans on. */
const RFC_7871: RfcRef = { rfc: 7871, title: 'Client Subnet in DNS Queries' };

/**
 * What the CDN's nameserver would answer from three places, out of one RRset.
 *
 * Declared here rather than simulated in `sim/records.ts` on purpose: the fixture zone
 * publishes one honest RRset, and this describes the *decision* a real CDN makes over
 * it. Keeping the two apart means nothing in the resolver has to pretend to have a
 * location, and the steering stays visible as a policy rather than disappearing into the
 * zone file.
 */
export const CDN_VANTAGES: readonly {
  readonly label: string;
  readonly resolver: string;
  readonly edge: string;
  readonly note: string;
}[] = [
  {
    label: 'Frankfurt',
    resolver: '192.0.2.53',
    edge: '198.51.100.40',
    note: 'The resolver in this run. The CDN sees a European address and answers with the European edge first.',
  },
  {
    label: 'Singapore',
    resolver: '192.0.2.54',
    edge: '198.51.100.41',
    note: 'A different resolver, the same question, the same authoritative server -- and a different answer, which is the whole reason the name was delegated to the CDN.',
  },
  {
    label: 'Sydney, via a resolver in Virginia',
    resolver: '192.0.2.53',
    edge: '198.51.100.40',
    note: 'The client is in Sydney and gets sent to Europe, because the CDN can only see where the query came from and the query came from the resolver. This mismatch is what EDNS Client Subnet exists to fix, at a cost in privacy.',
  },
];

/** A name delegated to a CDN: two climbs of the tree, and answers that vary by asker. */
export const CDN_LOOKUP: DnsScenario = {
  id: 'cdn-lookup',
  title: 'CDN lookup',
  summary:
    "shop.example.com is an alias for a name in somebody else's zone, so the walk restarts at the root and climbs down a second time -- to a CDN answering with 30-second TTLs and more than one address.",
  teaches: [
    'A CNAME out of the zone restarts resolution from the top',
    'Why a name is delegated to a CDN: to hand over who decides the answer',
    'Short TTLs as a steering control, paid for in query volume',
    "The CDN sees the resolver's location, not the client's",
  ],
  seed: 'dns:cdn-lookup',
  lookups: [
    {
      name: 'shop.example.com',
      type: 'A',
      intent:
        'A shop front served from a CDN. The name belongs to example.com; the addresses behind it do not.',
    },
  ],
  notes: [
    {
      phase: 'authoritative',
      text: 'All ns1.example.com can say is "that is an alias for edge.cdn.example.net". The target is in a zone it knows nothing about, so unlike the chain in cname-chain it cannot follow it -- and the resolver now holds a name where it wanted an address.',
      reference: {
        rfc: 1034,
        section: '3.6.2',
        title: 'Domain Names -- Concepts and Facilities',
      },
    },
    {
      phase: 'root-2',
      text: "Back to the root, for the second time in one lookup. The resolver has never heard of edge.cdn.example.net and has no shortcut to it: a new name means a new walk, from the top, exactly as if nothing had happened yet. This second climb is the real cost of pointing a name at someone else's infrastructure.",
      reference: {
        rfc: 1034,
        section: '5.3.3',
        title: 'Domain Names -- Concepts and Facilities',
      },
    },
    {
      phase: 'authoritative-2',
      text: "example.net does not answer either -- it has cut the zone again at cdn.example.net and delegates to the CDN's own nameservers. A zone cut can appear at any depth, and this is the fourth referral in one lookup.",
      reference: {
        rfc: 1034,
        section: '4.2',
        title: 'Domain Names -- Concepts and Facilities',
      },
    },
    {
      phase: 'authoritative-3',
      text: 'Two addresses, each with a 30-second TTL. Both are deliberate. The short lifetime means the CDN can move traffic off an unhealthy edge within half a minute -- an hour-long TTL would mean an hour of requests going somewhere broken -- and it pays for that in query volume, which is the cheapest thing a CDN has.',
      reference: {
        rfc: 1912,
        section: '2.2',
        title: 'Common DNS Operational and Configuration Errors',
      },
    },
    {
      phase: 'authoritative-3',
      target: 'ns1.cdn.example.net',
      text: "This server answers different askers differently. That is why the name was delegated to the CDN at all: example.com publishes one zone and cannot vary its answers, so it handed the decision to somebody who can. The catch is that the CDN sees the resolver's address rather than the client's -- someone in Sydney using a resolver in Virginia is steered to Virginia, which is the problem EDNS Client Subnet exists to solve and the privacy trade-off it comes with.",
      reference: RFC_7871,
    },
    {
      phase: 'answer',
      text: 'Seven queries, and the application sees an address. It has no idea a CDN was involved, that the tree was walked twice, or that the answer it holds will be stale in thirty seconds -- which is exactly as much as it needs to know.',
    },
  ],
};
