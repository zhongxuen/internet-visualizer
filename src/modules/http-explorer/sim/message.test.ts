import { describe, expect, it } from 'vitest';

import {
  byteLength,
  CRLF,
  dateHeaderAt,
  EPOCH_CLOCK,
  formatHttpDate,
  hasHeader,
  hasTextWireFormat,
  header,
  headerValue,
  headerValues,
  isHttpMethod,
  isValidFieldName,
  isValidFieldValue,
  parseFieldLine,
  parseHttpDate,
  parseTarget,
  pickHeaders,
  removeHeader,
  request,
  requestWireSegments,
  response,
  responseWireSegments,
  serializeRequest,
  serializeResponse,
  setHeader,
  showLineEndings,
  statusLine,
  toEpoch,
  toVirtual,
  withContentLength,
  wireSize,
} from './message';

const GET = request({
  method: 'GET',
  target: '/index.html',
  headers: [header('Host', 'example.com'), header('Accept', 'text/html')],
});

describe('HTTP/1.1 wire serialization', () => {
  it('is byte-accurate, with CRLF terminators and a blank line ending the headers', () => {
    expect(serializeRequest(GET)).toBe(
      'GET /index.html HTTP/1.1\r\n' +
        'Host: example.com\r\n' +
        'Accept: text/html\r\n' +
        '\r\n',
    );
  });

  it('ends a bodyless message with the blank line and nothing after it', () => {
    const wire = serializeRequest(GET);
    expect(wire.endsWith(`${CRLF}${CRLF}`)).toBe(true);
    expect(wire).not.toContain('\n\n');
  });

  it('puts the body immediately after the blank line, with no separator of its own', () => {
    const post = withContentLength(
      request({
        method: 'POST',
        target: '/login',
        headers: [header('Host', 'example.com')],
        body: 'user=ada&password=lovelace',
      }),
    );

    expect(serializeRequest(post)).toBe(
      'POST /login HTTP/1.1\r\n' +
        'Host: example.com\r\n' +
        'Content-Length: 26\r\n' +
        '\r\n' +
        'user=ada&password=lovelace',
    );
  });

  it('serializes a response start-line as version, code, reason', () => {
    const notFound = response({ status: 404, reason: 'Not Found' });
    expect(serializeResponse(notFound)).toBe('HTTP/1.1 404 Not Found\r\n\r\n');
  });

  it('keeps the space before an empty reason-phrase, because the grammar requires it', () => {
    expect(statusLine(response({ status: 200 }))).toBe('HTTP/1.1 200 ');
  });

  it('preserves duplicate fields verbatim -- Set-Cookie is never combined', () => {
    const withCookies = response({
      status: 200,
      reason: 'OK',
      headers: [
        header('Set-Cookie', 'session=abc; HttpOnly'),
        header('Set-Cookie', 'theme=dark'),
      ],
    });

    expect(serializeResponse(withCookies)).toContain(
      'Set-Cookie: session=abc; HttpOnly\r\nSet-Cookie: theme=dark\r\n',
    );
    expect(headerValues(withCookies.headers, 'set-cookie')).toEqual([
      'session=abc; HttpOnly',
      'theme=dark',
    ]);
  });

  it('only claims a text wire format for HTTP/1.1', () => {
    expect(hasTextWireFormat('HTTP/1.1')).toBe(true);
    expect(hasTextWireFormat('HTTP/2')).toBe(false);
    expect(hasTextWireFormat('HTTP/3')).toBe(false);
  });
});

describe('field lines', () => {
  it('compares names case-insensitively and stores them as written', () => {
    expect(headerValue(GET.headers, 'HOST')).toBe('example.com');
    expect(hasHeader(GET.headers, 'host')).toBe(true);
    expect(GET.headers[0].name).toBe('Host');
  });

  it('joins repeated fields with ", " for the combined value', () => {
    const headers = [header('Accept-Encoding', 'gzip'), header('accept-encoding', 'br')];
    expect(headerValue(headers, 'Accept-Encoding')).toBe('gzip, br');
    expect(headerValues(headers, 'Accept-Encoding')).toEqual(['gzip', 'br']);
  });

  it('returns undefined rather than an empty string for an absent field', () => {
    expect(headerValue(GET.headers, 'Cookie')).toBeUndefined();
  });

  it('replaces every line for a name in place, keeping the original position', () => {
    const headers = [header('A', '1'), header('B', '2'), header('a', '3')];
    expect(setHeader(headers, 'A', '9')).toEqual([header('A', '9'), header('B', '2')]);
  });

  it('appends a field that was not there', () => {
    expect(setHeader([header('A', '1')], 'B', '2')).toEqual([
      header('A', '1'),
      header('B', '2'),
    ]);
  });

  it('removes and picks by name', () => {
    const headers = [header('A', '1'), header('B', '2'), header('C', '3')];
    expect(removeHeader(headers, 'b')).toEqual([header('A', '1'), header('C', '3')]);
    expect(pickHeaders(headers, ['c', 'a'])).toEqual([
      header('A', '1'),
      header('C', '3'),
    ]);
  });

  it('accepts token characters in a field name and rejects anything else', () => {
    expect(isValidFieldName('X-Request-Id')).toBe(true);
    expect(isValidFieldName('Accept')).toBe(true);
    expect(isValidFieldName('Bad Header')).toBe(false);
    expect(isValidFieldName('')).toBe(false);
  });

  it('rejects CR, LF, and NUL in a field value -- the response-splitting vector', () => {
    expect(isValidFieldValue('text/html')).toBe(true);
    expect(isValidFieldValue('a\r\nX-Injected: yes')).toBe(false);
    expect(isValidFieldValue('a\nb')).toBe(false);
    expect(isValidFieldValue('a\0b')).toBe(false);
  });

  it('parses a field line and strips only the optional whitespace after the colon', () => {
    expect(parseFieldLine('Host:   example.com  ')).toEqual({
      ok: true,
      value: header('Host', 'example.com'),
    });
  });

  it('rejects whitespace before the colon rather than repairing it', () => {
    const result = parseFieldLine('Host : example.com');
    expect(result.ok).toBe(false);
  });

  it('rejects a line with no colon at all', () => {
    expect(parseFieldLine('not a header').ok).toBe(false);
    expect(parseFieldLine(': novalue').ok).toBe(false);
  });
});

describe('bodies', () => {
  it('counts Content-Length in bytes, not characters', () => {
    expect(byteLength('cafe')).toBe(4);
    expect(byteLength('café')).toBe(5);
    expect(byteLength('\u{1f512}')).toBe(4);
  });

  it('sets Content-Length from the body it actually carries', () => {
    const message = withContentLength(
      response({ status: 200, reason: 'OK', body: 'café' }),
    );
    expect(headerValue(message.headers, 'Content-Length')).toBe('5');
  });

  it('sets Content-Length to 0 when there is no body', () => {
    const message = withContentLength(response({ status: 204, reason: 'No Content' }));
    expect(headerValue(message.headers, 'Content-Length')).toBe('0');
  });
});

describe('request targets', () => {
  it('splits path and query', () => {
    expect(parseTarget('/search?q=http&p=2')).toEqual({
      path: '/search',
      query: 'q=http&p=2',
    });
  });

  it('drops the fragment, which never leaves the client', () => {
    expect(parseTarget('/docs/page#section-3')).toEqual({
      path: '/docs/page',
      query: '',
    });
    expect(parseTarget('/docs?a=1#top')).toEqual({ path: '/docs', query: 'a=1' });
  });

  it('normalises an empty path to /', () => {
    expect(parseTarget('?a=1').path).toBe('/');
  });
});

describe('HTTP dates', () => {
  const EPOCH = Date.UTC(1994, 10, 6, 8, 49, 37);

  it('formats an IMF-fixdate', () => {
    expect(formatHttpDate(EPOCH)).toBe('Sun, 06 Nov 1994 08:49:37 GMT');
  });

  it('round-trips', () => {
    const parsed = parseHttpDate(formatHttpDate(EPOCH));
    expect(parsed).toEqual({ ok: true, value: EPOCH });
  });

  it('also accepts the two obsolete formats, which mean the same instant', () => {
    expect(parseHttpDate('Sunday, 06-Nov-94 08:49:37 GMT')).toEqual({
      ok: true,
      value: EPOCH,
    });
    expect(parseHttpDate('Sun Nov  6 08:49:37 1994')).toEqual({ ok: true, value: EPOCH });
  });

  it('rejects a malformed date and an out-of-range day', () => {
    expect(parseHttpDate('yesterday').ok).toBe(false);
    expect(parseHttpDate('Sun, 32 Nov 1994 08:49:37 GMT').ok).toBe(false);
    expect(parseHttpDate('Sun, 06 Foo 1994 08:49:37 GMT').ok).toBe(false);
  });

  it('converts between epoch and virtual time through the clock', () => {
    const clock = { origin: EPOCH };
    expect(toVirtual(clock, EPOCH + 5000)).toBe(5000);
    expect(toEpoch(clock, 5000)).toBe(EPOCH + 5000);
    expect(toVirtual(EPOCH_CLOCK, 5000)).toBe(5000);
  });

  it('reads a date field as a virtual millisecond', () => {
    const clock = { origin: EPOCH };
    const headers = [header('Date', formatHttpDate(EPOCH + 60_000))];
    expect(dateHeaderAt(headers, 'Date', clock)).toBe(60_000);
  });

  it('returns undefined for an absent or unparseable date field', () => {
    expect(dateHeaderAt([], 'Date', EPOCH_CLOCK)).toBeUndefined();
    expect(dateHeaderAt([header('Date', 'soon')], 'Date', EPOCH_CLOCK)).toBeUndefined();
  });
});

describe('wire segments', () => {
  const simple = request({
    method: 'GET',
    target: '/',
    headers: [header('Host', 'a')],
  });

  it('names every line and always includes the blank one', () => {
    expect(requestWireSegments(simple).map((segment) => segment.kind)).toEqual([
      'start-line',
      'header',
      'blank',
    ]);
  });

  it('gives each header segment its split name and value, for per-header focus', () => {
    const [, hostLine] = requestWireSegments(simple);
    expect(hostLine).toMatchObject({ name: 'Host', value: 'a', text: 'Host: a' });
  });

  it('records byte offsets that account for the CRLF terminators', () => {
    const [start, host, blank] = requestWireSegments(simple);
    expect(start).toMatchObject({ offset: 0, length: 14 });
    expect(host).toMatchObject({ offset: 16, length: 7 });
    expect(blank).toMatchObject({ offset: 25, length: 0, terminated: true });
    expect(wireSize(simple)).toBe(27);
  });

  it('adds an unterminated body segment after the blank line', () => {
    const withBody = response({ status: 200, reason: 'OK', body: 'hi' });
    const segments = responseWireSegments(withBody);
    expect(segments.at(-1)).toMatchObject({
      kind: 'body',
      text: 'hi',
      terminated: false,
    });
  });

  it('offsets index into the serialized bytes', () => {
    const wire = serializeRequest(simple);
    const [, host] = requestWireSegments(simple);
    expect(wire.slice(host.offset, host.offset + host.length)).toBe('Host: a');
  });
});

describe('the CRLF toggle', () => {
  const wire = serializeRequest(request({ method: 'GET', target: '/', headers: [] }));

  it('hides terminators, which is what a terminal shows', () => {
    expect(showLineEndings(wire, 'hidden')).toBe('GET / HTTP/1.1\n\n');
  });

  it('writes them out, which is what is actually on the wire', () => {
    expect(showLineEndings(wire, 'escaped')).toBe('GET / HTTP/1.1\\r\\n\n\\r\\n\n');
  });

  it('can use the Unicode control pictures instead', () => {
    expect(showLineEndings(wire, 'symbols')).toBe('GET / HTTP/1.1␍␊\n␍␊\n');
  });

  it('leaves a bare LF inside a body alone -- that is content, not framing', () => {
    const withBody = serializeResponse(
      response({ status: 200, reason: 'OK', body: 'one\ntwo' }),
    );
    expect(showLineEndings(withBody, 'escaped')).toContain('one\ntwo');
  });
});

describe('methods', () => {
  it('recognises the registered methods and is case-sensitive about it', () => {
    expect(isHttpMethod('GET')).toBe(true);
    expect(isHttpMethod('PATCH')).toBe(true);
    expect(isHttpMethod('get')).toBe(false);
    expect(isHttpMethod('FETCH')).toBe(false);
  });
});
