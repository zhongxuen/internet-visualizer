# `src/modules/https-explorer` — the handshake, the keys, and what the padlock checked

HTTPS is HTTP inside a TLS record layer. This module takes apart the part that is not
HTTP: how two strangers agree on a key over a wire somebody is recording, how a
certificate proves identity, and what an eavesdropper still sees afterwards.

Simulated only. Nothing here touches a network, and there is no cryptography in it.

## What exists today

Phase 09, complete: the pure logic under `sim/`, the seven scenarios that run on it, the
five views, and the route. The registry entry is `ready`.

```
sim/
  placeholder.ts    # the fake-crypto discipline, in one file
  cipher.ts         # suite catalogue and decomposition; why the 1.3 name has two parts
  certificates.ts   # chain, trust store, and the five validation steps
  keyschedule.ts    # (EC)DHE -> HKDF -> traffic keys, with client/server/observer columns
  records.ts        # the record layer, and what an observer reads off it
  handshake13.ts    # 1-RTT, 0-RTT/PSK, HelloRetryRequest, downgrade detection
  handshake12.ts    # full and abbreviated, plus the 1.2-vs-1.3 comparison table
  connection.ts     # the one-way bridge from all of the above to a SimResult
scenarios/
  common.ts         # one instant, one PKI, one exchange -- everything else derives
  tls13-fresh.ts    # 1-RTT, and where encryption begins
  tls13-resumption.ts   # PSK, 0-RTT, and the replay caveat
  tls12-fresh.ts    # the comparison: an extra round trip and a plaintext certificate
  cert-expired.ts   # step 2 fails
  cert-hostname-mismatch.ts  # step 3 fails
  cert-untrusted-ca.ts       # step 1 fails
  downgrade-blocked.ts       # the DOWNGRD sentinel, and an attack that fails
components/
  HandshakeLadder.tsx      # the ladder, with encryption-starts drawn across it
  KeyScheduleDiagram.tsx   # client / server / observer, and where the third column stops
  CertificateChain.tsx     # five verdicts, then the path they were about
  CipherSuiteBreakdown.tsx # four roles, two of them missing from a 1.3 name
  EncryptionOverlay.tsx    # participant view vs observer view
  VersionComparison.tsx    # 1.2 and 1.3 on one clock, plus the trade-off row
HttpsExplorerModule.tsx    # the composition root: three pieces of state
```

## The vantage point is module state, not panel state

`participant` / `observer` lives in `HttpsExplorerModule` and drives both the ladder and
the overlay. A toggle local to the overlay would teach that the observer view is a display
mode; it is a different place to stand, and the same connection has to look different from
it everywhere at once. Field-level visibility comes from `MessageField.visibleToObserver`
rather than from a message's encryption level, because the two differ: an encrypted
record's header, length and timing are still on the wire.

`connection.ts` is where the boundary is drawn. Everything else in `sim/` decides what TLS
*does*; `connection.ts` decides what a learner *sees* while it happens -- phases, node
states, annotations, PDUs -- and the scenario files decide only what connection takes
place. They are a screenful of declarations each, with no logic in them at all.

## The observer is a node, not a caption

Every run draws `client -- observer -- server`, with the observer a passive machine on the
path that reads both directions and is addressed by neither. That is what lets the
encryption overlay be **derived**: the observer's view is the record list with the fields
TLS conceals removed, so it cannot drift from the protocol model. The honest half of the
answer -- destination address, SNI hostname, record lengths, timings -- falls out of the
model instead of being written down a second time and going stale.

## The scenarios abort when a real client would

A failed certificate check is not a warning triangle over a loaded page. The three `cert-*`
runs stop at the client's fatal alert, exchange no application data, and have an `abort`
phase where the others have `application-data`. `scenarios.test.ts` asserts it, along with
determinism -- ten runs of each scenario, compared whole.

## THERE IS NO CRYPTOGRAPHY HERE

Every key, secret, signature, fingerprint, and ciphertext comes from `placeholder.ts` and
is a labelled FNV-1a hash of a string. They are not secret, not random, not one-way, and
not keys. Each renders with a `PLACEHOLDER-` prefix so it cannot be mistaken for output
from a real library, and `PLACEHOLDER_NOTICE` is the sentence any UI showing one must
display.

What is modelled faithfully is the **structure**: which input feeds which derivation, what
each party knows at each moment, and the byte sizes involved. That is checkable against
the RFCs and it is what the module teaches. A convincing fake implementation would be
worse than an honest diagram, because a learner could not tell the difference.

`TOY_DH_GROUP` is the one exception, and a deliberate one: a 5-bit Diffie–Hellman group
(`p = 23`, `g = 5`) that exists so `5^6 mod 23 = 8` can be printed and checked by hand.
It is labelled as breakable and kept in a separate type from `NamedGroup`, which is what a
real connection negotiates.

## The overlay leads with what is *not* hidden

`EncryptionOverlay` opens with the IP and TCP headers and the traffic shape, then lists
the visible facts before the hidden one. The tempting design — plaintext on the left, hex
on the right — teaches that HTTPS hides everything, and a learner who comes away believing
they are anonymous has learned something worse than nothing. The destination address, the
SNI hostname, the record types and lengths, the timings and the sizes all survive, and
`EncryptionOverlay.test.tsx` asserts each of them by name.

## The five certificate checks do not short-circuit

`validateChain` runs all five and reports all five verdicts, even after one has failed. A
real client aborts on the first failure and is right to. For teaching it is exactly wrong:
one red row says "the certificate was bad", where four green rows and one red row say
which promise broke. The three `cert-*` scenarios each break exactly one step:
`certificates.test.ts` asserts it of every failure mode in isolation, and
`scenarios.test.ts` asserts it of the three shipped scenarios, along with the fact that
between them they break three *different* steps.

The checks are genuinely independent — no check may consult another's verdict.

## Hostname matching follows RFC 9525, so there is no CN fallback

RFC 9525 §2 forbids using the subject Common Name to identify a service. `checkHostname`
never reads it, and a certificate with a matching CN and no matching SAN **fails** — with
a detail line saying so, because that is the surprising part. Wildcards follow §6.3: one
wildcard, as the complete content of the leftmost label, covering exactly one label.

## What must never be imported here

- Anything under `src/modules/<other>/` — `eslint.config.mjs` enforces it. That is why
  `records.ts` takes a **string of bytes** rather than an `HttpRequest`: it cannot reach
  into `http-explorer`, and it should not want to. The record layer does not know what it
  is carrying.
- `Date.now()` or `Math.random()`. Certificate validity windows take an explicit `now`
  in epoch milliseconds — `SCENARIO_EPOCH` in `scenarios/common.ts`, a written-down
  constant — and everything else runs on virtual milliseconds from zero. Every run is
  reproducible, and `scenarios.test.ts` runs each one ten times to prove it.
- Any real cryptographic library. If one is ever needed here, the module has gone wrong.

## Sources

RFC 8446 (TLS 1.3), RFC 5246 (TLS 1.2), RFC 9525 (service identity — obsoletes RFC 6125),
RFC 5280 (certificate profile), RFC 6066 (SNI, OCSP stapling), RFC 6960 (OCSP), RFC 5869
(HKDF), RFC 5077 (session tickets), RFC 7627 (extended master secret), RFC 8996
(deprecating TLS 1.0/1.1).
