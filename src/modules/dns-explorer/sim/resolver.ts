/**
 * The resolver -- the machine that actually does the work.
 *
 * A stub resolver, which is what an operating system contains, asks one question of one
 * server and waits. Everything interesting happens on the other side of that one
 * question, inside a **recursive resolver**, and this file is that: the loop that starts
 * at the root and walks down until something is authoritative for the name it was asked
 * about.
 *
 * ## The misconception this file exists to correct
 *
 * **The root server does not know the answer.** Nor does the TLD server. Ask a root
 * server for `www.example.com` and it returns a *referral* -- the NS records for `.com`,
 * plus the addresses of those nameservers in the additional section -- and nothing else.
 * The `.com` servers do the same for `example.com`. Only the last server in the chain has
 * ever heard of `www`, and only it answers. `lookupInZone` in `records.ts` enforces this:
 * a delegation is checked before any name match, so a root server *cannot* answer for a
 * name it has delegated away, however famous that name is.
 *
 * The second half of the same idea: the arrows are not all the same kind of arrow.
 * The stub's query has **RD set** -- recursion desired, "do this for me". Every query the
 * resolver then sends has **RD clear** -- these are *iterative* queries, and a root
 * server would refuse a recursive one anyway. One recursive query becomes three or four
 * iterative ones, and that asymmetry is the design.
 *
 * ## What else is modelled
 *
 * - **Glue, and its absence.** A delegation to a nameserver inside the zone being
 *   delegated is unfollowable without the parent also supplying its address, which is
 *   what glue is. A delegation to a nameserver *outside* it carries no glue, and the
 *   resolver has to break off and resolve that name first ({@link addressesFor}) -- a
 *   side quest that no simplified diagram of DNS shows and that most of the web needs.
 * - **The cache, and the route through it.** A warm resolver starts at the deepest
 *   delegation it remembers, so the second lookup skips the root and the TLD entirely.
 * - **UDP first, TCP when it must.** A response over 512 bytes comes back truncated and
 *   the whole query is re-sent over TCP (RFC 1035 s4.2.1).
 * - **Failure.** A server that does not answer, and the retry to its sibling. A name
 *   that does not exist, and how long that is remembered. A chain of trust that does not
 *   hold, and the SERVFAIL a validating resolver must return instead of the data.
 *
 * ## Determinism
 *
 * Every number comes from the fixtures or from a seeded {@link createRng}: transaction
 * ids, which root server is tried first, the jitter on each round trip. There is no
 * `Math.random()` and no `Date.now()` anywhere in this module, so the same question with
 * the same seed produces a deep-equal result -- which `resolver.test.ts` asserts.
 */

import { createRng, type Rng } from '@/core/sim/rng';
import type { RfcRef } from '@/core/types/events';

import {
  cacheDelegation,
  cacheLookup,
  cacheNegative,
  cachePositive,
  cachedCname,
  closestDelegation,
  createDnsCache,
  type CacheHit,
  type DnsCache,
} from './cache';
import { validateAnswer, type DnssecValidation } from './dnssec';
import {
  EDNS_UDP_PAYLOAD,
  NO_FLAGS,
  ROOT,
  UDP_MAX_PAYLOAD,
  ancestorsOf,
  answerFrom,
  displayName,
  groupRrsets,
  isInBailiwick,
  message,
  normalizeName,
  question,
  serverAt,
  zoneServing,
  type DnsMessage,
  type DnsQuestion,
  type NameServer,
  type Rcode,
  type ResourceRecord,
  type RrType,
  type SimulatedInternet,
  type ZoneResponse,
  type ZoneTier,
} from './records';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How a query is carried. The last two are DNS wrapped in something encrypted. */
export type DnsTransport =
  /** The default: one datagram out, one back, and no connection (RFC 1035 s4.2.1). */
  | 'udp'
  /** Used when a response will not fit in a datagram, and for zone transfers. */
  | 'tcp'
  /** DNS over HTTPS, RFC 8484. The phase-12 live tool uses this. */
  | 'doh'
  /** DNS over TLS, RFC 7858. */
  | 'dot';

/** Virtual milliseconds between a stub resolver and its recursive resolver, one way. */
export const STUB_LATENCY_MS = 1;

/** What answering from cache costs: a memory lookup, and effectively nothing else. */
export const CACHE_LOOKUP_MS = 1;

/** Virtual milliseconds a server spends deciding what to say. */
export const SERVER_PROCESSING_MS = 2;

/** How long the resolver waits before giving up on a server and trying its sibling. */
export const QUERY_TIMEOUT_MS = 1000;

/** The ceiling on queries for one name, after which the resolver gives up (SERVFAIL). */
export const MAX_QUERIES = 30;

/** How many aliases will be followed before the chain is declared a loop. */
export const MAX_CNAME_HOPS = 8;

/** How deep a "resolve this nameserver's address first" side quest may nest. */
export const MAX_NS_DEPTH = 3;

const RFC_1034: RfcRef = {
  rfc: 1034,
  section: '4.3.2',
  title: 'Domain Names -- Concepts and Facilities',
};
const RFC_1035_UDP: RfcRef = {
  rfc: 1035,
  section: '4.2.1',
  title: 'Domain Names -- Implementation and Specification',
};
const RFC_2308: RfcRef = {
  rfc: 2308,
  title: 'Negative Caching of DNS Queries (DNS NCACHE)',
};

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

/** Where something sits in the resolution ladder. */
export type ServerTier = 'stub' | 'recursive' | 'cache' | ZoneTier;

/** One end of an exchange, named so the ladder can label its rungs. */
export interface DnsEndpoint {
  /** What to call it on screen, e.g. `'root server'`. */
  readonly label: string;
  /** Its domain name, where it has one. */
  readonly name: string;
  /** The address the query is actually sent to. */
  readonly address: string;
  readonly tier: ServerTier;
}

/** Why a step happened -- the ladder groups by this. */
export type StepPurpose =
  /** The stub's single question, and the answer it eventually gets. */
  | 'stub'
  /** Part of resolving the name that was asked about. */
  | 'lookup'
  /** Resolving a *nameserver's* address, because the delegation carried no glue. */
  | 'ns-address'
  /** Fetching keys to validate with. */
  | 'dnssec';

/** What came back. */
export type StepOutcome =
  | 'referral'
  | 'answer'
  | 'cname'
  | 'nodata'
  | 'nxdomain'
  | 'refused'
  | 'servfail'
  | 'timeout'
  | 'truncated'
  | 'cache-hit';

/** One rung of the ladder: a query, and whatever came back. */
export interface ResolutionStep {
  readonly index: number;
  readonly purpose: StepPurpose;
  readonly from: DnsEndpoint;
  readonly to: DnsEndpoint;
  readonly query: DnsMessage;
  /** Absent when nothing came back at all -- that is what a timeout looks like. */
  readonly response?: DnsMessage;
  readonly outcome: StepOutcome;
  /**
   * Whether this query asked the other end to do the work.
   *
   * True for the stub's query and nothing else: the resolver's own queries are
   * iterative, which is why one lookup at the top becomes several below it.
   */
  readonly recursive: boolean;
  readonly transport: DnsTransport;
  readonly startedMs: number;
  readonly durationMs: number;
  /** How deep a nested nameserver lookup this is; 0 for the name that was asked about. */
  readonly depth: number;
  readonly note: string;
  readonly reference?: RfcRef;
}

// ---------------------------------------------------------------------------
// Options and result
// ---------------------------------------------------------------------------

/** How to run one resolution. */
export interface ResolveOptions {
  /** Virtual millisecond the stub asks its question. Defaults to 0. */
  readonly startMs?: number;
  /** A cache to start from -- this is what makes a run "warm". */
  readonly cache?: DnsCache;
  /** Seed for transaction ids, jitter, and server selection. */
  readonly seed?: number | string;
  /** Transport for the first attempt; UDP falls back to TCP on truncation. */
  readonly transport?: DnsTransport;
  /** Validate with DNSSEC, which sets DO on every query and costs extra lookups. */
  readonly dnssec?: boolean;
  /** Advertise EDNS(0), raising the UDP size limit from 512 to 1232 bytes. */
  readonly edns?: boolean;
  /** Servers that will not answer, by name or by address -- the timeout scenario. */
  readonly unresponsive?: readonly string[];
  readonly maxQueries?: number;
  /** Seconds since the epoch that DNSSEC signatures are judged against. */
  readonly validationTime?: number;
}

/** Everything one resolution produced. */
export interface DnsResolution {
  readonly question: DnsQuestion;
  readonly rcode: Rcode;
  /** The answer chain, aliases included, in the order a resolver would return them. */
  readonly answers: readonly ResourceRecord[];
  /** Just the addresses at the end of the chain -- what the application wanted. */
  readonly addresses: readonly string[];
  /** Every rung of the ladder, in the order they happened. */
  readonly steps: readonly ResolutionStep[];
  /** The cache as it stands afterwards; feed it back in to make the next run warm. */
  readonly cache: DnsCache;
  readonly startedMs: number;
  readonly elapsedMs: number;
  /** Exchanges with a real server -- zero when the whole thing came from cache. */
  readonly queryCount: number;
  /** True when no server was contacted at all. */
  readonly servedFromCache: boolean;
  /** Whether the root or a TLD server was contacted; false on a warm run. */
  readonly usedRootOrTld: boolean;
  /** The message the stub finally receives. */
  readonly response: DnsMessage;
  /** Present when `dnssec` was requested. */
  readonly validation?: DnssecValidation;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface ResolverContext {
  readonly internet: SimulatedInternet;
  readonly rng: Rng;
  readonly options: Required<
    Pick<ResolveOptions, 'transport' | 'dnssec' | 'edns' | 'maxQueries'>
  >;
  readonly unresponsive: ReadonlySet<string>;
  readonly steps: ResolutionStep[];
  readonly resolver: DnsEndpoint;
  readonly pending: Set<string>;
  cache: DnsCache;
  now: number;
  queryCount: number;
}

/** What one name resolved to, before aliases are stitched together. */
interface LookupResult {
  readonly kind: 'answer' | 'cname' | 'nodata' | 'nxdomain' | 'servfail';
  readonly records: readonly ResourceRecord[];
  readonly sigs: readonly ResourceRecord[];
  readonly target?: string;
  readonly note: string;
}

const STUB: DnsEndpoint = {
  label: 'stub resolver',
  name: 'client',
  // The client's own machine, on a private network (RFC 1918).
  address: '192.168.1.112',
  tier: 'stub',
};

const RECURSIVE: DnsEndpoint = {
  label: 'recursive resolver',
  name: 'resolver.example.net',
  // A documentation address (RFC 5737) standing in for a public resolver. Nothing in
  // this module ever sends a packet, and no real address appears here for that reason.
  address: '192.0.2.53',
  tier: 'recursive',
};

const CACHE_ENDPOINT: DnsEndpoint = {
  label: 'cache',
  name: 'cache',
  address: RECURSIVE.address,
  tier: 'cache',
};

function tierOf(internet: SimulatedInternet, origin: string): ZoneTier {
  const known = internet.byOrigin.get(origin);
  if (known) return known.tier;
  if (origin === ROOT) return 'root';
  return origin.includes('.') ? 'authoritative' : 'tld';
}

function labelFor(tier: ServerTier): string {
  switch (tier) {
    case 'root':
      return 'root server';
    case 'tld':
      return 'TLD server';
    case 'authoritative':
      return 'authoritative server';
    case 'cache':
      return 'cache';
    case 'recursive':
      return 'recursive resolver';
    case 'stub':
      return 'stub resolver';
  }
}

function endpointFor(
  internet: SimulatedInternet,
  address: string,
  zoneOrigin: string,
  fallbackName?: string,
): DnsEndpoint {
  const server = serverAt(internet, address);
  const tier = tierOf(internet, zoneOrigin);
  return {
    label: labelFor(tier),
    name: server?.name ?? fallbackName ?? address,
    address,
    tier,
  };
}

/** A transaction id, drawn from the seeded stream so a run always produces the same ones. */
function nextId(ctx: ResolverContext): number {
  return ctx.rng.int(65536);
}

/** Round trip time with a little deterministic jitter, so the ladder is not uniform. */
function tripTime(ctx: ResolverContext, address: string): number {
  const server = serverAt(ctx.internet, address);
  const base = server?.rttMs ?? 30;
  return Math.round(base * (0.9 + ctx.rng.next() * 0.2)) + SERVER_PROCESSING_MS;
}

function isUnresponsive(ctx: ResolverContext, address: string): boolean {
  if (ctx.unresponsive.has(address)) return true;
  const server = serverAt(ctx.internet, address);
  return Boolean(server && ctx.unresponsive.has(server.name));
}

/** The largest response this query can receive in one datagram. */
function udpLimit(ctx: ResolverContext): number {
  return ctx.options.edns ? EDNS_UDP_PAYLOAD : UDP_MAX_PAYLOAD;
}

function pushStep(
  ctx: ResolverContext,
  step: Omit<ResolutionStep, 'index'>,
): ResolutionStep {
  const withIndex = { ...step, index: ctx.steps.length };
  ctx.steps.push(withIndex);
  return withIndex;
}

/** The query the resolver puts on the wire: RD clear, because it is doing the work itself. */
function buildQuery(
  ctx: ResolverContext,
  q: DnsQuestion,
  recursive: boolean,
): DnsMessage {
  return message({
    id: nextId(ctx),
    flags: { ...NO_FLAGS, rd: recursive, do: ctx.options.dnssec },
    rcode: 'NOERROR',
    question: q,
  });
}

/** Turn a zone's reply into a response message, sizing it as it would be on the wire. */
function buildResponse(
  ctx: ResolverContext,
  query: DnsMessage,
  q: DnsQuestion,
  zoneResponse: ZoneResponse,
): DnsMessage {
  return message({
    id: query.id,
    flags: {
      ...NO_FLAGS,
      qr: true,
      aa: zoneResponse.authoritative,
      rd: query.flags.rd,
      // An authoritative server does not offer recursion; that is the resolver's job,
      // and one that does offer it to strangers is an open resolver.
      ra: false,
      do: ctx.options.dnssec,
    },
    rcode: zoneResponse.rcode,
    question: q,
    answer: zoneResponse.answer,
    authority: zoneResponse.authority,
    additional: zoneResponse.additional,
  });
}

interface Exchange {
  readonly step: ResolutionStep;
  readonly zoneResponse?: ZoneResponse;
  readonly response?: DnsMessage;
  /** The origin of the zone that answered, which bounds what may be cached. */
  readonly zoneOrigin?: string;
}

/**
 * Send one query to one server and take the consequences.
 *
 * Two of those consequences are steps of their own. A server that does not answer costs
 * a full timeout before the resolver moves on, and a response too large for a datagram
 * comes back with nothing in it but the TC bit -- so the same question is asked again
 * over TCP, which is the second rung the ladder shows.
 */
function exchange(
  ctx: ResolverContext,
  address: string,
  expectedZone: string,
  q: DnsQuestion,
  purpose: StepPurpose,
  depth: number,
): Exchange {
  const to = endpointFor(ctx.internet, address, expectedZone);
  const query = buildQuery(ctx, q, false);
  ctx.queryCount += 1;

  if (isUnresponsive(ctx, address)) {
    const step = pushStep(ctx, {
      purpose,
      from: ctx.resolver,
      to,
      query,
      outcome: 'timeout',
      recursive: false,
      transport: ctx.options.transport,
      startedMs: ctx.now,
      durationMs: QUERY_TIMEOUT_MS,
      depth,
      note: `no answer from ${to.name} -- the resolver waits ${QUERY_TIMEOUT_MS} ms and tries the next nameserver`,
    });
    ctx.now += QUERY_TIMEOUT_MS;
    return { step };
  }

  const zoneResponse = answerFrom(ctx.internet, address, q, {
    dnssec: ctx.options.dnssec,
  });
  const zoneOrigin = zoneServing(ctx.internet, address, q.name)?.origin;
  const response = buildResponse(ctx, query, q, zoneResponse);
  const duration = tripTime(ctx, address);

  // Only a datagram can be too small to hold the answer. Over TCP, and over the two
  // encrypted transports that run on top of it, the length is a 16-bit prefix instead.
  if (ctx.options.transport === 'udp' && response.sizeBytes > udpLimit(ctx)) {
    const truncated = message({
      id: query.id,
      flags: { ...response.flags, tc: true },
      rcode: 'NOERROR',
      question: q,
    });
    pushStep(ctx, {
      purpose,
      from: ctx.resolver,
      to,
      query,
      response: truncated,
      outcome: 'truncated',
      recursive: false,
      transport: 'udp',
      startedMs: ctx.now,
      durationMs: duration,
      depth,
      note: `the answer is ${response.sizeBytes} bytes and the datagram limit is ${udpLimit(ctx)} -- TC is set and the resolver must ask again over TCP`,
      reference: RFC_1035_UDP,
    });
    ctx.now += duration;

    // The retry is a new query with a new transaction id, over a connection this time,
    // which costs a handshake before anything is asked.
    const tcpQuery = buildQuery(ctx, q, false);
    const tcpResponse = { ...response, id: tcpQuery.id };
    const tcpDuration = duration * 2;
    const step = pushStep(ctx, {
      purpose,
      from: ctx.resolver,
      to,
      query: tcpQuery,
      response: tcpResponse,
      outcome: outcomeOf(zoneResponse),
      recursive: false,
      transport: 'tcp',
      startedMs: ctx.now,
      durationMs: tcpDuration,
      depth,
      note: `re-sent over TCP: a connection, then the same question, and ${response.sizeBytes} bytes come back whole`,
      reference: RFC_1035_UDP,
    });
    ctx.now += tcpDuration;
    ctx.queryCount += 1;
    return {
      step,
      zoneResponse,
      response: tcpResponse,
      ...(zoneOrigin ? { zoneOrigin } : {}),
    };
  }

  const step = pushStep(ctx, {
    purpose,
    from: ctx.resolver,
    to,
    query,
    response,
    outcome: outcomeOf(zoneResponse),
    recursive: false,
    transport: ctx.options.transport,
    startedMs: ctx.now,
    durationMs: duration,
    depth,
    note: zoneResponse.note,
    ...(zoneResponse.outcome === 'referral' ? { reference: RFC_1034 } : {}),
  });
  ctx.now += duration;
  return { step, zoneResponse, response, ...(zoneOrigin ? { zoneOrigin } : {}) };
}

function outcomeOf(zoneResponse: ZoneResponse): StepOutcome {
  switch (zoneResponse.outcome) {
    case 'answer':
      return 'answer';
    case 'referral':
      return 'referral';
    case 'cname':
      return 'cname';
    case 'nodata':
      return 'nodata';
    case 'nxdomain':
      return 'nxdomain';
    case 'refused':
      return 'refused';
  }
}

/** A cache hit is a rung too -- an exchange with memory instead of with a server. */
function cacheStep(
  ctx: ResolverContext,
  q: DnsQuestion,
  hit: CacheHit,
  depth: number,
): void {
  const query = buildQuery(ctx, q, false);
  const response = message({
    id: query.id,
    flags: { ...NO_FLAGS, qr: true, ra: true, do: ctx.options.dnssec },
    rcode: hit.entry.rcode,
    question: q,
    answer: hit.records,
    authority: hit.entry.soa ? [hit.entry.soa] : [],
  });
  pushStep(ctx, {
    purpose: 'lookup',
    from: ctx.resolver,
    to: CACHE_ENDPOINT,
    query,
    response,
    outcome: 'cache-hit',
    recursive: false,
    transport: ctx.options.transport,
    startedMs: ctx.now,
    durationMs: CACHE_LOOKUP_MS,
    depth,
    note:
      hit.entry.kind === 'positive'
        ? `answered from cache with ${hit.remaining}s of TTL left -- no server was contacted`
        : `a remembered ${hit.entry.kind.toUpperCase()}, ${hit.remaining}s before the resolver will ask again`,
    ...(hit.entry.kind === 'positive' ? {} : { reference: RFC_2308 }),
  });
  ctx.now += CACHE_LOOKUP_MS;
}

/** Cache every RRset in an answer that the answering zone is actually entitled to. */
function cacheAnswer(
  ctx: ResolverContext,
  records: readonly ResourceRecord[],
  zoneOrigin: string,
): void {
  for (const set of groupRrsets(records)) {
    // Signatures are stored with the data they cover rather than as entries of their
    // own, because they expire with it and are useless without it.
    if (set.type === 'RRSIG') continue;
    // Anything outside the answering zone's bailiwick is dropped on the floor. That one
    // check is what stops a server answering the question it was asked and slipping in
    // an answer to a question it was not.
    if (!isInBailiwick(set.name, zoneOrigin)) continue;

    const sigs = records.filter(
      (record) =>
        record.name === set.name &&
        record.data.type === 'RRSIG' &&
        record.data.typeCovered === set.type,
    );
    ctx.cache = cachePositive(ctx.cache, {
      name: set.name,
      type: set.type,
      records: [...set.records, ...sigs],
      now: ctx.now,
    });
  }
}

/** The zone one level up that this fixture set actually holds. */
function parentZoneOf(internet: SimulatedInternet, origin: string) {
  for (const candidate of ancestorsOf(origin)) {
    const found = internet.byOrigin.get(candidate);
    if (found) return found;
  }
  return undefined;
}

/** Addresses to try, ordered by which server has been the fastest to answer. */
function orderByRtt(internet: SimulatedInternet, addresses: readonly string[]): string[] {
  return [...addresses].sort((a, b) => {
    const left = serverAt(internet, a)?.rttMs ?? Number.POSITIVE_INFINITY;
    const right = serverAt(internet, b)?.rttMs ?? Number.POSITIVE_INFINITY;
    return left - right;
  });
}

/** The root hints, with the first one picked from the seeded stream as a real resolver would. */
function rootAddresses(ctx: ResolverContext): string[] {
  const hints: readonly NameServer[] = ctx.internet.rootHints;
  if (hints.length === 0) return [];
  const first = ctx.rng.int(hints.length);
  const rest = hints.filter((_, index) => index !== first).map((server) => server.ipv4);
  return [hints[first].ipv4, ...rest];
}

/**
 * Find addresses for a set of nameserver names.
 *
 * Glue first, then the cache, and only then the side quest: a full recursive resolution
 * of the nameserver's own name, which is what a glue-less delegation costs. `ns-address`
 * steps in the ladder are always this, and they are why a domain hosted on a managed DNS
 * provider takes more work to look up the first time than one whose nameservers live
 * inside itself.
 */
function addressesFor(
  ctx: ResolverContext,
  serverNames: readonly string[],
  glue: readonly ResourceRecord[],
  depth: number,
): string[] {
  const found: string[] = [];

  for (const record of glue) {
    if (record.data.type !== 'A') continue;
    if (!serverNames.includes(record.name)) continue;
    found.push(record.data.address);
  }
  if (found.length > 0) return orderByRtt(ctx.internet, found);

  for (const serverName of serverNames) {
    const hit = cacheLookup(ctx.cache, serverName, 'A', ctx.now);
    if (!hit) continue;
    for (const record of hit.records) {
      if (record.data.type === 'A') found.push(record.data.address);
    }
  }
  if (found.length > 0) return orderByRtt(ctx.internet, found);

  if (depth >= MAX_NS_DEPTH) return [];

  for (const serverName of serverNames) {
    if (ctx.pending.has(serverName)) continue; // A nameserver that needs itself resolved.
    const nested = resolveChain(ctx, serverName, 'A', depth + 1, 'ns-address');
    for (const record of nested.answers) {
      if (record.data.type === 'A') found.push(record.data.address);
    }
    if (found.length > 0) break;
  }
  return orderByRtt(ctx.internet, found);
}

/**
 * Resolve one name and one type: the loop from the root down to whoever is authoritative.
 *
 * Aliases are *not* followed here -- a CNAME is returned as a CNAME, and
 * {@link resolveChain} decides what to do about it. Keeping the two apart is what makes
 * "the resolver started again from the top for a name in another zone" visible instead of
 * a detail buried in a loop.
 */
function resolveOnce(
  ctx: ResolverContext,
  name: string,
  type: RrType,
  depth: number,
  purpose: StepPurpose,
): LookupResult {
  // 1. The cache, which is the whole point of having one.
  const hit = cacheLookup(ctx.cache, name, type, ctx.now);
  if (hit) {
    cacheStep(ctx, question(name, type), hit, depth);
    if (hit.entry.kind === 'nxdomain') {
      return { kind: 'nxdomain', records: [], sigs: [], note: 'remembered NXDOMAIN' };
    }
    if (hit.entry.kind === 'nodata') {
      return { kind: 'nodata', records: [], sigs: [], note: 'remembered NODATA' };
    }
    // Signatures were cached with the data, so a warm run can still validate.
    return {
      kind: 'answer',
      records: hit.records,
      sigs: hit.records.filter((record) => record.type === 'RRSIG'),
      note: 'answered from cache',
    };
  }

  if (type !== 'CNAME') {
    const alias = cachedCname(ctx.cache, name, ctx.now);
    if (alias) {
      cacheStep(ctx, question(name, type), alias, depth);
      const target =
        alias.records[0]?.data.type === 'CNAME' ? alias.records[0].data.target : name;
      return {
        kind: 'cname',
        records: alias.records,
        sigs: [],
        target,
        note: 'the alias was cached; the target still has to be resolved',
      };
    }
  }

  // 2. Where to start: the deepest delegation still in the cache, or the root.
  const delegation = closestDelegation(ctx.cache, name, ctx.now);
  let currentZone = delegation?.zone ?? ROOT;
  let addresses: string[];
  if (delegation) {
    addresses =
      delegation.addresses.length > 0
        ? orderByRtt(
            ctx.internet,
            delegation.addresses.map((entry) => entry.address),
          )
        : addressesFor(ctx, delegation.serverNames, [], depth);
  } else {
    addresses = rootAddresses(ctx);
  }

  const q = question(name, type);
  ctx.pending.add(name);

  try {
    for (let hop = 0; hop < ctx.options.maxQueries; hop += 1) {
      if (ctx.queryCount >= ctx.options.maxQueries) {
        return {
          kind: 'servfail',
          records: [],
          sigs: [],
          note: `gave up after ${ctx.queryCount} queries`,
        };
      }
      if (addresses.length === 0) {
        return {
          kind: 'servfail',
          records: [],
          sigs: [],
          note: 'no reachable nameserver for this zone',
        };
      }

      // Try each server in turn; a timeout costs a full second and moves on to the next.
      let result: Exchange | undefined;
      for (const address of addresses) {
        const attempt = exchange(ctx, address, currentZone, q, purpose, depth);
        if (attempt.zoneResponse) {
          result = attempt;
          break;
        }
      }
      if (!result?.zoneResponse) {
        return {
          kind: 'servfail',
          records: [],
          sigs: [],
          note: 'every nameserver for this zone timed out',
        };
      }

      const zoneResponse = result.zoneResponse;
      const zoneOrigin = result.zoneOrigin ?? currentZone;

      switch (zoneResponse.outcome) {
        case 'referral': {
          const delegated = zoneResponse.delegation ?? '';
          const ns = zoneResponse.authority.filter((record) => record.type === 'NS');
          const serverNames = ns
            .map((record) => (record.data.type === 'NS' ? record.data.nameserver : ''))
            .filter((serverName) => serverName.length > 0);

          ctx.cache = cacheDelegation(ctx.cache, {
            zone: delegated,
            ns,
            glue: zoneResponse.additional,
            now: ctx.now,
          });

          // A referral must move down the tree. One that does not is a loop, and a real
          // resolver treats it the same way: it stops.
          if (!isInBailiwick(name, delegated) || delegated.length <= currentZone.length) {
            return {
              kind: 'servfail',
              records: [],
              sigs: [],
              note: 'the referral did not move closer to the name',
            };
          }

          currentZone = delegated;
          addresses = addressesFor(ctx, serverNames, zoneResponse.additional, depth);
          continue;
        }
        case 'answer': {
          cacheAnswer(ctx, zoneResponse.answer, zoneOrigin);
          const sigs = zoneResponse.answer.filter((record) => record.type === 'RRSIG');
          return {
            kind: 'answer',
            records: zoneResponse.answer,
            sigs,
            note: zoneResponse.note,
          };
        }
        case 'cname': {
          cacheAnswer(ctx, zoneResponse.answer, zoneOrigin);
          return {
            kind: 'cname',
            records: zoneResponse.answer,
            sigs: zoneResponse.answer.filter((record) => record.type === 'RRSIG'),
            ...(zoneResponse.target ? { target: zoneResponse.target } : {}),
            note: zoneResponse.note,
          };
        }
        case 'nodata':
        case 'nxdomain': {
          // The SOA in the authority section is not decoration: it is the permission
          // slip that says how long this "no" may be remembered (RFC 2308).
          ctx.cache = cacheNegative(ctx.cache, {
            name,
            type,
            kind: zoneResponse.outcome,
            soa: zoneResponse.soa,
            now: ctx.now,
          });
          return {
            kind: zoneResponse.outcome,
            records: [],
            sigs: [],
            note: zoneResponse.note,
          };
        }
        case 'refused': {
          return {
            kind: 'servfail',
            records: [],
            sigs: [],
            note: 'the server refused to answer for that name',
          };
        }
      }
    }

    return { kind: 'servfail', records: [], sigs: [], note: 'too many referrals' };
  } finally {
    ctx.pending.delete(name);
  }
}

/** What a full chain of aliases resolved to. */
interface ChainResult {
  readonly rcode: Rcode;
  readonly answers: readonly ResourceRecord[];
  readonly sigs: readonly ResourceRecord[];
  /** The name the chain ended at, which is what DNSSEC has to validate. */
  readonly finalName: string;
  readonly note: string;
}

/**
 * Follow a name through however many aliases it takes.
 *
 * Each hop is a fresh resolution, and a hop that leaves the zone starts again from the
 * closest delegation the cache knows -- which for a CNAME pointing at a CDN in another
 * TLD means starting again at the root. That restart is the cost of a CNAME, and it is
 * why an alias at the apex of a busy domain is a performance decision and not just a
 * naming one.
 */
function resolveChain(
  ctx: ResolverContext,
  name: string,
  type: RrType,
  depth: number,
  purpose: StepPurpose,
): ChainResult {
  const answers: ResourceRecord[] = [];
  let current = normalizeName(name);

  for (let hop = 0; hop <= MAX_CNAME_HOPS; hop += 1) {
    const result = resolveOnce(ctx, current, type, depth, purpose);
    answers.push(...result.records);

    switch (result.kind) {
      case 'answer':
        return {
          rcode: 'NOERROR',
          answers,
          sigs: result.sigs,
          finalName: current,
          note: result.note,
        };
      case 'nodata':
        return {
          rcode: 'NOERROR',
          answers,
          sigs: [],
          finalName: current,
          note: result.note,
        };
      case 'nxdomain':
        return {
          rcode: 'NXDOMAIN',
          answers,
          sigs: [],
          finalName: current,
          note: result.note,
        };
      case 'servfail':
        return {
          rcode: 'SERVFAIL',
          answers,
          sigs: [],
          finalName: current,
          note: result.note,
        };
      case 'cname': {
        // The server may have chased the alias as far as its own zone reaches; if the
        // requested type is already in what came back, the chain is finished.
        const done = result.records.some((record) => record.type === type);
        if (done) {
          return {
            rcode: 'NOERROR',
            answers,
            sigs: result.sigs,
            finalName: result.target ?? current,
            note: result.note,
          };
        }
        if (!result.target) {
          return {
            rcode: 'SERVFAIL',
            answers,
            sigs: [],
            finalName: current,
            note: 'alias with no target',
          };
        }
        current = result.target;
      }
    }
  }

  return {
    rcode: 'SERVFAIL',
    answers,
    sigs: [],
    finalName: current,
    note: `more than ${MAX_CNAME_HOPS} aliases -- treated as a loop`,
  };
}

/** The extra round trips validation costs, shown as rungs of their own. */
function emitDnssecSteps(
  ctx: ResolverContext,
  validation: DnssecValidation,
  depth: number,
): void {
  for (const query of validation.queries) {
    // A DS record lives on the *parent's* side of the zone cut, so that is who is asked
    // for it. Asking the child would get NODATA, which is exactly the confusion the
    // split is there to avoid.
    const target =
      query.type === 'DS'
        ? parentZoneOf(ctx.internet, query.zone)
        : ctx.internet.byOrigin.get(query.zone);
    const server = target?.nameservers[0];
    if (!server) continue;

    const q = question(query.zone, query.type);
    const queryMessage = buildQuery(ctx, q, false);
    const zoneResponse = answerFrom(ctx.internet, server.ipv4, q, { dnssec: true });
    const response = buildResponse(ctx, queryMessage, q, zoneResponse);
    const duration = tripTime(ctx, server.ipv4);

    pushStep(ctx, {
      purpose: 'dnssec',
      from: ctx.resolver,
      to: endpointFor(ctx.internet, server.ipv4, target.origin),
      query: queryMessage,
      response,
      outcome: outcomeOf(zoneResponse),
      recursive: false,
      transport: ctx.options.transport,
      startedMs: ctx.now,
      durationMs: duration,
      depth,
      note: query.note,
      reference: {
        rfc: 4035,
        title: 'Protocol Modifications for the DNS Security Extensions',
      },
    });
    ctx.now += duration;
    ctx.queryCount += 1;
  }
}

// ---------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------

/**
 * Resolve one name, the way a recursive resolver would.
 *
 * The returned {@link DnsResolution} is a complete, deterministic record of the walk:
 * every query, every response, the cache as it ended up, and how long the whole thing
 * took in virtual milliseconds. Nothing here touches a network, and nothing can: the
 * only source of answers is the fixture set in `records.ts`.
 */
export function resolve(
  internet: SimulatedInternet,
  name: string,
  type: RrType = 'A',
  options: ResolveOptions = {},
): DnsResolution {
  const startedMs = options.startMs ?? 0;
  const q = question(name, type);

  const ctx: ResolverContext = {
    internet,
    rng: createRng(options.seed ?? `dns:${q.name}:${q.type}`),
    options: {
      transport: options.transport ?? 'udp',
      dnssec: options.dnssec ?? false,
      edns: options.edns ?? false,
      maxQueries: options.maxQueries ?? MAX_QUERIES,
    },
    unresponsive: new Set(options.unresponsive ?? []),
    steps: [],
    resolver: RECURSIVE,
    pending: new Set(),
    cache: options.cache ?? createDnsCache(),
    // The stub's question has to reach the resolver before any of this can start.
    now: startedMs + STUB_LATENCY_MS,
    queryCount: 0,
  };

  const chain = resolveChain(ctx, q.name, q.type, 0, 'lookup');

  let rcode = chain.rcode;
  let answers = chain.answers;
  let validation: DnssecValidation | undefined;

  if (ctx.options.dnssec && rcode !== 'SERVFAIL') {
    const finalRecords = chain.answers.filter(
      (record) => record.type === q.type && record.name === chain.finalName,
    );
    validation = validateAnswer(
      internet,
      {
        name: chain.finalName,
        type: q.type,
        records: finalRecords,
        sigs: chain.sigs,
      },
      options.validationTime === undefined ? {} : { at: options.validationTime },
    );
    emitDnssecSteps(ctx, validation, 0);

    if (validation.state === 'bogus') {
      // RFC 4035 s5.5: a validating resolver hands back nothing at all rather than data
      // it cannot vouch for. This is why one broken signature takes a domain off the
      // Internet for everyone behind a validating resolver, and nobody else.
      rcode = 'SERVFAIL';
      answers = [];
    }
  }

  const response = message({
    id: ctx.rng.int(65536),
    flags: {
      ...NO_FLAGS,
      qr: true,
      rd: true,
      ra: true,
      ad: validation?.state === 'secure',
      do: ctx.options.dnssec,
    },
    rcode,
    question: q,
    answer: answers,
  });

  // The stub's own exchange encloses everything above: one question, one answer, and a
  // wait in between however long the walk took.
  const walkMs = ctx.now - (startedMs + STUB_LATENCY_MS);
  const totalMs = walkMs + STUB_LATENCY_MS * 2;
  const stubStep: ResolutionStep = {
    index: 0,
    purpose: 'stub',
    from: STUB,
    to: RECURSIVE,
    query: message({
      id: response.id,
      // The one recursive query in the whole run: RD set, "do this for me".
      flags: { ...NO_FLAGS, rd: true, do: ctx.options.dnssec },
      rcode: 'NOERROR',
      question: q,
    }),
    response,
    outcome:
      rcode === 'NXDOMAIN'
        ? 'nxdomain'
        : rcode === 'SERVFAIL'
          ? 'servfail'
          : answers.length > 0
            ? 'answer'
            : 'nodata',
    recursive: true,
    transport: ctx.options.transport,
    startedMs,
    durationMs: totalMs,
    depth: 0,
    note:
      ctx.queryCount === 0
        ? 'the resolver already knew the answer; nothing left the building'
        : `the resolver asked ${ctx.queryCount} questions of its own to answer this one`,
    reference: RFC_1034,
  };

  const steps = [
    stubStep,
    ...ctx.steps.map((step, index) => ({ ...step, index: index + 1 })),
  ];

  const addresses = answers
    .filter((record) => record.data.type === 'A' || record.data.type === 'AAAA')
    .map((record) =>
      record.data.type === 'A' || record.data.type === 'AAAA' ? record.data.address : '',
    );

  return {
    question: q,
    rcode,
    answers,
    addresses,
    steps,
    cache: ctx.cache,
    startedMs,
    elapsedMs: totalMs,
    queryCount: ctx.queryCount,
    servedFromCache: ctx.queryCount === 0,
    usedRootOrTld: steps.some(
      (step) => step.to.tier === 'root' || step.to.tier === 'tld',
    ),
    response,
    ...(validation ? { validation } : {}),
  };
}

/** One line per rung, which is what the event log and most tests want. */
export function describeSteps(resolution: DnsResolution): string[] {
  return resolution.steps.map((step) => {
    const where = `${step.from.label} -> ${step.to.label}`;
    const what = `${displayName(step.query.question.name)} ${step.query.question.type}`;
    return `${step.startedMs}ms ${where} ${what} [${step.outcome}] ${step.note}`;
  });
}
