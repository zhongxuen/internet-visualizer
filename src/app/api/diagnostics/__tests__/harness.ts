/**
 * Shared fixtures for the diagnostics route tests.
 *
 * The point of building the handlers as factories over {@link DiagnosticsDeps} is that
 * these tests never open a socket, never resolve a name, and never sleep. Everything
 * the outside world would supply is here instead: a resolver that answers from a table,
 * a `fetch` that answers from a table and records every call it was given, a limiter
 * with a bucket small enough to empty in two requests, and a clock that ticks a
 * predictable millisecond per read.
 *
 * `calls` is the important one. Most of the assertions in these files are not about the
 * response body at all -- they are about the request that was *not* made.
 */

import { createRateLimiter, type RateLimiter } from '@/core/net/ratelimit';

import type { DiagnosticsDeps } from '../_lib/deps';

/** One outbound attempt, exactly as `guardedFetch` handed it to `fetch`. */
export interface FetchCall {
  readonly url: string;
  readonly init: RequestInit;
}

/** A public address every fixture hostname resolves to unless a test says otherwise. */
export const PUBLIC_V4 = '93.184.216.34';

/** What a `fetch` stub is asked: the URL, and the call so far. */
export type Responder = (url: string, call: FetchCall) => Response | Promise<Response>;

/**
 * A `fetch` that answers from `routes` and records everything.
 *
 * An unmatched URL is a thrown error rather than a 404, because in these tests reaching
 * an unexpected URL is the failure being looked for, and a 404 would let it pass
 * quietly as "upstream said no".
 */
export function fakeFetch(routes: Record<string, Responder | Response>): {
  fetch: typeof globalThis.fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  /**
   * A `Response` body can only be read once, and `clone()` is not the way out: a teed
   * body whose other branch is never drained makes `cancel()` hang forever, which is a
   * property of the test double and not of the code under test. So a plain `Response`
   * fixture is drained once and rebuilt from those bytes on every call -- which is also
   * what a real `fetch` does.
   */
  const snapshots = new Map<string, { init: ResponseInit; bytes: ArrayBuffer }>();

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const call: FetchCall = { url, init: init ?? {} };
    calls.push(call);

    for (const [pattern, responder] of Object.entries(routes)) {
      if (!url.startsWith(pattern)) continue;
      if (typeof responder === 'function') return responder(url, call);

      let snapshot = snapshots.get(pattern);
      if (!snapshot) {
        snapshot = {
          init: {
            status: responder.status,
            statusText: responder.statusText,
            headers: Object.fromEntries(responder.headers.entries()),
          },
          bytes: await responder.arrayBuffer(),
        };
        snapshots.set(pattern, snapshot);
      }
      return new Response(
        snapshot.bytes.byteLength === 0 ? null : snapshot.bytes.slice(0),
        snapshot.init,
      );
    }
    throw new Error(`the test fetch was asked for an unexpected URL: ${url}`);
  }) as typeof globalThis.fetch;

  return { fetch: fetchImpl, calls };
}

/** A `fetch` that must never be called. Any call fails the test loudly. */
export function noFetch(): { fetch: typeof globalThis.fetch; calls: FetchCall[] } {
  return fakeFetch({});
}

/** JSON with the headers a real endpoint would send. */
export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const text = JSON.stringify(body);
  return new Response(text, {
    status: 200,
    ...init,
    headers: {
      'content-type': 'application/json',
      'content-length': String(new TextEncoder().encode(text).byteLength),
      ...(init.headers ?? {}),
    },
  });
}

/**
 * A resolver backed by a table.
 *
 * Anything not in the table resolves to {@link PUBLIC_V4}, so a test only has to name
 * the hostnames whose answers are the point -- which, for this module, means the ones
 * that resolve somewhere they should not.
 */
export function tableResolver(table: Record<string, readonly string[]> = {}) {
  const seen: string[] = [];
  const resolve = async (hostname: string): Promise<readonly string[]> => {
    seen.push(hostname);
    const answer = table[hostname];
    if (answer) return answer;
    return [PUBLIC_V4];
  };
  return { resolve, seen };
}

/** Options a test may vary; everything else gets a safe, deterministic default. */
export interface HarnessOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly resolve?: DiagnosticsDeps['resolve'];
  readonly limiter?: RateLimiter;
  /** Client bucket size. Two is enough to test "the second one is refused". */
  readonly limit?: number;
}

/**
 * Deps for one test.
 *
 * The clock is a counter rather than `performance.now()`: the timings in a response
 * body are then exact integers a test can assert on, instead of whatever the machine
 * happened to be doing.
 */
export function makeDeps(options: HarnessOptions = {}): DiagnosticsDeps {
  let tick = 0;
  const limit = options.limit ?? 50;
  return {
    limiter:
      options.limiter ??
      createRateLimiter({
        client: { limit, windowMs: 60_000, burst: limit },
        global: null,
      }),
    resolve: options.resolve ?? tableResolver().resolve,
    fetch: options.fetch ?? noFetch().fetch,
    now: () => (tick += 1),
  };
}

/** A `GET` to a handler, with the headers a Vercel edge would have added. */
export function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://visualizer.test${path}`, {
    method: 'GET',
    headers: { 'x-forwarded-for': '203.0.113.7', ...headers },
  });
}

/**
 * The parsed JSON body of a handler response.
 *
 * Loosely typed on purpose: these tests assert on the wire shape, and spelling out an
 * interface per response would just restate the payload types the handlers already
 * export -- which would make a test pass because it agreed with itself.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function bodyOf(response: Response): Promise<any> {
  return response.json();
}
