# `src/modules/dns-explorer` — a name becoming an address

A domain name is not looked up in a directory. It is **walked down a tree of zones**,
each administered separately, each knowing only its own contents and the names of the
servers one level below it. This module exists to make that walk — and the caching,
TTLs, negative answers, and chain of trust wrapped around it — concrete rather than
described.

Simulated only. No name here is ever looked up on a real network; see the rules below.

## What exists today

All of phase 07: the pure logic, the six scenarios, and the module surface on
`/dns-explorer`. The registry entry is `ready`, `usesRealNetwork: false`.

```
sim/                    # pure DNS logic -- no React, no DOM, no clock of its own
  records.ts            # RR types, wire-format sizing, and the simulated zones themselves
  resolver.ts           # the recursive walk: root -> TLD -> authoritative, with referrals
  cache.ts              # TTL expiry, and negative caching per RFC 2308
  dnssec.ts             # the chain-of-trust walk, and what each way of breaking it means
scenarios/              # six runs over that logic, as data
  run.ts                # the bridge: a resolution becomes phases, packets, and annotations
  <six>.ts              # one file per scenario: which questions, in what order, and the notes
lookup.ts               # the safety boundary: what a learner typed, validated (zod) and scoped
ladder.ts               # a resolution becomes a sequence diagram -- pure, so it is testable
components/
  DomainInput.tsx       # the field: validated, badged `simulated`, with example chips
  ResolutionLadder.tsx  # the sequence diagram, synced to the timeline both ways
  RecordTable.tsx       # one message, in its Answer / Authority / Additional sections
  CachePanel.tsx        # the cache, with TTLs that actually count down
DnsExplorerModule.tsx   # the composition root, through SimulationView
meta.ts                 # the registry id, so nothing else spells it
```

The UI adds nothing to the protocol. `ladder.ts` and `lookup.ts` are pure functions with
their own tests, the four components render what those return, and
`DnsExplorerModule.tsx` holds three pieces of state and no logic. Delete every file
outside `sim/` and `scenarios/` and DNS still resolves identically.

Run one lookup with `resolve(SIMULATED_INTERNET, 'www.example.com', 'A')`. What comes
back is a complete, deterministic record of the walk: every query and response with its
real header fields, the cache as it ended up, and the whole thing timed in virtual
milliseconds.

Run a whole scenario with `runDnsScenario(COLD_CACHE)`. That adds the second half — a
topology built from the servers this lookup actually touched, a `SimResult` the
visualization layer can draw, and the resolutions and cache behind it. The boundary is
one-way: `sim/` knows nothing about any of it.

## The six scenarios

Each is the previous picture with one thing changed, which is why they are ordered.

| Scenario           | The change                | What it exists to show                                             |
| ------------------ | ------------------------- | ------------------------------------------------------------------ |
| `cold-cache`       | —                         | Two referrals then an answer; then TC and the retry over TCP        |
| `warm-cache`       | the resolver remembers    | The same question, answered without a packet leaving the building   |
| `cname-chain`      | the name is an alias      | Two CNAMEs and an address, followed inside one zone                 |
| `cdn-lookup`       | the alias leaves the zone | The walk restarts at the root; short TTLs and answers that steer    |
| `nxdomain`         | the name is not there     | An SOA licensing the denial, and negative caching per RFC 2308      |
| `dnssec-validated` | the answer must be proved | DS against DNSKEY at every cut, and the eleven queries it costs     |

Two invariants the tests hold every one of them to: a run is deep-equal to itself on the
tenth attempt, and **every query on the diagram is labelled iterative or recursive** —
read off its own RD bit, and cited to RFC 1034 s4.3.1.

## The one idea the resolver is arranged around

**The root server does not know the answer.** Nor does the TLD server. Asked for
`www.example.com`, a root server returns the `.com` nameservers and their addresses — a
_referral_ — with an empty answer section and AA clear. `lookupInZone` checks for a
delegation _before_ any name match, so a server physically cannot answer for a name it
has delegated away, however famous that name is.

The second half of the same idea is the flags. The stub's one query has **RD set**;
every query the resolver then makes has **RD clear** and is _iterative_. One question in,
four questions out.

## What the fixtures are built to show

| Fixture                           | The lesson                                                       |
| --------------------------------- | ---------------------------------------------------------------- |
| `www.example.com`                 | The full walk, then an alias followed inside the zone             |
| `blog.example.com`                | CNAME → CNAME → A: one hop more than most people expect           |
| `shop.example.com`                | An alias out to a CDN, which restarts the walk at the root        |
| `example.org`                     | Nameservers at a managed provider: no glue, so they are resolved first |
| `20.113.0.203.in-addr.arpa`       | The reverse tree, delegated right to left down `arpa`             |
| `default._domainkey.example.com`  | Over 512 bytes: truncated, then re-sent over TCP                  |
| `nope.example.com`                | NXDOMAIN, and exactly how long it is remembered                   |
| `mail.example.com AAAA`           | NODATA — the name exists, the type does not, and it is not an error |
| `broken.example.org`              | A DS matching no key: bogus, and SERVFAIL rather than data        |

Glue is modelled both ways round. `example.com`'s nameservers live inside `example.com`,
so the `com` delegation must carry their addresses or nothing could ever find them.
`example.org`'s live at a provider under `net`, so the `org` delegation carries none and
the resolver breaks off to resolve `ns1.dns-provider.net` first — a side quest no
simplified diagram of DNS shows, and one most of the web needs.

## The rules the tests enforce

- **Root and TLD refer; only the last server answers.** Asserted at both levels: in
  `records.test.ts` against the zone lookup, and again in `resolver.test.ts` against the
  walk, so a bug in one cannot hide a bug in the other.
- **The warm run touches nobody.** Same answer, no queries, and — separately — a name in
  an already-known zone starts at the authoritative server, because what a cache reuses
  is not only answers but _routes_.
- **TTLs count down.** A cache serves the time remaining, never the original.
- **NXDOMAIN is about the name; NODATA is about the type.** They are cached differently
  and tested apart.
- **A negative answer lives for `min(SOA MINIMUM, SOA TTL, the resolver's cap)`**, and an
  answer with no SOA is not cached at all (RFC 2308 §5).
- **Bogus is not insecure.** An unsigned delegation with an NSEC proving no DS is
  ordinary and returns data; a DS that matches no key returns SERVFAIL and nothing else.
- **Determinism.** Same question, same seed, deep-equal result.

## What must NEVER be imported here

- Another module (`src/modules/<b>/**`). Shared code goes through `@/core` or
  `@/components` — enforced by `eslint.config.mjs`.
- Anything in `sim/` may import `@/core` and nothing else. No React, no DOM, no
  `Math.random()`, no `Date.now()`: randomness comes from `@/core/sim/rng` seeded by the
  caller, and time is virtual milliseconds the resolver advances explicitly.

## Address and safety rules

Server **names** are real (`a.root-servers.net`, `a.gtld-servers.net`) because they are
worth recognising. Every **address** is from a block reserved for documentation —
RFC 5737 (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`) and RFC 3849
(`2001:db8::/32`) — so nothing here can be mistaken for, or pointed at, a real host.
`records.test.ts` checks every address in every fixture with the same classifier the
phase-12 diagnostics guard will use.

The only source of answers is `SIMULATED_INTERNET`. A name that is not in it resolves to
NXDOMAIN from the simulated zone that would own it; there is no fallback path to a real
lookup, and there is nothing in this folder that could make one.

That rule reaches the surface, because a field a learner can type into is where it would
otherwise be quietly broken:

- The field is badged `Simulated` and says under itself that nothing typed there is sent
  to a real nameserver.
- `coverageFor` in `lookup.ts` decides whether the bundled zones are authoritative for a
  name, and the field prints the answer. A name they are not — `google.com`, say — gets a
  note saying in as many words that the NXDOMAIN is a fact about this simulation and not
  about the Internet. Reading a fixture as a fact is the failure mode this exists to
  prevent.
- The transport control offers DoH and DoT. Both are **annotations**: they change what the
  ladder says the query was carried over, and nothing else.
- `DnsExplorerModule.test.tsx` stubs `fetch` with a spy that throws, types several real
  domain names into the field, and asserts it was never called.

The DNSSEC material is a **stand-in, not cryptography**: signatures and digests are
FNV-1a over the canonical record data, so they are deterministic, structurally correct,
and trivially forgeable. They exist so the chain walk has something to check. Real
validation is not what this module does.
