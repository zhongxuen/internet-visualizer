/**
 * The fixtures every scenario is built from: one instant, one PKI, one exchange.
 *
 * ## One instant
 *
 * A certificate's validity window is an absolute fact about the real world, so validating
 * one needs a wall-clock instant -- the only one anywhere in this module. It must not be
 * the machine's clock: a scenario that validated against `Date.now()` would go green for
 * a year and then quietly turn red, and `cert-expired` would stop teaching anything the
 * day the fixture aged out of its own window. So {@link SCENARIO_EPOCH} is a constant,
 * chosen and written down, and every date in every scenario is an offset from it.
 *
 * ## One PKI, and each failure is one edit away from it
 *
 * There is a single good chain -- leaf, intermediate, root -- and each of the three
 * failure scenarios changes exactly one thing about it. That is not tidiness; it is the
 * property the phase doc asks for. Three chains built independently could each fail three
 * checks and nobody would notice. Three chains that are the good one with one field
 * altered can only fail the check that field feeds, and `scenarios.test.ts` asserts it for
 * every one of them.
 *
 * ## One exchange
 *
 * The same request and response in every scenario, so that what differs between two runs
 * is the TLS and only the TLS. It is deliberately HTTP/1.1 text: `records.ts` takes a
 * string because the record layer genuinely does not know what it is carrying, and text is
 * the one payload a learner can read straight off the wire view and then watch disappear
 * when the overlay flips to the observer's side.
 *
 * > Every host and address here is a bundled fixture from the RFC 5737 documentation
 * > ranges. There is no code path from any of it to a real network, and there is no
 * > cryptography: every signature, fingerprint, and ciphertext comes from
 * > `sim/placeholder.ts` and says so.
 */

import {
  DAY_MS,
  certificate,
  dnsName,
  type Certificate,
  type CertificateChain,
  type OcspResponse,
  type TrustStore,
} from '../sim/certificates';

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/**
 * Virtual time zero: 2026-03-01T12:00:00Z, as an epoch millisecond.
 *
 * `Date.UTC` is arithmetic on its arguments and reads no clock, so this is a literal in
 * everything but syntax. It is the same instant the HTTP Explorer's scenarios use, so a
 * certificate in this module and an `Expires` header in that one describe the same day.
 */
export const SCENARIO_EPOCH = Date.UTC(2026, 2, 1, 12, 0, 0);

/** An instant this many days before {@link SCENARIO_EPOCH}. */
export function daysBefore(days: number): number {
  return SCENARIO_EPOCH - days * DAY_MS;
}

/** An instant this many days after {@link SCENARIO_EPOCH}. */
export function daysAfter(days: number): number {
  return SCENARIO_EPOCH + days * DAY_MS;
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

/**
 * Addresses for the simulated origins.
 *
 * All from `203.0.113.0/24` -- one of the three ranges RFC 5737 reserves for
 * documentation, precisely so an example address cannot be mistaken for, or routed to, a
 * real host. Nothing in this module opens a socket, and these are chosen so that would
 * still be safe if something one day did.
 */
export const FIXTURE_ADDRESSES = {
  /** `www.example.com`, the site every scenario connects to. */
  www: '203.0.113.11',
  /** The host presenting somebody else's certificate in `cert-hostname-mismatch`. */
  shared: '203.0.113.31',
  /** The internally-issued host in `cert-untrusted-ca`. */
  internal: '203.0.113.41',
} as const;

// ---------------------------------------------------------------------------
// The trusted PKI
// ---------------------------------------------------------------------------

/** A stapled OCSP response saying "good", fresh at {@link SCENARIO_EPOCH}. */
function stapledGood(): OcspResponse {
  return {
    status: 'good',
    producedAt: daysBefore(2),
    nextUpdate: daysAfter(5),
    stapled: true,
  };
}

/** The root in the client's store. Self-signed, long-lived, offline in real life. */
export const EXAMPLE_ROOT: Certificate = certificate({
  id: 'root',
  subject: { commonName: 'Example Root CA X1', organization: 'Example Trust Services' },
  issuer: { commonName: 'Example Root CA X1', organization: 'Example Trust Services' },
  notBefore: daysBefore(3650),
  notAfter: daysAfter(3650),
  publicKey: { algorithm: 'RSA', sizeBits: 4096 },
  basicConstraints: { ca: true },
});

/**
 * The intermediate that does the actual issuing.
 *
 * Roots are kept offline precisely so that a compromise of the machine signing millions of
 * certificates does not mean replacing the trust store on every device on Earth. The
 * `pathLenConstraint: 0` says this CA may issue end-entity certificates and no further
 * CAs -- a narrow delegation rather than an unbounded one.
 */
export const EXAMPLE_INTERMEDIATE: Certificate = certificate({
  id: 'intermediate',
  subject: {
    commonName: 'Example Intermediate R3',
    organization: 'Example Trust Services',
  },
  issuer: EXAMPLE_ROOT.subject,
  notBefore: daysBefore(400),
  notAfter: daysAfter(400),
  publicKey: { algorithm: 'RSA', sizeBits: 2048 },
  basicConstraints: { ca: true, pathLenConstraint: 0 },
  issuedBy: EXAMPLE_ROOT.id,
});

/** The good leaf: current dates, matching SANs, a fresh stapled OCSP, nothing exotic. */
export const WWW_LEAF: Certificate = certificate({
  id: 'leaf-www',
  subject: { commonName: 'www.example.com', organization: 'Example Corporation' },
  issuer: EXAMPLE_INTERMEDIATE.subject,
  notBefore: daysBefore(30),
  notAfter: daysAfter(60),
  subjectAltNames: [dnsName('www.example.com'), dnsName('example.com')],
  publicKey: { algorithm: 'ECDSA', sizeBits: 256, curve: 'P-256' },
  signatureAlgorithm: 'ecdsa-with-SHA256',
  issuedBy: EXAMPLE_INTERMEDIATE.id,
  revocation: stapledGood(),
});

/** The roots the simulated client shipped with. Exactly one, to keep the picture small. */
export const TRUST_STORE: TrustStore = {
  name: 'simulated system trust store (1 root)',
  roots: [EXAMPLE_ROOT],
};

/** Leaf then intermediate, which is the order a server presents them in. */
export const GOOD_CHAIN: CertificateChain = {
  presented: [WWW_LEAF, EXAMPLE_INTERMEDIATE],
};

// ---------------------------------------------------------------------------
// The three failures, one edited field each
// ---------------------------------------------------------------------------

/**
 * Step 2 only: the validity window has closed.
 *
 * Everything else is {@link WWW_LEAF} verbatim -- same issuer, same SANs, same key, same
 * stapled `good` from the CA. That last part is not an oversight: responders answer for a
 * certificate for some time past its expiry, so a certificate really can be simultaneously
 * "not revoked" and "no longer valid". Only the dates moved.
 */
export const EXPIRED_LEAF: Certificate = certificate({
  id: 'leaf-www-expired',
  subject: WWW_LEAF.subject,
  issuer: EXAMPLE_INTERMEDIATE.subject,
  notBefore: daysBefore(120),
  notAfter: daysBefore(12),
  subjectAltNames: [dnsName('www.example.com'), dnsName('example.com')],
  publicKey: { algorithm: 'ECDSA', sizeBits: 256, curve: 'P-256' },
  signatureAlgorithm: 'ecdsa-with-SHA256',
  issuedBy: EXAMPLE_INTERMEDIATE.id,
  revocation: stapledGood(),
});

export const EXPIRED_CHAIN: CertificateChain = {
  presented: [EXPIRED_LEAF, EXAMPLE_INTERMEDIATE],
};

/**
 * Step 3 only: the SANs name a different site.
 *
 * The subject Common Name is still `www.example.com`, and that is the entire trap. RFC
 * 9525 s 2 forbids using the CN to identify a service at all, so a certificate whose CN
 * matches and whose SANs do not is a certificate for the wrong site -- and the check has
 * to fail, however much the viewer's headline row looks right. This is what a shared host
 * handing out the wrong virtual host's certificate looks like from the client's side.
 */
export const MISMATCHED_LEAF: Certificate = certificate({
  id: 'leaf-mismatch',
  subject: { commonName: 'www.example.com', organization: 'Shared Hosting Ltd' },
  issuer: EXAMPLE_INTERMEDIATE.subject,
  notBefore: daysBefore(20),
  notAfter: daysAfter(70),
  subjectAltNames: [dnsName('example.org'), dnsName('www.example.org')],
  publicKey: { algorithm: 'ECDSA', sizeBits: 256, curve: 'P-256' },
  signatureAlgorithm: 'ecdsa-with-SHA256',
  issuedBy: EXAMPLE_INTERMEDIATE.id,
  revocation: stapledGood(),
});

export const MISMATCH_CHAIN: CertificateChain = {
  presented: [MISMATCHED_LEAF, EXAMPLE_INTERMEDIATE],
};

/**
 * Step 1 only: a perfectly well-formed chain to a CA nobody trusts.
 *
 * This root is self-signed, exactly like {@link EXAMPLE_ROOT}, and every certificate under
 * it is impeccable. The single difference is that the client's store has never heard of
 * it -- which is the whole of what step 1 checks, and the reason trust in the web PKI is a
 * fixed list rather than something discoverable. A corporate CA, a self-signed
 * certificate, a missing intermediate, and an active attacker all fail here identically,
 * and that ambiguity is real.
 */
export const INTERNAL_ROOT: Certificate = certificate({
  id: 'internal-root',
  subject: {
    commonName: 'Example Internal Root CA',
    organization: 'Example Corporation',
  },
  issuer: { commonName: 'Example Internal Root CA', organization: 'Example Corporation' },
  notBefore: daysBefore(1000),
  notAfter: daysAfter(2000),
  publicKey: { algorithm: 'RSA', sizeBits: 4096 },
  basicConstraints: { ca: true },
});

export const INTERNAL_INTERMEDIATE: Certificate = certificate({
  id: 'internal-intermediate',
  subject: {
    commonName: 'Example Internal Issuing CA',
    organization: 'Example Corporation',
  },
  issuer: INTERNAL_ROOT.subject,
  notBefore: daysBefore(500),
  notAfter: daysAfter(500),
  publicKey: { algorithm: 'RSA', sizeBits: 2048 },
  basicConstraints: { ca: true, pathLenConstraint: 0 },
  issuedBy: INTERNAL_ROOT.id,
});

export const INTERNAL_LEAF: Certificate = certificate({
  id: 'leaf-internal',
  subject: { commonName: 'www.example.com', organization: 'Example Corporation' },
  issuer: INTERNAL_INTERMEDIATE.subject,
  notBefore: daysBefore(15),
  notAfter: daysAfter(75),
  subjectAltNames: [dnsName('www.example.com'), dnsName('example.com')],
  publicKey: { algorithm: 'ECDSA', sizeBits: 256, curve: 'P-256' },
  signatureAlgorithm: 'ecdsa-with-SHA256',
  issuedBy: INTERNAL_INTERMEDIATE.id,
  revocation: stapledGood(),
});

/**
 * Leaf and intermediate only.
 *
 * The internal root is deliberately not presented, because a server does not send its
 * root: the client is supposed to already have it. That is precisely why this fails.
 */
export const UNTRUSTED_CHAIN: CertificateChain = {
  presented: [INTERNAL_LEAF, INTERNAL_INTERMEDIATE],
};

// ---------------------------------------------------------------------------
// The exchange
// ---------------------------------------------------------------------------

/**
 * The request every scenario carries, as literal HTTP/1.1 bytes.
 *
 * A `GET`, and that is load-bearing in exactly one scenario: `tls13-resumption` sends it
 * as 0-RTT early data, which can be replayed, so it must be a request the site is willing
 * to have executed more than once (RFC 8446 s 2.3). A `POST` here would be a bug.
 *
 * Written as HTTP/1.1 text with ALPN set to `http/1.1` to match. Over `h2` the same
 * request would be HPACK-compressed binary frames inside these same records -- the record
 * layer would not notice the difference, which is the point of a record layer.
 */
export const HTTP_REQUEST = [
  'GET /account/orders HTTP/1.1',
  'Host: www.example.com',
  'User-Agent: InternetVisualizer/1.0 (simulated)',
  'Accept: text/html,application/xhtml+xml',
  'Accept-Encoding: gzip, br',
  'Cookie: session=8f2c19ab4d7e0553',
  '',
  '',
].join('\r\n');

/** The answer. Small enough to fit one record, so the wire view stays one screen. */
export const HTTP_RESPONSE = [
  'HTTP/1.1 200 OK',
  'Content-Type: text/html; charset=utf-8',
  'Content-Length: 122',
  'Cache-Control: private, no-store',
  'Strict-Transport-Security: max-age=63072000; includeSubDomains',
  '',
  '<!doctype html>\n<title>Your orders</title>\n<h1>Your orders</h1>\n<p>Three items, and nobody on the path can read this.</p>\n',
].join('\r\n');
