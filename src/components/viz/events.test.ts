import { describe, expect, it } from 'vitest';

import { buildToyRun, TOY_TOPOLOGY } from '@/core/sim/toyRun';
import type { SimEvent } from '@/core/types/events';

import { describeEvent, labelsFor } from './events';

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
    expect(describeKind('node-state').text).toMatch(/^Laptop /);
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

  it('carries the note a state change came with', () => {
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
    expect(line.text).toBe('Home router is processing (cache miss)');
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

  it('keeps each line pinned to the instant it happened', () => {
    for (const event of RUN.events) {
      expect(describeEvent(event, CONTEXT).at).toBe(event.at);
    }
  });
});
