/**
 * The six scenarios, and the properties they must all hold.
 *
 * The determinism test is the one everything else rests on. A run that came out slightly
 * different each time could not be linked to, screenshotted, diffed, or described in a
 * sentence a second reader would recognise -- and a DNS run has more places for that to
 * go wrong quietly than most: transaction ids, round-trip jitter, and *which of thirteen
 * root servers gets asked* are all drawn from a generator. So every scenario is run twice
 * and then ten times, and compared whole -- topology, events, phases, PDUs, resolutions
 * and cache together.
 *
 * The rest divides in two. First, the properties every scenario shares: a coherent
 * topology, phases that tile the timeline, an iterative-or-recursive label on every
 * single query, an RFC citation on the notes that make a claim, and not one address that
 * could belong to a real host. Then, one section per scenario for the specific thing it
 * exists to teach -- because a suite that only checked the shared invariants would pass
 * just as happily on six copies of the same lookup.
 */

import { describe, expect, it } from 'vitest';

import { classifyIp, ip } from '@/core/net/address';
import type { SimEvent } from '@/core/types/events';

import { UDP_MAX_PAYLOAD } from '../sim/records';
import { STUB_LATENCY_MS } from '../sim/resolver';

import {
  CDN_LOOKUP,
  CDN_VANTAGES,
  CNAME_CHAIN,
  COLD_CACHE,
  DEFAULT_DNS_SCENARIO_ID,
  DNSSEC_VALIDATED,
  DNS_SCENARIOS,
  NXDOMAIN,
  RESOLVER_NODE,
  STUB_NODE,
  WARM_CACHE,
  getDnsScenario,
  runDnsScenario,
  type DnsRun,
  type DnsScenario,
} from './index';

const CASES = DNS_SCENARIOS.map((scenario) => [scenario.id, scenario] as const);

function eventsOfKind<K extends SimEvent['kind']>(
  run: DnsRun,
  kind: K,
): Extract<SimEvent, { kind: K }>[] {
  return run.result.events.filter(
    (event): event is Extract<SimEvent, { kind: K }> => event.kind === kind,
  );
}

/** Every step of every lookup in one run, flattened -- the ladder end to end. */
function allSteps(run: DnsRun) {
  return run.resolutions.flatMap((resolution) => resolution.steps);
}

// ---------------------------------------------------------------------------
// Determinism -- the property everything else depends on
// ---------------------------------------------------------------------------

describe.each(CASES)('%s is deterministic', (_id, scenario: DnsScenario) => {
  it('produces a deep-equal run the second time', () => {
    expect(runDnsScenario(scenario)).toEqual(runDnsScenario(scenario));
  });

  it('produces a deep-equal run the tenth time', () => {
    // Not redundant: a generator whose state leaked into module scope would agree with
    // itself once and drift after that, which two runs cannot catch.
    const first = runDnsScenario(scenario);
    for (let attempt = 0; attempt < 9; attempt += 1) {
      expect(runDnsScenario(scenario)).toEqual(first);
    }
  });

  it('picks the same root server every time, and a different one under a new seed', () => {
    // The determinism has to live in the seed rather than in the choice being fixed. A
    // run that ignored its seed would pass every test above and teach that there is one
    // root server, which is the opposite of the truth.
    const roots = (seed?: string) =>
      runDnsScenario(scenario, seed === undefined ? {} : { seed })
        .topology.nodes.filter((node) => node.kind === 'dns-root')
        .map((node) => node.id)
        .join(',');

    expect(roots()).toBe(roots());

    const contacted = new Set(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((suffix) => roots(`seed-${suffix}`)),
    );
    // The warm and cached runs may legitimately touch no root server at all, in which
    // case there is nothing to vary; every scenario that touches one must vary it.
    if (roots() !== '') expect(contacted.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

describe('the catalogue', () => {
  it('offers exactly the six scenarios the phase doc names, in teaching order', () => {
    expect(DNS_SCENARIOS.map((scenario) => scenario.id)).toEqual([
      'cold-cache',
      'warm-cache',
      'cname-chain',
      'cdn-lookup',
      'nxdomain',
      'dnssec-validated',
    ]);
  });

  it('opens on one of them', () => {
    expect(getDnsScenario(DEFAULT_DNS_SCENARIO_ID)).toBeDefined();
  });

  it('returns undefined for an id it does not offer', () => {
    expect(getDnsScenario('packet-journey')).toBeUndefined();
  });

  it('gives every scenario a unique id, a summary, and something it teaches', () => {
    const ids = DNS_SCENARIOS.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const scenario of DNS_SCENARIOS) {
      expect(scenario.title.length).toBeGreaterThan(0);
      expect(scenario.summary.length).toBeGreaterThan(20);
      expect(scenario.teaches.length).toBeGreaterThan(0);
      expect(scenario.lookups.length).toBeGreaterThan(0);
      for (const lookup of scenario.lookups) {
        expect(lookup.intent.length).toBeGreaterThan(20);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// What every run has to be true of
// ---------------------------------------------------------------------------

describe.each(CASES)('%s', (_id, scenario: DnsScenario) => {
  const run = runDnsScenario(scenario);

  it('draws only machines it actually spoke to, and always both ends of the ladder', () => {
    const ids = run.topology.nodes.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(STUB_NODE);
    expect(ids).toContain(RESOLVER_NODE);

    const contacted = new Set(allSteps(run).map((step) => step.to.name));
    for (const node of run.topology.nodes) {
      if (node.id === STUB_NODE || node.id === RESOLVER_NODE) continue;
      expect(contacted, `${node.id} is on the diagram`).toContain(node.id);
    }
  });

  it('links only machines the topology has', () => {
    const nodes = new Set(run.topology.nodes.map((node) => node.id));
    const links = run.topology.links.map((link) => link.id);
    expect(new Set(links).size).toBe(links.length);

    for (const link of run.topology.links) {
      expect(nodes.has(link.from), `${link.id} leaves a node that exists`).toBe(true);
      expect(nodes.has(link.to), `${link.id} reaches a node that exists`).toBe(true);
      expect(link.latencyMs).toBeGreaterThan(0);
    }
  });

  it('emits events in non-decreasing time order', () => {
    const times = run.result.events.map((event) => event.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('sends every packet down a link that exists, between the nodes it joins', () => {
    const links = new Map(run.topology.links.map((link) => [link.id, link]));

    for (const event of eventsOfKind(run, 'transmit')) {
      const link = links.get(event.linkId);
      expect(link, `${event.linkId} exists`).toBeDefined();
      expect([link!.from, link!.to]).toContain(event.from);
      expect([link!.from, link!.to]).toContain(event.to);
      expect(run.result.pdus[event.pduId], `${event.pduId} was created`).toBeDefined();
      expect(event.durationMs).toBeGreaterThan(0);
    }
  });

  it('creates every PDU it later refers to, and refers to every one it creates', () => {
    const created = eventsOfKind(run, 'pdu-created').map((event) => event.pdu.id);
    expect(new Set(created).size).toBe(created.length);
    expect(new Set(created)).toEqual(new Set(Object.keys(run.result.pdus)));

    const referenced = new Set([
      ...eventsOfKind(run, 'transmit').map((event) => event.pduId),
      ...eventsOfKind(run, 'drop').map((event) => event.pduId),
    ]);
    for (const id of created) {
      expect(referenced.has(id), `${id} is put on a wire`).toBe(true);
    }
  });

  it('tiles the timeline with phases, ending exactly where the run does', () => {
    const { phases, durationMs } = run.result;

    expect(phases.length).toBeGreaterThan(1);
    expect(phases[0].startMs).toBe(0);
    expect(phases.at(-1)!.endMs).toBe(durationMs);
    expect(new Set(phases.map((phase) => phase.id)).size).toBe(phases.length);

    phases.forEach((phase, index) => {
      expect(phase.index).toBe(index);
      expect(phase.endMs).toBeGreaterThanOrEqual(phase.startMs);
      expect(phase.title.length).toBeGreaterThan(0);
      expect(phase.description.length).toBeGreaterThan(40);
      // Half-open [startMs, endMs): each phase begins where the previous one ended, so
      // exactly one is current at any instant.
      if (index > 0) expect(phase.startMs).toBe(phases[index - 1].endMs);
    });
  });

  it('opens with the stub asking and closes with the answer arriving', () => {
    const ids = run.result.phases.map((phase) => phase.id);
    expect(ids[0]).toBe('question');
    expect(ids.at(-1)).toMatch(/^answer(-\d+)?$/);
    // One opening and one closing chapter per question the scenario asks.
    expect(ids.filter((id) => id.startsWith('question'))).toHaveLength(
      scenario.lookups.length,
    );
    expect(ids.filter((id) => id.startsWith('answer'))).toHaveLength(
      scenario.lookups.length,
    );
  });

  it('labels every single query iterative or recursive', () => {
    const queries = Object.keys(run.result.pdus).filter((id) => id.endsWith('-q'));
    expect(queries.length).toBeGreaterThan(0);

    const labelled = new Map(
      eventsOfKind(run, 'annotate')
        .filter((event) => event.targetId in run.result.pdus)
        .map((event) => [event.targetId, event]),
    );

    for (const id of queries) {
      const note = labelled.get(id);
      expect(note, `${id} is labelled`).toBeDefined();
      expect(note!.text).toMatch(/^(Iterative|Recursive) query: RD is (clear|set)\./);
      expect(note!.reference).toEqual({
        rfc: 1034,
        section: '4.3.1',
        title: 'Domain Names -- Concepts and Facilities',
      });
    }
    // Responses are not queries and must not be labelled as either.
    for (const id of Object.keys(run.result.pdus)) {
      if (id.endsWith('-q')) continue;
      expect(labelled.has(id), `${id} is a response`).toBe(false);
    }
  });

  it('sends exactly one recursive query per question, and it comes from the stub', () => {
    const recursive = allSteps(run).filter((step) => step.recursive);

    expect(recursive).toHaveLength(scenario.lookups.length);
    for (const step of recursive) {
      expect(step.from.tier).toBe('stub');
      expect(step.query.flags.rd).toBe(true);
    }
    // Everything the resolver sends itself is iterative, by RD rather than by assertion.
    for (const step of allSteps(run)) {
      if (step.recursive) continue;
      expect(step.query.flags.rd, `${step.to.name} was asked iteratively`).toBe(false);
    }
  });

  it('cites an RFC on the notes that make a claim', () => {
    const notes = eventsOfKind(run, 'annotate');
    expect(notes.length).toBeGreaterThan(0);

    const cited = notes.filter((note) => note.reference !== undefined);
    expect(cited.length).toBeGreaterThan(0);

    for (const note of notes) {
      expect(note.text.length).toBeGreaterThan(0);
      if (!note.reference) continue;
      expect(note.reference.rfc).toBeGreaterThan(0);
      expect(note.reference.title.length).toBeGreaterThan(0);
    }

    // Every note the scenario itself authored survives into the run, on its own phase.
    const byPhase = new Map(run.result.phases.map((phase) => [phase.id, phase]));
    for (const note of scenario.notes ?? []) {
      const phase = byPhase.get(note.phase);
      expect(phase, `${scenario.id} has a phase "${note.phase}"`).toBeDefined();
      expect(
        notes.some((event) => event.at === phase!.startMs && event.text === note.text),
        note.phase,
      ).toBe(true);
    }
  });

  it('pins every note to something on the diagram', () => {
    const targets = new Set([
      ...run.topology.nodes.map((node) => node.id),
      ...run.topology.links.map((link) => link.id),
      ...Object.keys(run.result.pdus),
    ]);

    for (const note of eventsOfKind(run, 'annotate')) {
      expect(targets.has(note.targetId), note.targetId).toBe(true);
    }
    for (const event of eventsOfKind(run, 'node-state')) {
      expect(targets.has(event.nodeId), event.nodeId).toBe(true);
    }
  });

  it('contacts nothing that could be a real host', () => {
    // Every address on the diagram has to come from a range reserved for documentation
    // or for private use. If the classifier ever calls one `public`, it belongs to
    // somebody, and this module must never put a packet anywhere near it.
    const addresses = run.topology.nodes.flatMap((node) =>
      node.ipv4 ? [node.ipv4] : [],
    );
    expect(addresses.length).toBe(run.topology.nodes.length);

    for (const address of addresses) {
      expect(['private', 'documentation'], address).toContain(classifyIp(ip(address)));
    }
  });

  it('carries the DNS header fields on every message', () => {
    for (const pdu of Object.values(run.result.pdus)) {
      const dns = pdu.layers.find((layer) => layer.protocol === 'DNS');
      expect(dns, pdu.id).toBeDefined();

      const named = new Set(dns!.fields.map((field) => field.name));
      for (const field of ['Transaction ID', 'Flags', 'QR', 'RD', 'RA', 'RCODE']) {
        expect(named, `${pdu.id} shows ${field}`).toContain(field);
      }
      for (const field of ['QNAME', 'QTYPE', 'QCLASS', 'ANCOUNT']) {
        expect(named, `${pdu.id} shows ${field}`).toContain(field);
      }
      // IPv4, then a transport, then DNS -- outermost header first.
      expect(pdu.layers.map((layer) => layer.layer)).toEqual([
        'network',
        'transport',
        'application',
      ]);
      expect(pdu.sizeBytes).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Cold cache: the full walk, and the answer that will not fit in a datagram
// ---------------------------------------------------------------------------

describe('cold-cache', () => {
  const run = runDnsScenario(COLD_CACHE);
  const [firstLookup, secondLookup] = run.resolutions;

  it('is referred by the root and by the TLD, and answered only by the zone', () => {
    const rungs = firstLookup.steps.filter((step) => step.purpose === 'lookup');

    expect(rungs.map((step) => `${step.to.tier}:${step.outcome}`)).toEqual([
      'root:referral',
      'tld:referral',
      'authoritative:answer',
    ]);

    // The referrals name servers and carry their addresses -- and answer nothing.
    for (const step of rungs.slice(0, 2)) {
      expect(step.response!.answer).toHaveLength(0);
      expect(step.response!.flags.aa).toBe(false);
      expect(step.response!.authority.length).toBeGreaterThan(0);
      expect(step.response!.additional.length).toBeGreaterThan(0);
    }

    const answer = rungs[2].response!;
    expect(answer.flags.aa).toBe(true);
    expect(firstLookup.addresses).toEqual(['203.0.113.20']);
    expect(firstLookup.usedRootOrTld).toBe(true);
  });

  it('remembers the delegation, so the second question skips the root and the TLD', () => {
    expect(secondLookup.usedRootOrTld).toBe(false);
    expect(secondLookup.steps.every((step) => step.to.tier !== 'root')).toBe(true);
    expect(secondLookup.steps.every((step) => step.to.tier !== 'tld')).toBe(true);
    // ...but the answer itself was never cached, so a server is still contacted.
    expect(secondLookup.servedFromCache).toBe(false);
  });

  it('is truncated over UDP and retried over TCP, citing RFC 1035 s4.2.1', () => {
    const rungs = secondLookup.steps.filter((step) => step.purpose === 'lookup');
    const truncated = rungs.find((step) => step.outcome === 'truncated');
    const retry = rungs.find((step) => step.transport === 'tcp');

    expect(truncated, 'the UDP attempt is truncated').toBeDefined();
    expect(retry, 'the question is asked again over TCP').toBeDefined();

    // TC set, and an empty response: the truncated reply carries no records at all.
    expect(truncated!.transport).toBe('udp');
    expect(truncated!.response!.flags.tc).toBe(true);
    expect(truncated!.response!.answer).toHaveLength(0);
    expect(truncated!.reference).toEqual({
      rfc: 1035,
      section: '4.2.1',
      title: 'Domain Names -- Implementation and Specification',
    });

    // The retry is the identical question to the identical server, and it fits.
    expect(retry!.to.name).toBe(truncated!.to.name);
    expect(retry!.query.question).toEqual(truncated!.query.question);
    expect(retry!.query.id).not.toBe(truncated!.query.id);
    expect(retry!.outcome).toBe('answer');
    expect(retry!.response!.sizeBytes).toBeGreaterThan(UDP_MAX_PAYLOAD);
    expect(retry!.startedMs).toBeGreaterThanOrEqual(
      truncated!.startedMs + truncated!.durationMs,
    );
  });

  it('draws the retry as a TCP packet and puts both halves in one chapter', () => {
    const tcp = Object.values(run.result.pdus).filter((pdu) =>
      pdu.layers.some((layer) => layer.protocol === 'TCP'),
    );
    expect(tcp.length).toBe(2);

    const truncation = run.result.phases.find((phase) => phase.id === 'truncation');
    expect(truncation).toBeDefined();
    const inside = run.result.events.filter(
      (event) => event.at >= truncation!.startMs && event.at < truncation!.endMs,
    );
    expect(
      inside.some((event) => event.kind === 'log' && /truncated/.test(event.text)),
    ).toBe(true);
  });

  it('advertises no EDNS(0), which is why the ceiling is 512 rather than 1232', () => {
    expect(COLD_CACHE.edns).toBeUndefined();
    const withEdns = runDnsScenario(COLD_CACHE, { edns: true });
    const retried = withEdns.resolutions[1].steps.some(
      (step) => step.outcome === 'truncated',
    );
    expect(retried, 'EDNS(0) would have avoided the retry entirely').toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Warm cache: the same question, and the difference
// ---------------------------------------------------------------------------

describe('warm-cache', () => {
  const run = runDnsScenario(WARM_CACHE);
  const [cold, warm] = run.resolutions;

  it('asks the same question twice', () => {
    expect(cold.question).toEqual(warm.question);
  });

  it('contacts three servers the first time and none the second', () => {
    expect(cold.queryCount).toBe(3);
    expect(cold.servedFromCache).toBe(false);
    expect(cold.usedRootOrTld).toBe(true);

    expect(warm.queryCount).toBe(0);
    expect(warm.servedFromCache).toBe(true);
    expect(warm.usedRootOrTld).toBe(false);
  });

  it('finishes the second lookup in a fraction of the time, with the same answer', () => {
    expect(warm.elapsedMs).toBeLessThan(cold.elapsedMs / 10);
    expect(warm.addresses).toEqual(cold.addresses);
    // Two hops to the resolver and back, plus the memory lookup. Nothing else.
    expect(warm.elapsedMs).toBe(STUB_LATENCY_MS * 2 + 1);
  });

  it('puts nothing on a wire past the resolver for the cache hit', () => {
    const cachePhase = run.result.phases.find((phase) => phase.id === 'cache')!;
    const answer = run.result.phases.find((phase) => phase.id === 'answer-2')!;

    const airborne = run.result.events.filter(
      (event) =>
        event.kind === 'transmit' &&
        event.at >= cachePhase.startMs &&
        event.at < answer.endMs &&
        event.from !== STUB_NODE &&
        event.to !== STUB_NODE,
    );
    expect(airborne).toHaveLength(0);
  });

  it('hands back less TTL than it was given', () => {
    const original = cold.answers[0].ttl;
    const handedOn = warm.answers[0].ttl;

    expect(handedOn).toBeLessThanOrEqual(original);
    expect(original).toBe(3600);
  });
});

// ---------------------------------------------------------------------------
// CNAME chain: two aliases, answered in one exchange
// ---------------------------------------------------------------------------

describe('cname-chain', () => {
  const run = runDnsScenario(CNAME_CHAIN);
  const [resolution] = run.resolutions;

  it('returns both aliases and the address in one answer section', () => {
    expect(resolution.answers.map((record) => `${record.name} ${record.type}`)).toEqual([
      'blog.example.com CNAME',
      'www.example.com CNAME',
      'example.com A',
    ]);
    expect(resolution.addresses).toEqual(['203.0.113.20']);
  });

  it('follows the chain inside one zone, without re-entering the tree', () => {
    const authoritative = resolution.steps.filter(
      (step) => step.to.tier === 'authoritative',
    );
    // One exchange with one server: the chain never left example.com, so unlike
    // cdn-lookup the resolver never had to start again from the root.
    expect(authoritative).toHaveLength(1);
    expect(resolution.steps.filter((step) => step.to.tier === 'root')).toHaveLength(1);
  });

  it('gives the aliases a shorter lifetime than the address they point at', () => {
    const [alias] = resolution.answers;
    const address = resolution.answers.at(-1)!;
    expect(alias.ttl).toBe(300);
    expect(address.ttl).toBe(3600);
  });
});

// ---------------------------------------------------------------------------
// CDN lookup: an alias out of the zone, and answers that vary by asker
// ---------------------------------------------------------------------------

describe('cdn-lookup', () => {
  const run = runDnsScenario(CDN_LOOKUP);
  const [resolution] = run.resolutions;

  it('restarts at the root when the alias leaves the zone', () => {
    const roots = resolution.steps.filter((step) => step.to.tier === 'root');
    expect(roots).toHaveLength(2);

    // The second climb is for the CNAME target, not for the name that was asked about.
    expect(roots[0].query.question.name).toBe('shop.example.com');
    expect(roots[1].query.question.name).toBe('edge.cdn.example.net');

    const phases = run.result.phases.map((phase) => phase.id);
    expect(phases).toContain('root-2');
    expect(phases).toContain('tld-2');
  });

  it('costs more than twice the queries of the chain that stayed in its zone', () => {
    const inZone = runDnsScenario(CNAME_CHAIN).resolutions[0];
    expect(resolution.queryCount).toBe(7);
    expect(resolution.queryCount).toBeGreaterThan(inZone.queryCount * 2);
  });

  it('is answered with more than one edge, on a thirty-second lifetime', () => {
    const edges = resolution.answers.filter((record) => record.type === 'A');
    expect(edges.length).toBeGreaterThan(1);
    for (const edge of edges) {
      expect(edge.ttl).toBe(30);
      expect(classifyIp(ip(resolution.addresses[edges.indexOf(edge)]))).toBe(
        'documentation',
      );
    }
  });

  it('describes a steered answer for each vantage point, from the RRset that came back', () => {
    expect(CDN_VANTAGES.length).toBeGreaterThan(1);

    const returned = new Set(resolution.addresses);
    for (const vantage of CDN_VANTAGES) {
      expect(returned, `${vantage.label} is steered somewhere real`).toContain(
        vantage.edge,
      );
      expect(classifyIp(ip(vantage.resolver))).toBe('documentation');
      expect(vantage.note.length).toBeGreaterThan(20);
    }
    // The point of the list is that they are not all the same answer.
    expect(new Set(CDN_VANTAGES.map((vantage) => vantage.edge)).size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// NXDOMAIN: a name that is not there, and how long that is remembered
// ---------------------------------------------------------------------------

describe('nxdomain', () => {
  const run = runDnsScenario(NXDOMAIN);
  const [first, second] = run.resolutions;

  it('is referred all the way down before anybody can say no', () => {
    // Only the authoritative server is in a position to assert non-existence; the root
    // and the TLD refer exactly as they would for a name that does exist.
    const rungs = first.steps.filter((step) => step.purpose === 'lookup');
    expect(rungs.map((step) => step.outcome)).toEqual([
      'referral',
      'referral',
      'nxdomain',
    ]);
    expect(first.rcode).toBe('NXDOMAIN');
    expect(first.answers).toHaveLength(0);
  });

  it('carries the SOA that licenses caching the answer', () => {
    const denial = first.steps.at(-1)!;
    const soa = denial.response!.authority.find((record) => record.type === 'SOA');

    expect(soa, 'a negative answer without an SOA may not be cached').toBeDefined();
    expect(soa!.data).toMatchObject({ type: 'SOA', minimum: 300 });
  });

  it('files the denial against the name and answers the repeat from memory', () => {
    const entry = second.cache.entries.find((row) => row.kind === 'nxdomain');
    expect(entry, 'the denial is cached').toBeDefined();
    expect(entry!.name).toBe('nope.example.com');
    expect(entry!.ttlSeconds).toBe(300);

    expect(second.rcode).toBe('NXDOMAIN');
    expect(second.servedFromCache).toBe(true);
    expect(second.queryCount).toBe(0);
    expect(second.elapsedMs).toBeLessThan(first.elapsedMs / 10);
  });

  it('cites RFC 2308 on the cached denial', () => {
    const hit = second.steps.find((step) => step.outcome === 'cache-hit');
    expect(hit!.reference?.rfc).toBe(2308);
  });

  it('marks the server that denied the name as an error state, not a failure', () => {
    const errors = run.result.events.filter(
      (event) => event.kind === 'node-state' && event.state === 'error',
    );
    expect(errors.length).toBeGreaterThan(0);
    // A denial is still an answer: nothing was dropped and nothing timed out.
    expect(run.result.events.filter((event) => event.kind === 'drop')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// DNSSEC: the chain of trust, and everything it costs
// ---------------------------------------------------------------------------

describe('dnssec-validated', () => {
  const run = runDnsScenario(DNSSEC_VALIDATED);
  const [resolution] = run.resolutions;

  it('validates the whole chain from the root down', () => {
    const validation = resolution.validation;
    expect(validation, 'the run validated').toBeDefined();
    expect(validation!.state).toBe('secure');
    expect(validation!.answerVerified).toBe(true);
    expect(validation!.links.map((link) => link.zone)).toEqual([
      '',
      'org',
      'example.org',
    ]);
    for (const link of validation!.links) {
      expect(link.state).toBe('secure');
    }
  });

  it('sets AD on the answer the stub receives, and DO on every query', () => {
    expect(resolution.response.flags.ad).toBe(true);
    for (const step of resolution.steps) {
      expect(step.query.flags.do, `${step.to.name}`).toBe(true);
    }
  });

  it('fetches a DNSKEY and a DS at every zone cut, and asks the parent for the DS', () => {
    const keys = resolution.steps.filter((step) => step.purpose === 'dnssec');
    expect(keys.length).toBeGreaterThanOrEqual(5);

    const asked = keys.map(
      (step) => `${step.query.question.type} ${step.query.question.name || '.'}`,
    );
    expect(asked).toContain('DNSKEY .');
    expect(asked).toContain('DS org');
    expect(asked).toContain('DNSKEY org');
    expect(asked).toContain('DS example.org');
    expect(asked).toContain('DNSKEY example.org');

    // A DS lives on the parent's side of the cut, so that is who is asked for it.
    const orgDs = keys.find((step) => step.query.question.type === 'DS')!;
    expect(orgDs.to.tier).toBe('root');
    for (const step of keys) {
      expect(step.reference?.rfc).toBe(4035);
    }
  });

  it('resolves a nameserver address from scratch, because the delegation had no glue', () => {
    const sideQuest = resolution.steps.filter((step) => step.purpose === 'ns-address');
    expect(sideQuest.length).toBeGreaterThan(0);
    expect(sideQuest.every((step) => step.depth > 0)).toBe(true);
    expect(sideQuest[0].query.question.name).toBe('ns1.dns-provider.net');
    // A walk of its own: root, then TLD, then the provider's zone.
    expect(sideQuest.map((step) => step.to.tier)).toEqual([
      'root',
      'tld',
      'authoritative',
    ]);
    expect(run.result.phases.map((phase) => phase.id)).toContain('ns-address');
  });

  it('costs several times the queries an unvalidated lookup of the same name would', () => {
    const plain = runDnsScenario(DNSSEC_VALIDATED, { dnssec: false });
    expect(resolution.queryCount).toBeGreaterThan(plain.resolutions[0].queryCount * 1.5);
    expect(plain.resolutions[0].validation).toBeUndefined();
    expect(plain.resolutions[0].response.flags.ad).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The six are six different lessons
// ---------------------------------------------------------------------------

describe('the six are six different lessons', () => {
  const runs = DNS_SCENARIOS.map(
    (scenario) => [scenario.id, runDnsScenario(scenario)] as const,
  );

  it('gives each one a different ladder', () => {
    const shapes = runs.map(([, run]) =>
      allSteps(run)
        .map((step) => `${step.purpose}:${step.to.tier}:${step.outcome}`)
        .join('|'),
    );
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it('touches the root in every cold walk and in no cached one', () => {
    const usedRoot = new Map(
      runs.map(([id, run]) => [
        id,
        run.resolutions.map((resolution) => resolution.usedRootOrTld),
      ]),
    );

    expect(usedRoot.get('cold-cache')).toEqual([true, false]);
    expect(usedRoot.get('warm-cache')).toEqual([true, false]);
    expect(usedRoot.get('cname-chain')).toEqual([true]);
    expect(usedRoot.get('cdn-lookup')).toEqual([true]);
    expect(usedRoot.get('nxdomain')).toEqual([true, false]);
    expect(usedRoot.get('dnssec-validated')).toEqual([true]);
  });

  it('puts the truncation path in exactly one scenario', () => {
    const truncating = runs.filter(([, run]) =>
      allSteps(run).some((step) => step.outcome === 'truncated'),
    );
    expect(truncating.map(([id]) => id)).toEqual(['cold-cache']);
  });

  it('never sends a query with RD set to anything but the resolver', () => {
    for (const [id, run] of runs) {
      for (const step of allSteps(run)) {
        if (!step.query.flags.rd) continue;
        expect(step.to.tier, id).toBe('recursive');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The notes contract
// ---------------------------------------------------------------------------

describe('scenario notes', () => {
  it('refuses to run a scenario that pins a note to a chapter it does not have', () => {
    // A typo in a phase id would otherwise mean a note that silently never appears, and
    // nothing on screen to say so.
    expect(() =>
      runDnsScenario({
        ...CNAME_CHAIN,
        notes: [{ phase: 'valdiate', text: 'a note about nothing' }],
      }),
    ).toThrow(/pins a note to phase "valdiate"/);
  });

  it('drops a note whose chapter an override removed, rather than failing the run', () => {
    // Overrides exist to change the shape of a run, so a note written against the
    // scenario's own configuration cannot be held against a different one.
    const plain = runDnsScenario(DNSSEC_VALIDATED, { dnssec: false });
    expect(plain.result.phases.map((phase) => phase.id)).not.toContain('validate');
    expect(plain.result.events.some((event) => event.kind === 'annotate')).toBe(true);
  });
});
