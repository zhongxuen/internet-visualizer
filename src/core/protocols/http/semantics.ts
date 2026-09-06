/**
 * Semantics -- what a method promises and what a status code means.
 *
 * The three words in RFC 9110 s9.2 that matter most are **safe**, **idempotent**, and
 * **cacheable**, and almost every wrong intuition about HTTP is a confusion between
 * them:
 *
 * - **Safe** (s9.2.1) means the request is read-only: the client is not *asking* for
 *   anything to change. It is a promise about intent, not a guarantee about the server --
 *   a GET may well write a log line or a hit counter. What safety buys is the licence to
 *   prefetch, retry, and crawl.
 * - **Idempotent** (s9.2.2) means sending the request *n* times has the same effect on
 *   the server as sending it once. That is what lets a client retry after a dropped
 *   connection without asking anyone. DELETE is idempotent even though the second call
 *   returns 404: the *effect* is the same, the status is not.
 * - **Cacheable** (s9.2.3) means a response may be stored and reused. It is a property of
 *   the request method *and* the response status *and* the response's own directives --
 *   never of the method alone, which is why `caching.ts` needs all three.
 *
 * Every safe method is idempotent; the converse is false, and PUT and DELETE are the
 * counterexamples. `semantics.test.ts` holds the table to that invariant so no future
 * edit can quietly break it.
 *
 * ## The RFCs
 *
 * Method and status semantics are **RFC 9110**. The obsolete RFC 723x series (and the
 * 2616 that preceded it) still turn up in tutorials and are the reason people believe
 * things about HTTP that stopped being true in 2014; nothing here cites them.
 */

import { type HttpMethod, type HttpResponse } from './message';

// ---------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------

/**
 * Whether a *response* to this method may be stored and reused.
 *
 * Three states, not a boolean, because POST is genuinely in the middle and flattening it
 * either way teaches something false.
 */
export type Cacheability =
  /** Reusable by default; a heuristic may be applied when nothing explicit is said. */
  | 'cacheable'
  /** Reusable **only** with explicit freshness information. POST, and only POST. */
  | 'explicit-freshness-only'
  /** Never reusable. */
  | 'not-cacheable';

/** Whether the request may carry content, per RFC 9110 s8.6 and the method's section. */
export type RequestContent =
  /** The method is meaningless without content. */
  | 'required'
  /** Content is part of what the method does. */
  | 'allowed'
  /** Legal to send, but it has no defined meaning and servers may reject it. */
  | 'no-defined-semantics'
  /** MUST NOT be sent. */
  | 'forbidden';

/** One row of the method table. */
export interface MethodSemantics {
  readonly method: HttpMethod;
  /** Read-only *intent*, RFC 9110 s9.2.1. */
  readonly safe: boolean;
  /** Repeating it changes nothing further, RFC 9110 s9.2.2. */
  readonly idempotent: boolean;
  readonly cacheability: Cacheability;
  readonly requestContent: RequestContent;
  /** Whether a successful response normally carries content. */
  readonly responseContent: boolean;
  /** One line, written for a tooltip. */
  readonly summary: string;
  /** Where it is defined -- always a current RFC. */
  readonly rfc: string;
}

/**
 * The method table, in RFC 9110 s9.3 order with PATCH after PUT.
 *
 * Read the safe column and the idempotent column together: every `true` in the first has
 * a `true` beside it, and the two rows where they differ (PUT, DELETE) are exactly the
 * methods a client may retry but a crawler may not follow.
 */
export const METHOD_SEMANTICS: readonly MethodSemantics[] = [
  {
    method: 'GET',
    safe: true,
    idempotent: true,
    cacheability: 'cacheable',
    requestContent: 'no-defined-semantics',
    responseContent: true,
    summary: 'Retrieve a representation of the target resource. The default of the web.',
    rfc: 'RFC 9110 s9.3.1',
  },
  {
    method: 'HEAD',
    safe: true,
    idempotent: true,
    cacheability: 'cacheable',
    requestContent: 'no-defined-semantics',
    responseContent: false,
    summary:
      'Identical to GET except the server must not send content -- the same headers, ' +
      'no body. Used to check size, type, or freshness without paying for the download.',
    rfc: 'RFC 9110 s9.3.2',
  },
  {
    method: 'POST',
    safe: false,
    idempotent: false,
    cacheability: 'explicit-freshness-only',
    requestContent: 'required',
    responseContent: true,
    summary:
      'Hand content to the resource for processing. The one method whose effect is ' +
      'defined by the server rather than by HTTP, which is why it is neither safe nor ' +
      'idempotent and why a double submit charges the card twice.',
    rfc: 'RFC 9110 s9.3.3',
  },
  {
    method: 'PUT',
    safe: false,
    idempotent: true,
    cacheability: 'not-cacheable',
    requestContent: 'required',
    responseContent: false,
    summary:
      'Replace the target resource with the enclosed representation. Idempotent because ' +
      'the state after the tenth identical PUT is the state after the first.',
    rfc: 'RFC 9110 s9.3.4',
  },
  {
    method: 'PATCH',
    safe: false,
    idempotent: false,
    cacheability: 'not-cacheable',
    requestContent: 'required',
    responseContent: true,
    summary:
      'Apply a partial modification. Not idempotent in general -- "add 1 to the counter" ' +
      'is a legal patch -- though a particular patch format may be.',
    rfc: 'RFC 5789',
  },
  {
    method: 'DELETE',
    safe: false,
    idempotent: true,
    cacheability: 'not-cacheable',
    requestContent: 'no-defined-semantics',
    responseContent: false,
    summary:
      'Remove the association between the target and its function. Idempotent even ' +
      'though the second call answers 404: the effect is the same, the status is not.',
    rfc: 'RFC 9110 s9.3.5',
  },
  {
    method: 'CONNECT',
    safe: false,
    idempotent: false,
    cacheability: 'not-cacheable',
    requestContent: 'forbidden',
    responseContent: false,
    summary:
      'Ask a proxy to open a tunnel to the target and stop interpreting what flows ' +
      'through it. How HTTPS gets through an explicit proxy.',
    rfc: 'RFC 9110 s9.3.6',
  },
  {
    method: 'OPTIONS',
    safe: true,
    idempotent: true,
    cacheability: 'not-cacheable',
    requestContent: 'no-defined-semantics',
    responseContent: false,
    summary:
      'Ask what the server supports for a target. The browser sends one unprompted as ' +
      'the CORS preflight.',
    rfc: 'RFC 9110 s9.3.7',
  },
  {
    method: 'TRACE',
    safe: true,
    idempotent: true,
    cacheability: 'not-cacheable',
    requestContent: 'forbidden',
    responseContent: true,
    summary:
      'Echo the received request back as the response content, revealing what proxies ' +
      'changed. Usually disabled, because that echo can include credentials.',
    rfc: 'RFC 9110 s9.3.8',
  },
];

const METHODS_BY_NAME = new Map<string, MethodSemantics>(
  METHOD_SEMANTICS.map((entry) => [entry.method, entry]),
);

/** The table row for a method. */
export function methodSemantics(method: HttpMethod): MethodSemantics {
  const found = METHODS_BY_NAME.get(method);
  // Unreachable while the table covers HttpMethod; the test asserts that it does.
  if (!found) throw new Error(`no semantics recorded for method ${method}`);
  return found;
}

/** Read-only intent: safe to prefetch, retry, and crawl (RFC 9110 s9.2.1). */
export function isSafe(method: HttpMethod): boolean {
  return methodSemantics(method).safe;
}

/** Repeating the request has no further effect (RFC 9110 s9.2.2). */
export function isIdempotent(method: HttpMethod): boolean {
  return methodSemantics(method).idempotent;
}

/**
 * Whether a response to this method may be reused **without** explicit freshness.
 *
 * True for GET and HEAD only. POST answers `false` here and is still not "uncacheable" --
 * see {@link Cacheability} and {@link methodSemantics}.
 */
export function isCacheableByDefault(method: HttpMethod): boolean {
  return methodSemantics(method).cacheability === 'cacheable';
}

/**
 * Whether a client may safely resend after a connection drops with no response.
 *
 * This is idempotency's practical payoff, and the reason a form post shows
 * "are you sure you want to resubmit?" while a page reload never does.
 */
export function isAutomaticallyRetriable(method: HttpMethod): boolean {
  return isIdempotent(method);
}

// ---------------------------------------------------------------------------
// Status codes
// ---------------------------------------------------------------------------

/** The five classes. The first digit is the only part a client must understand. */
export type StatusClass =
  'informational' | 'successful' | 'redirection' | 'client-error' | 'server-error';

/** Class labels and one line each, for the status-code map. */
export const STATUS_CLASSES: readonly {
  readonly key: StatusClass;
  readonly range: string;
  readonly label: string;
  readonly summary: string;
}[] = [
  {
    key: 'informational',
    range: '1xx',
    label: 'Informational',
    summary: 'Interim. The request is still in flight and a final response follows.',
  },
  {
    key: 'successful',
    range: '2xx',
    label: 'Successful',
    summary: 'The request was received, understood, and accepted.',
  },
  {
    key: 'redirection',
    range: '3xx',
    label: 'Redirection',
    summary: 'Further action is needed -- usually a second request somewhere else.',
  },
  {
    key: 'client-error',
    range: '4xx',
    label: 'Client error',
    summary: 'The request was wrong. Repeating it unchanged will fail again.',
  },
  {
    key: 'server-error',
    range: '5xx',
    label: 'Server error',
    summary: 'The request was plausible; the server failed to fulfil it.',
  },
];

/** One row of the status table. */
export interface StatusSemantics {
  readonly code: number;
  /** The registered reason-phrase. Advisory: never branch on it (RFC 9112 s4). */
  readonly reason: string;
  readonly class: StatusClass;
  readonly summary: string;
  /**
   * Whether a cache may reuse this response with **no** explicit freshness information,
   * by applying a heuristic. RFC 9110 s15.1 calls these "heuristically cacheable".
   *
   * The absences are the interesting part: 302 and 307 are not on the list, so a
   * redirect with no `Cache-Control` is re-fetched every time, while a **301** is
   * remembered -- occasionally forever, which is how a mistyped permanent redirect
   * becomes a support ticket that a browser restart does not fix.
   */
  readonly heuristicallyCacheable: boolean;
  readonly rfc: string;
}

/**
 * The status codes the scenarios can produce, plus the ones people ask about.
 *
 * Everything is cited to RFC 9110 except where a code lives in its own document.
 */
export const STATUS_SEMANTICS: readonly StatusSemantics[] = [
  {
    code: 100,
    reason: 'Continue',
    class: 'informational',
    summary:
      'Keep going -- the server is willing to accept the content the client announced ' +
      'with Expect: 100-continue. Lets a client avoid uploading a gigabyte to a 401.',
    heuristicallyCacheable: false,
    rfc: 'RFC 9110 s15.2.1',
  },
  {
    code: 101,
    reason: 'Switching Protocols',
    class: 'informational',
    summary:
      'The connection stops speaking HTTP and starts speaking something else. This is ' +
      'the WebSocket handshake succeeding.',
    heuristicallyCacheable: false,
    rfc: 'RFC 9110 s15.2.2',
  },
  {
    code: 103,
    reason: 'Early Hints',
    class: 'informational',
    summary:
      'Link headers sent before the real response so the browser can start fetching ' +
      'stylesheets while the server is still thinking.',
    heuristicallyCacheable: false,
    rfc: 'RFC 8297',
  },
  {
    code: 200,
    reason: 'OK',
    class: 'successful',
    summary: 'The request succeeded and the content is the requested representation.',
    heuristicallyCacheable: true,
    rfc: 'RFC 9110 s15.3.1',
  },
  {
    code: 201,
    reason: 'Created',
    class: 'successful',
    summary:
      'One or more resources now exist. The Location field says where the primary one is.',
    heuristicallyCacheable: false,
    rfc: 'RFC 9110 s15.3.2',
  },
  {
    code: 202,
    reason: 'Accepted',
    class: 'successful',
    summary: 'Queued, not done. The only 2xx that promises nothing about the outcome.',
    heuristicallyCacheable: false,
    rfc: 'RFC 9110 s15.3.3',
  },
  {
    code: 203,
    reason: 'Non-Authoritative Information',
    class: 'successful',
    summary:
      'A 200 that a proxy modified in transit. Rare, and the honest way to say so.',
    heuristicallyCacheable: true,
    rfc: 'RFC 9110 s15.3.4',
  },
  {
    code: 204,
    reason: 'No Content',
    class: 'successful',
    summary:
      'Done, and there is deliberately nothing to send back. Never has content, so the ' +
      'browser leaves the current page exactly where it is.',
    heuristicallyCacheable: true,
    rfc: 'RFC 9110 s15.3.5',
  },
  {
    code: 205,
    reason: 'Reset Content',
    class: 'successful',
    summary: 'Done -- and the client should clear the form that submitted it.',
    heuristicallyCacheable: false,
    rfc: 'RFC 9110 s15.3.6',
  },
  {
    code: 206,
    reason: 'Partial Content',
    class: 'successful',
    summary:
      'The requested byte ranges only. What makes resumable downloads and video ' +
      'seeking possible.',
    heuristicallyCacheable: true,
    rfc: 'RFC 9110 s15.3.7',
  },
  {
    code: 300,
    reason: 'Multiple Choices',
    class: 'redirection',
    summary: 'More than one representation; the client (or user) picks.',
    heuristicallyCacheable: true,
    rfc: 'RFC 9110 s15.4.1',
  },
  {
    code: 301,
    reason: 'Moved Permanently',
    class: 'redirection',
    summary:
      'The resource has a new permanent URI. Cached by default and often aggressively, ' +
      'so a 301 sent by mistake outlives the mistake.',
    heuristicallyCacheable: true,
    rfc: 'RFC 9110 s15.4.2',
  },
  {
    code: 302,
    reason: 'Found',
    class: 'redirection',
    summary:
      'Temporarily elsewhere. Not cacheable without explicit freshness, so the client ' +
      'keeps asking the original URI.',
    heuristicallyCacheable: false,
    rfc: 'RFC 9110 s15.4.3',
  },
  {
    code: 303,
    reason: 'See Other',
    class: 'redirection',
    summary:
      'Go and GET this other URI. The point of the code is the method change: it turns ' +
      'a POST into a GET, which is how POST/redirect/GET stops a refresh resubmitting.',
    heuristicallyCacheable: false,
    rfc: 'RFC 9110 s15.4.4',
  },
  {
    code: 304,
    reason: 'Not Modified',
    class: 'redirection',
    summary:
      'Your copy is still good. Headers only, never content -- the whole saving is that ' +
      'the body is not sent again.',
    heuristicallyCacheable: false,
    rfc: 'RFC 9110 s15.4.5',
  },
  {
    code: 307,
    reason: 'Temporary Redirect',
    class: 'redirection',
    summary:
      '302 with the loophole closed: the method and the content must be preserved. A ' +
      'redirected POST stays a POST.',
    heuristicallyCacheable: false,
    rfc: 'RFC 9110 s15.4.8',
  },
  {
    code: 308,
    reason: 'Permanent Redirect',
    class: 'redirection',
    summary: '301 with the method preserved.',
    heuristicallyCacheable: true,
    rfc: 'RFC 9110 s15.4.9',
  },
  {
    code: 400,
    reason: 'Bad Request',
    class: 'client-error',
    summary: 'The server could not parse it at all. The catch-all of the 4xx class.',
    heuristicallyCacheable: false,
    rfc: 'RFC 9110 s15.5.1',
  },
  {
    code: 401,
    reason: 'Unauthorized',
    class: 'client-error',
    summary:
      'Misnamed: it means *unauthenticated*. Comes with WWW-Authenticate saying how to ' +
      'try again with credentials.',
    heuristicallyCacheable: false,
    rfc: 'RFC 9110 s15.5.2',
  },
  {
    code: 403,
    reason: 'Forbidden',
    class: 'client-error',
    summary:
      'Understood and refused. Credentials will not help -- which is the difference ' +
      'from 401.',
    heuristicallyCacheable: false,
    rfc: 'RFC 9110 s15.5.4',
  },
  {
    code: 404,
    reason: 'Not Found',
    class: 'client-error',
    summary:
      'Nothing here. Heuristically cacheable, which surprises people: a 404 can be ' +
      'served from cache after the page is published.',
    heuristicallyCacheable: true,
    rfc: 'RFC 9110 s15.5.5',
  },
  {
    code: 405,
    reason: 'Method Not Allowed',
    class: 'client-error',
    summary:
      'Right resource, wrong verb. Must come with an Allow field listing the right ones.',
    heuristicallyCacheable: true,
    rfc: 'RFC 9110 s15.5.6',
  },
  {
    code: 406,
    reason: 'Not Acceptable',
    class: 'client-error',
    summary:
      'Content negotiation failed: nothing the server has matches what Accept asked for.',
    heuristicallyCacheable: false,
    rfc: 'RFC 9110 s15.5.7',
  },
  {
    code: 408,
    reason: 'Request Timeout',
    class: 'client-error',
    summary:
      'The client took too long to send it. Often just an idle connection closing.',
    heuristicallyCacheable: false,
    rfc: 'RFC 9110 s15.5.9',
  },
  {
    code: 409,
    reason: 'Conflict',
    class: 'client-error',
    summary: 'The request contradicts the current state of the resource.',
    heuristicallyCacheable: false,
    rfc: 'RFC 9110 s15.5.10',
  },
  {
    code: 410,
    reason: 'Gone',
    class: 'client-error',
    summary:
      'A 404 that promises the resource is not coming back, so crawlers may forget it.',
    heuristicallyCacheable: true,
    rfc: 'RFC 9110 s15.5.11',
  },
  {
    code: 412,
    reason: 'Precondition Failed',
    class: 'client-error',
    summary:
      'An If-Match or If-Unmodified-Since did not hold. This is optimistic locking ' +
      'working: someone else changed the resource first.',
    heuristicallyCacheable: false,
    rfc: 'RFC 9110 s15.5.13',
  },
  {
    code: 413,
    reason: 'Content Too Large',
    class: 'client-error',
    summary: 'The upload exceeds what the server will take.',
    heuristicallyCacheable: false,
    rfc: 'RFC 9110 s15.5.14',
  },
  {
    code: 414,
    reason: 'URI Too Long',
    class: 'client-error',
    summary: 'Usually a GET that should have been a POST.',
    heuristicallyCacheable: true,
    rfc: 'RFC 9110 s15.5.15',
  },
  {
    code: 415,
    reason: 'Unsupported Media Type',
    class: 'client-error',
    summary: 'The Content-Type of the request is not one the resource accepts.',
    heuristicallyCacheable: false,
    rfc: 'RFC 9110 s15.5.16',
  },
  {
    code: 416,
    reason: 'Range Not Satisfiable',
    class: 'client-error',
    summary: 'The byte range asked for lies outside the representation.',
    heuristicallyCacheable: false,
    rfc: 'RFC 9110 s15.5.17',
  },
  {
    code: 421,
    reason: 'Misdirected Request',
    class: 'client-error',
    summary:
      'This connection is not authoritative for that authority -- an h2 coalescing ' +
      'artefact, since one connection can carry several origins.',
    heuristicallyCacheable: false,
    rfc: 'RFC 9110 s15.5.20',
  },
  {
    code: 426,
    reason: 'Upgrade Required',
    class: 'client-error',
    summary: 'Speak a different protocol on this connection and try again.',
    heuristicallyCacheable: false,
    rfc: 'RFC 9110 s15.5.22',
  },
  {
    code: 428,
    reason: 'Precondition Required',
    class: 'client-error',
    summary:
      'The server refuses unconditional writes, to stop the lost-update problem before ' +
      'it happens.',
    heuristicallyCacheable: false,
    rfc: 'RFC 6585 s3',
  },
  {
    code: 429,
    reason: 'Too Many Requests',
    class: 'client-error',
    summary: 'Rate limited. Retry-After says how long to wait.',
    heuristicallyCacheable: false,
    rfc: 'RFC 6585 s4',
  },
  {
    code: 500,
    reason: 'Internal Server Error',
    class: 'server-error',
    summary: 'The server broke and has nothing more specific to say.',
    heuristicallyCacheable: false,
    rfc: 'RFC 9110 s15.6.1',
  },
  {
    code: 501,
    reason: 'Not Implemented',
    class: 'server-error',
    summary: 'The method is not supported here at all -- for any resource.',
    heuristicallyCacheable: true,
    rfc: 'RFC 9110 s15.6.2',
  },
  {
    code: 502,
    reason: 'Bad Gateway',
    class: 'server-error',
    summary:
      'A proxy got an invalid response from upstream. The error is behind the door.',
    heuristicallyCacheable: false,
    rfc: 'RFC 9110 s15.6.3',
  },
  {
    code: 503,
    reason: 'Service Unavailable',
    class: 'server-error',
    summary:
      'Temporarily down or overloaded. Retry-After turns this from a guess into a plan.',
    heuristicallyCacheable: false,
    rfc: 'RFC 9110 s15.6.4',
  },
  {
    code: 504,
    reason: 'Gateway Timeout',
    class: 'server-error',
    summary: 'A proxy gave up waiting for upstream.',
    heuristicallyCacheable: false,
    rfc: 'RFC 9110 s15.6.5',
  },
  {
    code: 505,
    reason: 'HTTP Version Not Supported',
    class: 'server-error',
    summary: 'The major version in the request-line is not one this server speaks.',
    heuristicallyCacheable: false,
    rfc: 'RFC 9110 s15.6.6',
  },
];

const STATUS_BY_CODE = new Map<number, StatusSemantics>(
  STATUS_SEMANTICS.map((entry) => [entry.code, entry]),
);

/**
 * The class of a status code, from its first digit alone.
 *
 * This works for codes the table has never heard of, which is the point: RFC 9110 s15
 * requires a client to treat an unrecognised `499` as a generic `400`, so a new code can
 * be deployed without breaking anything that came before it.
 */
export function statusClass(code: number): StatusClass {
  const first = Math.floor(code / 100);
  switch (first) {
    case 1:
      return 'informational';
    case 2:
      return 'successful';
    case 3:
      return 'redirection';
    case 4:
      return 'client-error';
    default:
      return 'server-error';
  }
}

/** The table row for a code, or `undefined` if it is not one this module documents. */
export function statusSemantics(code: number): StatusSemantics | undefined {
  return STATUS_BY_CODE.get(code);
}

/** The registered reason-phrase, or `''` for a code with no registered name. */
export function reasonPhrase(code: number): string {
  return STATUS_BY_CODE.get(code)?.reason ?? '';
}

/** `404 Not Found`, or `499` when there is no registered phrase. */
export function describeStatus(code: number): string {
  const reason = reasonPhrase(code);
  return reason === '' ? `${code}` : `${code} ${reason}`;
}

/**
 * Whether a cache may reuse this status with no explicit freshness information.
 *
 * RFC 9110 s15.1. Unknown codes are not heuristically cacheable, which is the safe
 * direction to guess in.
 */
export function isHeuristicallyCacheable(code: number): boolean {
  return STATUS_BY_CODE.get(code)?.heuristicallyCacheable ?? false;
}

/**
 * Whether this is a **final** response.
 *
 * A 1xx is interim: the request is still in progress and another response is coming on
 * the same exchange. Only a final response ends it (RFC 9110 s15).
 */
export function isFinalStatus(code: number): boolean {
  return code >= 200;
}

/**
 * Whether the response is forbidden from carrying content, whatever the method was.
 *
 * 1xx, 204, and 304 never have a body (RFC 9112 s6.3). This is why a 304 saves anything
 * at all, and it is enforced when one is built in `caching.ts`.
 */
export function forbidsContent(code: number): boolean {
  return statusClass(code) === 'informational' || code === 204 || code === 304;
}

/**
 * Whether a response to `method` with `status` may carry content.
 *
 * The method matters as much as the status: a response to HEAD carries no content even
 * when it is a 200 with a `Content-Length` of 40 kB. That length describes what a GET
 * *would* return, which is exactly what HEAD is for.
 */
export function allowsContent(method: HttpMethod, status: number): boolean {
  if (method === 'HEAD') return false;
  if (method === 'CONNECT' && statusClass(status) === 'successful') return false;
  return !forbidsContent(status);
}

// ---------------------------------------------------------------------------
// Redirects
// ---------------------------------------------------------------------------

/** What a client does to the method when it follows a redirect. */
export type RedirectMethodRule =
  /** Method and content are carried through unchanged. */
  | 'preserved'
  /** The spec says to use GET, and the content is dropped. */
  | 'rewritten-to-get'
  /**
   * The spec says preserve, every browser rewrites POST to GET, and RFC 9110 documents
   * the divergence rather than pretending it away. This is why 307 and 308 exist.
   */
  | 'rewritten-in-practice';

/** The codes that send a client somewhere else, with a `Location` field. */
export const REDIRECT_STATUS_CODES: readonly number[] = [301, 302, 303, 307, 308];

/**
 * Whether the code redirects the client to another URI.
 *
 * 304 is in the 3xx class and is **not** a redirect -- it is a cache validation answer,
 * and it carries no `Location`. Filing it under "redirection" is an artefact of the
 * numbering, not a statement about what it does.
 */
export function isRedirect(code: number): boolean {
  return REDIRECT_STATUS_CODES.includes(code);
}

/**
 * What happens to the request method when this redirect is followed.
 *
 * The rows in one table:
 *
 * | Code | Permanent | Method                    |
 * | ---- | --------- | ------------------------- |
 * | 301  | yes       | rewritten in practice     |
 * | 302  | no        | rewritten in practice     |
 * | 303  | no        | rewritten to GET, always  |
 * | 307  | no        | preserved                 |
 * | 308  | yes       | preserved                 |
 */
export function redirectMethodRule(code: number): RedirectMethodRule | undefined {
  switch (code) {
    case 301:
    case 302:
      return 'rewritten-in-practice';
    case 303:
      return 'rewritten-to-get';
    case 307:
    case 308:
      return 'preserved';
    default:
      return undefined;
  }
}

/** Whether following this redirect should update a stored bookmark or link. */
export function isPermanentRedirect(code: number): boolean {
  return code === 301 || code === 308;
}

/**
 * The method a client actually uses on the next hop of a redirect.
 *
 * Modelled as browsers behave, not as a strict reading would have it, because the
 * scenario exists to show what really happens to a POST at a 302. HEAD is never
 * rewritten to GET -- a client that asked for headers only still wants headers only.
 */
export function methodAfterRedirect(method: HttpMethod, code: number): HttpMethod {
  const rule = redirectMethodRule(code);
  if (rule === undefined || rule === 'preserved') return method;
  return method === 'HEAD' ? 'HEAD' : 'GET';
}

/** The `Location` a redirect points at, if it sent one. */
export function redirectTarget(message: HttpResponse): string | undefined {
  const location = message.headers.find(
    (field) => field.name.toLowerCase() === 'location',
  );
  return location?.value;
}
