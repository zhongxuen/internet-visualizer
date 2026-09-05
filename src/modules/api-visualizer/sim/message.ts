/**
 * The HTTP message model, restated for this module.
 *
 * Everything an API does is HTTP. A REST call is a method and a target; a bearer token is a
 * header; a `429` is a status with two headers pinned to it; a webhook is the same request
 * pointing the other way. So this module needs the phase-08 model of a request and a
 * response, and it needs it to be *the same model*, or the API Visualizer would end up
 * teaching a second, subtly different HTTP.
 *
 * ## Why this is a copy and not an import
 *
 * `eslint.config.mjs` forbids `src/modules/<a>` importing from `src/modules/<b>`, and it is
 * right to: the rule is what keeps ten modules from congealing into one. The HTTP Explorer's
 * `sim/message.ts` is therefore off limits, and phase 09 hit the same wall and answered it
 * the same way (`https-explorer/sim/records.ts`, "deliberately not typed to HTTP").
 *
 * What is restated here is the *shape*, deliberately narrowed to what an API module uses:
 *
 * - **field lines as an ordered list, not a map** -- for the same two reasons as phase 08.
 *   Order is what the console shows, and duplicates are legal. This module has its own
 *   instance of that: `Link` may be sent as several lines or one comma-joined line, and
 *   `pagination.ts` has to read both.
 * - **`request()` / `response()` constructors** with the same defaults, so a scenario here
 *   reads like a scenario there.
 * - **a `HttpMethod` union** covering the verbs REST assigns meaning to.
 *
 * What is left out is everything phase 08 exists to teach and this module does not: the CRLF
 * wire format, chunked framing, the three HTTP versions, cookie jars, cache freshness
 * arithmetic, CORS. Those live in the HTTP Explorer, the Learning Center links the two, and
 * duplicating them here would be the actual mistake this file is accused of.
 *
 * ## Bodies are JSON, and they are strings
 *
 * An API body is a JSON document, so {@link JsonValue} is modelled properly and
 * {@link jsonBody} is the only way a body gets set. It serialises with two-space indentation
 * and preserves key insertion order, which makes the output deterministic -- the property
 * every simulation in this repository depends on -- and makes {@link byteLength} a number a
 * learner can reconcile with what they see on screen.
 */

import { fail, ok, type ParseResult } from '@/core/net/result';

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

/** A JSON document, typed rather than left as `unknown`. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** A JSON object specifically -- what a resource representation always is. */
export type JsonObject = { readonly [key: string]: JsonValue };

/**
 * A JSON document as the text that would travel in a body.
 *
 * Two-space indentation because this is read by a human in a console pane, not parsed by a
 * machine that would prefer it compact. `byteLength` counts the whitespace, which is honest:
 * pretty-printed JSON really is bigger on the wire, and the GraphQL-versus-REST byte counts
 * in `graphql.ts` would be a lie if one side were measured minified and the other not.
 */
export function jsonText(value: JsonValue): string {
  return JSON.stringify(value, null, 2);
}

/** Parse a JSON body, reporting the failure rather than throwing it. */
export function parseJson(text: string): ParseResult<JsonValue> {
  try {
    return ok(JSON.parse(text) as JsonValue);
  } catch (error) {
    return fail(
      error instanceof Error ? error.message.toLowerCase() : 'is not valid json',
    );
  }
}

// ---------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------

/**
 * The methods an HTTP API uses.
 *
 * `CONNECT` and `TRACE` are omitted -- they exist for proxies and diagnostics, no API
 * assigns them a resource meaning, and `TRACE` is switched off nearly everywhere because it
 * reflects request headers back. Their absence is a statement about REST, not an oversight.
 */
export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

/** Every method this module knows, in the order the verb chips list them. */
export const HTTP_METHODS: readonly HttpMethod[] = [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
];

/** Whether a string is one of them. Methods are case-**sensitive** (RFC 9110 s 9). */
export function isHttpMethod(value: string): value is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Field lines
// ---------------------------------------------------------------------------

/** One field line, kept as written so the console can show the casing a server sent. */
export interface HttpHeader {
  readonly name: string;
  readonly value: string;
}

/** An ordered list of field lines. Duplicates are legal and meaningful. */
export type HeaderList = readonly HttpHeader[];

/** Make a header without spelling the object shape at every call site. */
export function header(name: string, value: string): HttpHeader {
  return { name, value };
}

/** Lower-case: the form every comparison here uses (RFC 9110 s 5.1). */
export function normalizeFieldName(name: string): string {
  return name.trim().toLowerCase();
}

/** All values sent under `name`, in wire order. Empty if the field is absent. */
export function headerValues(headers: HeaderList, name: string): string[] {
  const wanted = normalizeFieldName(name);
  return headers
    .filter((field) => normalizeFieldName(field.name) === wanted)
    .map((field) => field.value);
}

/**
 * The combined value of a field, or `undefined` if it was not sent.
 *
 * Repeated list-valued fields are joined with `", "`, which RFC 9110 s 5.3 permits because
 * such a field means the same thing sent once or several times. `Link` is the field in this
 * module that really is sent both ways, and `pagination.ts` reads it through here for
 * exactly that reason.
 */
export function headerValue(headers: HeaderList, name: string): string | undefined {
  const values = headerValues(headers, name);
  return values.length === 0 ? undefined : values.join(', ');
}

/** Whether the field was sent at all, however many times. */
export function hasHeader(headers: HeaderList, name: string): boolean {
  const wanted = normalizeFieldName(name);
  return headers.some((field) => normalizeFieldName(field.name) === wanted);
}

/** Replace every line for `name` with one line, keeping the original position. */
export function setHeader(headers: HeaderList, name: string, value: string): HeaderList {
  const wanted = normalizeFieldName(name);
  const index = headers.findIndex((field) => normalizeFieldName(field.name) === wanted);
  if (index === -1) return [...headers, header(name, value)];
  return headers.flatMap((field, position) => {
    if (position === index) return [header(name, value)];
    return normalizeFieldName(field.name) === wanted ? [] : [field];
  });
}

/** Add another line for `name` without disturbing any already there. */
export function appendHeader(
  headers: HeaderList,
  name: string,
  value: string,
): HeaderList {
  return [...headers, header(name, value)];
}

/** Drop every line for `name`. */
export function removeHeader(headers: HeaderList, name: string): HeaderList {
  const wanted = normalizeFieldName(name);
  return headers.filter((field) => normalizeFieldName(field.name) !== wanted);
}

/**
 * Redact a field's value for display, keeping a short prefix.
 *
 * Used wherever the console renders an `Authorization` or an API key. The prefix is kept
 * because it is genuinely useful -- it tells you *which* credential is being sent -- and
 * because a row of asterisks alone teaches nothing about what a bearer token looks like.
 */
export function redactHeaderValue(value: string, keep = 12): string {
  if (value.length <= keep) return value;
  return `${value.slice(0, keep)}...(${value.length - keep} more)`;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** A request, as the client means it. */
export interface HttpRequest {
  readonly method: HttpMethod;
  /** Origin-form: an absolute path with an optional query, e.g. `/articles?limit=3`. */
  readonly target: string;
  readonly headers: HeaderList;
  /** Absent means no body at all, which differs from a zero-length one. */
  readonly body?: string;
}

/** A response, as the server means it. */
export interface HttpResponse {
  readonly status: number;
  /** Advisory only (RFC 9112 s 4). Never branch on it. */
  readonly reason: string;
  readonly headers: HeaderList;
  readonly body?: string;
}

/** Either direction, where a helper genuinely does not care. */
export type HttpMessage = HttpRequest | HttpResponse;

/** Narrow a message to a request. */
export function isRequest(message: HttpMessage): message is HttpRequest {
  return 'method' in message;
}

/** Build a request, defaulting headers so scenarios stay short. */
export function request(init: {
  method: HttpMethod;
  target: string;
  headers?: HeaderList;
  body?: string;
}): HttpRequest {
  return {
    method: init.method,
    target: init.target,
    headers: init.headers ?? [],
    ...(init.body === undefined ? {} : { body: init.body }),
  };
}

/** Build a response. */
export function response(init: {
  status: number;
  reason?: string;
  headers?: HeaderList;
  body?: string;
}): HttpResponse {
  return {
    status: init.status,
    reason: init.reason ?? '',
    headers: init.headers ?? [],
    ...(init.body === undefined ? {} : { body: init.body }),
  };
}

/**
 * Attach a JSON document as the body, with the `Content-Type` and `Content-Length` that
 * describe it.
 *
 * Going through one function is what stops the three numbers on screen -- the body, its
 * declared length, and the byte counter -- from ever disagreeing. `application/json` carries
 * no `charset` parameter because RFC 8259 s 8.1 fixes JSON as UTF-8 and the parameter is
 * undefined for the media type; servers that send one are adding noise.
 */
export function withJsonBody<T extends HttpRequest | HttpResponse>(
  message: T,
  value: JsonValue,
): T {
  const body = jsonText(value);
  return {
    ...message,
    headers: setHeader(
      setHeader(message.headers, 'Content-Type', 'application/json'),
      'Content-Length',
      `${byteLength(body)}`,
    ),
    body,
  };
}

/** A response carrying a JSON document -- the shape of nearly every API reply. */
export function jsonResponse(init: {
  status: number;
  reason?: string;
  headers?: HeaderList;
  body: JsonValue;
}): HttpResponse {
  return withJsonBody(
    response({ status: init.status, reason: init.reason, headers: init.headers }),
    init.body,
  );
}

// ---------------------------------------------------------------------------
// Targets and query strings
// ---------------------------------------------------------------------------

/** A request-target split into the parts a router and a paginator need. */
export interface RequestTarget {
  /** Always begins with `/`. */
  readonly path: string;
  /** Without the `?`. Empty when there was no query. */
  readonly query: string;
  /** The query parsed into pairs, in the order they were written. */
  readonly params: readonly (readonly [string, string])[];
}

/**
 * Split an origin-form request-target and decode its query.
 *
 * The fragment is dropped because it never leaves the client (RFC 3986 s 3.5) -- which is
 * incidentally why the OAuth *implicit* flow put its token there, and why that hiding place
 * turned out to be no defence at all once the browser history and the `Referer` header were
 * accounted for. `auth.ts` picks that thread up.
 *
 * Repeated keys are preserved as separate pairs rather than collapsed. `?tag=a&tag=b` is how
 * every list-valued query parameter is written, and a `Record` would keep only `b`.
 */
export function parseTarget(target: string): RequestTarget {
  const withoutFragment = target.split('#')[0];
  const questionMark = withoutFragment.indexOf('?');
  const rawPath =
    questionMark === -1 ? withoutFragment : withoutFragment.slice(0, questionMark);
  const query = questionMark === -1 ? '' : withoutFragment.slice(questionMark + 1);

  const params = query
    .split('&')
    .filter((pair) => pair !== '')
    .map((pair) => {
      const equals = pair.indexOf('=');
      const key = equals === -1 ? pair : pair.slice(0, equals);
      const value = equals === -1 ? '' : pair.slice(equals + 1);
      return [decodeFormValue(key), decodeFormValue(value)] as const;
    });

  return { path: rawPath === '' ? '/' : rawPath, query, params };
}

/** The first value for `name`, or `undefined`. */
export function queryParam(target: RequestTarget, name: string): string | undefined {
  return target.params.find(([key]) => key === name)?.[1];
}

/**
 * Build a query string from pairs, percent-encoding each side.
 *
 * `encodeURIComponent` is the right tool and `encodeURI` is not: the latter leaves `&`, `=`
 * and `?` alone, so a parameter value containing one would silently become two parameters --
 * which, when the value is a `redirect_uri`, is a parameter-injection bug rather than a
 * cosmetic one.
 *
 * Space is then rewritten from `%20` to `+`, the `application/x-www-form-urlencoded` form
 * that browsers and OAuth servers both produce.
 */
export function buildQuery(params: readonly (readonly [string, string])[]): string {
  return params
    .map(([key, value]) => `${encodeFormValue(key)}=${encodeFormValue(value)}`)
    .join('&');
}

/** A path with a query attached, or the bare path when there are no parameters. */
export function withQuery(
  path: string,
  params: readonly (readonly [string, string])[],
): string {
  const query = buildQuery(params);
  return query === '' ? path : `${path}?${query}`;
}

function encodeFormValue(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, '+');
}

function decodeFormValue(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    // A stray `%` is not a decoding failure worth propagating through a router; the raw
    // text is what the server would have logged anyway.
    return value;
  }
}

// ---------------------------------------------------------------------------
// Sizes
// ---------------------------------------------------------------------------

const ENCODER = new TextEncoder();

/**
 * The length of a string **in bytes**, not characters.
 *
 * `Content-Length` counts octets (RFC 9110 s 8.6), and the over-fetching numbers this module
 * puts on screen are only meaningful in the same unit.
 */
export function byteLength(text: string): number {
  return ENCODER.encode(text).length;
}

/** The body's size in bytes; zero when there is no body. */
export function bodyLength(message: HttpMessage): number {
  return message.body === undefined ? 0 : byteLength(message.body);
}

/**
 * A rough size for the whole message, headers included.
 *
 * "Rough" is the honest word. This counts the HTTP/1.1 text form -- `Name: value` plus two
 * bytes of line terminator per line, plus the blank line -- because that is the version whose
 * size you can reason about by looking. Over HTTP/2 the same fields are HPACK-compressed and
 * a repeated header can cost a single byte, so a transport comparison must not quote this
 * number as if it were universal.
 */
export function approximateWireBytes(message: HttpMessage): number {
  const startLine = isRequest(message)
    ? `${message.method} ${message.target} HTTP/1.1`
    : `HTTP/1.1 ${message.status} ${message.reason}`;
  const lines = message.headers.reduce(
    (total, field) => total + byteLength(`${field.name}: ${field.value}`) + 2,
    byteLength(startLine) + 2,
  );
  return lines + 2 + bodyLength(message);
}
