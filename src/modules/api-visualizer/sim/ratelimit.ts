/**
 * Rate limiting -- the token bucket, the 429, and the client that behaves.
 *
 * A rate limit is a promise in two parts, and most descriptions give only one of them. "100
 * requests per minute" is a *sustained rate*. It says nothing about whether 100 requests in
 * the first second are allowed, and that second number -- the **burst** -- is the one that
 * decides whether a well-written client works.
 *
 * A token bucket states both, which is why it is the algorithm worth animating:
 *
 * - the bucket holds at most `capacity` tokens; that is the burst;
 * - tokens are added at `refillPerSecond`; that is the sustained rate;
 * - a request costs a token, and a request that finds the bucket empty is refused.
 *
 * Everything a client needs to know follows from those three numbers, and all of it is
 * visible on screen: the level falls as requests are spent, rises while the client waits, and
 * the moment it crosses back above one is exactly the `Retry-After` the server sent.
 *
 * ## The server's obligation
 *
 * A `429` without `Retry-After` is a refusal with no information. The client is told to slow
 * down and not told by how much, so it guesses -- and since every client guesses the same
 * way, they synchronise and arrive together. Half of what this file models is the server
 * doing its part: {@link rateLimitResponse} always carries `Retry-After`, and the
 * `RateLimit-*` fields let a client see the wall approaching rather than only feeling it.
 *
 * ## The client's obligation
 *
 * The other half is backing off, and doing it with **jitter**. Exponential backoff alone
 * fixes the rate and preserves the synchronisation: a thousand clients refused at the same
 * instant, each doubling from the same base, retry together at 1s, then together at 2s, then
 * together at 4s. {@link backoffDelayMs} makes the jitter a first-class option because the
 * version without it is the version people write.
 *
 * All randomness comes from `@/core/sim/rng`, seeded, so a jittered run replays exactly.
 */

import type { Rng } from '@/core/sim/rng';
import { createRng } from '@/core/sim/rng';
import type { RfcRef } from '@/core/types/events';

import {
  header,
  headerValue,
  type HeaderList,
  type HttpRequest,
  type HttpResponse,
} from './message';
import { problem } from './rest';

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

/** RFC 6585 s 4 -- 429 Too Many Requests. */
export const RFC_6585_429: RfcRef = {
  rfc: 6585,
  section: '4',
  title: 'Additional HTTP Status Codes',
};

/** RFC 9110 s 10.2.3 -- the Retry-After field. */
export const RFC_9110_RETRY_AFTER: RfcRef = {
  rfc: 9110,
  section: '10.2.3',
  title: 'HTTP Semantics',
};

/**
 * Where the `RateLimit-*` fields come from -- and the honest answer is "a draft".
 *
 * `Retry-After` and `429` are settled standards. The fields that announce a limit *before* it
 * is hit are not: they were specified by the IETF HTTP API working group as
 * `draft-ietf-httpapi-ratelimit-headers`, which went through several incompatible revisions
 * -- three separate fields early on, a single structured-field `RateLimit` later. Deployed
 * APIs sit at various points along that history.
 *
 * Underneath that sits the `X-RateLimit-*` family, which has no specification at all. It is
 * a convention that spread by imitation, and different APIs disagree about whether `Reset` is
 * a delta in seconds or an absolute Unix timestamp -- a difference no client can detect
 * except by getting it wrong.
 *
 * This is not a footnote to skip. "Which headers do I read?" has no clean answer, and
 * pretending otherwise would leave a learner confidently wrong.
 */
export const RATELIMIT_HEADER_STATUS =
  'The RateLimit-* fields are an IETF draft (draft-ietf-httpapi-ratelimit-headers), not a finished RFC, and the draft changed shape more than once -- some APIs send three separate fields, newer ones send a single structured RateLimit field. The older X-RateLimit-* family has no specification whatsoever, and APIs disagree about whether its Reset value is seconds-from-now or an absolute Unix timestamp. Only 429 and Retry-After are standardised.';

// ---------------------------------------------------------------------------
// The bucket
// ---------------------------------------------------------------------------

/**
 * A token bucket. Immutable -- every operation returns a new one.
 *
 * `tokens` is fractional on purpose. Rounding it to an integer would make the refill jerk
 * forward one token at a time and would quietly lose the remainder on every partial interval,
 * so a bucket refilling at 0.5/s would never refill at all if it were consulted every second
 * and rounded down.
 */
export interface TokenBucket {
  /** Maximum tokens held: the burst size. */
  readonly capacity: number;
  /** Tokens added per second: the sustained rate. */
  readonly refillPerSecond: number;
  /** Tokens available as of `updatedAtMs`. Fractional. */
  readonly tokens: number;
  /** Virtual millisecond the level was last computed at. */
  readonly updatedAtMs: number;
}

/** Create a bucket, full unless told otherwise -- a new client starts with its burst. */
export function createBucket(init: {
  capacity: number;
  refillPerSecond: number;
  tokens?: number;
  atMs?: number;
}): TokenBucket {
  if (init.capacity <= 0) throw new RangeError('capacity must be positive');
  if (init.refillPerSecond <= 0) throw new RangeError('refillPerSecond must be positive');
  return {
    capacity: init.capacity,
    refillPerSecond: init.refillPerSecond,
    tokens: Math.min(init.tokens ?? init.capacity, init.capacity),
    updatedAtMs: init.atMs ?? 0,
  };
}

/**
 * Bring the bucket up to date at `atMs`.
 *
 * There is no timer anywhere in this file. The level is *computed* from elapsed time whenever
 * anyone looks, which is how a real limiter works too: a server tracking a million clients
 * cannot run a million refill timers, so it stores a level and a timestamp and does this
 * arithmetic on arrival.
 *
 * Clamping at `capacity` is what makes a bucket a bucket. Time spent idle beyond full is
 * lost, so a client that sleeps for an hour gets a burst, not an hour's worth of credit.
 */
export function refill(bucket: TokenBucket, atMs: number): TokenBucket {
  if (atMs <= bucket.updatedAtMs) return bucket;
  const elapsedSeconds = (atMs - bucket.updatedAtMs) / 1000;
  return {
    ...bucket,
    tokens: Math.min(
      bucket.capacity,
      bucket.tokens + elapsedSeconds * bucket.refillPerSecond,
    ),
    updatedAtMs: atMs,
  };
}

/** The outcome of trying to spend a token. */
export interface ConsumeResult {
  /** The bucket afterwards: one token lighter, or untouched if refused. */
  readonly bucket: TokenBucket;
  readonly allowed: boolean;
  /** Whole tokens left, rounded down -- the number a client can act on. */
  readonly remaining: number;
  /** Seconds until the request would succeed. Zero when it just did. */
  readonly retryAfterSeconds: number;
  /** Seconds until the bucket is full again. What `RateLimit-Reset` reports. */
  readonly resetSeconds: number;
}

/**
 * Try to spend `cost` tokens at `atMs`.
 *
 * A refused request costs nothing. That matters: a limiter that decremented on refusal would
 * punish a client for being refused, and a client retrying in a tight loop could hold its own
 * bucket empty forever.
 *
 * `retryAfterSeconds` is rounded **up**. Rounding down would hand the client a moment at
 * which the bucket is still fractionally short, so an obedient client would be refused again
 * -- which looks, from the outside, exactly like the server lying.
 */
export function consume(bucket: TokenBucket, atMs: number, cost = 1): ConsumeResult {
  const current = refill(bucket, atMs);
  const resetSeconds = secondsToReachTokens(current, current.capacity);

  if (current.tokens >= cost) {
    const spent = { ...current, tokens: current.tokens - cost };
    return {
      bucket: spent,
      allowed: true,
      remaining: Math.floor(spent.tokens),
      retryAfterSeconds: 0,
      resetSeconds: secondsToReachTokens(spent, spent.capacity),
    };
  }

  return {
    bucket: current,
    allowed: false,
    remaining: Math.floor(current.tokens),
    retryAfterSeconds: Math.max(1, Math.ceil(secondsToReachTokens(current, cost))),
    resetSeconds,
  };
}

function secondsToReachTokens(bucket: TokenBucket, wanted: number): number {
  const shortfall = Math.min(wanted, bucket.capacity) - bucket.tokens;
  return shortfall <= 0 ? 0 : shortfall / bucket.refillPerSecond;
}

/** How full the bucket is, in `[0, 1]` -- what a meter renders. */
export function bucketLevel(bucket: TokenBucket, atMs: number): number {
  return refill(bucket, atMs).tokens / bucket.capacity;
}

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

/** Which family of announcement fields a server sends. */
export type RateLimitHeaderStyle =
  /** The three-field draft form: `RateLimit-Limit`, `-Remaining`, `-Reset`. */
  | 'draft-fields'
  /** The later single structured field: `RateLimit: limit=..., remaining=..., reset=...`. */
  | 'draft-structured'
  /** The unspecified but ubiquitous `X-RateLimit-*` convention. */
  | 'x-prefixed';

/**
 * The fields announcing the limit, in whichever style.
 *
 * These are advisory in every style: they tell a client how much room is left so it can slow
 * down *before* being refused, which is the difference between an integration that paces
 * itself and one that discovers the limit by hitting it.
 *
 * `reset` is a **delta in seconds**, not a timestamp, in both draft forms. That choice avoids
 * the clock-skew problem an absolute time would create -- a client whose clock is two minutes
 * fast would compute a negative wait and hammer the server.
 */
export function rateLimitHeaders(
  result: ConsumeResult,
  style: RateLimitHeaderStyle = 'draft-fields',
): HeaderList {
  const limit = result.bucket.capacity;
  const remaining = Math.max(0, result.remaining);
  const reset = Math.ceil(result.resetSeconds);

  switch (style) {
    case 'draft-structured':
      return [
        header('RateLimit', `limit=${limit}, remaining=${remaining}, reset=${reset}`),
        header(
          'RateLimit-Policy',
          `${limit};w=${Math.ceil(limit / result.bucket.refillPerSecond)}`,
        ),
      ];
    case 'x-prefixed':
      return [
        header('X-RateLimit-Limit', `${limit}`),
        header('X-RateLimit-Remaining', `${remaining}`),
        header('X-RateLimit-Reset', `${reset}`),
      ];
    case 'draft-fields':
    default:
      return [
        header('RateLimit-Limit', `${limit}`),
        header('RateLimit-Remaining', `${remaining}`),
        header('RateLimit-Reset', `${reset}`),
      ];
  }
}

/**
 * The `429`, with everything a client needs to recover.
 *
 * `Retry-After` is the field that turns a refusal into an instruction. RFC 9110 s 10.2.3
 * allows either a delta in seconds or an HTTP-date; the delta is used here for the same
 * clock-skew reason as above, and because it is what a client can pass straight to a timer.
 *
 * The announcement fields are sent on the `429` as well as on successes -- a client that only
 * learns its remaining quota when refused has learned it too late.
 */
export function rateLimitResponse(
  result: ConsumeResult,
  style: RateLimitHeaderStyle = 'draft-fields',
): HttpResponse {
  const document = problem(
    429,
    `Rate limit exceeded. The bucket holds ${result.bucket.capacity} requests and refills at ${result.bucket.refillPerSecond} per second.`,
  );
  return {
    ...document,
    headers: [
      ...document.headers,
      header('Retry-After', `${result.retryAfterSeconds}`),
      ...rateLimitHeaders(result, style),
    ],
  };
}

/** Attach the announcement fields to a successful response. */
export function withRateLimitHeaders(
  result: HttpResponse,
  consumed: ConsumeResult,
  style: RateLimitHeaderStyle = 'draft-fields',
): HttpResponse {
  return {
    ...result,
    headers: [...result.headers, ...rateLimitHeaders(consumed, style)],
  };
}

/**
 * Read `Retry-After` as milliseconds.
 *
 * Only the delta-seconds form is parsed. The HTTP-date form is legal and is deliberately not
 * supported here, because acting on it requires trusting the client's own clock against the
 * server's -- and a client whose clock is wrong will either hammer or sleep for hours.
 */
export function retryAfterMs(headers: HeaderList): number | undefined {
  const value = headerValue(headers, 'Retry-After');
  if (value === undefined) return undefined;
  const seconds = Number(value.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return seconds * 1000;
}

// ---------------------------------------------------------------------------
// Backoff
// ---------------------------------------------------------------------------

/** How a client spreads its retries. */
export type JitterStrategy =
  /** No jitter. Deterministic, and the reason a thousand clients retry in unison. */
  | 'none'
  /** A uniform draw from `[0, delay]`. Maximum spread, minimum coordination. */
  | 'full'
  /** Half the delay plus a uniform draw from `[0, delay/2]`. Spread without collapsing. */
  | 'equal';

/** Parameters of an exponential backoff. */
export interface BackoffOptions {
  /** The first delay, before any doubling. */
  readonly baseMs: number;
  /** The multiplier per attempt. 2 is the usual choice. */
  readonly factor?: number;
  /** The ceiling, so an eighth retry does not wait four hours. */
  readonly capMs: number;
  readonly jitter?: JitterStrategy;
  /** Seeded generator. Required for `'full'` and `'equal'`; a run must be reproducible. */
  readonly rng?: Rng;
}

/**
 * The delay before retry number `attempt`, counting from zero.
 *
 * Exponential growth is the easy half and the half everyone implements. The **jitter** is the
 * half that matters at scale: without it, backoff preserves whatever synchronisation caused
 * the overload. A deploy restarts a fleet, every instance is refused at the same instant, and
 * they retry together at 1s, 2s, 4s -- the same spike, arriving less often. With full jitter
 * the same fleet spreads itself across each interval and the queue drains.
 *
 * The cap is not decoration either. `2^n` with no ceiling reaches a seventeen-minute wait by
 * the tenth attempt, at which point the client has effectively stopped without saying so.
 */
export function backoffDelayMs(attempt: number, options: BackoffOptions): number {
  const factor = options.factor ?? 2;
  const uncapped = options.baseMs * Math.pow(factor, Math.max(0, attempt));
  const delay = Math.min(options.capMs, uncapped);
  const jitter = options.jitter ?? 'none';
  if (jitter === 'none') return delay;

  const rng = options.rng;
  if (!rng) {
    throw new Error(
      `jitter "${jitter}" needs a seeded rng; a simulation may not call Math.random()`,
    );
  }
  return jitter === 'full' ? rng.next() * delay : delay / 2 + rng.next() * (delay / 2);
}

/** The first `attempts` delays, for showing the curve. */
export function backoffSchedule(
  attempts: number,
  options: BackoffOptions,
): readonly number[] {
  return Array.from({ length: attempts }, (_, attempt) =>
    backoffDelayMs(attempt, options),
  );
}

// ---------------------------------------------------------------------------
// A client that behaves
// ---------------------------------------------------------------------------

/** One attempt in a client's run. */
export interface ClientAttempt {
  /** Which try this is for the current request, counting from zero. */
  readonly attempt: number;
  readonly atMs: number;
  readonly allowed: boolean;
  readonly status: number;
  readonly response: HttpResponse;
  /** Whole tokens the server said were left. */
  readonly remaining: number;
  /** How long the client waited afterwards. Zero on the last attempt. */
  readonly waitMs: number;
  /** Where that wait came from. */
  readonly waitSource: 'retry-after' | 'backoff' | 'none';
}

/** What a whole run looked like. */
export interface ClientRun {
  readonly attempts: readonly ClientAttempt[];
  readonly bucket: TokenBucket;
  /** Requests that eventually succeeded. */
  readonly delivered: number;
  /** Requests abandoned after `maxAttempts`. */
  readonly abandoned: number;
  /** Virtual millisecond the run ended. */
  readonly endedAtMs: number;
}

/** How the client behaves when refused. */
export interface ClientOptions {
  readonly bucket: TokenBucket;
  /** How many requests the client wants to make. */
  readonly requests: number;
  /** Virtual millisecond of the first attempt. */
  readonly startMs?: number;
  /** Gap between successive *successful* requests -- how fast the client wants to go. */
  readonly spacingMs?: number;
  readonly backoff: BackoffOptions;
  /** Attempts per request before giving up. */
  readonly maxAttempts?: number;
  /**
   * Whether the client obeys `Retry-After` when the server sends one.
   *
   * Set it to `false` to show the failure mode: a client that ignores the server's own
   * instruction and backs off on its own schedule either waits far too long or -- more
   * commonly -- retries too early and is refused again.
   */
  readonly obeyRetryAfter?: boolean;
  readonly headerStyle?: RateLimitHeaderStyle;
}

/**
 * Run a client against a bucket and record what happened.
 *
 * The rule the client follows is the correct one and is worth stating on its own:
 * **the server's `Retry-After` wins over the client's own backoff.** The client's exponential
 * curve is a guess made in the absence of information; `Retry-After` is the server saying
 * exactly when the bucket will have a token. Preferring the guess is how a well-intentioned
 * retry library ends up refused three times in a row.
 *
 * Backoff still applies when the server sends no instruction -- a timeout, a `503`, a
 * connection reset -- which is precisely when a guess is all the client has.
 */
export function runRateLimitedClient(options: ClientOptions): ClientRun {
  const maxAttempts = options.maxAttempts ?? 5;
  const spacingMs = options.spacingMs ?? 0;
  const obey = options.obeyRetryAfter ?? true;
  const attempts: ClientAttempt[] = [];

  let bucket = options.bucket;
  let now = options.startMs ?? 0;
  let delivered = 0;
  let abandoned = 0;

  for (let request = 0; request < options.requests; request += 1) {
    let attempt = 0;
    for (;;) {
      const result = consume(bucket, now);
      bucket = result.bucket;

      const isLastAttempt = attempt + 1 >= maxAttempts;
      const wait = result.allowed
        ? spacingMs
        : isLastAttempt
          ? 0
          : nextWait(result, attempt, options, obey);

      attempts.push({
        attempt,
        atMs: now,
        allowed: result.allowed,
        status: result.allowed ? 200 : 429,
        response: result.allowed
          ? withRateLimitHeaders(
              { status: 200, reason: 'OK', headers: [] },
              result,
              options.headerStyle,
            )
          : rateLimitResponse(result, options.headerStyle),
        remaining: Math.max(0, result.remaining),
        waitMs: wait,
        waitSource: result.allowed
          ? 'none'
          : isLastAttempt
            ? 'none'
            : obey
              ? 'retry-after'
              : 'backoff',
      });

      now += wait;

      if (result.allowed) {
        delivered += 1;
        break;
      }
      attempt += 1;
      if (attempt >= maxAttempts) {
        abandoned += 1;
        break;
      }
    }
  }

  return { attempts, bucket, delivered, abandoned, endedAtMs: now };
}

function nextWait(
  result: ConsumeResult,
  attempt: number,
  options: ClientOptions,
  obey: boolean,
): number {
  if (obey) return result.retryAfterSeconds * 1000;
  return backoffDelayMs(attempt, options.backoff);
}

/** A seeded generator for a scenario's jitter, so a jittered run replays exactly. */
export function jitterRng(seed: number | string): Rng {
  return createRng(seed);
}

// ---------------------------------------------------------------------------
// The other algorithms
// ---------------------------------------------------------------------------

/** One limiting algorithm, and what it gets wrong. */
export interface LimiterAlgorithm {
  readonly name: string;
  readonly how: string;
  readonly strength: string;
  /** The failure mode. Every one of these has a specific, well-known one. */
  readonly weakness: string;
}

/**
 * The four algorithms, compared honestly.
 *
 * The fixed window's boundary problem is the one worth demonstrating: with a limit of 100 per
 * minute, a client can send 100 at 00:59 and 100 more at 01:00 -- 200 requests in two seconds,
 * every one of them within the limit as written. That is not a bug in an implementation; it is
 * what the rule literally says, and it is why the algorithm survives mainly for being trivial
 * to implement with a counter and an expiry.
 */
export const LIMITER_ALGORITHMS: readonly LimiterAlgorithm[] = [
  {
    name: 'Fixed window',
    how: 'One counter per client per clock-aligned window; reset it when the window rolls over.',
    strength: 'Two values per client and no arithmetic. Cheap enough to run anywhere.',
    weakness:
      'Twice the limit can pass in an instant across a window boundary: the full quota at the end of one window and the full quota at the start of the next.',
  },
  {
    name: 'Sliding window log',
    how: 'Store the timestamp of every request; count those inside the trailing window.',
    strength: 'Exact. No boundary artefact, because there is no boundary.',
    weakness:
      'Memory grows with the limit and the traffic -- a timestamp per request, per client, kept for the whole window.',
  },
  {
    name: 'Token bucket',
    how: 'A bucket refilling at a fixed rate; each request spends a token.',
    strength:
      'States the burst and the sustained rate as two separate numbers, which is what a client actually needs to know.',
    weakness:
      'A client that saves up its full burst can still spike, which is usually the point but occasionally the problem.',
  },
  {
    name: 'Leaky bucket',
    how: 'A queue drained at a constant rate; requests arriving at a full queue are dropped.',
    strength:
      'Output is perfectly smooth -- the downstream service sees a constant rate.',
    weakness:
      'No burst at all, and queuing adds latency the client cannot see. A request may sit waiting rather than being refused quickly.',
  },
];

/** A request's cost, when an API prices operations differently. Default is one token. */
export function requestCost(
  incoming: HttpRequest,
  costs: Readonly<Record<string, number>> = {},
): number {
  return costs[incoming.method] ?? 1;
}
