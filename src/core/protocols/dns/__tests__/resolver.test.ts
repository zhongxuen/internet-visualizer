import { describe, expect, it } from 'vitest';

import { cacheLookup } from './cache';
import { SIMULATED_INTERNET, UDP_MAX_PAYLOAD, rdataText } from './records';
import {
  QUERY_TIMEOUT_MS,
  resolve,
  type DnsResolution,
  type ResolutionStep,
} from './resolver';

/** Everything except the stub's own exchange, which encloses the rest. */
function serverSteps(result: DnsResolution): ResolutionStep[] {
  return result.steps.filter((step) => step.purpose !== 'stub');
}

function tiers(result: DnsResolution): string[] {
  return serverSteps(result).map((step) => step.to.tier);
}

const cold = (name: string, type: Parameters<typeof resolve>[2] = 'A') =>
  resolve(SIMULATED_INTERNET, name, type, { seed: 'test' });

describe('the cold walk', () => {
  const result = cold('www.example.com');

  it('goes stub, root, TLD, authoritative, and answers', () => {
    expect(result.rcode).toBe('NOERROR');
    expect(result.steps[0].from.tier).toBe('stub');
    expect(tiers(result)).toEqual(['root', 'tld', 'authoritative']);
    expect(result.addresses).toEqual(['203.0.113.20']);
  });

  /**
   * The misconception the whole module exists to correct. A root server asked for
   * `www.example.com` returns the `.com` nameservers and their addresses -- never the
   * answer, and never anything in the answer section at all.
   */
  it('gets referrals from the root and the TLD, not answers', () => {
    const [root, tld] = serverSteps(result);

    for (const step of [root, tld]) {
      expect(step.outcome).toBe('referral');
      expect(step.response?.answer).toEqual([]);
      // AA is clear: the referring server is not authoritative for what it was asked.
      expect(step.response?.flags.aa).toBe(false);
      expect(step.response?.authority.every((record) => record.type === 'NS')).toBe(true);
    }

    expect(
      root.response?.authority.map((record) =>
        record.data.type === 'NS' ? record.data.nameserver : '',
      ),
    ).toContain('a.gtld-servers.net');
  });

  it('receives glue with each referral, since the addresses are the point of one', () => {
    const [, tld] = serverSteps(result);
    const glue = tld.response?.additional ?? [];

    expect(glue.length).toBeGreaterThan(0);
    expect(glue.some((record) => record.name === 'ns1.example.com')).toBe(true);
  });

  /** One recursive query in, several iterative queries out. That asymmetry is the design. */
  it('marks the stub query recursive and every query it makes iterative', () => {
    expect(result.steps[0].recursive).toBe(true);
    expect(result.steps[0].query.flags.rd).toBe(true);

    for (const step of serverSteps(result)) {
      expect(step.recursive).toBe(false);
      expect(step.query.flags.rd).toBe(false);
      // An authoritative server does not offer recursion; one that did to strangers
      // would be an open resolver.
      expect(step.response?.flags.ra).toBe(false);
    }
    expect(result.response.flags.ra).toBe(true);
  });

  it('returns the alias and the address it leads to, in that order', () => {
    expect(result.answers.map((record) => record.type)).toEqual(['CNAME', 'A']);
    expect(rdataText(result.answers[0].data)).toBe('example.com.');
  });

  it('matches every response to its query by transaction id', () => {
    for (const step of result.steps) {
      if (!step.response) continue;
      expect(step.response.id).toBe(step.query.id);
      expect(step.response.flags.qr).toBe(true);
    }
  });
});

describe('the warm walk', () => {
  const first = cold('www.example.com');
  const second = resolve(SIMULATED_INTERNET, 'www.example.com', 'A', {
    seed: 'again',
    cache: first.cache,
    startMs: first.elapsedMs,
  });

  it('touches no server at all, and no root or TLD in particular', () => {
    expect(second.queryCount).toBe(0);
    expect(second.servedFromCache).toBe(true);
    expect(second.usedRootOrTld).toBe(false);
    expect(tiers(second).every((tier) => tier === 'cache')).toBe(true);
  });

  it('gives the same answer, an order of magnitude faster', () => {
    expect(second.answers.map((record) => rdataText(record.data))).toEqual(
      first.answers.map((record) => rdataText(record.data)),
    );
    expect(second.elapsedMs).toBeLessThan(first.elapsedMs / 5);
  });

  it('hands back the remaining TTL rather than the original', () => {
    const alias = second.answers.find((record) => record.type === 'CNAME');
    expect(alias?.ttl).toBeLessThan(300);
  });

  /**
   * The half of caching that is usually left out: what a warm resolver reuses is not
   * only answers but *routes*. A name it has never resolved, in a zone it has, starts at
   * the authoritative server.
   */
  it('starts at the authoritative server for a name it has never looked up', () => {
    const sibling = resolve(SIMULATED_INTERNET, 'mail.example.com', 'A', {
      seed: 'sibling',
      cache: first.cache,
      startMs: 10_000,
    });

    expect(sibling.rcode).toBe('NOERROR');
    expect(sibling.usedRootOrTld).toBe(false);
    expect(tiers(sibling)).toEqual(['authoritative']);
  });

  it('walks the whole tree again once the delegation has expired', () => {
    const laterOn = resolve(SIMULATED_INTERNET, 'mail.example.com', 'A', {
      seed: 'expired',
      cache: first.cache,
      // Past the two-day infrastructure TTL, so nothing in the cache is usable.
      startMs: 3 * 86400 * 1000,
    });

    expect(tiers(laterOn)).toEqual(['root', 'tld', 'authoritative']);
  });
});

describe('aliases', () => {
  it('follows a chain of two CNAMEs to the address at the end', () => {
    const result = cold('blog.example.com');

    expect(result.rcode).toBe('NOERROR');
    expect(result.answers.map((record) => record.type)).toEqual(['CNAME', 'CNAME', 'A']);
    expect(result.addresses).toEqual(['203.0.113.20']);
  });

  /**
   * A CNAME that leaves the zone costs a second walk from the top, because the server
   * holding the alias knows nothing about where it points. That is the price of an alias
   * to a CDN, and it is why the TTLs at the far end are the ones that matter.
   */
  it('starts again from the root when the alias points into another zone', () => {
    const result = cold('shop.example.com');

    expect(result.rcode).toBe('NOERROR');
    expect(tiers(result)).toEqual([
      'root',
      'tld',
      'authoritative',
      'root',
      'tld',
      'authoritative',
      'authoritative',
    ]);
    expect(result.addresses).toEqual(['198.51.100.40', '198.51.100.41']);
  });
});

describe('NXDOMAIN', () => {
  const result = cold('nope.example.com');

  it('comes from the authoritative server, after the same full walk', () => {
    expect(result.rcode).toBe('NXDOMAIN');
    expect(result.answers).toEqual([]);
    expect(tiers(result)).toEqual(['root', 'tld', 'authoritative']);

    const last = serverSteps(result).at(-1);
    expect(last?.outcome).toBe('nxdomain');
    expect(last?.response?.flags.aa).toBe(true);
  });

  /** The SOA in the authority section is the permission slip for remembering the "no". */
  it('carries the SOA that says how long the answer may be cached', () => {
    const last = serverSteps(result).at(-1);
    const soa = last?.response?.authority.find((record) => record.type === 'SOA');

    expect(soa).toBeDefined();
    expect(soa?.name).toBe('example.com');
  });

  it('remembers the "no" for the SOA minimum, per RFC 2308', () => {
    const entry = result.cache.entries.find((candidate) => candidate.kind === 'nxdomain');

    expect(entry?.name).toBe('nope.example.com');
    // min(SOA MINIMUM 300, SOA TTL 3600, the resolver's own cap 3600).
    expect(entry?.ttlSeconds).toBe(300);
  });

  it('answers the same question from memory next time, contacting nobody', () => {
    const again = resolve(SIMULATED_INTERNET, 'nope.example.com', 'A', {
      seed: 'again',
      cache: result.cache,
      startMs: 60_000,
    });

    expect(again.rcode).toBe('NXDOMAIN');
    expect(again.queryCount).toBe(0);
    expect(again.usedRootOrTld).toBe(false);
  });

  it('applies the remembered NXDOMAIN to any other type at that name', () => {
    const otherType = resolve(SIMULATED_INTERNET, 'nope.example.com', 'AAAA', {
      seed: 'aaaa',
      cache: result.cache,
      startMs: 60_000,
    });

    expect(otherType.rcode).toBe('NXDOMAIN');
    expect(otherType.queryCount).toBe(0);
  });

  it('asks again once the negative entry has expired -- but not the root', () => {
    const later = resolve(SIMULATED_INTERNET, 'nope.example.com', 'A', {
      seed: 'later',
      cache: result.cache,
      // Past the 300-second negative TTL, well inside the two-day delegation TTL.
      startMs: 400_000,
    });

    expect(later.rcode).toBe('NXDOMAIN');
    expect(later.queryCount).toBe(1);
    expect(tiers(later)).toEqual(['authoritative']);
  });

  it('does not confuse "no such type" with "no such name"', () => {
    const nodata = cold('mail.example.com', 'AAAA');

    expect(nodata.rcode).toBe('NOERROR');
    expect(nodata.answers).toEqual([]);
    expect(nodata.cache.entries.some((entry) => entry.kind === 'nodata')).toBe(true);
    // The A record at the same name is untouched by a NODATA for AAAA.
    expect(cacheLookup(nodata.cache, 'mail.example.com', 'A', 0)).toBeUndefined();
  });
});

describe('transport', () => {
  /** RFC 1035 s4.2.1: over 512 bytes, the server truncates and the resolver uses TCP. */
  it('retries over TCP when the answer will not fit in a datagram', () => {
    const result = cold('default._domainkey.example.com', 'TXT');
    const steps = serverSteps(result);
    const truncated = steps.find((step) => step.outcome === 'truncated');
    const retry = steps.at(-1);

    expect(truncated?.transport).toBe('udp');
    expect(truncated?.response?.flags.tc).toBe(true);
    expect(truncated?.response?.answer).toEqual([]);

    expect(retry?.transport).toBe('tcp');
    expect(retry?.outcome).toBe('answer');
    expect(retry?.response?.sizeBytes).toBeGreaterThan(UDP_MAX_PAYLOAD);
    expect(result.rcode).toBe('NOERROR');
  });

  it('needs no retry when EDNS(0) raised the datagram limit', () => {
    const result = resolve(SIMULATED_INTERNET, 'default._domainkey.example.com', 'TXT', {
      seed: 'edns',
      edns: true,
    });

    expect(result.steps.some((step) => step.outcome === 'truncated')).toBe(false);
    expect(result.steps.every((step) => step.transport === 'udp')).toBe(true);
    expect(result.rcode).toBe('NOERROR');
  });
});

describe('failure and retry', () => {
  it('waits out a silent nameserver and asks its sibling', () => {
    const result = resolve(SIMULATED_INTERNET, 'example.com', 'A', {
      seed: 'timeout',
      unresponsive: ['ns1.example.com'],
    });

    const timedOut = serverSteps(result).find((step) => step.outcome === 'timeout');
    expect(timedOut?.to.name).toBe('ns1.example.com');
    expect(timedOut?.response).toBeUndefined();
    expect(timedOut?.durationMs).toBe(QUERY_TIMEOUT_MS);

    // The answer still arrives -- from the second nameserver, a second later.
    expect(result.rcode).toBe('NOERROR');
    expect(serverSteps(result).at(-1)?.to.name).toBe('ns2.example.com');
    expect(result.elapsedMs).toBeGreaterThan(QUERY_TIMEOUT_MS);
  });

  it('gives up with SERVFAIL when no nameserver for the zone answers', () => {
    const result = resolve(SIMULATED_INTERNET, 'example.com', 'A', {
      seed: 'dead',
      unresponsive: ['ns1.example.com', 'ns2.example.com'],
    });

    expect(result.rcode).toBe('SERVFAIL');
    expect(result.answers).toEqual([]);
  });

  it('gives up rather than looping forever when the walk runs long', () => {
    const result = resolve(SIMULATED_INTERNET, 'example.org', 'A', {
      seed: 'capped',
      maxQueries: 2,
    });

    expect(result.rcode).toBe('SERVFAIL');
    expect(result.queryCount).toBeLessThanOrEqual(3);
  });
});

describe('delegations without glue', () => {
  /**
   * A domain whose nameservers live somewhere else -- which is most of the web, since
   * that is what using a managed DNS provider means -- cannot be reached until those
   * nameservers have themselves been resolved. No simplified diagram of DNS shows this.
   */
  it('breaks off to resolve the nameserver name first', () => {
    const result = cold('example.org');

    expect(result.rcode).toBe('NOERROR');
    const sideQuest = result.steps.filter((step) => step.purpose === 'ns-address');
    expect(sideQuest.length).toBeGreaterThan(0);
    expect(sideQuest[0].query.question.name).toBe('ns1.dns-provider.net');
    expect(result.addresses).toEqual(['203.0.113.70']);
  });

  it('does it again for a reverse lookup, whose nameservers are always elsewhere', () => {
    const result = cold('20.113.0.203.in-addr.arpa', 'PTR');

    expect(result.rcode).toBe('NOERROR');
    expect(rdataText(result.answers[0].data)).toBe('example.com.');
    expect(result.steps.some((step) => step.purpose === 'ns-address')).toBe(true);
  });
});

describe('DNSSEC through the resolver', () => {
  it('sets AD on an answer whose chain of trust holds', () => {
    const result = resolve(SIMULATED_INTERNET, 'example.org', 'A', {
      seed: 'secure',
      dnssec: true,
    });

    expect(result.rcode).toBe('NOERROR');
    expect(result.validation?.state).toBe('secure');
    expect(result.response.flags.ad).toBe(true);
    // Validation is not free: it costs a DNSKEY and a DS lookup per zone cut.
    expect(result.steps.some((step) => step.purpose === 'dnssec')).toBe(true);
  });

  it('returns an unsigned answer without AD, which is not a failure', () => {
    const result = resolve(SIMULATED_INTERNET, 'example.com', 'A', {
      seed: 'insecure',
      dnssec: true,
    });

    expect(result.rcode).toBe('NOERROR');
    expect(result.validation?.state).toBe('insecure');
    expect(result.response.flags.ad).toBe(false);
    expect(result.addresses).toEqual(['203.0.113.20']);
  });

  /** RFC 4035 s5.5: a validator hands over nothing rather than data it cannot vouch for. */
  it('answers SERVFAIL and withholds the data when the chain is broken', () => {
    const result = resolve(SIMULATED_INTERNET, 'broken.example.org', 'A', {
      seed: 'bogus',
      dnssec: true,
    });

    expect(result.validation?.state).toBe('bogus');
    expect(result.rcode).toBe('SERVFAIL');
    expect(result.answers).toEqual([]);
    expect(result.response.answer).toEqual([]);
  });

  it('still validates when the answer came out of the cache', () => {
    const first = resolve(SIMULATED_INTERNET, 'example.org', 'A', {
      seed: 'warm-dnssec',
      dnssec: true,
    });
    const second = resolve(SIMULATED_INTERNET, 'example.org', 'A', {
      seed: 'warm-dnssec-2',
      dnssec: true,
      cache: first.cache,
      startMs: 1000,
    });

    expect(second.validation?.state).toBe('secure');
    expect(second.rcode).toBe('NOERROR');
  });
});

describe('determinism', () => {
  it('produces a deep-equal result for the same question and seed', () => {
    const options = { seed: 'fixed' } as const;
    const first = resolve(SIMULATED_INTERNET, 'shop.example.com', 'A', options);
    const second = resolve(SIMULATED_INTERNET, 'shop.example.com', 'A', options);

    expect(second).toEqual(first);
  });

  it('varies the transaction ids and the root server with the seed, and nothing else', () => {
    const one = resolve(SIMULATED_INTERNET, 'example.com', 'A', { seed: 1 });
    const two = resolve(SIMULATED_INTERNET, 'example.com', 'A', { seed: 2 });

    expect(one.rcode).toBe(two.rcode);
    expect(one.answers).toEqual(two.answers);
    expect(one.steps[1].query.id).not.toBe(two.steps[1].query.id);
  });

  it('never draws a transaction id outside the 16 bits it has', () => {
    const result = cold('shop.example.com');

    for (const step of result.steps) {
      expect(step.query.id).toBeGreaterThanOrEqual(0);
      expect(step.query.id).toBeLessThanOrEqual(65535);
    }
  });
});

describe('timing', () => {
  it('reports the stub exchange as enclosing every query the resolver made', () => {
    const result = cold('www.example.com');
    const stub = result.steps[0];
    const last = serverSteps(result).at(-1) as ResolutionStep;

    expect(stub.startedMs).toBe(0);
    expect(stub.durationMs).toBe(result.elapsedMs);
    expect(last.startedMs + last.durationMs).toBeLessThan(
      stub.startedMs + stub.durationMs,
    );
  });

  it('keeps every step in non-decreasing time order', () => {
    const result = cold('shop.example.com');
    const starts = serverSteps(result).map((step) => step.startedMs);

    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });
});
