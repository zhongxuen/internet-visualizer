/**
 * Authentication -- three answers to "who is calling?", in increasing order of care.
 *
 * 1. **An API key.** A shared string. Whoever holds it is the caller. Simple, and the whole
 *    security model is "do not let it leak", which is a promise no one can keep forever.
 * 2. **A bearer token, usually a JWT.** Still a string whose holder is the caller -- that is
 *    what *bearer* means -- but one that expires, states its own audience, and carries a
 *    signature the server can check without a database lookup.
 * 3. **OAuth 2.0 authorization code with PKCE.** Not a credential format at all but a
 *    *protocol* for one party to get a token for another party's data without ever seeing
 *    that party's password.
 *
 * The step from 2 to 3 is the one worth animating, because most explanations of OAuth
 * describe the boxes and arrows without saying what problem each arrow solves. This file
 * builds the ladder as data, and every step carries the attack it exists to prevent.
 *
 * ## The two things everyone gets wrong
 *
 * **A JWT's payload is encoded, not encrypted.** Base64url is a transport encoding with no
 * key and no secret; anyone holding the token can read every claim in it. The signature
 * makes the payload *tamper-evident*, not *confidential*. {@link JWT_PAYLOAD_NOT_ENCRYPTED}
 * is the sentence the UI must show, and {@link decodeJwt} deliberately requires no secret --
 * being able to decode without one is not a weakness in this implementation, it is the fact.
 *
 * **PKCE is not about the token, it is about the code.** The authorization code travels back
 * through the user's browser, where a malicious app registered on the same redirect URI, a
 * shoulder-surfer, or a leaky log can pick it up. PKCE makes the stolen code useless: the
 * client committed in advance to a secret it has not yet revealed, and the token endpoint
 * will not trade the code without it. {@link interceptAuthorizationCode} runs that attack
 * and shows it failing.
 *
 * ## Signatures here are real
 *
 * `digest.ts` computes actual HMAC-SHA256 and SHA-256, so this module's tokens verify in any
 * JWT debugger and its `code_challenge` matches any PKCE checker. The "secrets" are string
 * literals in `scenarios/` and there is no network; see `digest.ts` for why real arithmetic
 * is the right call in this module and the wrong one in the HTTPS Explorer.
 */

import { fail, ok, type ParseResult } from '@/core/net/result';
import type { RfcRef } from '@/core/types/events';

import {
  base64UrlDecodeText,
  base64UrlEncode,
  base64UrlEncodeText,
  constantTimeEqual,
  hmacSha256,
  sha256Text,
  utf8Bytes,
} from './digest';
import {
  header,
  headerValue,
  jsonText,
  parseJson,
  parseTarget,
  queryParam,
  request,
  response,
  withJsonBody,
  withQuery,
  type HttpRequest,
  type HttpResponse,
  type JsonObject,
  type JsonValue,
} from './message';
import { problem, reasonPhrase } from './rest';

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

/** RFC 6749 -- The OAuth 2.0 Authorization Framework. */
export const RFC_6749: RfcRef = {
  rfc: 6749,
  title: 'The OAuth 2.0 Authorization Framework',
};

/** RFC 6749 s 4.1 -- the authorization code grant. */
export const RFC_6749_AUTH_CODE: RfcRef = { ...RFC_6749, section: '4.1' };

/** RFC 6750 -- bearer token usage. */
export const RFC_6750: RfcRef = {
  rfc: 6750,
  title: 'The OAuth 2.0 Authorization Framework: Bearer Token Usage',
};

/** RFC 7636 -- Proof Key for Code Exchange. */
export const RFC_7636: RfcRef = {
  rfc: 7636,
  title: 'Proof Key for Code Exchange by OAuth Public Clients',
};

/** RFC 7519 -- JSON Web Token. */
export const RFC_7519: RfcRef = { rfc: 7519, title: 'JSON Web Token (JWT)' };

/** RFC 7515 -- JSON Web Signature, which defines the three-segment compact form. */
export const RFC_7515: RfcRef = { rfc: 7515, title: 'JSON Web Signature (JWS)' };

/** RFC 9110 s 11 -- HTTP authentication, WWW-Authenticate and Authorization. */
export const RFC_9110_AUTH: RfcRef = {
  rfc: 9110,
  section: '11',
  title: 'HTTP Semantics',
};

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

/** Where a client can put an API key. */
export type ApiKeyPlacement =
  /** A request header, usually `X-API-Key` or `Authorization`. */
  | 'header'
  /** A query parameter, e.g. `?api_key=...`. */
  | 'query';

/** One placement, with what it costs. */
export interface ApiKeyPlacementInfo {
  readonly placement: ApiKeyPlacement;
  readonly example: string;
  readonly verdict: 'recommended' | 'avoid';
  readonly what: string;
  /** Every place the key ends up that the developer did not intend. */
  readonly leaks: readonly string[];
}

/**
 * Header versus query, and why the query is worse than it looks.
 *
 * This is not a style preference. A URL is *infrastructure metadata*: it is recorded by every
 * proxy, load balancer, CDN, and web server in the path, saved in browser history, sent to
 * third parties in the `Referer` header, and pasted into support tickets. A header is not.
 * The key is the same secret in both cases; the difference is how many systems keep a copy of
 * it by design.
 *
 * RFC 6750 s 2.3 makes the same judgement about bearer tokens in a URI query, and says such
 * use is deprecated and SHOULD NOT be done.
 */
export const API_KEY_PLACEMENTS: readonly ApiKeyPlacementInfo[] = [
  {
    placement: 'header',
    example: 'X-API-Key: sk_live_9f2c...',
    verdict: 'recommended',
    what: 'The key travels in a request header, inside the TLS-protected part of the request.',
    leaks: [
      'Nothing routine. Headers are not written to access logs by default, do not appear in browser history, and are never sent in a Referer.',
    ],
  },
  {
    placement: 'query',
    example: 'GET /v1/articles?api_key=sk_live_9f2c...',
    verdict: 'avoid',
    what: 'The key is part of the URL, and so is part of every record anything keeps of the request.',
    leaks: [
      'Server access logs, by default, on every proxy and load balancer in the path.',
      'Browser history and the address bar, where anyone using the machine can read it.',
      'The Referer header sent to any third-party resource the page loads.',
      'CDN and proxy cache keys, which may store the URL alongside the response.',
      'Bug reports, screenshots, and support tickets, where URLs get pasted and keys do not get redacted.',
    ],
  },
];

/** Put an API key on a request in one of the two placements. */
export function applyApiKey(
  incoming: HttpRequest,
  key: string,
  placement: ApiKeyPlacement,
  name = placement === 'header' ? 'X-API-Key' : 'api_key',
): HttpRequest {
  if (placement === 'header') {
    return { ...incoming, headers: [...incoming.headers, header(name, key)] };
  }
  const target = parseTarget(incoming.target);
  return {
    ...incoming,
    target: withQuery(target.path, [...target.params, [name, key]]),
  };
}

/** The key a request carries, wherever it put it. */
export function extractApiKey(
  incoming: HttpRequest,
  placement: ApiKeyPlacement,
  name = placement === 'header' ? 'X-API-Key' : 'api_key',
): string | undefined {
  return placement === 'header'
    ? headerValue(incoming.headers, name)
    : queryParam(parseTarget(incoming.target), name);
}

/** What a credential check concluded. */
export interface AuthVerdict {
  readonly authenticated: boolean;
  /** Absent when the credential was accepted. */
  readonly response?: HttpResponse;
  /** The status chosen, and why that one rather than its neighbour. */
  readonly why: string;
  /** The identity the credential names, when it names one. */
  readonly subject?: string;
}

/** A key the mock API recognises, and what it is allowed to do. */
export interface ApiKeyRecord {
  readonly key: string;
  readonly subject: string;
  readonly scopes: readonly string[];
}

/**
 * Check an API key, distinguishing `401` from `403`.
 *
 * The distinction is the useful part and is constantly got wrong. `401` means *I do not know
 * who you are* -- retry with credentials and you may succeed. `403` means *I know exactly who
 * you are and the answer is still no* -- retrying with the same credentials is pointless.
 * A server that returns `403` for a missing token sends clients into a retry loop; one that
 * returns `401` for a permission failure sends them to re-authenticate for no reason.
 *
 * RFC 9110 s 15.5.2 requires a `401` to carry `WWW-Authenticate`. Note the honest wrinkle:
 * there is no registered authentication scheme for bare API keys, so servers using them
 * routinely omit the field and are routinely non-conformant. Bearer tokens have `Bearer`
 * (RFC 6750 s 3) and no such excuse.
 */
export function verifyApiKey(
  incoming: HttpRequest,
  options: {
    readonly keys: readonly ApiKeyRecord[];
    readonly placement: ApiKeyPlacement;
    readonly name?: string;
    /** Scope the target requires, if any. */
    readonly requiredScope?: string;
  },
): AuthVerdict {
  const presented = extractApiKey(incoming, options.placement, options.name);
  if (presented === undefined || presented === '') {
    return {
      authenticated: false,
      response: {
        ...problem(401, 'No API key was presented.'),
        headers: [
          ...problem(401, '').headers,
          header('WWW-Authenticate', 'ApiKey realm="api"'),
        ],
      },
      why: '401: no credential arrived, so the server cannot know who is calling. Retrying with a key may work.',
    };
  }

  // Constant-time comparison against every candidate: a key is a secret, and `===` in a
  // lookup loop leaks how much of it matched. See digest.ts.
  const record = options.keys.find((candidate) =>
    constantTimeEqual(candidate.key, presented),
  );
  if (!record) {
    return {
      authenticated: false,
      response: problem(401, 'That API key is not recognised.'),
      why: '401 rather than 403: an unrecognised key names nobody, so there is no identity to refuse.',
    };
  }

  if (options.requiredScope && !record.scopes.includes(options.requiredScope)) {
    return {
      authenticated: false,
      subject: record.subject,
      response: problem(403, `This key is missing the "${options.requiredScope}" scope.`),
      why: '403: the caller is known and is not permitted. Retrying with the same key will never succeed.',
    };
  }

  return {
    authenticated: true,
    subject: record.subject,
    why: 'The key matched a known record and carries the scope this target requires.',
  };
}

// ---------------------------------------------------------------------------
// JWT
// ---------------------------------------------------------------------------

/**
 * The sentence every view of a decoded token must show.
 *
 * Exported as a constant rather than typed into a component so it cannot drift, and so
 * grepping for it finds every surface that renders claims.
 */
export const JWT_PAYLOAD_NOT_ENCRYPTED =
  'The payload is encoded, not encrypted. Base64url is a transport encoding with no key -- anyone holding this token can read every claim in it, and this page just did so without a secret. The signature makes the payload tamper-evident, not confidential. Never put anything in a JWT that the bearer must not read.';

/** Why `alg: none` exists and why a verifier must refuse it. */
export const JWT_ALG_NONE_WARNING =
  'RFC 7515 registers "none" for tokens whose integrity is already assured by other means. A verifier that reads alg from the token and obeys it will accept an unsigned token an attacker wrote -- the classic JWT vulnerability. The verifier must decide which algorithm is acceptable before it looks at the token.';

/** The other half of the bargain: a signature says nothing about revocation. */
export const JWT_REVOCATION_NOTE =
  'A signed token is valid until it expires, and there is no step in verification that consults the server. That is what makes JWTs stateless and fast -- and it means logging out, banning a user, or revoking a grant does not invalidate tokens already issued. Short lifetimes plus a refresh token are the usual answer; a denylist gives back the database lookup the design was avoiding.';

/** The JOSE header of a token, once decoded. */
export interface JwtHeaderClaims extends JsonObject {
  readonly alg: string;
}

/** A token taken apart. No secret was needed to produce any of this. */
export interface DecodedJwt {
  readonly token: string;
  /** The three base64url segments, exactly as they appeared. */
  readonly segments: {
    readonly header: string;
    readonly payload: string;
    readonly signature: string;
  };
  /** `header.payload` -- the bytes the signature is computed over. */
  readonly signingInput: string;
  readonly header: JsonObject;
  readonly claims: JsonObject;
  /** The decoded JSON as text, for showing beside the encoded segment. */
  readonly headerJson: string;
  readonly payloadJson: string;
}

/**
 * Take a JWT apart.
 *
 * **No secret, no key, no verification.** Splitting on `.` and base64url-decoding two
 * segments is the whole operation, and it works on any token from any issuer. That is the
 * demonstration: a function this short reads every claim, which is why a JWT is a bad place
 * for a user's email address, an internal user id you would rather not publish, or a feature
 * flag that reveals an unreleased product.
 *
 * Verification is a separate function ({@link verifyJwt}) because it is a separate act, and
 * conflating the two is how libraries end up with a `decode()` that people mistake for a
 * check.
 */
export function decodeJwt(token: string): ParseResult<DecodedJwt> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return fail(
      `a compact JWS has three dot-separated segments; this has ${parts.length}`,
    );
  }
  const [headerSegment, payloadSegment, signatureSegment] = parts;
  if (headerSegment === '' || payloadSegment === '') {
    return fail('the header and payload segments must not be empty');
  }

  const headerText = base64UrlDecodeText(headerSegment);
  if (!headerText.ok) return fail(`header segment: ${headerText.error}`);
  const payloadText = base64UrlDecodeText(payloadSegment);
  if (!payloadText.ok) return fail(`payload segment: ${payloadText.error}`);

  const headerJson = parseJson(headerText.value);
  if (!headerJson.ok) return fail(`header is not JSON: ${headerJson.error}`);
  const payloadJson = parseJson(payloadText.value);
  if (!payloadJson.ok) return fail(`payload is not JSON: ${payloadJson.error}`);

  if (!isJsonObject(headerJson.value)) return fail('the header must be a JSON object');
  if (!isJsonObject(payloadJson.value)) return fail('the payload must be a JSON object');

  return ok({
    token,
    segments: {
      header: headerSegment,
      payload: payloadSegment,
      signature: signatureSegment,
    },
    signingInput: `${headerSegment}.${payloadSegment}`,
    header: headerJson.value,
    claims: payloadJson.value,
    headerJson: jsonText(headerJson.value),
    payloadJson: jsonText(payloadJson.value),
  });
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Build an HS256 token.
 *
 * The compact form is `BASE64URL(header) . BASE64URL(payload) . BASE64URL(signature)`, and
 * the signature covers the first two segments **as encoded text**, not as the JSON they
 * decode to. That detail is why a token cannot be re-serialised or pretty-printed and still
 * verify: change one byte of whitespace in the header and the signing input changes.
 */
export function encodeJwt(init: {
  readonly header?: JsonObject;
  readonly claims: JsonObject;
  readonly secret: string;
}): string {
  const header: JsonObject = { alg: 'HS256', typ: 'JWT', ...(init.header ?? {}) };
  // Compact JSON here, not the pretty form: the encoded segment is what travels, and the
  // signing input must be byte-identical for the verifier to reach the same digest.
  const headerSegment = base64UrlEncodeText(JSON.stringify(header));
  const payloadSegment = base64UrlEncodeText(JSON.stringify(init.claims));
  const signingInput = `${headerSegment}.${payloadSegment}`;
  const signature = base64UrlEncode(
    hmacSha256(utf8Bytes(init.secret), utf8Bytes(signingInput)),
  );
  return `${signingInput}.${signature}`;
}

/** One thing a verifier checked, and what it found. */
export interface JwtCheck {
  readonly name: string;
  readonly passed: boolean;
  /** What was checked, in one line. */
  readonly what: string;
  /** The values compared, when showing them helps. */
  readonly detail?: string;
}

/** The full verdict on a token. */
export interface JwtVerification {
  readonly valid: boolean;
  readonly checks: readonly JwtCheck[];
  /** The signature this implementation computed, for showing beside the one presented. */
  readonly expectedSignature: string;
}

/** What a verifier must be told before it looks at the token. */
export interface JwtVerifyOptions {
  readonly secret: string;
  /** Virtual seconds since the epoch -- never `Date.now()`. */
  readonly nowSeconds: number;
  /** The issuer this relying party accepts. */
  readonly issuer?: string;
  /** The audience this relying party *is*. */
  readonly audience?: string;
  /** Tolerance for clock differences, in seconds. Small, and never large enough to matter. */
  readonly clockSkewSeconds?: number;
  /** The algorithms the verifier is willing to accept, decided in advance. */
  readonly allowedAlgorithms?: readonly string[];
}

/**
 * Verify a token: signature first, then every temporal and identity claim.
 *
 * Two design points are deliberate and both are about real vulnerabilities.
 *
 * **The algorithm is chosen by the verifier, not read from the token.** `allowedAlgorithms`
 * defaults to `['HS256']` and a token declaring anything else fails before a byte is hashed.
 * A verifier that trusts the token's own `alg` will accept `"alg":"none"` with an empty
 * signature -- see {@link JWT_ALG_NONE_WARNING}.
 *
 * **`aud` is checked, not merely present.** A token is issued *for* an audience, and one API
 * accepting a token minted for a different API is how a low-value service becomes a way into
 * a high-value one. The same applies to `iss`.
 *
 * Every check runs and every result is reported, even after one has failed. A real verifier
 * stops at the first failure and is right to; for teaching, one red row among six green ones
 * says which promise broke, where a bare rejection says nothing.
 */
export function verifyJwt(
  decoded: DecodedJwt,
  options: JwtVerifyOptions,
): JwtVerification {
  const skew = options.clockSkewSeconds ?? 0;
  const allowed = options.allowedAlgorithms ?? ['HS256'];
  const checks: JwtCheck[] = [];

  const algorithm = typeof decoded.header.alg === 'string' ? decoded.header.alg : '';
  const algorithmAllowed = allowed.includes(algorithm);
  checks.push({
    name: 'alg',
    passed: algorithmAllowed,
    what: 'The algorithm is one this verifier decided in advance to accept.',
    detail: `token says ${algorithm || '(absent)'}; verifier accepts ${allowed.join(', ')}`,
  });

  const expectedSignature = base64UrlEncode(
    hmacSha256(utf8Bytes(options.secret), utf8Bytes(decoded.signingInput)),
  );
  const signatureMatches =
    algorithmAllowed && constantTimeEqual(expectedSignature, decoded.segments.signature);
  checks.push({
    name: 'signature',
    passed: signatureMatches,
    what: 'HMAC-SHA256 over "header.payload", recomputed with the shared secret and compared.',
    detail: signatureMatches
      ? 'matches'
      : `presented ${decoded.segments.signature.slice(0, 16)}..., computed ${expectedSignature.slice(0, 16)}...`,
  });

  const exp = numericClaim(decoded.claims, 'exp');
  checks.push({
    name: 'exp',
    passed: exp === undefined ? false : options.nowSeconds < exp + skew,
    what: 'The expiry has not passed. A token without exp never expires, which is why one is required here.',
    detail:
      exp === undefined
        ? 'absent -- this token would be valid forever'
        : `expires at ${exp}, now ${options.nowSeconds}`,
  });

  const nbf = numericClaim(decoded.claims, 'nbf');
  checks.push({
    name: 'nbf',
    passed: nbf === undefined ? true : options.nowSeconds + skew >= nbf,
    what: 'Not-before has arrived. Absent means "valid immediately", which is fine.',
    detail: nbf === undefined ? 'absent' : `valid from ${nbf}, now ${options.nowSeconds}`,
  });

  if (options.issuer !== undefined) {
    const iss = decoded.claims.iss;
    checks.push({
      name: 'iss',
      passed: iss === options.issuer,
      what: 'The issuer is the one this relying party trusts.',
      detail: `token says ${JSON.stringify(iss)}; expected ${JSON.stringify(options.issuer)}`,
    });
  }

  if (options.audience !== undefined) {
    const aud = decoded.claims.aud;
    // `aud` may be a single string or an array of them (RFC 7519 s 4.1.3).
    const audiences = Array.isArray(aud) ? aud : [aud];
    checks.push({
      name: 'aud',
      passed: audiences.includes(options.audience),
      what: 'This API is in the token’s audience -- the token was minted for it, not merely accepted by it.',
      detail: `token says ${JSON.stringify(aud)}; this API is ${JSON.stringify(options.audience)}`,
    });
  }

  return {
    valid: checks.every((check) => check.passed),
    checks,
    expectedSignature,
  };
}

function numericClaim(claims: JsonObject, name: string): number | undefined {
  const value = claims[name];
  return typeof value === 'number' ? value : undefined;
}

/** One registered claim, explained. */
export interface ClaimExplanation {
  readonly name: string;
  readonly label: string;
  readonly what: string;
  readonly detail?: string;
  readonly reference: RfcRef;
}

/** The registered claims of RFC 7519 s 4.1, in the order that section lists them. */
export const JWT_CLAIMS: readonly ClaimExplanation[] = [
  {
    name: 'iss',
    label: 'Issuer',
    what: 'Who minted this token.',
    detail:
      'Checked against a fixed expected value. A verifier that accepts any issuer will accept a token from an issuer the attacker controls.',
    reference: { ...RFC_7519, section: '4.1.1' },
  },
  {
    name: 'sub',
    label: 'Subject',
    what: 'Who the token is about -- usually the user id.',
    detail:
      'Unique only within the issuer. Two issuers may both call someone "1", so a relying party must key on the pair.',
    reference: { ...RFC_7519, section: '4.1.2' },
  },
  {
    name: 'aud',
    label: 'Audience',
    what: 'Which API the token was minted for. A string or an array of them.',
    detail:
      'The check that stops a token for one service being replayed at another. Skipping it is the most consequential omission in JWT verification.',
    reference: { ...RFC_7519, section: '4.1.3' },
  },
  {
    name: 'exp',
    label: 'Expiration Time',
    what: 'Seconds since the Unix epoch after which the token must be rejected.',
    detail:
      'Seconds, not milliseconds -- a JWT with a JavaScript timestamp in exp is valid for about fifty thousand years.',
    reference: { ...RFC_7519, section: '4.1.4' },
  },
  {
    name: 'nbf',
    label: 'Not Before',
    what: 'The token is not valid until this time.',
    reference: { ...RFC_7519, section: '4.1.5' },
  },
  {
    name: 'iat',
    label: 'Issued At',
    what: 'When the token was minted. Lets a relying party impose its own maximum age.',
    reference: { ...RFC_7519, section: '4.1.6' },
  },
  {
    name: 'jti',
    label: 'JWT ID',
    what: 'A unique id for this token, so a receiver can refuse to process it twice.',
    detail: 'The hook a revocation list or a replay defence hangs on.',
    reference: { ...RFC_7519, section: '4.1.7' },
  },
];

/** Look up one claim's explanation. */
export function explainClaim(name: string): ClaimExplanation | undefined {
  return JWT_CLAIMS.find((claim) => claim.name === name);
}

// ---------------------------------------------------------------------------
// PKCE (RFC 7636)
// ---------------------------------------------------------------------------

/** How the challenge was derived from the verifier. */
export type CodeChallengeMethod = 'S256' | 'plain';

/** A verifier and the challenge derived from it. */
export interface PkcePair {
  /** The secret. High-entropy, held by the client, sent only at the token endpoint. */
  readonly verifier: string;
  /** The public commitment. Sent in the authorization request, where anyone may see it. */
  readonly challenge: string;
  readonly method: CodeChallengeMethod;
}

/** The characters a code verifier may use -- the URI *unreserved* set (RFC 7636 s 4.1). */
const VERIFIER_CHARS = /^[A-Za-z0-9\-._~]+$/;

/** RFC 7636 s 4.1 -- a verifier is 43 to 128 characters. */
export const VERIFIER_MIN_LENGTH = 43;
/** RFC 7636 s 4.1 -- the upper bound. */
export const VERIFIER_MAX_LENGTH = 128;

/**
 * Check a code verifier against RFC 7636 s 4.1.
 *
 * The lower bound of 43 characters is not arbitrary: it is the length of 32 bytes encoded as
 * base64url, and 32 bytes is the entropy floor the specification sets. A short verifier is
 * guessable, and a guessable verifier removes the whole protection -- an attacker with the
 * intercepted code and a guessed verifier completes the exchange.
 *
 * The alphabet is restricted to unreserved URI characters so the value survives being put in
 * a form body without any encoding question arising.
 */
export function validateCodeVerifier(verifier: string): ParseResult<string> {
  if (verifier.length < VERIFIER_MIN_LENGTH) {
    return fail(
      `a code verifier is at least ${VERIFIER_MIN_LENGTH} characters (32 bytes of entropy); this is ${verifier.length}`,
    );
  }
  if (verifier.length > VERIFIER_MAX_LENGTH) {
    return fail(
      `a code verifier is at most ${VERIFIER_MAX_LENGTH} characters; this is ${verifier.length}`,
    );
  }
  if (!VERIFIER_CHARS.test(verifier)) {
    return fail('a code verifier may only use A-Z a-z 0-9 - . _ ~');
  }
  return ok(verifier);
}

/**
 * Derive the challenge from the verifier.
 *
 * `S256` is `BASE64URL(SHA256(ASCII(verifier)))`, and it is the whole mechanism. The client
 * publishes the challenge in a request that travels through the user's browser, keeps the
 * verifier, and reveals it only in the direct back-channel call to the token endpoint. An
 * observer of the authorization request holds a hash and cannot invert it.
 *
 * `plain` sends the verifier as the challenge, which protects nothing against an attacker who
 * can see the authorization request -- it is there only for clients that genuinely cannot
 * compute SHA-256, and RFC 7636 s 4.2 says S256 MUST be used if the client can. A server must
 * also refuse a `plain` token request when the authorization request said `S256`, or an
 * attacker simply downgrades; {@link verifyCodeVerifier} takes the method from the stored
 * authorization request for that reason.
 */
export function deriveCodeChallenge(
  verifier: string,
  method: CodeChallengeMethod = 'S256',
): string {
  return method === 'plain' ? verifier : base64UrlEncode(sha256Text(verifier));
}

/** A verifier plus the challenge it produces. */
export function createPkcePair(
  verifier: string,
  method: CodeChallengeMethod = 'S256',
): PkcePair {
  return { verifier, challenge: deriveCodeChallenge(verifier, method), method };
}

/**
 * The token endpoint's side: recompute the challenge and compare.
 *
 * `method` comes from what the *authorization* request declared, not from the token request,
 * which is what closes the downgrade. The comparison is constant-time for the same reason
 * every secret comparison in this module is.
 */
export function verifyCodeVerifier(
  storedChallenge: string,
  method: CodeChallengeMethod,
  presentedVerifier: string,
): boolean {
  return constantTimeEqual(
    storedChallenge,
    deriveCodeChallenge(presentedVerifier, method),
  );
}

// ---------------------------------------------------------------------------
// The authorization code flow
// ---------------------------------------------------------------------------

/** Who is acting at each rung of the ladder. */
export type OAuthActor = 'user' | 'client' | 'authorization-server' | 'resource-server';

/** Display labels, and what each party is trusted with. */
export const OAUTH_ACTORS: Readonly<Record<OAuthActor, { label: string; what: string }>> =
  {
    user: {
      label: 'User',
      what: 'The resource owner. Types a password into exactly one place -- the authorization server -- and never into the client.',
    },
    client: {
      label: 'Client app',
      what: 'The application wanting access. In a browser or a mobile app it is a *public* client: it cannot keep a secret, which is why PKCE exists.',
    },
    'authorization-server': {
      label: 'Authorization server',
      what: 'Authenticates the user, asks consent, and mints tokens. The only party that ever sees the password.',
    },
    'resource-server': {
      label: 'Resource server',
      what: 'The API holding the data. Sees only a token, and verifies it without a round trip.',
    },
  };

/** One rung of the ladder. */
export interface OAuthStep {
  readonly index: number;
  readonly from: OAuthActor;
  readonly to: OAuthActor;
  readonly title: string;
  /** What happens, in one or two sentences. */
  readonly what: string;
  /** The attack this step exists to prevent, when it exists to prevent one. */
  readonly defends?: string;
  /** The HTTP message, where this step is one. Some steps are local computation. */
  readonly request?: HttpRequest;
  readonly response?: HttpResponse;
  /** The full URL, for steps whose whole content is a URL. */
  readonly url?: string;
  readonly reference: RfcRef;
}

/** Everything a scenario must pin down for the flow to be deterministic. */
export interface AuthorizationCodeConfig {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scope: string;
  /** The CSRF token the client generates and later checks. */
  readonly state: string;
  /** The PKCE verifier. Supplied, never generated, so runs are reproducible. */
  readonly codeVerifier: string;
  readonly codeChallengeMethod?: CodeChallengeMethod;
  /** The code the authorization server issues. Supplied for the same reason. */
  readonly authorizationCode: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly resourceEndpoint: string;
  readonly issuer: string;
  /** The audience of the access token -- the resource server's identifier. */
  readonly audience: string;
  readonly subject: string;
  /** The signing secret for the access token. A literal; see the file header. */
  readonly secret: string;
  /** Virtual seconds since the epoch at which the flow runs. */
  readonly nowSeconds: number;
  readonly expiresInSeconds?: number;
  readonly refreshToken?: string;
}

/** The token endpoint's answer. */
export interface TokenResponse {
  readonly accessToken: string;
  readonly tokenType: 'Bearer';
  readonly expiresIn: number;
  readonly scope: string;
  readonly refreshToken?: string;
}

/** A complete run of the flow. */
export interface AuthorizationCodeFlow {
  readonly config: AuthorizationCodeConfig;
  readonly pkce: PkcePair;
  readonly steps: readonly OAuthStep[];
  readonly token: TokenResponse;
  readonly decodedAccessToken: DecodedJwt;
}

/**
 * Build the authorization code + PKCE ladder, end to end.
 *
 * The ordering matters and is the thing most diagrams get wrong. In particular, the
 * `code_challenge` goes out in step 3, **before** the user has authenticated and long before
 * any code exists. That is what makes it a commitment: the client binds itself to a secret at
 * a moment when it has nothing to gain by lying, and the authorization server stores the
 * challenge alongside the code it later issues.
 *
 * Two other properties are visible in the shape of the ladder rather than stated:
 *
 * - the user's password appears in exactly one step, and the client is not a party to it;
 * - the token never travels through the browser. The code does, and the code is useless
 *   without the verifier, which does not.
 */
export function runAuthorizationCodeFlow(
  config: AuthorizationCodeConfig,
): AuthorizationCodeFlow {
  const method = config.codeChallengeMethod ?? 'S256';
  const pkce = createPkcePair(config.codeVerifier, method);
  const expiresIn = config.expiresInSeconds ?? 900;

  const authorizeUrl = withQuery(config.authorizationEndpoint, [
    ['response_type', 'code'],
    ['client_id', config.clientId],
    ['redirect_uri', config.redirectUri],
    ['scope', config.scope],
    ['state', config.state],
    ['code_challenge', pkce.challenge],
    ['code_challenge_method', pkce.method],
  ]);

  const redirectBack = withQuery(config.redirectUri, [
    ['code', config.authorizationCode],
    ['state', config.state],
  ]);

  const tokenRequestBody = tokenRequestForm({
    code: config.authorizationCode,
    redirectUri: config.redirectUri,
    clientId: config.clientId,
    codeVerifier: config.codeVerifier,
  });

  const accessToken = encodeJwt({
    claims: {
      iss: config.issuer,
      sub: config.subject,
      aud: config.audience,
      iat: config.nowSeconds,
      exp: config.nowSeconds + expiresIn,
      scope: config.scope,
    },
    secret: config.secret,
  });

  const token: TokenResponse = {
    accessToken,
    tokenType: 'Bearer',
    expiresIn,
    scope: config.scope,
    ...(config.refreshToken === undefined ? {} : { refreshToken: config.refreshToken }),
  };

  const tokenResponseBody: JsonObject = {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: expiresIn,
    scope: config.scope,
    ...(config.refreshToken === undefined ? {} : { refresh_token: config.refreshToken }),
  };

  const steps: OAuthStep[] = [
    {
      index: 0,
      from: 'user',
      to: 'client',
      title: 'The user asks to connect an account',
      what: 'They click "Sign in with Example". No credential has been created or shared yet.',
      reference: RFC_6749_AUTH_CODE,
    },
    {
      index: 1,
      from: 'client',
      to: 'client',
      title: 'The client generates a code verifier and derives the challenge',
      what: `A high-entropy random string (${config.codeVerifier.length} characters) is kept private; ${
        method === 'S256' ? 'its SHA-256 digest, base64url-encoded,' : 'the string itself'
      } becomes the challenge that will be published.`,
      defends:
        'Nothing yet -- but this is the commitment. The client is fixing a secret before it has any reason to know which code it will receive.',
      reference: { ...RFC_7636, section: '4.1' },
    },
    {
      index: 2,
      from: 'client',
      to: 'authorization-server',
      title: 'Authorization request, through the user’s browser',
      what: 'The client sends the user to the authorization endpoint with its id, the redirect it expects back, the scope it wants, a state value, and the code challenge.',
      defends:
        'Anyone who reads this URL -- and it is in browser history and server logs -- learns the challenge and cannot reverse it into the verifier.',
      url: authorizeUrl,
      request: request({ method: 'GET', target: authorizeUrl }),
      reference: { ...RFC_6749, section: '4.1.1' },
    },
    {
      index: 3,
      from: 'authorization-server',
      to: 'user',
      title: 'The user authenticates and consents',
      what: 'The password is typed here and only here. The authorization server shows which scopes the client asked for and asks the user to agree.',
      defends:
        'The client never sees the password. That single property is the reason OAuth exists rather than asking users to hand over credentials.',
      reference: { ...RFC_6749, section: '4.1.1' },
    },
    {
      index: 4,
      from: 'authorization-server',
      to: 'client',
      title: 'Redirect back with an authorization code',
      what: 'A 302 sends the browser to the client’s redirect URI, carrying a short-lived, single-use code and the state value unchanged.',
      defends:
        'The code travels through the browser, which is exactly why it must be worth nothing on its own. It is not a token and cannot be sent to the API.',
      url: redirectBack,
      response: response({
        status: 302,
        reason: 'Found',
        headers: [header('Location', redirectBack)],
      }),
      reference: { ...RFC_6749, section: '4.1.2' },
    },
    {
      index: 5,
      from: 'client',
      to: 'client',
      title: 'The client checks that state came back unchanged',
      what: `The returned state must equal the value sent in step 3 (${config.state}).`,
      defends:
        'Cross-site request forgery on the redirect: without this check, an attacker can hand a victim a link that logs them into the attacker’s account.',
      reference: { ...RFC_6749, section: '10.12' },
    },
    {
      index: 6,
      from: 'client',
      to: 'authorization-server',
      title: 'Token request, on a direct back channel',
      what: 'A form-encoded POST straight from the client to the token endpoint, carrying the code and -- for the first time -- the code verifier.',
      defends:
        'This request does not pass through the browser. The verifier is revealed only here, to the one party that needs it.',
      request: formRequest(config.tokenEndpoint, tokenRequestBody),
      reference: { ...RFC_6749, section: '4.1.3' },
    },
    {
      index: 7,
      from: 'authorization-server',
      to: 'authorization-server',
      title: 'The server recomputes the challenge from the verifier',
      what: `${
        method === 'S256'
          ? 'SHA-256 of the presented verifier, base64url-encoded,'
          : 'The presented verifier'
      } must equal the challenge stored with the code in step 3. It does.`,
      defends:
        'An attacker who stole the code in step 5 cannot get past here: they hold the code and the challenge, and neither yields the verifier.',
      reference: { ...RFC_7636, section: '4.6' },
    },
    {
      index: 8,
      from: 'authorization-server',
      to: 'client',
      title: 'Access token issued',
      what: `A bearer token scoped to "${config.scope}", valid for ${expiresIn} seconds${
        config.refreshToken ? ', with a refresh token for renewing it' : ''
      }.`,
      defends:
        'Cache-Control: no-store is required on this response -- a token in a shared cache is a token anyone can take.',
      response: withJsonBody(
        response({
          status: 200,
          reason: reasonPhrase(200),
          headers: [header('Cache-Control', 'no-store'), header('Pragma', 'no-cache')],
        }),
        tokenResponseBody,
      ),
      reference: { ...RFC_6749, section: '4.1.4' },
    },
    {
      index: 9,
      from: 'client',
      to: 'resource-server',
      title: 'The API call the whole flow was for',
      what: 'The token goes in the Authorization header as a Bearer credential.',
      defends:
        'RFC 6750 s 2.3 deprecates putting the token in a query parameter, for every reason listed under API keys above.',
      request: request({
        method: 'GET',
        target: config.resourceEndpoint,
        headers: [header('Authorization', `Bearer ${accessToken}`)],
      }),
      reference: { ...RFC_6750, section: '2.1' },
    },
    {
      index: 10,
      from: 'resource-server',
      to: 'client',
      title: 'The resource server verifies the token and answers',
      what: 'It checks the signature, the expiry, the issuer, and that it is itself the audience -- all without contacting the authorization server.',
      defends:
        'Verifying the audience is what stops a token minted for another API being replayed here.',
      response: withJsonBody(response({ status: 200, reason: reasonPhrase(200) }), {
        sub: config.subject,
        scope: config.scope,
      }),
      reference: { ...RFC_6750, section: '3' },
    },
  ];

  const decoded = decodeJwt(accessToken);
  // Unreachable: encodeJwt produced this token two dozen lines above.
  if (!decoded.ok) throw new Error(`generated an undecodable token: ${decoded.error}`);

  return { config, pkce, steps, token, decodedAccessToken: decoded.value };
}

function tokenRequestForm(init: {
  code: string;
  redirectUri: string;
  clientId: string;
  codeVerifier?: string;
}): string {
  const pairs: (readonly [string, string])[] = [
    ['grant_type', 'authorization_code'],
    ['code', init.code],
    ['redirect_uri', init.redirectUri],
    ['client_id', init.clientId],
  ];
  if (init.codeVerifier !== undefined) pairs.push(['code_verifier', init.codeVerifier]);
  return pairs
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

function formRequest(endpoint: string, body: string): HttpRequest {
  return {
    method: 'POST',
    target: endpoint,
    headers: [
      header('Content-Type', 'application/x-www-form-urlencoded'),
      header('Content-Length', `${utf8Bytes(body).length}`),
    ],
    body,
  };
}

// ---------------------------------------------------------------------------
// The attack PKCE stops
// ---------------------------------------------------------------------------

/** What happened when an attacker tried to spend a stolen code. */
export interface InterceptionOutcome {
  /** The request the attacker sent: the real code, no verifier. */
  readonly request: HttpRequest;
  readonly response: HttpResponse;
  /** True when the exchange was refused -- which it must be. */
  readonly refused: boolean;
  readonly why: string;
  /** What the attacker had, and what it was worth. */
  readonly attackerHeld: readonly string[];
}

/**
 * Run the attack the whole mechanism exists for.
 *
 * The premise is not exotic. On mobile, custom URL schemes are first-come-first-served, so a
 * malicious app can register the same `myapp://callback` and receive the redirect. In a
 * browser, the code sits in a URL that lands in history, in referrers, and in any log along
 * the way. Assume the attacker has the code; that is the design assumption, not a worst case.
 *
 * Without PKCE the code is enough and the attacker gets a token. With it, the token endpoint
 * asks for the verifier -- a value that never travelled through the browser -- and the
 * attacker has nothing to send. The response is `400 invalid_grant`.
 *
 * The `omitVerifier: false` variant models an attacker who tries a *guess*, which fails for
 * the reason the 43-character minimum exists.
 */
export function interceptAuthorizationCode(
  flow: AuthorizationCodeFlow,
  options: { readonly guessedVerifier?: string } = {},
): InterceptionOutcome {
  const guess = options.guessedVerifier;
  const body = tokenRequestForm({
    code: flow.config.authorizationCode,
    redirectUri: flow.config.redirectUri,
    clientId: flow.config.clientId,
    ...(guess === undefined ? {} : { codeVerifier: guess }),
  });
  const attackerRequest = formRequest(flow.config.tokenEndpoint, body);

  const attackerHeld = [
    `the authorization code (${flow.config.authorizationCode})`,
    `the code challenge (${flow.pkce.challenge})`,
    'the client id and redirect URI, both public',
  ];

  if (guess === undefined) {
    return {
      request: attackerRequest,
      response: oauthError(
        400,
        'invalid_grant',
        'This code was issued with a code_challenge; a code_verifier is required.',
      ),
      refused: true,
      why: 'The attacker has the code and the challenge and cannot produce the verifier: the challenge is a SHA-256 digest, and inverting it is the problem the hash exists to be hard at.',
      attackerHeld,
    };
  }

  const matches = verifyCodeVerifier(flow.pkce.challenge, flow.pkce.method, guess);
  return {
    request: attackerRequest,
    response: matches
      ? oauthError(
          500,
          'server_error',
          'A guessed verifier matched -- impossible with 32 bytes of entropy.',
        )
      : oauthError(
          400,
          'invalid_grant',
          'code_verifier does not match the stored code_challenge.',
        ),
    refused: !matches,
    why: matches
      ? 'The guess matched, which only happens if the verifier had far too little entropy. This is what the 43-character minimum prevents.'
      : 'The guessed verifier hashes to something other than the stored challenge, so the exchange is refused.',
    attackerHeld: [...attackerHeld, `a guessed verifier (${guess.length} characters)`],
  };
}

/**
 * An OAuth error response.
 *
 * OAuth predates RFC 9457 and defines its own error shape (RFC 6749 s 5.2): a JSON object
 * with `error`, and optionally `error_description` and `error_uri`. The `error` value comes
 * from a fixed list, which is the part that matters -- a client can branch on `invalid_grant`
 * without parsing English.
 */
export function oauthError(
  status: number,
  code: string,
  description: string,
): HttpResponse {
  return withJsonBody(
    response({
      status,
      reason: reasonPhrase(status),
      headers: [header('Cache-Control', 'no-store')],
    }),
    { error: code, error_description: description },
  );
}
