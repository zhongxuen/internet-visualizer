import { describe, expect, it } from 'vitest';

import { base64UrlEncodeText } from './digest';
import {
  headerValue,
  parseTarget,
  queryParam,
  request,
  type HttpRequest,
} from './message';
import {
  API_KEY_PLACEMENTS,
  applyApiKey,
  createPkcePair,
  decodeJwt,
  deriveCodeChallenge,
  encodeJwt,
  explainClaim,
  extractApiKey,
  interceptAuthorizationCode,
  JWT_ALG_NONE_WARNING,
  JWT_CLAIMS,
  JWT_PAYLOAD_NOT_ENCRYPTED,
  runAuthorizationCodeFlow,
  validateCodeVerifier,
  verifyApiKey,
  verifyCodeVerifier,
  verifyJwt,
  VERIFIER_MAX_LENGTH,
  VERIFIER_MIN_LENGTH,
  type AuthorizationCodeConfig,
} from './auth';

const SECRET = 'a-scenario-literal-not-a-real-secret';
const NOW = 1_700_000_000;

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

describe('API key placement', () => {
  const bare = (): HttpRequest => request({ method: 'GET', target: '/v1/articles' });

  it('puts a header key in a header and leaves the URL alone', () => {
    const signed = applyApiKey(bare(), 'sk_test_123', 'header');
    expect(headerValue(signed.headers, 'X-API-Key')).toBe('sk_test_123');
    expect(signed.target).toBe('/v1/articles');
  });

  it('puts a query key in the URL, where everything logs it', () => {
    const signed = applyApiKey(bare(), 'sk_test_123', 'query');
    expect(signed.target).toBe('/v1/articles?api_key=sk_test_123');
    expect(headerValue(signed.headers, 'X-API-Key')).toBeUndefined();
  });

  it('reads the key back from either placement', () => {
    expect(extractApiKey(applyApiKey(bare(), 'k', 'header'), 'header')).toBe('k');
    expect(extractApiKey(applyApiKey(bare(), 'k', 'query'), 'query')).toBe('k');
  });

  it('preserves an existing query string when appending the key', () => {
    const withQuery = request({ method: 'GET', target: '/v1/articles?limit=3' });
    const signed = applyApiKey(withQuery, 'k', 'query');
    const target = parseTarget(signed.target);
    expect(queryParam(target, 'limit')).toBe('3');
    expect(queryParam(target, 'api_key')).toBe('k');
  });

  it('names the specific places a query key leaks to', () => {
    const query = API_KEY_PLACEMENTS.find((entry) => entry.placement === 'query');
    expect(query?.verdict).toBe('avoid');
    expect(query?.leaks.length).toBeGreaterThanOrEqual(4);
    expect(query?.leaks.join(' ')).toMatch(/Referer/);
    expect(query?.leaks.join(' ')).toMatch(/log/i);
  });
});

describe('verifyApiKey', () => {
  const keys = [{ key: 'sk_live_good', subject: 'acct_1', scopes: ['articles:read'] }];
  const signed = (key: string) =>
    applyApiKey(request({ method: 'GET', target: '/v1/articles' }), key, 'header');

  it('accepts a known key', () => {
    const verdict = verifyApiKey(signed('sk_live_good'), { keys, placement: 'header' });
    expect(verdict.authenticated).toBe(true);
    expect(verdict.subject).toBe('acct_1');
  });

  it('answers 401 when no credential arrived, with WWW-Authenticate', () => {
    const verdict = verifyApiKey(request({ method: 'GET', target: '/v1/articles' }), {
      keys,
      placement: 'header',
    });
    expect(verdict.response?.status).toBe(401);
    expect(
      headerValue(verdict.response?.headers ?? [], 'WWW-Authenticate'),
    ).toBeDefined();
  });

  it('answers 401 for an unrecognised key -- it names nobody to refuse', () => {
    expect(
      verifyApiKey(signed('sk_live_wrong'), { keys, placement: 'header' }).response
        ?.status,
    ).toBe(401);
  });

  it('answers 403 for a known key without the scope -- retrying will never help', () => {
    const verdict = verifyApiKey(signed('sk_live_good'), {
      keys,
      placement: 'header',
      requiredScope: 'articles:write',
    });
    expect(verdict.response?.status).toBe(403);
    expect(verdict.subject).toBe('acct_1');
  });
});

// ---------------------------------------------------------------------------
// JWT
// ---------------------------------------------------------------------------

const claims = {
  iss: 'https://auth.example.com',
  sub: 'user_42',
  aud: 'https://api.example.com',
  iat: NOW,
  exp: NOW + 900,
};

describe('decodeJwt', () => {
  const token = encodeJwt({ claims, secret: SECRET });

  it('produces three dot-separated segments', () => {
    expect(token.split('.')).toHaveLength(3);
  });

  it('reads every claim without being given a secret', () => {
    // This is the lesson, not a convenience: decoding needs no key, so a JWT payload is
    // readable by anyone holding the token.
    const decoded = decodeJwt(token);
    expect(decoded.ok && decoded.value.claims).toEqual(claims);
  });

  it('decodes the header, which declares the algorithm', () => {
    const decoded = decodeJwt(token);
    expect(decoded.ok && decoded.value.header).toEqual({ alg: 'HS256', typ: 'JWT' });
  });

  it('exposes the signing input, which is the encoded segments and not the JSON', () => {
    const decoded = decodeJwt(token);
    expect(decoded.ok && decoded.value.signingInput).toBe(
      `${token.split('.')[0]}.${token.split('.')[1]}`,
    );
  });

  it('keeps the raw segments so the encoded and decoded forms can be shown together', () => {
    const decoded = decodeJwt(token);
    expect(decoded.ok && decoded.value.segments.payload).toBe(token.split('.')[1]);
    expect(decoded.ok && decoded.value.payloadJson).toContain('"sub": "user_42"');
  });

  it('decodes a token signed with a different secret just as happily', () => {
    // Decoding is not verification, and conflating the two is the mistake the split exists
    // to prevent.
    const foreign = encodeJwt({ claims, secret: 'some-other-key' });
    const decoded = decodeJwt(foreign);
    expect(decoded.ok && decoded.value.claims.sub).toBe('user_42');
  });

  it('never emits base64 padding on a segment', () => {
    expect(token).not.toContain('=');
  });

  it.each([
    ['one segment', 'abc'],
    ['two segments', 'abc.def'],
    ['four segments', 'a.b.c.d'],
  ])('rejects a token with %s', (_label, bad) => {
    expect(decodeJwt(bad).ok).toBe(false);
  });

  it('rejects a segment that is not base64url', () => {
    expect(decodeJwt('a+b.c.d').ok).toBe(false);
  });

  it('rejects a segment that decodes to something that is not JSON', () => {
    const bad = `${base64UrlEncodeText('{"alg":"HS256"}')}.${base64UrlEncodeText('not json')}.sig`;
    const result = decodeJwt(bad);
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining('payload is not JSON'),
    });
  });

  it('rejects a payload that is an array rather than an object', () => {
    const bad = `${base64UrlEncodeText('{"alg":"HS256"}')}.${base64UrlEncodeText('[1,2]')}.sig`;
    expect(decodeJwt(bad).ok).toBe(false);
  });

  it('states that the payload is encoded and not encrypted', () => {
    expect(JWT_PAYLOAD_NOT_ENCRYPTED).toMatch(/encoded, not encrypted/);
    expect(JWT_PAYLOAD_NOT_ENCRYPTED).toMatch(/tamper-evident/);
  });

  it('explains every registered claim of RFC 7519 s 4.1', () => {
    expect(JWT_CLAIMS.map((claim) => claim.name)).toEqual([
      'iss',
      'sub',
      'aud',
      'exp',
      'nbf',
      'iat',
      'jti',
    ]);
    for (const claim of JWT_CLAIMS) expect(claim.reference.rfc).toBe(7519);
    expect(explainClaim('aud')?.label).toBe('Audience');
  });
});

describe('verifyJwt', () => {
  const decode = (token: string) => {
    const decoded = decodeJwt(token);
    if (!decoded.ok) throw new Error(decoded.error);
    return decoded.value;
  };
  const options = {
    secret: SECRET,
    nowSeconds: NOW,
    issuer: claims.iss,
    audience: claims.aud,
  };

  it('accepts a well-formed, unexpired, correctly addressed token', () => {
    const verdict = verifyJwt(decode(encodeJwt({ claims, secret: SECRET })), options);
    expect(verdict.valid).toBe(true);
    expect(verdict.checks.every((check) => check.passed)).toBe(true);
  });

  it('detects a tampered payload', () => {
    const token = encodeJwt({ claims, secret: SECRET });
    const forged = `${token.split('.')[0]}.${base64UrlEncodeText(
      JSON.stringify({ ...claims, sub: 'user_1' }),
    )}.${token.split('.')[2]}`;
    const verdict = verifyJwt(decode(forged), options);
    expect(verdict.valid).toBe(false);
    expect(verdict.checks.find((check) => check.name === 'signature')?.passed).toBe(
      false,
    );
  });

  it('rejects the wrong secret', () => {
    const verdict = verifyJwt(decode(encodeJwt({ claims, secret: 'wrong' })), options);
    expect(verdict.checks.find((check) => check.name === 'signature')?.passed).toBe(
      false,
    );
  });

  it('rejects an expired token', () => {
    const verdict = verifyJwt(decode(encodeJwt({ claims, secret: SECRET })), {
      ...options,
      nowSeconds: NOW + 901,
    });
    expect(verdict.valid).toBe(false);
    expect(verdict.checks.find((check) => check.name === 'exp')?.passed).toBe(false);
  });

  it('rejects a token with no exp at all', () => {
    const token = encodeJwt({ claims: { sub: 'user_42' }, secret: SECRET });
    const verdict = verifyJwt(decode(token), { secret: SECRET, nowSeconds: NOW });
    expect(verdict.checks.find((check) => check.name === 'exp')?.passed).toBe(false);
  });

  it('rejects a token that is not yet valid', () => {
    const token = encodeJwt({ claims: { ...claims, nbf: NOW + 60 }, secret: SECRET });
    expect(
      verifyJwt(decode(token), options).checks.find((c) => c.name === 'nbf')?.passed,
    ).toBe(false);
  });

  it('rejects a token minted for a different audience', () => {
    const token = encodeJwt({
      claims: { ...claims, aud: 'https://other.example.com' },
      secret: SECRET,
    });
    const verdict = verifyJwt(decode(token), options);
    expect(verdict.valid).toBe(false);
    expect(verdict.checks.find((check) => check.name === 'aud')?.passed).toBe(false);
  });

  it('accepts an audience array containing this API', () => {
    const token = encodeJwt({
      claims: { ...claims, aud: ['https://other.example.com', claims.aud] },
      secret: SECRET,
    });
    expect(verifyJwt(decode(token), options).valid).toBe(true);
  });

  it('rejects a token from an untrusted issuer', () => {
    const token = encodeJwt({
      claims: { ...claims, iss: 'https://evil.example' },
      secret: SECRET,
    });
    expect(
      verifyJwt(decode(token), options).checks.find((c) => c.name === 'iss')?.passed,
    ).toBe(false);
  });

  it('refuses alg: none, however confidently the token asserts it', () => {
    const forged = `${base64UrlEncodeText('{"alg":"none"}')}.${base64UrlEncodeText(
      JSON.stringify(claims),
    )}.`;
    const verdict = verifyJwt(decode(forged), options);
    expect(verdict.valid).toBe(false);
    expect(verdict.checks.find((check) => check.name === 'alg')?.passed).toBe(false);
    expect(JWT_ALG_NONE_WARNING).toMatch(/before it looks at the token/);
  });

  it('reports every check, not only the first failure', () => {
    const token = encodeJwt({ claims: { ...claims, aud: 'elsewhere' }, secret: 'wrong' });
    const verdict = verifyJwt(decode(token), { ...options, nowSeconds: NOW + 5000 });
    expect(verdict.checks.filter((check) => !check.passed).length).toBeGreaterThanOrEqual(
      3,
    );
    expect(verdict.checks).toHaveLength(6);
  });

  it('tolerates a small clock difference when told to', () => {
    const decoded = decode(encodeJwt({ claims, secret: SECRET }));
    expect(verifyJwt(decoded, { ...options, nowSeconds: NOW + 905 }).valid).toBe(false);
    expect(
      verifyJwt(decoded, { ...options, nowSeconds: NOW + 905, clockSkewSeconds: 30 })
        .valid,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PKCE
// ---------------------------------------------------------------------------

describe('PKCE challenge and verifier', () => {
  /**
   * RFC 7636 Appendix B. This single pair proves the whole chain -- UTF-8 encoding, SHA-256,
   * and unpadded base64url -- against a value published by the specification rather than
   * produced by this code.
   */
  const RFC_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const RFC_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

  it('matches the RFC 7636 Appendix B vector', () => {
    expect(deriveCodeChallenge(RFC_VERIFIER, 'S256')).toBe(RFC_CHALLENGE);
  });

  it('is a pure function: the same verifier always gives the same challenge', () => {
    expect(deriveCodeChallenge(RFC_VERIFIER)).toBe(deriveCodeChallenge(RFC_VERIFIER));
  });

  it('gives a completely different challenge for a one-character change', () => {
    const near = `${RFC_VERIFIER.slice(0, -1)}X`;
    const challenge = deriveCodeChallenge(near);
    expect(challenge).not.toBe(RFC_CHALLENGE);
    const shared = [...challenge].filter((c, i) => c === RFC_CHALLENGE[i]).length;
    expect(shared).toBeLessThan(challenge.length / 2);
  });

  it('never equals the verifier under S256 -- the challenge reveals nothing', () => {
    expect(deriveCodeChallenge(RFC_VERIFIER, 'S256')).not.toBe(RFC_VERIFIER);
  });

  it('is exactly the verifier under plain, which is why plain protects nothing', () => {
    expect(deriveCodeChallenge(RFC_VERIFIER, 'plain')).toBe(RFC_VERIFIER);
  });

  it('produces a 43-character challenge: 32 bytes, base64url, unpadded', () => {
    const challenge = deriveCodeChallenge(RFC_VERIFIER);
    expect(challenge).toHaveLength(43);
    expect(challenge).not.toContain('=');
    expect(challenge).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it('pairs a verifier with its challenge', () => {
    const pair = createPkcePair(RFC_VERIFIER);
    expect(pair).toEqual({
      verifier: RFC_VERIFIER,
      challenge: RFC_CHALLENGE,
      method: 'S256',
    });
  });

  it('verifies the matching verifier and nothing else', () => {
    expect(verifyCodeVerifier(RFC_CHALLENGE, 'S256', RFC_VERIFIER)).toBe(true);
    expect(verifyCodeVerifier(RFC_CHALLENGE, 'S256', `${RFC_VERIFIER}x`)).toBe(false);
    // The challenge is not the verifier, so presenting it must not work.
    expect(verifyCodeVerifier(RFC_CHALLENGE, 'S256', RFC_CHALLENGE)).toBe(false);
  });

  it('takes the method from the stored authorization request, closing the downgrade', () => {
    // An attacker who could choose `plain` at the token endpoint would just present the
    // challenge. Verification uses the method the authorization request declared.
    expect(verifyCodeVerifier(RFC_CHALLENGE, 'plain', RFC_CHALLENGE)).toBe(true);
    expect(verifyCodeVerifier(RFC_CHALLENGE, 'S256', RFC_CHALLENGE)).toBe(false);
  });
});

describe('validateCodeVerifier', () => {
  const valid = 'a'.repeat(VERIFIER_MIN_LENGTH);

  it('accepts a verifier at the minimum length', () => {
    expect(validateCodeVerifier(valid)).toEqual({ ok: true, value: valid });
  });

  it('accepts one at the maximum length', () => {
    expect(validateCodeVerifier('b'.repeat(VERIFIER_MAX_LENGTH)).ok).toBe(true);
  });

  it('rejects one that is too short to carry 32 bytes of entropy', () => {
    const short = 'a'.repeat(VERIFIER_MIN_LENGTH - 1);
    expect(validateCodeVerifier(short)).toEqual({
      ok: false,
      error: expect.stringContaining('at least 43'),
    });
  });

  it('rejects one that is too long', () => {
    expect(validateCodeVerifier('a'.repeat(VERIFIER_MAX_LENGTH + 1)).ok).toBe(false);
  });

  it('accepts every unreserved character and nothing else', () => {
    expect(validateCodeVerifier(`${'a'.repeat(39)}-._~`).ok).toBe(true);
    expect(validateCodeVerifier(`${'a'.repeat(42)}/`).ok).toBe(false);
    expect(validateCodeVerifier(`${'a'.repeat(42)}+`).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The flow
// ---------------------------------------------------------------------------

const config: AuthorizationCodeConfig = {
  clientId: 'client_abc',
  redirectUri: 'https://app.example.com/callback',
  scope: 'profile articles:read',
  state: 'st_9f2c',
  codeVerifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
  authorizationCode: 'ac_7712',
  authorizationEndpoint: 'https://auth.example.com/authorize',
  tokenEndpoint: 'https://auth.example.com/token',
  resourceEndpoint: 'https://api.example.com/me',
  issuer: 'https://auth.example.com',
  audience: 'https://api.example.com',
  subject: 'user_42',
  secret: SECRET,
  nowSeconds: NOW,
};

describe('the authorization code + PKCE ladder', () => {
  const flow = runAuthorizationCodeFlow(config);

  it('runs eleven steps in order, ending at the resource server', () => {
    expect(flow.steps.map((step) => step.index)).toEqual([...Array(11).keys()]);
    expect(flow.steps.at(-1)?.from).toBe('resource-server');
  });

  it('publishes the challenge before the user has authenticated', () => {
    // The commitment must precede the authentication, or it commits to nothing.
    const derive = flow.steps.findIndex((step) => step.title.includes('code verifier'));
    const authorize = flow.steps.findIndex((step) =>
      step.title.includes('Authorization request'),
    );
    const consent = flow.steps.findIndex((step) => step.title.includes('authenticates'));
    expect(derive).toBeLessThan(authorize);
    expect(authorize).toBeLessThan(consent);
  });

  it('sends the challenge, and never the verifier, to the authorization endpoint', () => {
    const authorize = flow.steps.find((step) =>
      step.title.includes('Authorization request'),
    );
    const target = parseTarget(authorize?.url ?? '');
    expect(queryParam(target, 'response_type')).toBe('code');
    expect(queryParam(target, 'code_challenge')).toBe(flow.pkce.challenge);
    expect(queryParam(target, 'code_challenge_method')).toBe('S256');
    expect(authorize?.url).not.toContain(config.codeVerifier);
  });

  it('carries state out and back unchanged', () => {
    const authorize = flow.steps.find((step) =>
      step.title.includes('Authorization request'),
    );
    const redirect = flow.steps.find((step) => step.title.includes('Redirect back'));
    expect(queryParam(parseTarget(authorize?.url ?? ''), 'state')).toBe(config.state);
    expect(queryParam(parseTarget(redirect?.url ?? ''), 'state')).toBe(config.state);
  });

  it('returns the code by redirect, with a 302', () => {
    const redirect = flow.steps.find((step) => step.title.includes('Redirect back'));
    expect(redirect?.response?.status).toBe(302);
    expect(headerValue(redirect?.response?.headers ?? [], 'Location')).toContain(
      `code=${config.authorizationCode}`,
    );
  });

  it('reveals the verifier only in the back-channel token request', () => {
    const tokenStep = flow.steps.find((step) => step.title.includes('Token request'));
    expect(tokenStep?.request?.method).toBe('POST');
    expect(tokenStep?.request?.body).toContain(`code_verifier=${config.codeVerifier}`);
    expect(tokenStep?.request?.body).toContain('grant_type=authorization_code');
    expect(headerValue(tokenStep?.request?.headers ?? [], 'Content-Type')).toBe(
      'application/x-www-form-urlencoded',
    );
  });

  it('carries the verifier in no earlier step', () => {
    const tokenStepIndex = flow.steps.findIndex((step) =>
      step.title.includes('Token request'),
    );
    const earlier = flow.steps.slice(0, tokenStepIndex);
    const serialised = JSON.stringify(earlier);
    expect(serialised).not.toContain(config.codeVerifier);
  });

  it('marks the token response no-store', () => {
    const issued = flow.steps.find((step) => step.title.includes('Access token issued'));
    expect(headerValue(issued?.response?.headers ?? [], 'Cache-Control')).toBe(
      'no-store',
    );
  });

  it('sends the token as a Bearer header, never in the query', () => {
    const call = flow.steps.find((step) => step.to === 'resource-server' && step.request);
    expect(headerValue(call?.request?.headers ?? [], 'Authorization')).toBe(
      `Bearer ${flow.token.accessToken}`,
    );
    expect(call?.request?.target).not.toContain('access_token');
  });

  it('issues an access token the resource server can verify', () => {
    const verdict = verifyJwt(flow.decodedAccessToken, {
      secret: SECRET,
      nowSeconds: NOW,
      issuer: config.issuer,
      audience: config.audience,
    });
    expect(verdict.valid).toBe(true);
    expect(flow.decodedAccessToken.claims.sub).toBe('user_42');
    expect(flow.decodedAccessToken.claims.scope).toBe(config.scope);
  });

  it('never puts the password anywhere -- the client is not a party to it', () => {
    const authenticating = flow.steps.filter((step) =>
      step.title.includes('authenticates'),
    );
    expect(authenticating).toHaveLength(1);
    expect(authenticating[0].from).toBe('authorization-server');
    expect(authenticating[0].to).toBe('user');
  });

  it('replays identically, because every value is supplied rather than generated', () => {
    expect(runAuthorizationCodeFlow(config)).toEqual(runAuthorizationCodeFlow(config));
  });
});

describe('the attack PKCE stops', () => {
  const flow = runAuthorizationCodeFlow(config);

  it('refuses a stolen code presented without a verifier', () => {
    const attack = interceptAuthorizationCode(flow);
    expect(attack.refused).toBe(true);
    expect(attack.response.status).toBe(400);
    expect(attack.response.body).toContain('invalid_grant');
  });

  it('refuses a guessed verifier', () => {
    const attack = interceptAuthorizationCode(flow, {
      guessedVerifier: 'a'.repeat(VERIFIER_MIN_LENGTH),
    });
    expect(attack.refused).toBe(true);
    expect(attack.response.status).toBe(400);
  });

  it('shows the attacker holding the code and the challenge and still failing', () => {
    const attack = interceptAuthorizationCode(flow);
    expect(attack.attackerHeld.join(' ')).toContain(config.authorizationCode);
    expect(attack.attackerHeld.join(' ')).toContain(flow.pkce.challenge);
    expect(attack.why).toMatch(/SHA-256|inverting/);
  });

  it('would succeed if the attacker somehow had the verifier -- which is the point', () => {
    // Not a vulnerability: it confirms the check is on the verifier and nothing else, so the
    // refusals above are the mechanism working rather than an unrelated rejection.
    const attack = interceptAuthorizationCode(flow, {
      guessedVerifier: config.codeVerifier,
    });
    expect(attack.refused).toBe(false);
  });
});
