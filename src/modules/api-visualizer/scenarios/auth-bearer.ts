/**
 * Scenario 2 -- who is calling, and how the API decides.
 *
 * Ten requests against the same two resources, differing only in what they carry in place of
 * a credential. The point is not that authentication exists; it is that the *failures* are
 * distinguishable, and that a client can act on the difference.
 *
 * Four things are demonstrated rather than described.
 *
 * 1. **`401` and `403` are different questions.** `401` means *I do not know who you are* --
 *    present a credential and you may succeed. `403` means *I know exactly who you are and
 *    the answer is still no* -- presenting the same credential again will never work. An API
 *    that answers `403` to a missing token sends clients into a pointless retry loop; one
 *    that answers `401` to a permission failure sends them to re-authenticate for nothing.
 * 2. **A key in the query string is the same secret in a worse place.** Both requests
 *    succeed and both are correct HTTP. The difference is how many systems keep a copy: a URL
 *    is recorded by every proxy, load balancer, and access log in the path, saved in browser
 *    history, and pasted into support tickets. A header is not.
 * 3. **The payload of a JWT is readable by anyone holding it.** The valid token below carries
 *    an email address and an internal plan name on purpose. The panel decodes them with no
 *    secret whatsoever -- and that is the whole of the lesson, because it is exactly what an
 *    attacker who steals the token does next.
 * 4. **`alg` must be decided before the token is read.** The last request presents a token
 *    signed with nothing at all, whose header says `"alg": "none"`. A verifier that reads the
 *    algorithm out of the token and obeys it accepts a token the attacker wrote. The verifier
 *    here decides on `HS256` in advance, so the check fails at the first step.
 *
 * Every token is built at module load by {@link encodeJwt} from claims written below, so the
 * signatures are real HMACs over real bytes and the run replays identically.
 */

import { base64UrlEncodeText } from '../sim/digest';
import { encodeJwt } from '../sim/auth';
import type { ApiScenario } from '../sim/exchange';
import type { JsonObject } from '../sim/message';

import {
  API_HOST,
  AUDIENCE,
  ISSUER,
  SCENARIO_EPOCH_SECONDS,
  SIGNING_SECRET,
  seedStore,
} from './common';

/** The key the mock API recognises, and what it is allowed to do. */
const API_KEY = 'sk_live_2f9c41e0b7d8a3';

/**
 * The claims of a token that should verify.
 *
 * `email` and `plan` are here deliberately and are exactly what should not be. They are
 * readable by anybody holding the token, and the panel proves it by reading them without a
 * secret. A JWT is a bad place for a user's email address, an internal id you would rather
 * not publish, or a feature flag that names an unreleased product.
 */
const VALID_CLAIMS: JsonObject = {
  iss: ISSUER,
  sub: 'user_17',
  aud: AUDIENCE,
  exp: SCENARIO_EPOCH_SECONDS + 900,
  iat: SCENARIO_EPOCH_SECONDS - 60,
  jti: 'jwt_4c1f90',
  scope: 'articles:read articles:write',
  email: 'ada@example.com',
  plan: 'internal-beta-2026',
};

/** A token that verifies against every check. */
const VALID_TOKEN = encodeJwt({ claims: VALID_CLAIMS, secret: SIGNING_SECRET });

/** The same token, minted before this run and long since expired. */
const EXPIRED_TOKEN = encodeJwt({
  claims: {
    ...VALID_CLAIMS,
    exp: SCENARIO_EPOCH_SECONDS - 60,
    iat: SCENARIO_EPOCH_SECONDS - 960,
  },
  secret: SIGNING_SECRET,
});

/** A perfectly valid token -- for a different API. */
const WRONG_AUDIENCE_TOKEN = encodeJwt({
  claims: { ...VALID_CLAIMS, aud: 'https://reports.example' },
  secret: SIGNING_SECRET,
});

/**
 * The valid token with an edited payload and the original signature.
 *
 * This is what tampering looks like: the attacker can read the claims, can rewrite them, and
 * cannot produce a signature over the result. The signature check is the only thing standing
 * between the two, which is why "the payload is tamper-evident" is a much narrower claim than
 * "the payload is protected".
 */
const TAMPERED_TOKEN = (() => {
  const parts = VALID_TOKEN.split('.');
  const forgedPayload = base64UrlEncodeText(
    JSON.stringify({
      ...VALID_CLAIMS,
      sub: 'user_1',
      scope: 'articles:read articles:write admin',
    }),
  );
  return `${parts[0]}.${forgedPayload}.${parts[2]}`;
})();

/**
 * A token signed with nothing, whose header says so.
 *
 * RFC 7515 registers `"none"` for tokens whose integrity is assured by other means -- a
 * token handed between two processes on one machine, say. Presented to a verifier over a
 * network it is simply an unsigned assertion, and a library that read `alg` from the token
 * and dispatched on it would accept it.
 */
const UNSIGNED_TOKEN = (() => {
  const head = base64UrlEncodeText(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = base64UrlEncodeText(
    JSON.stringify({
      ...VALID_CLAIMS,
      sub: 'user_1',
      scope: 'articles:read articles:write admin',
    }),
  );
  return `${head}.${payload}.`;
})();

/** The API key, four bearer tokens, and the ten answers they earn. */
export const AUTH_BEARER: ApiScenario = {
  id: 'auth-bearer',
  title: 'API keys and bearer tokens',
  summary:
    'The same two endpoints called ten ways: with nothing, with an API key in a header and ' +
    'then in the query string, and with four bearer tokens of which one verifies. Each ' +
    'refusal carries the status that says what the client should do next.',
  teaches: [
    '401 means the caller is unknown; 403 means the caller is known and refused',
    'A 401 owes the client a WWW-Authenticate field naming the scheme to use',
    'A key in the query string leaks into logs, history, referrers, and support tickets',
    'A JWT payload is base64url -- encoded, not encrypted, and readable by anyone holding it',
    'The signature makes the payload tamper-evident, not confidential',
    'The verifier must decide which algorithms it accepts before it reads the token',
  ],
  apiHost: API_HOST,
  plan: {
    kind: 'auth',
    store: seedStore(),
    keys: [{ key: API_KEY, subject: 'acct_842', scopes: ['articles:read'] }],
    verify: {
      secret: SIGNING_SECRET,
      nowSeconds: SCENARIO_EPOCH_SECONDS,
      issuer: ISSUER,
      audience: AUDIENCE,
      clockSkewSeconds: 30,
      allowedAlgorithms: ['HS256'],
    },
    steps: [
      {
        id: 'anonymous',
        title: 'No credential at all',
        intent:
          'The baseline. The gateway cannot know who is asking, so it says so in the one status that invites a retry -- and names the scheme to retry with.',
        method: 'GET',
        target: '/articles',
        credential: { kind: 'none' },
      },
      {
        id: 'key-header',
        title: 'API key in a header',
        intent:
          'The same secret, in the place that does not get written down by anything else in the path.',
        method: 'GET',
        target: '/articles',
        afterMs: 250,
        credential: { kind: 'api-key', value: API_KEY, placement: 'header' },
        requiredScope: 'articles:read',
      },
      {
        id: 'key-query',
        title: 'API key in the query string',
        intent:
          'Identical result, identical secret. Look at the request-target: the key is now part of a URL, and a URL is infrastructure metadata.',
        method: 'GET',
        target: '/articles',
        afterMs: 250,
        credential: { kind: 'api-key', value: API_KEY, placement: 'query' },
        requiredScope: 'articles:read',
      },
      {
        id: 'key-scope',
        title: 'API key without the scope to write',
        intent:
          'The key is recognised and names an account. It simply is not allowed to do this, and no amount of retrying will change that.',
        method: 'POST',
        target: '/articles',
        afterMs: 250,
        credential: { kind: 'api-key', value: API_KEY, placement: 'header' },
        requiredScope: 'articles:write',
        body: { title: 'Draft', body: 'Written by a key that may only read.' },
      },
      {
        id: 'bearer-valid',
        title: 'Bearer token, read',
        intent:
          'A signed token. The gateway verifies it against a secret it decided on in advance, and learns who this is without asking any other service.',
        method: 'GET',
        target: '/articles/1',
        afterMs: 300,
        credential: { kind: 'bearer', token: VALID_TOKEN, label: 'valid' },
        requiredScope: 'articles:read',
      },
      {
        id: 'bearer-write',
        title: 'Bearer token, write',
        intent:
          'The same token carries articles:write in its scope claim, so the gateway lets this one through to the application.',
        method: 'POST',
        target: '/articles',
        afterMs: 250,
        credential: { kind: 'bearer', token: VALID_TOKEN, label: 'valid' },
        requiredScope: 'articles:write',
        body: {
          title: 'Tokens expire, and that is the feature',
          body: 'A stateless credential cannot be revoked, so it has to run out instead.',
          published: false,
        },
      },
      {
        id: 'bearer-expired',
        title: 'Bearer token, expired',
        intent:
          'The signature is still perfectly good. The token simply says it stopped being valid before this request was made.',
        method: 'GET',
        target: '/articles/1',
        afterMs: 250,
        credential: { kind: 'bearer', token: EXPIRED_TOKEN, label: 'expired' },
      },
      {
        id: 'bearer-audience',
        title: 'Bearer token, minted for another API',
        intent:
          'A genuine token from the right issuer, signed with the right key, addressed to somebody else. Skipping this check is the most consequential omission in JWT verification.',
        method: 'GET',
        target: '/articles/1',
        afterMs: 250,
        credential: {
          kind: 'bearer',
          token: WRONG_AUDIENCE_TOKEN,
          label: 'wrong audience',
        },
      },
      {
        id: 'bearer-tampered',
        title: 'Bearer token, payload edited',
        intent:
          'The claims were rewritten to grant an admin scope and the original signature was left in place. Decoding still works; verifying does not.',
        method: 'GET',
        target: '/articles/1',
        afterMs: 250,
        credential: { kind: 'bearer', token: TAMPERED_TOKEN, label: 'tampered' },
      },
      {
        id: 'bearer-none',
        title: 'Bearer token signed with nothing',
        intent:
          'The header says alg: none and the signature segment is empty. A verifier that trusted the token about which algorithm to use would accept this.',
        method: 'GET',
        target: '/articles/1',
        afterMs: 250,
        credential: { kind: 'bearer', token: UNSIGNED_TOKEN, label: 'alg: none' },
      },
    ],
  },
  notes: [
    {
      phase: 'anonymous',
      text: 'The WWW-Authenticate field is what makes a 401 actionable: it names the scheme the client should use. RFC 9110 requires it, and APIs using bare keys routinely omit it because there is no registered scheme for an API key -- an honest wrinkle, and one more small argument for bearer tokens, which have "Bearer" and no such excuse.',
      reference: {
        rfc: 9110,
        section: '15.5.2',
        title: 'HTTP Semantics: 401 Unauthorized',
      },
    },
    {
      phase: 'key-query',
      text: 'Nothing failed here, and that is the point. A URL is recorded by every proxy, CDN, load balancer, and web server in the path; it is saved in browser history, sent onward in Referer, and pasted into bug reports without anybody thinking of it as a secret. The key is the same secret in both requests -- the difference is the number of systems that now hold a copy of it by design. RFC 6750 s 2.3 reaches the same conclusion about bearer tokens in a query and says the practice SHOULD NOT be used.',
      reference: {
        rfc: 6750,
        section: '2.3',
        title: 'The OAuth 2.0 Bearer Token Usage: URI Query Parameter',
      },
    },
    {
      phase: 'key-scope',
      text: 'This is the 403, and it is the one people get wrong. The key was recognised: the gateway knows this is account acct_842. What it lacks is permission, so retrying with the same key is a promise to fail again. Answering 401 here would tell the client to go and re-authenticate, which it has already done correctly.',
      reference: { rfc: 9110, section: '15.5.4', title: 'HTTP Semantics: 403 Forbidden' },
    },
    {
      phase: 'bearer-valid',
      text: 'Open the decoded token beside this request. The payload was read by splitting on dots and base64url-decoding one segment -- no key, no secret, no server. Anyone who holds this token can read every claim in it, including the email address and the internal plan name, and this page just did so. The signature makes the payload tamper-evident; it does not make it confidential.',
      reference: { rfc: 7519, section: '3', title: 'JSON Web Token (JWT): JWT Claims' },
    },
    {
      phase: 'bearer-expired',
      text: 'Nothing was consulted to reach this answer except the clock. There is no step in JWT verification that asks the server whether the token is still good -- which is exactly what makes it fast, and exactly why logging a user out, banning them, or revoking a grant does not invalidate tokens already issued. Short lifetimes plus a refresh token is the usual answer; a denylist gives back the database lookup the design was avoiding.',
      reference: { rfc: 7519, section: '4.1.4', title: 'JSON Web Token (JWT): exp' },
    },
    {
      phase: 'bearer-audience',
      text: 'aud is the check that stops a token minted for one service being replayed at another. Without it, any service that shares a signing key with this one -- an internal reporting API, a staging environment -- becomes a way to mint credentials for this one.',
      reference: { rfc: 7519, section: '4.1.3', title: 'JSON Web Token (JWT): aud' },
    },
    {
      phase: 'bearer-none',
      text: 'This is the classic JWT vulnerability, and it is a design problem rather than an implementation bug: the token states which algorithm was used, and a library that obeys it has let the attacker choose. The fix is the one applied here -- the verifier lists the algorithms it accepts before it looks at anything, and a token claiming any other is rejected at the first check.',
      reference: { rfc: 7515, section: '4.1.1', title: 'JSON Web Signature (JWS): alg' },
    },
  ],
};
