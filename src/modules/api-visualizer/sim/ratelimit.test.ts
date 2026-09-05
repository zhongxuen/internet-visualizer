import { describe, expect, it } from 'vitest';

import { headerValue } from './message';
import {
  backoffDelayMs,
  backoffSchedule,
  bucketLevel,
  consume,
  createBucket,
  jitterRng,
  LIMITER_ALGORITHMS,
  rateLimitHeaders,
  rateLimitResponse,
  refill,
  retryAfterMs,
  runRateLimitedClient,
  withRateLimitHeaders,
  type TokenBucket,
} from './ratelimit';

const SECOND = 1000;

/** Ten requests of burst, refilling at two per second. */
const bucket = (): TokenBucket => createBucket({ capacity: 10, refillPerSecond: 2 });

describe('createBucket', () => {
  it('starts full, so a new client gets its whole burst', () => {
    expect(bucket().tokens).toBe(10);
  });

  it('never starts above capacity', () => {
    expect(createBucket({ capacity: 5, refillPerSecond: 1, tokens: 50 }).tokens).toBe(5);
  });

  it('refuses a non-positive capacity or rate', () => {
    expect(() => createBucket({ capacity: 0, refillPerSecond: 1 })).toThrow(RangeError);
    expect(() => createBucket({ capacity: 1, refillPerSecond: 0 })).toThrow(RangeError);
  });
});

describe('refill', () => {
  it('adds tokens in proportion to elapsed time', () => {
    const empty = createBucket({ capacity: 10, refillPerSecond: 2, tokens: 0 });
    expect(refill(empty, 3 * SECOND).tokens).toBe(6);
  });

  it('keeps fractional tokens rather than rounding them away', () => {
    const empty = createBucket({ capacity: 10, refillPerSecond: 2, tokens: 0 });
    expect(refill(empty, 500).tokens).toBe(1);
    expect(refill(empty, 250).tokens).toBe(0.5);
  });

  it('clamps at capacity: idle time past full is lost', () => {
    const empty = createBucket({ capacity: 10, refillPerSecond: 2, tokens: 0 });
    expect(refill(empty, 60 * SECOND).tokens).toBe(10);
  });

  it('does not run backwards for a time already accounted for', () => {
    const started = refill(bucket(), 5 * SECOND);
    expect(refill(started, 2 * SECOND)).toEqual(started);
  });

  it('accumulates the same whether consulted often or once', () => {
    // The refill is computed from elapsed time, not stepped, so a bucket polled ten times
    // must land exactly where one polled once does. Anything else would leak tokens.
    const empty = createBucket({ capacity: 10, refillPerSecond: 2, tokens: 0 });
    let stepped = empty;
    for (let at = 100; at <= 1000; at += 100) stepped = refill(stepped, at);
    expect(stepped.tokens).toBeCloseTo(refill(empty, 1000).tokens, 10);
  });
});

describe('consume', () => {
  it('spends a token and reports what is left', () => {
    const result = consume(bucket(), 0);
    expect(result.allowed).toBe(true);
    expect(result.bucket.tokens).toBe(9);
    expect(result.remaining).toBe(9);
    expect(result.retryAfterSeconds).toBe(0);
  });

  it('allows exactly the burst and then refuses', () => {
    let current = bucket();
    for (let request = 0; request < 10; request += 1) {
      const result = consume(current, 0);
      expect(result.allowed).toBe(true);
      current = result.bucket;
    }
    expect(consume(current, 0).allowed).toBe(false);
  });

  it('charges nothing for a refused request', () => {
    const drained = createBucket({ capacity: 10, refillPerSecond: 2, tokens: 0 });
    const refused = consume(drained, 0);
    expect(refused.allowed).toBe(false);
    expect(refused.bucket.tokens).toBe(0);
    // A client hammering an empty bucket must not be able to hold it empty.
    expect(consume(refused.bucket, 0).bucket.tokens).toBe(0);
  });

  it('reports a Retry-After the client can actually act on', () => {
    const drained = createBucket({ capacity: 10, refillPerSecond: 2, tokens: 0 });
    const refused = consume(drained, 0);
    // Half a second buys one token; rounding down to 0 would be an instruction to retry
    // immediately and be refused again, so it rounds up to a whole second.
    expect(refused.retryAfterSeconds).toBe(1);

    const waited = consume(refused.bucket, refused.retryAfterSeconds * SECOND);
    expect(waited.allowed).toBe(true);
  });

  it('never tells a client to retry in zero seconds', () => {
    const almost = createBucket({ capacity: 10, refillPerSecond: 2, tokens: 0.99 });
    expect(consume(almost, 0).retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('scales Retry-After with the shortfall', () => {
    const drained = createBucket({ capacity: 10, refillPerSecond: 1, tokens: 0 });
    expect(consume(drained, 0, 5).retryAfterSeconds).toBe(5);
  });

  it('reports seconds until the bucket is full again', () => {
    const half = createBucket({ capacity: 10, refillPerSecond: 2, tokens: 4 });
    // Six tokens short at two per second.
    expect(consume(half, 0).resetSeconds).toBe(3.5);
  });

  it('refills while a client waits, which is the whole animation', () => {
    let current = bucket();
    for (let request = 0; request < 10; request += 1)
      current = consume(current, 0).bucket;
    expect(bucketLevel(current, 0)).toBe(0);
    expect(bucketLevel(current, 2500)).toBeCloseTo(0.5, 10);
    expect(bucketLevel(current, 10 * SECOND)).toBe(1);
  });
});

describe('the 429', () => {
  it('always carries Retry-After', () => {
    const drained = createBucket({ capacity: 10, refillPerSecond: 2, tokens: 0 });
    const result = consume(drained, 0);
    const refusal = rateLimitResponse(result);
    expect(refusal.status).toBe(429);
    expect(headerValue(refusal.headers, 'Retry-After')).toBe('1');
  });

  it('carries the announcement fields too, so a client is not learning too late', () => {
    const drained = createBucket({ capacity: 10, refillPerSecond: 2, tokens: 0 });
    const refusal = rateLimitResponse(consume(drained, 0));
    expect(headerValue(refusal.headers, 'RateLimit-Limit')).toBe('10');
    expect(headerValue(refusal.headers, 'RateLimit-Remaining')).toBe('0');
  });

  it('is a problem document rather than an invented error shape', () => {
    const drained = createBucket({ capacity: 10, refillPerSecond: 2, tokens: 0 });
    const refusal = rateLimitResponse(consume(drained, 0));
    expect(headerValue(refusal.headers, 'Content-Type')).toBe('application/problem+json');
  });

  it('reads Retry-After back as milliseconds', () => {
    const drained = createBucket({ capacity: 4, refillPerSecond: 0.5, tokens: 0 });
    const refusal = rateLimitResponse(consume(drained, 0));
    expect(retryAfterMs(refusal.headers)).toBe(2000);
  });

  it('ignores an HTTP-date Retry-After rather than trusting the client clock', () => {
    expect(
      retryAfterMs([{ name: 'Retry-After', value: 'Wed, 21 Oct 2015 07:28:00 GMT' }]),
    ).toBeUndefined();
  });
});

describe('announcement header styles', () => {
  const result = consume(
    createBucket({ capacity: 10, refillPerSecond: 2, tokens: 4 }),
    0,
  );

  it('emits the three draft fields by default', () => {
    const headers = rateLimitHeaders(result);
    expect(headers.map((field) => field.name)).toEqual([
      'RateLimit-Limit',
      'RateLimit-Remaining',
      'RateLimit-Reset',
    ]);
  });

  it('can emit the later single structured field instead', () => {
    const headers = rateLimitHeaders(result, 'draft-structured');
    expect(headerValue(headers, 'RateLimit')).toMatch(/limit=10, remaining=3, reset=\d+/);
  });

  it('can emit the unspecified X-prefixed family', () => {
    const headers = rateLimitHeaders(result, 'x-prefixed');
    expect(headerValue(headers, 'X-RateLimit-Limit')).toBe('10');
  });

  it('reports reset as a delta in seconds, never a timestamp', () => {
    const reset = Number(headerValue(rateLimitHeaders(result), 'RateLimit-Reset'));
    expect(reset).toBeLessThan(1000);
  });

  it('attaches to a success as well as a refusal', () => {
    const success = withRateLimitHeaders(
      { status: 200, reason: 'OK', headers: [] },
      result,
    );
    expect(headerValue(success.headers, 'RateLimit-Remaining')).toBe('3');
  });
});

describe('backoff', () => {
  const options = { baseMs: 100, capMs: 2000 };

  it('doubles by default', () => {
    expect(backoffSchedule(5, options)).toEqual([100, 200, 400, 800, 1600]);
  });

  it('respects the cap, so an eighth retry does not wait for hours', () => {
    expect(backoffSchedule(8, options).at(-1)).toBe(2000);
  });

  it('honours a factor other than two', () => {
    expect(backoffSchedule(3, { ...options, factor: 3 })).toEqual([100, 300, 900]);
  });

  it('without jitter, every client retries at the same instant', () => {
    // The thundering herd, stated as a test: identical inputs, identical delays.
    const a = backoffSchedule(4, options);
    const b = backoffSchedule(4, options);
    expect(a).toEqual(b);
  });

  it('with full jitter, two clients spread across the interval', () => {
    const a = backoffSchedule(4, {
      ...options,
      jitter: 'full',
      rng: jitterRng('client-a'),
    });
    const b = backoffSchedule(4, {
      ...options,
      jitter: 'full',
      rng: jitterRng('client-b'),
    });
    expect(a).not.toEqual(b);
    a.forEach((delay, attempt) => {
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(backoffDelayMs(attempt, options));
    });
  });

  it('with equal jitter, the delay never collapses to zero', () => {
    const delays = backoffSchedule(6, {
      ...options,
      jitter: 'equal',
      rng: jitterRng('c'),
    });
    delays.forEach((delay, attempt) => {
      const ceiling = backoffDelayMs(attempt, options);
      expect(delay).toBeGreaterThanOrEqual(ceiling / 2);
      expect(delay).toBeLessThanOrEqual(ceiling);
    });
  });

  it('replays exactly for the same seed', () => {
    const first = backoffSchedule(5, { ...options, jitter: 'full', rng: jitterRng(7) });
    const second = backoffSchedule(5, { ...options, jitter: 'full', rng: jitterRng(7) });
    expect(first).toEqual(second);
  });

  it('refuses to jitter without a seeded generator', () => {
    expect(() => backoffDelayMs(0, { ...options, jitter: 'full' })).toThrow(/seeded rng/);
  });
});

describe('a client that behaves', () => {
  const backoff = { baseMs: 500, capMs: 8000 };

  it('sails through while the bucket has tokens', () => {
    const run = runRateLimitedClient({
      bucket: createBucket({ capacity: 5, refillPerSecond: 1 }),
      requests: 5,
      backoff,
    });
    expect(run.delivered).toBe(5);
    expect(run.attempts).toHaveLength(5);
    expect(run.attempts.every((attempt) => attempt.status === 200)).toBe(true);
  });

  it('is refused once the burst is spent, and recovers by obeying Retry-After', () => {
    const run = runRateLimitedClient({
      bucket: createBucket({ capacity: 3, refillPerSecond: 1 }),
      requests: 5,
      backoff,
    });
    expect(run.delivered).toBe(5);
    expect(run.abandoned).toBe(0);

    const refusals = run.attempts.filter((attempt) => attempt.status === 429);
    expect(refusals.length).toBeGreaterThan(0);
    // The server's instruction wins over the client's own curve.
    expect(refusals.every((attempt) => attempt.waitSource === 'retry-after')).toBe(true);
  });

  it('waits exactly as long as the server asked', () => {
    const run = runRateLimitedClient({
      bucket: createBucket({ capacity: 1, refillPerSecond: 1 }),
      requests: 2,
      backoff,
    });
    const refusal = run.attempts.find((attempt) => attempt.status === 429);
    expect(refusal?.waitMs).toBe(1000);
  });

  it('gives up after maxAttempts rather than retrying forever', () => {
    const run = runRateLimitedClient({
      bucket: createBucket({ capacity: 1, refillPerSecond: 0.001, tokens: 0 }),
      requests: 1,
      maxAttempts: 3,
      backoff,
      obeyRetryAfter: false,
    });
    expect(run.abandoned).toBe(1);
    expect(run.delivered).toBe(0);
    expect(run.attempts).toHaveLength(3);
  });

  it('backs off on its own curve when it ignores the server', () => {
    const run = runRateLimitedClient({
      bucket: createBucket({ capacity: 1, refillPerSecond: 0.001, tokens: 0 }),
      requests: 1,
      maxAttempts: 4,
      backoff,
      obeyRetryAfter: false,
    });
    const waits = run.attempts.slice(0, -1).map((attempt) => attempt.waitMs);
    expect(waits).toEqual([500, 1000, 2000]);
    expect(run.attempts[0].waitSource).toBe('backoff');
  });

  it('replays identically, because nothing here reads the wall clock', () => {
    const options = {
      bucket: createBucket({ capacity: 3, refillPerSecond: 1 }),
      requests: 6,
      backoff,
    };
    expect(runRateLimitedClient(options)).toEqual(runRateLimitedClient(options));
  });
});

describe('the algorithm comparison', () => {
  it('names a specific weakness for every algorithm', () => {
    expect(LIMITER_ALGORITHMS.length).toBeGreaterThanOrEqual(4);
    for (const algorithm of LIMITER_ALGORITHMS) {
      expect(algorithm.weakness.length).toBeGreaterThan(20);
      expect(algorithm.strength.length).toBeGreaterThan(20);
    }
  });

  it('records the fixed window boundary problem, which is the point of the table', () => {
    const fixed = LIMITER_ALGORITHMS.find((entry) => entry.name === 'Fixed window');
    expect(fixed?.weakness).toMatch(/boundary|window/i);
  });
});
