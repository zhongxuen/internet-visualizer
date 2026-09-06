import { describe, expect, it } from 'vitest';

import {
  CDN_HIT,
  FAILURE_DNS,
  FIRST_VISIT_HTTPS,
  REPEAT_VISIT_CACHED,
} from './scenarios';
import { runPageLoad, stageOf } from './sim/pipeline';
import { buildWaterfall, SEGMENT_NOTES, WATERFALL_SEGMENTS } from './waterfall';

/**
 * The waterfall model.
 *
 * The acceptance criterion this file guards is "uses devtools' standard segment names", and
 * a name is easy to get right once and drift away from later -- so the vocabulary itself is
 * asserted, verbatim, rather than only the arithmetic that fills it.
 *
 * The rest is the arithmetic: the document's row is the stage rail re-cut, so its segments
 * have to land exactly where the stages did, and subresource rows have to carry no
 * connection segments at all, because the connection was already open.
 */

const cold = runPageLoad(FIRST_VISIT_HTTPS);

describe('devtools vocabulary', () => {
  it('spells the segments the way Chrome does', () => {
    expect([...WATERFALL_SEGMENTS]).toEqual([
      'Queueing',
      'Stalled',
      'DNS Lookup',
      'Initial connection',
      'SSL',
      'Request sent',
      'Waiting (TTFB)',
      'Content Download',
    ]);
  });

  it('explains every one of them', () => {
    for (const name of WATERFALL_SEGMENTS) {
      expect(SEGMENT_NOTES[name].length).toBeGreaterThan(20);
    }
  });
});

describe('the document row', () => {
  const waterfall = buildWaterfall(cold);
  const document = waterfall.rows[0]!;

  it('is first, and is named for the host', () => {
    expect(document.id).toBe('document');
    expect(document.kind).toBe('document');
    expect(document.label).toBe(cold.page.host);
  });

  /**
   * The point of the document row: the request is the *last* thing that happens. A cold
   * HTTPS load pays for a name, a connection, and a handshake before a byte of HTML exists.
   */
  it('shows the whole cost of getting to the first byte, in stage order', () => {
    expect(document.segments.map((segment) => segment.name)).toEqual([
      'Queueing',
      'Queueing',
      'DNS Lookup',
      'Initial connection',
      'SSL',
      'Request sent',
      'Waiting (TTFB)',
      'Content Download',
    ]);
  });

  it('lines its segments up with the stages they came from', () => {
    const dns = stageOf(cold, 'dns')!;
    const segment = document.segments.find((entry) => entry.name === 'DNS Lookup')!;
    expect(segment.startMs).toBe(dns.startMs);
    expect(segment.durationMs).toBe(dns.durationMs);
  });

  it('splits the response into waiting and downloading, which a total would hide', () => {
    const cdn = stageOf(cold, 'cdn')!;
    const waiting = document.segments.find((entry) => entry.name === 'Waiting (TTFB)')!;
    const download = document.segments.find(
      (entry) => entry.name === 'Content Download',
    )!;
    expect(waiting.startMs).toBe(cdn.startMs);
    expect(download.startMs).toBeCloseTo(waiting.startMs + waiting.durationMs, 1);
    expect(waiting.durationMs).toBeGreaterThan(0);
    expect(download.durationMs).toBeGreaterThan(0);
  });
});

describe('subresource rows', () => {
  const waterfall = buildWaterfall(cold);
  const subresources = waterfall.rows.slice(1);

  it('has one per resource the document named', () => {
    expect(subresources.length).toBe(cold.state.render!.fetches.length);
    expect(subresources.length).toBeGreaterThan(0);
  });

  /**
   * The connection was opened once, by the document. Charging every subresource for a
   * lookup, a handshake and a connect would teach the opposite of connection reuse.
   */
  it('never repeats the connection segments', () => {
    for (const row of subresources) {
      for (const segment of row.segments) {
        expect(['DNS Lookup', 'Initial connection', 'SSL']).not.toContain(segment.name);
      }
    }
  });

  it('starts every one of them after the document finished', () => {
    const document = waterfall.rows[0]!;
    for (const row of subresources) {
      expect(row.startMs).toBeGreaterThanOrEqual(document.endMs - 0.01);
    }
  });
});

describe('cached and failed runs', () => {
  it('marks a resource served from the browser store, and charges it no bytes', () => {
    const warm = buildWaterfall(runPageLoad(REPEAT_VISIT_CACHED));
    const cached = warm.rows.filter((row) => row.fromCache);
    expect(cached.length).toBeGreaterThan(0);
    for (const row of cached) expect(row.transferredBytes).toBe(0);
  });

  it('still gives a cache hit a visible row rather than a zero-width one', () => {
    const warm = buildWaterfall(runPageLoad(REPEAT_VISIT_CACHED));
    for (const row of warm.rows) {
      expect(row.segments.length).toBeGreaterThan(0);
      expect(row.endMs).toBeGreaterThan(row.startMs - 0.01);
    }
  });

  it('draws what a failed run got through before it stopped', () => {
    const failed = runPageLoad(FAILURE_DNS);
    const waterfall = buildWaterfall(failed);
    const names = waterfall.rows[0]!.segments.map((segment) => segment.name);
    expect(names).toContain('DNS Lookup');
    expect(names).not.toContain('Waiting (TTFB)');
  });

  it('scales to the run, so nothing is ever drawn past the right edge', () => {
    for (const run of [cold, runPageLoad(CDN_HIT), runPageLoad(FAILURE_DNS)]) {
      const waterfall = buildWaterfall(run);
      for (const row of waterfall.rows) {
        expect(row.endMs).toBeLessThanOrEqual(waterfall.durationMs + 0.01);
      }
    }
  });
});
