# 08 — Module: HTTP Explorer

## Goal

The full request/response lifecycle: methods, headers, status codes, caching,
redirects, cookies, sessions, content negotiation, and the differences between
HTTP/1.1, HTTP/2, and HTTP/3. Simulated only.

This module is also the base for phases 09 (HTTPS) and 10 (API / WebSocket) — build the
request/response primitives so they are reusable.

## Prerequisites

Phase 04.

---

## Deliverables

```
src/modules/http-explorer/
  meta.ts
  sim/
    message.ts        # HttpRequest/HttpResponse models + wire serialization
    semantics.ts      # method + status semantics, safe/idempotent/cacheable
    caching.ts        # Cache-Control, ETag/If-None-Match, freshness math
    cookies.ts        # Set-Cookie parsing, attributes, jar behaviour
    versions.ts       # h1 vs h2 vs h3 connection/stream modelling
    exchange.ts       # scenario runner producing SimEvents
  scenarios/
    simple-get.ts
    post-form.ts
    redirect-chain.ts        # 301 -> 302 -> 200
    conditional-request.ts   # 200 then 304 via ETag
    cookie-session.ts        # login -> Set-Cookie -> authenticated request
    cors-preflight.ts        # OPTIONS preflight then real request
    http2-multiplexing.ts    # h1 head-of-line blocking vs h2 streams
  components/
    RequestBuilder.tsx       # method, path, headers, body — validated
    WireView.tsx             # the literal bytes on the wire
    HeaderExplainer.tsx      # hover/focus any header -> what it does
    StatusCodeMap.tsx        # 1xx-5xx grid, current one highlighted
    CacheStatePanel.tsx
    CookieJarPanel.tsx
  HttpExplorerModule.tsx
src/app/(modules)/http-explorer/page.tsx
```

---

## What to model

### The wire format is the point

`WireView` shows the actual text an HTTP/1.1 exchange puts on the wire:

```
GET /index.html HTTP/1.1
Host: example.com
Accept: text/html
...
```

with a blank line before the body, and `\r\n` line endings made visible as a toggle.
Seeing this once is worth ten paragraphs of explanation.

For HTTP/2 and HTTP/3, show the same message as **binary frames** (HEADERS, DATA) with
stream IDs, and HPACK/QPACK header compression indicated — the contrast with h1 text is
the lesson.

### Version comparison — build this as a first-class view

Side-by-side of the _same_ page load over:

- **HTTP/1.1** — 6 connections per origin, head-of-line blocking, sequential requests
- **HTTP/2** — one TCP connection, multiplexed streams, header compression
- **HTTP/3** — QUIC over UDP, no TCP head-of-line blocking, 0-RTT resumption

Use the phase-04 timeline so users literally watch h2 finish sooner. Be accurate about
_why_: h2 removes application-layer HOL blocking but not TCP-level HOL blocking; only h3
removes the latter.

### Headers as teaching objects

`HeaderExplainer` maps every header used in the scenarios to: what it does, who sets it,
request/response/both, and an RFC reference (RFC 9110 for semantics, 9111 for caching,
9112 for HTTP/1.1, 9113 for HTTP/2, 9114 for HTTP/3 — the older 723x RFCs are obsolete;
cite the current ones).

### Caching

Model freshness properly: `Cache-Control: max-age`, `s-maxage`, `no-cache` vs
`no-store` (a distinction almost everyone gets wrong — make it explicit), `must-revalidate`,
`ETag` / `If-None-Match`, `Last-Modified` / `If-Modified-Since`, and the 304 path.
`CacheStatePanel` shows browser cache and an intermediary/CDN cache separately, with
`HIT` / `MISS` / `REVALIDATED`.

### Cookies and sessions

`Set-Cookie` with `Domain`, `Path`, `Expires`/`Max-Age`, `Secure`, `HttpOnly`,
`SameSite`. Show which attributes stop which attack (`HttpOnly` vs XSS-read,
`SameSite` vs CSRF, `Secure` vs plaintext leak). The cookie-session scenario walks a
login and the subsequent authenticated request, with the jar panel updating.

### CORS

The preflight scenario is worth building carefully — CORS confusion is near-universal.
Show: a simple request vs one that triggers `OPTIONS`, the `Access-Control-Request-*`
headers, the server's `Access-Control-Allow-*` response, and **the browser blocking the
response after it arrived** (the request was still sent — this is the key misconception).

---

## Interactions

- `RequestBuilder`: pick method, path, headers, body; validated with `zod`
- Toggle protocol version and watch the same exchange re-render
- Click a status code in `StatusCodeMap` to load a scenario producing it
- Every header in `WireView` is focusable and explains itself

> **Safety:** requests are simulated against bundled server fixtures. The builder cannot
> emit a real request. Badge it `simulated`.

---

## Acceptance criteria

- [ ] Wire view is byte-accurate for HTTP/1.1, including the blank line and CRLF toggle
- [ ] h1 / h2 / h3 comparison runs on the same timeline and the timing difference is
      visible and correctly explained
- [ ] Conditional request produces a real 304 with no body
- [ ] `no-cache` vs `no-store` is explicitly distinguished in the UI
- [ ] CORS scenario shows the request being sent and the _response_ being blocked
- [ ] All header explanations cite RFC 9110–9114 (not the obsolete 723x series)
- [ ] `message.ts`, `caching.ts`, and `cookies.ts` are unit-tested
- [ ] Registry entry `'ready'`

---

## Prompts to execute

### Prompt 8.1 — HTTP model

```
Read docs/implementation/08-module-http-explorer.md.

Implement the pure HTTP logic under src/modules/http-explorer/sim/: message.ts
(HttpRequest/HttpResponse models plus exact HTTP/1.1 wire serialization with CRLF and
the blank line before the body), semantics.ts (method and status semantics: safe,
idempotent, cacheable), caching.ts (freshness computation, ETag revalidation, the 304
path, and the no-cache vs no-store distinction), and cookies.ts (Set-Cookie parsing,
attributes, and jar matching rules).

No React. Unit-test all four, especially freshness math and cookie attribute matching.
```

### Prompt 8.2 — versions and scenarios

```
Implement versions.ts (HTTP/1.1 connection pooling and head-of-line blocking, HTTP/2
multiplexed streams over one connection, HTTP/3 over QUIC) and exchange.ts, plus the
seven scenarios listed in docs/implementation/08-module-http-explorer.md.

Model the version differences accurately: h2 removes application-layer HOL blocking but
not TCP-level HOL blocking; only h3 removes the latter. Emit SimEvents with timings that
make the difference visible on the phase-04 timeline. Assert determinism in tests.
```

### Prompt 8.3 — module UI

```
Implement the HTTP Explorer UI per docs/implementation/08-module-http-explorer.md:
RequestBuilder (zod-validated, badged `simulated`), WireView with a CRLF-visibility
toggle and per-header focus, HeaderExplainer citing RFC 9110-9114, StatusCodeMap,
CacheStatePanel (separate browser and CDN caches with HIT/MISS/REVALIDATED),
CookieJarPanel, and the version-comparison view. Add the route.

Requests must never leave the browser. Then flip the registry entry to 'ready'.
```
