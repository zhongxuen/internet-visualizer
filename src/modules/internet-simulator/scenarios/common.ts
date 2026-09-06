/**
 * Fixtures shared by the eight page loads.
 *
 * Data only -- no logic. A scenario file is meant to be a screenful of declarations you can
 * read straight through and predict the run from, and everything they have in common lives
 * here so that eight files do not each restate a certificate chain.
 *
 * ## Nothing here can be contacted
 *
 * Every host is under `example.com` / `example.net` (RFC 2606, reserved so an example can
 * never be a real name) and every address is in `192.0.2.0/24`, `198.51.100.0/24`, or
 * `203.0.113.0/24` (RFC 5737, reserved for documentation). The names resolve against the
 * bundled zone fixtures in `@/core/protocols/dns/records` and nothing else -- the resolver
 * has no code path to a real nameserver, and this module has no `fetch`.
 *
 * The two names used were chosen because the bundled zones already model them in a way that
 * makes the scenarios true rather than convenient: `www.example.com` is a CNAME to the apex,
 * so a cold walk really does take an extra hop, and `shop.example.com` is a CNAME out to
 * `edge.cdn.example.net` with a 30-second TTL, which is exactly how a real site is pointed
 * at a CDN.
 *
 * ## The certificates
 *
 * Built with `certificate()` from `@/core/protocols/tls/certificates`, which fills in the
 * placeholder signature and fingerprint deterministically from the id. There is no
 * cryptography here and there is not meant to be: `issuedBy` models the *result* of a
 * signature check, which is what lets a scenario break a chain by pointing it at a CA the
 * client does not have.
 */

import {
  certificate,
  dnsName,
  DAY_MS,
  type Certificate,
  type CertificateChain,
  type TrustStore,
} from '@/core/protocols/tls/certificates';

import {
  PAGE_LOAD_EPOCH,
  type DocumentSpec,
  type OriginSpec,
  type SubresourceSpec,
  type TlsSpec,
} from '../sim/stage';

/** The wall-clock instant every scenario is judged at. */
export const SCENARIO_EPOCH = PAGE_LOAD_EPOCH;

/** An instant `days` before the scenario's now, in epoch milliseconds. */
export function daysBefore(days: number): number {
  return SCENARIO_EPOCH - days * DAY_MS;
}

/** An instant `days` after the scenario's now. */
export function daysAfter(days: number): number {
  return SCENARIO_EPOCH + days * DAY_MS;
}

/** The site the scenarios load. Reserved by RFC 2606; it is not a real name. */
export const SITE_HOST = 'www.example.com';

/** The CDN-fronted variant, which the bundled zones already CNAME out to an edge. */
export const CDN_HOST = 'shop.example.com';

/** Addresses, all from the documentation ranges. */
export const ADDRESSES = {
  /** `example.com`'s A record in the bundled zone -- the origin. */
  origin: '203.0.113.20',
  /** `edge.cdn.example.net`'s first A record -- the point of presence. */
  edge: '198.51.100.40',
} as const;

// ---------------------------------------------------------------------------
// The certificates
// ---------------------------------------------------------------------------

/** The root in the client's trust store. */
export const EXAMPLE_ROOT: Certificate = certificate({
  id: 'root',
  subject: { commonName: 'Example Root CA X1', organization: 'Example Trust Services' },
  issuer: { commonName: 'Example Root CA X1', organization: 'Example Trust Services' },
  notBefore: daysBefore(3650),
  notAfter: daysAfter(3650),
  publicKey: { algorithm: 'ECDSA', curve: 'P-384', sizeBits: 384 },
  signatureAlgorithm: 'ecdsa-with-SHA384',
  basicConstraints: { ca: true },
});

/** The intermediate that actually issues leaves; the root stays offline. */
export const EXAMPLE_INTERMEDIATE: Certificate = certificate({
  id: 'intermediate',
  subject: {
    commonName: 'Example TLS Issuing CA 3',
    organization: 'Example Trust Services',
  },
  issuer: EXAMPLE_ROOT.subject,
  notBefore: daysBefore(1200),
  notAfter: daysAfter(1200),
  publicKey: { algorithm: 'ECDSA', curve: 'P-256', sizeBits: 256 },
  signatureAlgorithm: 'ecdsa-with-SHA256',
  basicConstraints: { ca: true, pathLenConstraint: 0 },
  issuedBy: EXAMPLE_ROOT.id,
});

/**
 * The leaf, valid for both hostnames the scenarios use.
 *
 * A single wildcard covers them, which is what a real site with an apex and subdomains
 * would buy. `*.example.com` is a legal wildcard: the star is the whole leftmost label of a
 * name with more than two labels, which is where RFC 9525 s6.3 draws the line.
 */
export const SITE_LEAF: Certificate = certificate({
  id: 'leaf-example',
  subject: { commonName: SITE_HOST, organization: 'Example Corp' },
  issuer: EXAMPLE_INTERMEDIATE.subject,
  notBefore: daysBefore(30),
  notAfter: daysAfter(60),
  subjectAltNames: [dnsName('example.com'), dnsName('*.example.com')],
  publicKey: { algorithm: 'ECDSA', curve: 'P-256', sizeBits: 256 },
  signatureAlgorithm: 'ecdsa-with-SHA256',
  issuedBy: EXAMPLE_INTERMEDIATE.id,
});

/** The same leaf, three days past its expiry. */
export const EXPIRED_LEAF: Certificate = certificate({
  id: 'leaf-expired',
  subject: { commonName: SITE_HOST, organization: 'Example Corp' },
  issuer: EXAMPLE_INTERMEDIATE.subject,
  notBefore: daysBefore(93),
  notAfter: daysBefore(3),
  subjectAltNames: [dnsName('example.com'), dnsName('*.example.com')],
  publicKey: { algorithm: 'ECDSA', curve: 'P-256', sizeBits: 256 },
  signatureAlgorithm: 'ecdsa-with-SHA256',
  issuedBy: EXAMPLE_INTERMEDIATE.id,
});

/** What the client shipped with. The root is here, and never on the wire. */
export const TRUST_STORE: TrustStore = {
  name: 'Simulated browser root store',
  roots: [EXAMPLE_ROOT],
};

/** Leaf first, then the intermediate. The root is deliberately not included. */
export const GOOD_CHAIN: CertificateChain = {
  presented: [SITE_LEAF, EXAMPLE_INTERMEDIATE],
};

/** The same chain with an expired leaf: everything else about it is fine. */
export const EXPIRED_CHAIN: CertificateChain = {
  presented: [EXPIRED_LEAF, EXAMPLE_INTERMEDIATE],
};

/** The TLS setup a healthy https scenario uses. */
export const HEALTHY_TLS: TlsSpec = {
  version: '1.3',
  chain: GOOD_CHAIN,
  store: TRUST_STORE,
  validationAt: SCENARIO_EPOCH,
  alpn: 'h2',
};

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

/**
 * The document.
 *
 * `max-age=60` with an `ETag`: short enough that a repeat visit a few minutes later finds
 * it stale and has to revalidate, which is the ordinary case for an HTML document and the
 * one that produces a 304. A document with a long `max-age` would be a different lesson --
 * and a worse one, because almost no real site can cache its HTML that way.
 */
export const SITE_DOCUMENT: DocumentSpec = {
  bytes: 34_000,
  excerpt: [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <link rel="stylesheet" href="/assets/app.css">',
    '  <script src="/assets/app.js" defer></script>',
    '</head>',
    '<body>',
    '  <img src="/assets/hero.avif" alt="" width="1200" height="630">',
    '</body>',
    '</html>',
  ].join('\n'),
  cacheControl: 'max-age=60',
  etag: '"doc-v41"',
  lastModifiedAgoSeconds: 86_400,
  serverThinkMs: 45,
};

/**
 * What the document asks for once it has been parsed.
 *
 * One render-blocking stylesheet, a deferred script, a font, and a hero image that is the
 * largest contentful paint. The proportions are deliberate: the image is most of the bytes
 * and the stylesheet is most of the *delay*, which is the point.
 */
export const SITE_SUBRESOURCES: readonly SubresourceSpec[] = [
  {
    id: 'css',
    label: 'app.css',
    target: '/assets/app.css',
    kind: 'stylesheet',
    bytes: 42_000,
    renderBlocking: true,
    cacheControl: 'max-age=31536000, immutable',
    etag: '"css-8f2a"',
  },
  {
    id: 'js',
    label: 'app.js',
    target: '/assets/app.js',
    kind: 'script',
    bytes: 96_000,
    cacheControl: 'max-age=31536000, immutable',
    etag: '"js-1c74"',
  },
  {
    id: 'font',
    label: 'inter.woff2',
    target: '/assets/inter.woff2',
    kind: 'font',
    bytes: 28_000,
    cacheControl: 'max-age=31536000, immutable',
    etag: '"font-40b1"',
  },
  {
    id: 'hero',
    label: 'hero.avif',
    target: '/assets/hero.avif',
    kind: 'image',
    bytes: 180_000,
    lcpCandidate: true,
    cacheControl: 'max-age=604800',
    etag: '"hero-9d13"',
  },
  {
    id: 'api',
    label: 'session.json',
    target: '/api/session',
    kind: 'fetch',
    bytes: 1_200,
    serverThinkMs: 30,
    cacheControl: 'no-store',
  },
];

/** The origin, as every scenario that loads this page describes it. */
export const SITE_ORIGIN: OriginSpec = {
  address: ADDRESSES.origin,
  label: 'example.com origin',
  document: SITE_DOCUMENT,
  subresources: SITE_SUBRESOURCES,
};

/**
 * Everything a repeat visit would already be holding.
 *
 * Everything here was stored on the previous visit, a little under seven minutes ago. The
 * four assets are still fresh -- `immutable` and a week-long `max-age` see to that -- and
 * the document is not, because its `max-age=60` ran out six minutes ago. So the repeat
 * visit is the interesting case rather than a trivial one: the assets cost nothing at all,
 * and the document costs one round trip and no body.
 */
export const WARM_STORE = [
  { target: '/', storedSecondsAgo: 400 },
  { target: '/assets/app.css', storedSecondsAgo: 400 },
  { target: '/assets/app.js', storedSecondsAgo: 400 },
  { target: '/assets/inter.woff2', storedSecondsAgo: 400 },
  { target: '/assets/hero.avif', storedSecondsAgo: 400 },
] as const;
