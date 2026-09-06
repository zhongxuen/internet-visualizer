import { describe, expect, it, vi } from 'vitest';

import { ip } from '../address';
import {
  clientBucketKey,
  clientKeyFrom,
  createRateLimiter,
  DEFAULT_CLIENT_RULE,
  DEFAULT_GLOBAL_RULE,
  DEFAULT_MAX_CLIENTS,
  rateLimitHeaders,
  UNKNOWN_CLIENT_KEY,
  type RateLimitRule,
} from '../ratelimit';

/** Ten tokens a second, five in the bucket: small enough to count by hand. */
const FAST: RateLimitRule = { limit: 10, windowMs: 1_000, burst: 5 };

describe('createRateLimiter', () => {
  it('lets a client spend its burst and then refuses', () => {
    const limiter = createRateLimiter({ client: FAST, global: null });

    for (let taken = 1; taken <= 5; taken += 1) {
      const decision = limiter.take('a', 1, 0);
      expect(decision.allowed).toBe(true);
      expect(decision.remaining).toBe(5 - taken);
      expect(decision.retryAfterSeconds).toBe(0);
      expect(decision.limitedBy).toBeUndefined();
    }

    const refused = limiter.take('a', 1, 0);
    expect(refused.allowed).toBe(false);
    expect(refused.limitedBy).toBe('client');
    expect(refused.remaining).toBe(0);
    expect(refused.limit).toBe(5);
  });

  it('refills continuously rather than in windows', () => {
    const limiter = createRateLimiter({ client: FAST, global: null });
    for (let i = 0; i < 5; i += 1) limiter.take('a', 1, 0);
    expect(limiter.take('a', 1, 0).allowed).toBe(false);

    // Ten tokens a second means one every 100 ms.
    expect(limiter.take('a', 1, 50).allowed).toBe(false);
    expect(limiter.take('a', 1, 100).allowed).toBe(true);
    expect(limiter.take('a', 1, 100).allowed).toBe(false);
    expect(limiter.take('a', 1, 300).allowed).toBe(true);
  });

  it('never refills past the burst', () => {
    const limiter = createRateLimiter({ client: FAST, global: null });
    limiter.take('a', 1, 0);
    // An hour later the bucket is full, not overflowing.
    expect(limiter.take('a', 1, 3_600_000).remaining).toBe(4);
  });

  it('keeps a separate bucket per client', () => {
    const limiter = createRateLimiter({ client: FAST, global: null });
    for (let i = 0; i < 5; i += 1) limiter.take('a', 1, 0);
    expect(limiter.take('a', 1, 0).allowed).toBe(false);
    expect(limiter.take('b', 1, 0).allowed).toBe(true);
    expect(limiter.size()).toBe(2);
  });

  it('reports when a retry can succeed, always at least a second away', () => {
    const limiter = createRateLimiter({ client: FAST, global: null });
    for (let i = 0; i < 5; i += 1) limiter.take('a', 1, 0);
    const refused = limiter.take('a', 1, 0);
    // One token is 100 ms away, but `Retry-After` is expressed in whole seconds and
    // must never round down to "try again immediately".
    expect(refused.retryAfterSeconds).toBe(1);
    // The bucket is full again 500 ms later.
    expect(refused.resetAtMs).toBe(500);
  });

  it('charges more than one token when asked', () => {
    const limiter = createRateLimiter({ client: FAST, global: null });
    expect(limiter.take('a', 3, 0).remaining).toBe(2);
    expect(limiter.take('a', 3, 0).allowed).toBe(false);
    expect(limiter.take('a', 2, 0).allowed).toBe(true);
  });

  it('treats a zero or fractional cost as one token', () => {
    const limiter = createRateLimiter({ client: FAST, global: null });
    expect(limiter.take('a', 0, 0).remaining).toBe(4);
    expect(limiter.take('a', 0.5, 0).remaining).toBe(3);
  });

  it('enforces a global ceiling as well as the per-client one', () => {
    const limiter = createRateLimiter({
      client: FAST,
      global: { limit: 10, windowMs: 1_000, burst: 3 },
    });
    expect(limiter.take('a', 1, 0).allowed).toBe(true);
    expect(limiter.take('b', 1, 0).allowed).toBe(true);
    expect(limiter.take('c', 1, 0).allowed).toBe(true);

    const refused = limiter.take('d', 1, 0);
    expect(refused.allowed).toBe(false);
    expect(refused.limitedBy).toBe('global');
    // The client still has its own tokens; the deployment is what ran out.
    expect(refused.remaining).toBe(5);
    expect(refused.retryAfterSeconds).toBe(1);
  });

  it('does not spend a client token when the global bucket is the one refusing', () => {
    const limiter = createRateLimiter({
      client: FAST,
      global: { limit: 1, windowMs: 10_000, burst: 1 },
    });
    expect(limiter.take('a', 1, 0).allowed).toBe(true);
    expect(limiter.take('b', 1, 0).limitedBy).toBe('global');
    expect(limiter.take('b', 1, 0).limitedBy).toBe('global');
    // Once the global bucket refills, `b` spends the first token of a *full* bucket:
    // the two globally-refused attempts cost it nothing, so a busy minute across the
    // deployment did not quietly drain the quota of everyone who arrived during it.
    const later = limiter.take('b', 1, 20_000);
    expect(later.allowed).toBe(true);
    expect(later.remaining).toBe(4);
  });

  it('peeks at a spent global bucket without touching either bucket', () => {
    const limiter = createRateLimiter({
      client: FAST,
      global: { limit: 1, windowMs: 10_000, burst: 1 },
    });
    // A peek while the global bucket still has room spends nothing from it either.
    expect(limiter.peek('a', 1, 0).allowed).toBe(true);
    limiter.take('a', 1, 0);
    const peeked = limiter.peek('b', 1, 0);
    expect(peeked.allowed).toBe(false);
    expect(peeked.limitedBy).toBe('global');
    expect(limiter.size()).toBe(1);
    // Nothing was spent, so once the global bucket refills the take still succeeds.
    expect(limiter.take('b', 1, 10_000).allowed).toBe(true);
  });

  it('resets cleanly when there is no global bucket to restore', () => {
    const limiter = createRateLimiter({ client: FAST, global: null });
    limiter.take('a', 5, 0);
    limiter.reset();
    expect(limiter.size()).toBe(0);
    expect(limiter.take('a', 5, 0).allowed).toBe(true);
  });

  it('refills the global bucket over time too', () => {
    const limiter = createRateLimiter({
      client: FAST,
      global: { limit: 2, windowMs: 1_000, burst: 1 },
    });
    expect(limiter.take('a', 1, 0).allowed).toBe(true);
    expect(limiter.take('b', 1, 0).allowed).toBe(false);
    expect(limiter.take('b', 1, 500).allowed).toBe(true);
  });

  it('runs with no global ceiling when one is explicitly declined', () => {
    const limiter = createRateLimiter({ client: FAST, global: null });
    for (let i = 0; i < 100; i += 1) {
      expect(limiter.take(`client-${i}`, 1, 0).allowed).toBe(true);
    }
  });

  it('peeks without spending anything, or even allocating a bucket', () => {
    const limiter = createRateLimiter({ client: FAST, global: null });
    expect(limiter.peek('a', 1, 0).allowed).toBe(true);
    expect(limiter.peek('a', 1, 0).remaining).toBe(4);
    expect(limiter.size()).toBe(0);

    limiter.take('a', 5, 0);
    expect(limiter.peek('a', 1, 0).allowed).toBe(false);
    expect(limiter.peek('a', 1, 500).allowed).toBe(true);
    expect(limiter.take('a', 1, 0).allowed).toBe(false);
  });

  it('forgets one client, or all of them, on reset', () => {
    const limiter = createRateLimiter({
      client: FAST,
      global: { limit: 1, windowMs: 1_000 },
    });
    limiter.take('a', 5, 0);
    limiter.take('b', 5, 0);
    expect(limiter.size()).toBe(2);

    limiter.reset('a');
    expect(limiter.size()).toBe(1);
    expect(limiter.take('a', 1, 0).allowed).toBe(true);

    limiter.reset();
    expect(limiter.size()).toBe(0);
    // The global bucket is restored too, so a reset is a genuinely clean slate.
    expect(limiter.take('b', 1, 0).allowed).toBe(true);
  });

  it('sweeps away buckets that have refilled completely', () => {
    const limiter = createRateLimiter({ client: FAST, global: null });
    limiter.take('a', 1, 0);
    limiter.take('b', 5, 0);
    expect(limiter.size()).toBe(2);

    expect(limiter.sweep(0)).toBe(0);
    // `a` spent one token and is full again after 100 ms; `b` spent all five.
    expect(limiter.sweep(200)).toBe(1);
    expect(limiter.size()).toBe(1);
    expect(limiter.sweep(1_000)).toBe(1);
    expect(limiter.size()).toBe(0);
  });

  it('bounds how many client buckets it will hold, evicting the coldest first', () => {
    const limiter = createRateLimiter({ client: FAST, global: null, maxClients: 3 });
    // Each of these spends its whole burst, so none can be swept as idle.
    limiter.take('a', 5, 0);
    limiter.take('b', 5, 0);
    limiter.take('c', 5, 0);
    expect(limiter.size()).toBe(3);

    limiter.take('d', 5, 0);
    expect(limiter.size()).toBe(3);
    // `a` was the coldest, so it is the one that went -- and comes back with a full
    // bucket, which is the cost of a bounded map and the reason the bound is large.
    expect(limiter.take('a', 1, 0).allowed).toBe(true);
    expect(limiter.take('d', 1, 0).allowed).toBe(false);
  });

  it('keeps a bucket warm by touching it, so a busy client is not the one evicted', () => {
    const limiter = createRateLimiter({ client: FAST, global: null, maxClients: 2 });
    limiter.take('a', 5, 0);
    limiter.take('b', 5, 0);
    limiter.take('a', 1, 0); // refused, but it still touches `a`
    limiter.take('c', 5, 0);
    // `b` was the coldest by then, so `b` went and `a` is still throttled.
    expect(limiter.take('a', 1, 0).allowed).toBe(false);
    expect(limiter.take('b', 1, 0).allowed).toBe(true);
  });

  it('prefers to evict idle buckets before busy ones', () => {
    // One token every ten seconds, so the two clients recover at a legible pace.
    const slow: RateLimitRule = { limit: 1, windowMs: 10_000, burst: 5 };
    const limiter = createRateLimiter({ client: slow, global: null, maxClients: 2 });
    limiter.take('idle', 1, 0);
    limiter.take('busy', 5, 0);

    // Ten seconds on, `idle` has refilled completely and `busy` has one token back.
    limiter.take('new', 5, 10_000);
    expect(limiter.size()).toBe(2);
    // `idle` was swept, so `busy` survived: it still cannot spend a full burst, which
    // an evicted-and-recreated bucket would happily have allowed.
    expect(limiter.peek('busy', 5, 10_000).allowed).toBe(false);
    expect(limiter.peek('busy', 1, 10_000).allowed).toBe(true);
  });

  it('uses the injected clock when no timestamp is given', () => {
    const now = vi.fn(() => 0);
    const limiter = createRateLimiter({ client: FAST, global: null, now });
    limiter.take('a', 5);
    expect(limiter.take('a').allowed).toBe(false);
    now.mockReturnValue(1_000);
    expect(limiter.take('a').allowed).toBe(true);
    expect(limiter.peek('a').allowed).toBe(true);
    expect(limiter.sweep()).toBe(0);
  });

  it('falls back to Date.now when no clock is injected', () => {
    const limiter = createRateLimiter({ client: FAST, global: null });
    expect(limiter.take('a').allowed).toBe(true);
    expect(limiter.peek('a').allowed).toBe(true);
    expect(limiter.sweep()).toBe(0);
  });

  it('runs on sane defaults when configured with nothing at all', () => {
    const limiter = createRateLimiter();
    for (
      let i = 0;
      i < (DEFAULT_CLIENT_RULE.burst ?? DEFAULT_CLIENT_RULE.limit);
      i += 1
    ) {
      expect(limiter.take('a', 1, 0).allowed).toBe(true);
    }
    expect(limiter.take('a', 1, 0).allowed).toBe(false);
    expect(DEFAULT_GLOBAL_RULE.limit).toBeGreaterThan(DEFAULT_CLIENT_RULE.limit);
    expect(DEFAULT_MAX_CLIENTS).toBeGreaterThan(1_000);
  });

  it('treats a rule with no burst as a bucket the size of its limit', () => {
    const limiter = createRateLimiter({
      client: { limit: 2, windowMs: 1_000 },
      global: null,
    });
    expect(limiter.take('a', 1, 0).remaining).toBe(1);
    expect(limiter.take('a', 1, 0).remaining).toBe(0);
    expect(limiter.take('a', 1, 0).allowed).toBe(false);
  });

  it('never builds a bucket smaller than one token, or a map smaller than one client', () => {
    const limiter = createRateLimiter({
      client: { limit: 0.5, windowMs: 1_000 },
      global: null,
      maxClients: 0,
    });
    expect(limiter.take('a', 1, 0).allowed).toBe(true);
    expect(limiter.take('a', 1, 0).allowed).toBe(false);
  });
});

describe('rateLimitHeaders', () => {
  it('carries Retry-After only on a refusal', () => {
    const limiter = createRateLimiter({ client: FAST, global: null });
    const allowed = limiter.take('a', 1, 0);
    expect(rateLimitHeaders(allowed)).toEqual({
      'X-RateLimit-Limit': '5',
      'X-RateLimit-Remaining': '4',
      'X-RateLimit-Reset': '1',
    });

    const refused = limiter.take('a', 9, 0);
    expect(rateLimitHeaders(refused)['Retry-After']).toBe('1');
    expect(rateLimitHeaders(refused)['X-RateLimit-Remaining']).toBe('4');
  });

  it('reports the reset as whole epoch seconds', () => {
    expect(
      rateLimitHeaders({
        allowed: true,
        limit: 5,
        remaining: 5,
        retryAfterSeconds: 0,
        resetAtMs: 1_700_000_000_500,
      })['X-RateLimit-Reset'],
    ).toBe('1700000001');
  });
});

describe('clientBucketKey', () => {
  it('keys an IPv4 client by its exact address', () => {
    expect(clientBucketKey(ip('203.0.113.9'))).toBe('203.0.113.9');
  });

  it('keys an IPv6 client by its /64, because one subscriber holds a whole prefix', () => {
    expect(clientBucketKey(ip('2001:db8:1:2:3:4:5:6'))).toBe('2001:db8:1:2::/64');
    expect(clientBucketKey(ip('2001:db8:1:2::99'))).toBe('2001:db8:1:2::/64');
    expect(clientBucketKey(ip('2001:db8:1:3::1'))).not.toBe('2001:db8:1:2::/64');
  });

  it('unwraps an IPv4-mapped client into its IPv4 bucket', () => {
    expect(clientBucketKey(ip('::ffff:203.0.113.9'))).toBe('203.0.113.9');
  });
});

describe('clientKeyFrom', () => {
  it('prefers the platform header over the forwarded chain', () => {
    expect(clientKeyFrom('9.9.9.9', '203.0.113.9')).toBe('203.0.113.9');
  });

  it('takes the leftmost entry of X-Forwarded-For when that is all there is', () => {
    expect(clientKeyFrom('203.0.113.9, 70.41.3.18, 150.172.238.178')).toBe('203.0.113.9');
    expect(clientKeyFrom(' 203.0.113.9 ')).toBe('203.0.113.9');
  });

  it('strips a port from a forwarded entry', () => {
    expect(clientKeyFrom('203.0.113.9:51234')).toBe('203.0.113.9');
    expect(clientKeyFrom('[2001:db8:1:2::1]:443')).toBe('2001:db8:1:2::/64');
  });

  it('accepts a bare IPv6 entry', () => {
    expect(clientKeyFrom('2001:db8:1:2::1')).toBe('2001:db8:1:2::/64');
  });

  it('falls back to the forwarded chain when the platform header is unusable', () => {
    expect(clientKeyFrom('203.0.113.9', null)).toBe('203.0.113.9');
    expect(clientKeyFrom('203.0.113.9', '')).toBe('203.0.113.9');
    expect(clientKeyFrom('203.0.113.9', 'garbage')).toBe('203.0.113.9');
  });

  it('gives an unidentifiable caller the shared bucket rather than an exemption', () => {
    expect(clientKeyFrom(null)).toBe(UNKNOWN_CLIENT_KEY);
    expect(clientKeyFrom(undefined)).toBe(UNKNOWN_CLIENT_KEY);
    expect(clientKeyFrom('')).toBe(UNKNOWN_CLIENT_KEY);
    expect(clientKeyFrom('   ')).toBe(UNKNOWN_CLIENT_KEY);
    expect(clientKeyFrom('not-an-address')).toBe(UNKNOWN_CLIENT_KEY);
    expect(clientKeyFrom('2130706433')).toBe(UNKNOWN_CLIENT_KEY);
    expect(clientKeyFrom('[bogus')).toBe(UNKNOWN_CLIENT_KEY);
  });

  it('shares one bucket between every unidentifiable caller', () => {
    const limiter = createRateLimiter({ client: FAST, global: null });
    for (let i = 0; i < 5; i += 1) {
      expect(limiter.take(clientKeyFrom(null), 1, 0).allowed).toBe(true);
    }
    expect(limiter.take(clientKeyFrom('nonsense'), 1, 0).allowed).toBe(false);
  });
});
