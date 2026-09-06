import { describe, expect, it } from 'vitest';

import { LOOKUP_CAVEATS, LOOKUP_EXAMPLES, runLookup } from './lookup';

const byName = (name: string, type = 'A') =>
  LOOKUP_EXAMPLES.find((entry) => entry.name === name && entry.type === type)!;

describe('running a lookup', () => {
  it('is deterministic: the same question replays exactly', () => {
    expect(runLookup(byName('example.com'))).toEqual(runLookup(byName('example.com')));
  });

  it('walks root, TLD and authoritative on a cold cache', () => {
    const run = runLookup(byName('example.com'));
    expect(run.resolution.rcode).toBe('NOERROR');
    expect(run.resolution.usedRootOrTld).toBe(true);
    expect(run.resolution.queryCount).toBeGreaterThan(1);
    expect(run.answers[0]?.record.type).toBe('A');
  });

  /** Caching, demonstrated rather than asserted: the second run touches no server. */
  it('answers the same question from cache the second time', () => {
    const run = runLookup(byName('example.com'));
    expect(run.warm.queryCount).toBe(0);
    expect(run.warm.servedFromCache).toBe(true);
    expect(run.warm.elapsedMs).toBeLessThan(run.resolution.elapsedMs);
    expect(run.warm.cacheEntries).toBeGreaterThan(0);
  });

  it('annotates each answer with what its record type is for', () => {
    const run = runLookup(byName('example.com', 'MX'));
    expect(run.answers.length).toBeGreaterThan(0);
    expect(run.answers[0]?.note).toContain('mail');
    expect(run.answers[0]?.text).toContain('MX');
  });

  it('follows a CNAME chain and returns every link of it', () => {
    const run = runLookup(byName('blog.example.com'));
    expect(run.answers.map((entry) => entry.record.type)).toEqual([
      'CNAME',
      'CNAME',
      'A',
    ]);
  });

  it('reports NXDOMAIN as a real answer with no records', () => {
    const run = runLookup(byName('nope.example.com'));
    expect(run.resolution.rcode).toBe('NXDOMAIN');
    expect(run.answers).toHaveLength(0);
    expect(run.output.join('\n')).toContain('status: NXDOMAIN');
  });
});

describe('the transcript', () => {
  const run = runLookup(byName('example.com'));

  it('is shaped like dig, with one trailing dot per name', () => {
    const text = run.output.join('\n');
    expect(text).toContain(';; QUESTION SECTION:');
    expect(text).toContain(';example.com.\t\tIN\tA');
    expect(text).not.toContain('example.com..');
  });

  it('reports the query count and whether the root was involved', () => {
    expect(run.output.join('\n')).toContain('to real servers');
  });

  /**
   * `;; WHEN:` is deliberately absent. A wall clock would make the run unreplayable, and
   * every simulation in this project has to produce a deep-equal result twice.
   */
  it('prints no wall-clock timestamp', () => {
    expect(run.output.join('\n')).not.toContain('WHEN:');
  });
});

describe('the drawable network', () => {
  it('contains only the servers the walk actually reached', () => {
    const run = runLookup(byName('example.com'));
    const kinds = run.topology.nodes.map((node) => node.kind);
    expect(kinds).toContain('client');
    expect(kinds).toContain('dns-resolver');
    expect(kinds).toContain('dns-root');
    expect(kinds).toContain('dns-authoritative');
  });

  it('grows with the walk: a CNAME across zones needs more servers', () => {
    const simple = runLookup(byName('example.com'));
    const chained = runLookup(byName('shop.example.com'));
    expect(chained.topology.nodes.length).toBeGreaterThan(simple.topology.nodes.length);
  });
});

describe('every example', () => {
  it('produces sorted events naming only declared nodes and links', () => {
    for (const example of LOOKUP_EXAMPLES) {
      const run = runLookup(example);
      const ids = new Set(run.topology.nodes.map((node) => node.id));
      const links = new Set(run.topology.links.map((link) => link.id));
      const times = run.result.events.map((event) => event.at);

      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(run.result.durationMs).toBeGreaterThanOrEqual(times[times.length - 1] ?? 0);

      for (const event of run.result.events) {
        if (event.kind === 'transmit') {
          expect(ids.has(event.from)).toBe(true);
          expect(ids.has(event.to)).toBe(true);
          expect(links.has(event.linkId)).toBe(true);
        }
        if (event.kind === 'pdu-created') expect(ids.has(event.atNode)).toBe(true);
      }
    }
  });

  it('always ends on a phase that explains the answer’s shelf life', () => {
    for (const example of LOOKUP_EXAMPLES) {
      const run = runLookup(example);
      expect(run.result.phases[run.result.phases.length - 1]?.id).toBe('answer');
    }
  });
});

describe('the caveats', () => {
  it('leads with the one that costs people afternoons', () => {
    expect(LOOKUP_CAVEATS[0]?.title).toContain(
      'not the answer your application will get',
    );
  });
});
