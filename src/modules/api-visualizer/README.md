# `src/modules/api-visualizer` — how applications talk to applications

REST is HTTP with a discipline about nouns. Auth is HTTP with a header. Rate limiting is
HTTP with a refusal that carries instructions. Pagination is HTTP with a promise about
ordering that offsets quietly break. This module takes the request/response primitives from
phase 08 and layers on the six things every real API adds — and, where the conventional
answer is wrong, shows it being wrong rather than saying so.

Simulated only. Nothing here can reach a network; see the rules at the bottom.

## What is here

The whole module: the pure logic, the seven runs, and the UI. The registry entry is `ready`
and the route is `/api-visualizer`.

```
sim/                # pure logic -- no React, no DOM, no clock of its own
  digest.ts         # real SHA-256, HMAC, and base64url, checked against published vectors
  message.ts        # the phase-08 request/response model, restated (see below)
  rest.ts           # resources, verb->status selection, idempotency, merge patch
  auth.ts           # API keys, JWT decode and verify, OAuth 2.0 auth-code + PKCE
  ratelimit.ts      # the token bucket, 429 + Retry-After + RateLimit-*, client backoff
  pagination.ts     # offset and cursor, Link headers, and the drift demonstration
  graphql.ts        # a small parser and executor, N+1 counting, the REST comparison
  webhook.ts        # HMAC signing and verification, retry policy, idempotent receiving
  exchange.ts       # the one-way bridge from all of the above to a drawable SimResult
scenarios/          # seven declared runs, plus the mock API's resources. Data, no logic
shape.ts            # what the keys in a body mean: data, total, detail, access_token
sandbox.ts          # the console's safety boundary -- zod, and no host field anywhere
components/         # EndpointExplorer, ApiConsole, AuthFlowDiagram, RateLimitMeter,
                    # ResponseShape, and two comparison panels
ApiVisualizerModule.tsx   # the composition root
```

## Three machines, and the middle one is where most of the module lives

Every request/response run draws `client -- gateway -- api`, and the gateway is not
decoration. Authentication and rate limiting are edge concerns: in a real deployment the
`401` and the `429` come from a proxy that never troubled the application, which is why a
refusal is cheap and why "my handler was never called" is the correct mental model.
Modelling the gateway as a real node on a real link makes that _visible_ — a refusal turns
round at the middle box and the third machine stays dark — rather than being a sentence
somebody has to believe.

Two plans redraw the picture, and both do so because the picture is the lesson. **OAuth**
swaps in the four parties of RFC 6749, because the flow's shape is entirely about who may
speak to whom. **Webhooks** reverse the arrow: the API is the client and the subscriber is
the server, which is the whole difference between a webhook and everything else here.

## The console is the one place a reader can send something

Six of the seven runs are things you cannot easily try at home — an OAuth ladder, a rate
limiter, a webhook retry — and the seventh is the one where poking at it is the point. So
`ApiConsole` is on every scenario, and `sandbox.ts` is the boundary that makes that safe:
there is no host field in the form, an absolute URL is refused with a message saying why,
and "send" is a call to `handleRest` over a store held in a React state hook.

What the console refuses is narrow and deliberate: a malformed target, and a body on a
method that carries none. What it _insists_ on sending is everything else — a `POST` with
no body, a `PATCH` with the wrong media type, a path nothing is routed at. Those answer
`400`, `415`, and `404`, and a console that helpfully prevented them would be teaching its
own opinion in place of the specification's.

## Why `message.ts` is a copy of the HTTP Explorer's model

`eslint.config.mjs` forbids one module importing another, so `sim/message.ts` restates the
parts of `http-explorer/sim/message.ts` this module needs: field lines as an **ordered
list** rather than a map, the same `request()` / `response()` constructors, the same
byte-counting rules. Phase 09 hit the same wall and answered it the same way.

What is deliberately **not** copied is everything phase 08 exists to teach: the CRLF wire
format, chunked framing, the three HTTP versions, cookie jars, cache freshness, CORS. If
this module ever needs those, the answer is a link to the HTTP Explorer, not a second
implementation of them.

## This module computes real cryptography, and the HTTPS Explorer does not

That is not an inconsistency. In TLS, the *value* of a traffic key teaches nothing and a
convincing fake invites misuse, so `https-explorer/sim/placeholder.ts` labels every value
`PLACEHOLDER-`. Here the values are the lesson:

- a PKCE `code_challenge` **is** `BASE64URL(SHA256(verifier))`, and `auth.test.ts` checks the
  derivation against the vector in RFC 7636 Appendix B;
- a JWT signature is an HMAC over the two encoded segments, which is exactly why the payload
  is readable and the payload is not;
- a webhook signature either verifies or does not.

`digest.ts` is a compact teaching implementation checked against FIPS 180-4 and RFC 4231 and
nothing else. Production code should use `crypto.subtle`; the reason this module does not is
that `crypto.subtle` is asynchronous, and every simulation in this repository is a pure
synchronous function of its inputs. The "secrets" are string literals and there is nothing
to protect.

## The four things this module demonstrates rather than asserts

Each of these is a place where the sentence has never convinced anyone.

1. **Offset pagination is unstable.** `paginateWithDrift` inserts one row at the front of a
   newest-first feed between page 1 and page 2 and the client receives item 8 twice; delete
   one instead and item 7 is never sent at all, having been in the collection from beginning
   to end. Same run with cursors: clean. `pagination.test.ts` asserts both, and asserts that
   both strategies are correct when nothing changes — which is why the bug survives review.
2. **PKCE defeats a stolen authorization code.** `interceptAuthorizationCode` gives the
   attacker the real code *and* the challenge and watches the token endpoint refuse.
3. **POST is not idempotent and PUT is.** `repeatRequest` sends the identical request three
   times: three articles, or one. `deleteTwice` gets `204` then `404` and an identical store,
   which is what idempotency actually means.
4. **GraphQL's N+1 is the default, not a mistake.** `executeGraphQL` counts data-source calls
   per field: four for three posts and their authors, two once the field is batched.

Each of the four is also a scenario, so the demonstration is on screen and not only in a
test: `paginated-collection` runs both strategies over the same twelve rows and the same two
edits; `oauth-authcode-pkce` ends with the attacker's `400 invalid_grant`; `rest-crud` sends
the identical `POST` and the identical `PUT` twice each; `rest-vs-graphql` prints five
data-source calls and then three.

## The sentence that has to be on screen

`JWT_PAYLOAD_NOT_ENCRYPTED` lives in `sim/auth.ts` as a constant rather than being typed into
a component, so it cannot drift and so grepping for it finds every surface that renders
claims. `AuthFlowDiagram` prints it above every decoded token — not as a tooltip and not
behind a disclosure, because the panel has just read somebody's email address out of a token
with no key and the reader is entitled to know that is not a trick.
`AuthFlowDiagram.test.tsx` asserts it against the exported constant for every bearer token in
the run, valid or not, so rewording it in one place cannot quietly remove it from the other.

## Even-handedness is a tested property

`REST_VS_GRAPHQL` and `PAGINATION_TRADEOFFS` are data, not JSX, and their tests assert that
each side of every row says something substantive — that the caching row credits REST, that
the fetching row credits GraphQL, and that the cursor row admits it cannot jump to page 50.
A comparison table that only listed one side's wins would be an advertisement.

## Where the specifications are honest and where they are not

Citations are to current documents: RFC 9110 (semantics), 9457 (problem details), 6749 +
7636 (OAuth, PKCE), 7519 + 7515 (JWT), 6750 (bearer tokens), 8288 (Link), 6585 (429), 7396
(merge patch), 2104 (HMAC).

Two things are **not** standards and are labelled as such rather than rounded up:

- the `RateLimit-*` fields are an IETF draft that changed shape more than once, and the
  `X-RateLimit-*` family beneath them has no specification at all — see
  `RATELIMIT_HEADER_STATUS`. Only `429` and `Retry-After` are settled.
- webhook signing has no de facto standard. RFC 9421 exists and the ecosystem predates it,
  so every provider invented a slightly different header. `webhook.ts` follows the most
  widely copied convention and says so.

## What must never be imported here

- Anything under `src/modules/<other>/` — enforced by `eslint.config.mjs`. That is why
  `message.ts` is a restatement rather than an import.
- `Date.now()` or `Math.random()`. Every time value is a virtual millisecond or an explicit
  epoch second passed in by the caller, and jitter draws from a seeded `@/core/sim/rng`.
  `runAuthorizationCodeFlow` takes its verifier, its state, and its authorization code as
  arguments for exactly this reason: every run must replay identically, and several tests
  assert it by running the same input twice and comparing with `toEqual`.
- A real cryptographic library. If one is ever needed here, the module has gone wrong.
- Anything that can open a socket. There is no host parameter anywhere in this folder to be
  given one, and no `fetch`, `XMLHttpRequest`, `Request`, or `sendBeacon`. Three test files
  stub `fetch` with a spy that fails the test if anything calls it, and keep it stubbed while
  every scenario is visited and while the console is used with an absolute URL typed into it.

Every host in this module is under `.example`, which RFC 2606 §2 reserves so it can never be
registered by anybody, and every address is from `203.0.113.0/24`, one of the three ranges
RFC 5737 reserves for documentation. `scenarios.test.ts` asserts both across all seven runs,
because the cheapest time to catch a scenario that names a real domain is before it is
written twice.
