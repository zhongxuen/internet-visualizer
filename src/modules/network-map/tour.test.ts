import { describe, expect, it } from 'vitest';

import { HOME_LAN, SMALL_OFFICE } from '@/core/topologies';

import { buildTour, tourStepAt, tourStepFor, TOUR_STEP_MS } from './tour';

const HOME = buildTour(HOME_LAN);

describe('buildTour', () => {
  it('walks the scenario in the order its notes are written', () => {
    expect(HOME.steps.map((step) => step.target.id)).toEqual(
      HOME_LAN.notes.map((note) => note.targetId),
    );
    expect(HOME.scenarioId).toBe('home-lan');
  });

  it('takes the wording from the scenario rather than restating it', () => {
    const step = tourStepFor(HOME, 'router');
    const note = HOME_LAN.notes.find((entry) => entry.targetId === 'router');

    expect(step?.text).toBe(note?.text);
    expect(HOME.result.phases[step!.index].description).toBe(note?.text);
  });

  it('titles a stop with the machine, and a hop with both of its ends', () => {
    expect(tourStepFor(HOME, 'router')?.title).toBe('Home router (NAPT)');
    expect(tourStepFor(HOME, 'wifi-laptop')?.title).toBe('Laptop ↔ Wi-Fi access point');
  });

  it('frames one machine for a node and both ends for a hop', () => {
    expect(tourStepFor(HOME, 'router')?.focusNodeIds).toEqual(['router']);
    expect(tourStepFor(HOME, 'wifi-laptop')?.focusNodeIds).toEqual(['laptop', 'ap']);
  });

  it('lays the stops out end to end on the timeline', () => {
    for (const [index, step] of HOME.steps.entries()) {
      expect(step.startMs).toBe(index * TOUR_STEP_MS);
      expect(HOME.result.phases[index].id).toBe(step.id);
      expect(HOME.result.phases[index].startMs).toBe(step.startMs);
    }
    expect(HOME.result.durationMs).toBe(HOME.steps.length * TOUR_STEP_MS);
  });

  /**
   * The point of building the tour as a run: it exercises the phase mechanism with
   * nothing moving on the canvas. A `transmit` event or a PDU here would mean the map had
   * started animating traffic, which is phase 06's job on these same topologies.
   */
  it('creates no traffic at all', () => {
    for (const tour of [HOME, buildTour(SMALL_OFFICE)]) {
      expect(tour.result.pdus).toEqual({});
      expect(tour.result.events.some((event) => event.kind === 'transmit')).toBe(false);
      expect(
        tour.result.events.every((event) => ['phase', 'node-state'].includes(event.kind)),
      ).toBe(true);
    }
  });

  it('lights the current stop and puts the previous one out', () => {
    const atSecondStop = HOME.result.events.filter(
      (event) => event.at === TOUR_STEP_MS && event.kind === 'node-state',
    );

    expect(atSecondStop).toEqual([
      { kind: 'node-state', at: TOUR_STEP_MS, nodeId: 'laptop', state: 'idle' },
      {
        kind: 'node-state',
        at: TOUR_STEP_MS,
        nodeId: 'phone',
        state: 'active',
        note: 'this stop on the tour',
      },
    ]);
  });

  /**
   * A machine appearing in two stops in a row must not switch itself off: the idle events
   * for the previous stop are emitted first, so the active one wins at that instant. The
   * hop notes at the end of the home LAN re-light machines that were last lit near the
   * start, which is the case that would break if the order were reversed.
   */
  it('never leaves a machine dark at a stop it belongs to', () => {
    for (const step of HOME.steps) {
      const last = new Map<string, string>();
      for (const event of HOME.result.events) {
        if (event.kind !== 'node-state' || event.at !== step.startMs) continue;
        last.set(event.nodeId, event.state);
      }

      for (const id of step.focusNodeIds) expect(last.get(id)).toBe('active');
    }
  });

  it('emits events in non-decreasing time order', () => {
    let previous = -1;
    for (const event of HOME.result.events) {
      expect(event.at).toBeGreaterThanOrEqual(previous);
      previous = event.at;
    }
  });

  it('is deterministic', () => {
    expect(buildTour(HOME_LAN)).toEqual(buildTour(HOME_LAN));
  });
});

describe('tourStepAt', () => {
  it('opens on the first stop, before it has formally begun', () => {
    expect(tourStepAt(HOME, -10)?.index).toBe(0);
    expect(tourStepAt(HOME, 0)?.index).toBe(0);
  });

  it('treats a stop as half-open, so a boundary belongs to the stop it starts', () => {
    expect(tourStepAt(HOME, TOUR_STEP_MS - 1)?.index).toBe(0);
    expect(tourStepAt(HOME, TOUR_STEP_MS)?.index).toBe(1);
  });

  it('holds the last stop past the end of the tour', () => {
    expect(tourStepAt(HOME, 10 * HOME.result.durationMs)?.index).toBe(
      HOME.steps.length - 1,
    );
  });
});

describe('tourStepFor', () => {
  it('finds the stop about a machine or a hop', () => {
    expect(tourStepFor(HOME, 'modem')?.target).toEqual({ type: 'node', id: 'modem' });
    expect(tourStepFor(HOME, 'access-uplink')?.target.type).toBe('link');
  });

  it('is undefined for something the tour does not visit', () => {
    expect(tourStepFor(HOME, 'nothing-here')).toBeUndefined();
  });
});
