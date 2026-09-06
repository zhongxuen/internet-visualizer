/**
 * `outbound.ts` -- the only place in the product that makes a request to somewhere the
 * user had a say in.
 *
 * One function, so there is one thing to audit. Every live call -- DoH, RDAP bootstrap,
 * RDAP registry, reachability -- goes through {@link guardedFetch}, which does the
 * phase-doc pipeline in order and cannot be persuaded to skip a step:
 *
 *   1. `guardTarget` -- validate, block-list, resolve, re-check every resolved address
 *   2. optionally check the origin against a fixed allow-list (the DoH resolver)
 *   3. `guardedRequestInit` -- GET/HEAD only, no credentials, no cookies, no referrer,
 *      `redirect: 'manual'`, and an `AbortSignal` that fires at the policy timeout
 *   4. a redirect is never followed as a redirect: the `Location` goes back through
 *      step 1 as a brand new target, or is reported and not followed at all
 *   5. the body is capped while it is read, not after
 *
 * A caller cannot pass its own `RequestInit`. It picks a method, a header set that is
 * then filtered down to the forwardable three, and a policy that can only narrow.
 */

import {
  checkContentLength,
  deny,
  guardRedirect,
  guardTarget,
  guardedRequestInit,
  GuardTimeoutError,
  readCappedText,
  type GuardDenial,
  type GuardPolicy,
  type GuardedTarget,
} from '@/core/net/guard';
import type { RateLimitDecision } from '@/core/net/ratelimit';

import type { DiagnosticsDeps } from './deps';
import { limitHeaders, respondDenied, respondError } from './respond';

/** What a caller may ask for. Everything else about the request is fixed. */
export interface OutboundOptions {
  /** Read-only by construction: `guardedRequestInit` refuses anything else. */
  readonly method?: 'GET' | 'HEAD';
  /** Filtered down to `FORWARDABLE_HEADERS`; anything else is dropped, not forwarded. */
  readonly headers?: Readonly<Record<string, string>>;
  /** May only narrow the hard-coded ceilings in `guard.ts`. */
  readonly policy?: Partial<GuardPolicy>;
  /**
   * Origins this particular call may reach, when the destination is not the user's to
   * choose -- the single allow-listed DoH resolver, or the IANA bootstrap registry.
   * Omitted for reachability, where the target *is* the user's and the guard is the
   * only thing standing between it and a socket.
   */
  readonly allowedOrigins?: readonly string[];
  /** `false` for HEAD, where there is no body to read and none is wanted. */
  readonly readBody?: boolean;
}

/** A completed outbound call, with the timings and the chain that produced it. */
export interface OutboundResult {
  /** The target that was finally requested, with the addresses that cleared it. */
  readonly target: GuardedTarget;
  readonly response: Response;
  /** Present when `readBody` was true; already capped. */
  readonly body?: string;
  /** Every URL after the first, each one re-validated from scratch. */
  readonly redirects: readonly string[];
  /** Milliseconds from just before the request to the response headers. */
  readonly ttfbMs: number;
  /** Milliseconds including the capped body read. */
  readonly elapsedMs: number;
}

/** Why an outbound call did not produce a response. */
export type OutboundFailure =
  /** A guard refused: bad input, blocked address, rebinding, oversized body. */
  | { readonly kind: 'denied'; readonly denial: GuardDenial }
  /** The socket failed. Distinct from `denied`: nothing was wrong with the target. */
  | { readonly kind: 'unreachable'; readonly message: string }
  /** Nothing answered inside the policy budget. */
  | { readonly kind: 'timeout'; readonly message: string };

/** A completed call. Named, so that narrowing it away leaves exactly `OutboundFailure`. */
export interface OutboundSuccess {
  readonly kind: 'ok';
  readonly value: OutboundResult;
}

/** Either a response or a named failure. */
export type OutboundOutcome = OutboundSuccess | OutboundFailure;

/** Narrowing helper, so handlers read as `if (!isOutboundOk(outcome)) return ...`. */
export function isOutboundOk(outcome: OutboundOutcome): outcome is OutboundSuccess {
  return outcome.kind === 'ok';
}

/** Turn a failure into the shared error envelope, with the right status. */
export function respondOutboundFailure(
  failure: OutboundFailure,
  decision?: RateLimitDecision,
): Response {
  if (failure.kind === 'denied') return respondDenied(failure.denial, decision);
  if (failure.kind === 'timeout') {
    return respondError('timeout', failure.message, 504, {}, limitHeaders(decision));
  }
  return respondError(
    'upstream-failed',
    failure.message,
    502,
    {},
    limitHeaders(decision),
  );
}

/** `https://host:port`, for comparing against an allow-list of origins. */
function originOf(url: string): string {
  return new URL(url).origin;
}

/** An abort raised by our own timeout, rather than a transport error. */
function isTimeout(error: unknown): boolean {
  if (error instanceof GuardTimeoutError) return true;
  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') return true;
    if ((error as { cause?: unknown }).cause instanceof GuardTimeoutError) return true;
  }
  return false;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    const detail = cause instanceof Error ? `: ${cause.message}` : '';
    return `${error.message}${detail}`;
  }
  return String(error);
}

/**
 * Throw away a body this module did not ask for.
 *
 * Deliberately not awaited by its callers. Cancelling releases the connection back to
 * the pool, which is worth doing -- but a body that never settles must not be able to
 * hold a request open past its own timeout, and `cancel()` on a stream nobody is
 * draining is exactly the shape that can hang.
 */
function discardBody(response: Response): void {
  void response.body?.cancel().catch(() => {});
}

/**
 * A 3xx that names somewhere else to go. A 304 or a 300 without `Location` is just a
 * response, and is handed back as one.
 */
function redirectLocation(response: Response): string | undefined {
  if (response.status < 300 || response.status >= 400) return undefined;
  return response.headers.get('location') ?? undefined;
}

/**
 * Make one guarded request, following at most `policy.maxRedirects` redirects and
 * re-running the entire guard pipeline on each one.
 *
 * The default policy sets `maxRedirects: 0`, so unless a caller deliberately widens it
 * the 3xx is returned to the caller to *report*, not to follow.
 */
export async function guardedFetch(
  url: string,
  deps: DiagnosticsDeps,
  options: OutboundOptions = {},
): Promise<OutboundOutcome> {
  const method = options.method ?? 'HEAD';
  const started = deps.now();

  let target: GuardedTarget;
  const first = await guardTarget(url, { resolve: deps.resolve, policy: options.policy });
  if (!first.allowed) return { kind: 'denied', denial: first };
  target = first.value;

  const redirects: string[] = [];

  for (let hop = 0; ; hop += 1) {
    if (options.allowedOrigins) {
      const origin = originOf(target.url);
      if (!options.allowedOrigins.includes(origin)) {
        return {
          kind: 'denied',
          denial: deny(
            'blocked-hostname',
            `${origin} is not one of the endpoints this lookup is allowed to use (${options.allowedOrigins.join(', ')})`,
          ),
        };
      }
    }

    const init = guardedRequestInit(target, method, options.headers);
    if (!init.allowed) return { kind: 'denied', denial: init };
    const { cancel, ...requestInit } = init.value;

    let response: Response;
    const beforeFetch = deps.now();
    try {
      response = await deps.fetch(target.url, requestInit);
    } catch (error) {
      cancel();
      if (isTimeout(error)) {
        return {
          kind: 'timeout',
          message: `${target.hostname} did not answer within ${target.policy.timeoutMs}ms`,
        };
      }
      return {
        kind: 'unreachable',
        message: `${target.hostname} could not be reached: ${messageOf(error)}`,
      };
    }
    const ttfbMs = deps.now() - beforeFetch;

    const location = redirectLocation(response);
    if (location !== undefined && hop < target.policy.maxRedirects) {
      // Not "follow the redirect" -- discard this response and start over with the new
      // URL as a brand new, fully re-validated target. A redirect to a name that
      // resolves privately is the same attack as a first request to one.
      discardBody(response);
      cancel();
      const next = await guardRedirect(
        location,
        target,
        {
          resolve: deps.resolve,
          policy: options.policy,
        },
        hop + 1,
      );
      if (!next.allowed) return { kind: 'denied', denial: next };
      redirects.push(next.value.url);
      target = next.value;
      continue;
    }

    if (location !== undefined && target.policy.maxRedirects > 0) {
      // The caller opted into following redirects and the chain outran the budget.
      // Reported as its own reason rather than handed back as a bare 3xx, because
      // "the registry kept redirecting" is a different thing to explain than "the
      // registry answered 302 and we do not follow those".
      discardBody(response);
      cancel();
      return {
        kind: 'denied',
        denial: deny(
          'too-many-redirects',
          `${target.hostname} redirected more than the ${target.policy.maxRedirects} times this lookup follows`,
        ),
      };
    }

    try {
      if (!options.readBody) {
        // Nothing here wants a body it did not ask for, and an unread body holds the
        // connection open until the pool times it out.
        discardBody(response);
        return {
          kind: 'ok',
          value: {
            target,
            response,
            redirects,
            ttfbMs,
            elapsedMs: deps.now() - started,
          },
        };
      }

      const declared = checkContentLength(
        response.headers.get('content-length'),
        target.policy.maxResponseBytes,
      );
      if (!declared.allowed) {
        discardBody(response);
        return { kind: 'denied', denial: declared };
      }

      const text = await readCappedText(response.body, target.policy.maxResponseBytes);
      if (!text.allowed) return { kind: 'denied', denial: text };

      return {
        kind: 'ok',
        value: {
          target,
          response,
          body: text.value,
          redirects,
          ttfbMs,
          elapsedMs: deps.now() - started,
        },
      };
    } catch (error) {
      if (isTimeout(error)) {
        return {
          kind: 'timeout',
          message: `${target.hostname} stopped sending before the response was complete`,
        };
      }
      return {
        kind: 'unreachable',
        message: `reading the response from ${target.hostname} failed: ${messageOf(error)}`,
      };
    } finally {
      cancel();
    }
  }
}
