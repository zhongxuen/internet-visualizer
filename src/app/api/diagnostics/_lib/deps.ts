/**
 * `deps.ts` -- the three things a diagnostics route needs from the outside world, and
 * the real implementations of them.
 *
 * `src/core/net` decides and does not act, which is what makes the guard and the
 * limiter testable with no network and no sleeping. This file is where that stops
 * being true: it holds the actual DNS resolver, the actual `fetch`, and the actual
 * clock. Every handler in `_lib` takes a {@link DiagnosticsDeps} so a test can hand it
 * a resolver that answers `10.0.0.1` and a `fetch` that never touches a socket, and so
 * the `route.ts` files stay one line each.
 *
 * The limiter is a module-level singleton on purpose: the quota is shared across all
 * three routes, because a caller walking a list of hosts does not care which endpoint
 * it walks them through. State is per serverless instance, which is the conservative
 * direction -- more instances mean a *lower* effective limit per instance, never a
 * higher one for a client.
 */

import { promises as dns } from 'node:dns';

import type { HostResolver } from '@/core/net/guard';
import { clientKeyFrom, createRateLimiter, type RateLimiter } from '@/core/net/ratelimit';

/** Everything a handler is allowed to reach the world through. */
export interface DiagnosticsDeps {
  /** Shared across the three routes; see the note above. */
  readonly limiter: RateLimiter;
  /** Hands the guard every address a name could connect to. */
  readonly resolve: HostResolver;
  /** Injected so tests never open a socket. */
  readonly fetch: typeof globalThis.fetch;
  /** Monotonic-ish milliseconds, for the timings reported back to the user. */
  readonly now: () => number;
}

/**
 * The process-wide limiter.
 *
 * Deliberately not exported: a route must not be able to swap it, and a test gets its
 * own through {@link DiagnosticsDeps} rather than by reaching in here.
 */
const limiter = createRateLimiter();

/**
 * Resolve a name to every address it could connect to, A and AAAA both.
 *
 * `resolve4`/`resolve6` rather than `lookup`: `lookup` goes through the OS resolver,
 * which consults `/etc/hosts` first, so a host entry would be an SSRF vector that never
 * touches DNS at all. These two ask DNS and nothing else.
 *
 * A family that fails is not fatal -- a v4-only name has no AAAA and vice versa -- but
 * a name where *both* families fail is a resolution failure, and the error is
 * propagated so the guard can report it rather than silently returning nothing.
 */
export const resolveHost: HostResolver = async (hostname) => {
  const [v4, v6] = await Promise.allSettled([
    dns.resolve4(hostname),
    dns.resolve6(hostname),
  ]);

  const addresses: string[] = [];
  if (v4.status === 'fulfilled') addresses.push(...v4.value);
  if (v6.status === 'fulfilled') addresses.push(...v6.value);

  if (addresses.length === 0 && v4.status === 'rejected' && v6.status === 'rejected') {
    throw v4.reason instanceof Error ? v4.reason : new Error(String(v4.reason));
  }
  return addresses;
};

/** The deps the deployed routes run with. */
export const defaultDeps: DiagnosticsDeps = {
  limiter,
  resolve: resolveHost,
  // Bound: an unbound `globalThis.fetch` throws "Illegal invocation" in some runtimes.
  fetch: (...args) => globalThis.fetch(...args),
  now: () => performance.now(),
};

/**
 * The rate-limit bucket a request falls into.
 *
 * `x-real-ip` is preferred over the forwarded chain because only the entry a *trusted*
 * proxy appended can be believed, and on Vercel that is the platform-set header.
 * `clientKeyFrom` falls back to a single shared bucket when neither is parseable, so an
 * unidentifiable caller gets the strictest treatment rather than an exemption.
 */
export function clientKeyOf(request: Request): string {
  return clientKeyFrom(
    request.headers.get('x-forwarded-for'),
    request.headers.get('x-real-ip') ?? request.headers.get('x-vercel-forwarded-for'),
  );
}
