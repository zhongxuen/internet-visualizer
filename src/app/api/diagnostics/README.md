# `src/app/api/diagnostics` — the only code in the product that touches a real network

Everything else in Internet Visualizer is a deterministic client-side simulation. These
three Route Handlers are the exception, and the security rules in `CLAUDE.md` apply to
them literally rather than in spirit:

> Never scan unknown/real systems. Clearly separate simulations from real network tools
> in both UI and code. Validate all user inputs.

## The routes

| Route                     | What it does                                                    | Where the socket goes                     |
| ------------------------- | --------------------------------------------------------------- | ----------------------------------------- |
| `GET /api/diagnostics/dns`   | DNS lookup over DoH (`A`, `AAAA`, `MX`, `NS`, `TXT`, `CNAME`) | One allow-listed resolver, never the target |
| `GET /api/diagnostics/rdap`  | Registration data for a domain or an address                  | IANA's bootstrap registry, then the registry it names |
| `GET /api/diagnostics/reach` | One `HEAD` request, with timing                               | **The target the user typed** |

`reach` is the only one where the user chooses the address a socket opens to, so it is
the only one that needs the full post-resolution guard. `dns` and `rdap` still validate
and block-list the target — a lookup of `localhost` or `10.0.0.1` is refused — but there
the target is a *parameter*, not a destination.

## The invariants

Each is enforced in code and asserted in `__tests__/`:

1. **`GET` only.** Next answers every other method with 405 by itself, and a `GET` has no
   body — so a JSON array of targets has nowhere to arrive.
2. **Exactly one target.** `readSingleParam` refuses a repeated `?target=`, and refuses
   `targets`, `hosts`, `urls`, `range`, `cidr`, and `ports` by name. `guard.ts` then
   refuses a value containing a comma, a slash (so no CIDR), or a dashed range.
3. **Every outbound call goes through `guardedFetch` in `_lib/outbound.ts`** — one
   function, so there is one thing to audit. A caller picks a method and a policy that
   may only *narrow* the ceilings in `guard.ts`; it cannot supply its own `RequestInit`.
4. **Nothing of the user's is forwarded.** `credentials: 'omit'`, no cookies, no
   referrer, and an allow-list of three request headers.
5. **A redirect is never followed as a redirect.** `redirect: 'manual'` always. `reach`
   reports the `Location` and stops; `rdap` may follow two hops, and each one re-runs the
   entire guard — validation, block list, resolution, and the re-check of every resolved
   address — on the new URL from scratch.
6. **≤ 5 s, and a capped body**, both from `DEFAULT_GUARD_POLICY`. The cap is enforced
   while the body is read, not after.
7. **Rate limited before anything else happens.** Every request that reaches a handler
   spends a token, valid or not, so validation is not a free oracle. A refusal is a 429
   with `Retry-After`; every response carries `X-RateLimit-*`.

## Who calls these

Exactly one caller: `src/modules/network-diagnostics/live/client.ts`, which makes a single
same-origin `GET` when a user presses Run in Live mode. Nothing else in the product fetches
these routes, and nothing fetches them automatically.

The request and response contract lives in `@/core/net/diagnostics` — the URL builders, the
resolver and bootstrap constants, and every payload type — and the files below re-export it
under the names they have always used. That is not tidiness: `LiveDisclosure` shows the user
the exact URL a handler will request *before* it requests it, and it can only promise that
honestly if the panel and the handler call the same function.

## Layout

```
_lib/
  deps.ts      # the resolver, fetch, clock, and the shared limiter — injected, so tests open no sockets
  request.ts   # "exactly one target", before anything else reads the query string
  outbound.ts  # guardedFetch: the single chokepoint every live request passes through
  respond.ts   # one response envelope; the one place a guard denial becomes a status
  dns.ts / rdap.ts / reach.ts   # one handler factory each
dns/route.ts, rdap/route.ts, reach/route.ts   # one line each, binding a factory to a URL
__tests__/     # integration tests; `routes` project in vitest.config.mts (node, no DOM)
```

Handlers are factories over `DiagnosticsDeps` so the `route.ts` files stay one line and
the tests can inject a resolver that answers `10.0.0.1` for an ordinary-looking name —
which is the DNS-rebinding case, and the only way to prove the guard is really wired in.

## What must never be added here

- A `POST`, or any method that is not `GET`.
- A second target, a range, a port list, or a concurrent fan-out.
- A `fetch` that does not go through `guardedFetch`.
- An origin allow-list that the user can influence.
- A URL built here rather than in `@/core/net/diagnostics` — the UI would no longer be able
  to disclose it truthfully.
