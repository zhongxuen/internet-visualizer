/**
 * The browser half of Live mode: one `fetch`, to this app's own origin, per press of Run.
 *
 * This is the only file in the module that performs I/O, and it is deliberately small
 * enough to read in one sitting. Three properties matter more than anything it does:
 *
 * 1. **It calls this origin and nothing else.** The URL comes from
 *    {@link LivePlan.fromBrowser}, which `diagnosticsRouteUrl` built as a path on this
 *    app. A user's target is a query parameter here; it never becomes a host the browser
 *    connects to. The request that leaves for the internet is made by the route handler,
 *    under the SSRF guard, and there is no code path in the browser that skips it.
 *
 * 2. **It never retries.** The phase doc requires failures to be "shown plainly --
 *    blocked target, rate limited, timeout -- never silently retried", and a retry loop
 *    around a network probe is also how a diagnostics tool quietly turns into a scanner.
 *    One press, one request. A second attempt is a second deliberate press.
 *
 * 3. **Every ending is a value, not an exception.** A refusal, a 429, a dead connection
 *    and an abort all come back as {@link LiveFailure} so the UI renders them the same
 *    way, with the reason visible rather than swallowed.
 */

import type {
  DiagnosticsError,
  DiagnosticsErrorCode,
  DiagnosticsSuccess,
  LiveOperationId,
} from '@/core/net/diagnostics';
import type { GuardDenialReason } from '@/core/net/guard';

import type { LivePlan } from './operations';

/** What the `X-RateLimit-*` headers said, when the response carried them. */
export interface LiveQuota {
  readonly limit: number;
  readonly remaining: number;
  /** Epoch seconds at which the bucket is full again. */
  readonly resetAt: number;
}

/**
 * Why a live run ended without an answer.
 *
 * `code` is the server's own {@link DiagnosticsErrorCode} when the server answered at
 * all, plus two codes only the browser can produce: `network`, when the request never
 * completed, and `aborted`, when the user navigated away or switched operation.
 */
export interface LiveFailure {
  readonly code: DiagnosticsErrorCode | 'network' | 'aborted';
  /** Written to be shown as-is. Server messages are already phrased for a reader. */
  readonly message: string;
  /** The HTTP status, when there was a response. */
  readonly httpStatus?: number;
  /** The guard's own reason, when a guard refused the target. */
  readonly reason?: GuardDenialReason;
  /** Seconds to wait, from the 429 body. Never acted on automatically. */
  readonly retryAfterSeconds?: number;
  readonly address?: string;
  readonly metadataEndpoint?: string;
  readonly quota?: LiveQuota;
  readonly requestedAt: string;
}

/** A finished live run, either way. */
export type LiveOutcome<K extends LiveOperationId> =
  | {
      readonly status: 'ok';
      readonly data: DiagnosticsSuccess<K>;
      readonly quota?: LiveQuota;
    }
  | { readonly status: 'failed'; readonly failure: LiveFailure };

/** Read the rate-limit trio, or nothing if the response did not carry it. */
function quotaOf(response: Response): LiveQuota | undefined {
  const limit = Number(response.headers.get('X-RateLimit-Limit'));
  const remaining = Number(response.headers.get('X-RateLimit-Remaining'));
  const resetAt = Number(response.headers.get('X-RateLimit-Reset'));
  if (!Number.isFinite(limit) || !Number.isFinite(remaining)) return undefined;
  return { limit, remaining, resetAt: Number.isFinite(resetAt) ? resetAt : 0 };
}

/** A body that at least looks like this app's failure envelope. */
function isErrorBody(body: unknown): body is DiagnosticsError {
  if (typeof body !== 'object' || body === null) return false;
  const candidate = body as { ok?: unknown; error?: { code?: unknown } };
  return candidate.ok === false && typeof candidate.error?.code === 'string';
}

/**
 * Run exactly the plan that was shown to the user.
 *
 * The plan is the parameter rather than an operation and a target, so that the URL in
 * `LiveDisclosure` and the URL that is fetched are the same string and cannot be made to
 * differ by a re-render between the disclosure and the press.
 */
export async function runLiveRequest<K extends LiveOperationId>(
  plan: LivePlan,
  options: { readonly signal?: AbortSignal; readonly fetchImpl?: typeof fetch } = {},
): Promise<LiveOutcome<K>> {
  const requestedAt = new Date().toISOString();
  const doFetch = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(plan.fromBrowser.url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      // A measurement must not be served from a cache: the timestamp beside it would
      // then describe a request that did not happen.
      cache: 'no-store',
      credentials: 'omit',
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    const aborted =
      options.signal?.aborted === true ||
      (error instanceof DOMException && error.name === 'AbortError');
    return {
      status: 'failed',
      failure: {
        code: aborted ? 'aborted' : 'network',
        message: aborted
          ? 'The run was cancelled before it finished. Nothing was retried.'
          : 'The request to this app’s own server did not complete, so no live lookup was made. Check your connection and press Run again.',
        requestedAt,
      },
    };
  }

  const quota = quotaOf(response);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      status: 'failed',
      failure: {
        code: 'upstream-failed',
        message: `The server answered ${response.status} with a body this page could not read.`,
        httpStatus: response.status,
        ...(quota ? { quota } : {}),
        requestedAt,
      },
    };
  }

  if (response.ok && (body as { ok?: unknown }).ok === true) {
    return {
      status: 'ok',
      data: body as DiagnosticsSuccess<K>,
      ...(quota ? { quota } : {}),
    };
  }

  if (isErrorBody(body)) {
    const { error, requestedAt: serverAt } = body;
    return {
      status: 'failed',
      failure: {
        code: error.code,
        message: error.message,
        httpStatus: response.status,
        ...(error.reason ? { reason: error.reason } : {}),
        ...(error.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: error.retryAfterSeconds }),
        ...(error.address ? { address: error.address } : {}),
        ...(error.metadataEndpoint ? { metadataEndpoint: error.metadataEndpoint } : {}),
        ...(quota ? { quota } : {}),
        requestedAt: serverAt || requestedAt,
      },
    };
  }

  // A shape this app never produces -- a proxy error page, most likely. Say the status
  // rather than inventing a reason for it.
  return {
    status: 'failed',
    failure: {
      code: 'upstream-failed',
      message:
        `The server answered ${response.status} ${response.statusText || ''}`.trim(),
      httpStatus: response.status,
      ...(quota ? { quota } : {}),
      requestedAt,
    },
  };
}
