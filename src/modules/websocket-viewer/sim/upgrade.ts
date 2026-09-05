/**
 * The opening handshake -- an ordinary HTTP request that stops being HTTP.
 *
 * This is the file that explains why WebSockets exist in the form they do. A persistent
 * bidirectional connection between a browser and a server is not technically hard; what is
 * hard is getting one through the corporate proxy, the load balancer, the CDN, and the
 * firewall that all sit between them and all understand exactly one protocol. So RFC 6455
 * does not invent a new port or a new transport. It opens with a `GET`, on port 80 or 443,
 * with a `Host` and an `Origin` and everything else an HTTP request has -- and only once the
 * server has answered `101 Switching Protocols` does the same TCP connection stop carrying
 * HTTP and start carrying frames.
 *
 * Everything about the handshake follows from that decision:
 *
 * - it is a `GET`, because a `GET` is the request every intermediary is sure it understands;
 * - it uses `Upgrade` and `Connection`, the mechanism HTTP/1.1 already had for exactly this;
 * - it carries `Sec-WebSocket-Key` and gets back `Sec-WebSocket-Accept`, which exist to
 *   prove that the responder *understood the handshake* rather than being some HTTP server
 *   that answered `101` for reasons of its own (see {@link explainKeyPurpose});
 * - the `Sec-` prefix on those field names is not decoration -- see the same note;
 * - and it dies at HTTP/2, which has no connection-wide upgrade to perform. RFC 8441 brings
 *   WebSockets back over an extended `CONNECT` on a single stream, with identical framing
 *   after the handshake.
 *
 * ## Where the boundary is
 *
 * Precisely at the CRLF CRLF that ends the `101` response's header section. The next byte on
 * that socket is the first byte of a frame header, read by `frames.ts` and never again by an
 * HTTP parser. `message.ts` renders both messages in their exact wire form so that boundary
 * is a thing a reader can point at.
 *
 * ## What this file does not do
 *
 * Draw anything, and open anything. Every function here is a pure function of its arguments;
 * `exchange.ts` turns the results into a timeline, and there is no socket anywhere in this
 * module. See the module README.
 */

import { createRng } from '@/core/sim/rng';
import { fail, ok, type ParseResult } from '@/core/net/result';
import type { RfcRef } from '@/core/types/events';

import { base64Decode, base64Encode, sha1Text, toSpacedHex, utf8Bytes } from './digest';
import {
  appendHeader,
  fieldTokens,
  hasFieldToken,
  hasHeader,
  header,
  headerValue,
  headerValues,
  request as makeRequest,
  parseTarget,
  response as makeResponse,
  wireBytes,
  type HeaderList,
  type HttpRequest,
  type HttpResponse,
} from './message';

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

const RFC_6455: RfcRef = { rfc: 6455, title: 'The WebSocket Protocol' };

/** The worked example of the accept derivation. */
export const RFC_6455_OPENING: RfcRef = { ...RFC_6455, section: '1.3' };
/** What a client must put in the request. */
export const RFC_6455_CLIENT: RfcRef = { ...RFC_6455, section: '4.1' };
/** What a server must check, and what it must answer. */
export const RFC_6455_SERVER: RfcRef = { ...RFC_6455, section: '4.2.2' };
/** The definition of each `Sec-WebSocket-*` field. */
export const RFC_6455_FIELDS: RfcRef = { ...RFC_6455, section: '11.3' };
/** Origin considerations -- the section behind the cross-site note. */
export const RFC_6455_ORIGIN: RfcRef = { ...RFC_6455, section: '10.2' };

/** The `Upgrade` field itself, which predates WebSockets by a decade. */
export const RFC_9110_UPGRADE: RfcRef = {
  rfc: 9110,
  section: '7.8',
  title: 'HTTP Semantics',
};
/** `101 Switching Protocols`. */
export const RFC_9110_101: RfcRef = {
  rfc: 9110,
  section: '15.2.2',
  title: 'HTTP Semantics',
};
/** `426 Upgrade Required`. */
export const RFC_9110_426: RfcRef = {
  rfc: 9110,
  section: '15.5.22',
  title: 'HTTP Semantics',
};

// ---------------------------------------------------------------------------
// The constants of the handshake
// ---------------------------------------------------------------------------

/**
 * The fixed GUID every WebSocket server concatenates to the client's key.
 *
 * RFC 6455 s 1.3 chose it, in its own words, because it is "unlikely to be used by network
 * endpoints that do not understand the WebSocket Protocol". That is the entire specification
 * of its purpose. It is public, identical in every implementation on earth, and secret from
 * nobody -- which is exactly why it cannot be a security mechanism, and why treating a
 * correct `Sec-WebSocket-Accept` as authentication is a mistake.
 */
export const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/**
 * The only version of the protocol there is.
 *
 * Numbered 13 because drafts 0 through 12 were deployed while the working group iterated,
 * and several of them were incompatible enough to matter. The field exists so a server can
 * tell a hixie-76 client from an RFC 6455 client and refuse the former politely; today it is
 * a constant that only ever fails when something is very wrong.
 */
export const WEBSOCKET_VERSION = 13;

/** How long a `Sec-WebSocket-Key` decodes to. RFC 6455 s 4.1 fixes it at 16 bytes. */
export const KEY_BYTES = 16;

/** 16 bytes in base64 is always 24 characters, the last two of them padding. */
export const KEY_CHARS = 24;

// ---------------------------------------------------------------------------
// The key
// ---------------------------------------------------------------------------

/** Why the key and accept fields are in the protocol at all. */
export interface HandshakeNote {
  readonly headline: string;
  readonly detail: string;
  readonly reference: RfcRef;
}

/**
 * The purpose of `Sec-WebSocket-Key`, which is almost never what people first assume.
 *
 * It is not authentication, not entropy for a cipher, and not a session identifier. It
 * defends against one specific attack that was live at the time: a script in a browser
 * cannot set arbitrary request headers, but before WebSockets existed it could open a
 * connection to any host and send it *something*. If a naive server could be talked into
 * echoing a header value back and then treating the connection as raw bytes, an attacker
 * could smuggle a forged request through a caching proxy and poison the cache for every
 * other user of that proxy.
 *
 * Two design decisions close that. The `Sec-` prefix means a browser refuses to let script
 * set the field, so the attacker cannot forge the request half. And requiring the *response*
 * to contain a value that could only be produced by hashing the key means the attacker
 * cannot get a `101` out of a server that does not speak WebSocket, so the connection never
 * transitions to raw bytes.
 */
export function explainKeyPurpose(): HandshakeNote {
  return {
    headline: 'The key proves comprehension, not identity.',
    detail:
      'Sec-WebSocket-Key is a fresh 16-byte nonce, and Sec-WebSocket-Accept is what you get ' +
      'by appending a fixed public GUID and hashing. Anyone can compute it, so it ' +
      'authenticates nobody. What it establishes is that the responder parsed a WebSocket ' +
      'handshake -- not an HTTP server that happened to answer 101, and not a caching proxy ' +
      'reflecting a header it never understood. The Sec- prefix does the other half: a ' +
      'browser will not let page script set a field with that prefix, so the request cannot ' +
      'be forged from JavaScript either.',
    reference: RFC_6455_OPENING,
  };
}

/**
 * Validate a `Sec-WebSocket-Key`.
 *
 * The length check is the substantive one and it is on the **decoded** value: RFC 6455 s 4.1
 * requires a 16-byte nonce, and a key that decodes to 15 or 20 bytes is from an
 * implementation that guessed. The base64 must also be exact, not URL-safe, because it is
 * compared as a string by nobody but reproduced as bytes by everybody.
 */
export function validateKey(key: string): ParseResult<Uint8Array> {
  if (key === '') return fail('Sec-WebSocket-Key is empty');
  if (/\s/.test(key)) return fail('Sec-WebSocket-Key contains whitespace');
  const decoded = base64Decode(key);
  if (!decoded.ok) return fail(`Sec-WebSocket-Key ${decoded.error}`);
  if (decoded.value.length !== KEY_BYTES) {
    return fail(
      `Sec-WebSocket-Key decodes to ${decoded.value.length} bytes; RFC 6455 s 4.1 ` +
        `requires exactly ${KEY_BYTES}`,
    );
  }
  return ok(decoded.value);
}

/**
 * A key for a simulated client, drawn from the seeded generator.
 *
 * RFC 6455 s 4.1 says the nonce must be "selected randomly" and freshly for every
 * connection, and this function is deliberately neither -- it is `mulberry32` seeded from a
 * scenario label, so the same scenario shows the same key and the same accept value every
 * time it runs, which is the property every simulation in this repository depends on and the
 * only way the derivation panel can be screenshotted or asserted on.
 *
 * That substitution is safe here for one reason: there is no attacker, because there is no
 * connection. In a real client it would not be. A predictable nonce lets an attacker who can
 * see the request precompute the accept value, and the proxy-poisoning defence above rests
 * on the responder being unable to do that without having read the specification.
 */
export function generateKey(seed: number | string): string {
  const rng = createRng(`sec-websocket-key:${seed}`);
  const bytes = new Uint8Array(KEY_BYTES);
  for (let index = 0; index < KEY_BYTES; index += 1) bytes[index] = rng.int(256);
  return base64Encode(bytes);
}

// ---------------------------------------------------------------------------
// The accept derivation -- the labeled step
// ---------------------------------------------------------------------------

/** One line of the derivation, in the order it happens. */
export interface AcceptDerivationStep {
  readonly id: string;
  /** The short name the panel puts in the left column. */
  readonly label: string;
  /** What this step does, and why the next one needs it. */
  readonly explain: string;
  /** The value after this step, as text a reader can copy. */
  readonly value: string;
  /** How long that value is, in the unit named by {@link unit}. */
  readonly size: number;
  readonly unit: 'characters' | 'bytes';
  readonly reference: RfcRef;
}

/** The whole computation, with every intermediate value kept. */
export interface AcceptDerivation {
  /** The client's `Sec-WebSocket-Key`, exactly as it was sent. */
  readonly key: string;
  /** Always {@link WEBSOCKET_GUID}. Carried so the panel need not import a constant. */
  readonly guid: string;
  /** `key + guid`, with nothing between them. */
  readonly concatenated: string;
  /** The 20-byte digest, spaced into octets the way RFC 6455 s 1.3 prints it. */
  readonly digestHex: string;
  /** The value the server puts in `Sec-WebSocket-Accept`. */
  readonly accept: string;
  /** The same computation as an ordered list, which is what the UI renders. */
  readonly steps: readonly AcceptDerivationStep[];
}

/**
 * Derive `Sec-WebSocket-Accept` from a `Sec-WebSocket-Key`, keeping every intermediate.
 *
 * The computation is four operations and one of them is a string concatenation, which is
 * exactly why it is worth showing rather than describing: a reader who sees
 * `dGhlIHNhbXBsZSBub25jZQ==` grow a GUID on the end, become twenty bytes of hex, and come
 * back as 28 characters of base64 has understood it completely and permanently.
 *
 * Two details are load-bearing and both are easy to get wrong:
 *
 * - **nothing goes between the key and the GUID.** No space, no colon, no newline. The
 *   trailing `==` of the key is part of the string that gets hashed.
 * - **the key is used as the client sent it**, character for character. It is not decoded
 *   first, not trimmed, not re-encoded. A server that normalises it computes a different
 *   digest and every client rejects the answer.
 */
export function deriveAccept(key: string): AcceptDerivation {
  const concatenated = `${key}${WEBSOCKET_GUID}`;
  const digest = sha1Text(concatenated);
  const digestHex = toSpacedHex(digest);
  const accept = base64Encode(digest);

  const steps: readonly AcceptDerivationStep[] = [
    {
      id: 'key',
      label: 'Take the key as sent',
      explain:
        'The client’s Sec-WebSocket-Key: 16 random bytes in base64, so always 24 ' +
        'characters ending in "==". It is used verbatim -- not decoded, not trimmed, not ' +
        're-encoded. A server that normalises it computes a different digest and every ' +
        'client rejects the answer.',
      value: key,
      size: key.length,
      unit: 'characters',
      reference: RFC_6455_CLIENT,
    },
    {
      id: 'guid',
      label: 'Append the fixed GUID',
      explain:
        'A constant, identical in every implementation, chosen because it is unlikely to ' +
        'appear in an endpoint that does not speak WebSocket. It is public: it is printed ' +
        'in the RFC. Concatenation only -- no separator, no whitespace, no newline.',
      value: WEBSOCKET_GUID,
      size: WEBSOCKET_GUID.length,
      unit: 'characters',
      reference: RFC_6455_OPENING,
    },
    {
      id: 'concatenated',
      label: 'The string to hash',
      explain:
        'Key and GUID run together. The "==" padding on the key sits in the middle of the ' +
        'string and is hashed along with everything else.',
      value: concatenated,
      size: concatenated.length,
      unit: 'characters',
      reference: RFC_6455_OPENING,
    },
    {
      id: 'sha1',
      label: 'SHA-1 it',
      explain:
        'Twenty bytes, always. SHA-1 is specified here despite being broken for signatures, ' +
        'and that is not an oversight: no signature rests on this digest, so a collision ' +
        'buys an attacker nothing. It proves comprehension, not identity.',
      value: digestHex,
      size: 20,
      unit: 'bytes',
      reference: RFC_6455_SERVER,
    },
    {
      id: 'accept',
      label: 'base64 the digest',
      explain:
        'Standard base64 with padding -- not the URL-safe alphabet -- because this is an ' +
        'HTTP field value, not a URL component. Twenty bytes always encode to 28 characters ' +
        'ending in a single "=". This exact string goes in Sec-WebSocket-Accept, and the ' +
        'client compares it byte for byte against its own copy of this computation.',
      value: accept,
      size: accept.length,
      unit: 'characters',
      reference: RFC_6455_SERVER,
    },
  ];

  return { key, guid: WEBSOCKET_GUID, concatenated, digestHex, accept, steps };
}

/**
 * The client's side of the same computation: does this response answer *our* key?
 *
 * Compared as an exact string, because both sides produced it from the same bytes through
 * the same encoder and any difference at all means something in between rewrote it. There is
 * no constant-time comparison here and there should not be: the expected value is derived
 * from a nonce the client itself just published in plaintext, so there is no secret whose
 * prefix a timing attack could recover.
 */
export function verifyAccept(sentKey: string, receivedAccept: string): boolean {
  return deriveAccept(sentKey).accept === receivedAccept;
}

// ---------------------------------------------------------------------------
// Building the client request
// ---------------------------------------------------------------------------

/** What a scenario has to decide to produce a handshake request. */
export interface ClientHandshakeInit {
  /** The path and query, e.g. `/chat?room=lobby`. */
  readonly resource: string;
  /** The authority, e.g. `chat.example.com` or `chat.example.com:8443`. */
  readonly host: string;
  /** The key. Pass one from {@link generateKey} or a literal from the RFC. */
  readonly key: string;
  /**
   * The page's origin, as a browser would send it. Omitted models a non-browser client --
   * `curl`, a server-to-server socket -- which is a real and important case, because it is
   * exactly the case an `Origin` check does not constrain.
   */
  readonly origin?: string;
  /** Subprotocols offered, in the client's order of preference. */
  readonly subprotocols?: readonly string[];
  /** Extension offers, as their header text, e.g. `permessage-deflate`. */
  readonly extensions?: readonly string[];
  /** Version to claim. Defaults to 13; other values exist so a `426` can be shown. */
  readonly version?: number;
  /** Extra field lines -- a cookie, an `Authorization`. Appended after the required ones. */
  readonly extraHeaders?: HeaderList;
}

/**
 * Build the client's opening handshake.
 *
 * The field order is the one RFC 6455 s 1.2 uses in its example, and it is worth keeping:
 * `Host` first because it is the one field HTTP/1.1 always requires, then the two that
 * request the upgrade, then the three that make it a *WebSocket* upgrade. Order carries no
 * meaning to a parser and a great deal to a reader.
 *
 * Note what is *not* here, and cannot be: a browser's `WebSocket` constructor takes a URL
 * and a subprotocol list, and that is all. There is no way to add an `Authorization` header
 * from page script. That single API limitation is why so many WebSocket services put their
 * token in the query string -- where it lands in every access log on the path -- or abuse
 * `Sec-WebSocket-Protocol` as a credential carrier. `extraHeaders` exists to model the
 * non-browser clients that do not have this problem.
 */
export function buildClientHandshake(init: ClientHandshakeInit): HttpRequest {
  let headers: HeaderList = [
    header('Host', init.host),
    header('Upgrade', 'websocket'),
    header('Connection', 'Upgrade'),
    header('Sec-WebSocket-Key', init.key),
    header('Sec-WebSocket-Version', `${init.version ?? WEBSOCKET_VERSION}`),
  ];

  if (init.origin !== undefined) {
    headers = appendHeader(headers, 'Origin', init.origin);
  }
  if (init.subprotocols !== undefined && init.subprotocols.length > 0) {
    headers = appendHeader(
      headers,
      'Sec-WebSocket-Protocol',
      init.subprotocols.join(', '),
    );
  }
  if (init.extensions !== undefined && init.extensions.length > 0) {
    headers = appendHeader(
      headers,
      'Sec-WebSocket-Extensions',
      init.extensions.join(', '),
    );
  }
  for (const extra of init.extraHeaders ?? []) {
    headers = appendHeader(headers, extra.name, extra.value);
  }

  return makeRequest({ method: 'GET', target: init.resource, version: '1.1', headers });
}

// ---------------------------------------------------------------------------
// Checking a handshake
// ---------------------------------------------------------------------------

/** How strongly the specification requires the thing being checked. */
export type Requirement = 'MUST' | 'SHOULD' | 'MAY';

/** One verdict about one field, which is one row of the handshake panel. */
export interface HandshakeCheck {
  readonly id: string;
  /** What is being checked, phrased as the requirement: `Method is GET`. */
  readonly title: string;
  readonly requirement: Requirement;
  readonly passed: boolean;
  /** What was actually found, quoted. `undefined` when the field was absent. */
  readonly found?: string;
  /** Why the rule exists -- the part worth reading whether it passed or failed. */
  readonly detail: string;
  readonly reference: RfcRef;
}

function check(init: HandshakeCheck): HandshakeCheck {
  return init;
}

/**
 * Every check a server performs on a client's opening handshake, in specification order.
 *
 * Returned in full whether they pass or fail, because the passing ones are the lesson: a
 * reader who only ever sees failures learns what breaks a handshake and never learns what
 * one *is*. The panel greys the passes and highlights the failures.
 *
 * The `MUST`/`SHOULD`/`MAY` column is not decoration either. Exactly one of these checks is
 * a `SHOULD` -- the `Origin` check -- and that is the single most consequential row in the
 * table; see {@link explainOriginCheck}.
 */
export function inspectClientHandshake(
  request: HttpRequest,
  policy: ServerPolicy = {},
): readonly HandshakeCheck[] {
  const supported = policy.supportedVersions ?? [WEBSOCKET_VERSION];
  const version = headerValue(request.headers, 'Sec-WebSocket-Version');
  const key = headerValue(request.headers, 'Sec-WebSocket-Key');
  const keyResult = key === undefined ? undefined : validateKey(key);
  const origin = headerValue(request.headers, 'Origin');

  const checks: HandshakeCheck[] = [
    check({
      id: 'method',
      title: 'Method is GET',
      requirement: 'MUST',
      passed: request.method === 'GET',
      found: request.method,
      detail:
        'A GET is the request every proxy, load balancer, and firewall on the path is ' +
        'certain it understands. The handshake has no body and creates nothing, so no other ' +
        'method would earn its risk.',
      reference: RFC_6455_CLIENT,
    }),
    check({
      id: 'version',
      title: 'HTTP version is at least 1.1',
      requirement: 'MUST',
      passed: request.version === '1.1' || request.version === '2',
      found: `HTTP/${request.version}`,
      detail:
        'Upgrade and Connection are hop-by-hop fields that need a persistent connection to ' +
        'switch. HTTP/1.0 has no dependable notion of one. HTTP/2 has no connection-wide ' +
        'upgrade at all -- RFC 8441 replaces this handshake with an extended CONNECT.',
      reference: RFC_6455_CLIENT,
    }),
    check({
      id: 'host',
      title: 'Host is present',
      requirement: 'MUST',
      passed: hasHeader(request.headers, 'Host'),
      found: headerValue(request.headers, 'Host'),
      detail:
        'Required of every HTTP/1.1 request, and load-bearing here: one IP address serves ' +
        'many WebSocket endpoints, and Host is what picks between them before any ' +
        'WebSocket-specific field is even read.',
      reference: RFC_6455_CLIENT,
    }),
    check({
      id: 'upgrade',
      title: 'Upgrade field contains the "websocket" token',
      requirement: 'MUST',
      passed: hasFieldToken(request.headers, 'Upgrade', 'websocket'),
      found: headerValue(request.headers, 'Upgrade'),
      detail:
        'Compared as a case-insensitive token, so "WebSocket" and "websocket" are the same ' +
        'request. Upgrade is a list field and predates WebSockets by a decade -- it was ' +
        'HTTP/1.1’s general answer to "switch this connection to another protocol".',
      reference: RFC_9110_UPGRADE,
    }),
    check({
      id: 'connection',
      title: 'Connection field lists the "Upgrade" token',
      requirement: 'MUST',
      passed: hasFieldToken(request.headers, 'Connection', 'upgrade'),
      found: headerValue(request.headers, 'Connection'),
      detail:
        'The token must be present in the list, not equal to the whole value. Browsers send ' +
        '"Connection: keep-alive, Upgrade", and a server that string-compares the field ' +
        'against "Upgrade" rejects them and then blames the browser. This is the single ' +
        'most common handshake bug there is.',
      reference: RFC_9110_UPGRADE,
    }),
    check({
      id: 'key',
      title: 'Sec-WebSocket-Key is base64 of exactly 16 bytes',
      requirement: 'MUST',
      passed: keyResult !== undefined && keyResult.ok,
      found: key,
      detail:
        keyResult !== undefined && !keyResult.ok
          ? keyResult.error
          : 'A fresh nonce per connection. The server hashes it with a fixed public GUID to ' +
            'produce Sec-WebSocket-Accept, which proves the server understood the handshake ' +
            'rather than being an HTTP server that answered 101 by coincidence.',
      reference: RFC_6455_CLIENT,
    }),
    check({
      id: 'ws-version',
      title: `Sec-WebSocket-Version is one the server supports (${supported.join(', ')})`,
      requirement: 'MUST',
      passed: version !== undefined && supported.includes(Number(version)),
      found: version,
      detail:
        'Version 13 is the RFC; 0 through 12 were drafts that shipped in browsers while the ' +
        'working group iterated. A server that cannot speak the requested version answers ' +
        '426 with its own Sec-WebSocket-Version list rather than a bare 400, so the client ' +
        'can retry with something it understands.',
      reference: RFC_6455_FIELDS,
    }),
  ];

  // The Origin check is conditional on policy, but the *row* is unconditional: a server
  // that does not check Origin has made a decision, and the panel should say so.
  const allowed = policy.allowedOrigins;
  checks.push(
    check({
      id: 'origin',
      title: 'Origin is one the server accepts',
      requirement: 'SHOULD',
      passed:
        allowed === undefined ? true : origin !== undefined && allowed.includes(origin),
      found: origin ?? '(not sent -- not a browser client)',
      detail:
        allowed === undefined
          ? 'This server accepts any Origin. That is a real decision with real consequences: ' +
            'the same-origin policy does not apply to WebSockets, so any page on the web can ' +
            'open a socket to this endpoint, and the browser will attach the cookies.'
          : `Accepted: ${allowed.join(', ')}. The browser sets Origin and page script cannot ` +
            'forge it, so this check works -- against browsers. A non-browser client sends ' +
            'whatever it likes, which is why Origin is authorisation about pages, never ' +
            'about users.',
      reference: RFC_6455_ORIGIN,
    }),
  );

  return checks;
}

/**
 * Cross-site WebSocket hijacking, in the place a reader will meet it.
 *
 * Worth stating plainly because the intuition transferred from `fetch` is actively wrong.
 * CORS does not apply to WebSockets. There is no preflight, no
 * `Access-Control-Allow-Origin`, and no browser-enforced refusal: `evil.example` can open a
 * socket to `bank.example`, and the browser will attach `bank.example`'s cookies to the
 * handshake, and the handshake will succeed unless the server itself checked `Origin`.
 *
 * The fix is the one the fetch case also needs and usually already has: authenticate the
 * connection with something an attacker's page cannot read -- a token in the first frame
 * after the socket opens, or a ticket the page had to fetch first -- rather than relying on
 * a cookie that travels automatically.
 */
export function explainOriginCheck(): HandshakeNote {
  return {
    headline: 'The same-origin policy does not protect a WebSocket.',
    detail:
      'No CORS, no preflight, no browser-side refusal. Any page can open a socket to any ' +
      'host, and the browser attaches that host’s cookies to the handshake. The only ' +
      'thing standing between that and a cross-site WebSocket hijack is the server checking ' +
      'the Origin field itself -- which RFC 6455 makes a SHOULD, not a MUST. Better still, ' +
      'authenticate the connection with a credential the attacking page cannot obtain, such ' +
      'as a token sent in the first frame, rather than an ambient cookie.',
    reference: RFC_6455_ORIGIN,
  };
}

// ---------------------------------------------------------------------------
// Negotiation
// ---------------------------------------------------------------------------

/** What the server will and will not agree to. */
export interface ServerPolicy {
  /** Defaults to `[13]`. Set it to something else to produce a `426`. */
  readonly supportedVersions?: readonly number[];
  /** Subprotocols the server speaks, in **its** order of preference. */
  readonly subprotocols?: readonly string[];
  /** Extension names the server will accept, e.g. `permessage-deflate`. */
  readonly extensions?: readonly string[];
  /** Origins allowed. `undefined` means the server does not check -- and is told so. */
  readonly allowedOrigins?: readonly string[];
  /** The reason phrase to put on the `101`. Advisory; defaults to the usual one. */
  readonly reason?: string;
}

/**
 * Pick a subprotocol.
 *
 * The server chooses, from the list the client offered, and the choice is **the server's
 * preference order applied to the client's set** -- not the client's first offer. That is
 * how every negotiation in HTTP works and it is the right way round: the server is the one
 * that knows which of its implementations is best maintained.
 *
 * Returning nothing is legal and means "no subprotocol", which is a successful handshake and
 * not a failure. The client then has to decide whether it can live without one; most can.
 * What a server may **not** do is name a protocol the client never offered -- RFC 6455 s 4.1
 * requires the client to fail the connection if it does.
 */
export function selectSubprotocol(
  offered: readonly string[],
  supported: readonly string[] | undefined,
): string | undefined {
  if (supported === undefined) return undefined;
  return supported.find((candidate) => offered.includes(candidate));
}

/** The subprotocols a request offers, across however many field lines it used. */
export function offeredSubprotocols(headers: HeaderList): string[] {
  return headerValues(headers, 'Sec-WebSocket-Protocol')
    .flatMap((value) => value.split(','))
    .map((token) => token.trim())
    .filter((token) => token !== '');
}

/**
 * The extensions a request offers, as `name` plus its parameters.
 *
 * Extensions are the one genuinely open-ended part of the handshake: RFC 6455 s 9 defines
 * the negotiation syntax and no extensions at all, leaving them to be registered separately.
 * In practice there is one that matters, `permessage-deflate` (RFC 7692), and it is the
 * reason RSV1 exists in the frame header.
 */
export interface ExtensionOffer {
  readonly name: string;
  readonly params: readonly string[];
  /** The offer as written, so the panel can show it unmodified. */
  readonly raw: string;
}

/** Parse the `Sec-WebSocket-Extensions` offers out of a header list. */
export function offeredExtensions(headers: HeaderList): ExtensionOffer[] {
  return headerValues(headers, 'Sec-WebSocket-Extensions')
    .flatMap((value) => value.split(','))
    .map((raw) => raw.trim())
    .filter((raw) => raw !== '')
    .map((raw) => {
      const parts = raw.split(';').map((part) => part.trim());
      return { name: parts[0].toLowerCase(), params: parts.slice(1), raw };
    });
}

/**
 * Agree to the offered extensions the server supports, in the order they were offered.
 *
 * A server must never accept an extension that was not offered, for the same reason it must
 * never name an unoffered subprotocol: the client would be asked to interpret frames under
 * rules it never agreed to, and RSV bits it does not understand are a protocol error it is
 * required to fail on.
 */
export function selectExtensions(
  offers: readonly ExtensionOffer[],
  supported: readonly string[] | undefined,
): ExtensionOffer[] {
  if (supported === undefined) return [];
  const allowed = supported.map((name) => name.toLowerCase());
  return offers.filter((offer) => allowed.includes(offer.name));
}

// ---------------------------------------------------------------------------
// The server's answer
// ---------------------------------------------------------------------------

/** What the server decided, and everything needed to draw the decision. */
export type HandshakeOutcome =
  | {
      readonly kind: 'accepted';
      readonly response: HttpResponse;
      /** The computation, kept so the panel can show it beside the response. */
      readonly derivation: AcceptDerivation;
      /** The subprotocol agreed, if any. Absent is a success, not a failure. */
      readonly subprotocol?: string;
      readonly extensions: readonly ExtensionOffer[];
      readonly checks: readonly HandshakeCheck[];
    }
  | {
      readonly kind: 'rejected';
      readonly response: HttpResponse;
      /** The first `MUST` that failed, phrased for the log line. */
      readonly reason: string;
      readonly checks: readonly HandshakeCheck[];
    };

/**
 * Run the server's half of the handshake.
 *
 * The structure mirrors what a real server does: check everything, and on the first `MUST`
 * failure produce an ordinary HTTP error response rather than anything WebSocket-shaped.
 * That last part is worth dwelling on -- a rejected handshake is *still HTTP*. The
 * connection never switched protocols, so the failure is a `400` with a body a browser could
 * render, and every intermediary on the path handles it as it would any other response. Only
 * the `101` changes what the connection is.
 *
 * A version mismatch gets a `426 Upgrade Required` carrying the server's own
 * `Sec-WebSocket-Version`, so a client speaking an old draft learns what to retry with
 * instead of guessing at a bare `400`.
 */
export function handleUpgrade(
  request: HttpRequest,
  policy: ServerPolicy = {},
): HandshakeOutcome {
  const checks = inspectClientHandshake(request, policy);
  const supported = policy.supportedVersions ?? [WEBSOCKET_VERSION];

  const versionCheck = checks.find((entry) => entry.id === 'ws-version');
  const otherFailure = checks.find(
    (entry) => entry.requirement === 'MUST' && entry.id !== 'ws-version' && !entry.passed,
  );

  if (otherFailure !== undefined) {
    return {
      kind: 'rejected',
      response: errorResponse(
        400,
        'Bad Request',
        `${otherFailure.title} -- but it is not. Found: ${otherFailure.found ?? '(absent)'}`,
      ),
      reason: otherFailure.title,
      checks,
    };
  }

  if (versionCheck !== undefined && !versionCheck.passed) {
    const response = makeResponse({
      status: 426,
      reason: 'Upgrade Required',
      headers: [
        header('Sec-WebSocket-Version', supported.join(', ')),
        header('Content-Type', 'text/plain; charset=utf-8'),
      ],
      body:
        `This endpoint speaks WebSocket version ${supported.join(' or ')}. ` +
        `The request asked for ${versionCheck.found ?? '(nothing)'}.\n`,
    });
    return {
      kind: 'rejected',
      response,
      reason: 'Unsupported Sec-WebSocket-Version',
      checks,
    };
  }

  const originCheck = checks.find((entry) => entry.id === 'origin');
  if (originCheck !== undefined && !originCheck.passed) {
    return {
      kind: 'rejected',
      response: errorResponse(
        403,
        'Forbidden',
        'The Origin on this handshake is not one this endpoint accepts.\n',
      ),
      reason: 'Origin refused',
      checks,
    };
  }

  const key = headerValue(request.headers, 'Sec-WebSocket-Key') as string;
  const derivation = deriveAccept(key);
  const subprotocol = selectSubprotocol(
    offeredSubprotocols(request.headers),
    policy.subprotocols,
  );
  const extensions = selectExtensions(
    offeredExtensions(request.headers),
    policy.extensions,
  );

  let headers: HeaderList = [
    header('Upgrade', 'websocket'),
    header('Connection', 'Upgrade'),
    header('Sec-WebSocket-Accept', derivation.accept),
  ];
  if (subprotocol !== undefined) {
    headers = appendHeader(headers, 'Sec-WebSocket-Protocol', subprotocol);
  }
  if (extensions.length > 0) {
    headers = appendHeader(
      headers,
      'Sec-WebSocket-Extensions',
      extensions.map((extension) => extension.raw).join(', '),
    );
  }

  // No Content-Length and no body. A 101 is the one response where the header section is
  // followed not by a body but by a different protocol, so the usual framing fields would
  // be a lie about what comes next.
  const response = makeResponse({
    status: 101,
    reason: policy.reason ?? 'Switching Protocols',
    headers,
  });

  return {
    kind: 'accepted',
    response,
    derivation,
    ...(subprotocol === undefined ? {} : { subprotocol }),
    extensions,
    checks,
  };
}

function errorResponse(status: number, reason: string, body: string): HttpResponse {
  return makeResponse({
    status,
    reason,
    headers: [
      header('Content-Type', 'text/plain; charset=utf-8'),
      header('Content-Length', `${utf8Bytes(body).length}`),
    ],
    body,
  });
}

// ---------------------------------------------------------------------------
// The client checking the answer
// ---------------------------------------------------------------------------

/**
 * Every check the *client* runs on the server's response, in specification order.
 *
 * Symmetrical with {@link inspectClientHandshake}, and the symmetry is the point: the
 * handshake is two parties each refusing to proceed unless the other proved it understood.
 * A client that skipped these would be exactly the naive endpoint the `Sec-` fields exist to
 * protect.
 *
 * RFC 6455 s 4.1 requires the client to **fail the connection** -- not retry, not warn -- if
 * any of these fail, and to do so without sending any frames. There is nothing to close
 * gracefully, because the connection never became a WebSocket.
 */
export function inspectServerHandshake(
  response: HttpResponse,
  sent: { key: string; subprotocols?: readonly string[]; extensions?: readonly string[] },
): readonly HandshakeCheck[] {
  const expected = deriveAccept(sent.key).accept;
  const accept = headerValue(response.headers, 'Sec-WebSocket-Accept');
  const chosen = headerValue(response.headers, 'Sec-WebSocket-Protocol');
  const grantedExtensions = offeredExtensions(response.headers);
  const offeredNames = (sent.extensions ?? []).map((name) =>
    name.split(';')[0].trim().toLowerCase(),
  );

  return [
    check({
      id: 'status',
      title: 'Status is 101',
      requirement: 'MUST',
      passed: response.status === 101,
      found: `${response.status} ${response.reason}`,
      detail:
        'Anything else is an ordinary HTTP response and is handled as one: a 401 means ' +
        'authenticate and retry, a 3xx means follow the redirect, a 426 means try a ' +
        'different Sec-WebSocket-Version. Only the 101 changes what the connection is. ' +
        'The reason phrase is advisory -- never match on it.',
      reference: RFC_9110_101,
    }),
    check({
      id: 'upgrade',
      title: 'Upgrade field contains the "websocket" token',
      requirement: 'MUST',
      passed: hasFieldToken(response.headers, 'Upgrade', 'websocket'),
      found: headerValue(response.headers, 'Upgrade'),
      detail:
        'The server naming the protocol it switched to. Case-insensitive, like the request ' +
        'side.',
      reference: RFC_9110_UPGRADE,
    }),
    check({
      id: 'connection',
      title: 'Connection field lists the "Upgrade" token',
      requirement: 'MUST',
      passed: hasFieldToken(response.headers, 'Connection', 'upgrade'),
      found: headerValue(response.headers, 'Connection'),
      detail:
        'Hop-by-hop, so an intermediary that forwarded this response was required to act on ' +
        'it rather than pass it along blindly. Its presence is part of what tells the client ' +
        'the switch happened on every hop and not just the last one.',
      reference: RFC_9110_UPGRADE,
    }),
    check({
      id: 'accept',
      title: 'Sec-WebSocket-Accept matches the key we sent',
      requirement: 'MUST',
      passed: accept !== undefined && accept === expected,
      found: accept,
      detail:
        `Expected ${expected}, derived from our own Sec-WebSocket-Key. A mismatch means the ` +
        'responder did not do the computation -- so it is not a WebSocket server, whatever ' +
        'status line it sent. This is the check that stops a cache-poisoning proxy from ' +
        'being talked into a raw byte stream.',
      reference: RFC_6455_SERVER,
    }),
    check({
      id: 'subprotocol',
      title: 'Any chosen subprotocol is one we offered',
      requirement: 'MUST',
      passed: chosen === undefined || (sent.subprotocols ?? []).includes(chosen),
      found: chosen ?? '(none chosen)',
      detail:
        'Choosing nothing is a successful handshake. Choosing something the client never ' +
        'offered is not: the client would be agreeing to message semantics it has no ' +
        'implementation of, so RFC 6455 requires it to fail the connection instead.',
      reference: RFC_6455_CLIENT,
    }),
    check({
      id: 'extensions',
      title: 'Any granted extension is one we offered',
      requirement: 'MUST',
      passed: grantedExtensions.every((granted) => offeredNames.includes(granted.name)),
      found:
        grantedExtensions.length === 0
          ? '(none granted)'
          : grantedExtensions.map((granted) => granted.raw).join(', '),
      detail:
        'An extension changes how frames are interpreted -- permessage-deflate claims RSV1 ' +
        'to mark a compressed message. A client that never offered it would read that bit ' +
        'as a protocol error and fail the connection, which is exactly the right outcome.',
      reference: RFC_6455_FIELDS,
    }),
  ];
}

/** Whether every `MUST` in a set of checks passed. */
export function handshakeSucceeded(checks: readonly HandshakeCheck[]): boolean {
  return checks.every((entry) => entry.requirement !== 'MUST' || entry.passed);
}

// ---------------------------------------------------------------------------
// The cost of the handshake
// ---------------------------------------------------------------------------

/** What the upgrade cost, in the units `comparison.ts` compares transports in. */
export interface HandshakeCost {
  readonly requestBytes: number;
  readonly responseBytes: number;
  readonly totalBytes: number;
  /** Exactly one, always. That number is the whole argument for WebSockets. */
  readonly requests: 1;
}

/**
 * The byte cost of the upgrade.
 *
 * Measured exactly, from the rendered HTTP/1.1 text, because `comparison.ts` weighs this
 * one-off cost against the per-message cost of polling and the comparison would be
 * meaningless if the two were counted differently. The handshake is *expensive* -- several
 * hundred bytes, larger than a typical `GET` because of the four `Sec-WebSocket-*` fields --
 * and it is paid once. Everything after it costs between two and fourteen bytes of framing.
 */
export function handshakeCost(
  request: HttpRequest,
  response: HttpResponse,
): HandshakeCost {
  const requestBytes = wireBytes(request);
  const responseBytes = wireBytes(response);
  return {
    requestBytes,
    responseBytes,
    totalBytes: requestBytes + responseBytes,
    requests: 1,
  };
}

/**
 * The resource the handshake was for -- what a router would dispatch on.
 *
 * Split out because the query string is where browser WebSocket clients are forced to put
 * things that belong in headers; see the note on {@link parseTarget}.
 */
export function handshakeResource(request: HttpRequest): {
  path: string;
  query: string;
  /** True when the query carries something that looks like a credential. */
  credentialInQuery: boolean;
} {
  const target = parseTarget(request.target);
  const credentialInQuery = /(^|&)(token|access_token|api_?key|auth|jwt)=/i.test(
    target.query,
  );
  return { path: target.path, query: target.query, credentialInQuery };
}

/** The `Connection`/`Upgrade` tokens on a message, for the panel to list. */
export function upgradeTokens(headers: HeaderList): {
  connection: string[];
  upgrade: string[];
} {
  return {
    connection: fieldTokens(headers, 'Connection'),
    upgrade: fieldTokens(headers, 'Upgrade'),
  };
}
