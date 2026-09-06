/**
 * Simulated `dig` / `nslookup`: the DNS Explorer's walk, cut down to what a tool prints.
 *
 * The resolution itself is not re-implemented here. `@/core/protocols/dns` already owns
 * the recursive walk, the zones, the cache and the TTL arithmetic, and this file calls
 * {@link resolve} exactly as the DNS Explorer does. What it adds is the *tool's* view of
 * the same event: a compact ladder, a `dig`-shaped transcript, an explanation of each
 * record type that came back, and the second run that proves the first one filled a cache.
 *
 * ## Why the warm run is here
 *
 * A lookup tool is the one place a learner can watch caching happen without being told
 * about it. The cold run walks root, TLD, and authoritative and reports a query count in
 * the handful; the warm run answers from memory with a query count of zero and a
 * remaining TTL lower than the record's own. Running both and showing them side by side
 * is a two-line change here and the difference between "DNS is cached" as a claim and as
 * an observation.
 *
 * ## What a diagnostic lookup is not
 *
 * It is not what your application will get. This resolver walks the hierarchy itself;
 * your machine asks whatever resolver DHCP handed it, which may answer from its own cache,
 * may be a different resolver in a different location, and may return a different address
 * on purpose. {@link LOOKUP_CAVEATS} says so on screen, because "but dig says..." is one
 * of the more expensive wrong turns in ordinary debugging.
 *
 * Simulated end to end. The only source of answers is the fixture set in
 * `@/core/protocols/dns/records.ts`; there is no resolver, no `fetch`, and no DoH here.
 */

import { cacheStats, createDnsCache, type DnsCache } from '@/core/protocols/dns/cache';
import {
  describeFlags,
  displayName,
  recordText,
  RR_TYPE_NOTES,
  SIMULATED_INTERNET,
  EXAMPLE_LOOKUPS,
  type DnsMessage,
  type ResourceRecord,
  type RrType,
} from '@/core/protocols/dns/records';
import {
  resolve,
  type DnsResolution,
  type ResolutionStep,
  type ServerTier,
} from '@/core/protocols/dns/resolver';
import { summarizePhases, type SimResult } from '@/core/sim/result';
import type { RfcRef, SimEvent } from '@/core/types/events';
import type { PDU } from '@/core/types/pdu';
import type { NodeKind, SimLink, SimNode, Topology } from '@/core/types/topology';

// ---------------------------------------------------------------------------
// What the tool can be asked
// ---------------------------------------------------------------------------

/** One canned question. Taken from the core fixture list so the two cannot drift. */
export interface LookupExample {
  readonly name: string;
  readonly type: RrType;
  readonly note: string;
}

/** The questions this tool offers, in the order they build on each other. */
export const LOOKUP_EXAMPLES: readonly LookupExample[] = EXAMPLE_LOOKUPS;

/** The lookup the tool opens on. */
export const DEFAULT_LOOKUP: LookupExample = LOOKUP_EXAMPLES[0]!;

// ---------------------------------------------------------------------------
// Caveats
// ---------------------------------------------------------------------------

/** What a lookup tool's answer is, and is not, evidence of. */
export const LOOKUP_CAVEATS: readonly { title: string; detail: string }[] = [
  {
    title: 'This is not the answer your application will get',
    detail:
      'A diagnostic tool asked the hierarchy directly. Your program asks the resolver the operating system gave it, which answers from its own cache, may sit in a different country, and may be configured to answer differently on purpose. Two machines on the same desk can legitimately disagree.',
  },
  {
    title: 'A cached answer hides how long ago it was true',
    detail:
      'The TTL a cache reports counts down from the record it stored. A stale-looking answer is not a resolver being wrong -- it is a resolver being correct about a record that has not expired yet. Changing a record does not change what is already cached.',
  },
  {
    title: 'Resolving a name is not reaching a host',
    detail:
      'A successful lookup proves a delegation chain exists and someone published a record. It says nothing about whether anything is listening at the address it returned.',
  },
];

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/** One record, with the sentence that explains what type it is. */
export interface AnnotatedRecord {
  readonly record: ResourceRecord;
  /** The zone-file line, as `dig` prints it. */
  readonly text: string;
  /** What this record type is for. */
  readonly note: string;
}

/** How the same question fared the second time, against a warm cache. */
export interface WarmRun {
  readonly queryCount: number;
  readonly elapsedMs: number;
  readonly servedFromCache: boolean;
  /** Entries in the cache when the warm run finished. */
  readonly cacheEntries: number;
  readonly summary: string;
}

/** One complete lookup, ready to draw. */
export interface LookupRun {
  readonly example: LookupExample;
  /** The cold walk: every query, every response, the cache it left behind. */
  readonly resolution: DnsResolution;
  /** The same question again, answered from what the cold walk cached. */
  readonly warm: WarmRun;
  readonly answers: readonly AnnotatedRecord[];
  /** The whole thing as `dig` would print it. */
  readonly output: readonly string[];
  readonly topology: Topology;
  readonly result: SimResult;
}

const RFC_1034: RfcRef = {
  rfc: 1034,
  section: '4.3.2',
  title: 'Domain Names -- Concepts and Facilities',
};
const RFC_2308: RfcRef = {
  rfc: 2308,
  title: 'Negative Caching of DNS Queries (DNS NCACHE)',
};

/** Virtual milliseconds of quiet after the last response, so the timeline has an end. */
const TAIL_MS = 200;

/** How to run a lookup. */
export interface LookupOptions {
  /** Seed for transaction ids and server selection. */
  readonly seed?: number | string;
  /** Start from a warm cache instead of an empty one. */
  readonly cache?: DnsCache;
  /** Ask for signatures, which costs extra queries. */
  readonly dnssec?: boolean;
}

/**
 * Resolve one name and package it the way a lookup tool would show it.
 *
 * Pure and total: the same example, options, and seed produce a deep-equal `LookupRun`.
 */
export function runLookup(
  example: LookupExample = DEFAULT_LOOKUP,
  options: LookupOptions = {},
): LookupRun {
  const seed = options.seed ?? `diagnostics:lookup:${example.name}:${example.type}`;
  const resolution = resolve(SIMULATED_INTERNET, example.name, example.type, {
    seed,
    ...(options.cache ? { cache: options.cache } : { cache: createDnsCache() }),
    ...(options.dnssec === undefined ? {} : { dnssec: options.dnssec }),
  });

  // The same question again, against what the first one cached. This is the only place
  // in the module where a second run is worth the tokens: the contrast is the lesson.
  const second = resolve(SIMULATED_INTERNET, example.name, example.type, {
    seed,
    cache: resolution.cache,
    ...(options.dnssec === undefined ? {} : { dnssec: options.dnssec }),
  });

  const topology = buildTopology(resolution);
  const { events, pdus, durationMs } = buildEvents(resolution);
  const sorted = [...events].sort((a, b) => a.at - b.at);

  return {
    example,
    resolution,
    warm: summarizeWarm(second),
    answers: resolution.answers.map(annotate),
    output: formatOutput(resolution, example),
    topology,
    result: {
      events: sorted,
      phases: summarizePhases(sorted, durationMs),
      durationMs,
      pdus,
    },
  };
}

function annotate(record: ResourceRecord): AnnotatedRecord {
  return {
    record,
    text: recordText(record),
    note: RR_TYPE_NOTES[record.type],
  };
}

function summarizeWarm(resolution: DnsResolution): WarmRun {
  const stats = cacheStats(resolution.cache, resolution.startedMs + resolution.elapsedMs);
  return {
    queryCount: resolution.queryCount,
    elapsedMs: Math.round(resolution.elapsedMs * 100) / 100,
    servedFromCache: resolution.servedFromCache,
    cacheEntries: stats.total,
    summary: resolution.servedFromCache
      ? `Asked again immediately: ${resolution.queryCount} queries, ${Math.round(resolution.elapsedMs)} ms. Every server in the walk above is now redundant until the TTLs run out -- which is why the second visit to a site never repeats the first one's DNS cost.`
      : `Asked again immediately: still ${resolution.queryCount} queries. Nothing about this answer was cacheable long enough to help.`,
  };
}

// ---------------------------------------------------------------------------
// The drawable network
// ---------------------------------------------------------------------------

/** Which icon a tier gets on the diagram. */
const TIER_KINDS: Readonly<Record<ServerTier, NodeKind>> = {
  stub: 'client',
  recursive: 'dns-resolver',
  cache: 'dns-resolver',
  root: 'dns-root',
  tld: 'dns-tld',
  authoritative: 'dns-authoritative',
};

/**
 * The machines the walk actually talked to, in the order it reached them.
 *
 * Derived from the steps rather than declared, so a lookup that takes a shortcut through
 * the cache draws a two-node diagram and one that chases a CNAME across two zones draws
 * every server it needed. A topology written by hand would have to guess.
 */
function buildTopology(resolution: DnsResolution): Topology {
  const nodes = new Map<string, SimNode>();
  const links = new Map<string, SimLink>();

  const idFor = (endpoint: ResolutionStep['from']): string =>
    endpoint.address || endpoint.name || endpoint.label;

  const add = (endpoint: ResolutionStep['from']): string => {
    const id = idFor(endpoint);
    if (!nodes.has(id)) {
      nodes.set(id, {
        id,
        kind: TIER_KINDS[endpoint.tier],
        label: endpoint.label,
        ...(endpoint.address ? { ipv4: endpoint.address } : {}),
        detail: {
          Role: TIER_ROLES[endpoint.tier],
          ...(endpoint.name ? { Name: displayName(endpoint.name) } : {}),
          Simulated: 'A fixture. No server is contacted.',
        },
      });
    }
    return id;
  };

  for (const step of resolution.steps) {
    const from = add(step.from);
    const to = add(step.to);
    const id = `${from}-${to}`;
    if (!links.has(id) && from !== to) {
      links.set(id, {
        id,
        from,
        to,
        // A query and its answer are one exchange; the propagation is already in the
        // step's own duration, so the link carries the half of it that is travel.
        latencyMs: Math.max(0.5, Math.round((step.durationMs / 2) * 10) / 10),
      });
    }
  }

  return { nodes: [...nodes.values()], links: [...links.values()] };
}

const TIER_ROLES: Readonly<Record<ServerTier, string>> = {
  stub: 'The resolver library inside your program. Asks one question and waits.',
  recursive:
    'Does the walking, and remembers the answers. This is the one your machine is configured with.',
  cache: 'The recursive resolver answering out of its own memory.',
  root: 'Knows the TLD servers and nothing else. Answers with referrals only.',
  tld: 'Knows the delegation for every domain under it. Also referrals only.',
  authoritative:
    'Owns the zone. The only server whose answer is not a pointer somewhere else.',
};

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function buildEvents(resolution: DnsResolution): {
  events: SimEvent[];
  pdus: Record<string, PDU>;
  durationMs: number;
} {
  const events: SimEvent[] = [];
  const pdus: Record<string, PDU> = {};

  events.push({
    kind: 'annotate',
    at: resolution.startedMs,
    targetId: resolution.steps[0]?.from.address || 'stub',
    text: `The program asks one question and gets one answer. Everything between the two is the recursive resolver's problem, and none of it is visible to the application -- which is why a slow first page load is so often a DNS walk nobody can see.`,
    reference: RFC_1034,
  });

  for (const step of resolution.steps) {
    const fromId = step.from.address || step.from.name || step.from.label;
    const toId = step.to.address || step.to.name || step.to.label;
    const half = Math.max(0.5, step.durationMs / 2);

    events.push({
      kind: 'phase',
      at: step.startedMs,
      id: `step-${step.index}`,
      title: stepTitle(step),
      description: step.note,
    });

    if (step.outcome === 'cache-hit') {
      events.push({
        kind: 'node-state',
        at: step.startedMs,
        nodeId: fromId,
        state: 'processing',
        note: 'answered from cache',
      });
      continue;
    }

    const queryPdu = messagePdu(`q-${step.index}`, step.query, step, 'query');
    pdus[queryPdu.id] = queryPdu;
    events.push({
      kind: 'pdu-created',
      at: step.startedMs,
      pdu: queryPdu,
      atNode: fromId,
    });
    events.push({
      kind: 'transmit',
      at: step.startedMs,
      pduId: queryPdu.id,
      from: fromId,
      to: toId,
      durationMs: half,
      linkId: `${fromId}-${toId}`,
    });

    if (!step.response) {
      events.push({
        kind: 'node-state',
        at: step.startedMs + half,
        nodeId: toId,
        state: 'error',
        note: 'no response',
      });
      events.push({
        kind: 'log',
        at: step.startedMs + step.durationMs,
        level: 'warn',
        text: `;; connection timed out; no servers could be reached at ${step.to.address}. ${step.note}`,
      });
      continue;
    }

    events.push({
      kind: 'node-state',
      at: step.startedMs + half,
      nodeId: toId,
      state: step.outcome === 'answer' ? 'active' : 'processing',
      note: step.outcome,
    });

    const responsePdu = messagePdu(`r-${step.index}`, step.response, step, 'response');
    pdus[responsePdu.id] = responsePdu;
    events.push({
      kind: 'pdu-created',
      at: step.startedMs + half,
      pdu: responsePdu,
      atNode: toId,
    });
    events.push({
      kind: 'transmit',
      at: step.startedMs + half,
      pduId: responsePdu.id,
      from: toId,
      to: fromId,
      durationMs: half,
      linkId: `${fromId}-${toId}`,
    });

    events.push({
      kind: 'log',
      at: step.startedMs + step.durationMs,
      level: step.outcome === 'servfail' || step.outcome === 'refused' ? 'error' : 'info',
      text: `${step.to.label}: ${step.note}`,
    });

    if (step.reference) {
      events.push({
        kind: 'annotate',
        at: step.startedMs + half,
        targetId: toId,
        text: step.note,
        reference: step.reference,
      });
    }
  }

  events.push({
    kind: 'phase',
    at: resolution.startedMs + resolution.elapsedMs,
    id: 'answer',
    title: 'The answer, and its shelf life',
    description:
      resolution.answers.length > 0
        ? `${resolution.rcode}. ${resolution.answers.length} record${resolution.answers.length === 1 ? '' : 's'}, cached for as long as the shortest TTL among them. Ask again before that runs out and none of the servers above are touched.`
        : `${resolution.rcode}. There is no answer, and RFC 2308 says the *absence* is cached too -- a negative answer has a lifetime of its own, taken from the zone's SOA.`,
  });

  if (resolution.answers.length === 0) {
    events.push({
      kind: 'annotate',
      at: resolution.startedMs + resolution.elapsedMs,
      targetId: resolution.steps[resolution.steps.length - 1]?.to.address || 'stub',
      text: `A "no" is a real answer and is cached like any other. That is why fixing a typo in a record can appear not to work for several minutes: the resolver is faithfully remembering that the name did not exist, for exactly as long as the zone told it to.`,
      reference: RFC_2308,
    });
  }

  return {
    events,
    pdus,
    durationMs:
      Math.round((resolution.startedMs + resolution.elapsedMs + TAIL_MS) * 100) / 100,
  };
}

function stepTitle(step: ResolutionStep): string {
  if (step.outcome === 'cache-hit') return 'Answered from cache';
  if (step.purpose === 'stub') return 'The program asks';
  if (step.purpose === 'ns-address')
    return `Where is ${displayName(step.query.question.name)}?`;
  if (step.purpose === 'dnssec') return `Keys from ${step.to.label}`;
  return `Ask the ${step.to.label}`;
}

/** A DNS message as a PDU: UDP or TCP underneath, the message itself on top. */
function messagePdu(
  id: string,
  message: DnsMessage,
  step: ResolutionStep,
  role: 'query' | 'response',
): PDU {
  const transport = step.transport === 'tcp' ? 'TCP' : 'UDP';
  const sections =
    role === 'query'
      ? []
      : [
          `ANSWER ${message.answer.length}`,
          `AUTHORITY ${message.authority.length}`,
          `ADDITIONAL ${message.additional.length}`,
        ];

  return {
    id,
    layers: [
      {
        layer: 'transport',
        protocol: transport,
        fields: [
          {
            name: 'Destination Port',
            value: role === 'query' ? '53' : String(50000 + step.index),
            bits: 16,
            note: 'Port 53 is DNS. The resolver picks a random source port, and that randomness is a real defence against off-path answer spoofing.',
          },
          { name: 'Length', value: String(message.sizeBytes + 8), bits: 16 },
        ],
      },
      {
        layer: 'application',
        protocol: 'DNS',
        fields: [
          {
            name: 'Transaction ID',
            value: String(message.id),
            bits: 16,
            note: 'Matches a response to its query. Sixteen bits is not much, which is why source-port randomisation matters.',
          },
          {
            name: 'Flags',
            value: describeFlags(message.flags) || '(none)',
            bits: 16,
            note: 'RD asks the other end to do the work; RA says it is willing to. A resolver querying the root sets neither.',
          },
          { name: 'RCODE', value: message.rcode, bits: 4 },
          {
            name: 'Question',
            value: `${displayName(message.question.name)} ${message.question.class} ${message.question.type}`,
          },
          ...sections.map((value) => ({ name: 'Section', value })),
        ],
        payloadPreview:
          role === 'query'
            ? `${displayName(message.question.name)}. IN ${message.question.type}`
            : (message.answer[0] ?? message.authority[0])
              ? recordText((message.answer[0] ?? message.authority[0])!)
              : '(empty)',
      },
    ],
    sizeBytes: message.sizeBytes + 8,
    summary:
      role === 'query'
        ? `DNS query ${displayName(message.question.name)} ${message.question.type}`
        : `DNS response ${message.rcode}, ${message.answer.length} answer / ${message.authority.length} authority`,
  };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/**
 * The transcript, in `dig`'s layout.
 *
 * Two of `dig`'s lines are deliberately missing. `;; WHEN:` needs a wall clock, and
 * nothing in this project is allowed one -- a run that printed a timestamp would stop
 * being replayable. `;; SERVER:` names the simulated resolver rather than anything from
 * the machine this is running on.
 */
function formatOutput(resolution: DnsResolution, example: LookupExample): string[] {
  const response = resolution.response;
  const lines: string[] = [
    `; <<>> simulated dig <<>> ${example.name} ${example.type}`,
    ';; global options: +cmd',
    ';; Got answer:',
    `;; ->>HEADER<<- opcode: QUERY, status: ${resolution.rcode}, id: ${response.id}`,
    `;; flags: ${(describeFlags(response.flags) || 'none').toLowerCase()}; QUERY: 1, ANSWER: ${response.answer.length}, AUTHORITY: ${response.authority.length}, ADDITIONAL: ${response.additional.length}`,
    '',
    ';; QUESTION SECTION:',
    `;${displayName(resolution.question.name)}\t\tIN\t${resolution.question.type}`,
  ];

  if (response.answer.length > 0) {
    lines.push('', ';; ANSWER SECTION:', ...response.answer.map(recordText));
  }
  if (response.authority.length > 0) {
    lines.push('', ';; AUTHORITY SECTION:', ...response.authority.map(recordText));
  }

  lines.push(
    '',
    `;; Query time: ${Math.round(resolution.elapsedMs)} msec`,
    ';; SERVER: 192.0.2.53#53(simulated recursive resolver)',
    `;; MSG SIZE  rcvd: ${response.sizeBytes}`,
    `;; ${resolution.queryCount} quer${resolution.queryCount === 1 ? 'y' : 'ies'} to real servers, ${resolution.usedRootOrTld ? 'including' : 'not including'} the root or a TLD`,
  );

  return lines;
}
