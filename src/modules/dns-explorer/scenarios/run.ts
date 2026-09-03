/**
 * Running a scenario -- turning a declared lookup into something that can be drawn.
 *
 * `sim/` answers the question "what does a resolver do?", and answers it as data: a
 * {@link DnsResolution} is a list of exchanges with times on them and nothing else. It
 * has no idea anything will ever be *shown*. This file is the one-way bridge from that
 * data to the `SimResult` the visualization layer consumes -- one-way on purpose,
 * because the rule the project is arranged around is that networking logic never learns
 * about rendering.
 *
 * So the split is:
 *
 * - **`sim/resolver.ts`** decides which server is asked what, and when.
 * - **this file** decides what a learner sees while that happens: which chapter of the
 *   story they are in, which machine lights up, which note is pinned to it, and which
 *   RFC that note cites.
 * - **the six scenario files** decide only *which questions get asked*, in what order,
 *   under what conditions -- a screenful of data each, and no logic at all.
 *
 * It lives beside the scenarios rather than in `sim/` because it is not part of the
 * protocol: delete every `phase` and `annotate` event produced here and DNS still
 * resolves identically. `sim/` would not survive the same treatment.
 *
 * ## The three things that come out of a run
 *
 * **A topology, derived rather than declared.** There is no fixed DNS diagram, because
 * there is no fixed set of servers: `example.com` touches three, `shop.example.com`
 * touches seven, and a warm cache touches none at all. So the topology is built from the
 * walk that actually happened, and every machine on the diagram is one this lookup
 * really spoke to -- which is also why the cold and warm runs of the same name draw
 * differently, and why that difference needs no explaining.
 *
 * **Phases that follow the ladder.** One chapter per rung, grouped so that the units are
 * the units of the *lesson* rather than of the protocol. The five queries DNSSEC
 * validation costs are one chapter, and so are the two halves of a truncated answer; but
 * a referral from the root and a referral from the TLD are two, because a learner who
 * merges those two has missed the thing this module exists to show.
 *
 * **Annotations that always say which kind of query this is.** Every query on the
 * diagram is labelled iterative or recursive, read off the RD bit in the message rather
 * than asserted here, and cites RFC 1034 s4.3.1. One run contains exactly one recursive
 * query however long it gets, and that asymmetry is the most useful thing in the module
 * to be able to point at.
 *
 * ## Determinism
 *
 * Nothing here reads a clock or a random number. Every timestamp comes from the
 * resolution, whose own numbers come from the fixtures and a seeded generator, and the
 * seed is part of the scenario. Two runs of one scenario are deep-equal, which
 * `scenarios.test.ts` asserts and which is what makes a run linkable, screenshottable,
 * and describable in a sentence the next reader will recognise.
 */

import { summarizePhases, type SimResult } from '@/core/sim/result';
import type { RfcRef, SimEvent } from '@/core/types/events';
import type { PDU, ProtocolLayer } from '@/core/types/pdu';
import type { NodeKind, SimLink, SimNode, Topology } from '@/core/types/topology';

import type { DnsCache } from '../sim/cache';
import {
  RCODE_VALUES,
  RR_TYPE_CODES,
  SIMULATED_INTERNET,
  describeFlags,
  displayName,
  recordText,
  serverAt,
  type DnsFlags,
  type DnsMessage,
  type Rcode,
  type ResourceRecord,
  type RrType,
  type SimulatedInternet,
} from '../sim/records';
import {
  STUB_LATENCY_MS,
  resolve,
  type DnsEndpoint,
  type DnsResolution,
  type DnsTransport,
  type ResolutionStep,
  type ServerTier,
} from '../sim/resolver';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Virtual milliseconds left on the timeline after the last answer arrives.
 *
 * The closing chapter needs somewhere to live: with no tail it would start and end at
 * the same instant, and the stepper would land on a phase of zero duration.
 */
export const DNS_TAIL_MS = 40;

/**
 * Virtual milliseconds between one answer arriving and the next question going out.
 *
 * A real client does something with an answer before it asks again, and without that
 * pause the closing chapter of every lookup but the last would be one millisecond wide
 * -- the time the answer spends crossing to the stub -- which is true and useless. The
 * gap gives it extent, and separates the lookups on the timeline into the two runs a
 * learner is meant to compare.
 */
export const DNS_GAP_MS = 60;

/** The client machine, which contains the stub resolver. On every diagram. */
export const STUB_NODE = 'stub';

/** The recursive resolver -- the only machine in the run that walks anything. */
export const RESOLVER_NODE = 'resolver';

/**
 * Where the recursive/iterative distinction is written down.
 *
 * Cited on every query in every scenario, because it is the one label that makes the
 * shape of a lookup legible: one recursive query in, several iterative queries out.
 */
const RFC_1034_MODES: RfcRef = {
  rfc: 1034,
  section: '4.3.1',
  title: 'Domain Names -- Concepts and Facilities',
};

/** Where the header bits these annotations talk about are actually defined. */
const RFC_1035_HEADER: RfcRef = {
  rfc: 1035,
  section: '4.1.1',
  title: 'Domain Names -- Implementation and Specification',
};

// ---------------------------------------------------------------------------
// What a scenario declares
// ---------------------------------------------------------------------------

/** One question the stub asks. */
export interface DnsLookup {
  readonly name: string;
  readonly type: RrType;
  /**
   * One sentence naming why this question is being asked, used as the description of
   * the chapter it opens. The only prose a scenario has to write per lookup.
   */
  readonly intent: string;
}

/**
 * A teaching note a scenario pins to one of its own phases.
 *
 * Pinned by phase id rather than by timestamp, because a scenario author knows which
 * chapter a point belongs to and does not know -- and should not have to know -- what
 * millisecond that chapter begins at.
 *
 * An id the run does not have is a bug in the scenario, and throws rather than being
 * dropped: the catalogue test runs every scenario, so a typo surfaces on the first
 * `npm test` after it is made. The exception is a run with overrides applied, where the
 * shape is *expected* to change -- turning EDNS(0) on removes the truncation chapter,
 * turning DNSSEC off removes the validation one -- so there the note is simply left out.
 * A scenario's notes are written against its own configuration and cannot be held to
 * somebody else's.
 */
export interface ScenarioNote {
  /** `PhaseSummary.id` of the chapter this belongs to, e.g. `'root'` or `'answer-2'`. */
  readonly phase: string;
  /** What it explains: a node id. Defaults to the resolver, which is always present. */
  readonly target?: string;
  readonly text: string;
  readonly reference?: RfcRef;
}

/** One run of the DNS Explorer: a few questions, and the conditions they are asked under. */
export interface DnsScenario {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  /** What a learner should be able to say afterwards. */
  readonly teaches: readonly string[];
  /**
   * The questions, asked in order against one cache.
   *
   * More than one is how the two scenarios about caching make their point: the same
   * question twice on a single timeline, the second finishing before the first one's
   * opening packet would have reached the root.
   */
  readonly lookups: readonly DnsLookup[];
  /** Seeds transaction ids, round-trip jitter, and which root server is tried first. */
  readonly seed: string;
  /** Validate with DNSSEC, which costs a DNSKEY and a DS at every zone on the way down. */
  readonly dnssec?: boolean;
  /** Advertise EDNS(0), raising the datagram ceiling from 512 bytes to 1232. */
  readonly edns?: boolean;
  /** Transport for the first attempt. UDP falls back to TCP on truncation. */
  readonly transport?: DnsTransport;
  /** Servers that will not answer, by name or by address. */
  readonly unresponsive?: readonly string[];
  /** Scenario-specific notes, on top of the ones every run gets. */
  readonly notes?: readonly ScenarioNote[];
}

/** What a test or a control panel may vary without editing the scenario. */
export type DnsScenarioOverrides = Partial<
  Pick<DnsScenario, 'seed' | 'dnssec' | 'edns' | 'transport' | 'unresponsive'>
>;

/**
 * A finished run.
 *
 * `topology` and `result` together are exactly what `SimulationView` wants; the other
 * two are what the module's own panels want -- the resolution ladder reads
 * `resolutions`, and the cache panel reads `cache`.
 */
export interface DnsRun {
  readonly topology: Topology;
  readonly result: SimResult;
  /** One per lookup, in order: the ladder, the answer, and the validation verdict. */
  readonly resolutions: readonly DnsResolution[];
  /** The cache as the last lookup left it, with TTLs stamped in virtual time. */
  readonly cache: DnsCache;
}

// ---------------------------------------------------------------------------
// The topology, built from the walk that happened
// ---------------------------------------------------------------------------

function kindFor(tier: ServerTier): NodeKind {
  switch (tier) {
    case 'stub':
      return 'client';
    case 'recursive':
    case 'cache':
      return 'dns-resolver';
    case 'root':
      return 'dns-root';
    case 'tld':
      return 'dns-tld';
    case 'authoritative':
      return 'dns-authoritative';
  }
}

/**
 * The node id for one end of an exchange.
 *
 * The cache is not a machine -- it is memory inside the resolver -- so it maps onto the
 * resolver rather than getting a box of its own. Drawing it separately would imply a hop
 * that does not exist, and the entire point of a cache hit is that there is no hop.
 */
function nodeIdFor(endpoint: DnsEndpoint): string {
  if (endpoint.tier === 'stub') return STUB_NODE;
  if (endpoint.tier === 'recursive' || endpoint.tier === 'cache') return RESOLVER_NODE;
  return endpoint.name;
}

interface Build {
  readonly internet: SimulatedInternet;
  readonly nodes: SimNode[];
  readonly links: SimLink[];
  readonly seen: Map<string, SimNode>;
  readonly linkIds: Set<string>;
  readonly events: SimEvent[];
  readonly pdus: Record<string, PDU>;
  readonly phaseCounts: Map<string, number>;
  /** The group key of the chapter currently open, so consecutive rungs can merge. */
  group: string;
}

function ensureNode(build: Build, endpoint: DnsEndpoint): string {
  const id = nodeIdFor(endpoint);
  if (build.seen.has(id)) return id;

  const server = serverAt(build.internet, endpoint.address);
  const node: SimNode = {
    id,
    kind: kindFor(endpoint.tier),
    label: endpoint.name,
    ipv4: endpoint.address,
    ...(server?.ipv6 ? { ipv6: server.ipv6 } : {}),
    detail: {
      role: endpoint.label,
      ...(server ? { 'round trip': `${server.rttMs} ms` } : {}),
      ...(server?.note ? { note: server.note } : {}),
    },
  };

  build.seen.set(id, node);
  build.nodes.push(node);
  return id;
}

/**
 * The link between the resolver and one server.
 *
 * Every server hangs directly off the resolver, which is the truth of the picture: a
 * recursive resolver does not route *through* the root to reach the TLD, it opens a
 * separate conversation with each in turn. The hierarchy is in the names, not in the
 * wires, and drawing it as a chain is the mistake this shape avoids.
 */
function ensureLink(build: Build, from: string, to: string, latencyMs: number): string {
  const id = `${from}-${to}`;
  if (!build.linkIds.has(id)) {
    build.linkIds.add(id);
    build.links.push({ id, from, to, latencyMs, medium: 'fiber' });
  }
  return id;
}

/** One-way latency to a server: half its round trip, or a plausible default. */
function latencyTo(build: Build, endpoint: DnsEndpoint): number {
  const server = serverAt(build.internet, endpoint.address);
  return Math.round((server?.rttMs ?? 30) / 2);
}

// ---------------------------------------------------------------------------
// Messages, as they look on the wire
// ---------------------------------------------------------------------------

/**
 * The 16-bit flags word, assembled the way the header lays it out.
 *
 * DO is deliberately absent: it is not a header bit at all but the top bit of the TTL
 * field of an EDNS(0) OPT pseudo-record (RFC 6891 s6.1.3). `describeFlags` lists it
 * beside the others because that is how a capture reads it out; this does not, because
 * that is not where the bit is.
 */
function flagsWord(flags: DnsFlags, rcode: Rcode): number {
  return (
    (flags.qr ? 0x8000 : 0) |
    (flags.aa ? 0x0400 : 0) |
    (flags.tc ? 0x0200 : 0) |
    (flags.rd ? 0x0100 : 0) |
    (flags.ra ? 0x0080 : 0) |
    (flags.ad ? 0x0020 : 0) |
    (flags.cd ? 0x0010 : 0) |
    RCODE_VALUES[rcode]
  );
}

function hex(value: number, width: number): string {
  return `0x${value.toString(16).padStart(width, '0')}`;
}

/**
 * A name as it reads in a sentence.
 *
 * `displayName` writes the fully-qualified form with the trailing dot, which is right in
 * a header field and wrong in prose -- "where does example.com. live?" reads as a typo
 * rather than as notation. Titles and descriptions use this; anything claiming to show
 * the wire uses `displayName`.
 */
function inProse(name: string): string {
  return name === '' ? 'the root zone' : name;
}

/** At most six records from one section, so the inspector stays readable. */
function sectionFields(
  label: string,
  records: readonly ResourceRecord[],
): ProtocolLayer['fields'] {
  const shown = records.slice(0, 6).map((record, index) => ({
    name: `${label} ${index + 1}`,
    value: recordText(record),
  }));
  if (records.length > shown.length) {
    shown.push({
      name: `${label} (rest)`,
      value: `${records.length - shown.length} more record(s)`,
    });
  }
  return shown;
}

function bit(set: boolean, whenSet: string, whenClear: string): string {
  return set ? `1 (${whenSet})` : `0 (${whenClear})`;
}

/** The DNS message itself, field by field, as a packet analyser would list it. */
function dnsLayer(msg: DnsMessage): ProtocolLayer {
  const { flags, question: q } = msg;
  const described = describeFlags(flags);

  return {
    layer: 'application',
    protocol: 'DNS',
    fields: [
      {
        name: 'Transaction ID',
        value: hex(msg.id, 4),
        bits: 16,
        note: 'Copied into the response. With no connection underneath, this and the port pair are most of what ties an answer to its question -- which is why both are chosen unpredictably (RFC 5452).',
      },
      {
        name: 'Flags',
        value: `${hex(flagsWord(flags, msg.rcode), 4)} (${described || 'none set'})`,
        bits: 16,
      },
      { name: 'QR', value: bit(flags.qr, 'response', 'query'), bits: 1 },
      {
        name: 'AA',
        value: bit(flags.aa, 'authoritative answer', 'not authoritative'),
        bits: 1,
        note: 'Clear on a referral: the root and TLD servers are not authoritative for the name you asked about, which is exactly why they refer rather than answer.',
      },
      {
        name: 'TC',
        value: bit(flags.tc, 'truncated -- ask again over TCP', 'complete'),
        bits: 1,
        note: 'Essentially all a truncated response carries. The resolver discards the datagram, opens a TCP connection, and asks again (RFC 1035 s4.2.1).',
      },
      {
        name: 'RD',
        value: bit(flags.rd, 'recursion desired', 'iterative query'),
        bits: 1,
        note: 'Set by the stub and by nothing else in the run. Every query the resolver sends has it clear, because the resolver is the one doing the work.',
      },
      {
        name: 'RA',
        value: bit(flags.ra, 'recursion available', 'recursion not offered'),
        bits: 1,
        note: 'An authoritative server sets this only if it will recurse for strangers -- which is what an open resolver is, and why they get found and abused.',
      },
      {
        name: 'AD',
        value: bit(flags.ad, 'authentic data -- signatures checked', 'not validated'),
        bits: 1,
        note: 'The resolver telling the stub it validated the chain of trust. The stub is trusting the resolver and the path to it, not the signatures themselves (RFC 4035 s3.2.3).',
      },
      {
        name: 'RCODE',
        value: `${msg.rcode} (${RCODE_VALUES[msg.rcode]})`,
        bits: 4,
        note: 'NXDOMAIN means the name does not exist. NOERROR with an empty answer section means the name exists but not with this type -- a different fact, cached separately and for a different reason.',
      },
      { name: 'QDCOUNT', value: '1', bits: 16 },
      { name: 'ANCOUNT', value: String(msg.answer.length), bits: 16 },
      {
        name: 'NSCOUNT',
        value: String(msg.authority.length),
        bits: 16,
        note: 'The authority section: the NS records of a referral, or the SOA that says how long a negative answer may be remembered.',
      },
      {
        name: 'ARCOUNT',
        value: String(msg.additional.length),
        bits: 16,
        note: 'The additional section, which is where glue lives: addresses for the nameservers the authority section only names.',
      },
      {
        name: 'QNAME',
        value: displayName(q.name) || '. (the root)',
        note: 'Encoded as length-prefixed labels ending in a zero byte: 7example3com0.',
      },
      { name: 'QTYPE', value: `${q.type} (${RR_TYPE_CODES[q.type]})`, bits: 16 },
      { name: 'QCLASS', value: 'IN (1)', bits: 16 },
      ...sectionFields('Answer', msg.answer),
      ...sectionFields('Authority', msg.authority),
      ...sectionFields('Additional', msg.additional),
    ],
    payloadPreview: previewOf(msg),
  };
}

function previewOf(msg: DnsMessage): string {
  if (!msg.flags.qr) return `${displayName(msg.question.name)} IN ${msg.question.type}`;
  if (msg.flags.tc) return 'truncated -- nothing but the header came back';
  const first = msg.answer[0] ?? msg.authority[0];
  return first ? recordText(first) : `${msg.rcode}, no records`;
}

/** IPv4 + UDP or TCP + DNS, sized the way it would be on the wire. */
function dnsPdu(
  id: string,
  msg: DnsMessage,
  transport: DnsTransport,
  from: DnsEndpoint,
  to: DnsEndpoint,
): PDU {
  const overTcp = transport !== 'udp';
  // A real resolver randomises its source port for the same reason it randomises the
  // transaction id; deriving one from the other keeps the pair varied and reproducible.
  const sourcePort = 49152 + (msg.id % 16384);
  // TCP's 20-byte header, plus the two-byte length prefix DNS adds over a stream.
  const transportBytes = overTcp ? 22 : 8;
  const sizeBytes = 20 + transportBytes + msg.sizeBytes;

  const network: ProtocolLayer = {
    layer: 'network',
    protocol: 'IPv4',
    fields: [
      { name: 'Source Address', value: from.address, bits: 32 },
      { name: 'Destination Address', value: to.address, bits: 32 },
      { name: 'Protocol', value: overTcp ? 'TCP (6)' : 'UDP (17)', bits: 8 },
      { name: 'Total Length', value: `${sizeBytes} bytes`, bits: 16 },
    ],
  };

  const transportLayer: ProtocolLayer = overTcp
    ? {
        layer: 'transport',
        protocol: 'TCP',
        fields: [
          { name: 'Source Port', value: String(sourcePort), bits: 16 },
          { name: 'Destination Port', value: '53 (domain)', bits: 16 },
          {
            name: 'Message Length',
            value: `${msg.sizeBytes} bytes`,
            bits: 16,
            note: 'Over TCP a DNS message is prefixed with its own length, because a stream has no message boundaries of its own. Those two bytes are why size stops being a limit here.',
          },
        ],
      }
    : {
        layer: 'transport',
        protocol: 'UDP',
        fields: [
          {
            name: 'Source Port',
            value: String(sourcePort),
            bits: 16,
            note: 'Randomised per query. Together with the transaction id it gives an off-path attacker 2^32 guesses instead of 2^16 (RFC 5452).',
          },
          { name: 'Destination Port', value: '53 (domain)', bits: 16 },
          { name: 'Length', value: `${msg.sizeBytes + 8} bytes`, bits: 16 },
          { name: 'Checksum', value: '0x0000 (not computed here)', bits: 16 },
        ],
      };

  const kind = msg.flags.qr ? 'Standard query response' : 'Standard query';
  const tail = msg.flags.qr
    ? ` ${msg.rcode}${msg.flags.tc ? ', truncated' : `, ${msg.answer.length} answer(s)`}`
    : '';

  return {
    id,
    layers: [network, transportLayer, dnsLayer(msg)],
    sizeBytes,
    summary: `${kind} ${hex(msg.id, 4)} ${msg.question.type} ${displayName(msg.question.name)}${tail}`,
  };
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

/**
 * The chapters a DNS run is told in.
 *
 * Chosen so that each one is something a learner can be wrong about. `root` and `tld`
 * are separate because the referral happens twice and people expect it to happen zero
 * times; `ns-address` is separate because that side quest is invisible in every
 * simplified diagram of DNS; `truncation` is separate because the retry is a different
 * transport carrying an identical question.
 */
type PhaseKind =
  | 'question'
  | 'cache'
  | 'root'
  | 'tld'
  | 'authoritative'
  | 'ns-address'
  | 'truncation'
  | 'validate'
  | 'answer';

function phaseKindFor(step: ResolutionStep): PhaseKind {
  if (step.purpose === 'stub') return 'question';
  if (step.to.tier === 'cache') return 'cache';
  // Both halves of a truncated exchange -- the 512-byte refusal and the TCP retry --
  // belong to one chapter, because on its own neither half is the lesson.
  if (step.outcome === 'truncated' || step.transport === 'tcp') return 'truncation';
  if (step.purpose === 'dnssec') return 'validate';
  if (step.purpose === 'ns-address') return 'ns-address';
  switch (step.to.tier) {
    case 'root':
      return 'root';
    case 'tld':
      return 'tld';
    default:
      return 'authoritative';
  }
}

/**
 * Which chapters split on *which server was asked*, and which do not.
 *
 * A validating resolver's five key lookups are one idea, not five, and so is a side
 * quest that walks the tree to find a nameserver's address. But a referral from the root
 * and a referral from the TLD are two ideas even though the rung looks identical, so
 * anything on the main walk splits whenever the name or the server changes -- which is
 * also what makes a CNAME pointing out of the zone restart the ladder visibly.
 */
function splitsByServer(kind: PhaseKind): boolean {
  return kind === 'root' || kind === 'tld' || kind === 'authoritative';
}

interface PhaseText {
  readonly title: string;
  readonly description: string;
}

function phaseTextFor(
  kind: PhaseKind,
  step: ResolutionStep,
  lookup: DnsLookup,
): PhaseText {
  const asked = inProse(step.query.question.name);
  const server = step.to.name;

  switch (kind) {
    case 'question':
      return {
        title: `The stub asks for ${inProse(lookup.name)}`,
        description: `${lookup.intent} The stub resolver in the operating system sends one query with RD set and then waits. It walks nothing itself -- that is the whole division of labour, and everything that follows happens on the far side of this single question.`,
      };
    case 'cache':
      return {
        title: 'Answered from memory',
        description:
          'The resolver already holds this, and nothing leaves the building: no root server, no TLD server, no authoritative server is contacted. The TTL it hands back is what is left of the original rather than the original itself -- an answer that ages as it is passed on.',
      };
    case 'root':
      return {
        title: `Root server: where does ${asked} live?`,
        description: `${server} is asked for ${asked} and does not answer it. Back come the nameservers for the top-level domain and their addresses -- a referral. A root server has never held the address of a website and never will.`,
      };
    case 'tld':
      return {
        title: `TLD server: one label further down`,
        description: `${server} knows which servers run each domain in its registry and nothing whatever about what is inside them. So it refers as well, and the resolver ends the exchange one label closer than it started.`,
      };
    case 'authoritative':
      return {
        title: `${server}: the zone itself`,
        description: `The first server in the chain that has ever heard of ${asked}. It answers out of its own zone file with AA set -- or refers once more, if the zone has been cut again below it.`,
      };
    case 'ns-address':
      return {
        title: 'A side quest: the delegation carried no glue',
        description:
          "The nameservers for this zone live outside it, so the parent published no addresses for them -- and a name is not something a resolver can send a packet to. Before the walk can continue it has to stop and resolve a nameserver's own name, from the root, all over again.",
      };
    case 'truncation':
      return {
        title: 'Too big for a datagram',
        description:
          'The answer will not fit in the 512 bytes a plain UDP DNS response is limited to. What comes back is a header with TC set and nothing much else; the resolver throws it away, opens a TCP connection, and asks the identical question a second time.',
      };
    case 'validate':
      return {
        title: 'Walking the chain of trust',
        description:
          "The data is in hand; whether it can be believed is a separate walk. The resolver fetches a DNSKEY and a DS at every zone from the root down, checking that each parent vouches for its child's key. These are the queries a non-validating resolver never sends, and they are most of what DNSSEC costs.",
      };
    case 'answer':
      return {
        title: `The answer for ${inProse(lookup.name)} reaches the stub`,
        description:
          'One question went out and one answer comes back, however much work happened in between. The stub never saw the root, the TLD, or a single referral -- which is why DNS looks like a lookup table from the application side, and why so few people picture the tree behind it.',
      };
  }
}

/** A phase id, made unique when the same kind of chapter recurs within one run. */
function phaseIdFor(build: Build, kind: PhaseKind): string {
  const seen = build.phaseCounts.get(kind) ?? 0;
  build.phaseCounts.set(kind, seen + 1);
  return seen === 0 ? kind : `${kind}-${seen + 1}`;
}

function openPhase(build: Build, at: number, kind: PhaseKind, text: PhaseText): void {
  build.events.push({
    kind: 'phase',
    at,
    id: phaseIdFor(build, kind),
    title: text.title,
    description: text.description,
  });
}

// ---------------------------------------------------------------------------
// Turning one rung into events
// ---------------------------------------------------------------------------

function logLevel(step: ResolutionStep): 'info' | 'warn' | 'error' {
  switch (step.outcome) {
    case 'servfail':
    case 'timeout':
    case 'refused':
      return 'error';
    case 'nxdomain':
    case 'truncated':
      return 'warn';
    default:
      return 'info';
  }
}

/** The label every query on the diagram carries, taken from its own RD bit. */
function modeNote(step: ResolutionStep): string {
  return step.recursive
    ? 'Recursive query: RD is set. The stub is asking somebody else to do the whole chase, and will wait however long that takes. This is the only recursive query in the run, no matter how many rungs the ladder ends up with.'
    : 'Iterative query: RD is clear. The resolver is walking the tree itself and expects at most one step down per answer. A root or TLD server would refuse to recurse on its behalf in any case.';
}

/**
 * The stub's own exchange, which encloses every other one.
 *
 * Drawn as two short hops rather than one arrow lasting the whole run, because that is
 * what happens: the question takes a millisecond to reach the resolver, and then nothing
 * at all is on the wire between client and resolver until the answer comes back. A
 * packet stretched across the middle would suggest a connection being held open, which
 * is precisely what UDP does not do.
 */
function emitStubQuery(build: Build, step: ResolutionStep, index: string): void {
  const from = ensureNode(build, step.from);
  const to = ensureNode(build, step.to);
  const linkId = ensureLink(build, from, to, STUB_LATENCY_MS);
  const pdu = dnsPdu(`${index}-stub-q`, step.query, step.transport, step.from, step.to);

  build.pdus[pdu.id] = pdu;
  build.events.push(
    { kind: 'node-state', at: step.startedMs, nodeId: from, state: 'active' },
    { kind: 'pdu-created', at: step.startedMs, pdu, atNode: from },
    {
      kind: 'transmit',
      at: step.startedMs,
      pduId: pdu.id,
      from,
      to,
      durationMs: STUB_LATENCY_MS,
      linkId,
    },
    {
      kind: 'annotate',
      at: step.startedMs,
      targetId: pdu.id,
      text: modeNote(step),
      reference: RFC_1034_MODES,
    },
    {
      kind: 'log',
      at: step.startedMs,
      level: 'info',
      text: `${step.from.label} asks ${step.to.label} for ${displayName(step.query.question.name)} ${step.query.question.type}, RD set`,
    },
    {
      kind: 'node-state',
      at: step.startedMs + STUB_LATENCY_MS,
      nodeId: to,
      state: 'processing',
      note: 'working the question',
    },
  );
}

function emitStubAnswer(build: Build, step: ResolutionStep, index: string): void {
  const response = step.response;
  if (!response) return;

  const at = step.startedMs + step.durationMs - STUB_LATENCY_MS;
  const from = nodeIdFor(step.to);
  const to = nodeIdFor(step.from);
  const linkId = ensureLink(build, to, from, STUB_LATENCY_MS);
  const pdu = dnsPdu(`${index}-stub-r`, response, step.transport, step.to, step.from);
  build.pdus[pdu.id] = pdu;

  build.events.push(
    { kind: 'pdu-created', at, pdu, atNode: from },
    {
      kind: 'transmit',
      at,
      pduId: pdu.id,
      from,
      to,
      durationMs: STUB_LATENCY_MS,
      linkId,
    },
    {
      kind: 'annotate',
      at,
      targetId: to,
      text: step.note,
      reference: step.reference ?? RFC_1034_MODES,
    },
    {
      kind: 'log',
      at,
      level: logLevel(step),
      text: `${step.to.label} answers ${response.rcode} with ${response.answer.length} record(s) after ${step.durationMs} ms -- ${step.note}`,
    },
    {
      kind: 'node-state',
      at: step.startedMs + step.durationMs,
      nodeId: from,
      state: 'idle',
    },
    {
      kind: 'node-state',
      at: step.startedMs + step.durationMs,
      nodeId: to,
      state: step.outcome === 'answer' ? 'active' : 'error',
    },
  );
}

/**
 * A cache hit: memory, not a machine.
 *
 * No `transmit`, deliberately. Nothing goes on a wire, and the absence of a packet on
 * the diagram at the very moment the answer appears is the plainest statement of what a
 * cache is that this module can make.
 */
function emitCacheHit(build: Build, step: ResolutionStep): void {
  const at = step.startedMs;
  build.events.push(
    {
      kind: 'node-state',
      at,
      nodeId: RESOLVER_NODE,
      state: 'processing',
      note: 'cache hit',
    },
    {
      kind: 'annotate',
      at,
      targetId: RESOLVER_NODE,
      text: step.note,
      reference: step.reference ?? RFC_1035_HEADER,
    },
    {
      kind: 'log',
      at,
      level: 'info',
      text: `cache hit for ${displayName(step.query.question.name)} ${step.query.question.type} -- ${step.note}`,
    },
  );
}

/** One iterative exchange with one server: out, think, back. */
function emitExchange(build: Build, step: ResolutionStep, index: string): void {
  const from = ensureNode(build, step.from);
  const to = ensureNode(build, step.to);
  const latency = latencyTo(build, step.to);
  const linkId = ensureLink(build, from, to, latency);

  const query = dnsPdu(
    `${index}-s${step.index}-q`,
    step.query,
    step.transport,
    step.from,
    step.to,
  );
  build.pdus[query.id] = query;

  // A timeout is the one case where the two legs are not symmetric: the query really
  // does arrive, and then nothing comes back for a whole second.
  const outbound = step.response
    ? step.durationMs / 2
    : Math.min(latency, step.durationMs);
  const arrival = step.startedMs + outbound;

  build.events.push(
    { kind: 'pdu-created', at: step.startedMs, pdu: query, atNode: from },
    {
      kind: 'transmit',
      at: step.startedMs,
      pduId: query.id,
      from,
      to,
      durationMs: outbound,
      linkId,
    },
    {
      kind: 'annotate',
      at: step.startedMs,
      targetId: query.id,
      text: modeNote(step),
      reference: RFC_1034_MODES,
    },
    {
      kind: 'log',
      at: step.startedMs,
      level: 'info',
      text: `resolver -> ${step.to.name}: ${displayName(step.query.question.name)} ${step.query.question.type} over ${step.transport.toUpperCase()}, RD clear`,
    },
  );

  if (!step.response) {
    build.events.push(
      { kind: 'node-state', at: arrival, nodeId: to, state: 'error' },
      {
        kind: 'drop',
        at: arrival,
        pduId: query.id,
        atNode: to,
        reason:
          'no response -- the resolver waits out its timeout and moves on to the next nameserver',
      },
      {
        kind: 'annotate',
        at: arrival,
        targetId: to,
        text: step.note,
        ...(step.reference ? { reference: step.reference } : {}),
      },
      {
        kind: 'log',
        at: step.startedMs + step.durationMs,
        level: 'error',
        text: `${step.to.name} never answered -- ${step.note}`,
      },
      {
        kind: 'node-state',
        at: step.startedMs + step.durationMs,
        nodeId: to,
        state: 'idle',
      },
    );
    return;
  }

  const response = dnsPdu(
    `${index}-s${step.index}-r`,
    step.response,
    step.transport,
    step.to,
    step.from,
  );
  build.pdus[response.id] = response;

  build.events.push(
    { kind: 'node-state', at: arrival, nodeId: to, state: 'processing' },
    { kind: 'pdu-created', at: arrival, pdu: response, atNode: to },
    {
      kind: 'transmit',
      at: arrival,
      pduId: response.id,
      from: to,
      to: from,
      durationMs: step.durationMs - outbound,
      linkId,
    },
    {
      kind: 'annotate',
      at: arrival,
      targetId: to,
      text: step.note,
      ...(step.reference ? { reference: step.reference } : {}),
    },
    {
      kind: 'log',
      at: arrival,
      level: logLevel(step),
      text: `${step.to.name} -> resolver: ${step.outcome}${step.response.flags.aa ? ', AA set' : ''}, ${step.response.sizeBytes} bytes -- ${step.note}`,
    },
    {
      kind: 'node-state',
      at: step.startedMs + step.durationMs,
      nodeId: to,
      state:
        step.outcome === 'nxdomain' || step.outcome === 'servfail' ? 'error' : 'idle',
    },
  );
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/** Open a chapter if this rung starts one, and remember which one is open. */
function trackPhase(
  build: Build,
  step: ResolutionStep,
  lookup: DnsLookup,
  lookupIndex: number,
): void {
  const kind = phaseKindFor(step);
  const key = splitsByServer(kind)
    ? `${lookupIndex}:${kind}:${step.query.question.name}:${step.to.name}`
    : `${lookupIndex}:${kind}`;
  if (key === build.group) return;

  build.group = key;
  openPhase(build, step.startedMs, kind, phaseTextFor(kind, step, lookup));
}

/**
 * Sort by time, keeping emission order within one instant.
 *
 * The tie-break matters: a `pdu-created` and the `transmit` referencing it happen at the
 * same virtual millisecond, and the log reads as nonsense the other way round.
 * `Array.prototype.sort` has been required to be stable since ES2019.
 */
function sortEvents(events: readonly SimEvent[]): SimEvent[] {
  return [...events].sort((a, b) => a.at - b.at);
}

/**
 * Run one scenario end to end.
 *
 * The lookups share a cache and a clock, which is what makes a two-question scenario
 * more than two runs stapled together: the second question is asked of a resolver that
 * has already learned something from the first, and the timeline shows precisely what
 * that was worth.
 */
export function runDnsScenario(
  scenario: DnsScenario,
  overrides: DnsScenarioOverrides = {},
  internet: SimulatedInternet = SIMULATED_INTERNET,
): DnsRun {
  const settings = { ...scenario, ...overrides };

  const build: Build = {
    internet,
    nodes: [],
    links: [],
    seen: new Map(),
    linkIds: new Set(),
    events: [],
    pdus: {},
    phaseCounts: new Map(),
    group: '',
  };

  const resolutions: DnsResolution[] = [];
  let cache: DnsCache | undefined;
  let at = 0;

  scenario.lookups.forEach((lookup, lookupIndex) => {
    const resolution = resolve(internet, lookup.name, lookup.type, {
      startMs: at,
      // Every lookup gets its own stream, so adding a question to a scenario cannot
      // change which root server an earlier one happened to pick.
      seed: `${settings.seed}:${lookupIndex}`,
      ...(cache ? { cache } : {}),
      ...(settings.dnssec === undefined ? {} : { dnssec: settings.dnssec }),
      ...(settings.edns === undefined ? {} : { edns: settings.edns }),
      ...(settings.transport === undefined ? {} : { transport: settings.transport }),
      ...(settings.unresponsive === undefined
        ? {}
        : { unresponsive: settings.unresponsive }),
    });

    resolutions.push(resolution);
    cache = resolution.cache;
    // The next question does not follow the answer instantly; see DNS_GAP_MS.
    at = resolution.startedMs + resolution.elapsedMs + DNS_GAP_MS;

    const [stub, ...rungs] = resolution.steps;
    const index = `l${lookupIndex}`;

    trackPhase(build, stub, lookup, lookupIndex);
    emitStubQuery(build, stub, index);

    for (const step of rungs) {
      trackPhase(build, step, lookup, lookupIndex);
      if (step.to.tier === 'cache') emitCacheHit(build, step);
      else emitExchange(build, step, index);
    }

    // The closing chapter opens the moment the answer starts back down the last hop.
    build.group = `${lookupIndex}:answer`;
    openPhase(
      build,
      stub.startedMs + stub.durationMs - STUB_LATENCY_MS,
      'answer',
      phaseTextFor('answer', stub, lookup),
    );
    emitStubAnswer(build, stub, index);
  });

  // `at` has a gap on the end that belongs to a question nobody asked; the tail replaces
  // it, so the timeline stops a fixed distance after the last answer however many
  // lookups the scenario ran.
  const durationMs = at - DNS_GAP_MS + DNS_TAIL_MS;

  // Scenario notes are pinned by phase id, so the phases have to exist before the notes
  // can be placed -- hence one pass to find the boundaries and a second to fold them in.
  const asDeclared = Object.keys(overrides).length === 0;
  const provisional = summarizePhases(sortEvents(build.events), durationMs);
  for (const note of scenario.notes ?? []) {
    const phase = provisional.find((candidate) => candidate.id === note.phase);
    if (!phase) {
      // An override changed the shape of the run, which is what an override is for; a
      // note about a chapter that no longer happens is dropped rather than forced in.
      if (!asDeclared) continue;
      throw new Error(
        `scenario "${scenario.id}" pins a note to phase "${note.phase}", which this run does not have. It has: ${provisional.map((each) => each.id).join(', ')}`,
      );
    }
    build.events.push({
      kind: 'annotate',
      at: phase.startMs,
      targetId: note.target ?? RESOLVER_NODE,
      text: note.text,
      ...(note.reference ? { reference: note.reference } : {}),
    });
  }

  const events = sortEvents(build.events);

  return {
    topology: { nodes: build.nodes, links: build.links },
    result: {
      events,
      phases: summarizePhases(events, durationMs),
      durationMs,
      pdus: build.pdus,
    },
    resolutions,
    cache: cache ?? resolutions[resolutions.length - 1].cache,
  };
}
