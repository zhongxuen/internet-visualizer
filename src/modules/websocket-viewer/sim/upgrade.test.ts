import { describe, expect, it } from 'vitest';

import { header, headerValue, renderMessage } from './message';
import {
  buildClientHandshake,
  deriveAccept,
  explainKeyPurpose,
  explainOriginCheck,
  generateKey,
  handleUpgrade,
  handshakeCost,
  handshakeResource,
  handshakeSucceeded,
  inspectClientHandshake,
  inspectServerHandshake,
  KEY_BYTES,
  KEY_CHARS,
  offeredExtensions,
  offeredSubprotocols,
  selectExtensions,
  selectSubprotocol,
  upgradeTokens,
  validateKey,
  verifyAccept,
  WEBSOCKET_GUID,
  WEBSOCKET_VERSION,
} from './upgrade';

/**
 * RFC 6455 prints two complete handshakes with their accept values. They are the vectors
 * that make every other claim in this module checkable from outside: paste the key into any
 * other WebSocket implementation and it must produce the same string.
 */
const RFC_1_3 = {
  key: 'dGhlIHNhbXBsZSBub25jZQ==',
  accept: 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=',
};
const RFC_1_2 = {
  key: 'x3JJHMbDL1EzLkh9GBhXDw==',
  accept: 'HSmrc0sMlYUkAGmm5OPpG2HaGWk=',
};

describe('deriveAccept', () => {
  it('matches the worked example in RFC 6455 s 1.3', () => {
    expect(deriveAccept(RFC_1_3.key).accept).toBe(RFC_1_3.accept);
  });

  it('matches the second complete handshake in RFC 6455 s 1.2', () => {
    expect(deriveAccept(RFC_1_2.key).accept).toBe(RFC_1_2.accept);
  });

  it('prints the intermediate digest RFC 6455 s 1.3 spells out byte by byte', () => {
    expect(deriveAccept(RFC_1_3.key).digestHex).toBe(
      'b3 7a 4f 2c c0 62 4f 16 90 f6 46 06 cf 38 59 45 b2 be c4 ea',
    );
  });

  it('concatenates the key and the GUID with nothing between them', () => {
    const derivation = deriveAccept(RFC_1_3.key);
    expect(derivation.concatenated).toBe(`${RFC_1_3.key}${WEBSOCKET_GUID}`);
    expect(derivation.concatenated).toContain('==258EAFA5');
  });

  it('uses the key exactly as sent -- trimming it changes the answer', () => {
    expect(deriveAccept(` ${RFC_1_3.key}`).accept).not.toBe(RFC_1_3.accept);
  });

  it('always produces 28 characters ending in a single "="', () => {
    expect(deriveAccept(RFC_1_3.key).accept).toHaveLength(28);
    expect(deriveAccept(RFC_1_3.key).accept.endsWith('=')).toBe(true);
    expect(deriveAccept(RFC_1_3.key).accept.endsWith('==')).toBe(false);
  });

  it('exposes the computation as ordered, labelled steps', () => {
    const { steps } = deriveAccept(RFC_1_3.key);
    expect(steps.map((step) => step.id)).toEqual([
      'key',
      'guid',
      'concatenated',
      'sha1',
      'accept',
    ]);
    expect(steps[3].size).toBe(20);
    expect(steps[3].unit).toBe('bytes');
    expect(steps[4].value).toBe(RFC_1_3.accept);
    for (const step of steps) {
      expect(step.explain.length).toBeGreaterThan(40);
      expect(step.reference.rfc).toBe(6455);
    }
  });
});

describe('verifyAccept', () => {
  it('accepts the value derived from the key we sent', () => {
    expect(verifyAccept(RFC_1_3.key, RFC_1_3.accept)).toBe(true);
  });

  it('rejects the value derived from a different key', () => {
    expect(verifyAccept(RFC_1_3.key, RFC_1_2.accept)).toBe(false);
  });

  it('is exact: a stripped padding character fails', () => {
    expect(verifyAccept(RFC_1_3.key, RFC_1_3.accept.replace(/=$/, ''))).toBe(false);
  });
});

describe('validateKey', () => {
  it('accepts a key that decodes to exactly 16 bytes', () => {
    const result = validateKey(RFC_1_3.key);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(KEY_BYTES);
  });

  it('refuses a key of the wrong decoded length', () => {
    const result = validateKey('dGhlIHNhbXBsZQ==');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('16');
  });

  it('refuses base64url', () => {
    const result = validateKey('x3JJHMbDL1EzLkh9GBhXDw__');
    expect(result.ok).toBe(false);
  });

  it('refuses an empty key', () => {
    expect(validateKey('').ok).toBe(false);
  });
});

describe('generateKey', () => {
  it('produces a 24-character key that validates', () => {
    const key = generateKey('handshake-and-chat');
    expect(key).toHaveLength(KEY_CHARS);
    expect(validateKey(key).ok).toBe(true);
  });

  it('is deterministic, so a scenario replays identically', () => {
    expect(generateKey('a')).toBe(generateKey('a'));
    expect(generateKey('a')).not.toBe(generateKey('b'));
  });
});

describe('buildClientHandshake', () => {
  const request = buildClientHandshake({
    resource: '/chat',
    host: 'chat.example.com',
    key: RFC_1_3.key,
    origin: 'https://example.com',
    subprotocols: ['chat', 'superchat'],
  });

  it('is an ordinary HTTP/1.1 GET', () => {
    expect(request.method).toBe('GET');
    expect(request.version).toBe('1.1');
    expect(renderMessage(request).startsWith('GET /chat HTTP/1.1\r\n')).toBe(true);
  });

  it('carries the five required fields in the order RFC 6455 s 1.2 prints them', () => {
    expect(request.headers.slice(0, 5).map((field) => field.name)).toEqual([
      'Host',
      'Upgrade',
      'Connection',
      'Sec-WebSocket-Key',
      'Sec-WebSocket-Version',
    ]);
  });

  it('claims version 13', () => {
    expect(headerValue(request.headers, 'Sec-WebSocket-Version')).toBe(
      `${WEBSOCKET_VERSION}`,
    );
  });

  it('joins offered subprotocols into one field line', () => {
    expect(headerValue(request.headers, 'Sec-WebSocket-Protocol')).toBe(
      'chat, superchat',
    );
  });

  it('omits Origin for a non-browser client', () => {
    const bare = buildClientHandshake({
      resource: '/chat',
      host: 'chat.example.com',
      key: RFC_1_3.key,
    });
    expect(headerValue(bare.headers, 'Origin')).toBeUndefined();
  });
});

describe('handleUpgrade', () => {
  const good = buildClientHandshake({
    resource: '/chat',
    host: 'chat.example.com',
    key: RFC_1_3.key,
  });

  it('answers 101 with the derived accept value', () => {
    const outcome = handleUpgrade(good);
    expect(outcome.kind).toBe('accepted');
    expect(outcome.response.status).toBe(101);
    expect(outcome.response.reason).toBe('Switching Protocols');
    expect(headerValue(outcome.response.headers, 'Sec-WebSocket-Accept')).toBe(
      RFC_1_3.accept,
    );
  });

  it('sends no body and no Content-Length on the 101', () => {
    const outcome = handleUpgrade(good);
    expect(outcome.response.body).toBeUndefined();
    expect(headerValue(outcome.response.headers, 'Content-Length')).toBeUndefined();
  });

  it('accepts "Connection: keep-alive, Upgrade" the way every browser sends it', () => {
    const browserish = buildClientHandshake({
      resource: '/chat',
      host: 'chat.example.com',
      key: RFC_1_3.key,
    });
    const withList = {
      ...browserish,
      headers: browserish.headers.map((field) =>
        field.name === 'Connection' ? header('Connection', 'keep-alive, Upgrade') : field,
      ),
    };
    expect(handleUpgrade(withList).kind).toBe('accepted');
  });

  it('accepts "Upgrade: WebSocket" -- the token is case-insensitive', () => {
    const mixedCase = {
      ...good,
      headers: good.headers.map((field) =>
        field.name === 'Upgrade' ? header('Upgrade', 'WebSocket') : field,
      ),
    };
    expect(handleUpgrade(mixedCase).kind).toBe('accepted');
  });

  it('refuses a POST with an ordinary 400, because the connection never switched', () => {
    const outcome = handleUpgrade({ ...good, method: 'POST' });
    expect(outcome.kind).toBe('rejected');
    expect(outcome.response.status).toBe(400);
    if (outcome.kind === 'rejected') expect(outcome.reason).toContain('GET');
  });

  it('refuses HTTP/1.0', () => {
    const outcome = handleUpgrade({ ...good, version: '1.0' });
    expect(outcome.kind).toBe('rejected');
    expect(outcome.response.status).toBe(400);
  });

  it('refuses a key of the wrong length', () => {
    const bad = buildClientHandshake({
      resource: '/chat',
      host: 'chat.example.com',
      key: 'c2hvcnQ=',
    });
    expect(handleUpgrade(bad).kind).toBe('rejected');
  });

  it('answers an unsupported version with 426 and its own version list', () => {
    const old = buildClientHandshake({
      resource: '/chat',
      host: 'chat.example.com',
      key: RFC_1_3.key,
      version: 8,
    });
    const outcome = handleUpgrade(old);
    expect(outcome.kind).toBe('rejected');
    expect(outcome.response.status).toBe(426);
    expect(headerValue(outcome.response.headers, 'Sec-WebSocket-Version')).toBe('13');
  });

  it('refuses an Origin the policy does not list, with 403', () => {
    const evil = buildClientHandshake({
      resource: '/chat',
      host: 'chat.example.com',
      key: RFC_1_3.key,
      origin: 'https://evil.example',
    });
    const outcome = handleUpgrade(evil, { allowedOrigins: ['https://example.com'] });
    expect(outcome.kind).toBe('rejected');
    expect(outcome.response.status).toBe(403);
  });

  it('does not check Origin when no policy is given -- and the check row says so', () => {
    const evil = buildClientHandshake({
      resource: '/chat',
      host: 'chat.example.com',
      key: RFC_1_3.key,
      origin: 'https://evil.example',
    });
    const outcome = handleUpgrade(evil);
    expect(outcome.kind).toBe('accepted');
    const origin = outcome.checks.find((entry) => entry.id === 'origin');
    expect(origin?.requirement).toBe('SHOULD');
    expect(origin?.detail).toContain('same-origin policy does not apply');
  });

  it('picks the subprotocol by the server’s preference, not the client’s', () => {
    const request = buildClientHandshake({
      resource: '/chat',
      host: 'chat.example.com',
      key: RFC_1_3.key,
      subprotocols: ['chat', 'superchat'],
    });
    const outcome = handleUpgrade(request, { subprotocols: ['superchat', 'chat'] });
    expect(outcome.kind).toBe('accepted');
    if (outcome.kind === 'accepted') expect(outcome.subprotocol).toBe('superchat');
  });

  it('succeeds with no subprotocol when nothing overlaps', () => {
    const request = buildClientHandshake({
      resource: '/chat',
      host: 'chat.example.com',
      key: RFC_1_3.key,
      subprotocols: ['chat'],
    });
    const outcome = handleUpgrade(request, { subprotocols: ['graphql-ws'] });
    expect(outcome.kind).toBe('accepted');
    if (outcome.kind === 'accepted') expect(outcome.subprotocol).toBeUndefined();
    expect(
      headerValue(outcome.response.headers, 'Sec-WebSocket-Protocol'),
    ).toBeUndefined();
  });

  it('grants only extensions that were offered', () => {
    const request = buildClientHandshake({
      resource: '/chat',
      host: 'chat.example.com',
      key: RFC_1_3.key,
      extensions: ['permessage-deflate; client_max_window_bits'],
    });
    const outcome = handleUpgrade(request, {
      extensions: ['permessage-deflate', 'x-not-offered'],
    });
    expect(outcome.kind).toBe('accepted');
    if (outcome.kind === 'accepted') {
      expect(outcome.extensions.map((entry) => entry.name)).toEqual([
        'permessage-deflate',
      ]);
    }
  });

  it('returns every check, passing ones included', () => {
    const outcome = handleUpgrade(good);
    expect(outcome.checks.length).toBeGreaterThanOrEqual(8);
    expect(outcome.checks.every((entry) => entry.detail.length > 40)).toBe(true);
  });
});

describe('inspectClientHandshake', () => {
  it('marks a missing Connection token as a failed MUST', () => {
    const request = buildClientHandshake({
      resource: '/chat',
      host: 'chat.example.com',
      key: RFC_1_3.key,
    });
    const broken = {
      ...request,
      headers: request.headers.filter((field) => field.name !== 'Connection'),
    };
    const checks = inspectClientHandshake(broken);
    const connection = checks.find((entry) => entry.id === 'connection');
    expect(connection?.passed).toBe(false);
    expect(connection?.requirement).toBe('MUST');
    expect(handshakeSucceeded(checks)).toBe(false);
  });

  it('makes only the Origin check a SHOULD', () => {
    const request = buildClientHandshake({
      resource: '/chat',
      host: 'chat.example.com',
      key: RFC_1_3.key,
    });
    const shoulds = inspectClientHandshake(request).filter(
      (entry) => entry.requirement === 'SHOULD',
    );
    expect(shoulds.map((entry) => entry.id)).toEqual(['origin']);
  });
});

describe('inspectServerHandshake', () => {
  const request = buildClientHandshake({
    resource: '/chat',
    host: 'chat.example.com',
    key: RFC_1_3.key,
    subprotocols: ['chat'],
  });
  const outcome = handleUpgrade(request, { subprotocols: ['chat'] });

  it('passes every MUST on a correct 101', () => {
    const checks = inspectServerHandshake(outcome.response, {
      key: RFC_1_3.key,
      subprotocols: ['chat'],
    });
    expect(handshakeSucceeded(checks)).toBe(true);
  });

  it('fails when the accept value answers a different key', () => {
    const checks = inspectServerHandshake(outcome.response, { key: RFC_1_2.key });
    const accept = checks.find((entry) => entry.id === 'accept');
    expect(accept?.passed).toBe(false);
    expect(accept?.detail).toContain(deriveAccept(RFC_1_2.key).accept);
  });

  it('fails when the server names a subprotocol the client never offered', () => {
    const checks = inspectServerHandshake(outcome.response, {
      key: RFC_1_3.key,
      subprotocols: ['something-else'],
    });
    expect(checks.find((entry) => entry.id === 'subprotocol')?.passed).toBe(false);
  });

  it('fails on any status other than 101', () => {
    const rejected = handleUpgrade({ ...request, method: 'POST' });
    const checks = inspectServerHandshake(rejected.response, { key: RFC_1_3.key });
    expect(checks.find((entry) => entry.id === 'status')?.passed).toBe(false);
  });
});

describe('cost and resource', () => {
  const request = buildClientHandshake({
    resource: '/chat?token=secret123',
    host: 'chat.example.com',
    key: RFC_1_3.key,
    origin: 'https://example.com',
  });
  const outcome = handleUpgrade(request);

  it('charges exactly one request for the whole upgrade', () => {
    expect(handshakeCost(request, outcome.response).requests).toBe(1);
  });

  it('counts the exact rendered bytes of both messages', () => {
    const cost = handshakeCost(request, outcome.response);
    expect(cost.requestBytes).toBe(renderMessage(request).length);
    expect(cost.totalBytes).toBe(cost.requestBytes + cost.responseBytes);
    // Larger than a bare GET, because of the four Sec-WebSocket-* fields.
    expect(cost.requestBytes).toBeGreaterThan(150);
  });

  it('notices a credential smuggled into the query string', () => {
    const resource = handshakeResource(request);
    expect(resource.path).toBe('/chat');
    expect(resource.credentialInQuery).toBe(true);
  });

  it('lists the Connection and Upgrade tokens for the panel', () => {
    expect(upgradeTokens(request.headers)).toEqual({
      connection: ['upgrade'],
      upgrade: ['websocket'],
    });
  });
});

describe('negotiation helpers', () => {
  it('reads subprotocols from several field lines as one set', () => {
    expect(
      offeredSubprotocols([
        header('Sec-WebSocket-Protocol', 'chat'),
        header('Sec-WebSocket-Protocol', 'superchat, graphql-ws'),
      ]),
    ).toEqual(['chat', 'superchat', 'graphql-ws']);
  });

  it('returns nothing when the server supports nothing', () => {
    expect(selectSubprotocol(['chat'], undefined)).toBeUndefined();
    expect(selectSubprotocol(['chat'], [])).toBeUndefined();
  });

  it('parses extension offers into a name and its parameters', () => {
    const offers = offeredExtensions([
      header(
        'Sec-WebSocket-Extensions',
        'permessage-deflate; client_max_window_bits=10, x-custom',
      ),
    ]);
    expect(offers.map((offer) => offer.name)).toEqual(['permessage-deflate', 'x-custom']);
    expect(offers[0].params).toEqual(['client_max_window_bits=10']);
  });

  it('never grants an extension that was not offered', () => {
    const offers = offeredExtensions([
      header('Sec-WebSocket-Extensions', 'permessage-deflate'),
    ]);
    expect(selectExtensions(offers, ['x-other'])).toEqual([]);
  });
});

describe('the explanations', () => {
  it('says the key proves comprehension rather than identity', () => {
    expect(explainKeyPurpose().detail).toContain('authenticates nobody');
    expect(explainKeyPurpose().detail).toContain('Sec- prefix');
  });

  it('says CORS does not protect a WebSocket', () => {
    const note = explainOriginCheck();
    expect(note.detail).toContain('No CORS');
    expect(note.detail).toContain('cookies');
  });
});
