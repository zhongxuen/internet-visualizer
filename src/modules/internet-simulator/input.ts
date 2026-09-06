/**
 * What the learner typed, and where it can be taken next.
 *
 * Two jobs, both pure, both deliberately kept out of the components that use them.
 *
 * ## 1. The address bar's safety boundary
 *
 * The rule from CLAUDE.md is that a user must never be unsure whether an action touches a
 * real network. This module honours it the same way the DNS Explorer does: not by being
 * careful with a network call, but by having none to be careful with. A URL that survives
 * {@link parseAddress} is handed to `runPageLoad`, which walks the bundled zone fixtures in
 * `@/core/protocols/dns/records` and the scenario's own declarations, in this browser tab.
 * There is no `fetch` in this module and no host it could be pointed at.
 *
 * That makes the interesting case a name the fixtures have never heard of, which is most
 * names. Typing a real site does not quietly become a real request, and does not become an
 * error either: the simulated `.com` servers are asked, they have no delegation for it, and
 * the run ends in `DNS_PROBE_FINISHED_NXDOMAIN` -- a true statement about this simulated
 * Internet and a false one about the real one. {@link coverageFor} exists so the address bar
 * can say exactly that *before* the run, rather than letting a learner read an NXDOMAIN
 * about a site they know is up as a fact about that site.
 *
 * The parse itself is `parseUrl` from the `url-parse` stage, unchanged: validating the
 * address bar against a different parser than the one stage 1 puts on screen would let the
 * two disagree, and stage 1 is the thing being taught. zod wraps it rather than replaces it,
 * for the same reason the DNS Explorer wraps `parseDomainName` -- one `safeParse` at the
 * edge, and everything downstream is typed.
 *
 * ## 2. The handoff into the dedicated modules
 *
 * The phase doc calls this "what turns a demo into a learning path": from any stage, a link
 * into the module that takes that one protocol apart, carrying what is currently in the
 * address bar so the learner arrives at the same host rather than at a default. The query
 * parameters are built here, in one table, so the vocabulary is stated once.
 */

import { z } from 'zod';

import { fail, ok, type ParseResult } from '@/core/net/result';
import {
  ancestorsOf,
  displayName,
  findZone,
  normalizeName,
  SIMULATED_INTERNET,
  type DnsZone,
  type SimulatedInternet,
} from '@/core/protocols/dns/records';

import { STAGE_MODULE_ROUTES, type StageId } from './sim/stage';
import { parseUrl, type ParsedUrl } from './sim/stages/url-parse';

// ---------------------------------------------------------------------------
// The address bar
// ---------------------------------------------------------------------------

/**
 * A URL this module is willing to load.
 *
 * `z.string()` refined by {@link parseUrl} rather than zod's own URL check: the built-in
 * accepts `ftp://`, `mailto:`, and a dozen other schemes this simulator has no stages for,
 * and it rejects the bare `example.com` that every browser accepts. The stage-1 parser is
 * the one whose behaviour is on screen, so it is the one that decides.
 */
export const addressSchema = z.object({
  url: z.string().superRefine((value, ctx) => {
    const parsed = parseUrl(value);
    if (!parsed.ok) ctx.addIssue({ code: 'custom', message: parsed.error });
  }),
});

/** A validated address, as zod sees it. {@link parseAddress} returns the parse instead. */
export type Address = z.infer<typeof addressSchema>;

/**
 * Validate what is in the address bar, returning the URL already taken apart.
 *
 * The same `ParseResult` shape every validator in `@/core/net` returns, so a rejection
 * carries the reason and the field can print it underneath itself.
 */
export function parseAddress(raw: string): ParseResult<ParsedUrl> {
  const result = addressSchema.safeParse({ url: raw });
  if (!result.success) {
    return fail(
      result.error.issues[0]?.message ?? 'That is not a URL this simulator can load.',
    );
  }
  // Reached only when the refinement above passed, so this repeats a parse that succeeded.
  const parsed = parseUrl(result.data.url);
  return parsed.ok ? ok(parsed.value) : fail(parsed.error);
}

// ---------------------------------------------------------------------------
// What the bundled Internet can actually answer
// ---------------------------------------------------------------------------

/** Whether the fixtures know a host, and the sentence to print beside the address bar. */
export interface HostCoverage {
  /** True when a bundled zone is authoritative for this host. */
  readonly known: boolean;
  /** The deepest bundled zone enclosing the host -- the root, at worst. */
  readonly zone?: DnsZone;
  /** One paragraph naming what will happen and why. */
  readonly note: string;
}

/** The deepest bundled zone that encloses `host`. */
function zoneFor(host: string, internet: SimulatedInternet): DnsZone | undefined {
  const target = normalizeName(host);
  for (const candidate of [target, ...ancestorsOf(target)]) {
    const found = findZone(internet, candidate);
    if (found) return found;
  }
  return undefined;
}

/**
 * What this simulated Internet can say about a host, before anything is run.
 *
 * The unknown case is the one that matters, and it is neither an error nor a fallback: the
 * simulated hierarchy answers, honestly, that it has never heard of the name. Saying so
 * *before* the run is the difference between a teaching tool and a tool that quietly
 * teaches something false about a site the learner knows is online.
 */
export function coverageFor(
  host: string,
  internet: SimulatedInternet = SIMULATED_INTERNET,
): HostCoverage {
  const target = normalizeName(host);
  const zone = zoneFor(target, internet);
  const shown = displayName(target);

  if (zone && zone.tier === 'authoritative') {
    return {
      known: true,
      zone,
      note: `${shown} is inside the bundled ${displayName(zone.origin)} zone, so this load reaches a simulated server that really holds the name.`,
    };
  }

  const where =
    !zone || zone.tier === 'root'
      ? 'the simulated root has no delegation for its top-level domain'
      : `the simulated ${displayName(zone.origin)} servers have no delegation for it`;

  return {
    known: false,
    ...(zone ? { zone } : {}),
    note: `${shown} is not one of the bundled zones, so ${where} and this load ends in DNS_PROBE_FINISHED_NXDOMAIN. That is a fact about this simulation and not about the real Internet: nothing was asked of a real nameserver, and this module has no code path that could reach one.`,
  };
}

/** Hosts the bundled zones have something to say about, offered as chips under the field. */
export const SUGGESTED_URLS: readonly { readonly url: string; readonly note: string }[] =
  [
    {
      url: 'https://www.example.com/',
      note: 'A CNAME to the apex: one extra hop when cold',
    },
    {
      url: 'https://shop.example.com/',
      note: 'CNAMEd out to a CDN, with 30-second TTLs',
    },
    { url: 'https://blog.example.com/', note: 'An alias for an alias for the apex' },
    {
      url: 'http://www.example.com/',
      note: 'Cleartext, and what the browser does about it',
    },
    {
      url: 'https://nope.example.com/',
      note: 'NXDOMAIN, and the error page it produces',
    },
  ];

// ---------------------------------------------------------------------------
// The handoff
// ---------------------------------------------------------------------------

/** A link out of one stage into the module that takes that protocol apart. */
export interface StageHandoff {
  /** The target module's route, with the current input in the query string. */
  readonly href: string;
  /** The link's label, e.g. `Open in DNS Explorer`. */
  readonly label: string;
  /** What the learner will find there, and why it is worth the trip. */
  readonly note: string;
}

/** Copy for each handoff. Keyed by stage, so an unlinked stage simply has no entry. */
const HANDOFFS: Readonly<
  Partial<Record<StageId, { readonly label: string; readonly note: string }>>
> = {
  'cache-check': {
    label: 'Open in HTTP Explorer',
    note: 'Freshness, validators, and the difference between a 200 and a 304, at full size.',
  },
  dns: {
    label: 'Open in DNS Explorer',
    note: 'The same name resolved one server at a time: root, TLD, then the zone itself.',
  },
  tcp: {
    label: 'Open in Packet Journey',
    note: 'The handshake as segments, with sequence numbers, flags, and the hops between.',
  },
  tls: {
    label: 'Open in HTTPS Explorer',
    note: 'Every handshake message, the key schedule, and the chain of trust being checked.',
  },
  http: {
    label: 'Open in HTTP Explorer',
    note: 'The request and the response header by header, on the wire, across versions.',
  },
  cdn: {
    label: 'Open in HTTP Explorer',
    note: 'Shared-cache rules: Age, s-maxage, and why an edge may answer when a browser may not.',
  },
};

/**
 * The query parameters a stage hands its module.
 *
 * Deliberately the vocabulary each target already uses for the thing it takes apart -- a
 * name for the resolver, a URL for the fetchers -- rather than one opaque blob. `from`
 * marks where the learner came from, so a target can offer the trip back.
 *
 * These are *links*, not imports: `eslint.config.mjs` forbids one module importing another,
 * and rightly, so a target adopts a parameter by reading its own search params. Until it
 * does, the link still lands on the right module and loses only the pre-fill.
 */
function paramsFor(stage: StageId, url: ParsedUrl): URLSearchParams {
  const params = new URLSearchParams();

  switch (stage) {
    case 'dns':
      params.set('name', url.host);
      params.set('type', 'A');
      break;
    case 'tcp':
      params.set('host', url.host);
      params.set('port', String(url.port));
      break;
    case 'tls':
      params.set('host', url.host);
      break;
    default:
      params.set('url', url.href);
      params.set('host', url.host);
      params.set('target', url.target);
      break;
  }

  params.set('from', 'internet-simulator');
  return params;
}

/**
 * Where a stage sends the learner next, carrying the URL currently in the address bar.
 *
 * `undefined` for the two stages with no module of their own: parsing a URL and painting a
 * page are browser behaviour rather than protocols, and there is nowhere honest to send
 * someone for them.
 */
export function handoffFor(stage: StageId, url: ParsedUrl): StageHandoff | undefined {
  const route = STAGE_MODULE_ROUTES[stage];
  const copy = HANDOFFS[stage];
  if (!route || !copy) return undefined;

  return {
    href: `${route}?${paramsFor(stage, url).toString()}`,
    label: copy.label,
    note: copy.note,
  };
}
