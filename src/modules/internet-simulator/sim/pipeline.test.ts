/**
 * The pipeline's contract: local time in, one timeline out.
 *
 * The tests that matter here are the composition ones. Every stage emits its events from
 * zero and reports a duration; if the pipeline's arithmetic is wrong, every number the
 * module shows -- the rail's proportions, the waterfall's segments, the paint markers -- is
 * wrong together and consistently, which is exactly the kind of bug that looks fine on
 * screen. So the offsets are checked directly rather than through the totals.
 */

import { describe, expect, it } from 'vitest';

import { createRng } from '@/core/sim/rng';

import { CDN_HIT } from '../scenarios/cdn-hit';
import { FAILURE_DNS } from '../scenarios/failure-dns';
import { FAILURE_TIMEOUT } from '../scenarios/failure-timeout';
import { FAILURE_TLS } from '../scenarios/failure-tls';
import { FIRST_VISIT_HTTPS } from '../scenarios/first-visit-https';
import { REPEAT_VISIT_CACHED } from '../scenarios/repeat-visit-cached';
import { buildPage, retarget } from './page';
import { runPageLoad, stageOf, STAGES, type PageLoadRun } from './pipeline';
import {
  DNS_ROOT_NODE,
  networkProfile,
  SIM_CLOCK,
  STAGE_IDS,
  type StageContext,
} from './stage';
import { dnsStage } from './stages/dns-stage';
import { parseUrl } from './stages/url-parse';
import { buildTopology } from './topology';

/** Floating-point tolerance: everything is rounded to two places, so this is generous. */
const EPSILON = 0.011;

describe('runPageLoad', () => {
  it('reports all eight stages, in pipeline order, exactly once', () => {
    const run = runPageLoad(FIRST_VISIT_HTTPS);
    expect(run.stages.map((stage) => stage.id)).toEqual(STAGE_IDS);
    expect(Object.keys(STAGES)).toEqual([...STAGE_IDS]);
  });

  it('is deterministic: the same scenario twice produces a deep-equal run', () => {
    expect(runPageLoad(FIRST_VISIT_HTTPS)).toEqual(runPageLoad(FIRST_VISIT_HTTPS));
  });

  it('emits events in non-decreasing time order', () => {
    for (const run of [
      runPageLoad(FIRST_VISIT_HTTPS),
      runPageLoad(REPEAT_VISIT_CACHED),
      runPageLoad(CDN_HIT),
    ]) {
      const times = run.result.events.map((event) => event.at);
      expect(times).toEqual([...times].sort((a, b) => a - b));
    }
  });
});

describe('stage offsets compose', () => {
  const runs: readonly PageLoadRun[] = [
    runPageLoad(FIRST_VISIT_HTTPS),
    runPageLoad(REPEAT_VISIT_CACHED),
    runPageLoad(CDN_HIT),
    runPageLoad(FAILURE_TLS),
    runPageLoad(FIRST_VISIT_HTTPS, { profile: 'satellite' }),
  ];

  it('lays the stages end to end with no gaps and no overlaps', () => {
    for (const run of runs) {
      let expected = 0;
      for (const stage of run.stages) {
        expect(stage.startMs).toBeCloseTo(expected, 2);
        expect(stage.endMs).toBeCloseTo(stage.startMs + stage.durationMs, 2);
        expected = stage.endMs;
      }
      // The accumulated offset is the sum of the durations, by construction.
      const summed = run.stages.reduce((total, stage) => total + stage.durationMs, 0);
      expect(expected).toBeCloseTo(summed, 2);
    }
  });

  it('shifts each stage by exactly its accumulated offset', () => {
    for (const run of runs) {
      for (const stage of run.stages) {
        if (stage.status !== 'ran') continue;
        // Every stage opens with a phase event at its own local time zero, so the shifted
        // copy landing on `startMs` is the shift being correct with nothing else assumed.
        const opening = stage.events.find((event) => event.kind === 'phase');
        expect(opening, `${stage.id} should open a phase`).toBeDefined();
        expect(opening!.at).toBeCloseTo(stage.startMs, 2);
      }
    }
  });

  it('never emits an event before the stage that produced it began', () => {
    for (const run of runs) {
      for (const stage of run.stages) {
        for (const event of stage.events) {
          expect(event.at).toBeGreaterThanOrEqual(stage.startMs - EPSILON);
          expect(event.at).toBeLessThanOrEqual(run.result.durationMs + EPSILON);
        }
      }
    }
  });

  it('only lets TLS run past its own end, and only for what really overlaps', () => {
    // A stage's duration is when the *next* stage may begin. For seven of the eight that is
    // also when their last event fires. TLS 1.3 is the exception by design: the client's
    // Finished travels with the HTTP request, so the server's completion and its
    // post-handshake ticket land while the request is already on the wire. Clipping them to
    // the stage boundary would make the rail agree with the timeline by misrepresenting the
    // protocol, so they are left where they happen -- and this test pins down that TLS is
    // the only stage allowed to do it.
    for (const run of runs) {
      for (const stage of run.stages) {
        const overruns = stage.events.filter((event) => event.at > stage.endMs + EPSILON);
        if (stage.id === 'tls') continue;
        expect(overruns, `${run.scenario.id}/${stage.id} should not overrun`).toEqual([]);
      }
    }

    // And the overlap is real rather than incidental: it is the handshake finishing.
    const tls = stageOf(runPageLoad(FIRST_VISIT_HTTPS), 'tls')!;
    const overruns = tls.events.filter((event) => event.at > tls.endMs + EPSILON);
    expect(overruns.length).toBeGreaterThan(0);
    for (const event of overruns) {
      expect(event.at).toBeLessThanOrEqual(
        tls.startMs + runPageLoad(FIRST_VISIT_HTTPS).state.tls!.completedAt + EPSILON,
      );
    }
  });

  it('shifts a stage’s events by the offset and changes nothing else about them', () => {
    // The DNS stage run on its own, in local time, against the same inputs the pipeline
    // gave it -- then compared event for event with what came out of the pipeline.
    const scenario = FIRST_VISIT_HTTPS;
    const run = runPageLoad(scenario);
    const stage = stageOf(run, 'dns')!;
    const url = parseUrl(scenario.url);
    expect(url.ok).toBe(true);
    if (!url.ok) return;

    const profile = networkProfile(scenario.profileId ?? 'cable');
    const context: StageContext = {
      stage: 'dns',
      scenario,
      profile,
      clock: SIM_CLOCK,
      topology: buildTopology(scenario, profile),
      rng: createRng('irrelevant: the dns stage draws nothing'),
      state: {
        url: url.value,
        page: retarget(buildPage(scenario, url.value.host), url.value.target),
      },
    };

    const local = dnsStage(context);
    expect(local.events.length).toBe(stage.events.length);
    expect(local.durationMs).toBeCloseTo(stage.durationMs, 2);
    local.events.forEach((event, index) => {
      const shifted = stage.events[index];
      expect(shifted.kind).toBe(event.kind);
      expect(shifted.at).toBeCloseTo(event.at + stage.startMs, 2);
      // `durationMs` is a length, not an instant, so a shifted transmit keeps it.
      if (event.kind === 'transmit' && shifted.kind === 'transmit') {
        expect(shifted.durationMs).toBe(event.durationMs);
      }
    });
  });

  it('tags every event with the stage that produced it', () => {
    for (const run of runs) {
      expect(run.eventStages.length).toBe(run.result.events.length);

      const counts = new Map<string, number>();
      for (const id of run.eventStages) counts.set(id, (counts.get(id) ?? 0) + 1);

      for (const stage of run.stages) {
        // Scenario notes are folded in at a phase boundary and tagged with the stage that
        // owns that phase, so a stage's tally is its own events plus any notes pinned to it.
        expect(counts.get(stage.id) ?? 0).toBeGreaterThanOrEqual(stage.events.length);
      }
    }
  });

  it('derives phases whose boundaries agree with the shifted events', () => {
    const run = runPageLoad(FIRST_VISIT_HTTPS);
    for (const phase of run.result.phases) {
      const stage = run.stages.find((candidate) => candidate.id === phase.id);
      if (!stage) continue;
      expect(phase.startMs).toBeCloseTo(stage.startMs, 2);
    }
    expect(run.result.durationMs).toBeGreaterThanOrEqual(
      Math.max(...run.result.events.map((event) => event.at)),
    );
  });
});

describe('network profiles', () => {
  it('re-runs the same scenario and changes the timing balance', () => {
    const fiber = runPageLoad(FIRST_VISIT_HTTPS, { profile: 'fiber' });
    const cable = runPageLoad(FIRST_VISIT_HTTPS, { profile: 'cable' });
    const satellite = runPageLoad(FIRST_VISIT_HTTPS, { profile: 'satellite' });

    expect(fiber.result.durationMs).toBeLessThan(cable.result.durationMs);
    expect(cable.result.durationMs).toBeLessThan(satellite.result.durationMs);

    // The lesson: on a slow link the handshakes take over. DNS, TCP, and TLS between them
    // are a small slice of a fiber load and the majority of a satellite one.
    const setupShare = (run: PageLoadRun): number =>
      (['dns', 'tcp', 'tls'] as const).reduce(
        (total, id) => total + (stageOf(run, id)?.share ?? 0),
        0,
      );
    expect(setupShare(satellite)).toBeGreaterThan(setupShare(fiber));
  });

  it('scales the DNS stage with the profile without touching the resolution itself', () => {
    const fiber = runPageLoad(FIRST_VISIT_HTTPS, { profile: 'fiber' });
    const satellite = runPageLoad(FIRST_VISIT_HTTPS, { profile: 'satellite' });

    expect(fiber.state.dns?.queryCount).toBe(satellite.state.dns?.queryCount);
    expect(fiber.state.dns?.addresses).toEqual(satellite.state.dns?.addresses);
    expect(stageOf(satellite, 'dns')!.durationMs).toBeGreaterThan(
      stageOf(fiber, 'dns')!.durationMs,
    );
  });

  it('leaves a warm resolver’s memory lookup alone whatever the link', () => {
    const cable = stageOf(runPageLoad(REPEAT_VISIT_CACHED, { profile: 'cable' }), 'dns')!;
    const satellite = stageOf(
      runPageLoad(REPEAT_VISIT_CACHED, { profile: 'satellite' }),
      'dns',
    )!;
    expect(satellite.durationMs).toBe(cable.durationMs);
  });
});

describe('a failure ends the run', () => {
  it('stops at the failing stage and reports the rest as never reached', () => {
    const cases = [
      { run: runPageLoad(FAILURE_DNS), stage: 'dns' as const, after: 5 },
      { run: runPageLoad(FAILURE_TLS), stage: 'tls' as const, after: 3 },
      { run: runPageLoad(FAILURE_TIMEOUT), stage: 'tcp' as const, after: 4 },
    ];

    for (const { run, stage, after } of cases) {
      expect(run.failure?.stage).toBe(stage);
      expect(stageOf(run, stage)!.status).toBe('ran');

      const notReached = run.stages.filter((each) => each.status === 'not-reached');
      expect(notReached).toHaveLength(after);
      for (const each of notReached) {
        expect(each.durationMs).toBe(0);
        expect(each.events).toHaveLength(0);
        expect(each.skipReason).toContain(stage);
      }
    }
  });

  it('names the browser error, and explains which stage produced it', () => {
    expect(runPageLoad(FAILURE_DNS).failure?.code).toBe('DNS_PROBE_FINISHED_NXDOMAIN');
    expect(runPageLoad(FAILURE_TLS).failure?.code).toBe('NET::ERR_CERT_DATE_INVALID');
    expect(runPageLoad(FAILURE_TIMEOUT).failure?.code).toBe('ERR_CONNECTION_TIMED_OUT');

    for (const scenario of [FAILURE_DNS, FAILURE_TLS, FAILURE_TIMEOUT]) {
      const failure = runPageLoad(scenario).failure;
      expect(failure?.explanation.length ?? 0).toBeGreaterThan(80);
      expect(failure?.title.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('produces no paint metrics when no page was ever painted', () => {
    const run = runPageLoad(FAILURE_TLS);
    expect(run.metrics.firstPaintMs).toBeUndefined();
    expect(run.metrics.largestContentfulPaintMs).toBeUndefined();
    expect(run.metrics.ttfbMs).toBeUndefined();
  });
});

describe('the topology is derived from the run', () => {
  it('draws a root server for a cold walk and not for a warm one', () => {
    const cold = runPageLoad(FIRST_VISIT_HTTPS);
    const warm = runPageLoad(REPEAT_VISIT_CACHED);

    expect(cold.topology.nodes.map((node) => node.id)).toContain(DNS_ROOT_NODE);
    expect(warm.topology.nodes.map((node) => node.id)).not.toContain(DNS_ROOT_NODE);
  });

  it('never draws a link into a node that is not on the diagram', () => {
    for (const scenario of [
      FIRST_VISIT_HTTPS,
      REPEAT_VISIT_CACHED,
      CDN_HIT,
      FAILURE_DNS,
    ]) {
      const run = runPageLoad(scenario);
      const ids = new Set(run.topology.nodes.map((node) => node.id));
      for (const link of run.topology.links) {
        expect(ids.has(link.from)).toBe(true);
        expect(ids.has(link.to)).toBe(true);
      }
    }
  });

  it('references only nodes that exist, from every event', () => {
    const run = runPageLoad(CDN_HIT);
    const ids = new Set(run.topology.nodes.map((node) => node.id));
    for (const event of run.result.events) {
      if (event.kind === 'transmit') {
        expect(ids.has(event.from)).toBe(true);
        expect(ids.has(event.to)).toBe(true);
      }
      if (event.kind === 'node-state') expect(ids.has(event.nodeId)).toBe(true);
    }
  });
});

describe('every PDU an event names exists in the result', () => {
  it('holds for each scenario that sends anything', () => {
    for (const scenario of [
      FIRST_VISIT_HTTPS,
      CDN_HIT,
      REPEAT_VISIT_CACHED,
      FAILURE_TIMEOUT,
    ]) {
      const run = runPageLoad(scenario);
      for (const event of run.result.events) {
        if (event.kind === 'transmit' || event.kind === 'drop') {
          expect(
            run.result.pdus[event.pduId],
            `${scenario.id}: ${event.pduId}`,
          ).toBeDefined();
        }
      }
    }
  });
});
