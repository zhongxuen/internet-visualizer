# 07 — Module: DNS Explorer

## Goal

Show a domain name becoming an IP address, step by step: stub resolver → recursive
resolver → root → TLD → authoritative, with caching, TTLs, record types, and the failure
modes. Simulated only (the _live_ DNS lookup tool is phase 12 and lives on a separate,
badged surface).

## Prerequisites

Phase 04.

---

## Deliverables

```
src/modules/dns-explorer/
  meta.ts
  sim/
    records.ts       # RR types, TTLs, zone fixtures
    resolver.ts      # recursive resolution algorithm
    cache.ts         # cache with TTL expiry, negative caching
    dnssec.ts        # optional chain-of-trust walk
  scenarios/
    cold-cache.ts        # full walk: root -> TLD -> authoritative
    warm-cache.ts        # resolver answers from cache
    cname-chain.ts       # CNAME -> CNAME -> A
    cdn-lookup.ts        # CNAME to a CDN, geo-different answers
    nxdomain.ts          # negative response + negative caching
    dnssec-validated.ts
  components/
    DomainInput.tsx      # validated, simulated-only, with example chips
    ResolutionLadder.tsx # the query/response ladder view
    RecordTable.tsx      # answer/authority/additional sections
    CachePanel.tsx       # live cache with counting-down TTLs
  DnsExplorerModule.tsx
src/app/(modules)/dns-explorer/page.tsx
```

---

## What to model

### The resolution walk

Stub resolver (OS) → recursive resolver (ISP or public, e.g. `1.1.1.1`) → root server
(`.`) → TLD server (`.com`) → authoritative server → answer, then the answer flows back
and is cached at each level that caches.

Critical distinctions to make visible, because they are the usual misconceptions:

- The **root server does not know the answer** — it returns a _referral_ to the TLD
  nameservers, not an address for the hostname. Same for the TLD.
- The recursive resolver does the work; the stub just asks once and waits.
- **Iterative vs recursive** queries — label each arrow with which it is.
- Glue records: why the referral includes A records for the nameservers.

### Record types to support

`A`, `AAAA`, `CNAME`, `MX`, `NS`, `TXT`, `SOA`, `PTR`, `CAA`, `SRV`. Show the full
response with **Answer / Authority / Additional** sections, since that structure is
itself a teaching point.

### Caching

`CachePanel` shows entries with live-counting TTLs. Running the same query twice must
visibly short-circuit — the second run finishes in milliseconds and touches no root or
TLD server. That contrast is the single best explanation of why DNS scales.

Include negative caching (RFC 2308) in the NXDOMAIN scenario.

### Transport detail

Default to UDP/53, and show the truncation → TCP/53 retry path when a response exceeds
512 bytes. Mention DoH/DoT as a toggle that changes the transport annotation (the live
tool in phase 12 uses DoH, so this connects).

### Failure modes worth their own scenarios

- `NXDOMAIN` — domain does not exist
- `SERVFAIL` — resolver failure / DNSSEC validation failure
- Timeout and retry to a secondary nameserver

---

## Interactions

- Enter a hostname (validated with `zod` + the phase-03 address/hostname validators)
- Pick record type and whether the cache starts cold or warm
- `ResolutionLadder` is a sequence-diagram-style view synced to the timeline — clicking
  a rung seeks
- Every query/response shows the actual DNS message fields (transaction ID, flags, QR,
  RD, RA, RCODE, question, answer count)

> **Safety:** this input never triggers a network request. The field is badged
> `simulated`, and unknown hostnames resolve against the bundled zone fixtures with a
> clear "this is a simulated zone" note. Do not silently fall back to a real lookup.

---

## Accuracy checks

Verify against RFC 1034/1035 (concepts and message format), RFC 2308 (negative caching),
RFC 4033–4035 (DNSSEC). Root server names (`a.root-servers.net` …) and the 13-root-server
fact (13 _addresses_, many anycast instances — say this, it is a common misconception).

---

## Acceptance criteria

- [ ] Cold-cache walk shows referrals from root and TLD, not answers
- [ ] Warm-cache run visibly skips root/TLD and is much faster
- [ ] TTLs count down in the cache panel and entries expire
- [ ] All listed record types render with correct section placement
- [ ] NXDOMAIN and SERVFAIL scenarios work, with negative caching shown
- [ ] Input is validated; no real network request is possible from this module
- [ ] Resolver logic unit-tested independently of the UI
- [ ] Registry entry `'ready'`, `usesRealNetwork: false`

---

## Prompts to execute

### Prompt 7.1 — resolver logic

```
Read docs/implementation/07-module-dns-explorer.md.

Implement the pure DNS logic under src/modules/dns-explorer/sim/: records.ts (RR types
and zone fixtures for a handful of example domains), resolver.ts (the recursive
resolution algorithm with referrals from root and TLD), cache.ts (TTL expiry plus
negative caching per RFC 2308), and dnssec.ts (chain-of-trust walk).

No React. Model referrals correctly — root and TLD return NS referrals with glue, never
the final answer. Unit-test the resolver, the cache expiry, and the NXDOMAIN path.
```

### Prompt 7.2 — scenarios

```
Implement the six scenarios in src/modules/dns-explorer/scenarios/ per the phase doc:
cold-cache, warm-cache, cname-chain, cdn-lookup, nxdomain, and dnssec-validated.

Each emits phases and annotations that label queries as iterative or recursive and cite
the relevant RFC. Include the UDP-512-byte truncation to TCP retry path in at least one
scenario. Assert determinism in tests.
```

### Prompt 7.3 — module UI

```
Implement the DNS Explorer UI per docs/implementation/07-module-dns-explorer.md:
DomainInput (zod-validated, badged `simulated`, with example chips), ResolutionLadder
(sequence-diagram view synced to the timeline, rungs seek on click), RecordTable with
Answer/Authority/Additional sections, CachePanel with live-counting TTLs, and
DnsExplorerModule composed through SimulationView. Add the route.

The input must never cause a real network request — unknown hostnames resolve against
the bundled simulated zones with a clear note. Then flip the registry entry to 'ready'.
```
