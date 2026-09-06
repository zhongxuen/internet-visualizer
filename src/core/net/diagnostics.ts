/**
 * `diagnostics.ts` -- the contract the live diagnostics routes and the Live-mode UI
 * both read from.
 *
 * Phase 12.4 requires that `LiveDisclosure` show "the exact URL that will be requested,
 * the method, and where the request originates" *before* anything is sent. A promise
 * like that is only worth making if the panel and the handler are computing it from the
 * same function: two copies of `https://cloudflare-dns.com/dns-query?name=…` drift, and
 * the first time they do, the UI is lying about a real network request. So the URL
 * builders, the resolver and registry constants, and the shape of every response live
 * here -- in `src/core`, framework-free, importable from both sides -- and
 * `src/app/api/diagnostics/_lib/*` re-exports them under the names its own tests use.
 *
 * Nothing in this file performs I/O. It describes requests; `_lib/outbound.ts` is still
 * the only place one is made, and `guard.ts` is still the only thing that authorises
 * one. A browser importing this module gains the ability to *name* a live request and
 * nothing else -- every live call is made by the server, from a route handler, or it is
 * not made at all.
 */

import type { IpScope } from './address';
import { checkHostname, parseLookupTarget } from './guard';
import type { GuardDenialReason } from './guard';

// ---------------------------------------------------------------------------
// The three operations
// ---------------------------------------------------------------------------

/**
 * The live operations, and the complete list of them.
 *
 * Three, matching the phase doc's "supported live operations, and nothing else". There
 * is deliberately no `traceroute`: a serverless runtime cannot send a TTL-limited probe
 * any more than it can send an ICMP echo, and offering a fourth entry that silently
 * fell back to a simulation is the exact ambiguity the safety badge exists to prevent.
 */
export type LiveOperationId = 'dns' | 'rdap' | 'reach';

/** Where the browser sends a live request. Always same-origin, always `GET`. */
export const DIAGNOSTICS_ROUTES: Readonly<Record<LiveOperationId, string>> = {
  dns: '/api/diagnostics/dns',
  rdap: '/api/diagnostics/rdap',
  reach: '/api/diagnostics/reach',
};

/**
 * The same-origin URL the browser will request, with the target as its only meaningful
 * parameter.
 *
 * One target, encoded once, in one query parameter -- `readSingleParam` refuses a second
 * `?target=` and every plural-looking name, so this builder has no way to express a list
 * even if a caller wanted one.
 */
export function diagnosticsRouteUrl(
  operation: LiveOperationId,
  target: string,
  type?: SupportedType,
): string {
  const params = new URLSearchParams({ target });
  if (operation === 'dns' && type) params.set('type', type);
  return `${DIAGNOSTICS_ROUTES[operation]}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// DNS over HTTPS
// ---------------------------------------------------------------------------

/**
 * The one resolver. Cloudflare's `application/dns-json` endpoint: HTTPS on 443, a
 * stable JSON shape, and a published no-logging policy.
 *
 * An allow-list of one, because that is a claim the UI can make honestly and a reader
 * can verify in a second.
 */
export const DOH_RESOLVER = {
  name: 'Cloudflare DNS (1.1.1.1)',
  origin: 'https://cloudflare-dns.com',
  endpoint: 'https://cloudflare-dns.com/dns-query',
  note: 'Resolved over DNS-over-HTTPS by Cloudflare, from this server. Your browser did not make this query, and a different resolver may legitimately answer differently.',
} as const;

/** The record types the live lookup offers, exactly as the phase doc lists them. */
export const SUPPORTED_TYPES = ['A', 'AAAA', 'MX', 'NS', 'TXT', 'CNAME'] as const;

export type SupportedType = (typeof SUPPORTED_TYPES)[number];

/**
 * The exact URL the `dns` route will request for a given name and type.
 *
 * Shown by `LiveDisclosure` before the request is made and built by the handler when it
 * makes it -- the same call, so the panel cannot promise one URL while the server opens
 * a socket to another. Note what it demonstrates: the user's input lands in a query
 * parameter of the *resolver's* URL, never in its authority component.
 */
export function dohUrlFor(name: string, type: SupportedType): string {
  const url = new URL(DOH_RESOLVER.endpoint);
  url.searchParams.set('name', name);
  url.searchParams.set('type', type);
  return url.toString();
}

// ---------------------------------------------------------------------------
// RDAP
// ---------------------------------------------------------------------------

/** IANA's bootstrap registries -- the authoritative "who answers for this?" files. */
export const BOOTSTRAP_URLS = {
  domain: 'https://data.iana.org/rdap/dns.json',
  ipv4: 'https://data.iana.org/rdap/ipv4.json',
  ipv6: 'https://data.iana.org/rdap/ipv6.json',
} as const;

/** The only origin the bootstrap step may reach. */
export const BOOTSTRAP_ORIGIN = 'https://data.iana.org';

/** `<base>/domain/<name>`, with the base's trailing slash normalised exactly once. */
export function rdapUrlFor(base: string, path: 'domain' | 'ip', target: string): string {
  return `${base.replace(/\/+$/, '')}/${path}/${encodeURIComponent(target)}`;
}

// ---------------------------------------------------------------------------
// Reachability -- the thing that is not a ping
// ---------------------------------------------------------------------------

/**
 * The claim the `reach` route is allowed to make, and the one it is not.
 *
 * Kept here rather than in the handler because the UI has to show it *before* the
 * request as well as beside the result, and "live ping is labelled as TCP connect
 * timing, not ICMP" is an acceptance criterion rather than a caption. One sentence, one
 * definition, so the API and the UI cannot drift into two different claims.
 */
export const REACH_NOT_ICMP =
  'This is the time for one HTTP HEAD request from this server to return its first byte — not an ICMP echo. It includes DNS, the TCP handshake, TLS, and the target’s own web server, so it is normally larger than a ping RTT, and a host that drops ICMP can still answer it perfectly.';

/**
 * Response headers worth showing.
 *
 * An allow-list, so a target cannot get an arbitrary header of its choosing rendered in
 * someone's browser, and so the result stays a short readable table rather than forty
 * lines of CDN telemetry.
 */
export const REPORTED_HEADERS: readonly string[] = [
  'content-type',
  'content-length',
  'server',
  'location',
  'date',
  'cache-control',
  'strict-transport-security',
  'alt-svc',
];

/**
 * Turn what the user typed into a URL, or explain why it is not one.
 *
 * A bare `example.com` becomes `https://example.com/` -- the overwhelmingly common
 * intent, and the safe default of the two schemes. Anything that already carries a
 * scheme is left exactly as typed, so `http://…` stays http and `ftp://…` reaches
 * `inspectUrl` and is refused there by name rather than being silently rewritten into
 * something that would be allowed.
 *
 * `assumedScheme` is not decoration: `LiveDisclosure` shows it, because a user who typed
 * a bare host is entitled to know that the request they are about to authorise is an
 * HTTPS one.
 */
export function normalizeReachTarget(input: string): {
  readonly url: string;
  readonly assumedScheme: boolean;
} {
  if (/^[a-z][a-z0-9+.-]*:/i.test(input)) {
    return { url: input, assumedScheme: false };
  }
  // Only a name or a literal that would pass validation anyway gets a scheme bolted
  // on; anything else is handed through untouched so the error names the real problem.
  const asHost = parseLookupTarget(input);
  if (asHost.allowed) {
    const host =
      asHost.value.kind === 'ip' && asHost.value.address.version === 6
        ? `[${asHost.value.text}]`
        : input;
    return { url: `https://${host}/`, assumedScheme: true };
  }
  const asName = checkHostname(input);
  if (asName.allowed) {
    return { url: `https://${asName.value}/`, assumedScheme: true };
  }
  return { url: input, assumedScheme: false };
}

// ---------------------------------------------------------------------------
// The response envelope
// ---------------------------------------------------------------------------

/** Why a diagnostics request failed, in terms the UI switches on. */
export type DiagnosticsErrorCode =
  /** The input was not one well-formed target. */
  | 'invalid-target'
  /** The target was well-formed and refused on purpose -- private, reserved, metadata. */
  | 'blocked-target'
  /** The client or the deployment is over its quota. */
  | 'rate-limited'
  /** The name does not exist, or the registry has no record of it. */
  | 'not-found'
  /** The resolver, registry, or target answered badly. */
  | 'upstream-failed'
  /** Nothing answered inside the 5 s budget. */
  | 'timeout';

/** The failure body. Every field after `message` is optional context for the UI. */
export interface DiagnosticsError {
  readonly ok: false;
  readonly error: {
    readonly code: DiagnosticsErrorCode;
    /** A sentence written to be shown to the user as-is. */
    readonly message: string;
    /** The guard's own reason, when a guard is what refused. */
    readonly reason?: GuardDenialReason;
    /** The address that caused a refusal, canonically formatted. */
    readonly address?: string;
    readonly scope?: IpScope;
    /** The cloud metadata endpoint hit, when that is what it was. */
    readonly metadataEndpoint?: string;
    /** Present on `rate-limited`, matching the `Retry-After` header. */
    readonly retryAfterSeconds?: number;
  };
  /** ISO 8601, so a result shown later can say when it was true. */
  readonly requestedAt: string;
}

/** Where an answer came from, named so the UI never has to guess. */
export interface DiagnosticsSource {
  /** Which live operation produced this. */
  readonly kind: 'doh' | 'rdap' | 'http-head';
  /** Human-readable operator: "Cloudflare (1.1.1.1)", "Verisign", the target itself. */
  readonly name: string;
  /** The exact URL that was requested, so `LiveDisclosure` and the result agree. */
  readonly endpoint: string;
  /** One sentence on what this source is and what it is not. */
  readonly note: string;
}

/**
 * What every successful response carries on top of its own fields.
 *
 * `source` is required by the phase doc: "every live response includes the
 * resolver/registry source and a timestamp".
 */
export interface DiagnosticsMeta {
  readonly ok: true;
  readonly requestedAt: string;
  /** Wall-clock milliseconds spent on the outbound work, rounded to whole ms. */
  readonly elapsedMs: number;
  readonly source: DiagnosticsSource;
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

/** One record as the UI shows it: the numeric type resolved to its name. */
export interface LiveRecord {
  readonly name: string;
  readonly type: string;
  readonly typeValue: number;
  readonly ttl: number;
  readonly data: string;
}

/** What a successful `/api/diagnostics/dns` returns, on top of the shared metadata. */
export interface DnsLookupPayload {
  readonly target: string;
  readonly type: SupportedType;
  readonly question: { readonly name: string; readonly type: string };
  /** `NOERROR`, `NXDOMAIN`, ... -- an NXDOMAIN is a successful lookup with no answer. */
  readonly rcode: string;
  readonly rcodeValue: number;
  /** The resolver's `AD` bit: it validated a DNSSEC chain for this answer. */
  readonly authenticatedData: boolean;
  /** The resolver's `CD` bit: validation was deliberately skipped. */
  readonly checkingDisabled: boolean;
  /** True when the answer did not fit in a UDP datagram upstream. */
  readonly truncated: boolean;
  readonly answers: readonly LiveRecord[];
  /** Populated on an NXDOMAIN: the SOA that proves the name does not exist. */
  readonly authority: readonly LiveRecord[];
  /** The resolver's own comment, when it sends one. */
  readonly comment?: string;
}

/** One party attached to a registration, with contact data marked when it is absent. */
export interface LiveEntity {
  readonly roles: readonly string[];
  readonly handle?: string;
  readonly name?: string;
  readonly organization?: string;
  readonly email?: string;
  /**
   * True when the registry returned the role but no name -- which is the norm for
   * registrant, admin, and tech contacts since GDPR, and is itself worth teaching.
   */
  readonly redacted: boolean;
}

/** A registration lifecycle event, exactly as the registry dated it. */
export interface LiveEvent {
  readonly action: string;
  readonly date: string;
}

export interface LiveNameserver {
  readonly host: string;
  readonly addresses: readonly string[];
}

/** The subset of an RDAP object this module shows, normalised across object classes. */
export interface RdapPayload {
  readonly target: string;
  readonly kind: 'domain' | 'ip';
  /** False when the registry answered 404: the name or block has no record. */
  readonly found: boolean;
  readonly registry: {
    /** The RDAP service base the bootstrap chose. */
    readonly base: string;
    /** The bootstrap file it came from. */
    readonly bootstrap: string;
    /** The bootstrap file's publication date, when it gives one. */
    readonly publication?: string;
  };
  readonly handle?: string;
  /** The domain in LDH (ASCII) form, as the registry spells it. */
  readonly ldhName?: string;
  readonly unicodeName?: string;
  /** EPP status codes -- `clientTransferProhibited` and friends, left unexplained here. */
  readonly statuses: readonly string[];
  readonly events: readonly LiveEvent[];
  readonly nameservers: readonly LiveNameserver[];
  readonly entities: readonly LiveEntity[];
  readonly registrar?: { readonly name: string; readonly ianaId?: number };
  /** `secureDNS.delegationSigned`: is there a DS record in the parent zone? */
  readonly delegationSigned?: boolean;
  /** IP objects only: the allocated range and what it is called. */
  readonly network?: {
    readonly startAddress?: string;
    readonly endAddress?: string;
    readonly name?: string;
    readonly type?: string;
    readonly country?: string;
  };
  /** Each URL the request was redirected to, after re-validation. */
  readonly redirects: readonly string[];
}

/** One address the target's name resolved to, with why it was allowed. */
export interface ReachAddress {
  readonly address: string;
  readonly scope: string;
  readonly version: 4 | 6;
}

/** What a successful `/api/diagnostics/reach` returns, on top of the shared metadata. */
export interface ReachPayload {
  /** The target as typed. */
  readonly target: string;
  /** The URL actually requested, after a bare hostname was given a scheme. */
  readonly requestedUrl: string;
  readonly method: 'HEAD';
  readonly scheme: string;
  readonly hostname: string;
  readonly port: number;
  /** True when an HTTP response came back at all, whatever its status. */
  readonly answered: true;
  readonly status: number;
  readonly statusText: string;
  /** 2xx or 3xx. A 404 still means the host is very much up. */
  readonly ok: boolean;
  /** Milliseconds to the response headers. See {@link REACH_NOT_ICMP}. */
  readonly responseTimeMs: number;
  /** Every address the guard cleared. Empty `resolved` means an IP literal was typed. */
  readonly resolved: boolean;
  readonly addresses: readonly ReachAddress[];
  readonly headers: Readonly<Record<string, string>>;
  /** Present on a 3xx: what the target wanted, and the fact that it was not obeyed. */
  readonly redirect?: {
    readonly status: number;
    readonly location: string;
    readonly followed: false;
    readonly note: string;
  };
  /** Present on https: what the handshake proves, and what this API cannot show. */
  readonly tls?: {
    readonly negotiated: true;
    readonly note: string;
  };
  /** The ICMP caveat, carried in the payload so a saved result keeps it. */
  readonly note: string;
}

/** The body of a successful response, by operation. */
export interface LivePayloads {
  readonly dns: DnsLookupPayload;
  readonly rdap: RdapPayload;
  readonly reach: ReachPayload;
}

/** A successful response, whole: the shared metadata merged with the payload. */
export type DiagnosticsSuccess<K extends LiveOperationId> = DiagnosticsMeta &
  LivePayloads[K];

/** What `GET /api/diagnostics/<operation>` answers with, either way. */
export type DiagnosticsResponse<K extends LiveOperationId> =
  DiagnosticsSuccess<K> | DiagnosticsError;
