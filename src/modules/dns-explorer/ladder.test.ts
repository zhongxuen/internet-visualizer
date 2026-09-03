import { describe, expect, it } from 'vitest';

import {
  buildLadder,
  CACHE_QUERY_DETAIL,
  currentRungIndex,
  ladderSummary,
  rungAt,
} from './ladder';
import { COLD_CACHE, NXDOMAIN, runDnsScenario, WARM_CACHE } from './scenarios';

const cold = runDnsScenario(COLD_CACHE);
const warm = runDnsScenario(WARM_CACHE);
const missing = runDnsScenario(NXDOMAIN);

const coldLadder = buildLadder(cold.resolutions);
const warmLadder = buildLadder(warm.resolutions);

describe('buildLadder columns', () => {
  it('gives every machine the run spoke to its own lifeline', () => {
    const tiers = coldLadder.columns.map((column) => column.tier);

    expect(tiers).toContain('stub');
    expect(tiers).toContain('recursive');
    expect(tiers).toContain('root');
    expect(tiers).toContain('tld');
    expect(tiers).toContain('authoritative');
  });

  /** Left to right is down the tree, which is the only reason the diagram reads. */
  it('orders columns by tier, not by when each was first contacted', () => {
    const order = coldLadder.columns.map((column) => column.tier);
    const rank = ['stub', 'recursive', 'cache', 'root', 'tld', 'authoritative'];
    const ranks = order.map((tier) => rank.indexOf(tier));

    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  /**
   * The cache endpoint reuses the resolver's address, so keying columns on the address
   * alone would silently merge a cache hit into the resolver's own lifeline.
   */
  it('keeps the cache and the resolver apart despite the shared address', () => {
    const ids = warmLadder.columns.map((column) => column.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(warmLadder.columns.filter((column) => column.tier === 'cache')).toHaveLength(
      1,
    );
  });
});

describe('buildLadder rungs', () => {
  it('is sorted by the moment each message is on the wire', () => {
    const times = coldLadder.rungs.map((rung) => rung.at);

    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  /**
   * The stub asks once at the start and hears back at the end, so its two rungs bracket
   * every rung of the walk they paid for. That ordering is the lesson.
   */
  it('opens with the stub question and closes with the stub answer', () => {
    const first = coldLadder.rungs[0];
    const last = coldLadder.rungs[coldLadder.rungs.length - 1];

    expect(first.kind).toBe('query');
    expect(first.recursive).toBe(true);
    expect(last.kind).toBe('response');
    expect(last.stepIndex).toBe(0);
    expect(last.lookupIndex).toBe(coldLadder.rungs[0].lookupIndex + 1);
  });

  it('marks the stub query recursive and every query below it iterative', () => {
    const queries = coldLadder.rungs.filter((rung) => rung.kind === 'query');
    const recursive = queries.filter((rung) => rung.recursive);

    // One per lookup, and nothing else.
    expect(recursive).toHaveLength(cold.resolutions.length);
    expect(recursive.every((rung) => rung.detail.startsWith('Recursive'))).toBe(true);
    expect(
      queries
        .filter((rung) => !rung.recursive && rung.detail !== CACHE_QUERY_DETAIL)
        .every((rung) => rung.detail.startsWith('Iterative')),
    ).toBe(true);
  });

  /** The misconception the module exists to correct, asserted on the ladder itself. */
  it('labels the root and TLD replies as referrals rather than answers', () => {
    const byColumn = (tier: string) =>
      coldLadder.rungs.filter(
        (rung) => rung.kind === 'response' && coldLadder.columns[rung.from].tier === tier,
      );

    expect(byColumn('root').every((rung) => rung.outcome === 'referral')).toBe(true);
    expect(byColumn('tld').every((rung) => rung.outcome === 'referral')).toBe(true);
    expect(byColumn('root')[0].detail).toBe('Referral, not an answer');
  });

  it('carries the message on both rungs, so either can be inspected', () => {
    const query = coldLadder.rungs.find((rung) => rung.kind === 'query');
    const response = coldLadder.rungs.find((rung) => rung.kind === 'response');

    expect(query?.message?.flags.qr).toBe(false);
    expect(response?.message?.flags.qr).toBe(true);
  });

  /**
   * A referral is not a failure and must not be coloured as one -- half the point of the
   * ladder is that the root saying "not mine" is the system working.
   */
  it('colours a negative reply as an error and a referral as neither', () => {
    const ladder = buildLadder(missing.resolutions);
    const replies = ladder.rungs.filter((rung) => rung.kind === 'response');

    expect(replies.find((rung) => rung.outcome === 'nxdomain')?.tone).toBe('error');
    expect(replies.find((rung) => rung.outcome === 'referral')?.tone).toBe('accent');
  });

  it('gives every rung an id that is unique across the whole run', () => {
    const ids = coldLadder.rungs.map((rung) => rung.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  /** A cache hit is a rung that never leaves the machine, and must look like one. */
  it('draws the cache hit between the resolver and its own cache', () => {
    const hit = warmLadder.rungs.find((rung) => rung.outcome === 'cache-hit');

    expect(hit).toBeDefined();
    expect(warmLadder.columns[hit!.to].tier).toBe('cache');
    expect(warmLadder.columns[hit!.from].tier).toBe('recursive');
  });
});

describe('currentRungIndex', () => {
  it('is -1 before the first message leaves', () => {
    expect(currentRungIndex(coldLadder.rungs, -1)).toBe(-1);
  });

  it('holds the last rung that has left while a server is thinking', () => {
    const second = coldLadder.rungs[1];
    const third = coldLadder.rungs[2];
    const between = (second.at + third.at) / 2;

    expect(currentRungIndex(coldLadder.rungs, between)).toBe(1);
  });

  it('ends on the last rung', () => {
    const last = coldLadder.rungs.length - 1;

    expect(currentRungIndex(coldLadder.rungs, cold.result.durationMs)).toBe(last);
    expect(rungAt(coldLadder.rungs, cold.result.durationMs)?.kind).toBe('response');
  });
});

describe('ladderSummary', () => {
  /** The caching lesson in one line: the same question, and what it cost each time. */
  it('contrasts a walk of the hierarchy with a run that never left the resolver', () => {
    expect(ladderSummary([cold.resolutions[0]])).toContain('the hierarchy was walked');
    expect(ladderSummary([warm.resolutions[1]])).toContain(
      'no root or TLD server was contacted',
    );
  });
});
