import { describe, expect, it } from 'vitest';

import {
  appendHeader,
  approximateWireBytes,
  buildQuery,
  byteLength,
  hasHeader,
  header,
  headerValue,
  headerValues,
  HTTP_METHODS,
  isHttpMethod,
  jsonResponse,
  jsonText,
  normalizeFieldName,
  parseJson,
  parseTarget,
  queryParam,
  redactHeaderValue,
  removeHeader,
  request,
  response,
  setHeader,
  withJsonBody,
  withQuery,
} from './message';

describe('methods', () => {
  it('omits CONNECT and TRACE, which no API assigns a resource meaning', () => {
    expect(HTTP_METHODS).not.toContain('CONNECT');
    expect(HTTP_METHODS).not.toContain('TRACE');
    expect(HTTP_METHODS).toContain('PATCH');
  });

  it('is case-sensitive, so "get" is not a GET', () => {
    expect(isHttpMethod('GET')).toBe(true);
    expect(isHttpMethod('get')).toBe(false);
  });
});

describe('field lines', () => {
  const headers = [
    header('Accept', 'application/json'),
    header('Link', '</a>; rel="next"'),
  ];

  it('compares names case-insensitively and keeps the casing as written', () => {
    expect(normalizeFieldName('  Content-Type ')).toBe('content-type');
    expect(headerValue(headers, 'accept')).toBe('application/json');
    expect(headers[0].name).toBe('Accept');
  });

  it('keeps duplicates as separate lines', () => {
    const twice = appendHeader(headers, 'Link', '</b>; rel="prev"');
    expect(headerValues(twice, 'Link')).toHaveLength(2);
  });

  it('joins repeated list-valued fields when asked for one value', () => {
    const twice = appendHeader(headers, 'Link', '</b>; rel="prev"');
    expect(headerValue(twice, 'Link')).toBe('</a>; rel="next", </b>; rel="prev"');
  });

  it('replaces every line for a name while keeping its position', () => {
    const replaced = setHeader(
      appendHeader(headers, 'Accept', 'text/html'),
      'Accept',
      'text/csv',
    );
    expect(headerValues(replaced, 'Accept')).toEqual(['text/csv']);
    expect(replaced[0].name).toBe('Accept');
  });

  it('appends a name that was not there', () => {
    expect(headerValue(setHeader([], 'X-Trace', 'abc'), 'X-Trace')).toBe('abc');
  });

  it('removes every line for a name', () => {
    expect(hasHeader(removeHeader(headers, 'link'), 'Link')).toBe(false);
  });

  it('redacts a credential while keeping enough to identify it', () => {
    const redacted = redactHeaderValue('sk_live_9f2c8a1b4d6e', 8);
    expect(redacted).toBe('sk_live_...(12 more)');
    expect(redactHeaderValue('short')).toBe('short');
  });
});

describe('targets and queries', () => {
  it('splits a path from its query', () => {
    const target = parseTarget('/articles?limit=3&offset=6');
    expect(target.path).toBe('/articles');
    expect(queryParam(target, 'limit')).toBe('3');
  });

  it('drops the fragment, which never leaves the client', () => {
    expect(parseTarget('/articles#section').path).toBe('/articles');
    expect(parseTarget('/articles#section').query).toBe('');
  });

  it('keeps repeated keys as separate pairs', () => {
    expect(parseTarget('/a?tag=x&tag=y').params).toEqual([
      ['tag', 'x'],
      ['tag', 'y'],
    ]);
  });

  it('decodes percent-encoding and "+" as a space', () => {
    expect(queryParam(parseTarget('/a?q=hello+world%21'), 'q')).toBe('hello world!');
  });

  it('encodes reserved characters, so a value cannot become two parameters', () => {
    expect(buildQuery([['redirect_uri', 'https://app.example.com/cb?a=1&b=2']])).toBe(
      'redirect_uri=https%3A%2F%2Fapp.example.com%2Fcb%3Fa%3D1%26b%3D2',
    );
  });

  it('round-trips a value containing separators', () => {
    const built = withQuery('/authorize', [['state', 'a&b=c']]);
    expect(queryParam(parseTarget(built), 'state')).toBe('a&b=c');
  });

  it('omits the "?" when there are no parameters', () => {
    expect(withQuery('/articles', [])).toBe('/articles');
  });

  it('survives a stray percent rather than throwing', () => {
    expect(queryParam(parseTarget('/a?q=100%'), 'q')).toBe('100%');
  });
});

describe('JSON bodies', () => {
  it('sets the body, its media type, and a matching length', () => {
    const message = withJsonBody(request({ method: 'POST', target: '/a' }), { a: 1 });
    expect(headerValue(message.headers, 'Content-Type')).toBe('application/json');
    expect(Number(headerValue(message.headers, 'Content-Length'))).toBe(
      byteLength(message.body ?? ''),
    );
  });

  it('sends no charset parameter: RFC 8259 fixes JSON as UTF-8', () => {
    const message = withJsonBody(request({ method: 'POST', target: '/a' }), { a: 1 });
    expect(headerValue(message.headers, 'Content-Type')).not.toContain('charset');
  });

  it('preserves key order, so the output is deterministic', () => {
    expect(jsonText({ z: 1, a: 2 })).toBe('{\n  "z": 1,\n  "a": 2\n}');
  });

  it('reports a parse failure rather than throwing', () => {
    expect(parseJson('{oops').ok).toBe(false);
    expect(parseJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });

  it('builds a JSON response in one call', () => {
    const result = jsonResponse({ status: 200, reason: 'OK', body: { ok: true } });
    expect(result.status).toBe(200);
    expect(result.body).toContain('"ok": true');
  });
});

describe('sizes', () => {
  it('counts bytes, not characters', () => {
    expect(byteLength('cafe')).toBe(4);
    expect(byteLength('café')).toBe(5);
    expect('café'.length).toBe(4);
  });

  it('counts a whole message including its field lines', () => {
    const message = response({
      status: 200,
      reason: 'OK',
      headers: [header('Content-Type', 'application/json')],
      body: '{}',
    });
    // "HTTP/1.1 200 OK\r\n" + "Content-Type: application/json\r\n" + "\r\n" + "{}"
    expect(approximateWireBytes(message)).toBe(17 + 32 + 2 + 2);
  });
});
