/**
 * The HTTP/1.1 message model, restated for the one exchange this module still speaks HTTP in.
 *
 * A WebSocket does not begin as a WebSocket. It begins as an ordinary HTTP/1.1 `GET` --
 * routed by ordinary HTTP infrastructure, logged by ordinary HTTP logs, subject to ordinary
 * HTTP authentication -- and only when the server answers `101` does the connection stop
 * being HTTP and become a stream of frames. That first request and that first response are
 * the entire reason WebSockets deploy at all: they travel through the port 80 and 443 the
 * world already lets through.
 *
 * So this module needs the phase-08 model of a request and a response, and it needs it to be
 * *the same model*, or the handshake panel would teach a second, subtly different HTTP.
 *
 * ## Why this is a restatement and not an import
 *
 * `eslint.config.mjs` forbids `src/modules/<a>` importing from `src/modules/<b>`, and it is
 * right to: that rule is what keeps ten modules from congealing into one. The HTTP
 * Explorer's `sim/message.ts` is therefore off limits, and phases 09 and 10A hit the same
 * wall and answered it the same way.
 *
 * What is restated is the *shape*, narrowed hard to what a handshake uses:
 *
 * - **field lines as an ordered list, not a map**, for the same reason as phase 08: order is
 *   what the panel shows, and duplicates are legal. This module has a live instance of it --
 *   `Sec-WebSocket-Protocol` may be sent as three lines or as one comma-joined line, and
 *   `upgrade.ts` has to read both and treat them identically.
 * - **the HTTP version on the message**, which phase 08 needs for its version comparison and
 *   this module needs because RFC 6455 s 4.1 requires the request be HTTP/1.1 or better.
 *   `HTTP/1.0` cannot carry an upgrade, and HTTP/2 abandons this handshake entirely for the
 *   `CONNECT` method of RFC 8441.
 * - **the CRLF wire rendering**, because "this is a real HTTP request" is a claim best made
 *   by showing the bytes.
 * - **comma-separated token lists**, which is not decoration here: `Connection: Upgrade` is
 *   a token *list*, real clients send `Connection: keep-alive, Upgrade`, and a server that
 *   compares the whole field value to the string `"Upgrade"` rejects them. That bug is
 *   common enough to be worth modelling, so {@link fieldTokens} exists and `upgrade.ts` uses
 *   it everywhere the specification says "token".
 *
 * What is left out is everything phase 08 exists to teach and a handshake does not touch:
 * chunked framing, cookie jars, cache freshness, CORS, the three HTTP versions. Those live
 * in the HTTP Explorer, the Learning Center links the two, and duplicating them here would
 * be the actual mistake this file could be accused of.
 */

import { fail, ok, type ParseResult } from '@/core/net/result';

import { utf8Bytes } from './digest';

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

/**
 * The HTTP versions the handshake has an opinion about.
 *
 * `1.0` is here to be refused. RFC 6455 s 4.1 requires the request to be "HTTP/1.1 or
 * higher", and the reason is not pedantry: the `Connection` and `Upgrade` fields are
 * hop-by-hop, and HTTP/1.0 had no reliable notion of a persistent connection for a hop-by-hop
 * upgrade to survive on. `2` is here because a reader will ask, and because the answer is
 * interesting -- see {@link describeVersion}.
 */
export type HttpVersion = '1.0' | '1.1' | '2';

/** The version token as it appears on a request line: `HTTP/1.1`. */
export function versionToken(version: HttpVersion): string {
  return `HTTP/${version}`;
}

/** What each version means for an upgrade, in one sentence. */
export function describeVersion(version: HttpVersion): string {
  switch (version) {
    case '1.0':
      return 'Too old to upgrade: RFC 6455 s 4.1 requires HTTP/1.1 or higher.';
    case '1.1':
      return 'The version the WebSocket handshake is defined on top of.';
    case '2':
      return (
        'HTTP/2 deleted the Upgrade mechanism entirely -- there is no connection-wide ' +
        'state to switch, only streams. RFC 8441 brings WebSockets back over a single ' +
        'HTTP/2 stream using an extended CONNECT, which is a different handshake with the ' +
        'same frames after it.'
      );
  }
}

// ---------------------------------------------------------------------------
// Field lines
// ---------------------------------------------------------------------------

/** One field line, kept as written so the panel shows the casing an endpoint sent. */
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

/** Lower-case: the form every field-name comparison here uses (RFC 9110 s 5.1). */
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
 * such a field means the same thing sent once or several times. `Sec-WebSocket-Protocol` is
 * the field in this module that really is sent both ways.
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

/**
 * A list-valued field split into its tokens, lower-cased and trimmed.
 *
 * This is the function the whole handshake turns on. RFC 9110 s 7.6.1 defines `Connection`
 * as a comma-separated list of connection-option tokens, and RFC 6455 s 4.2.1 says the
 * `Upgrade` token must be *present in* that list -- not equal to it. Browsers send
 * `Connection: keep-alive, Upgrade`, and every server that has ever compared the field value
 * to the literal string `"Upgrade"` has rejected Firefox and blamed Firefox.
 *
 * Lower-casing is correct for these particular fields and not in general: RFC 6455 s 4.2.1
 * makes the `Upgrade` and `Connection` values ASCII case-insensitive. `Sec-WebSocket-Key`
 * and `Sec-WebSocket-Accept` are base64 and are compared **exactly**, which is why they
 * never come through here.
 */
export function fieldTokens(headers: HeaderList, name: string): string[] {
  const combined = headerValue(headers, name);
  if (combined === undefined) return [];
  return combined
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token !== '');
}

/** Whether a list-valued field contains `token`, compared case-insensitively. */
export function hasFieldToken(headers: HeaderList, name: string, token: string): boolean {
  return fieldTokens(headers, name).includes(token.toLowerCase());
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

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/**
 * The methods this module can put on a request line.
 *
 * Deliberately tiny. RFC 6455 s 4.1 requires `GET` and nothing else is legal for an opening
 * handshake, but a wrong method has to be *representable* for the handshake validator to
 * have anything to reject -- and "why not POST?" is a fair question with a good answer: the
 * handshake has no body, is not creating anything, and must be safe to route through
 * infrastructure that only ever expected to see a `GET`.
 */
export type HttpMethod = 'GET' | 'POST' | 'HEAD' | 'PUT' | 'OPTIONS' | 'CONNECT';

/** A request, as the client means it. */
export interface HttpRequest {
  readonly method: HttpMethod;
  /** Origin-form: an absolute path with an optional query, e.g. `/chat?room=lobby`. */
  readonly target: string;
  readonly version: HttpVersion;
  readonly headers: HeaderList;
  /** Absent means no body at all, which differs from a zero-length one. */
  readonly body?: string;
}

/** A response, as the server means it. */
export interface HttpResponse {
  readonly status: number;
  /**
   * Advisory only (RFC 9112 s 4). Never branch on it.
   *
   * Worth stating twice for this module, because `101 Switching Protocols` is the reason
   * curl prints "Switching Protocols" and a naive client sometimes checks for that phrase. A
   * server is free to send `101 Web Socket Protocol Handshake` -- and the reference server in
   * RFC 6455 s 1.2 does exactly that.
   */
  readonly reason: string;
  readonly version: HttpVersion;
  readonly headers: HeaderList;
  readonly body?: string;
}

/** Either direction, where a helper genuinely does not care. */
export type HttpMessage = HttpRequest | HttpResponse;

/** Narrow a message to a request. */
export function isRequest(message: HttpMessage): message is HttpRequest {
  return 'method' in message;
}

/** Build a request, defaulting version and headers so scenarios stay short. */
export function request(init: {
  method?: HttpMethod;
  target: string;
  version?: HttpVersion;
  headers?: HeaderList;
  body?: string;
}): HttpRequest {
  return {
    method: init.method ?? 'GET',
    target: init.target,
    version: init.version ?? '1.1',
    headers: init.headers ?? [],
    ...(init.body === undefined ? {} : { body: init.body }),
  };
}

/** Build a response. */
export function response(init: {
  status: number;
  reason?: string;
  version?: HttpVersion;
  headers?: HeaderList;
  body?: string;
}): HttpResponse {
  return {
    status: init.status,
    reason: init.reason ?? '',
    version: init.version ?? '1.1',
    headers: init.headers ?? [],
    ...(init.body === undefined ? {} : { body: init.body }),
  };
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

/** A request-target split into the parts the handshake and the router need. */
export interface RequestTarget {
  /** Always begins with `/`. */
  readonly path: string;
  /** Without the `?`. Empty when there was no query. */
  readonly query: string;
}

/**
 * Split an origin-form request-target.
 *
 * The query survives, because it is where WebSocket clients put things they cannot put
 * anywhere else. The browser `WebSocket` constructor takes a URL and a subprotocol list and
 * nothing more -- no headers, no `Authorization` -- so a token that has to reach the server
 * ends up in the query string, where it lands in every access log the request passes
 * through. `upgrade.ts` says so where it matters; the alternative is a `Sec-WebSocket-
 * Protocol` value abused as a credential, or a cookie, and all three have real costs.
 *
 * The fragment is dropped because it never leaves the client (RFC 3986 s 3.5), and
 * `ws://host/chat#anything` therefore reaches the server as `/chat`.
 */
export function parseTarget(target: string): RequestTarget {
  const withoutFragment = target.split('#')[0];
  const questionMark = withoutFragment.indexOf('?');
  const rawPath =
    questionMark === -1 ? withoutFragment : withoutFragment.slice(0, questionMark);
  const query = questionMark === -1 ? '' : withoutFragment.slice(questionMark + 1);
  return { path: rawPath === '' ? '/' : rawPath, query };
}

/**
 * The scheme a WebSocket URL uses, and the HTTP scheme it actually runs over.
 *
 * `ws` and `wss` are separate URI schemes (RFC 6455 s 3) rather than a query parameter or a
 * fragment on `http`, and the split matters for the same reason `https` is not a mode of
 * `http`: it makes the security property part of the identifier, so a mixed-content check
 * has something to look at. A page served over `https` may not open a `ws://` socket, and
 * that rule is only expressible because the scheme is different.
 */
export type WebSocketScheme = 'ws' | 'wss';

/** The default port for a scheme -- the same 80 and 443 HTTP uses, deliberately. */
export function defaultPort(scheme: WebSocketScheme): number {
  return scheme === 'wss' ? 443 : 80;
}

/** The HTTP scheme the handshake for `scheme` is carried over. */
export function underlyingScheme(scheme: WebSocketScheme): 'http' | 'https' {
  return scheme === 'wss' ? 'https' : 'http';
}

// ---------------------------------------------------------------------------
// The wire form
// ---------------------------------------------------------------------------

/** The line terminator, spelled out because the whole point here is that it is CRLF. */
export const CRLF = '\r\n';

/** The start line of either kind of message. */
export function startLine(message: HttpMessage): string {
  return isRequest(message)
    ? `${message.method} ${message.target} ${versionToken(message.version)}`
    : `${versionToken(message.version)} ${message.status} ${message.reason}`.trimEnd();
}

/**
 * The message as the lines a reader sees, without the terminators.
 *
 * Returned as lines rather than one string so the panel can highlight a single field line
 * without re-parsing text it just formatted. {@link renderMessage} is the joined form for a
 * copy button or a test.
 */
export function messageLines(message: HttpMessage): string[] {
  const lines = [startLine(message)];
  for (const field of message.headers) {
    lines.push(`${field.name}: ${field.value}`);
  }
  return lines;
}

/**
 * The message exactly as it goes on the wire: CRLF after every line, and a blank line
 * ending the header section.
 *
 * The trailing blank line is not a formatting nicety -- it is the framing. It is what tells
 * the receiver the header section is over, and for a `101` it is the precise byte boundary
 * where HTTP stops and WebSocket frames begin. Everything after that CRLF CRLF on the same
 * TCP connection is read by the frame parser in `frames.ts`, not by an HTTP parser.
 */
export function renderMessage(message: HttpMessage): string {
  const head = messageLines(message).join(CRLF) + CRLF + CRLF;
  return message.body === undefined ? head : head + message.body;
}

/**
 * The exact size of the message in bytes.
 *
 * "Exact" and not "approximate", unlike the phase-10A helper of the same purpose, because
 * this module compares handshake bytes against frame bytes and the comparison is only
 * honest if both sides are counted the same way. HTTP/1.1 is text, so counting the rendered
 * form *is* counting the wire -- there is no HPACK here to make the number a fiction.
 */
export function wireBytes(message: HttpMessage): number {
  return byteLength(renderMessage(message));
}

/**
 * The length of a string **in bytes**, not characters.
 *
 * Everything measured in this module is octets: `Content-Length` counts them (RFC 9110
 * s 8.6), the frame `Payload length` field counts them (RFC 6455 s 5.2), and the transport
 * comparison in `comparison.ts` is meaningless if one side is counted in characters.
 */
export function byteLength(text: string): number {
  return utf8Bytes(text).length;
}

// ---------------------------------------------------------------------------
// Parsing the wire form back
// ---------------------------------------------------------------------------

/**
 * Parse a request from its CRLF text.
 *
 * Present so the handshake panel can let a reader *edit the raw request* and watch the
 * validation verdicts change -- which is a far better way to learn what each field does than
 * reading a list of them. It is a teaching parser and says so: it accepts a bare LF as well
 * as CRLF, because a reader typing into a textarea will not produce carriage returns, and
 * refusing their input over a character they cannot see would teach nothing except
 * frustration. A real server must be stricter (RFC 9112 s 2.2).
 */
export function parseRequest(text: string): ParseResult<HttpRequest> {
  const lines = text.split(/\r?\n/);
  const requestLine = lines[0] ?? '';
  const parts = requestLine.split(' ').filter((part) => part !== '');
  if (parts.length !== 3) {
    return fail(
      `a request line is "method target version"; this has ${parts.length} part(s)`,
    );
  }

  const [method, target, version] = parts;
  if (!isHttpMethod(method)) {
    return fail(`"${method}" is not a method this module models`);
  }
  if (!version.startsWith('HTTP/')) {
    return fail(`"${version}" is not an HTTP version token`);
  }
  const versionNumber = version.slice('HTTP/'.length);
  if (!isHttpVersion(versionNumber)) {
    return fail(`HTTP version "${versionNumber}" is not one this module models`);
  }
  if (!target.startsWith('/')) {
    return fail('a WebSocket handshake uses origin-form: the target must start with "/"');
  }

  const headers: HttpHeader[] = [];
  for (const line of lines.slice(1)) {
    if (line.trim() === '') break; // the blank line ends the header section
    const colon = line.indexOf(':');
    if (colon <= 0) {
      return fail(`header line "${line}" has no field name before a colon`);
    }
    // No space is permitted before the colon (RFC 9112 s 5.1) -- that rule exists because
    // "Foo : bar" is parsed differently by different intermediaries, which is the ingredient
    // request smuggling is made of. Trimmed rather than rejected here, and flagged instead.
    headers.push(header(line.slice(0, colon).trim(), line.slice(colon + 1).trim()));
  }

  return ok(request({ method, target, version: versionNumber, headers }));
}

/** Whether a string is a method this module models. */
export function isHttpMethod(value: string): value is HttpMethod {
  return ['GET', 'POST', 'HEAD', 'PUT', 'OPTIONS', 'CONNECT'].includes(value);
}

/** Whether a string is a version this module models. */
export function isHttpVersion(value: string): value is HttpVersion {
  return value === '1.0' || value === '1.1' || value === '2';
}
