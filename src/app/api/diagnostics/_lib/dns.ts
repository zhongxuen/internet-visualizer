/**
 * `dns.ts` -- the live DNS lookup, over DNS-over-HTTPS, against one allow-listed
 * public resolver.
 *
 * The user's target here is never a destination: it is a *parameter* to a request that
 * always goes to the same resolver. That is why this handler runs `parseLookupTarget`
 * (validate the name, refuse `localhost`, refuse private literals) but does not resolve
 * it -- there is nothing to connect to. The only address this route ever opens a socket
 * to is Cloudflare's, and `allowedOrigins` pins it there even if every other check were
 * somehow bypassed.
 *
 * One resolver, not a list, because "an allow-list of one" is a claim the UI can make
 * honestly and a reader can verify in a second.
 */

import {
  dohUrlFor,
  DOH_RESOLVER,
  SUPPORTED_TYPES,
  type DnsLookupPayload,
  type LiveRecord,
  type SupportedType,
} from '@/core/net/diagnostics';
import { parseLookupTarget } from '@/core/net/guard';

import type { DiagnosticsDeps } from './deps';
import { clientKeyOf } from './deps';
import { guardedFetch, isOutboundOk, respondOutboundFailure } from './outbound';
import { readOptionalParam, readSingleParam } from './request';
import {
  respondDenied,
  limitHeaders,
  respondError,
  respondOk,
  respondRateLimited,
  type DiagnosticsSource,
} from './respond';

/**
 * The resolver, the type list, the URL builder, and the payload shape live in
 * `@/core/net/diagnostics` so `LiveDisclosure` can show the exact URL this handler will
 * request *before* it requests it. Re-exported under the names this file has always
 * used, so its tests and callers do not care that they moved.
 */
export {
  dohUrlFor,
  DOH_RESOLVER,
  SUPPORTED_TYPES,
  type DnsLookupPayload,
  type LiveRecord,
  type SupportedType,
} from '@/core/net/diagnostics';

/**
 * Numeric RR type -> name, for rendering an answer section.
 *
 * Wider than {@link SUPPORTED_TYPES}: a query for `A` can legitimately be answered with
 * a `CNAME` chain, and a `SOA` turns up in the authority section of an NXDOMAIN, so the
 * table has to name what can come *back*, not just what can be asked.
 */
const RR_TYPE_NAMES: Readonly<Record<number, string>> = {
  1: 'A',
  2: 'NS',
  5: 'CNAME',
  6: 'SOA',
  12: 'PTR',
  15: 'MX',
  16: 'TXT',
  28: 'AAAA',
  33: 'SRV',
  43: 'DS',
  46: 'RRSIG',
  47: 'NSEC',
  48: 'DNSKEY',
  50: 'NSEC3',
  257: 'CAA',
};

/** RFC 1035 section 4.1.1 plus RFC 6895, for the codes a public resolver returns. */
const RCODE_NAMES: Readonly<Record<number, string>> = {
  0: 'NOERROR',
  1: 'FORMERR',
  2: 'SERVFAIL',
  3: 'NXDOMAIN',
  4: 'NOTIMP',
  5: 'REFUSED',
};

/**
 * A minimal, tolerant parser for the `application/dns-json` body.
 *
 * Hand-written rather than a zod schema: the only fields that matter are a handful of
 * numbers and a records array, everything else is ignored on purpose, and the input is
 * from an allow-listed endpoint rather than from the user. Anything unexpected becomes
 * a 502 through {@link parseDohBody} returning `undefined`, never a thrown error inside
 * a route.
 */
interface DohBody {
  Status: number;
  TC?: boolean;
  AD?: boolean;
  CD?: boolean;
  Question?: { name?: string; type?: number }[];
  Answer?: { name?: string; type?: number; TTL?: number; data?: string }[];
  Authority?: { name?: string; type?: number; TTL?: number; data?: string }[];
  Comment?: string | string[];
}

function parseDohBody(text: string): DohBody | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const body = parsed as DohBody;
  if (typeof body.Status !== 'number') return undefined;
  return body;
}

function toRecords(
  section: { name?: string; type?: number; TTL?: number; data?: string }[] | undefined,
): LiveRecord[] {
  if (!Array.isArray(section)) return [];
  return section.map((entry) => {
    const typeValue = typeof entry.type === 'number' ? entry.type : 0;
    return {
      // A DoH answer name is fully qualified with a trailing dot; the UI shows names
      // the way they were typed, so it comes off here rather than in four components.
      name: (entry.name ?? '').replace(/\.$/, ''),
      type: RR_TYPE_NAMES[typeValue] ?? `TYPE${typeValue}`,
      typeValue,
      ttl: typeof entry.TTL === 'number' ? entry.TTL : 0,
      data: entry.data ?? '',
    };
  });
}

function sourceFor(endpoint: string): DiagnosticsSource {
  return {
    kind: 'doh',
    name: DOH_RESOLVER.name,
    endpoint,
    note: DOH_RESOLVER.note,
  };
}

/**
 * Build the `GET /api/diagnostics/dns` handler.
 *
 * A factory rather than a bare function so tests can inject a limiter with a tiny
 * bucket and a `fetch` that never opens a socket, while `route.ts` stays one line.
 */
export function createDnsHandler(deps: DiagnosticsDeps) {
  return async function GET(request: Request): Promise<Response> {
    // Rate limit first, unconditionally: every request that reaches this handler
    // spends a token, whether or not it turns out to be well-formed. It is the one
    // invariant that holds no matter which branch below is taken.
    const decision = deps.limiter.take(clientKeyOf(request));
    if (!decision.allowed) return respondRateLimited(decision);

    const url = new URL(request.url);

    const rawTarget = readSingleParam(url, 'target');
    if (!rawTarget.allowed) return respondDenied(rawTarget, decision);

    const rawType = readOptionalParam(url, 'type');
    if (!rawType.allowed) return respondDenied(rawType, decision);

    const type = (rawType.value ?? 'A').toUpperCase() as SupportedType;
    if (!SUPPORTED_TYPES.includes(type)) {
      return respondError(
        'invalid-target',
        `"${rawType.value}" is not a record type this lookup offers; choose one of ${SUPPORTED_TYPES.join(', ')}`,
        400,
        {},
        limitHeaders(decision),
      );
    }

    const parsed = parseLookupTarget(rawTarget.value);
    if (!parsed.allowed) return respondDenied(parsed, decision);
    if (parsed.value.kind === 'ip') {
      return respondError(
        'invalid-target',
        `a DNS lookup takes a hostname, and "${parsed.value.text}" is an address; use the RDAP lookup to ask who an address is registered to`,
        400,
        {},
        limitHeaders(decision),
      );
    }

    const name = parsed.value.name;
    const endpoint = dohUrlFor(name, type);

    const outcome = await guardedFetch(endpoint, deps, {
      method: 'GET',
      headers: { accept: 'application/dns-json' },
      allowedOrigins: [DOH_RESOLVER.origin],
      readBody: true,
      // A resolver that answers with a redirect is a resolver that is not answering.
      policy: { maxRedirects: 0, maxResponseBytes: 65_536 },
    });
    if (!isOutboundOk(outcome)) return respondOutboundFailure(outcome, decision);

    const { response, body, elapsedMs } = outcome.value;
    if (!response.ok) {
      return respondError(
        'upstream-failed',
        `${DOH_RESOLVER.name} answered ${response.status} ${response.statusText}`,
        502,
        {},
        limitHeaders(decision),
      );
    }

    const doh = parseDohBody(body ?? '');
    if (!doh) {
      return respondError(
        'upstream-failed',
        `${DOH_RESOLVER.name} returned a body that is not a DNS-over-HTTPS answer`,
        502,
        {},
        limitHeaders(decision),
      );
    }

    const payload: DnsLookupPayload = {
      target: name,
      type,
      question: {
        name: (doh.Question?.[0]?.name ?? name).replace(/\.$/, ''),
        type,
      },
      rcode: RCODE_NAMES[doh.Status] ?? `RCODE${doh.Status}`,
      rcodeValue: doh.Status,
      authenticatedData: doh.AD === true,
      checkingDisabled: doh.CD === true,
      truncated: doh.TC === true,
      answers: toRecords(doh.Answer),
      authority: toRecords(doh.Authority),
      ...(doh.Comment === undefined
        ? {}
        : {
            comment: Array.isArray(doh.Comment) ? doh.Comment.join(' ') : doh.Comment,
          }),
    };

    return respondOk(
      payload,
      {
        requestedAt: new Date().toISOString(),
        elapsedMs: Math.round(elapsedMs),
        source: sourceFor(endpoint),
      },
      decision,
    );
  };
}
