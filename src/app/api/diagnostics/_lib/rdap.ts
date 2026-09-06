/**
 * `rdap.ts` -- registration data for a domain or an address, via the official IANA
 * bootstrap.
 *
 * Not WHOIS. The phase doc is explicit about why: port 43 is a plain-text protocol with
 * no structure, frequently blocked outbound, and answered differently by every
 * registry. RDAP is its official successor -- HTTPS, JSON, and a published discovery
 * mechanism -- and that discovery mechanism is what this file implements:
 *
 *   1. fetch IANA's bootstrap registry for the right object type (`dns.json`,
 *      `ipv4.json`, `ipv6.json`), cached in memory for an hour
 *   2. find the service whose entry matches the target most specifically -- the longest
 *      matching domain suffix, or the smallest containing CIDR block
 *   3. request `<base>/domain/<name>` or `<base>/ip/<address>` from that registry
 *
 * Every one of those three is a `guardedFetch`, including the two that go to addresses
 * the user did not choose. A bootstrap file is data from the network like any other,
 * and the base URL it names is re-validated before anything is requested from it.
 *
 * Registry servers do redirect (a registrar-hosted RDAP service is a common answer), so
 * this is the one route that follows redirects at all -- at most two, each of which
 * goes through the whole guard pipeline again from scratch, resolution included.
 */

import { cidrContains, parseCidr, type IpAddress } from '@/core/net/address';
import {
  BOOTSTRAP_ORIGIN,
  BOOTSTRAP_URLS,
  rdapUrlFor,
  type LiveEntity,
  type LiveEvent,
  type LiveNameserver,
  type RdapPayload,
} from '@/core/net/diagnostics';
import { parseLookupTarget } from '@/core/net/guard';

import type { DiagnosticsDeps } from './deps';
import { clientKeyOf } from './deps';
import {
  guardedFetch,
  isOutboundOk,
  respondOutboundFailure,
  type OutboundFailure,
} from './outbound';
import { readSingleParam } from './request';
import {
  respondDenied,
  limitHeaders,
  respondError,
  respondOk,
  respondRateLimited,
  type DiagnosticsSource,
} from './respond';

/**
 * The bootstrap URLs, the RDAP URL builder, and the normalised record shape live in
 * `@/core/net/diagnostics` so `LiveDisclosure` and this handler compute the same URL.
 * Re-exported under the names this file has always used.
 */
export {
  BOOTSTRAP_ORIGIN,
  BOOTSTRAP_URLS,
  rdapUrlFor,
  type LiveEntity,
  type LiveEvent,
  type LiveNameserver,
  type RdapPayload,
} from '@/core/net/diagnostics';

/** How long a bootstrap file is reused. It changes on the order of weeks. */
export const BOOTSTRAP_TTL_MS = 60 * 60 * 1000;

/** At most two, each fully re-validated. See the file comment. */
const MAX_RDAP_REDIRECTS = 2;

type BootstrapKind = keyof typeof BOOTSTRAP_URLS;

/** One `[entries, base URLs]` pair from a bootstrap file's `services` array. */
interface BootstrapService {
  readonly entries: readonly string[];
  readonly bases: readonly string[];
}

interface Bootstrap {
  readonly services: readonly BootstrapService[];
  readonly publication?: string;
}

// ---------------------------------------------------------------------------
// Bootstrap parsing and matching
// ---------------------------------------------------------------------------

function parseBootstrap(text: string): Bootstrap | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const raw = parsed as { services?: unknown; publication?: unknown };
  if (!Array.isArray(raw.services)) return undefined;

  const services: BootstrapService[] = [];
  for (const service of raw.services) {
    if (!Array.isArray(service) || service.length < 2) continue;
    const [entries, bases] = service as [unknown, unknown];
    if (!Array.isArray(entries) || !Array.isArray(bases)) continue;
    services.push({
      entries: entries.filter((entry): entry is string => typeof entry === 'string'),
      bases: bases.filter((base): base is string => typeof base === 'string'),
    });
  }
  return {
    services,
    ...(typeof raw.publication === 'string' ? { publication: raw.publication } : {}),
  };
}

/**
 * The service whose domain entry is the longest suffix of `name`.
 *
 * Longest, not first: the bootstrap file may carry both `uk` and a more specific
 * multi-label entry, and the more specific one is the registry that actually holds the
 * record. Matching is on label boundaries, so `notexample.com` never matches an entry
 * for `example.com`.
 */
function matchDomain(bootstrap: Bootstrap, name: string): string | undefined {
  const labels = name.split('.');
  let best: { base: string; length: number } | undefined;

  for (const service of bootstrap.services) {
    for (const entry of service.entries) {
      const entryLabels = entry.toLowerCase().split('.');
      if (entryLabels.length > labels.length) continue;
      const tail = labels.slice(labels.length - entryLabels.length).join('.');
      if (tail !== entryLabels.join('.')) continue;
      const base = service.bases.find((candidate) => candidate.startsWith('https://'));
      if (!base) continue;
      if (!best || entryLabels.length > best.length) {
        best = { base, length: entryLabels.length };
      }
    }
  }
  return best?.base;
}

/**
 * The service whose CIDR entry is the smallest block containing `address`.
 *
 * The IPv4 bootstrap writes entries as `1.0.0.0/8`; the IPv6 one as `2001:200::/23`.
 * `parseCidr` is the strict parser, so an entry it cannot read is skipped rather than
 * guessed at.
 */
function matchAddress(bootstrap: Bootstrap, address: IpAddress): string | undefined {
  let best: { base: string; prefix: number } | undefined;

  for (const service of bootstrap.services) {
    for (const entry of service.entries) {
      const block = parseCidr(entry);
      if (!block.ok) continue;
      if (block.value.address.version !== address.version) continue;
      if (!cidrContains(block.value, address)) continue;
      const base = service.bases.find((candidate) => candidate.startsWith('https://'));
      if (!base) continue;
      if (!best || block.value.prefixLength > best.prefix) {
        best = { base, prefix: block.value.prefixLength };
      }
    }
  }
  return best?.base;
}

// ---------------------------------------------------------------------------
// RDAP object normalisation
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Pull one property out of a jCard.
 *
 * A jCard is `["vcard", [["fn", {}, "text", "Example Inc"], ...]]` -- an array of
 * four-element arrays, which is a genuinely awkward shape to read and the reason this
 * lives in one small function rather than inline three times.
 */
function vcardValue(vcardArray: unknown, property: string): string | undefined {
  const entries = asArray(asArray(vcardArray)[1]);
  for (const entry of entries) {
    const parts = asArray(entry);
    if (parts[0] !== property) continue;
    const value = parts[3];
    if (typeof value === 'string' && value !== '') return value;
    // An `adr` or a structured `n` arrives as a nested array; those are not shown.
  }
  return undefined;
}

function toEntity(raw: unknown): LiveEntity | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const entity = raw as Json;
  const roles = asArray(entity.roles).filter(
    (role): role is string => typeof role === 'string',
  );
  const name = vcardValue(entity.vcardArray, 'fn');
  const organization = vcardValue(entity.vcardArray, 'org');
  const email = vcardValue(entity.vcardArray, 'email');
  return {
    roles,
    ...(asString(entity.handle) === undefined ? {} : { handle: entity.handle as string }),
    ...(name === undefined ? {} : { name }),
    ...(organization === undefined ? {} : { organization }),
    ...(email === undefined ? {} : { email }),
    // Registrant, admin, and tech contacts are almost always withheld now. Saying so
    // is more useful than showing an empty row.
    redacted: name === undefined && organization === undefined && email === undefined,
  };
}

function ianaIdOf(entity: unknown): number | undefined {
  if (typeof entity !== 'object' || entity === null) return undefined;
  for (const id of asArray((entity as Json).publicIds)) {
    if (typeof id !== 'object' || id === null) continue;
    const record = id as Json;
    if (record.type !== 'IANA Registrar ID') continue;
    const value = Number(record.identifier);
    if (Number.isInteger(value)) return value;
  }
  return undefined;
}

/** Turn an RDAP object into the flat shape above. Every field is optional upstream. */
function normalise(
  raw: unknown,
): Omit<RdapPayload, 'target' | 'kind' | 'found' | 'registry' | 'redirects'> {
  const object = (typeof raw === 'object' && raw !== null ? raw : {}) as Json;

  const entities = asArray(object.entities)
    .map(toEntity)
    .filter((entity): entity is LiveEntity => entity !== undefined);

  const registrarEntity = asArray(object.entities).find((entity) => {
    if (typeof entity !== 'object' || entity === null) return false;
    return asArray((entity as Json).roles).includes('registrar');
  });
  const registrarName =
    vcardValue((registrarEntity as Json | undefined)?.vcardArray, 'fn') ??
    vcardValue((registrarEntity as Json | undefined)?.vcardArray, 'org');
  const ianaId = ianaIdOf(registrarEntity);

  const nameservers: LiveNameserver[] = asArray(object.nameservers)
    .map((entry): LiveNameserver | undefined => {
      if (typeof entry !== 'object' || entry === null) return undefined;
      const server = entry as Json;
      const host = asString(server.ldhName);
      if (!host) return undefined;
      const ips = (server.ipAddresses ?? {}) as Json;
      return {
        host: host.toLowerCase(),
        addresses: [...asArray(ips.v4), ...asArray(ips.v6)].filter(
          (address): address is string => typeof address === 'string',
        ),
      };
    })
    .filter((server): server is LiveNameserver => server !== undefined);

  const events: LiveEvent[] = asArray(object.events)
    .map((entry): LiveEvent | undefined => {
      if (typeof entry !== 'object' || entry === null) return undefined;
      const event = entry as Json;
      const action = asString(event.eventAction);
      const date = asString(event.eventDate);
      return action && date ? { action, date } : undefined;
    })
    .filter((event): event is LiveEvent => event !== undefined);

  const secureDNS = (object.secureDNS ?? {}) as Json;
  const network =
    asString(object.startAddress) || asString(object.endAddress)
      ? {
          ...(asString(object.startAddress) === undefined
            ? {}
            : { startAddress: object.startAddress as string }),
          ...(asString(object.endAddress) === undefined
            ? {}
            : { endAddress: object.endAddress as string }),
          ...(asString(object.name) === undefined ? {} : { name: object.name as string }),
          ...(asString(object.type) === undefined ? {} : { type: object.type as string }),
          ...(asString(object.country) === undefined
            ? {}
            : { country: object.country as string }),
        }
      : undefined;

  return {
    ...(asString(object.handle) === undefined ? {} : { handle: object.handle as string }),
    ...(asString(object.ldhName) === undefined
      ? {}
      : { ldhName: (object.ldhName as string).toLowerCase() }),
    ...(asString(object.unicodeName) === undefined
      ? {}
      : { unicodeName: object.unicodeName as string }),
    statuses: asArray(object.status).filter(
      (status): status is string => typeof status === 'string',
    ),
    events,
    nameservers,
    entities,
    ...(registrarName === undefined
      ? {}
      : {
          registrar: {
            name: registrarName,
            ...(ianaId === undefined ? {} : { ianaId }),
          },
        }),
    ...(typeof secureDNS.delegationSigned === 'boolean'
      ? { delegationSigned: secureDNS.delegationSigned }
      : {}),
    ...(network === undefined ? {} : { network }),
  };
}

// ---------------------------------------------------------------------------
// The handler
// ---------------------------------------------------------------------------

function sourceFor(base: string, endpoint: string): DiagnosticsSource {
  return {
    kind: 'rdap',
    name: `RDAP registry at ${new URL(base).hostname}`,
    endpoint,
    note: 'RDAP is the structured, HTTPS successor to WHOIS. The registry answering was chosen by IANA’s bootstrap registry, not by this app, and contact details are redacted by the registry rather than by us.',
  };
}

/**
 * Build the `GET /api/diagnostics/rdap` handler.
 *
 * The bootstrap cache lives in this closure rather than at module scope, so each
 * handler -- and therefore each test -- gets its own and nothing leaks between them.
 */
export function createRdapHandler(deps: DiagnosticsDeps) {
  const cache = new Map<BootstrapKind, { at: number; value: Bootstrap }>();

  async function loadBootstrap(
    kind: BootstrapKind,
  ): Promise<{ ok: true; value: Bootstrap } | { ok: false; failure: OutboundFailure }> {
    const cached = cache.get(kind);
    if (cached && Date.now() - cached.at < BOOTSTRAP_TTL_MS) {
      return { ok: true, value: cached.value };
    }

    const outcome = await guardedFetch(BOOTSTRAP_URLS[kind], deps, {
      method: 'GET',
      headers: { accept: 'application/json' },
      allowedOrigins: [BOOTSTRAP_ORIGIN],
      readBody: true,
      // The bootstrap files are a few hundred kilobytes; ipv4.json is the largest.
      policy: { maxRedirects: 0, maxResponseBytes: 1_048_576 },
    });
    if (!isOutboundOk(outcome)) return { ok: false, failure: outcome };

    if (!outcome.value.response.ok) {
      return {
        ok: false,
        failure: {
          kind: 'unreachable',
          message: `the IANA bootstrap registry answered ${outcome.value.response.status}`,
        },
      };
    }

    const parsed = parseBootstrap(outcome.value.body ?? '');
    if (!parsed) {
      return {
        ok: false,
        failure: {
          kind: 'unreachable',
          message: 'the IANA bootstrap registry returned a file this app cannot read',
        },
      };
    }

    cache.set(kind, { at: Date.now(), value: parsed });
    return { ok: true, value: parsed };
  }

  return async function GET(request: Request): Promise<Response> {
    const decision = deps.limiter.take(clientKeyOf(request));
    if (!decision.allowed) return respondRateLimited(decision);

    const url = new URL(request.url);

    const rawTarget = readSingleParam(url, 'target');
    if (!rawTarget.allowed) return respondDenied(rawTarget, decision);

    const parsed = parseLookupTarget(rawTarget.value);
    if (!parsed.allowed) return respondDenied(parsed, decision);

    const started = deps.now();
    const host = parsed.value;
    const kind: BootstrapKind =
      host.kind === 'hostname' ? 'domain' : host.address.version === 4 ? 'ipv4' : 'ipv6';

    const bootstrap = await loadBootstrap(kind);
    if (!bootstrap.ok) return respondOutboundFailure(bootstrap.failure, decision);

    const targetText = host.kind === 'hostname' ? host.name : host.text;
    const base =
      host.kind === 'hostname'
        ? matchDomain(bootstrap.value, host.name)
        : matchAddress(bootstrap.value, host.address);

    if (!base) {
      return respondError(
        'not-found',
        host.kind === 'hostname'
          ? `no registry publishes RDAP for ".${host.name.split('.').pop()}", so there is nothing to look up`
          : `no registry publishes RDAP for ${targetText}`,
        404,
        {},
        limitHeaders(decision),
      );
    }

    const endpoint = rdapUrlFor(
      base,
      host.kind === 'hostname' ? 'domain' : 'ip',
      targetText,
    );

    const outcome = await guardedFetch(endpoint, deps, {
      method: 'GET',
      headers: { accept: 'application/rdap+json' },
      readBody: true,
      // The one route that follows a redirect -- and only after re-running the whole
      // guard pipeline, resolution included, on the URL it was redirected to.
      policy: { maxRedirects: MAX_RDAP_REDIRECTS, maxResponseBytes: 262_144 },
    });
    if (!isOutboundOk(outcome)) return respondOutboundFailure(outcome, decision);

    const { response, body, redirects } = outcome.value;
    const registry = {
      base,
      bootstrap: BOOTSTRAP_URLS[kind],
      ...(bootstrap.value.publication === undefined
        ? {}
        : { publication: bootstrap.value.publication }),
    };

    // A 404 from a registry is an answer, not a failure: the name is not registered.
    if (response.status === 404) {
      const payload: RdapPayload = {
        target: targetText,
        kind: host.kind === 'hostname' ? 'domain' : 'ip',
        found: false,
        registry,
        statuses: [],
        events: [],
        nameservers: [],
        entities: [],
        redirects,
      };
      return respondOk(
        payload,
        {
          requestedAt: new Date().toISOString(),
          elapsedMs: Math.round(deps.now() - started),
          source: sourceFor(base, endpoint),
        },
        decision,
      );
    }

    if (!response.ok) {
      return respondError(
        'upstream-failed',
        `the registry at ${new URL(base).hostname} answered ${response.status} ${response.statusText}`,
        502,
        {},
        limitHeaders(decision),
      );
    }

    let record: unknown;
    try {
      record = JSON.parse(body ?? '');
    } catch {
      return respondError(
        'upstream-failed',
        `the registry at ${new URL(base).hostname} returned a body that is not RDAP JSON`,
        502,
        {},
        limitHeaders(decision),
      );
    }

    const payload: RdapPayload = {
      target: targetText,
      kind: host.kind === 'hostname' ? 'domain' : 'ip',
      found: true,
      registry,
      ...normalise(record),
      redirects,
    };

    return respondOk(
      payload,
      {
        requestedAt: new Date().toISOString(),
        elapsedMs: Math.round(deps.now() - started),
        source: sourceFor(base, endpoint),
      },
      decision,
    );
  };
}
