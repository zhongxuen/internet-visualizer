/**
 * Scenario 1 -- the whole walk, from a resolver that knows nothing.
 *
 * This is the picture every other scenario is a variation on, and it is arranged around
 * the one thing people are reliably wrong about: **neither the root server nor the TLD
 * server answers the question.** Both are asked for `example.com` outright. Both return
 * a referral -- an empty answer section, AA clear, and a list of servers one level
 * further down -- and the resolver has to ask again. Only `ns1.example.com`, the third
 * server contacted, has ever heard of the name.
 *
 * The arrows are not all the same kind of arrow either, and the ladder labels every one
 * of them. The stub sends **one recursive query**, RD set, and then waits. Everything
 * after it is **iterative**, RD clear, because the resolver is doing the walking itself
 * and a root server would refuse to recurse for it anyway. One question at the top
 * becomes three underneath: that asymmetry is the design, not an inefficiency in it.
 *
 * ## Why there is a second lookup
 *
 * The DKIM key at `default._domainkey.example.com` is a TXT record several hundred bytes
 * long, and it does two jobs here.
 *
 * It is the module's **truncation path**. A plain UDP DNS response may carry 512 bytes
 * (RFC 1035 s4.2.1); this answer is 728. So what comes back is a header with TC set and
 * nothing else, the resolver throws it away, opens a TCP connection, and asks the
 * identical question a second time. That is the entire reason DNS lists TCP as a
 * transport -- zone transfers are merely the other reason -- and it is why EDNS(0)
 * exists, since advertising a 1232-byte buffer would have avoided the round trip
 * altogether.
 *
 * It is also the **first hint of what a cache is worth**, before `warm-cache` makes the
 * point properly. The second question is a different name of a different type, so
 * nothing about the answer is cached -- but the delegation is, so the run skips the root
 * and the TLD entirely and opens at the authoritative server. Two thirds of the walk,
 * gone, for a question the resolver has never been asked.
 */

import type { DnsScenario } from './run';

/** A cold resolver, a full walk, and an answer too big for a datagram. */
export const COLD_CACHE: DnsScenario = {
  id: 'cold-cache',
  title: 'Cold cache',
  summary:
    'A resolver that knows nothing but the root hints, walking the tree from the top: two referrals, one answer, and then a second question whose answer will not fit in a UDP datagram.',
  teaches: [
    'The root server returns a referral, never an address',
    'One recursive query at the top becomes several iterative ones below it',
    'Glue: why a referral carries addresses as well as names',
    'TC and the retry over TCP when a response exceeds 512 bytes',
  ],
  seed: 'dns:cold-cache',
  lookups: [
    {
      name: 'example.com',
      type: 'A',
      intent: 'Nothing is cached, so this costs the full walk from the root.',
    },
    {
      name: 'default._domainkey.example.com',
      type: 'TXT',
      intent:
        'A DKIM public key -- a long TXT record in the same zone, which is about to run into the size limit of a datagram.',
    },
  ],
  notes: [
    {
      phase: 'question',
      text: 'The client sends exactly one query and will send exactly one more in this whole scenario. Everything on the diagram after this arrow is work the resolver does on its behalf, and none of it is ever visible to the application that asked.',
      reference: {
        rfc: 1034,
        section: '5.3.1',
        title: 'Domain Names -- Concepts and Facilities',
      },
    },
    {
      phase: 'root',
      text: 'Asked for example.com, the root server replies with the .com nameservers in the authority section and their addresses in the additional section. The answer section is empty and AA is clear: it is not authoritative for this name and it is not pretending to be. There are 13 root server addresses rather than 13 machines -- each letter is announced by anycast from hundreds of sites, so the nearest instance answers.',
      reference: {
        rfc: 1034,
        section: '4.3.2',
        title: 'Domain Names -- Concepts and Facilities',
      },
    },
    {
      phase: 'tld',
      text: 'The .com servers know which nameservers run each .com domain and nothing about what is inside them. The referral names ns1.example.com and ns2.example.com -- which live inside the zone being delegated, so their addresses have to be published here too. That is glue: without it the delegation would name servers whose addresses could only be found by following the delegation.',
      reference: {
        rfc: 1034,
        section: '4.2.1',
        title: 'Domain Names -- Concepts and Facilities',
      },
    },
    {
      phase: 'authoritative',
      text: "Third server, first answer. AA is set: this record came out of the zone file itself rather than out of anybody's memory, and the TTL on it is the original, full value. Every cache between here and the client will hand it on with less.",
      reference: {
        rfc: 1035,
        section: '4.1.1',
        title: 'Domain Names -- Implementation and Specification',
      },
    },
    {
      phase: 'question-2',
      target: 'resolver',
      text: 'A different name and a different type, so none of the previous answer helps. The delegation does: the resolver still remembers who runs example.com, and goes straight there. The root and the TLD are skipped without being asked, which is what makes the tree survivable at Internet scale.',
      reference: {
        rfc: 1034,
        section: '4.3.4',
        title: 'Domain Names -- Concepts and Facilities',
      },
    },
    {
      phase: 'truncation',
      text: 'The answer is 728 bytes and a plain UDP DNS response may carry 512. The server sets TC and sends back essentially an empty header; the resolver discards it, opens a TCP connection, and re-sends the same question with a new transaction id. Advertising EDNS(0) would have raised the ceiling to 1232 bytes and saved the entire second round trip -- which is why every modern resolver does.',
      reference: {
        rfc: 1035,
        section: '4.2.1',
        title: 'Domain Names -- Implementation and Specification',
      },
    },
    {
      phase: 'answer-2',
      text: 'Over TCP the message is prefixed with its own two-byte length, because a stream has no message boundaries of its own. Once that prefix exists, size stops being a limit at all -- the 512-byte ceiling was never about DNS, only about what a single datagram could be relied on to carry unfragmented.',
      reference: { rfc: 6891, title: 'Extension Mechanisms for DNS (EDNS(0))' },
    },
  ],
};
