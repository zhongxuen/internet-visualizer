/**
 * The resolution ladder, as data.
 *
 * A `DnsResolution` is a flat list of exchanges. A sequence diagram is a grid: machines
 * across the top, time down the side, and one arrow per message between two of the
 * columns. This file is the whole of that translation, and it is pure so that the awkward
 * part -- deciding which column a server belongs in, and which arrow the playhead is on
 * -- can be tested without mounting anything.
 *
 * ## Two arrows per exchange, not one
 *
 * `ResolutionStep` bundles a query with whatever came back, because those are one unit
 * of protocol. They are not one unit of *story*: the interesting thing about the root
 * server is the gap between what it was asked and what it chose to say, and a single row
 * labelled "root" hides exactly that. So each step becomes an outbound rung and a return
 * rung, each with its own moment on the timeline and its own message to inspect.
 *
 * The two are not adjacent, either. The stub's step spans the entire resolution -- it
 * asks at the start and hears back at the end -- so once {@link buildLadder} sorts by
 * time, the stub's answer lands last, below every rung of the walk it paid for. That
 * ordering is the shape of the lesson: one question at the top, several underneath, one
 * answer back.
 *
 * ## Column order
 *
 * By tier rather than by first appearance, so the diagram reads left to right as the
 * tree reads top to bottom: client, resolver, its cache, root, TLD, authoritative. Within
 * a tier, first contacted is first. The cache sits beside the resolver because that is
 * where it is -- a cache hit is a rung that never leaves the machine, and it should look
 * like one.
 */

import type { RfcRef } from '@/core/types/events';

import { TRANSPORT_LABELS } from './lookup';
import { displayName, type DnsMessage } from './sim/records';
import type {
  DnsEndpoint,
  DnsResolution,
  DnsTransport,
  ResolutionStep,
  ServerTier,
  StepOutcome,
  StepPurpose,
} from './sim/resolver';

/** Whether a rung is a message going out, or the reply coming back. */
export type RungKind = 'query' | 'response';

/** How a rung is coloured. Never the only signal -- {@link LadderRung.detail} says it. */
export type RungTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'error';

/** One machine, one vertical lifeline. */
export interface LadderColumn {
  /** Stable across renders: tier plus address, since the cache shares the resolver's. */
  readonly id: string;
  /** What this machine is -- `'root server'`, `'stub resolver'`. */
  readonly label: string;
  /** What it is called -- `'a.root-servers.net'`. */
  readonly name: string;
  readonly address: string;
  readonly tier: ServerTier;
}

/** One arrow: a message, from one column to another, at one moment. */
export interface LadderRung {
  /** Stable across renders, so a pinned selection survives a re-render. */
  readonly id: string;
  readonly kind: RungKind;
  /** Which of the scenario's lookups this belongs to. */
  readonly lookupIndex: number;
  /** The step's index within that lookup's resolution. */
  readonly stepIndex: number;
  /** Column index the arrow leaves. */
  readonly from: number;
  /** Column index the arrow arrives at. */
  readonly to: number;
  /** Virtual millisecond this message is on the wire. Clicking the rung seeks here. */
  readonly at: number;
  /** The question, as a resolver would write it: `example.com. A`. */
  readonly title: string;
  /** The short label on the arrow -- what kind of query, or what kind of answer. */
  readonly detail: string;
  readonly outcome: StepOutcome;
  readonly purpose: StepPurpose;
  /** True only for the stub's query: RD set, "do this for me". */
  readonly recursive: boolean;
  readonly transport: DnsTransport;
  readonly tone: RungTone;
  /**
   * The message itself, for the record table. Absent on the return rung of a step that
   * timed out -- which is what a timeout is: a rung with nothing on it.
   */
  readonly message?: DnsMessage;
  /** The resolver's one sentence about this exchange. */
  readonly note: string;
  readonly reference?: RfcRef;
}

/** Everything the ladder view draws. */
export interface Ladder {
  readonly columns: readonly LadderColumn[];
  readonly rungs: readonly LadderRung[];
}

/** Left to right is down the tree. */
const TIER_ORDER: Readonly<Record<ServerTier, number>> = {
  stub: 0,
  recursive: 1,
  cache: 2,
  root: 3,
  tld: 4,
  authoritative: 5,
};

/** What each outcome is called on the return arrow. */
const OUTCOME_LABELS: Readonly<Record<StepOutcome, string>> = {
  referral: 'Referral, not an answer',
  answer: 'Answer',
  cname: 'Alias — start again at the target',
  nodata: 'NODATA — no record of that type',
  nxdomain: 'NXDOMAIN — no such name',
  refused: 'REFUSED',
  servfail: 'SERVFAIL',
  timeout: 'No reply',
  truncated: 'TC set — retry over TCP',
  'cache-hit': 'From cache',
};

/** Colour per outcome. A referral is not a failure, and must not be coloured as one. */
const OUTCOME_TONES: Readonly<Record<StepOutcome, RungTone>> = {
  referral: 'accent',
  answer: 'ok',
  cname: 'accent',
  nodata: 'warn',
  nxdomain: 'error',
  refused: 'error',
  servfail: 'error',
  timeout: 'warn',
  truncated: 'warn',
  'cache-hit': 'ok',
};

/** The one query that is not a query: a rung that never leaves the machine. */
export const CACHE_QUERY_DETAIL = 'Cache lookup — nothing on the wire';

/** Why a step happened, for the rungs that are not about the name that was asked. */
const PURPOSE_LABELS: Readonly<Record<StepPurpose, string>> = {
  stub: 'the question',
  lookup: 'the walk',
  'ns-address': 'no glue — resolving the nameserver first',
  dnssec: 'fetching keys to validate with',
};

function columnId(endpoint: DnsEndpoint): string {
  // The cache endpoint reuses the resolver's address, so the address alone is not a key.
  return endpoint.tier + ':' + endpoint.address;
}

/** Every machine this run spoke to, ordered by tier and then by when it was first used. */
function collectColumns(resolutions: readonly DnsResolution[]): LadderColumn[] {
  const seen = new Map<string, { column: LadderColumn; first: number }>();
  let order = 0;

  const note = (endpoint: DnsEndpoint) => {
    const id = columnId(endpoint);
    if (seen.has(id)) return;
    seen.set(id, {
      column: {
        id,
        label: endpoint.label,
        name: endpoint.name,
        address: endpoint.address,
        tier: endpoint.tier,
      },
      first: order,
    });
    order += 1;
  };

  for (const resolution of resolutions) {
    for (const step of resolution.steps) {
      note(step.from);
      note(step.to);
    }
  }

  return [...seen.values()]
    .sort((a, b) => {
      const tier = TIER_ORDER[a.column.tier] - TIER_ORDER[b.column.tier];
      return tier !== 0 ? tier : a.first - b.first;
    })
    .map((entry) => entry.column);
}

/** `example.com. A`, the way a resolver prints a question. */
function questionText(message: DnsMessage): string {
  return displayName(message.question.name) + ' ' + message.question.type;
}

/**
 * Build the ladder for one run.
 *
 * The rungs come out sorted by time, which is the only order a sequence diagram can be
 * read in -- and which is not the order the steps are in, because the stub's step brackets
 * every other step in its resolution.
 */
export function buildLadder(resolutions: readonly DnsResolution[]): Ladder {
  const columns = collectColumns(resolutions);
  const columnIndex = new Map(columns.map((column, index) => [column.id, index]));
  const at = (endpoint: DnsEndpoint) => columnIndex.get(columnId(endpoint)) ?? 0;

  const rungs: LadderRung[] = [];

  resolutions.forEach((resolution, lookupIndex) => {
    for (const step of resolution.steps) {
      const base = {
        lookupIndex,
        stepIndex: step.index,
        outcome: step.outcome,
        purpose: step.purpose,
        recursive: step.recursive,
        transport: step.transport,
        note: step.note,
        ...(step.reference ? { reference: step.reference } : {}),
      };

      rungs.push({
        ...base,
        id: rungKey(lookupIndex, step, 'query'),
        kind: 'query',
        from: at(step.from),
        to: at(step.to),
        at: step.startedMs,
        title: questionText(step.query),
        detail: queryDetail(step),
        // A query is not a verdict, so it takes its colour from what kind of query it
        // is -- except the one that never got an answer, which is the whole story of
        // that rung.
        tone: step.outcome === 'timeout' ? 'warn' : step.recursive ? 'accent' : 'neutral',
        message: step.query,
      });

      // A timeout has no return arrow. Drawing one would be drawing a reply that never
      // arrived; the query rung already carries the `timeout` outcome.
      if (step.outcome === 'timeout') continue;

      rungs.push({
        ...base,
        id: rungKey(lookupIndex, step, 'response'),
        kind: 'response',
        from: at(step.to),
        to: at(step.from),
        at: step.startedMs + step.durationMs,
        title: questionText(step.query),
        detail: OUTCOME_LABELS[step.outcome],
        tone: OUTCOME_TONES[step.outcome],
        ...(step.response ? { message: step.response } : {}),
      });
    }
  });

  // Stable, so a query and a reply landing on the same virtual millisecond keep the only
  // order that makes sense. Array.prototype.sort has been required to be stable since
  // ES2019.
  rungs.sort((a, b) => a.at - b.at);

  return { columns, rungs };
}

function rungKey(lookupIndex: number, step: ResolutionStep, kind: RungKind): string {
  return 'l' + lookupIndex + '-s' + step.index + '-' + kind;
}

/** What kind of arrow this is: the distinction the whole ladder exists to show. */
function queryDetail(step: ResolutionStep): string {
  const kind = step.recursive ? 'Recursive, RD set' : 'Iterative, RD clear';
  if (step.to.tier === 'cache') return CACHE_QUERY_DETAIL;
  const purpose =
    step.outcome === 'timeout'
      ? ' — no reply'
      : step.purpose === 'lookup'
        ? ''
        : ' — ' + PURPOSE_LABELS[step.purpose];
  return kind + ' · ' + TRANSPORT_LABELS[step.transport] + purpose;
}

/**
 * Index of the rung the playhead is on, or `-1` before the first message.
 *
 * The last rung that has *left* wins, so the cursor holds its place while a server is
 * thinking rather than blanking between arrows.
 */
export function currentRungIndex(
  rungs: readonly LadderRung[],
  virtualTime: number,
): number {
  let index = -1;
  for (let i = 0; i < rungs.length; i += 1) {
    if (rungs[i].at <= virtualTime) index = i;
    else break;
  }
  return index;
}

/** The rung under the playhead, if the run has started. */
export function rungAt(
  rungs: readonly LadderRung[],
  virtualTime: number,
): LadderRung | undefined {
  const index = currentRungIndex(rungs, virtualTime);
  return index === -1 ? undefined : rungs[index];
}

/**
 * A one-line summary of what the run cost, for the ladder's header.
 *
 * Query count and elapsed time together are the contrast the caching lesson turns on: the
 * same question, two runs, three queries against none.
 */
export function ladderSummary(resolutions: readonly DnsResolution[]): string {
  const queries = resolutions.reduce((total, one) => total + one.queryCount, 0);
  const elapsed = resolutions.reduce((total, one) => total + one.elapsedMs, 0);
  const hierarchy = resolutions.some((one) => one.usedRootOrTld);

  return (
    queries +
    (queries === 1 ? ' query' : ' queries') +
    ' · ' +
    Math.round(elapsed) +
    ' ms · ' +
    (hierarchy ? 'the hierarchy was walked' : 'no root or TLD server was contacted')
  );
}
