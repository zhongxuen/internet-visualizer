/**
 * `respond.ts` -- the one shape every diagnostics response has, and the one place a
 * guard denial becomes an HTTP status.
 *
 * Three routes, one envelope. The UI (prompt 12.4) has to show failures "plainly --
 * blocked target, rate limited, timeout -- never silently retried", and it can only do
 * that if every failure arrives looking the same and carrying a code it can switch on.
 * So: a discriminated `ok` field, a closed `code` union, and the guard's own
 * `GuardDenialReason` passed straight through when a guard is what refused.
 *
 * The status mapping is deliberately boring and lives here rather than in three route
 * files, because "why did this return 403 in one route and 400 in another" is the kind
 * of drift that makes a security surface hard to reason about.
 */

import type {
  DiagnosticsError,
  DiagnosticsErrorCode,
  DiagnosticsMeta,
} from '@/core/net/diagnostics';
import type { GuardDenial, GuardDenialReason } from '@/core/net/guard';
import { rateLimitHeaders, type RateLimitDecision } from '@/core/net/ratelimit';

/**
 * The envelope itself lives in `@/core/net/diagnostics`, because Live mode's UI has to
 * read the same shape these functions write. Re-exported here so a route handler and its
 * tests keep importing the response contract from the file that builds it.
 */
export type {
  DiagnosticsError,
  DiagnosticsErrorCode,
  DiagnosticsMeta,
  DiagnosticsSource,
} from '@/core/net/diagnostics';

/**
 * The guard reason -> status table.
 *
 * 400 means "you typed something that is not a target"; 403 means "that is a target,
 * and this server will not go there". Keeping those apart matters: the first is a typo
 * and the second is the security boundary doing its job, and the UI says different
 * things about them.
 */
const STATUS_BY_REASON: Readonly<Record<GuardDenialReason, number>> = {
  'malformed-input': 400,
  'malformed-host': 400,
  'ambiguous-host': 400,
  'credentials-in-url': 400,
  'blocked-scheme': 403,
  'blocked-port': 403,
  'blocked-hostname': 403,
  'blocked-address': 403,
  'blocked-resolved-address': 403,
  'no-addresses': 404,
  'resolution-failed': 502,
  'too-many-redirects': 502,
  'response-too-large': 502,
  timeout: 504,
};

const CODE_BY_REASON: Readonly<Record<GuardDenialReason, DiagnosticsErrorCode>> = {
  'malformed-input': 'invalid-target',
  'malformed-host': 'invalid-target',
  'ambiguous-host': 'invalid-target',
  'credentials-in-url': 'invalid-target',
  'blocked-scheme': 'blocked-target',
  'blocked-port': 'blocked-target',
  'blocked-hostname': 'blocked-target',
  'blocked-address': 'blocked-target',
  'blocked-resolved-address': 'blocked-target',
  'no-addresses': 'not-found',
  'resolution-failed': 'upstream-failed',
  'too-many-redirects': 'upstream-failed',
  'response-too-large': 'upstream-failed',
  timeout: 'timeout',
};

/** The HTTP status a guard denial deserves. */
export function statusForDenial(denial: GuardDenial): number {
  return STATUS_BY_REASON[denial.reason];
}

/** The UI-facing code a guard denial maps to. */
export function codeForDenial(denial: GuardDenial): DiagnosticsErrorCode {
  return CODE_BY_REASON[denial.reason];
}

/**
 * Headers every diagnostics response carries.
 *
 * `no-store` because a live answer is a measurement, not a document: a cached
 * reachability result shown next to a fresh timestamp would be a lie about when the
 * request happened.
 */
function baseHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };
}

/**
 * The `X-RateLimit-*` trio for a decision, or nothing when there is no decision yet.
 *
 * Every response carries them, not just the 429: the UI shows the remaining quota
 * before the user runs out, which is the difference between a limit that teaches and
 * one that ambushes.
 */
export function limitHeaders(decision?: RateLimitDecision): Record<string, string> {
  return decision ? rateLimitHeaders(decision) : {};
}

/** Serialise a body with the shared headers, plus whatever the caller adds. */
function json(body: unknown, status: number, extra: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...baseHeaders(), ...extra },
  });
}

/** A 200 carrying `payload` merged with the standard metadata. */
export function respondOk<T extends object>(
  payload: T,
  meta: Omit<DiagnosticsMeta, 'ok'>,
  decision?: RateLimitDecision,
): Response {
  return json({ ok: true, ...meta, ...payload }, 200, limitHeaders(decision));
}

/** A failure, with the code and status chosen by the caller. */
export function respondError(
  code: DiagnosticsErrorCode,
  message: string,
  status: number,
  extra: Omit<DiagnosticsError['error'], 'code' | 'message'> = {},
  headers: Record<string, string> = {},
): Response {
  const body: DiagnosticsError = {
    ok: false,
    error: { code, message, ...extra },
    requestedAt: new Date().toISOString(),
  };
  return json(body, status, headers);
}

/** A guard denial, rendered with its mapped status, code, and context intact. */
export function respondDenied(
  denial: GuardDenial,
  decision?: RateLimitDecision,
): Response {
  return respondError(
    codeForDenial(denial),
    denial.detail,
    statusForDenial(denial),
    {
      reason: denial.reason,
      ...(denial.address === undefined ? {} : { address: denial.address }),
      ...(denial.scope === undefined ? {} : { scope: denial.scope }),
      ...(denial.metadataEndpoint === undefined
        ? {}
        : { metadataEndpoint: denial.metadataEndpoint }),
    },
    limitHeaders(decision),
  );
}

/**
 * The 429 the acceptance criteria name, with `Retry-After` and the `X-RateLimit-*`
 * trio so `RateLimitNotice` can count down instead of guessing.
 */
export function respondRateLimited(decision: RateLimitDecision): Response {
  const who =
    decision.limitedBy === 'global'
      ? 'This deployment is at its shared limit for live lookups'
      : 'You have used your share of live lookups';
  return respondError(
    'rate-limited',
    `${who}. Live diagnostics are rate limited so this module can never be used to scan. Try again in ${decision.retryAfterSeconds}s.`,
    429,
    { retryAfterSeconds: decision.retryAfterSeconds },
    rateLimitHeaders(decision),
  );
}
