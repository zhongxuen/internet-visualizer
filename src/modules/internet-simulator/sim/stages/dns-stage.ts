/**
 * Stage 3 -- the name becomes an address.
 *
 * Every line of resolution logic here comes from `@/core/protocols/dns`: `resolve()` walks
 * root to TLD to authoritative, follows referrals and aliases, honours TTLs, and answers
 * NXDOMAIN when the simulated hierarchy has never heard of the name. This stage adds two
 * things and nothing else.
 *
 * **A place on the diagram.** The resolver's ladder is a list of exchanges between named
 * servers; a page load is drawn on four or five machines. So each rung is mapped onto a
 * node by its tier, and a node appears only if this particular walk actually reached it --
 * which is why a warm run's diagram has a resolver on it and no root server at all, and
 * why that difference needs no caption.
 *
 * **A place on this run's clock.** The bundled zones carry their own round-trip times of
 * roughly 25 ms, because the DNS Explorer needed plausible absolute numbers. Here the
 * numbers have to move with the network-profile control, so every step that really crossed
 * the network is scaled by `profile.rttMs / DNS_BASELINE_RTT_MS` and every step that was
 * answered out of the resolver's own memory is left alone. A cache lookup does not get
 * slower on satellite, and pretending otherwise would break the one comparison this stage
 * exists to make.
 *
 * The warm case is modelled as *the same question asked twice*, exactly as the DNS Explorer
 * models it: the first walk fills the cache, the second is the one on the timeline. A cache
 * full of entries nobody watched arrive is a claim; a previous lookup is that claim
 * demonstrated.
 */

import {
  resolve,
  type DnsResolution,
  type ResolutionStep,
  type ServerTier,
} from '@/core/protocols/dns/resolver';
import {
  describeFlags,
  displayName,
  recordText,
  SIMULATED_INTERNET,
  type DnsMessage,
} from '@/core/protocols/dns/records';
import type { DnsCache } from '@/core/protocols/dns/cache';
import type { RfcRef, SimEvent } from '@/core/types/events';
import type { PDU } from '@/core/types/pdu';

import {
  BROWSER_NODE,
  DNS_AUTH_NODE,
  DNS_ROOT_NODE,
  DNS_TLD_NODE,
  linkId,
  requireState,
  RESOLVER_NODE,
  round2,
  type Stage,
  type StageOutput,
} from '../stage';

/**
 * The round trip the bundled zone fixtures were written against.
 *
 * `records.ts` gives its servers times between 18 and 29 ms. Dividing this run's profile
 * by that baseline is what lets the same protocol walk take 8 ms on fiber and 600 ms on
 * satellite without the resolver knowing either number exists.
 */
export const DNS_BASELINE_RTT_MS = 25;

const RFC_1034: RfcRef = {
  rfc: 1034,
  section: '4.3.2',
  title: 'Domain Names -- Concepts and Facilities',
};
const RFC_2308: RfcRef = {
  rfc: 2308,
  title: 'Negative Caching of DNS Queries (DNS NCACHE)',
};

/** Which node on the page-load diagram a rung of the ladder happens at. */
function nodeForTier(tier: ServerTier): string {
  switch (tier) {
    case 'stub':
      return BROWSER_NODE;
    case 'recursive':
    case 'cache':
      return RESOLVER_NODE;
    case 'root':
      return DNS_ROOT_NODE;
    case 'tld':
      return DNS_TLD_NODE;
    case 'authoritative':
      return DNS_AUTH_NODE;
  }
}

/** One rung, placed on this run's timeline and on this run's diagram. */
export interface DnsHop {
  readonly index: number;
  readonly step: ResolutionStep;
  readonly fromNode: string;
  readonly toNode: string;
  /** Local virtual millisecond the query leaves. */
  readonly startedMs: number;
  /** Local virtual milliseconds the whole exchange took, after profile scaling. */
  readonly durationMs: number;
  /** True when the resolver answered itself and nothing went on a wire. */
  readonly local: boolean;
}

/** What the DNS stage established. */
export interface DnsResult {
  readonly resolution: DnsResolution;
  /** The addresses the connection will be made to. Empty on failure. */
  readonly addresses: readonly string[];
  readonly hops: readonly DnsHop[];
  /** True when the resolver answered from its own memory without asking anyone. */
  readonly servedFromCache: boolean;
  /** Exchanges with a real server. Zero on a fully warm run. */
  readonly queryCount: number;
  /** The resolver's cache afterwards -- what a subsequent visit would start from. */
  readonly cache: DnsCache;
  /** The nodes this walk actually touched, so the topology can drop the rest. */
  readonly nodesTouched: readonly string[];
  /** How much this run's timings were stretched or compressed relative to the fixtures. */
  readonly scale: number;
}

/** A one-line summary of a DNS message, in the style `dig` prints. */
function messageSummary(message: DnsMessage): string {
  const head = `${displayName(message.question.name)} ${message.question.type}`;
  if (message.answer.length > 0) {
    return `${head} -> ${message.answer.map(recordText).join(', ')}`;
  }
  if (message.authority.length > 0) {
    return `${head} -> ${message.rcode === 'NOERROR' ? 'referral' : message.rcode}`;
  }
  return head;
}

/** A DNS message on the wire: the transport it rides in, and the message itself. */
function dnsPdu(
  id: string,
  message: DnsMessage,
  transport: string,
  direction: 'query' | 'response',
): PDU {
  return {
    id,
    layers: [
      {
        layer: 'transport',
        protocol: transport.toUpperCase(),
        fields: [
          {
            name: 'Destination Port',
            value: direction === 'query' ? '53' : 'ephemeral',
            bits: 16,
            note: 'Port 53 is DNS. A query goes to it; the answer comes back to the port the query came from.',
          },
          { name: 'Length', value: `${message.sizeBytes} bytes`, bits: 16 },
        ],
      },
      {
        layer: 'application',
        protocol: 'DNS',
        fields: [
          {
            name: 'Transaction ID',
            value: `0x${message.id.toString(16).padStart(4, '0')}`,
            bits: 16,
            note: 'Matches an answer to its question. Over UDP it is most of what stops an off-path attacker from answering first.',
          },
          {
            name: 'Flags',
            value: describeFlags(message.flags) || '(none set)',
            bits: 16,
          },
          { name: 'Rcode', value: message.rcode, bits: 4 },
          {
            name: 'Question',
            value: `${displayName(message.question.name)} ${message.question.type}`,
          },
          { name: 'Answer RRs', value: `${message.answer.length}` },
          { name: 'Authority RRs', value: `${message.authority.length}` },
          { name: 'Additional RRs', value: `${message.additional.length}` },
        ],
        payloadPreview: messageSummary(message),
      },
    ],
    sizeBytes: message.sizeBytes,
    summary: `DNS ${direction} ${messageSummary(message)}`,
  };
}

/**
 * Whether a rung really crossed the Internet, and so should move with the profile.
 *
 * Two kinds of rung do not. A cache hit is a memory lookup and does not get slower on a
 * satellite link. And the stub's question to its own recursive resolver is a hop across the
 * local network -- the resolver is on the diagram one short link away, at
 * `RESOLVER_LATENCY_MS` -- so it does not scale with the round trip to the far side of the
 * Internet either. Scaling either of them would make a warm run look expensive on a slow
 * link, which is the opposite of what a warm run demonstrates.
 */
function crossedTheNetwork(step: ResolutionStep): boolean {
  if (step.outcome === 'cache-hit') return false;
  return step.to.tier !== 'cache' && step.to.tier !== 'recursive';
}

/** Resolve the host, on this run's clock and this run's diagram. */
export const dnsStage: Stage = (context): StageOutput => {
  const url = requireState(context.state, 'url', 'dns');
  const scenario = context.scenario;
  const spec = scenario.dns ?? {};
  const seed = `${scenario.id}:dns:${url.host}`;

  // A warm resolver is one that has been asked before. Run the priming lookup, keep only
  // the cache it produced, and put the second ask on the timeline.
  const primed = spec.warm
    ? resolve(SIMULATED_INTERNET, url.host, 'A', {
        seed,
        dnssec: spec.dnssec ?? false,
        ...(spec.unresponsive ? { unresponsive: spec.unresponsive } : {}),
      })
    : undefined;

  const resolution = resolve(SIMULATED_INTERNET, url.host, 'A', {
    startMs: 0,
    seed,
    dnssec: spec.dnssec ?? false,
    ...(primed ? { cache: primed.cache } : {}),
    ...(spec.unresponsive ? { unresponsive: spec.unresponsive } : {}),
  });

  const scale = round2(context.profile.rttMs / DNS_BASELINE_RTT_MS);
  const hops: DnsHop[] = [];
  const events: SimEvent[] = [];
  const pdus: Record<string, PDU> = {};
  const nodesTouched = new Set<string>([BROWSER_NODE, RESOLVER_NODE]);

  events.push({
    kind: 'phase',
    at: 0,
    id: 'dns',
    title: 'Resolve the name',
    description: resolution.servedFromCache
      ? 'The resolver has been asked this before and the answer has not expired, so it replies from memory.'
      : 'The browser asks its resolver, which walks down from the root: the root refers it to the TLD servers, they refer it to the zone’s own servers, and only the last of those actually knows the address.',
  });

  let clock = 0;
  resolution.steps.forEach((step, index) => {
    const fromNode = nodeForTier(step.from.tier);
    const toNode = nodeForTier(step.to.tier);
    const local = !crossedTheNetwork(step) || fromNode === toNode;
    const duration = local ? step.durationMs : round2(step.durationMs * scale);
    const oneWay = round2(duration / 2);

    nodesTouched.add(fromNode);
    if (!local) nodesTouched.add(toNode);

    if (local) {
      events.push({
        kind: 'node-state',
        at: clock,
        nodeId: fromNode,
        state: 'processing',
        note: step.outcome === 'cache-hit' ? 'cache hit' : step.outcome,
      });
      events.push({
        kind: 'log',
        at: clock,
        level: 'info',
        text: `${step.from.label}: ${step.note}`,
      });
    } else {
      const queryId = `dns-q${index}`;
      const query = dnsPdu(queryId, step.query, step.transport, 'query');
      pdus[queryId] = query;
      events.push({ kind: 'pdu-created', at: clock, pdu: query, atNode: fromNode });
      events.push({
        kind: 'node-state',
        at: clock,
        nodeId: toNode,
        state: 'active',
        note: step.purpose === 'ns-address' ? 'nameserver lookup' : step.purpose,
      });
      events.push({
        kind: 'transmit',
        at: clock,
        pduId: queryId,
        from: fromNode,
        to: toNode,
        durationMs: oneWay,
        linkId: linkId(fromNode, toNode),
      });

      if (step.response) {
        const responseId = `dns-r${index}`;
        const answer = dnsPdu(responseId, step.response, step.transport, 'response');
        pdus[responseId] = answer;
        events.push({
          kind: 'pdu-created',
          at: round2(clock + oneWay),
          pdu: answer,
          atNode: toNode,
        });
        events.push({
          kind: 'transmit',
          at: round2(clock + oneWay),
          pduId: responseId,
          from: toNode,
          to: fromNode,
          durationMs: oneWay,
          linkId: linkId(fromNode, toNode),
        });
      } else {
        events.push({
          kind: 'drop',
          at: round2(clock + oneWay),
          pduId: queryId,
          atNode: toNode,
          reason: `${step.to.label} did not answer; the resolver waits out its timeout and tries a sibling.`,
        });
      }

      events.push({
        kind: 'log',
        at: round2(clock + duration),
        level: step.outcome === 'timeout' ? 'warn' : 'info',
        text: `${step.from.label} -> ${step.to.label}: ${step.note}`,
      });
    }

    if (step.reference && index < 3) {
      events.push({
        kind: 'annotate',
        at: round2(clock + duration),
        targetId: local ? fromNode : toNode,
        text: step.note,
        reference: step.reference,
      });
    }

    hops.push({
      index,
      step,
      fromNode,
      toNode,
      startedMs: clock,
      durationMs: duration,
      local,
    });
    clock = round2(clock + duration);
  });

  events.push({
    kind: 'node-state',
    at: clock,
    nodeId: RESOLVER_NODE,
    state: 'idle',
  });

  const failed = resolution.rcode !== 'NOERROR' || resolution.addresses.length === 0;

  if (!failed) {
    events.push({
      kind: 'log',
      at: clock,
      level: 'info',
      text: `${displayName(url.host)} is ${resolution.addresses.join(', ')} (${resolution.queryCount} ${
        resolution.queryCount === 1 ? 'query' : 'queries'
      }, ${clock} ms).`,
    });
    events.push({
      kind: 'annotate',
      at: clock,
      targetId: RESOLVER_NODE,
      text: resolution.servedFromCache
        ? 'Nothing left this machine’s network. Everything below now costs what it costs; this stage cost a memory lookup, which is the whole argument for caching.'
        : `${resolution.queryCount} queries, and the browser has still not asked for the page. DNS is a prerequisite, not part of the request -- which is why it shows up as its own segment in a devtools waterfall.`,
      reference: RFC_1034,
    });
  }

  const result: DnsResult = {
    resolution,
    addresses: resolution.addresses,
    hops,
    servedFromCache: resolution.servedFromCache,
    queryCount: resolution.queryCount,
    cache: resolution.cache,
    nodesTouched: [...nodesTouched],
    scale,
  };

  if (failed) {
    const nxdomain = resolution.rcode === 'NXDOMAIN';
    events.push({ kind: 'node-state', at: clock, nodeId: BROWSER_NODE, state: 'error' });
    events.push({
      kind: 'log',
      at: clock,
      level: 'error',
      text: `Resolution failed: ${resolution.rcode}. There is no address to connect to.`,
    });

    return {
      events,
      pdus,
      durationMs: clock,
      summary: nxdomain ? 'NXDOMAIN' : resolution.rcode,
      state: { dns: result },
      failure: {
        code: nxdomain ? 'DNS_PROBE_FINISHED_NXDOMAIN' : 'DNS_PROBE_FINISHED_BAD_CONFIG',
        title: 'This site can’t be reached',
        message: `${displayName(url.host)}’s server IP address could not be found.`,
        explanation: nxdomain
          ? `The walk got all the way to the servers responsible for this part of the tree and they answered, authoritatively, that the name does not exist. That is not a timeout and not an error -- it is a definite negative answer, which is why it comes back after ${resolution.queryCount} ${
              resolution.queryCount === 1 ? 'query' : 'queries'
            } rather than after a wait, and why the resolver is allowed to remember it (RFC 2308). Nothing after this stage could run: TCP needs an address, and there is none.`
          : `The resolver could not get a usable answer: ${resolution.rcode}. No address means no connection, so the load stops here.`,
        reference: nxdomain ? RFC_2308 : RFC_1034,
      },
    };
  }

  return {
    events,
    pdus,
    durationMs: clock,
    summary: resolution.servedFromCache
      ? `Cached: ${resolution.addresses[0]}`
      : `${resolution.queryCount} queries -> ${resolution.addresses[0]}`,
    state: { dns: result },
  };
};
