/**
 * The pipeline -- eight stages, one timeline.
 *
 * Each stage is a pure function that emits its events in **local** virtual time, starting
 * at zero, and reports how long it took. This file does the only three things none of them
 * can do for themselves:
 *
 * 1. **Shift.** Every event's `at` moves by the offset accumulated from the stages before
 *    it. A `transmit`'s `durationMs` does not move, because it is a length rather than an
 *    instant -- so a packet sent at the end of one stage is legitimately still in flight
 *    during the next, which is what pipelining looks like and is not a bookkeeping error.
 * 2. **Tag.** Every event is labelled with the stage that produced it, so the rail can
 *    highlight a stage's own events, the waterfall can attribute a segment, and a click on
 *    the rail can seek the timeline to the right place.
 * 3. **Stop.** A stage that fails ends the run. The stages after it are reported as
 *    `not-reached` rather than omitted, because "TLS never got a turn" is the explanation
 *    a learner needs and an absent row does not give it.
 *
 * Because offsets are the only source of absolute time, the stage rail's proportions are
 * the stages' real durations by construction. There is no second set of numbers to drift.
 *
 * ## A duration is not "when the last packet lands"
 *
 * A stage's `durationMs` is **when the next stage may begin**, and the two are not always
 * the same thing. TLS 1.3 is the clear case: the client sends its Finished and its HTTP
 * request in the same flight, so the TLS stage ends when the request may go out, while the
 * server's own completion and its post-handshake session ticket are still in the air. In
 * 0-RTT the stage's duration is literally zero and the whole handshake overlaps the request.
 *
 * Those events are emitted where they really happen, past the stage's `endMs`, and the
 * pipeline does not clip them -- clipping would make the timeline agree with the rail by
 * lying about the protocol. The invariant that does hold is the one that matters: **nothing
 * a stage emits happens before that stage starts**, and every stage opens with its own
 * `phase` event exactly on its `startMs`.
 *
 * ## Why the state is threaded rather than shared
 *
 * A stage reads {@link PipelineState} and returns a patch. Nothing is mutated in place, so
 * running the same scenario twice cannot produce two different answers, and a stage can be
 * tested by handing it a hand-built state with no pipeline involved at all.
 *
 * Specified in docs/implementation/11-module-internet-simulator.md.
 */

import { createRng } from '@/core/sim/rng';
import { summarizePhases, type SimResult } from '@/core/sim/result';
import type { SimEvent } from '@/core/types/events';
import type { PDU } from '@/core/types/pdu';
import type { Topology } from '@/core/types/topology';

import { buildPage, retarget, warmCache, type PageModel } from './page';
import { buildTopology, nodesUsedBy, pruneTopology } from './topology';
import {
  BROWSER_NODE,
  DEFAULT_PROFILE_ID,
  networkProfile,
  round2,
  shiftEvent,
  SIM_CLOCK,
  STAGE_IDS,
  STAGE_TITLES,
  type BrowserFailure,
  type NetworkProfile,
  type NetworkProfileId,
  type PipelineState,
  type SimulatorScenario,
  type Stage,
  type StageContext,
  type StageId,
} from './stage';
import { cacheCheckStage } from './stages/cache-check';
import { cdnStage } from './stages/cdn-stage';
import { dnsStage } from './stages/dns-stage';
import { httpStage } from './stages/http-stage';
import { renderStage } from './stages/render-stage';
import { tcpStage } from './stages/tcp-stage';
import { tlsStage } from './stages/tls-stage';
import { urlParseStage } from './stages/url-parse';

/**
 * The eight stages, in order.
 *
 * This list is the pipeline. Adding a stage is adding an entry here and an id in
 * `stage.ts`; nothing else in the module hardcodes the sequence.
 */
export const STAGES: Readonly<Record<StageId, Stage>> = {
  'url-parse': urlParseStage,
  'cache-check': cacheCheckStage,
  dns: dnsStage,
  tcp: tcpStage,
  tls: tlsStage,
  http: httpStage,
  cdn: cdnStage,
  render: renderStage,
};

/** Whether a stage ran, was made unnecessary, or never got a turn. */
export type StageStatus =
  /** It ran and took time. */
  | 'ran'
  /** It ran and had nothing to do, or an earlier stage made it unnecessary. */
  | 'skipped'
  /** The run ended before this stage. */
  | 'not-reached';

/** One stage's place on the finished timeline. */
export interface StageRun {
  readonly id: StageId;
  readonly title: string;
  readonly status: StageStatus;
  /** Absolute virtual millisecond this stage begins. */
  readonly startMs: number;
  /** Absolute virtual millisecond the next stage begins. */
  readonly endMs: number;
  readonly durationMs: number;
  /** Share of the whole run, `0` to `1` -- what the rail draws. */
  readonly share: number;
  /** One line: what happened here. */
  readonly summary: string;
  /** Why it did not run. Present only when `status` is not `'ran'`. */
  readonly skipReason?: string;
  /** This stage's own events, already shifted onto the shared timeline. */
  readonly events: readonly SimEvent[];
}

/** The numbers a user actually feels, in absolute virtual milliseconds. */
export interface PageMetrics {
  /** Time to first byte of the document. `undefined` when nothing was sent. */
  readonly ttfbMs?: number;
  /** The first frame. */
  readonly firstPaintMs?: number;
  /** The largest contentful paint. */
  readonly largestContentfulPaintMs?: number;
  /**
   * The last byte of the last resource.
   *
   * Not the same as `SimResult.durationMs`, which carries a short tail past the end so the
   * timeline does not stop mid-animation. This is the number to quote.
   */
  readonly loadMs: number;
  /** Every byte the client's link carried, headers included. */
  readonly transferredBytes: number;
  /** Requests that actually crossed the network. */
  readonly networkRequests: number;
  /** Requests answered without crossing the network. */
  readonly cachedRequests: number;
}

/** A finished page load. */
export interface PageLoadRun {
  readonly scenario: SimulatorScenario;
  readonly profile: NetworkProfile;
  /** Only the machines this run actually touched. */
  readonly topology: Topology;
  readonly result: SimResult;
  /**
   * Which stage produced each event in `result.events`, index for index.
   *
   * A parallel array rather than a field on the event, because `SimEvent` is the shared
   * contract every module's renderer reads and it does not know this module exists.
   */
  readonly eventStages: readonly StageId[];
  readonly stages: readonly StageRun[];
  readonly state: PipelineState;
  /** Set when the browser showed an error page instead of the site. */
  readonly failure?: BrowserFailure;
  readonly metrics: PageMetrics;
  readonly page: PageModel;
}

/** How a run may be varied without editing the scenario. */
export interface RunOptions {
  /** Re-run the same scenario across a different link. */
  readonly profile?: NetworkProfileId;
}

/** Look one stage up in a finished run. */
export function stageOf(run: PageLoadRun, id: StageId): StageRun | undefined {
  return run.stages.find((stage) => stage.id === id);
}

/** The events one stage produced, in timeline order. */
export function eventsForStage(run: PageLoadRun, id: StageId): readonly SimEvent[] {
  return stageOf(run, id)?.events ?? [];
}

/**
 * Sort by time, keeping emission order within one instant.
 *
 * `pdu-created` and the `transmit` that references it share a virtual millisecond, and the
 * log reads as nonsense the other way round. `Array.prototype.sort` has been required to
 * be stable since ES2019, so pairing each event with its index is enough.
 */
function sortTagged(
  tagged: readonly { event: SimEvent; stage: StageId }[],
): { event: SimEvent; stage: StageId }[] {
  return [...tagged].sort((a, b) => a.event.at - b.event.at);
}

/** Run one scenario end to end. */
export function runPageLoad(
  scenario: SimulatorScenario,
  options: RunOptions = {},
): PageLoadRun {
  const profile = networkProfile(
    options.profile ?? scenario.profileId ?? DEFAULT_PROFILE_ID,
  );
  const rng = createRng(scenario.seed ?? `internet-simulator:${scenario.id}`);
  const fullTopology = buildTopology(scenario, profile);

  // The host and the document's target come from the URL, so the page model, the cache
  // keys, and the request line all agree with what is in the address bar.
  const hostMatch = /^[a-z]+:\/\/([^/?#:]+)/i.exec(scenario.url);
  const host = (hostMatch?.[1] ?? scenario.url).toLowerCase();
  const targetMatch = /^[a-z]+:\/\/[^/?#]*([^#]*)/i.exec(scenario.url);
  const target = targetMatch?.[1] ? targetMatch[1] : '/';
  const page = retarget(buildPage(scenario, host), target);

  const version = scenario.tls?.alpn === 'http/1.1' ? 'HTTP/1.1' : 'HTTP/2';
  const browserCache = warmCache(
    'browser',
    page,
    scenario.stored ?? [],
    version,
    profile.rttMs,
  );

  let state: PipelineState = { page, browserCache };
  let offset = 0;
  let failure: BrowserFailure | undefined;

  const tagged: { event: SimEvent; stage: StageId }[] = [];
  const pdus: Record<string, PDU> = {};
  const runs: StageRun[] = [];
  const skipAhead = new Map<StageId, string>();

  for (const id of STAGE_IDS) {
    if (failure) {
      runs.push({
        id,
        title: STAGE_TITLES[id],
        status: 'not-reached',
        startMs: offset,
        endMs: offset,
        durationMs: 0,
        share: 0,
        summary: 'Never reached',
        skipReason: `The run ended in the ${failure.stage} stage, so this never got a turn.`,
        events: [],
      });
      continue;
    }

    const alreadySkipped = skipAhead.get(id);
    if (alreadySkipped !== undefined) {
      runs.push({
        id,
        title: STAGE_TITLES[id],
        status: 'skipped',
        startMs: offset,
        endMs: offset,
        durationMs: 0,
        share: 0,
        summary: 'Skipped',
        skipReason: alreadySkipped,
        events: [],
      });
      continue;
    }

    const context: StageContext = {
      stage: id,
      scenario,
      profile,
      clock: SIM_CLOCK,
      topology: fullTopology,
      rng,
      state,
    };

    const output = STAGES[id](context);
    const shifted = output.events.map((event) => shiftEvent(event, offset));
    for (const event of shifted) tagged.push({ event, stage: id });
    Object.assign(pdus, output.pdus ?? {});

    const duration = output.skipped ? 0 : round2(output.durationMs);
    const startMs = offset;
    const endMs = round2(offset + duration);

    runs.push({
      id,
      title: STAGE_TITLES[id],
      status: output.skipped ? 'skipped' : 'ran',
      startMs,
      endMs,
      durationMs: duration,
      share: 0,
      summary: output.summary,
      ...(output.skipped ? { skipReason: output.skipped } : {}),
      events: shifted,
    });

    if (output.state) state = { ...state, ...output.state };
    for (const [target, reason] of Object.entries(output.skipAhead ?? {})) {
      skipAhead.set(target as StageId, reason);
    }

    offset = endMs;

    if (output.failure) {
      failure = { ...output.failure, stage: id };
    }
  }

  // --- The finished timeline --------------------------------------------------
  const durationMs = round2(Math.max(offset, ...tagged.map((entry) => entry.event.at)));
  const sorted = sortTagged(tagged);
  const events = sorted.map((entry) => entry.event);

  const stages = runs.map((stage) => ({
    ...stage,
    share: durationMs === 0 ? 0 : round2(stage.durationMs / durationMs),
  }));

  // Notes are pinned by phase id, so the boundaries have to exist before one can be
  // placed: summarize once, fold the notes in, then summarize the final list.
  const provisional = summarizePhases(events, durationMs);
  const withNotes = [...sorted];
  for (const note of scenario.notes ?? []) {
    const phase = provisional.find((candidate) => candidate.id === note.phase);
    if (!phase) {
      // A note pinned to a phase the run never produced is normally an authoring bug and
      // should fail loudly. It is not one when the run ended early: a scenario whose URL
      // has been overridden from the address bar can NXDOMAIN three stages in, and the
      // notes written for the five stages that never happened are then missing for the
      // obvious reason rather than the wrong one. So the check still holds for every run
      // that completed, and a truncated run simply drops the notes it never reached.
      if (failure) continue;
      throw new Error(
        `scenario "${scenario.id}" pins a note to phase "${note.phase}", which this run does not have. It has: ${provisional.map((each) => each.id).join(', ')}`,
      );
    }
    withNotes.push({
      event: {
        kind: 'annotate',
        at: phase.startMs,
        targetId: note.target ?? BROWSER_NODE,
        text: note.text,
        ...(note.reference ? { reference: note.reference } : {}),
      },
      stage: (STAGE_IDS.find((id) => note.phase.startsWith(id)) ??
        'url-parse') as StageId,
    });
  }

  const finalSorted = sortTagged(withNotes);
  const finalEvents = finalSorted.map((entry) => entry.event);

  const result: SimResult = {
    events: finalEvents,
    phases: summarizePhases(finalEvents, durationMs),
    durationMs,
    pdus,
  };

  const topology = pruneTopology(fullTopology, nodesUsedBy(finalEvents));

  return {
    scenario,
    profile,
    topology,
    result,
    eventStages: finalSorted.map((entry) => entry.stage),
    stages,
    state,
    ...(failure ? { failure } : {}),
    metrics: metricsFor(stages, state),
    page,
  };
}

/** Derive the numbers a user feels from the stages that produced them. */
function metricsFor(stages: readonly StageRun[], state: PipelineState): PageMetrics {
  const cdnStageRun = stages.find((stage) => stage.id === 'cdn');
  const renderStageRun = stages.find((stage) => stage.id === 'render');

  const ttfbMs =
    state.cdn && cdnStageRun && cdnStageRun.status === 'ran'
      ? round2(cdnStageRun.startMs + state.cdn.firstByteAt)
      : undefined;

  const renderStart = renderStageRun?.startMs ?? 0;
  const firstPaintMs =
    state.render && renderStageRun?.status === 'ran'
      ? round2(renderStart + state.render.firstPaintAt)
      : undefined;
  const largestContentfulPaintMs =
    state.render && renderStageRun?.status === 'ran'
      ? round2(renderStart + state.render.largestContentfulPaintAt)
      : undefined;

  const cachedRequests =
    (state.render?.fetches.filter((fetch) => fetch.source === 'browser-cache').length ??
      0) + (state.cache?.skipsNetwork ? 1 : 0);
  const networkRequests =
    (state.render?.fetches.filter((fetch) => fetch.source === 'network').length ?? 0) +
    (state.http ? 1 : 0);

  return {
    ...(ttfbMs === undefined ? {} : { ttfbMs }),
    ...(firstPaintMs === undefined ? {} : { firstPaintMs }),
    ...(largestContentfulPaintMs === undefined ? {} : { largestContentfulPaintMs }),
    loadMs:
      state.render && renderStageRun?.status === 'ran'
        ? round2(renderStart + state.render.loadAt)
        : round2(
            stages
              .filter((stage) => stage.status === 'ran')
              .reduce((latest, stage) => Math.max(latest, stage.endMs), 0),
          ),
    transferredBytes:
      (state.cdn?.transferredBytes ?? 0) + (state.render?.transferredBytes ?? 0),
    networkRequests,
    cachedRequests,
  };
}
