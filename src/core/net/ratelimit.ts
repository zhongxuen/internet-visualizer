/**
 * `ratelimit.ts` -- a token bucket, keyed by client, with a global bucket behind it.
 *
 * The phase-12 diagnostics routes are the only ones in the product that reach a real
 * network, and the security rules in CLAUDE.md require them to be "rate limited per IP
 * and globally". Two buckets, because they stop different things: the per-client bucket
 * stops one visitor from using the deployment as a probe, and the global bucket stops
 * a thousand visitors from doing it together.
 *
 * Like `guard.ts`, this file decides rather than acts. In particular the clock is a
 * parameter, not an import: every method takes an optional `at` timestamp, so a test
 * can move time forward exactly and assert on the refill arithmetic instead of
 * sleeping. The default clock is `Date.now`, supplied once at construction.
 *
 * A token bucket rather than a fixed window on purpose. A fixed window lets a caller
 * fire the whole quota in the last instant of one window and again in the first
 * instant of the next -- double the intended rate, right when it matters. A bucket
 * refills continuously and the burst is stated explicitly.
 *
 * State lives in memory, which is the right default for a Vercel deployment where each
 * instance handles its own traffic: the limit is then per-instance, which is
 * conservative in the direction that matters. Phase 12 in the overview notes that if it
 * must hold across instances, this is the seam where an Upstash Redis bucket goes.
 */

import { formatIp, parseIp, unwrapIpv4Mapped, type IpAddress } from './address';

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/**
 * A sustained rate plus a burst.
 *
 * `limit` tokens are restored over `windowMs`, continuously rather than in steps, and
 * the bucket holds at most `burst` (default `limit`) of them at once.
 */
export interface RateLimitRule {
  readonly limit: number;
  readonly windowMs: number;
  readonly burst?: number;
}

/**
 * Per client: a handful of lookups at once, then roughly one every six seconds.
 *
 * Generous enough that a person exploring the module never sees a 429, tight enough
 * that a script cannot walk a list of hosts through it.
 */
export const DEFAULT_CLIENT_RULE: RateLimitRule = {
  limit: 10,
  windowMs: 60_000,
  burst: 5,
};

/** Across the whole deployment, so the aggregate is bounded too. */
export const DEFAULT_GLOBAL_RULE: RateLimitRule = {
  limit: 120,
  windowMs: 60_000,
  burst: 30,
};

/** How many distinct client keys are tracked before the coldest are evicted. */
export const DEFAULT_MAX_CLIENTS = 10_000;

/** The key used when the client address cannot be determined. */
export const UNKNOWN_CLIENT_KEY = 'unknown';

function capacityOf(rule: RateLimitRule): number {
  return Math.max(1, Math.floor(rule.burst ?? rule.limit));
}

/** Tokens restored per millisecond. */
function refillRateOf(rule: RateLimitRule): number {
  return rule.limit / rule.windowMs;
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

/** Which bucket refused a request. */
export type RateLimitScope = 'client' | 'global';

/** The answer to "may this request proceed?", with everything a 429 needs. */
export interface RateLimitDecision {
  readonly allowed: boolean;
  /** The bucket that refused; absent when allowed. */
  readonly limitedBy?: RateLimitScope;
  /** The client bucket's capacity -- what `X-RateLimit-Limit` reports. */
  readonly limit: number;
  /** Whole tokens left in the client bucket after this decision. */
  readonly remaining: number;
  /** Seconds until a retry can succeed. At least 1 when refused, 0 when allowed. */
  readonly retryAfterSeconds: number;
  /** When the deciding bucket is full again, as an epoch millisecond timestamp. */
  readonly resetAtMs: number;
}

/**
 * The response headers a 429 (or a successful call) should carry.
 *
 * `Retry-After` is the one the acceptance criteria name; the `X-RateLimit-*` trio is
 * conventional and lets `RateLimitNotice` show a countdown without guessing.
 */
export function rateLimitHeaders(decision: RateLimitDecision): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(decision.limit),
    'X-RateLimit-Remaining': String(decision.remaining),
    'X-RateLimit-Reset': String(Math.ceil(decision.resetAtMs / 1000)),
  };
  if (!decision.allowed) {
    headers['Retry-After'] = String(decision.retryAfterSeconds);
  }
  return headers;
}

// ---------------------------------------------------------------------------
// The bucket
// ---------------------------------------------------------------------------

interface BucketState {
  tokens: number;
  updatedAt: number;
}

/** Tokens available at `at`, without mutating anything. */
function tokensAt(state: BucketState, rule: RateLimitRule, at: number): number {
  const elapsed = Math.max(0, at - state.updatedAt);
  return Math.min(capacityOf(rule), state.tokens + elapsed * refillRateOf(rule));
}

/** Milliseconds until the bucket holds `needed` tokens. */
function waitFor(tokens: number, needed: number, rule: RateLimitRule): number {
  if (tokens >= needed) return 0;
  return Math.ceil((needed - tokens) / refillRateOf(rule));
}

/** Milliseconds until the bucket is full again. */
function waitUntilFull(tokens: number, rule: RateLimitRule): number {
  return waitFor(tokens, capacityOf(rule), rule);
}

// ---------------------------------------------------------------------------
// The limiter
// ---------------------------------------------------------------------------

/** How a limiter is configured. Every field has a safe default. */
export interface RateLimiterOptions {
  readonly client?: RateLimitRule;
  /** Pass `null` to run with no global ceiling -- for tests, mostly. */
  readonly global?: RateLimitRule | null;
  readonly maxClients?: number;
  /** Injected clock. Defaults to `Date.now`; every method also takes an explicit `at`. */
  readonly now?: () => number;
}

/** A token-bucket limiter. Not thread-shared, not persisted, and deliberately small. */
export interface RateLimiter {
  /**
   * Spend `cost` tokens for `key` if both buckets can afford it.
   *
   * All-or-nothing: if the global bucket refuses, the client's tokens are not spent
   * either, so one busy minute across the deployment does not silently drain the quota
   * of every visitor who happened to arrive during it.
   */
  take(key: string, cost?: number, at?: number): RateLimitDecision;
  /** What {@link RateLimiter.take} would answer, without spending anything. */
  peek(key: string, cost?: number, at?: number): RateLimitDecision;
  /** Forget one client, or all of them. */
  reset(key?: string): void;
  /** Drop client buckets that have refilled completely; returns how many went. */
  sweep(at?: number): number;
  /** How many client buckets are being tracked. */
  size(): number;
}

/**
 * Build a limiter.
 *
 * The client map is a `Map` used as an LRU: a touched key is deleted and re-inserted,
 * so iteration order is coldest-first and eviction is the first `n` entries. Without a
 * bound, a stream of forged `X-Forwarded-For` values would be an unbounded allocation
 * in a long-lived instance -- the memory-leak shape of a rate limiter is itself a
 * denial-of-service.
 */
export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const clientRule = options.client ?? DEFAULT_CLIENT_RULE;
  const globalRule =
    options.global === null ? null : (options.global ?? DEFAULT_GLOBAL_RULE);
  const maxClients = Math.max(1, Math.floor(options.maxClients ?? DEFAULT_MAX_CLIENTS));
  const clock = options.now ?? Date.now;

  const clients = new Map<string, BucketState>();
  /**
   * The rule travels with the bucket rather than beside it, so every use is a single
   * `if (globalBucket)` -- there is no second condition that can never be false.
   */
  const globalBucket = globalRule
    ? {
        rule: globalRule,
        tokens: capacityOf(globalRule),
        updatedAt: Number.NEGATIVE_INFINITY,
      }
    : null;

  /**
   * The bucket for `key`, or a full one -- but only *read*. Nothing is stored until
   * {@link commitState}, so `peek` cannot allocate an entry and a flood of one-shot
   * forged keys cannot grow the map through it.
   */
  function readState(key: string, at: number): BucketState {
    return clients.get(key) ?? { tokens: capacityOf(clientRule), updatedAt: at };
  }

  /** Store the spent bucket, moving it to the warm end of the LRU. */
  function commitState(key: string, state: BucketState): void {
    if (clients.delete(key)) {
      clients.set(key, state);
      return;
    }
    if (clients.size >= maxClients) evict(state.updatedAt);
    clients.set(key, state);
  }

  function evict(at: number): void {
    // Idle buckets first: a client whose bucket has refilled completely is
    // indistinguishable from one that was never seen, so dropping it loses nothing.
    sweep(at);
    for (const coldest of clients.keys()) {
      if (clients.size < maxClients) break;
      clients.delete(coldest);
    }
  }

  function sweep(at = clock()): number {
    let removed = 0;
    for (const [key, state] of clients) {
      if (tokensAt(state, clientRule, at) >= capacityOf(clientRule)) {
        clients.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  function decide(
    key: string,
    cost: number,
    at: number,
    commit: boolean,
  ): RateLimitDecision {
    const spend = Math.max(1, Math.floor(cost));
    const client = readState(key, at);
    const clientTokens = tokensAt(client, clientRule, at);
    const clientLimit = capacityOf(clientRule);

    if (clientTokens < spend) {
      if (commit) {
        // Record the refill even on a refusal, so `updatedAt` never falls far behind.
        commitState(key, { tokens: clientTokens, updatedAt: at });
      }
      return {
        allowed: false,
        limitedBy: 'client',
        limit: clientLimit,
        remaining: Math.floor(clientTokens),
        retryAfterSeconds: Math.max(
          1,
          Math.ceil(waitFor(clientTokens, spend, clientRule) / 1000),
        ),
        resetAtMs: at + waitUntilFull(clientTokens, clientRule),
      };
    }

    if (globalBucket) {
      const globalTokens = tokensAt(globalBucket, globalBucket.rule, at);
      if (globalTokens < spend) {
        if (commit) {
          globalBucket.tokens = globalTokens;
          globalBucket.updatedAt = at;
          commitState(key, { tokens: clientTokens, updatedAt: at });
        }
        return {
          allowed: false,
          limitedBy: 'global',
          limit: clientLimit,
          // The client still has tokens; the deployment does not. Report the client's,
          // because that is what `X-RateLimit-Remaining` is documented to mean.
          remaining: Math.floor(clientTokens),
          retryAfterSeconds: Math.max(
            1,
            Math.ceil(waitFor(globalTokens, spend, globalBucket.rule) / 1000),
          ),
          resetAtMs: at + waitUntilFull(globalTokens, globalBucket.rule),
        };
      }
      if (commit) {
        globalBucket.tokens = globalTokens - spend;
        globalBucket.updatedAt = at;
      }
    }

    const left = clientTokens - spend;
    if (commit) {
      commitState(key, { tokens: left, updatedAt: at });
    }
    return {
      allowed: true,
      limit: clientLimit,
      remaining: Math.floor(left),
      retryAfterSeconds: 0,
      resetAtMs: at + waitUntilFull(left, clientRule),
    };
  }

  return {
    take: (key, cost = 1, at = clock()) => decide(key, cost, at, true),
    peek: (key, cost = 1, at = clock()) => decide(key, cost, at, false),
    reset(key) {
      if (key === undefined) {
        clients.clear();
        if (globalBucket) {
          globalBucket.tokens = capacityOf(globalBucket.rule);
          globalBucket.updatedAt = Number.NEGATIVE_INFINITY;
        }
        return;
      }
      clients.delete(key);
    },
    sweep,
    size: () => clients.size,
  };
}

// ---------------------------------------------------------------------------
// Client keys
// ---------------------------------------------------------------------------

/**
 * The bucket a client address falls into.
 *
 * IPv6 is keyed by its `/64` rather than its full address, because a single subscriber
 * is routinely handed a whole `/64` (often a `/56`) and could otherwise walk through
 * thousands of source addresses without ever meeting the limit. IPv4 is keyed exactly.
 */
export function clientBucketKey(address: IpAddress): string {
  // `::ffff:1.2.3.4` is the IPv4 client 1.2.3.4, and must land in its bucket rather
  // than in a shared `0:0:0:0::/64` one with every other mapped address.
  const unwrapped = unwrapIpv4Mapped(address) ?? address;
  if (unwrapped.version === 4) return formatIp(unwrapped);
  const prefix = unwrapped.groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(':');
  return `${prefix}::/64`;
}

/**
 * Turn the proxy headers into a rate-limit key.
 *
 * `X-Forwarded-For` is a client-controlled list, and only the entry the *trusted* proxy
 * appended can be believed. On Vercel that is the leftmost entry of the header the
 * platform itself sets, which is why the platform-specific `x-real-ip` (or
 * `x-vercel-forwarded-for`) is preferred when present and the forwarded chain is only
 * a fallback. Anything unparseable becomes {@link UNKNOWN_CLIENT_KEY}, which is a
 * shared bucket -- deliberately: an unidentifiable caller gets the strictest treatment,
 * not an exemption.
 */
export function clientKeyFrom(
  forwardedFor: string | null | undefined,
  realIp?: string | null,
): string {
  for (const candidate of [realIp, forwardedFor?.split(',')[0]]) {
    const text = candidate?.trim();
    if (!text) continue;
    // A forwarded entry can carry a port (`1.2.3.4:5678`, `[2001:db8::1]:443`).
    let bare = text;
    if (bare.startsWith('[')) {
      const close = bare.indexOf(']');
      bare = close === -1 ? bare.slice(1) : bare.slice(1, close);
    } else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(bare)) {
      bare = bare.slice(0, bare.lastIndexOf(':'));
    }
    const parsed = parseIp(bare);
    if (parsed.ok) return clientBucketKey(parsed.value);
  }
  return UNKNOWN_CLIENT_KEY;
}
