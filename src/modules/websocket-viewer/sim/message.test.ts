import { describe, expect, it } from 'vitest';

import {
  appendHeader,
  byteLength,
  CRLF,
  defaultPort,
  describeVersion,
  fieldTokens,
  hasFieldToken,
  header,
  headerValue,
  headerValues,
  messageLines,
  parseRequest,
  parseTarget,
  removeHeader,
  renderMessage,
  request,
  response,
  setHeader,
  startLine,
  underlyingScheme,
  wireBytes,
} from './message';

describe('field lines', () => {
  const headers = [
    header('Host', 'chat.example.com'),
    header('Sec-WebSocket-Protocol', 'chat'),
    header('Sec-WebSocket-Protocol', 'superchat'),
  ];

  it('finds values case-insensitively, because field names are (RFC 9110 s 5.1)', () => {
    expect(headerValue(headers, 'host')).toBe('chat.example.com');
    expect(headerValue(headers, 'HOST')).toBe('chat.example.com');
  });

  it('keeps repeated lines in wire order', () => {
    expect(headerValues(headers, 'Sec-WebSocket-Protocol')).toEqual([
      'chat',
      'superchat',
    ]);
  });

  it('joins a repeated list field with ", " (RFC 9110 s 5.3)', () => {
    expect(headerValue(headers, 'Sec-WebSocket-Protocol')).toBe('chat, superchat');
  });

  it('returns undefined for a field that was never sent', () => {
    expect(headerValue(headers, 'Origin')).toBeUndefined();
  });

  it('replaces every line for a name but keeps the original position', () => {
    const updated = setHeader(headers, 'sec-websocket-protocol', 'chat');
    expect(headerValues(updated, 'Sec-WebSocket-Protocol')).toEqual(['chat']);
    expect(updated[1].name).toBe('sec-websocket-protocol');
  });

  it('appends without disturbing what is there', () => {
    const updated = appendHeader(headers, 'Origin', 'https://example.com');
    expect(updated).toHaveLength(4);
    expect(updated[3].value).toBe('https://example.com');
  });

  it('removes every line for a name', () => {
    expect(removeHeader(headers, 'Sec-WebSocket-Protocol')).toHaveLength(1);
  });
});

describe('fieldTokens', () => {
  /**
   * The single most common WebSocket server bug: comparing the whole `Connection` value to
   * the string "Upgrade". Browsers do not send that.
   */
  it('finds the Upgrade token inside a list, not just as the whole value', () => {
    const headers = [header('Connection', 'keep-alive, Upgrade')];
    expect(hasFieldToken(headers, 'Connection', 'upgrade')).toBe(true);
    expect(headerValue(headers, 'Connection')).not.toBe('Upgrade');
  });

  it('compares tokens case-insensitively (RFC 6455 s 4.2.1)', () => {
    expect(hasFieldToken([header('Upgrade', 'WebSocket')], 'Upgrade', 'websocket')).toBe(
      true,
    );
  });

  it('splits, trims and lower-cases', () => {
    expect(
      fieldTokens([header('Connection', ' Keep-Alive ,  UPGRADE ')], 'Connection'),
    ).toEqual(['keep-alive', 'upgrade']);
  });

  it('reads tokens spread across several field lines the same as one joined line', () => {
    const split = [header('Connection', 'keep-alive'), header('Connection', 'Upgrade')];
    expect(hasFieldToken(split, 'Connection', 'upgrade')).toBe(true);
  });

  it('is empty for an absent field rather than throwing', () => {
    expect(fieldTokens([], 'Connection')).toEqual([]);
  });
});

describe('the wire form', () => {
  const upgrade = request({
    target: '/chat',
    headers: [header('Host', 'chat.example.com'), header('Upgrade', 'websocket')],
  });

  it('writes a request line as "method target version"', () => {
    expect(startLine(upgrade)).toBe('GET /chat HTTP/1.1');
  });

  it('writes a status line, and trims a missing reason phrase', () => {
    expect(startLine(response({ status: 101, reason: 'Switching Protocols' }))).toBe(
      'HTTP/1.1 101 Switching Protocols',
    );
    expect(startLine(response({ status: 101 }))).toBe('HTTP/1.1 101');
  });

  it('terminates every line with CRLF and ends the header section with a blank line', () => {
    const rendered = renderMessage(upgrade);
    expect(rendered).toBe(
      `GET /chat HTTP/1.1${CRLF}Host: chat.example.com${CRLF}Upgrade: websocket${CRLF}${CRLF}`,
    );
    expect(rendered.endsWith(`${CRLF}${CRLF}`)).toBe(true);
  });

  it('gives the lines without terminators, for a panel that highlights one of them', () => {
    expect(messageLines(upgrade)).toEqual([
      'GET /chat HTTP/1.1',
      'Host: chat.example.com',
      'Upgrade: websocket',
    ]);
  });

  it('counts wire bytes exactly, CRLFs included', () => {
    // "GET /chat HTTP/1.1" is 18, "Host: chat.example.com" is 22, "Upgrade: websocket" is
    // 18; two bytes of CRLF after each, and two more for the blank line that ends the
    // header section.
    expect(wireBytes(upgrade)).toBe(18 + 2 + 22 + 2 + 18 + 2 + 2);
  });

  it('counts bytes and not characters', () => {
    expect(byteLength('é')).toBe(2);
    expect('é'.length).toBe(1);
  });
});

describe('parseRequest', () => {
  it('round-trips a rendered request', () => {
    const original = request({
      target: '/chat?room=lobby',
      headers: [
        header('Host', 'chat.example.com'),
        header('Sec-WebSocket-Version', '13'),
      ],
    });
    const parsed = parseRequest(renderMessage(original));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual(original);
  });

  it('accepts bare LF, because a reader typing into a textarea cannot produce CR', () => {
    const parsed = parseRequest('GET /chat HTTP/1.1\nHost: example.com\n\n');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(headerValue(parsed.value.headers, 'Host')).toBe('example.com');
  });

  it('refuses a request line that is not three parts', () => {
    expect(parseRequest('GET /chat').ok).toBe(false);
  });

  it('refuses a method it does not model', () => {
    const parsed = parseRequest('BREW /chat HTTP/1.1\n\n');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain('BREW');
  });

  it('refuses absolute-form: a handshake uses origin-form', () => {
    const parsed = parseRequest('GET http://example.com/chat HTTP/1.1\n\n');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain('origin-form');
  });

  it('stops reading fields at the blank line', () => {
    const parsed = parseRequest(
      'GET /chat HTTP/1.1\nHost: example.com\n\nnot-a: header\n',
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.headers).toHaveLength(1);
  });
});

describe('targets and schemes', () => {
  it('keeps the query, which is where browser clients are forced to put credentials', () => {
    expect(parseTarget('/chat?token=abc123')).toEqual({
      path: '/chat',
      query: 'token=abc123',
    });
  });

  it('drops the fragment, which never leaves the client (RFC 3986 s 3.5)', () => {
    expect(parseTarget('/chat#anything').path).toBe('/chat');
    expect(parseTarget('/chat#anything').query).toBe('');
  });

  it('defaults an empty target to "/"', () => {
    expect(parseTarget('').path).toBe('/');
  });

  it('uses the same ports HTTP does, which is the whole point', () => {
    expect(defaultPort('ws')).toBe(80);
    expect(defaultPort('wss')).toBe(443);
    expect(underlyingScheme('wss')).toBe('https');
  });
});

describe('describeVersion', () => {
  it('explains why 1.0 cannot upgrade and what HTTP/2 does instead', () => {
    expect(describeVersion('1.0')).toContain('1.1 or higher');
    expect(describeVersion('2')).toContain('8441');
  });
});
