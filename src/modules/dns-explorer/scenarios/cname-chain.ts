/**
 * Scenario 3 -- an alias for an alias for a name.
 *
 * `blog.example.com` is a CNAME pointing at `www.example.com`, which is itself a CNAME
 * pointing at `example.com`, which finally has an A record. Two hops of aliasing is
 * legal, common, and precisely one hop more than most people expect.
 *
 * The thing to watch is **who does the chasing**. The client asked one question and gets
 * back four records in one answer section -- two CNAMEs and the address at the end --
 * because every name in the chain happens to live in the same zone, so `ns1.example.com`
 * follows the whole thing internally and returns the lot. The resolver never had to
 * re-enter the tree. That is not luck; it is why keeping an alias and its target in one
 * zone is worth doing.
 *
 * `cdn-lookup` is the same shape with the opposite outcome: there the alias points *out*
 * of the zone, the authoritative server can only hand back the CNAME, and resolution has
 * to restart at the root for a name it has never seen. Run the two side by side -- the
 * ladders are three rungs and seven.
 *
 * ## Two rules worth knowing about aliases
 *
 * A CNAME must be the **only** record at its name. Not one record among several: the
 * only one. That is why an apex like `example.com` can never be a CNAME -- it is
 * obliged to carry SOA and NS records, and a CNAME beside them is illegal (RFC 1034
 * s3.6.2, RFC 2181 s10.1). Every "ALIAS", "ANAME", or "CNAME flattening" feature a DNS
 * provider sells is a workaround for exactly that sentence.
 *
 * And the chain has to be **followed, not trusted**. A resolver that returned the CNAME
 * without resolving it would hand the application a name where it asked for an address;
 * a resolver that followed one forever would hang on a loop somebody left behind. So
 * there is a hop limit, and every real implementation has one.
 */

import type { DnsScenario } from './run';

/** Two aliases and an address, all answered by one server in one exchange. */
export const CNAME_CHAIN: DnsScenario = {
  id: 'cname-chain',
  title: 'CNAME chain',
  summary:
    'blog is an alias for www, which is an alias for the apex. One question, four records back, and the whole chain followed inside a single zone.',
  teaches: [
    'A CNAME is an instruction to start again at another name',
    'Chains are followed by whoever can follow them, and answered in one message',
    'A CNAME must be the only record at its name -- hence no CNAME at an apex',
    "Why hop limits exist: an alias chain is somebody else's data",
  ],
  seed: 'dns:cname-chain',
  lookups: [
    {
      name: 'blog.example.com',
      type: 'A',
      intent:
        'The client asked for an address. What is published at this name is an alias, and behind that another one.',
    },
  ],
  notes: [
    {
      phase: 'question',
      text: 'The application asked for an address and will be given one. It will never learn that two aliases were involved unless it looks at the answer section, which almost nothing does.',
    },
    {
      phase: 'authoritative',
      text: 'One exchange, four records: blog.example.com CNAME www.example.com, www.example.com CNAME example.com, and then the A record with the address on it. Every name in the chain lives in this zone, so the server followed the whole thing itself rather than handing back the first alias and making the resolver start again.',
      reference: {
        rfc: 1034,
        section: '3.6.2',
        title: 'Domain Names -- Concepts and Facilities',
      },
    },
    {
      phase: 'answer',
      text: 'Note the TTLs differ down the chain: 300 seconds on the aliases, 3600 on the address. A cache stores each RRset with its own lifetime, so the alias can be re-pointed within five minutes while the address behind it stays put for an hour. Short TTLs are not a performance bug, they are a control knob, paid for in queries.',
      reference: {
        rfc: 2181,
        section: '5.2',
        title: 'Clarifications to the DNS Specification',
      },
    },
    {
      phase: 'answer',
      target: 'ns1.example.com',
      text: 'A CNAME must be the only record at its name -- not one record among several. That single rule is why example.com itself can never be an alias: an apex is obliged to carry SOA and NS records, and a CNAME beside them is illegal. Every ALIAS, ANAME, or "CNAME flattening" feature sold by a DNS provider exists to work around this sentence.',
      reference: {
        rfc: 2181,
        section: '10.1',
        title: 'Clarifications to the DNS Specification',
      },
    },
  ],
};
