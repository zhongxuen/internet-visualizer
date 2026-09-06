import { describe, expect, it } from 'vitest';

import {
  activeEntries,
  cacheDelegation,
  cacheLookup,
  cacheNegative,
  cachePositive,
  cacheStats,
  cachedCname,
  closestDelegation,
  createDnsCache,
  isExpired,
  negativeTtlSeconds,
  purgeExpired,
  remainingSeconds,
} from './cache';
import { rr, type ResourceRecord } from './records';

const SECOND = 1000;

const A_RECORD = rr('example.com', 300, { type: 'A', address: '203.0.113.20' });
const SECOND_A = rr('example.com', 300, { type: 'A', address: '203.0.113.21' });

/** The SOA of a zone whose negative answers may be remembered for five minutes. */
const SOA = rr('example.com', 3600, {
  type: 'SOA',
  mname: 'ns1.example.com',
  rname: 'hostmaster.example.com',
  serial: 1,
  refresh: 7200,
  retry: 3600,
  expire: 1209600,
  minimum: 300,
});

/** The same zone, but only willing to have its "no" remembered for a minute. */
const SHORT_SOA = rr('example.com', 3600, {
  type: 'SOA',
  mname: 'ns1.example.com',
  rname: 'hostmaster.example.com',
  serial: 1,
  refresh: 7200,
  retry: 3600,
  expire: 1209600,
  minimum: 60,
});

function cacheWithA(now = 0) {
  return cachePositive(createDnsCache(), {
    name: 'example.com',
    type: 'A',
    records: [A_RECORD, SECOND_A],
    now,
  });
}

describe('positive entries', () => {
  it('answers before the TTL runs out and misses afterwards', () => {
    const cache = cacheWithA();

    expect(cacheLookup(cache, 'example.com', 'A', 299 * SECOND)).toBeDefined();
    // The instant the TTL is up, the entry is gone: a cache that served an expired
    // record would be answering with something it was told to stop believing.
    expect(cacheLookup(cache, 'example.com', 'A', 300 * SECOND)).toBeUndefined();
    expect(cacheLookup(cache, 'example.com', 'A', 900 * SECOND)).toBeUndefined();
  });

  /** RFC 1035 s4.1.3: what a cache serves is the time remaining, not the original TTL. */
  it('counts the TTL down as it hands the records back', () => {
    const cache = cacheWithA();
    const hit = cacheLookup(cache, 'example.com', 'A', 60 * SECOND);

    expect(hit?.remaining).toBe(240);
    expect(hit?.records.every((record) => record.ttl === 240)).toBe(true);
    // The stored records keep their original TTL; only the copy handed out is aged.
    expect(cache.entries[0].records[0].ttl).toBe(300);
  });

  it('expires an RRset as one unit, on its shortest TTL', () => {
    const mixed: ResourceRecord[] = [
      A_RECORD,
      rr('example.com', 30, { type: 'A', address: '203.0.113.22' }),
    ];
    const cache = cachePositive(createDnsCache(), {
      name: 'example.com',
      type: 'A',
      records: mixed,
      now: 0,
    });

    expect(cache.entries[0].ttlSeconds).toBe(30);
    expect(cacheLookup(cache, 'example.com', 'A', 31 * SECOND)).toBeUndefined();
  });

  it('caps a TTL a zone would like to be longer than the resolver allows', () => {
    const cache = cachePositive(createDnsCache({ maxPositiveTtl: 600 }), {
      name: 'example.com',
      type: 'A',
      records: [rr('example.com', 31_536_000, { type: 'A', address: '203.0.113.20' })],
      now: 0,
    });

    expect(cache.entries[0].ttlSeconds).toBe(600);
  });

  it('refuses to remember a zero-TTL record at all', () => {
    const cache = cachePositive(createDnsCache(), {
      name: 'example.com',
      type: 'A',
      records: [rr('example.com', 0, { type: 'A', address: '203.0.113.20' })],
      now: 0,
    });

    expect(cache.entries).toEqual([]);
  });

  it('replaces an entry rather than accumulating one per lookup', () => {
    const first = cacheWithA(0);
    const second = cachePositive(first, {
      name: 'example.com',
      type: 'A',
      records: [A_RECORD],
      now: 100 * SECOND,
    });

    expect(second.entries).toHaveLength(1);
    expect(second.entries[0].insertedAt).toBe(100 * SECOND);
  });

  it('leaves the cache it was given untouched', () => {
    const before = createDnsCache();
    cachePositive(before, {
      name: 'example.com',
      type: 'A',
      records: [A_RECORD],
      now: 0,
    });

    expect(before.entries).toEqual([]);
  });

  it('finds a cached alias even when the question asked for an address', () => {
    const cache = cachePositive(createDnsCache(), {
      name: 'www.example.com',
      type: 'CNAME',
      records: [rr('www.example.com', 300, { type: 'CNAME', target: 'example.com' })],
      now: 0,
    });

    expect(cacheLookup(cache, 'www.example.com', 'A', 0)).toBeUndefined();
    expect(cachedCname(cache, 'www.example.com', 0)).toBeDefined();
  });
});

describe('negative caching, RFC 2308', () => {
  /**
   * The lifetime is the smaller of the SOA's MINIMUM field and the TTL of the SOA record
   * itself -- s5. MINIMUM used to mean something else; s4 redefined it to mean only this.
   */
  it('takes the smaller of the SOA minimum and the SOA record TTL', () => {
    expect(negativeTtlSeconds(SOA)).toBe(300);

    const shortSoa = { ...SOA, ttl: 60 };
    expect(negativeTtlSeconds(shortSoa)).toBe(60);
  });

  it('caps the lifetime at the maximum the resolver is willing to hold', () => {
    const longSoa = rr('example.com', 86400, {
      type: 'SOA',
      mname: 'ns1.example.com',
      rname: 'hostmaster.example.com',
      serial: 1,
      refresh: 7200,
      retry: 3600,
      expire: 1209600,
      minimum: 86400,
    });

    expect(negativeTtlSeconds(longSoa, 3600)).toBe(3600);
  });

  it('remembers nothing when the answer carried no SOA to authorise it', () => {
    expect(negativeTtlSeconds(undefined)).toBe(0);

    const cache = cacheNegative(createDnsCache(), {
      name: 'nope.example.com',
      type: 'A',
      kind: 'nxdomain',
      soa: undefined,
      now: 0,
    });
    expect(cache.entries).toEqual([]);
  });

  /** NXDOMAIN is about the name. If it does not exist, it does not exist for AAAA either. */
  it('applies a remembered NXDOMAIN to every type at that name', () => {
    const cache = cacheNegative(createDnsCache(), {
      name: 'nope.example.com',
      type: 'A',
      kind: 'nxdomain',
      soa: SOA,
      now: 0,
    });

    expect(cacheLookup(cache, 'nope.example.com', 'A', 0)?.entry.rcode).toBe('NXDOMAIN');
    expect(cacheLookup(cache, 'nope.example.com', 'AAAA', 0)?.entry.rcode).toBe(
      'NXDOMAIN',
    );
    expect(cacheLookup(cache, 'nope.example.com', 'MX', 0)?.entry.rcode).toBe('NXDOMAIN');
  });

  /** NODATA is about the type. The name is fine, and its other types are still live. */
  it('applies a remembered NODATA only to the type that was asked for', () => {
    const cache = cacheNegative(createDnsCache(), {
      name: 'mail.example.com',
      type: 'AAAA',
      kind: 'nodata',
      soa: SOA,
      now: 0,
    });

    const hit = cacheLookup(cache, 'mail.example.com', 'AAAA', 0);
    expect(hit?.entry.kind).toBe('nodata');
    expect(hit?.entry.rcode).toBe('NOERROR');
    expect(cacheLookup(cache, 'mail.example.com', 'A', 0)).toBeUndefined();
  });

  it('forgets the "no" when its lifetime is up', () => {
    const cache = cacheNegative(createDnsCache(), {
      name: 'nope.example.com',
      type: 'A',
      kind: 'nxdomain',
      soa: SOA,
      now: 0,
    });

    expect(cacheLookup(cache, 'nope.example.com', 'A', 299 * SECOND)).toBeDefined();
    expect(cacheLookup(cache, 'nope.example.com', 'A', 301 * SECOND)).toBeUndefined();
  });
});

describe('delegations', () => {
  const NS = [
    rr('example.com', 172800, { type: 'NS', nameserver: 'ns1.example.com' }),
    rr('example.com', 172800, { type: 'NS', nameserver: 'ns2.example.com' }),
  ];
  const GLUE = [
    rr('ns1.example.com', 172800, { type: 'A', address: '203.0.113.10' }),
    rr('ns2.example.com', 172800, { type: 'A', address: '203.0.113.11' }),
  ];

  it('stores the NS RRset and its glue as separate, addressable entries', () => {
    const cache = cacheDelegation(createDnsCache(), {
      zone: 'example.com',
      ns: NS,
      glue: GLUE,
      now: 0,
    });

    expect(cache.entries.map((entry) => entry.key)).toEqual([
      'example.com|NS',
      'ns1.example.com|A',
      'ns2.example.com|A',
    ]);
    expect(cache.entries[0].source).toBe('referral');
    expect(cache.entries[1].source).toBe('glue');
  });

  /**
   * This is what makes the second lookup fast: not a cached answer, a cached *route*.
   * With `example.com NS` in hand the resolver starts at the authoritative server and
   * never asks the root or the TLD anything.
   */
  it('finds the deepest delegation enclosing a name, with addresses to reach it', () => {
    let cache = cacheDelegation(createDnsCache(), {
      zone: 'com',
      ns: [rr('com', 172800, { type: 'NS', nameserver: 'a.gtld-servers.net' })],
      glue: [rr('a.gtld-servers.net', 172800, { type: 'A', address: '192.0.2.30' })],
      now: 0,
    });
    cache = cacheDelegation(cache, { zone: 'example.com', ns: NS, glue: GLUE, now: 0 });

    const found = closestDelegation(cache, 'blog.example.com', 0);
    expect(found?.zone).toBe('example.com');
    expect(found?.serverNames).toEqual(['ns1.example.com', 'ns2.example.com']);
    expect(found?.addresses.map((entry) => entry.address)).toEqual([
      '203.0.113.10',
      '203.0.113.11',
    ]);
  });

  it('falls back to the shallower delegation once the deeper one expires', () => {
    let cache = cacheDelegation(createDnsCache(), {
      zone: 'com',
      ns: [rr('com', 172800, { type: 'NS', nameserver: 'a.gtld-servers.net' })],
      now: 0,
    });
    cache = cacheDelegation(cache, {
      zone: 'example.com',
      ns: [rr('example.com', 60, { type: 'NS', nameserver: 'ns1.example.com' })],
      now: 0,
    });

    expect(closestDelegation(cache, 'www.example.com', 0)?.zone).toBe('example.com');
    expect(closestDelegation(cache, 'www.example.com', 61 * SECOND)?.zone).toBe('com');
  });

  it('knows nothing about a name it has never been told about', () => {
    expect(closestDelegation(createDnsCache(), 'example.com', 0)).toBeUndefined();
  });
});

describe('housekeeping', () => {
  it('reports what is alive, what has gone, and when', () => {
    const cache = cacheWithA();
    const entry = cache.entries[0];

    expect(remainingSeconds(entry, 0)).toBe(300);
    expect(remainingSeconds(entry, 120 * SECOND)).toBe(180);
    // Never negative: an entry that expired an hour ago has zero seconds left, not -3600.
    expect(remainingSeconds(entry, 5000 * SECOND)).toBe(0);
    expect(isExpired(entry, 299 * SECOND)).toBe(false);
    expect(isExpired(entry, 300 * SECOND)).toBe(true);
  });

  it('purges expired entries and counts the rest by kind', () => {
    let cache = cacheWithA();
    cache = cacheNegative(cache, {
      name: 'nope.example.com',
      type: 'A',
      kind: 'nxdomain',
      soa: SHORT_SOA,
      now: 0,
    });

    expect(cacheStats(cache, 0)).toEqual({
      total: 2,
      positive: 1,
      negative: 1,
      expired: 0,
    });
    expect(activeEntries(cache, 100 * SECOND)).toHaveLength(1);
    expect(cacheStats(cache, 100 * SECOND).expired).toBe(1);
    expect(purgeExpired(cache, 100 * SECOND).entries).toHaveLength(1);
    // Nothing to do, so nothing is copied.
    expect(purgeExpired(cache, 0)).toBe(cache);
  });
});
