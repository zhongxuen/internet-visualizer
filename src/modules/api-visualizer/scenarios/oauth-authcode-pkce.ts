/**
 * Scenario 3 -- the authorization code flow, with PKCE, and the theft it survives.
 *
 * Eleven rungs across four parties, and the ordering is the part most diagrams get wrong.
 * Three properties fall out of the shape rather than needing to be stated:
 *
 * - **The user's password appears in exactly one step**, and the client application is not a
 *   party to it. That is the entire reason OAuth exists. "Sign in with X" without it is just
 *   asking for someone's password and promising to be careful.
 * - **The token never travels through the browser.** The *code* does, and a code is worthless
 *   without the verifier, which does not.
 * - **The `code_challenge` goes out in step 3**, before the user has authenticated and long
 *   before any code exists. That is what makes it a commitment: the client binds itself to a
 *   secret at a moment when it has nothing to gain by lying, and the authorization server
 *   stores the challenge alongside the code it later issues.
 *
 * Then the attack. Assume the code was captured -- from a URL in browser history, from a
 * `Referer` header, from an access log, or from a rival app that registered the same custom
 * URL scheme on a phone, where schemes are first-come-first-served. That is the design
 * assumption, not a worst case. Without PKCE the code alone is enough. With it, the token
 * endpoint asks for a value that never travelled, the attacker has nothing to send, and the
 * answer is `400 invalid_grant`. The last step tries a guess instead, which is what the
 * 43-character minimum of RFC 7636 s 4.1 exists to make hopeless.
 *
 * The verifier below is the one from RFC 7636 Appendix B, so the challenge on screen is the
 * value the specification prints -- `auth.test.ts` checks the derivation against it.
 */

import type { ApiScenario } from '../sim/exchange';

import { AUDIENCE, ISSUER, SCENARIO_EPOCH_SECONDS, SIGNING_SECRET } from './common';

/**
 * The verifier, from RFC 7636 Appendix B.
 *
 * Supplied rather than generated, like every other secret in this module, because a run that
 * drew from a random source could not replay -- and because a value with a published
 * challenge lets the derivation be checked against the specification rather than against
 * itself.
 */
const CODE_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

/** What an attacker who cannot steal the verifier is reduced to. */
const GUESSED_VERIFIER = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

/** The full ladder, then the interception it defeats. */
export const OAUTH_AUTHCODE_PKCE: ApiScenario = {
  id: 'oauth-authcode-pkce',
  title: 'OAuth 2.0: authorization code + PKCE',
  summary:
    'The four parties of RFC 6749 on one diagram, eleven rungs in the order they actually ' +
    'happen -- and then an attacker spending the stolen authorization code, and being refused.',
  teaches: [
    'The user types a password into the authorization server and nowhere else',
    'The code travels through the browser; the token never does',
    'The code_challenge is committed before the user authenticates and before any code exists',
    'state is a CSRF defence and is checked by the client, not by the server',
    'A stolen code is worthless without the verifier, which never left the client',
    'A public client cannot keep a secret, which is why PKCE exists rather than a client secret',
  ],
  conditions: { rttMs: 90 },
  plan: {
    kind: 'oauth',
    intercept: true,
    guessedVerifier: GUESSED_VERIFIER,
    config: {
      clientId: 'client_dashboard',
      redirectUri: 'https://app.example/callback',
      scope: 'articles:read articles:write',
      state: 'st_7d41c0a9',
      codeVerifier: CODE_VERIFIER,
      codeChallengeMethod: 'S256',
      authorizationCode: 'ac_9f2c41e0b7d8',
      authorizationEndpoint: `${ISSUER}/authorize`,
      tokenEndpoint: `${ISSUER}/token`,
      resourceEndpoint: `${AUDIENCE}/articles`,
      issuer: ISSUER,
      audience: AUDIENCE,
      subject: 'user_17',
      secret: SIGNING_SECRET,
      nowSeconds: SCENARIO_EPOCH_SECONDS,
      expiresInSeconds: 900,
      refreshToken: 'rt_5b2e91f4c07a',
    },
  },
  notes: [
    {
      phase: 'oauth-1',
      target: 'client',
      text: 'The verifier is generated here and stays here. It is the only secret a public client has, and it is one it invents per authorization attempt rather than one shipped inside the app -- which is the whole reason PKCE works where a client secret does not. Anything compiled into a mobile binary or served as JavaScript is readable by whoever wants it.',
      reference: {
        rfc: 7636,
        section: '4.1',
        title: 'PKCE: Client Creates a Code Verifier',
      },
    },
    {
      phase: 'oauth-2',
      target: 'authorization-server',
      text: 'Read the query string on this request. It carries the challenge -- SHA-256 of the verifier, base64url-encoded -- and not the verifier. The authorization server stores it beside the code it will issue later. Note what has not happened yet: nobody has logged in, and no code exists. The commitment comes first, which is exactly what makes it a commitment.',
      reference: {
        rfc: 7636,
        section: '4.3',
        title: 'PKCE: Client Sends the Code Challenge',
      },
    },
    {
      phase: 'oauth-3',
      target: 'user',
      text: 'This is the only rung where a password exists. It is typed into the authorization server, in a window the user can inspect the address bar of, and the client application never sees it. Every "connect your account" flow that asks for the password directly has thrown this property away, and no amount of care with the credential afterwards gets it back.',
      reference: {
        rfc: 6749,
        section: '4.1',
        title: 'OAuth 2.0: Authorization Code Grant',
      },
    },
    {
      phase: 'oauth-5',
      target: 'client',
      text: "state is checked here, by the client, against the value it generated in step 1. It is not the authorization server's job and the server cannot do it: the whole point is to detect a callback the client did not initiate. A client that sends state and never compares it has implemented the syntax of the defence and none of it.",
      reference: {
        rfc: 6749,
        section: '10.12',
        title: 'OAuth 2.0: Cross-Site Request Forgery',
      },
    },
    {
      phase: 'oauth-6',
      target: 'client',
      text: 'The verifier travels for the first and only time, on a direct back-channel request that no browser is a party to. Compare this with step 3: the browser carried a hash, this carries the preimage, and nothing that saw the first can produce the second.',
      reference: { rfc: 7636, section: '4.5', title: 'PKCE: Client Sends the Verifier' },
    },
    {
      phase: 'oauth-9',
      target: 'api',
      text: 'The resource server verifies the token without a round trip to the authorization server -- it checks a signature and some claims, which is arithmetic. That is what makes bearer tokens fast and what makes revoking one hard, and it is the same trade the JWT scenario draws out.',
      reference: {
        rfc: 6750,
        section: '2.1',
        title: 'Bearer Token Usage: Authorization Request Header Field',
      },
    },
    {
      phase: 'oauth-interception',
      target: 'authorization-server',
      text: 'The attacker holds the real code and the real challenge, and both are useless. The token endpoint recomputes SHA-256 of whatever verifier is presented and compares it with what it stored in step 3; with no verifier there is nothing to compare, and the grant is refused. Before PKCE, the defence here was a client secret -- which a mobile app or a single-page application cannot hold, which is why the flow was unsafe for exactly the clients that needed it most.',
      reference: {
        rfc: 7636,
        section: '4.6',
        title: 'PKCE: Server Verifies code_verifier',
      },
    },
    {
      phase: 'oauth-interception-guess',
      target: 'authorization-server',
      text: 'The last avenue: guess. RFC 7636 requires a verifier of at least 43 characters from an unreserved alphabet, which is where the specification\'s "at least 256 bits of entropy" recommendation lands. The refusal below costs the attacker one request and buys them nothing, and there are more possible verifiers than there is time to send them.',
      reference: {
        rfc: 7636,
        section: '7.1',
        title: 'PKCE: Entropy of the code_verifier',
      },
    },
  ],
};
