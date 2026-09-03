/**
 * The cache -- the reason DNS works at all.
 *
 * There are on the order of a billion domain names and thirteen root server addresses.
 * That arithmetic only works because almost every query is answered from memory: a
 * resolver walks the tree once for a name, remembers what it learned for as long as the
 * TTL allows, and answers everyone else from the shelf. The second lookup in a scenario
 * finishing in a millisecond, having touched no root and no TLD, is the single best
 * explanation of why the system scales -- and it is this file.
 *
 * ## What is remembered, and for how long
 *
 * - **Positive answers**, for the RRset's TTL (RFC 1035 s3.2.1), capped by
 *   {@link DEFAULT_LIMITS}`.maxPositiveTtl` because a hostile TTL of one year should not
 *   pin a bad answer in memory forever.
 * - **Delegations** -- the NS RRset of a zone cut and the addresses that came with it.
 *   These are what let a warm resolver start at `example.com` instead of at the root.
 * - **Negative answers**, per RFC 2308. This half is routinely left out of explanations,
 *   and leaving it out is how you end up believing a typo costs a full tree walk every
 *   time. See {@link negativeTtlSeconds}.
 *
 * ## Two kinds of "no"
 *
 * RFC 2308 s2 splits them, and so does this cache, because they are cached differently:
 *
 * - **NXDOMAIN** -- the name does not exist. Nothing at that name exists, of any type,
 *   so the entry is stored against the *name* and a later query for any other type hits
 *   it too.
 * - **NODATA** -- the name exists, but not with that type. `mail.example.com` has an A
 *   record and no AAAA. The RCODE is NOERROR, not an error at all, and the entry is
 *   stored against the name *and* the type, because the other types are still live.
 *
 * ## Time is virtual, TTLs are seconds
 *
 * Every `now` in this file is a virtual millisecond on the simulation clock, exactly as
 * in `@/core/types/events`. TTLs are seconds, as on the wire. The conversion happens
 * here and nowhere else, which is why the panel that counts a TTL down can just subtract.
 *
 * The cache is **immutable**: every operation returns a new cache. That is what lets the
 * UI hold the cache as it was at any point on the timeline, so scrubbing backwards shows
 * the entries that existed then rather than the entries that exist now.
 */

import {
  ancestorsOf,
  displayName,
  normalizeName,
  withTtl,
  type Rcode,
  type ResourceRecord,
  type RrType,
} from './records';

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** The ceilings a resolver puts on what a zone can ask it to remember. */
export interface CacheLimits {
  /** Longest a positive answer may be held, in seconds. One day is a common choice. */
  readonly maxPositiveTtl: number;
  /**
   * Longest a negative answer may be held, in seconds.
   *
   * RFC 2308 s5 requires this to be configurable and recommends a cap of no more than
   * three hours; one hour is what most resolvers ship with.
   */
  readonly maxNegativeTtl: number;
}

/** The defaults, chosen to match what a mainstream recursive resolver does. */
export const DEFAULT_LIMITS: CacheLimits = {
  maxPositiveTtl: 86400,
  maxNegativeTtl: 3600,
};

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

/** Whether an entry remembers an answer, or remembers that there is no answer. */
export type CacheEntryKind = 'positive' | 'nodata' | 'nxdomain';

/** Where the data came from, which is also how much it should be trusted. */
export type CacheSource =
  /** From the zone's own server, with AA set. */
  | 'authoritative'
  /** The NS RRset of a delegation, learned from the parent. */
  | 'referral'
  /** An address that came in a referral's additional section. */
  | 'glue';

/** One row of the cache. */
export interface DnsCacheEntry {
  /** `name|TYPE`, or `name|!NXDOMAIN` for a whole name that does not exist. */
  readonly key: string;
  readonly name: string;
  /** The type that was asked for. For an NXDOMAIN entry this is only a record of why. */
  readonly type: RrType;
  readonly kind: CacheEntryKind;
  /** The records, TTLs exactly as received. Empty for a negative entry. */
  readonly records: readonly ResourceRecord[];
  /** What a resolver should reply with when this entry is hit. */
  readonly rcode: Rcode;
  /** Negative entries only: the SOA that authorised the lifetime of this entry. */
  readonly soa?: ResourceRecord;
  /** The lifetime actually applied, after the caps above -- seconds. */
  readonly ttlSeconds: number;
  /** Virtual millisecond the entry was stored. */
  readonly insertedAt: number;
  /** Virtual millisecond it stops being usable: `insertedAt + ttlSeconds * 1000`. */
  readonly expiresAt: number;
  readonly source: CacheSource;
}

/** The cache: a list of entries and the limits that were applied to them. */
export interface DnsCache {
  readonly entries: readonly DnsCacheEntry[];
  readonly limits: CacheLimits;
}

/** An empty cache -- a resolver that has just started, knowing only the root hints. */
export function createDnsCache(limits: Partial<CacheLimits> = {}): DnsCache {
  return { entries: [], limits: { ...DEFAULT_LIMITS, ...limits } };
}

/** The key an entry is filed under. NXDOMAIN is filed against the name alone. */
export function cacheKey(name: string, type: RrType, kind: CacheEntryKind): string {
  const canonical = normalizeName(name);
  return kind === 'nxdomain' ? `${canonical}|!NXDOMAIN` : `${canonical}|${type}`;
}

/** Milliseconds left before an entry expires; zero once it has. */
export function remainingMs(entry: DnsCacheEntry, now: number): number {
  return Math.max(0, entry.expiresAt - now);
}

/**
 * Seconds left on an entry, rounded down -- the TTL a resolver puts on the wire.
 *
 * Rounded *down* deliberately: a cache must never hand out a longer TTL than it has
 * left, or the next resolver downstream would keep the record alive past its expiry.
 */
export function remainingSeconds(entry: DnsCacheEntry, now: number): number {
  return Math.floor(remainingMs(entry, now) / 1000);
}

/** True once `now` has reached the entry's expiry. */
export function isExpired(entry: DnsCacheEntry, now: number): boolean {
  return now >= entry.expiresAt;
}

/** The entries still alive at `now`, in insertion order. */
export function activeEntries(cache: DnsCache, now: number): DnsCacheEntry[] {
  return cache.entries.filter((entry) => !isExpired(entry, now));
}

/** Drop everything that has expired. Nothing else changes. */
export function purgeExpired(cache: DnsCache, now: number): DnsCache {
  const kept = activeEntries(cache, now);
  return kept.length === cache.entries.length ? cache : { ...cache, entries: kept };
}

/** One line for the cache panel: `example.com. A 203.0.113.20 (2m 41s left)`. */
export function describeEntry(entry: DnsCacheEntry, now: number): string {
  const left = remainingSeconds(entry, now);
  const what =
    entry.kind === 'positive'
      ? `${entry.type} x${entry.records.length}`
      : `${entry.kind.toUpperCase()} (${entry.type})`;
  return `${displayName(entry.name)} ${what} -- ${left}s left`;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** Replace any entry with the same key, keeping the list's order stable. */
function store(cache: DnsCache, entry: DnsCacheEntry): DnsCache {
  const index = cache.entries.findIndex((existing) => existing.key === entry.key);
  if (index === -1) return { ...cache, entries: [...cache.entries, entry] };
  const entries = [...cache.entries];
  entries[index] = entry;
  return { ...cache, entries };
}

/** The TTL of an RRset: the smallest TTL in it, since the set expires as a unit. */
export function rrsetTtl(records: readonly ResourceRecord[]): number {
  return records.reduce(
    (smallest, record) => Math.min(smallest, record.ttl),
    Number.POSITIVE_INFINITY,
  );
}

/**
 * Cache a positive answer.
 *
 * `records` must be one RRset -- same owner name, same type -- because that is the unit
 * DNS caches in. An A RRset with two addresses is one entry that expires once, not two
 * entries racing each other.
 */
export function cachePositive(
  cache: DnsCache,
  init: {
    name: string;
    type: RrType;
    records: readonly ResourceRecord[];
    now: number;
    source?: CacheSource;
  },
): DnsCache {
  if (init.records.length === 0) return cache;
  const name = normalizeName(init.name);
  const ttl = Math.max(0, Math.min(rrsetTtl(init.records), cache.limits.maxPositiveTtl));
  if (ttl === 0) return cache; // A zero TTL means "use this once and forget it".

  return store(cache, {
    key: cacheKey(name, init.type, 'positive'),
    name,
    type: init.type,
    kind: 'positive',
    records: init.records,
    rcode: 'NOERROR',
    ttlSeconds: ttl,
    insertedAt: init.now,
    expiresAt: init.now + ttl * 1000,
    source: init.source ?? 'authoritative',
  });
}

/**
 * How long a "no" may be remembered, per RFC 2308 s5.
 *
 * The lifetime is the **smaller** of the SOA's MINIMUM field and the TTL of the SOA
 * record itself, then capped by the resolver's own maximum. The MINIMUM field once meant
 * something else entirely; RFC 2308 s4 redefined it to mean exactly this, which is the
 * kind of detail that makes negative caching look mysterious until you read it.
 *
 * With no SOA there is nothing authorising a lifetime, so the answer is not cached at
 * all -- that is what a zero return means to {@link cacheNegative}.
 */
export function negativeTtlSeconds(
  soa: ResourceRecord | undefined,
  cap: number = DEFAULT_LIMITS.maxNegativeTtl,
): number {
  if (!soa || soa.data.type !== 'SOA') return 0;
  return Math.max(0, Math.min(soa.data.minimum, soa.ttl, cap));
}

/**
 * Cache a negative answer: NXDOMAIN against the name, NODATA against the name and type.
 *
 * A negative answer with no SOA in its authority section is not cacheable, and is
 * dropped rather than guessed at.
 */
export function cacheNegative(
  cache: DnsCache,
  init: {
    name: string;
    type: RrType;
    kind: 'nodata' | 'nxdomain';
    soa: ResourceRecord | undefined;
    now: number;
  },
): DnsCache {
  const ttl = negativeTtlSeconds(init.soa, cache.limits.maxNegativeTtl);
  if (ttl === 0) return cache;
  const name = normalizeName(init.name);

  return store(cache, {
    key: cacheKey(name, init.type, init.kind),
    name,
    type: init.type,
    kind: init.kind,
    records: [],
    rcode: init.kind === 'nxdomain' ? 'NXDOMAIN' : 'NOERROR',
    ...(init.soa ? { soa: init.soa } : {}),
    ttlSeconds: ttl,
    insertedAt: init.now,
    expiresAt: init.now + ttl * 1000,
    source: 'authoritative',
  });
}

/**
 * Cache a delegation: the NS RRset for a zone cut, plus any glue that came with it.
 *
 * This is the entry that makes the second lookup fast. Once `example.com NS` is in the
 * cache with the addresses of its nameservers, a query for `blog.example.com` starts
 * there -- the root and the TLD are not asked, not because the answer was cached, but
 * because the *route* to the answer was.
 */
export function cacheDelegation(
  cache: DnsCache,
  init: {
    zone: string;
    ns: readonly ResourceRecord[];
    glue?: readonly ResourceRecord[];
    now: number;
  },
): DnsCache {
  let next = cachePositive(cache, {
    name: init.zone,
    type: 'NS',
    records: init.ns,
    now: init.now,
    source: 'referral',
  });

  // Glue is filed by owner name and type like anything else, but marked as glue: it
  // arrived in an additional section from a server that is not authoritative for it.
  const glue = init.glue ?? [];
  const byKey = new Map<string, ResourceRecord[]>();
  for (const record of glue) {
    if (record.type !== 'A' && record.type !== 'AAAA') continue;
    const key = `${record.name}|${record.type}`;
    const existing = byKey.get(key);
    if (existing) existing.push(record);
    else byKey.set(key, [record]);
  }
  for (const records of byKey.values()) {
    next = cachePositive(next, {
      name: records[0].name,
      type: records[0].type,
      records,
      now: init.now,
      source: 'glue',
    });
  }
  return next;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** A hit, with the records already aged down to what is left of their lifetime. */
export interface CacheHit {
  readonly entry: DnsCacheEntry;
  /** Seconds left, which is the TTL the resolver will put on the answer it gives out. */
  readonly remaining: number;
  /**
   * The records, re-stamped with the remaining TTL rather than the original.
   *
   * This is the detail that makes a TTL a countdown rather than a constant: ask a
   * resolver the same question twice a minute apart and the second answer comes back
   * with sixty fewer seconds on it (RFC 1035 s4.1.3).
   */
  readonly records: readonly ResourceRecord[];
}

function hit(entry: DnsCacheEntry, now: number): CacheHit {
  const remaining = remainingSeconds(entry, now);
  return {
    entry,
    remaining,
    records: entry.records.map((record) => withTtl(record, remaining)),
  };
}

function liveEntry(cache: DnsCache, key: string, now: number): DnsCacheEntry | undefined {
  const entry = cache.entries.find((candidate) => candidate.key === key);
  return entry && !isExpired(entry, now) ? entry : undefined;
}

/**
 * Look one question up.
 *
 * The NXDOMAIN check comes first and deliberately ignores the type: if the name does not
 * exist, it does not exist for AAAA either, and a resolver that asked again anyway would
 * be sending traffic it already knows the answer to.
 */
export function cacheLookup(
  cache: DnsCache,
  name: string,
  type: RrType,
  now: number,
): CacheHit | undefined {
  const canonical = normalizeName(name);

  const nx = liveEntry(cache, cacheKey(canonical, type, 'nxdomain'), now);
  if (nx) return hit(nx, now);

  const exact = liveEntry(cache, cacheKey(canonical, type, 'positive'), now);
  if (exact) return hit(exact, now);

  const nodata = liveEntry(cache, cacheKey(canonical, type, 'nodata'), now);
  if (nodata) return hit(nodata, now);

  return undefined;
}

/** A cached alias at this name, which is a hit even when the question asked for an A. */
export function cachedCname(
  cache: DnsCache,
  name: string,
  now: number,
): CacheHit | undefined {
  const entry = liveEntry(cache, cacheKey(name, 'CNAME', 'positive'), now);
  return entry ? hit(entry, now) : undefined;
}

/** A cached delegation: the zone cut, its NS records, and the addresses to reach them. */
export interface CachedDelegation {
  /** The zone the NS RRset belongs to. */
  readonly zone: string;
  readonly ns: readonly ResourceRecord[];
  /** The nameserver names, in the order the NS RRset lists them. */
  readonly serverNames: readonly string[];
  /** Addresses for those names that are also in the cache; may be empty. */
  readonly addresses: readonly { name: string; address: string }[];
  readonly entry: DnsCacheEntry;
}

/**
 * The deepest cached delegation that encloses a name -- where a resolver should start.
 *
 * Cold, this returns nothing and the walk begins at the root. Warm, it returns
 * `example.com` and the walk begins at the authoritative server, which is the whole
 * difference between the two scenarios: not a cached *answer*, a cached *route*.
 */
export function closestDelegation(
  cache: DnsCache,
  name: string,
  now: number,
): CachedDelegation | undefined {
  const canonical = normalizeName(name);
  for (const candidate of [canonical, ...ancestorsOf(canonical)]) {
    const entry = liveEntry(cache, cacheKey(candidate, 'NS', 'positive'), now);
    if (!entry) continue;

    const serverNames = entry.records
      .map((record) => (record.data.type === 'NS' ? record.data.nameserver : ''))
      .filter((serverName) => serverName.length > 0);

    const addresses: { name: string; address: string }[] = [];
    for (const serverName of serverNames) {
      for (const type of ['A', 'AAAA'] as const) {
        const found = liveEntry(cache, cacheKey(serverName, type, 'positive'), now);
        if (!found) continue;
        for (const record of found.records) {
          if (record.data.type === 'A' || record.data.type === 'AAAA') {
            addresses.push({ name: serverName, address: record.data.address });
          }
        }
      }
    }

    return { zone: candidate, ns: entry.records, serverNames, addresses, entry };
  }
  return undefined;
}

/** How full the cache is and what of -- the header line of the cache panel. */
export interface CacheStats {
  readonly total: number;
  readonly positive: number;
  readonly negative: number;
  readonly expired: number;
}

/** Count the entries by kind at a moment in virtual time. */
export function cacheStats(cache: DnsCache, now: number): CacheStats {
  let positive = 0;
  let negative = 0;
  let expired = 0;
  for (const entry of cache.entries) {
    if (isExpired(entry, now)) {
      expired += 1;
      continue;
    }
    if (entry.kind === 'positive') positive += 1;
    else negative += 1;
  }
  return { total: positive + negative, positive, negative, expired };
}
