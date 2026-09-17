import { describe, expect, it } from 'vitest';

import { buildToyRun, TOY_TOPOLOGY } from '@/core/sim/toyRun';
import type { SimEvent } from '@/core/types/events';

import { describeEvent, labelsFor } from './events';
import { nodeStateToken } from './nodes/state';

const RUN = buildToyRun();
const CONTEXT = { labels: labelsFor(TOY_TOPOLOGY), pdus: RUN.pdus };

function describeKind(kind: SimEvent['kind']) {
  const event = RUN.events.find((candidate) => candidate.kind === kind);
  if (!event) throw new Error(`the toy run emits no ${kind} event`);
  return describeEvent(event, CONTEXT);
}

describe('labelsFor', () => {
  it('names every node and link in the topology', () => {
    const labels = labelsFor(TOY_TOPOLOGY);

    expect(labels.laptop).toBe('Laptop');
    expect(labels.echo).toBe('echo.example.net');
    expect(labels['link-wan']).toBe('Home router - echo.example.net');
  });
});

describe('describeEvent', () => {
  it('resolves ids to labels wherever an event names a machine', () => {
    expect(describeKind('node-state').text).toMatch(/^Laptop: /);
    expect(describeKind('pdu-created').text).toMatch(/^Laptop /);
    expect(describeKind('pdu-transform').text).toMatch(/^Home router /);
    expect(describeKind('annotate').text).toMatch(/^Laptop: /);
  });

  it('never prints a PDU id where it has the PDU itself', () => {
    for (const event of RUN.events) {
      expect(describeEvent(event, CONTEXT).text).not.toContain('echo-request');
    }
  });

  it('falls back to the id when the caller gave it nothing to look up', () => {
    const transmit = RUN.events.find((event) => event.kind === 'transmit');
    expect(describeEvent(transmit!).text).toBe('laptop -> router: echo-request');
  });

  it('describes a hop by its two ends and what is on the wire', () => {
    expect(describeKind('transmit').text).toBe(
      'Laptop -> Home router: ICMP echo request 192.168.1.24 -> 198.51.100.42',
    );
  });

  it('names a state with the word the node chip prints, and carries its note', () => {
    const line = describeEvent(
      {
        kind: 'node-state',
        at: 0,
        nodeId: 'router',
        state: 'processing',
        note: 'cache miss',
      },
      CONTEXT,
    );
    expect(line.text).toBe(
      `Home router: ${nodeStateToken('processing').label} (cache miss)`,
    );
    expect(line.text).not.toContain('processing');
  });

  it('tells a teaching note apart from a phase, by tone as well as by colour', () => {
    expect(describeKind('annotate').tone).toBe('note');
    expect(describeKind('phase').tone).not.toBe(describeKind('annotate').tone);
  });

  it('tones a phase, a rewrite, and a drop apart from ordinary traffic', () => {
    expect(describeKind('phase').tone).toBe('accent');
    expect(describeKind('pdu-transform').tone).toBe('warn');
    expect(describeKind('transmit').tone).toBe('info');

    const drop = describeEvent(
      {
        kind: 'drop',
        at: 5,
        pduId: 'echo-request',
        atNode: 'router',
        reason: 'TTL expired',
      },
      CONTEXT,
    );
    expect(drop.tone).toBe('error');
    expect(drop.text).toContain('TTL expired');
  });

  it('takes a log line at the level it was emitted', () => {
    for (const level of ['info', 'warn', 'error'] as const) {
      const line = describeEvent({ kind: 'log', at: 0, level, text: 'something' });
      expect(line.tone).toBe(level);
      expect(line.text).toBe('something');
    }
  });

  describe('in Simple detail', () => {
    const SIMPLE = { ...CONTEXT, detail: 'simple' as const };
    const withPlain = {
      ...RUN.pdus,
      'echo-request': { ...RUN.pdus['echo-request']!, plainLabel: 'Are you there?' },
    };

    it('names a packet by what it is for, where the scenario wrote that', () => {
      const transmit = RUN.events.find((event) => event.kind === 'transmit')!;

      expect(describeEvent(transmit, { ...SIMPLE, pdus: withPlain }).text).toBe(
        'Laptop to Home router: Are you there?',
      );
    });

    it('falls back to the technical summary when there is no plain label', () => {
      expect(
        describeEvent(
          RUN.events.find((e) => e.kind === 'transmit')!,
          SIMPLE,
        ).text,
      ).toBe('Laptop to Home router: ICMP echo request 192.168.1.24 -> 198.51.100.42');
    });

    it("shows a note's plain sentence when it has one", () => {
      const line = describeEvent(
        {
          kind: 'annotate',
          at: 0,
          targetId: 'router',
          text: 'TTL 64 -> 63.',
          plain: 'One hop used.',
        },
        SIMPLE,
      );
      expect(line.text).toBe('Home router: One hop used.');
    });

    it('leaves Full detail as the technical line', () => {
      const line = describeEvent(
        {
          kind: 'annotate',
          at: 0,
          targetId: 'router',
          text: 'TTL 64 -> 63.',
          plain: 'One hop used.',
        },
        { ...CONTEXT, pdus: withPlain },
      );
      expect(line.text).toBe('Home router: TTL 64 -> 63.');
    });
  });

  it('keeps each line pinned to the instant it happened', () => {
    for (const event of RUN.events) {
      expect(describeEvent(event, CONTEXT).at).toBe(event.at);
    }
  });
});
