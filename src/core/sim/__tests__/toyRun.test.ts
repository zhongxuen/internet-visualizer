import { describe, expect, it } from 'vitest';

import { projectAt } from '../project';
import { buildToyRun, TOY_TOPOLOGY } from '../toyRun';

const RUN = buildToyRun();

const nodeIds = new Set(TOY_TOPOLOGY.nodes.map((node) => node.id));
const linkIds = new Set(TOY_TOPOLOGY.links.map((link) => link.id));

describe('the toy run', () => {
  it('is deterministic: two builds are deep-equal', () => {
    expect(buildToyRun()).toEqual(buildToyRun());
  });

  it('hands every caller its own object', () => {
    expect(buildToyRun()).not.toBe(buildToyRun());
  });

  it('emits events in non-decreasing virtual time', () => {
    const times = RUN.events.map((event) => event.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('finishes inside the stated duration', () => {
    for (const event of RUN.events) {
      expect(event.at).toBeLessThanOrEqual(RUN.durationMs);
      if (event.kind === 'transmit') {
        expect(event.at + event.durationMs).toBeLessThanOrEqual(RUN.durationMs);
      }
    }
  });

  it('names only nodes and links the topology declares', () => {
    for (const event of RUN.events) {
      switch (event.kind) {
        case 'transmit':
          expect(nodeIds).toContain(event.from);
          expect(nodeIds).toContain(event.to);
          expect(linkIds).toContain(event.linkId);
          break;
        case 'node-state':
          expect(nodeIds).toContain(event.nodeId);
          break;
        case 'pdu-created':
        case 'pdu-transform':
          expect(nodeIds).toContain(event.atNode);
          break;
        default:
          break;
      }
    }
  });

  it('sends every PDU it references and references every PDU it creates', () => {
    const created = new Set(
      RUN.events.filter((event) => event.kind === 'pdu-created').map((e) => e.pdu.id),
    );

    expect(created).toEqual(new Set(Object.keys(RUN.pdus)));

    for (const event of RUN.events) {
      if (event.kind === 'transmit' || event.kind === 'pdu-transform') {
        expect(created).toContain(event.pduId);
      }
    }
  });

  it('transmits each hop over a link that actually connects its two ends', () => {
    for (const event of RUN.events) {
      if (event.kind !== 'transmit') continue;
      const link = TOY_TOPOLOGY.links.find((candidate) => candidate.id === event.linkId);
      expect(link).toBeDefined();
      expect(new Set([link?.from, link?.to])).toEqual(new Set([event.from, event.to]));
    }
  });

  it('splits into three phases that tile the timeline end to end', () => {
    expect(RUN.phases.map((phase) => phase.id)).toEqual(['compose', 'request', 'reply']);
    expect(RUN.phases[0].startMs).toBe(0);
    expect(RUN.phases.at(-1)?.endMs).toBe(RUN.durationMs);

    for (const [index, phase] of RUN.phases.entries()) {
      if (index === 0) continue;
      expect(phase.startMs).toBe(RUN.phases[index - 1].endMs);
    }
  });

  it('shows a packet on the wire at the midpoint of every hop', () => {
    const hops = RUN.events.filter((event) => event.kind === 'transmit');
    expect(hops).toHaveLength(4);

    for (const hop of hops) {
      const state = projectAt(RUN, hop.at + hop.durationMs / 2);
      const packet = state.inFlight.find((flight) => flight.linkId === hop.linkId);
      expect(packet?.progress).toBeCloseTo(0.5, 10);
      expect(packet?.pduId).toBe(hop.pduId);
    }
  });

  it('is at rest once the reply has landed', () => {
    const end = projectAt(RUN, RUN.durationMs);
    expect(end.inFlight).toEqual([]);
    expect(end.log).toHaveLength(RUN.events.length);
    expect(end.currentPhase?.id).toBe('reply');
  });

  it('rewrites the TTL at the router in both directions', () => {
    const transforms = RUN.events.filter((event) => event.kind === 'pdu-transform');
    expect(transforms).toHaveLength(2);

    for (const transform of transforms) {
      expect(transform.atNode).toBe('router');
      const ttlOf = (pdu: (typeof transform)['before']) =>
        pdu.layers.flatMap((layer) => layer.fields).find((field) => field.name === 'TTL')
          ?.value;

      expect(ttlOf(transform.before)).toBe('64');
      expect(ttlOf(transform.after)).toBe('63');
    }
  });
});
