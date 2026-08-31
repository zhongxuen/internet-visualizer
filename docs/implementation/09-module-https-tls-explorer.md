# 09 — Module: HTTPS / TLS Explorer

## Goal

Make the TLS handshake understandable: what each message carries, how the session keys
are derived without ever sending them, how certificates prove identity, and what changes
between TLS 1.2 and TLS 1.3. Simulated only.

## Prerequisites

Phase 08 (reuses the HTTP message model — an HTTPS exchange is HTTP inside a TLS record
layer).

---

## Deliverables

```
src/modules/https-explorer/
  meta.ts
  sim/
    handshake12.ts     # TLS 1.2 full + abbreviated (session resumption)
    handshake13.ts     # TLS 1.3 1-RTT and 0-RTT
    keyschedule.ts     # key exchange -> secrets -> traffic keys (conceptual)
    certificates.ts    # chain, fields, validation steps
    records.ts         # TLS record layer wrapping HTTP bytes
    cipher.ts          # cipher suite parsing and what each part means
  scenarios/
    tls13-fresh.ts
    tls13-resumption.ts     # PSK, 0-RTT, and its replay caveat
    tls12-fresh.ts          # for the comparison view
    cert-expired.ts
    cert-hostname-mismatch.ts
    cert-untrusted-ca.ts
    downgrade-blocked.ts
  components/
    HandshakeLadder.tsx      # message ladder with per-message field detail
    KeyScheduleDiagram.tsx   # what each side knows at each moment
    CertificateChain.tsx     # leaf -> intermediate -> root, expandable
    CipherSuiteBreakdown.tsx # TLS_AES_128_GCM_SHA256 decomposed
    EncryptionOverlay.tsx    # toggle: see plaintext vs what an observer sees
  HttpsExplorerModule.tsx
src/app/(modules)/https-explorer/page.tsx
```

---

## What to model

### TLS 1.3 first (it is the default in practice)

```
Client                                              Server
ClientHello  (key_share, supported_versions, SNI, ALPN)
                                             ServerHello (key_share)
                                       {EncryptedExtensions}
                                       {Certificate}
                                       {CertificateVerify}
                                       {Finished}
{Finished}
[Application Data]
```

Braces = encrypted with handshake keys. Make the **moment encryption begins** visually
unmistakable — it is much earlier in 1.3 than in 1.2, and that is the headline
improvement along with 1-RTT.

### The key exchange — explain it, do not hand-wave it

`KeyScheduleDiagram` shows, at each step, what the client knows, what the server knows,
and **what an eavesdropper on the wire knows**. The point to land: both sides compute the
same shared secret from an (EC)DHE exchange while the observer, who saw every byte,
cannot. Then show the secret being expanded via HKDF into handshake and application
traffic keys.

Do not implement real crypto. Use clearly-labeled placeholder values and say so. The goal
is the _shape_ of the derivation, not a working implementation — and a fake crypto
implementation that looks real is worse than an honest diagram.

### Certificates

`CertificateChain` renders leaf → intermediate → root with: subject, issuer, SAN list,
validity window, key algorithm, signature algorithm, and fingerprint. Validation steps,
each individually pass/fail:

1. Signature chains to a trusted root in the store
2. Not expired / not yet valid
3. Hostname matches a SAN entry (**not** the deprecated CN fallback — say that)
4. Not revoked (OCSP stapling / CRL — explain stapling as the practical mechanism)
5. Key usage and basic constraints are appropriate

The three failure scenarios each break exactly one step, so the user sees which check
fired and what the browser warning would actually say.

### TLS 1.2 comparison

Show the extra round trip, the separate `ChangeCipherSpec`, the later start of
encryption, and cipher suites that are no longer acceptable (static RSA key exchange
providing no forward secrecy — explain forward secrecy here, it is the best moment).

### Cipher suite breakdown

`TLS_AES_128_GCM_SHA256` decomposed into AEAD cipher, key size, mode, and hash — plus a
note that TLS 1.3 dropped the key-exchange/auth components from the suite name because
they are negotiated separately. TLS 1.2 suites (`ECDHE_RSA_WITH_AES_128_GCM_SHA256`) show
all four parts.

### The encryption overlay — the strongest single teaching device

A toggle that switches the whole canvas between:

- **Participant view** — the actual HTTP request/response in plaintext
- **Observer view** — what a network eavesdropper sees: TCP/IP headers, TLS record types
  and lengths, the SNI hostname (unless ECH), and opaque ciphertext

This is the clearest possible answer to "what does HTTPS actually hide?" — and it
correctly shows what it does _not_ hide: the destination IP, the timing, the sizes, and
the hostname.

---

## Accuracy checks

RFC 8446 (TLS 1.3), RFC 5246 (TLS 1.2), RFC 6125 / RFC 9525 (identity verification —
hostname matching), RFC 6066 (SNI, OCSP stapling). Note 0-RTT's replay-attack caveat
explicitly in the resumption scenario; omitting it teaches something dangerous.

---

## Acceptance criteria

- [ ] TLS 1.3 handshake ladder is message-accurate and shows where encryption starts
- [ ] Key schedule shows client/server/observer knowledge at each step, with placeholder
      values clearly labeled as not-real-crypto
- [ ] All three certificate failure scenarios break exactly one validation step and
      surface which one
- [ ] 1.2 vs 1.3 comparison shows the extra round trip on the timeline
- [ ] Encryption overlay correctly shows what remains visible to an observer
- [ ] 0-RTT replay caveat is stated in the resumption scenario
- [ ] Certificate validation logic is unit-tested
- [ ] Registry entry `'ready'`

---

## Prompts to execute

### Prompt 9.1 — handshake and certificate logic

```
Read docs/implementation/09-module-https-tls-explorer.md.

Implement the pure logic under src/modules/https-explorer/sim/: handshake13.ts (1-RTT
and 0-RTT/PSK), handshake12.ts, keyschedule.ts (conceptual (EC)DHE -> shared secret ->
HKDF -> handshake and application traffic keys), certificates.ts (chain model plus the
five validation steps from the phase doc), records.ts (TLS record layer wrapping the
phase-08 HTTP bytes), and cipher.ts.

Do not implement real cryptography — use clearly-labeled placeholder values. Verify
against RFC 8446 and RFC 9525. Unit-test certificate validation, including each failure
mode in isolation.
```

### Prompt 9.2 — scenarios

```
Implement the seven scenarios in src/modules/https-explorer/scenarios/ per the phase
doc. Each certificate-failure scenario must break exactly one validation step.

The tls13-resumption scenario must explicitly annotate the 0-RTT replay-attack caveat.
Emit phases and annotations citing RFC 8446 sections. Assert determinism.
```

### Prompt 9.3 — module UI

```
Implement the HTTPS Explorer UI per docs/implementation/09-module-https-tls-explorer.md:
HandshakeLadder, KeyScheduleDiagram (client / server / observer columns),
CertificateChain with per-step pass/fail validation, CipherSuiteBreakdown,
EncryptionOverlay (participant view vs observer view), and the 1.2-vs-1.3 comparison.
Add the route.

The encryption overlay must accurately show what stays visible to an observer: IP
headers, record types and lengths, SNI, timing, and sizes. Then flip the registry entry
to 'ready'.
```
