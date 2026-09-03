/**
 * What the learner typed, turned into something that can be resolved.
 *
 * This file is the module's safety boundary, and it is small on purpose so that the
 * boundary is easy to check. The rule from CLAUDE.md is that a user must never be unsure
 * whether an action touches a real network, and the way this module honours it is not by
 * being careful with a network call -- it is by having no network call to be careful
 * with. There is no `fetch`, no `Request`, and no address here that resolves off this
 * machine. A name that survives {@link parseLookup} is handed to `resolve()`, which reads
 * the zone fixtures in `sim/records.ts` and nothing else, in this browser tab.
 *
 * That is why the interesting case is a name the fixtures have never heard of, which is
 * most names. `google.com` does not silently become a real lookup, and does not become an
 * error either: the simulated `.com` servers are asked, they have no delegation for it,
 * and NXDOMAIN comes back -- a true statement about this simulated Internet and a false
 * one about the real one. {@link coverageFor} exists so the UI can say exactly that
 * beside the answer, rather than letting a learner read a fixture as a fact.
 *
 * ## What is validated, and why with zod
 *
 * The name itself is checked by `parseDomainName` (RFC 1123 label rules), which the
 * `sim/` layer already needed. zod is here for the rest of the form -- record type, cache
 * state, transport, the DO bit -- because those arrive from `<select>` elements as
 * strings, and the run is only deterministic if what reaches `runDnsScenario` is one of
 * the values it knows. One `safeParse` at the edge, and everything downstream is typed.
 */

import { z } from 'zod';

import { parseIpv4 } from '@/core/net/address';
import { fail, ok, type ParseResult } from '@/core/net/result';

import type { DnsLookup, DnsScenario } from './scenarios';
import type { DnsTransport } from './sim/resolver';

import {
  ancestorsOf,
  displayName,
  findZone,
  normalizeName,
  parseDomainName,
  QUERYABLE_TYPES,
  RR_TYPE_NOTES,
  SIMULATED_INTERNET,
  type DnsZone,
  type RrType,
  type SimulatedInternet,
} from './sim/records';

/** The scenario id a lookup typed into the input runs under. */
export const CUSTOM_LOOKUP_ID = 'custom-lookup';

/** Whether the resolver starts empty, or has already been asked this once. */
export type CacheState = 'cold' | 'warm';

/** How each transport is named in the UI, including the two encrypted ones. */
export const TRANSPORT_LABELS: Readonly<Record<DnsTransport, string>> = {
  udp: 'UDP/53',
  tcp: 'TCP/53',
  doh: 'DoH (HTTPS)',
  dot: 'DoT (TLS)',
};

/** One line on what each transport changes, for the control's hint text. */
export const TRANSPORT_NOTES: Readonly<Record<DnsTransport, string>> = {
  udp: 'The default. One datagram out, one back, and 512 bytes unless EDNS(0) raises it.',
  tcp: 'A connection first, and a two-byte length prefix -- so size stops being a limit.',
  doh: 'The same messages inside HTTPS (RFC 8484). The phase-12 live tool uses this.',
  dot: 'The same messages inside TLS on port 853 (RFC 7858), with no HTTP in between.',
};

/** The raw form state: whatever is in the field right now, valid or not. */
export interface LookupDraft {
  readonly name: string;
  readonly type: RrType;
  readonly cache: CacheState;
  readonly transport: DnsTransport;
  /** The DO bit -- ask for signatures, and validate the chain of trust. */
  readonly dnssec: boolean;
}

/**
 * Pull a hostname out of whatever was pasted into the field.
 *
 * People arrive here with a URL from the address bar or an address from a mail client,
 * and both contain exactly the name they meant. Rejecting them would be correct and
 * useless, so the wrapping is stripped and the name inside is what gets looked up.
 * Everything this does is textual; nothing is contacted to find out whether the result
 * exists.
 */
export function hostnameFromInput(raw: string): string {
  let value = raw.trim();
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  // `user@example.com` -- an email address, or a URL carrying userinfo.
  value = value.replace(/^[^/@]*@/, '');
  const path = value.search(/[/?#]/);
  if (path !== -1) value = value.slice(0, path);
  value = value.replace(/^\[(.+)]$/, '$1');
  value = value.replace(/:\d+$/, '');
  return normalizeName(value);
}

/** First letter up, so a parser fragment reads as a sentence under a form field. */
function sentence(fragment: string): string {
  const trimmed = fragment.trim();
  const text = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(text) ? text : text + '.';
}

/**
 * The record types offered, checked against the one list that defines them.
 *
 * `z.custom` rather than `z.enum` so `QUERYABLE_TYPES` stays the single source of truth:
 * adding a type in `sim/records.ts` should not also require editing a tuple here.
 */
const rrTypeSchema = z.custom<RrType>(
  (value) =>
    typeof value === 'string' && (QUERYABLE_TYPES as readonly string[]).includes(value),
  { message: 'Pick one of the record types this module can serve.' },
);

const transportSchema = z.custom<DnsTransport>(
  (value) => typeof value === 'string' && value in TRANSPORT_LABELS,
  { message: 'Pick one of the transports this module can carry a query over.' },
);

/** A lookup this module is willing to run. `name` is already normalised. */
export const lookupSchema = z.object({
  name: z.string().superRefine((value, ctx) => {
    if (value.length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Type a domain name, or pick one of the examples below.',
      });
      return;
    }
    const parsed = parseDomainName(value);
    if (!parsed.ok) ctx.addIssue({ code: 'custom', message: sentence(parsed.error) });
  }),
  type: rrTypeSchema,
  cache: z.enum(['cold', 'warm']),
  transport: transportSchema,
  dnssec: z.boolean(),
});

/** A validated lookup. Structurally a {@link LookupDraft} whose name is known good. */
export type Lookup = z.infer<typeof lookupSchema>;

/** What the field opens on: the walk the phase doc uses as its worked example. */
export const DEFAULT_DRAFT: LookupDraft = {
  name: 'www.example.com',
  type: 'A',
  cache: 'cold',
  transport: 'udp',
  dnssec: false,
};

/**
 * Validate a draft, normalising the name on the way through.
 *
 * Returns the same `ParseResult` shape every validator in `@/core/net` returns, so a
 * failure carries the reason and the field can print it.
 */
export function parseLookup(draft: LookupDraft): ParseResult<Lookup> {
  const result = lookupSchema.safeParse({
    ...draft,
    name: hostnameFromInput(draft.name),
  });
  if (result.success) return ok(result.data);
  return fail(
    result.error.issues[0]?.message ?? 'That is not a name this module can look up.',
  );
}

/**
 * `203.0.113.20` becomes `20.113.0.203.in-addr.arpa`.
 *
 * Typing an address into a box marked "domain name" is a reasonable mistake, and the
 * reversed form is both the correct answer and the lesson: names delegate right to left,
 * so an address has to be written backwards before the tree can be walked down it.
 * `undefined` when the input is not an IPv4 address, which is the usual case.
 */
export function reversePtrName(input: string): string | undefined {
  const parsed = parseIpv4(input.trim());
  if (!parsed.ok) return undefined;
  return [...parsed.value.octets].reverse().join('.') + '.in-addr.arpa';
}

/**
 * The deepest bundled zone that encloses `name`.
 *
 * Never `undefined` in practice -- the root zone encloses everything -- but typed as
 * optional, because that guarantee belongs to the fixtures rather than to the type.
 */
export function simulatedZoneFor(
  name: string,
  internet: SimulatedInternet = SIMULATED_INTERNET,
): DnsZone | undefined {
  const target = normalizeName(name);
  for (const candidate of [target, ...ancestorsOf(target)]) {
    const found = findZone(internet, candidate);
    if (found) return found;
  }
  return undefined;
}

/** Whether the fixtures can actually answer for a name, and how to say so. */
export interface LookupCoverage {
  /** True when a bundled zone is authoritative for this name. */
  readonly known: boolean;
  /** The deepest bundled zone enclosing the name -- the root, at worst. */
  readonly zone?: DnsZone;
  /** One paragraph for the UI, naming what will happen and why. */
  readonly note: string;
}

/**
 * What the bundled zones can say about a name.
 *
 * The unknown case is the one that matters. It is not an error and it is not a fallback:
 * the simulated hierarchy answers, honestly, that it has never heard of the name. Saying
 * so plainly is the difference between a teaching tool and a tool that quietly teaches
 * something false.
 */
export function coverageFor(
  name: string,
  internet: SimulatedInternet = SIMULATED_INTERNET,
): LookupCoverage {
  const target = normalizeName(name);
  const zone = simulatedZoneFor(target, internet);
  const shown = displayName(target);

  if (zone && zone.tier === 'authoritative') {
    return {
      known: true,
      zone,
      note:
        shown +
        ' is inside the bundled ' +
        displayName(zone.origin) +
        ' zone, so the walk below ends at a server that really holds this name.',
    };
  }

  const where =
    !zone || zone.tier === 'root'
      ? 'the simulated root has no delegation for its top-level domain'
      : 'the simulated ' +
        displayName(zone.origin) +
        ' servers have no delegation for it';

  return {
    known: false,
    ...(zone ? { zone } : {}),
    note:
      shown +
      ' is not one of the bundled simulated zones, so ' +
      where +
      ' and the answer here is NXDOMAIN. That is a fact about this simulation and not about the real Internet: nothing was asked of a real nameserver, and this module has no code path that could reach one.',
  };
}

/** What the second half of a warm run is worth saying about itself. */
const WARM_INTENT =
  'The same question again, of a resolver that now remembers the answer. Nothing goes past it.';

/**
 * Turn a validated lookup into a scenario `runDnsScenario` can run.
 *
 * Warm means the question is asked twice rather than that the cache is pre-seeded: a
 * cache holding entries nobody watched arrive is a claim, and two lookups sharing one
 * cache is the same claim demonstrated. The six authored scenarios pin teaching notes to
 * phase ids; this one cannot, because which phases a typed-in name produces is not
 * knowable until it has been resolved. The ladder and the record tables carry the
 * explanation instead.
 */
export function lookupScenario(lookup: Lookup): DnsScenario {
  const shown = displayName(lookup.name);
  const warm = lookup.cache === 'warm';

  const ask: DnsLookup = {
    name: lookup.name,
    type: lookup.type,
    intent: warm
      ? 'A first ask, to put something in the cache. Watch how far it has to go.'
      : 'Nothing is cached, so this costs the full walk from the root.',
  };

  return {
    id: CUSTOM_LOOKUP_ID,
    title: shown + ' ' + lookup.type,
    summary:
      lookup.type +
      ' records for ' +
      shown +
      ', resolved against the bundled zones ' +
      (warm
        ? 'twice: once the hard way, then once from the cache the first ask filled.'
        : 'by a resolver that starts knowing only the root hints.'),
    teaches: [
      RR_TYPE_NOTES[lookup.type],
      warm
        ? 'What the second identical question costs, and where it stops'
        : 'How far a resolver walks when it remembers nothing',
      ...(lookup.dnssec ? ['Whether the answer can be proved, link by link'] : []),
      ...(lookup.transport === 'udp'
        ? []
        : ['This query carried over ' + TRANSPORT_LABELS[lookup.transport]]),
    ],
    // Every knob is in the seed: two runs that look the same must be the same run.
    seed: [
      'dns:custom',
      lookup.name,
      lookup.type,
      lookup.cache,
      lookup.transport,
      String(lookup.dnssec),
    ].join(':'),
    lookups: warm ? [ask, { ...ask, intent: WARM_INTENT }] : [ask],
    dnssec: lookup.dnssec,
    transport: lookup.transport,
  };
}
