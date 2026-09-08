# Protocol accuracy

Every protocol claim this product makes, and the document it comes from.

This exists because an animation is persuasive whether or not it is right. A learner
watching a packet cross a diagram has no way to tell a faithful sequence from a plausible
one, so the burden is on the product to be checkable — and "checkable" means naming the
paragraph a reviewer can read in order to disagree with us.

## How a claim reaches the screen

A simulation emits events, and an event that asserts something about a protocol carries a
citation with it:

```ts
// src/core/types/events.ts
export interface RfcRef {
  rfc: number;
  section?: string; // omit to cite the document as a whole
  title: string;
}
```

`{ kind: 'annotate', …, reference }` is the only event type that carries one, and the
inspector, the DNS ladder, the handshake ladder and the hop table all render it as the
line under the note. So the citation is not a bibliography compiled after the fact — it is
attached to the individual sentence it justifies, in the same object, and it is on screen
next to that sentence.

Running every scenario in the codebase produces **503 such citations, naming 45 distinct
RFCs** — and that is a count of what a user can actually be shown, not of what the source
contains, because a citation attached to an event no scenario reaches is not a claim the
product makes. `tests/rfc-references.test.ts` is what collects them: it runs the same
catalogue the determinism guard runs, and fails if a citation is malformed or names an RFC
this document does not list. The tables below therefore cannot fall behind the product.

They can legitimately run ahead of it. Several documents here govern the *fixtures* rather
than any one moment in a run (RFC 5737 and RFC 2606 below), and RFC 8484 describes a live
operation, which emits no simulation events at all — so the test asserts the tables are a
superset, not an exact match.

## The three things "accurate" means here

**1. The structure is real; the values are authored.** Field order, dependency order, who
can compute what and when, which message carries which extension, what a header field
means — those are checked against the RFC and are what the product teaches. The bytes are
not real bytes. A packet in Packet Journey carries an authored payload, and a "key" in
HTTPS Explorer is a placeholder (see [Cryptography](#cryptography-there-is-none) below).

**2. Every host, name and address is reserved for documentation.** Nothing in any fixture
can be mistaken for, or pointed at, a real machine:

| Range                                                                                                    | Reserved by        |
| -------------------------------------------------------------------------------------------------------- | ------------------ |
| `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`                                                      | RFC 5737           |
| `2001:db8::/32`                                                                                           | RFC 3849           |
| `.example`, `example.com`, `example.net`, `example.org`                                                   | RFC 2606 §2        |
| `AS64496`                                                                                                 | RFC 5398           |
| `10/8`, `172.16/12`, `192.168/16`, `fc00::/7` — where a scenario is *about* private space                 | RFC 1918, RFC 4193 |

**3. Where the model stops, it says so on screen.** The
[Deliberate simplifications](#deliberate-simplifications) section is the complete list, and
every entry in it is stated in the UI as well as here. A gap that is only in this file is a
gap that is hidden.

---

## Internet layer — IPv4, ICMP, NAT

Implemented in `src/core/protocols/ipv4/ipv4.ts`; animated by Packet Journey and Network
Diagnostics' simulated traceroute.

| Claim                                                                                   | Reference         |
| ----------------------------------------------------------------------------------------- | ----------------- |
| The IPv4 header is 20 bytes without options, in the field order shown                     | RFC 791 §3.1      |
| Each router decrements TTL by one, and discards the datagram when it reaches zero         | RFC 791 §3.2      |
| A router discarding for TTL sends ICMP Time Exceeded back to the source                   | RFC 792           |
| Which is what makes traceroute work: probes sent with a deliberately small TTL            | RFC 792           |
| A host must not forward a datagram whose TTL it decremented to zero                       | RFC 1122 §3.2.2.6 |
| The header checksum is the one-complement sum over the header, recomputed at every hop    | RFC 1071          |
| Fragmentation splits on 8-byte boundaries; MF and the fragment offset carry the reassembly | RFC 791 §3.2      |
| Path MTU discovery: DF set, and ICMP Fragmentation Needed carries the next-hop MTU        | RFC 1191          |
| A NAT rewrites the source address and port and keeps a translation table                  | RFC 3022 §2.2     |

## Transport — UDP and TCP

`src/core/protocols/udp/udp.ts` and `src/core/protocols/tcp/tcp.ts`.

| Claim                                                                                    | Reference       |
| ------------------------------------------------------------------------------------------ | --------------- |
| The UDP header is 8 bytes: source port, destination port, length, checksum                 | RFC 768         |
| UDP has no handshake, no ordering and no retransmission — a datagram is the whole story    | RFC 768         |
| The TCP header is 20 bytes without options; the data offset counts 32-bit words            | RFC 9293 §3.1   |
| Three-way handshake: SYN, SYN-ACK, ACK, with an initial sequence number chosen by each side | RFC 9293 §3.5   |
| The initial sequence number is neither zero nor predictable                                | RFC 6528        |
| Sequence numbers count bytes rather than segments; SYN and FIN each consume one            | RFC 9293 §3.4   |
| Teardown is FIN, ACK, FIN, ACK, and the TIME-WAIT that follows                             | RFC 9293 §3.6   |
| A lost segment leaves a gap between the sender SND.NXT and the receiver RCV.NXT            | RFC 9293 §3.7.1 |
| The retransmission timeout is derived from smoothed round-trip time and its variance       | RFC 6298 §5     |
| The usual MSS on Ethernet is 1460 = 1500 − 20 (IPv4) − 20 (TCP)                             | RFC 9293 §3.7.1 |

## DNS

`src/core/protocols/dns/{resolver,records,cache,dnssec}.ts`; animated by DNS Explorer, the
Internet Simulator's DNS stage, and Network Diagnostics' simulated lookup.

| Claim                                                                                     | Reference                              |
| ------------------------------------------------------------------------------------------- | -------------------------------------- |
| Iterative resolution: stub → recursive resolver → root → TLD → authoritative                 | RFC 1034 §4.3.2                        |
| A referral carries NS records in the authority section and glue in the additional section    | RFC 1034 §4.3.2                        |
| AA is set only by a server authoritative for the zone, and is clear on a referral            | RFC 1035 §4.1.1                        |
| A CNAME is an alias, and the resolver restarts the search at the target                      | RFC 1034 §3.6.2                        |
| The DNS message header: ID, QR, OPCODE, AA, TC, RD, RA, RCODE, and the four section counts   | RFC 1035 §4.1.1                        |
| Names on the wire are length-prefixed labels                                                 | RFC 1035 §3.1                          |
| Queries go over UDP port 53 and fall back to TCP when TC is set                              | RFC 1035 §4.2                          |
| A record TTL is how long a cache may keep it                                                 | RFC 1035 §3.2.1                        |
| NXDOMAIN is negative-cached, bounded by the SOA minimum rather than by the query             | RFC 2308 §3, §5                        |
| An RRSet is atomic — every record of one name and type shares a TTL                          | RFC 2181 §5.2                          |
| A CNAME may not coexist with other data at the same name                                     | RFC 1912 §2.4                          |
| EDNS(0) advertises a larger UDP payload size in an OPT pseudo-record                         | RFC 6891                               |
| EDNS Client Subnet lets a resolver disclose part of the client prefix to a CDN               | RFC 7871                               |
| The 13 root server addresses are anycast, not 13 machines                                    | RFC 4786 — operational practice rather than a DNS requirement, and the scenario says so |

### DNSSEC

| Claim                                                                        | Reference       |
| ------------------------------------------------------------------------------ | --------------- |
| DNSSEC provides origin authentication and integrity, not confidentiality       | RFC 4033 §2     |
| RRSIG, DNSKEY, DS and NSEC are the four record types the chain is built from   | RFC 4034 §3     |
| Validation walks a chain of trust downward from the root trust anchor          | RFC 4035 §5     |
| A DS record in the parent zone hashes the child key-signing key                | RFC 4034 §5     |
| The DS digest type shown is SHA-256                                            | RFC 4509        |
| A validating resolver sets AD on an answer it has verified                     | RFC 4035 §3.2.3 |
| A failed validation is SERVFAIL, not a silent downgrade to unsigned data       | RFC 4035 §5.5   |

## TLS

`src/core/protocols/tls/{handshake13,handshake12,keyschedule,records,certificates,cipher}.ts`;
animated by HTTPS Explorer and the Internet Simulator's TLS stage.

| Claim                                                                                              | Reference                    |
| ---------------------------------------------------------------------------------------------------- | ---------------------------- |
| TLS 1.3 completes in one round trip                                                                  | RFC 8446 §2                  |
| ClientHello carries key_share, so the key exchange starts before the server has spoken               | RFC 8446 §4.1.2              |
| ServerHello selects one cipher suite and one key share                                               | RFC 8446 §4.1.3              |
| Everything after ServerHello is encrypted, the certificate included                                  | RFC 8446 §2                  |
| CertificateVerify signs the handshake transcript                                                     | RFC 8446 §4.4.3              |
| Finished is a MAC over the transcript, and is what makes a downgrade detectable                      | RFC 8446 §4.4.4              |
| The key schedule is HKDF-Extract and HKDF-Expand-Label over a chain of secrets                       | RFC 8446 §7.1, RFC 5869      |
| 0-RTT data is replayable, and must therefore be restricted to idempotent requests                    | RFC 8446 §2.3, §8            |
| Record layer: content type, legacy version, length, then the protected payload                       | RFC 8446 §5.1                |
| The real content type is inside the encrypted record; the outer one always says `application_data`   | RFC 8446 §5.2                |
| An alert is a two-byte record: level and description                                                 | RFC 8446 §6.2                |
| TLS 1.2 needs two round trips before application data                                                | RFC 5246 §7.3                |
| ChangeCipherSpec is a TLS 1.2 record, retained in 1.3 only for middlebox compatibility               | RFC 5246 §7.1, RFC 8446 §D.4 |
| SNI carries the requested host name in the clear inside ClientHello                                  | RFC 6066 §3                  |
| ALPN negotiates the application protocol (`h2`, `http/1.1`) inside the handshake                     | RFC 7301                     |
| Session tickets let a client resume without server-side state                                        | RFC 5077, RFC 8446 §2.2      |
| The extended master secret binds the master secret to the handshake transcript                       | RFC 7627                     |
| TLS 1.0 and TLS 1.1 are deprecated and must not be negotiated                                        | RFC 8996                     |

### Certificates

| Claim                                                                              | Reference                  |
| ------------------------------------------------------------------------------------ | -------------------------- |
| An X.509 certificate is validated as a path from leaf to a trusted root              | RFC 5280 §6.1              |
| `notBefore` / `notAfter` bound validity, and are checked at every link in the path    | RFC 5280 §4.1.2.5          |
| Identity is matched against subjectAltName; the common name is not a fallback         | RFC 9525 §6.1, §6.3        |
| A wildcard matches exactly one label, and only in the leftmost position               | RFC 9525 §6.3              |
| Revocation is checked with OCSP, and the response can be stapled into the handshake   | RFC 6960 §2.2, RFC 6066 §8 |

## HTTP

`src/core/protocols/http/{semantics,message,caching,cookies,versions}.ts`; animated by HTTP
Explorer, API Visualizer and the Internet Simulator.

### Methods and status codes

Every method and every status code the product shows carries its own section citation in
`semantics.ts` — nine method entries and forty status entries, each with its own `rfc`
field. The tables are too long to restate here; the sources are:

| Group                                                                | Reference              |
| ---------------------------------------------------------------------- | ---------------------- |
| GET, HEAD, POST, PUT, DELETE, CONNECT, OPTIONS, TRACE                  | RFC 9110 §9.3.1–§9.3.8 |
| PATCH                                                                  | RFC 5789               |
| Safe, idempotent and cacheable as three separate properties            | RFC 9110 §9.2          |
| 1xx–5xx status semantics                                               | RFC 9110 §15.2–§15.6   |
| 428, 429, 431, 511                                                     | RFC 6585               |
| 103 Early Hints                                                        | RFC 8297               |
| Why 307 and 308 exist: 301 and 302 were rewritten to GET in practice   | RFC 9110 §15.4.8–§15.4.9 |
| Problem Details as the error body format                               | RFC 9457               |
| `Link` header relations for pagination                                 | RFC 8288 §3.3          |
| JSON Merge Patch as a PATCH body format                                | RFC 7396               |

### Caching

| Claim                                                                                 | Reference                   |
| --------------------------------------------------------------------------------------- | --------------------------- |
| Freshness comes from `Cache-Control: max-age`, then `Expires`, then a heuristic          | RFC 9111 §4.2               |
| A stale response is revalidated with `If-None-Match` / `If-Modified-Since`, giving 304   | RFC 9111 §4.3               |
| `no-store` forbids storage; `no-cache` requires revalidation before reuse                | RFC 9111 §5.2.2   |
| `private` bars a shared cache but not the browser cache                                  | RFC 9111 §5.2.2   |
| `Vary` selects among stored responses by request header                                  | RFC 9111 §4.1               |
| `Age` is what a shared cache adds so freshness survives the hop                          | RFC 9111 §5.1               |

### Cookies

| Claim                                                                                | Reference                  |
| -------------------------------------------------------------------------------------- | -------------------------- |
| `Set-Cookie` syntax and its attributes                                                  | RFC 6265 §4.1              |
| Domain matching is suffix matching, and a leading dot is ignored                        | RFC 6265 §5.1.3            |
| Path matching is prefix matching on path segments                                       | RFC 6265 §5.1.4            |
| `Secure` restricts to HTTPS; `HttpOnly` hides the cookie from script                    | RFC 6265 §4.1.2.5–§4.1.2.6 |
| `SameSite` (Lax / Strict / None) — cited as 6265bis, a draft, and labelled as one       | RFC 6265bis (draft)        |
| An origin is scheme + host + port, and is not the same thing as a cookie domain scope   | RFC 6454 §4                |
| HSTS makes a host HTTPS-only for a stated max-age                                       | RFC 6797 §8.3              |

### Versions

| Claim                                                                             | Reference           |
| ----------------------------------------------------------------------------------- | ------------------- |
| HTTP/1.1 is text on the wire: request line, fields, CRLF CRLF, then a body           | RFC 9112 §2.1–§5    |
| HTTP/1.1 concurrency is multiple connections; pipelining is effectively unused       | RFC 9112 §9.3–§9.4  |
| HTTP/2 is binary frames on streams over one connection, and has no text form         | RFC 9113 §4–§5      |
| HTTP/2 stream identifiers: client-initiated streams are odd                          | RFC 9113 §5.1.1     |
| HPACK compresses HTTP/2 header fields                                                | RFC 7541            |
| HTTP/3 runs over QUIC over UDP, and has no TCP head-of-line blocking                  | RFC 9114 §3.1, RFC 9000 |
| QPACK compresses HTTP/3 header fields                                                | RFC 9204            |

## WebSockets

`src/modules/websocket-viewer/sim/`.

| Claim                                                                                | Reference                       |
| -------------------------------------------------------------------------------------- | ------------------------------- |
| The connection begins as an HTTP GET carrying `Upgrade: websocket`                     | RFC 6455 §4.1                   |
| `Sec-WebSocket-Key` is echoed as `Sec-WebSocket-Accept`, over the protocol GUID        | RFC 6455 §4.2.2                 |
| The successful response is 101 Switching Protocols                                     | RFC 6455 §4.1, RFC 9110 §15.2.2 |
| After the upgrade the connection carries frames, not requests                           | RFC 6455 §5.1                   |
| The frame header: FIN, RSV, opcode, MASK, payload length, masking key                   | RFC 6455 §5.2                   |
| A client-to-server frame must be masked; a server-to-client frame must not be           | RFC 6455 §5.1, §5.3             |
| Continuation frames carry a fragmented message                                          | RFC 6455 §5.4                   |
| Ping and pong are control frames, and a pong echoes the ping payload                    | RFC 6455 §5.5.2–§5.5.3          |
| Close carries a two-byte status code, and the codes shown are the registered ones       | RFC 6455 §5.5.1, §7.4.1         |
| 426 Upgrade Required is the refusal path                                                | RFC 9110 §15.5.22               |

## APIs and authentication

`src/modules/api-visualizer/sim/`.

| Claim                                                                                    | Reference                 |
| ------------------------------------------------------------------------------------------ | ------------------------- |
| Bearer tokens go in the `Authorization` header, not in the query string                    | RFC 6750 §2.1, §2.3       |
| A 401 carries `WWW-Authenticate`; a 403 does not, because the credential was understood    | RFC 9110 §15.5.2, §15.5.4 |
| The OAuth 2.0 authorization code grant, step by step                                       | RFC 6749 §4.1             |
| `state` is CSRF protection for the redirect                                                | RFC 6749 §10.12           |
| Scope is a space-delimited list, and is the server to narrow                               | RFC 6749 §3.3             |
| OAuth error responses: `invalid_grant`, `invalid_client`, and the rest                     | RFC 6749 §5.2             |
| PKCE: verifier, `S256` challenge, and the exchange that checks them                        | RFC 7636 §4.1–§4.6        |
| PKCE exists because a public client cannot keep a secret                                   | RFC 7636 §1               |
| A JWT is three base64url segments: header, claims, signature                               | RFC 7519 §3               |
| `exp`, `nbf`, `aud` and `iss` are registered claims with defined meanings                  | RFC 7519 §4.1             |
| `alg: none` is the attack the header enables if it is trusted                              | RFC 7515 §4.1.1           |
| HMAC construction for a signed webhook                                                     | RFC 2104                  |
| HTTP Message Signatures as the standardised alternative to a bespoke HMAC header           | RFC 9421                  |
| 429 with `Retry-After` is the rate-limit response                                          | RFC 6585 §4               |

GraphQL and the token-bucket rate limiter are **not** RFC-specified, and the module says so
rather than implying a standard exists. `sim/graphql.ts` states in as many words that it
draws the shape of a GraphQL exchange and stops well short of being an implementation.

## Diagnostics

`src/modules/network-diagnostics/`, plus the Route Handlers in `src/app/api/diagnostics/`.

| Claim                                                                    | Reference             |
| -------------------------------------------------------------------------- | --------------------- |
| ping is ICMP Echo Request and Echo Reply                                   | RFC 792               |
| traceroute works by TTL expiry and the ICMP Time Exceeded that results     | RFC 791 §3.2, RFC 792 |
| WHOIS is a plain TCP port-43 text protocol with no defined response format | RFC 3912              |
| RDAP is its structured successor: JSON over HTTPS                          | RFC 9082, RFC 9083    |
| An RDAP client finds the right server through the IANA bootstrap registry  | RFC 7484              |
| DNS-over-HTTPS is what Live mode's lookup actually uses                    | RFC 8484              |
| Reserved suffixes (`.local`, `.internal`, `.test`, `.invalid`) are refused | RFC 6761, RFC 8375    |

**Live mode's reachability check is not ping, and the UI never calls it ping.** A serverless
runtime does not grant the raw socket an ICMP echo needs, so the live operation is a TCP
connect plus one HTTP `HEAD`, labelled _Reachability (TCP + HTTP timing)_. There is no live
traceroute for the same reason, and the console says so where one would be. The sentence
itself is the `REACH_NOT_ICMP` constant in `src/core/net/diagnostics.ts`, so it cannot
drift between the two places it appears.

---

## Deliberate simplifications

Each of these is stated in the product as well as here.

### Cryptography: there is none

`src/core/protocols/tls/placeholder.ts` is the only file in the TLS layer allowed to look
like cryptography, and what it contains is a 32-bit FNV-1a hash of a label string. Every
"key", "secret", "signature", "fingerprint" and "ciphertext" the product shows comes from
it, and every one is:

- not secret — derived from public inputs in that file,
- not random — the same label always gives the same value,
- not one-way — FNV-1a is a hash-table function,
- not a key — nothing in this layer encrypts, signs or verifies anything.

Every such value is rendered with a `PLACEHOLDER-` prefix, and `PLACEHOLDER_NOTICE` is the
sentence the UI shows wherever one appears. A convincing-looking fake implementation would
be worse than an honest diagram, because a learner cannot tell the difference and might
reach for it.

What _is_ modelled faithfully is the structure: which input feeds which derivation, what
depends on what, who can compute what and when, and the sizes involved. That structure is
checkable against RFC 8446, and it is what the module teaches.

### TCP: no congestion control

`tcp.ts` models the sequence space, the handshake, teardown, loss, and retransmission
timing. It does not model congestion control, selective acknowledgement, timestamps or
window scaling, and the receive window is a constant. The file is about what the numbers in
the header mean, not about how fast a real stack would go.

The consequence is named where it bites. The Internet Simulator's CDN stage computes
download time as `bytes × 8 / bandwidth`, which assumes the connection is already running at
the link capacity — a real connection starts at roughly ten segments and doubles each round
trip, so the first ~14 KB arrives at one round trip's cost regardless of bandwidth.
`cdn-stage.ts` says so in its own header rather than asserting a number it cannot derive.

### The TCP checksum is not computed

It renders as `0x0000 (not modelled)`. The checksum covers a pseudo-header plus the
payload, and the payloads here are authored rather than real bytes, so a computed value
would be a real-looking number that means nothing.

The IPv4 header checksum _is_ computed, over the real 20 header bytes, because those bytes
are real — which is what makes the "recomputed at every hop" claim demonstrable rather than
merely asserted.

### DNSSEC signatures are not verified

The chain of trust is modelled as a structure: which record signs which, and in what order a
validator checks them. No signature is verified, because there is no cryptography (above). A
scenario that shows validation failing fails by construction rather than by arithmetic.

### One packet is one packet

Packet Journey animates individual datagrams; real traffic is bursts of them. Every timing
in every module is a virtual millisecond authored into the scenario, chosen to be legible
rather than to be to scale, and no number anywhere in the product is a measurement.

### The topologies are small, and routing is authored

A home LAN, a small office and a datacenter, at a few dozen nodes each. The path a packet
takes is a path through an authored topology rather than the output of a routing protocol —
BGP is named in the Network Map as the thing that chooses between autonomous systems, and is
not simulated.

---

## Adding a claim

1. Attach an `RfcRef` to the event that makes it. Cite the section rather than the whole
   document, unless the claim really is about the whole document.
2. Quote the RFC's own title in `title`. The UI shows it, and a reader should be able to
   search for it.
3. Add the RFC to the relevant table above if it is not there already —
   `tests/rfc-references.test.ts` fails otherwise.
4. If the claim is a simplification, say so on screen first and in this file second. A gap
   documented only here is a gap a user cannot see.
