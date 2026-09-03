/**
 * The message -- what HTTP actually puts on the wire.
 *
 * HTTP is usually taught as a list of verbs and a table of numbers, which hides the
 * thing that makes it comprehensible: an HTTP/1.1 message is **text you can read**, with
 * a shape so simple it fits in four lines of grammar. A start-line, some field lines, a
 * blank line, and then the body. That blank line is the whole framing mechanism, and
 * seeing it once explains more than any amount of prose about "the headers section".
 *
 * ```
 * GET /index.html HTTP/1.1\r\n
 * Host: example.com\r\n
 * Accept: text/html\r\n
 * \r\n
 * ```
 *
 * This file is the only place in the module that knows that syntax. Everything above it
 * -- semantics, caching, cookies -- works on the structured {@link HttpRequest} and
 * {@link HttpResponse} models, and only ever comes here to turn one into bytes.
 *
 * ## Fields are a list, not a map
 *
 * {@link HttpHeader} lines are held as an ordered list because both properties of that
 * list are load-bearing:
 *
 * - **Order is preserved on the wire** and the wire view is the point of this module.
 * - **Duplicates are legal.** `Set-Cookie` is sent once per cookie and, uniquely among
 *   fields, may *not* be combined into one comma-separated line (RFC 9110 s5.3). A
 *   `Record<string, string>` would silently destroy a login.
 *
 * Names are compared case-insensitively (RFC 9110 s5.1) and stored exactly as written,
 * so `WireView` can show the capitalisation a server really sent.
 *
 * ## Only HTTP/1.1 has a text wire format
 *
 * HTTP/2 and HTTP/3 carry the *same* semantics over binary frames with compressed header
 * blocks; there is no text form of an h2 request, and pretending otherwise is the most
 * common thing diagrams get wrong. {@link hasTextWireFormat} says so explicitly, and
 * `versions.ts` models the frames.
 *
 * ## Time
 *
 * HTTP dates are absolute wall-clock instants (RFC 9110 s5.6.7); the simulation runs on
 * virtual milliseconds from zero. {@link HttpClock} is the one conversion between them,
 * so `Date.now()` never appears anywhere in this module.
 */

import { fail, ok, type ParseResult } from '@/core/net/result';

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

/** The three versions this module compares. */
export type HttpVersion = 'HTTP/1.1' | 'HTTP/2' | 'HTTP/3';

/** In the order the version-comparison view lists them. */
export const HTTP_VERSIONS: readonly HttpVersion[] = ['HTTP/1.1', 'HTTP/2', 'HTTP/3'];

/** Short labels: `h1`, `h2`, `h3` -- what the ALPN identifiers and the tabs use. */
export const VERSION_ALIASES: Readonly<Record<HttpVersion, string>> = {
  'HTTP/1.1': 'h1',
  'HTTP/2': 'h2',
  'HTTP/3': 'h3',
};

/**
 * Whether a version serialises to readable text.
 *
 * Only HTTP/1.1 does. h2 (RFC 9113) and h3 (RFC 9114) send HEADERS and DATA frames with
 * HPACK/QPACK-compressed field blocks, and their pseudo-header fields (`:method`,
 * `:path`, `:authority`, `:scheme`, `:status`) replace the start-line entirely.
 */
export function hasTextWireFormat(version: HttpVersion): boolean {
  return version === 'HTTP/1.1';
}

// ---------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------

/** The methods RFC 9110 s9.3 registers, plus PATCH (RFC 5789). */
export type HttpMethod =
  'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'CONNECT' | 'OPTIONS' | 'TRACE';

/** Every method this module knows, in RFC 9110 s9.3 order with PATCH after PUT. */
export const HTTP_METHODS: readonly HttpMethod[] = [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'CONNECT',
  'OPTIONS',
  'TRACE',
];

/**
 * Whether a string is a method this module models.
 *
 * Methods are case-**sensitive** on the wire (RFC 9110 s9), which is why `get` is not a
 * GET. That trips people up often enough to be worth not papering over here.
 */
export function isHttpMethod(value: string): value is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Field lines
// ---------------------------------------------------------------------------

/** One field line, kept exactly as written so the wire view can show it verbatim. */
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

/** Lower-case: the form every comparison in this module uses (RFC 9110 s5.1). */
export function normalizeFieldName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * The characters a field name may contain -- `token` from RFC 9110 s5.6.2.
 *
 * Anything else is not a header, and a server that accepted one would be inventing
 * syntax. The builder in the UI validates against this.
 */
const TOKEN_CHARS = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** True if `name` is a legal field name. */
export function isValidFieldName(name: string): boolean {
  return TOKEN_CHARS.test(name);
}

/**
 * True if `value` is a legal field value.
 *
 * The rule that matters is the one about CR and LF: a value containing either could end
 * the field line early and let an attacker inject headers or a whole second response
 * (**response splitting**). RFC 9112 s2.2 requires a recipient to reject such a message,
 * and this module refuses to build one in the first place.
 */
export function isValidFieldValue(value: string): boolean {
  return !value.includes('\r') && !value.includes('\n') && !value.includes('\0');
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
 * Repeated fields are joined with `", "`, which RFC 9110 s5.3 permits because a field
 * whose value is a comma-separated list means the same thing sent as one line or as
 * several. **`Set-Cookie` is the exception** -- it is not a list, and joining two of them
 * produces a cookie that never existed. Use {@link headerValues} for it; `cookies.ts`
 * does exactly that.
 */
export function headerValue(headers: HeaderList, name: string): string | undefined {
  const values = headerValues(headers, name);
  if (values.length === 0) return undefined;
  return values.join(', ');
}

/** Whether the field was sent at all, however many times. */
export function hasHeader(headers: HeaderList, name: string): boolean {
  const wanted = normalizeFieldName(name);
  return headers.some((field) => normalizeFieldName(field.name) === wanted);
}

/**
 * Replace every line for `name` with one line, keeping the original position.
 *
 * Position is preserved rather than appending, so re-serialising a message a proxy
 * touched does not reorder the fields a learner was just reading.
 */
export function setHeader(headers: HeaderList, name: string, value: string): HeaderList {
  const wanted = normalizeFieldName(name);
  const index = headers.findIndex((field) => normalizeFieldName(field.name) === wanted);
  if (index === -1) return [...headers, header(name, value)];
  return headers.flatMap((field, i) => {
    if (i === index) return [header(name, value)];
    return normalizeFieldName(field.name) === wanted ? [] : [field];
  });
}

/** Add another line for `name` without disturbing any that are already there. */
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

/** Keep only the named fields, in their original order -- how a 304 is assembled. */
export function pickHeaders(headers: HeaderList, names: readonly string[]): HeaderList {
  const wanted = new Set(names.map(normalizeFieldName));
  return headers.filter((field) => wanted.has(normalizeFieldName(field.name)));
}

/**
 * Parse one field line, `Name: value`.
 *
 * RFC 9112 s5 forbids whitespace between the name and the colon -- a message with it is
 * a smuggling vector and must be rejected, not trimmed into shape. This parser inherits
 * that: the name is taken verbatim up to the colon and then validated as a token, so
 * `Host : example.com` fails rather than being quietly repaired.
 */
export function parseFieldLine(line: string): ParseResult<HttpHeader> {
  const colon = line.indexOf(':');
  if (colon <= 0) return fail(`field line has no name: ${JSON.stringify(line)}`);

  const name = line.slice(0, colon);
  if (!isValidFieldName(name)) {
    return fail(`"${name}" is not a valid field name`);
  }
  // Optional whitespace around the value is stripped; it is not part of the value.
  const value = line.slice(colon + 1).replace(/^[ \t]+|[ \t]+$/g, '');
  if (!isValidFieldValue(value)) return fail('field value contains CR, LF, or NUL');

  return ok(header(name, value));
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** A request, as the client means it -- not yet as bytes. */
export interface HttpRequest {
  readonly method: HttpMethod;
  /**
   * The request-target in origin-form: an absolute path with an optional query,
   * e.g. `/search?q=http`. RFC 9112 s3.2.1. The host travels in the `Host` field, which
   * is what makes name-based virtual hosting possible and is why HTTP/1.1 requires it.
   */
  readonly target: string;
  readonly version: HttpVersion;
  readonly headers: HeaderList;
  /** Absent means no body at all, which is different from a zero-length one. */
  readonly body?: string;
}

/** A response, as the server means it. */
export interface HttpResponse {
  readonly status: number;
  /**
   * The reason-phrase. Advisory only -- RFC 9112 s4 lets it be anything, or empty, and
   * HTTP/2 and HTTP/3 drop it entirely. Never branch on it.
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

/** Build a request, defaulting the version and headers so scenarios stay short. */
export function request(init: {
  method: HttpMethod;
  target: string;
  version?: HttpVersion;
  headers?: HeaderList;
  body?: string;
}): HttpRequest {
  return {
    method: init.method,
    target: init.target,
    version: init.version ?? 'HTTP/1.1',
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
    version: init.version ?? 'HTTP/1.1',
    headers: init.headers ?? [],
    ...(init.body === undefined ? {} : { body: init.body }),
  };
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

/** A request-target split into the two halves anything downstream needs. */
export interface RequestTarget {
  /** Always begins with `/`. The cache keys on this and cookies path-match it. */
  readonly path: string;
  /** Without the `?`. Empty when there was no query. */
  readonly query: string;
}

/**
 * Split an origin-form request-target.
 *
 * The fragment (`#...`) is dropped because it never leaves the client: it is resolved in
 * the browser and is not part of the request (RFC 3986 s3.5). People are surprised by
 * this, so the parser is explicit about it rather than silently passing it along.
 */
export function parseTarget(target: string): RequestTarget {
  const withoutFragment = target.split('#')[0];
  const questionMark = withoutFragment.indexOf('?');
  const path =
    questionMark === -1 ? withoutFragment : withoutFragment.slice(0, questionMark);
  const query = questionMark === -1 ? '' : withoutFragment.slice(questionMark + 1);
  return { path: path === '' ? '/' : path, query };
}

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------

const ENCODER = new TextEncoder();

/**
 * The length of a string **in bytes**, not characters.
 *
 * `Content-Length` counts octets (RFC 9110 s8.6). `'café'.length` counts code
 * units, and even a precomposed `'café'` is 4 characters but 5 UTF-8 bytes; a server
 * that sent the character count would truncate its own response.
 */
export function byteLength(text: string): number {
  return ENCODER.encode(text).length;
}

/** The body's size in bytes; zero when there is no body. */
export function bodyLength(message: HttpMessage): number {
  return message.body === undefined ? 0 : byteLength(message.body);
}

/**
 * Add `Content-Length` matching the body this message actually carries.
 *
 * Scenarios call this instead of writing the number by hand, so a body edited in the
 * builder can never disagree with the length announced for it -- a mismatch between the
 * two is where request smuggling starts.
 */
export function withContentLength<T extends HttpRequest | HttpResponse>(message: T): T {
  const length = bodyLength(message);
  return {
    ...message,
    headers: setHeader(message.headers, 'Content-Length', `${length}`),
  };
}

// ---------------------------------------------------------------------------
// Dates and the clock
// ---------------------------------------------------------------------------

/**
 * The bridge between HTTP's absolute dates and the simulation's virtual clock.
 *
 * `origin` is the Unix epoch millisecond that virtual time `0` corresponds to. Scenarios
 * pin it to a fixed instant, which is what lets `Expires: Sun, 06 Nov 1994 08:49:37 GMT`
 * mean something on a timeline that starts at zero -- and what keeps every run
 * deterministic, because nothing here ever asks the machine what time it is.
 */
export interface HttpClock {
  readonly origin: number;
}

/** Virtual time zero is the Unix epoch. The default when a scenario says nothing. */
export const EPOCH_CLOCK: HttpClock = { origin: 0 };

/** An epoch millisecond as a virtual millisecond on this clock. */
export function toVirtual(clock: HttpClock, epochMs: number): number {
  return epochMs - clock.origin;
}

/** A virtual millisecond as an epoch millisecond, for writing a `Date` field. */
export function toEpoch(clock: HttpClock, virtualMs: number): number {
  return virtualMs + clock.origin;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const pad = (value: number) => `${value}`.padStart(2, '0');

/**
 * Format an epoch millisecond as an IMF-fixdate: `Sun, 06 Nov 1994 08:49:37 GMT`.
 *
 * This is the only format a sender may produce (RFC 9110 s5.6.7). It is fixed-width,
 * always GMT, and always English day and month names regardless of anyone's locale --
 * three constraints that exist so a date field can be compared as bytes.
 */
export function formatHttpDate(epochMs: number): string {
  const date = new Date(epochMs);
  const day = DAYS[date.getUTCDay()];
  const month = MONTHS[date.getUTCMonth()];
  return (
    `${day}, ${pad(date.getUTCDate())} ${month} ${date.getUTCFullYear()} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:` +
    `${pad(date.getUTCSeconds())} GMT`
  );
}

/**
 * Parse an HTTP date to an epoch millisecond.
 *
 * A recipient must also accept the two obsolete formats (RFC 9110 s5.6.7):
 * RFC 850 (`Sunday, 06-Nov-94 08:49:37 GMT`) and asctime
 * (`Sun Nov  6 08:49:37 1994`). Being liberal here is not politeness -- caches in the
 * wild still emit them, and a parser that rejected one would silently treat a
 * revalidatable response as one it could never freshen.
 */
export function parseHttpDate(value: string): ParseResult<number> {
  const text = value.trim();

  const imf =
    /^[A-Za-z]{3}, (\d{2}) ([A-Za-z]{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(text);
  if (imf) return fromParts(imf[1], imf[2], imf[3], imf[4], imf[5], imf[6]);

  const rfc850 =
    /^[A-Za-z]+, (\d{2})-([A-Za-z]{3})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(text);
  if (rfc850) {
    // Two-digit years: RFC 9110 s5.6.7 reads a year more than 50 years ahead as past.
    const twoDigit = Number(rfc850[3]);
    const year = twoDigit < 70 ? 2000 + twoDigit : 1900 + twoDigit;
    return fromParts(rfc850[1], rfc850[2], `${year}`, rfc850[4], rfc850[5], rfc850[6]);
  }

  const asctime =
    /^[A-Za-z]{3} ([A-Za-z]{3}) ([ \d]\d) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(text);
  if (asctime) {
    return fromParts(
      asctime[2].trim(),
      asctime[1],
      asctime[6],
      asctime[3],
      asctime[4],
      asctime[5],
    );
  }

  return fail(`"${value}" is not an HTTP-date`);
}

function fromParts(
  day: string,
  monthName: string,
  year: string,
  hour: string,
  minute: string,
  second: string,
): ParseResult<number> {
  const month = MONTHS.indexOf(monthName);
  if (month === -1) return fail(`"${monthName}" is not a month`);
  const dayNumber = Number(day);
  const epoch = Date.UTC(
    Number(year),
    month,
    dayNumber,
    Number(hour),
    Number(minute),
    Number(second),
  );
  if (Number.isNaN(epoch)) return fail(`"${monthName} ${day}" is not a date`);
  // Date.UTC rolls 32 January into 1 February; an out-of-range day is a bad date.
  if (new Date(epoch).getUTCDate() !== dayNumber) {
    return fail(`day ${day} is out of range`);
  }
  return ok(epoch);
}

/** A date field's value as a virtual millisecond, or `undefined` if absent or bad. */
export function dateHeaderAt(
  headers: HeaderList,
  name: string,
  clock: HttpClock,
): number | undefined {
  const raw = headerValue(headers, name);
  if (raw === undefined) return undefined;
  const parsed = parseHttpDate(raw);
  return parsed.ok ? toVirtual(clock, parsed.value) : undefined;
}

// ---------------------------------------------------------------------------
// Wire serialization
// ---------------------------------------------------------------------------

/**
 * The line terminator, and the reason this module exists.
 *
 * Every line of an HTTP/1.1 message ends with CR LF -- carriage return then line feed,
 * `0x0D 0x0A` -- not with the bare LF a text editor produces. The header section then
 * ends with a CR LF *on its own*, and everything after that pair of bytes is the body.
 */
export const CRLF = '\r\n';

/** The request-line: `GET /index.html HTTP/1.1` (RFC 9112 s3). */
export function requestLine(message: HttpRequest): string {
  return `${message.method} ${message.target} ${message.version}`;
}

/**
 * The status-line: `HTTP/1.1 404 Not Found` (RFC 9112 s4).
 *
 * The space before an empty reason-phrase is required by the grammar and is kept,
 * because "byte-accurate" has to mean it even where it looks like a typo.
 */
export function statusLine(message: HttpResponse): string {
  return `${message.version} ${message.status} ${message.reason}`;
}

function fieldLines(headers: HeaderList): string[] {
  return headers.map((field) => `${field.name}: ${field.value}`);
}

function serialize(startLine: string, headers: HeaderList, body?: string): string {
  const head = [startLine, ...fieldLines(headers)].join(CRLF);
  // The lone CRLF that ends the header section, then the body immediately after it.
  return `${head}${CRLF}${CRLF}${body ?? ''}`;
}

/**
 * The exact bytes of an HTTP/1.1 request.
 *
 * A body is written immediately after the blank line with nothing between -- no extra
 * newline, no separator. The blank line *is* the separator.
 */
export function serializeRequest(message: HttpRequest): string {
  return serialize(requestLine(message), message.headers, message.body);
}

/** The exact bytes of an HTTP/1.1 response. */
export function serializeResponse(message: HttpResponse): string {
  return serialize(statusLine(message), message.headers, message.body);
}

/** Either direction, for callers holding an unnarrowed message. */
export function serializeMessage(message: HttpMessage): string {
  return isRequest(message) ? serializeRequest(message) : serializeResponse(message);
}

// ---------------------------------------------------------------------------
// Wire segments -- the wire view's model
// ---------------------------------------------------------------------------

/** What a line of the serialised message is. */
export type WireSegmentKind = 'start-line' | 'header' | 'blank' | 'body';

/**
 * One addressable piece of the wire form.
 *
 * `WireView` renders these rather than splitting a string, so every header line is a
 * focusable object that already knows its own name -- which is what lets
 * `HeaderExplainer` answer "what is this line for?" without re-parsing anything.
 */
export interface WireSegment {
  readonly kind: WireSegmentKind;
  /** The text of the line, without its terminator. */
  readonly text: string;
  /** Header segments only: the field name and value, split. */
  readonly name?: string;
  readonly value?: string;
  /** Whether this segment is followed by CRLF. The body is not. */
  readonly terminated: boolean;
  /** Byte offset of the segment's first byte within the whole message. */
  readonly offset: number;
  /** The segment's own length in bytes, excluding its terminator. */
  readonly length: number;
}

function segments(startLine: string, headers: HeaderList, body?: string): WireSegment[] {
  const out: WireSegment[] = [];
  let offset = 0;

  const push = (segment: Omit<WireSegment, 'offset' | 'length'>) => {
    const length = byteLength(segment.text);
    out.push({ ...segment, offset, length });
    offset += length + (segment.terminated ? CRLF.length : 0);
  };

  push({ kind: 'start-line', text: startLine, terminated: true });
  for (const field of headers) {
    push({
      kind: 'header',
      text: `${field.name}: ${field.value}`,
      name: field.name,
      value: field.value,
      terminated: true,
    });
  }
  // The empty line. It has no text of its own -- it is nothing but its terminator.
  push({ kind: 'blank', text: '', terminated: true });
  if (body !== undefined && body !== '') {
    push({ kind: 'body', text: body, terminated: false });
  }
  return out;
}

/** The wire form of a request, as addressable segments. */
export function requestWireSegments(message: HttpRequest): WireSegment[] {
  return segments(requestLine(message), message.headers, message.body);
}

/** The wire form of a response, as addressable segments. */
export function responseWireSegments(message: HttpResponse): WireSegment[] {
  return segments(statusLine(message), message.headers, message.body);
}

/** Either direction. */
export function wireSegments(message: HttpMessage): WireSegment[] {
  return isRequest(message)
    ? requestWireSegments(message)
    : responseWireSegments(message);
}

/** Total size of the serialised message in bytes, terminators included. */
export function wireSize(message: HttpMessage): number {
  return byteLength(serializeMessage(message));
}

// ---------------------------------------------------------------------------
// CRLF visibility
// ---------------------------------------------------------------------------

/** How the wire view renders line terminators. */
export type CrlfDisplay =
  /** Terminators are invisible, as in a terminal: what it looks like. */
  | 'hidden'
  /** `\r\n` written out before each break: what it *is*. */
  | 'escaped'
  /** The Unicode control pictures U+240D U+240A: readable and still one glyph each. */
  | 'symbols';

/** The marker each mode puts where a CR LF pair goes. */
const CRLF_MARKERS: Readonly<Record<CrlfDisplay, string>> = {
  hidden: '',
  escaped: '\\r\\n',
  symbols: '␍␊',
};

/**
 * Make the terminators visible.
 *
 * The toggle this backs is worth more than it looks: a learner who has seen
 * `Host: example.com\r\n` stops thinking of headers as a list and starts thinking of
 * them as bytes, which is the only frame in which chunked encoding, header injection,
 * and request smuggling make any sense at all.
 *
 * Only real CR LF pairs are marked. A bare LF inside a body is left alone, because it is
 * body content and not framing.
 */
export function showLineEndings(wire: string, display: CrlfDisplay): string {
  const marker = CRLF_MARKERS[display];
  return wire.split(CRLF).join(`${marker}\n`);
}
