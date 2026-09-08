'use client';

import { useCallback, useMemo, useState } from 'react';

import {
  labelsFor,
  SimulationView,
  usePlaybackContext,
  usePlaybackState,
  usePlayheadCursor,
  type VisualizedRun,
} from '@/components/viz';

import { EncapsulationPanel } from './components/EncapsulationPanel';
import { HopTable } from './components/HopTable';
import { JourneyControls } from './components/JourneyControls';
import { NatTable } from './components/NatTable';
import { buildLedger, focusAt, type HopRow, type PacketFocus } from './ledger';
import { AUTHORED_OPTIONS, journeyOverrides, type JourneyOptions } from './options';
import {
  DEFAULT_JOURNEY_ID,
  getJourneyScenario,
  PACKET_JOURNEY_SCENARIOS,
  TCP_WEB_REQUEST,
} from './scenarios';
import { runJourneyDetailed, type JourneyRunResult } from './sim/journey';

/**
 * Packet Journey: one packet, from an application on one machine to an application on
 * another, with nothing about the trip hidden.
 *
 * Everything here is simulated. No address in any scenario is ever contacted, and this
 * module has no code path that could reach a network if one were.
 *
 * ## What this file is
 *
 * A composition root, and deliberately little else. The protocol logic is `sim/`'s, the
 * runs are `scenarios/`', the diagram and playback are `SimulationView`'s (phase 04), and
 * the two derivations the UI needs -- the hop ledger and the packet under the playhead --
 * are pure functions in `./ledger.ts`. What is left is two pieces of state and the wiring
 * between them.
 *
 * ## The two pieces of state
 *
 * - **which scenario** -- state rather than a route, so comparing two journeys is one
 *   click
 * - **which knobs have been turned** -- reset when the scenario changes, because "1492"
 *   chosen against a scenario built on the access line means something different against
 *   one that is not
 *
 * The playhead is not in that list. It stays in the playback store inside
 * `SimulationView`, and the three live panels below reach it through `PlaybackContext` --
 * which is also why re-running the simulation is safe: changing a knob hands the view a
 * new `SimResult`, and `usePlayback` restarts the timeline rather than dropping the
 * viewer into the middle of a run they have not seen the start of.
 *
 * ## Why the run is memoized twice
 *
 * `runJourneyDetailed` is a full simulation, and this tree re-renders on every frame
 * while the animation plays. The run is memoized on the scenario and the options; the
 * `{ topology, result }` pair handed to `useSimulation` is memoized on the run, because
 * that hook keys on identity and a fresh object each frame would re-run everything sixty
 * times a second.
 */

/*
  The three panels below follow the playhead, and all three ask it the same kind of
  question: which hop has started, which bindings exist, what has been done to the packet
  so far. Every one of those is settled by which events have happened, so they read
  `usePlayheadCursor` rather than `virtualTime` -- the same number for every frame between
  two events, which is the difference between rendering these tables a few dozen times in
  a run and rendering them sixty times a second. Nothing here is continuous; the one
  continuous thing on screen is a packet, and it positions itself (`PacketSprite`).

  Before phase 14's performance pass these subscribed to `virtualTime` directly, and this
  route measured 1.6 fps of playback under a 4x CPU throttle.
*/

/**
 * Everything about a focus that can change, as one string.
 *
 * The packet itself is carried by identity: a rewrite is a `pdu-transform` event, so `at`
 * moves whenever the layers do.
 */
function focusKey(focus: PacketFocus | undefined): string {
  if (!focus) return '';
  return [focus.pdu.id, focus.status, focus.at, focus.nodeId, focus.linkId].join('|');
}

function LiveEncapsulation({
  result,
  labels,
}: {
  result: JourneyRunResult['result'];
  labels: Readonly<Record<string, string>>;
}) {
  const store = usePlaybackContext();

  /*
    This one cannot use `usePlayheadCursor`, and the reason is worth stating: a packet
    stops being in flight when it lands, at `at + durationMs`, and that instant is not an
    event. The cursor would hold the panel on "in flight" until the *next* event fired.
    `ledger.test.ts` asserts exactly this divergence, so the shortcut cannot be taken here
    by accident later.

    So the selector runs the derivation every frame and returns its identity; React only
    re-renders when that string changes, which is a few dozen times in a run. `focusAt` is
    one pass over the events -- far cheaper than the render it is avoiding.
  */
  const key = usePlaybackState(store, (state) =>
    focusKey(focusAt(result, state.virtualTime)),
  );
  const focus = useMemo(
    () => focusAt(result, store.getState().virtualTime),
    // `key` is the dependency that matters; the playhead is read fresh when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result, key, store],
  );

  return (
    <EncapsulationPanel focus={focus} labels={labels} className="lg:max-h-[34rem]" />
  );
}

function LiveHopTable({
  result,
  rows,
  durationMs,
  labels,
}: {
  result: JourneyRunResult['result'];
  rows: readonly HopRow[];
  durationMs: number;
  labels: Readonly<Record<string, string>>;
}) {
  const store = usePlaybackContext();
  const cursor = usePlayheadCursor(result);
  const { seek } = store.getState();

  return (
    <HopTable
      rows={rows}
      virtualTime={cursor}
      durationMs={durationMs}
      onSeek={seek}
      labels={labels}
    />
  );
}

function LiveNatTable({
  run,
  routerLabel,
}: {
  run: JourneyRunResult;
  routerLabel: string;
}) {
  // Also not the cursor: a binding's `createdAt` and `lastUsedAt` are moments in the
  // translation, not entries in the event list, so they fall between events. The table is
  // a handful of rows, which is why this one is left reading the playhead directly rather
  // than given an identity of its own. `ledger.test.ts` pins the divergence.
  const store = usePlaybackContext();
  const cursor = usePlaybackState(store, (state) => state.virtualTime);
  if (!run.natTable) return null;

  return (
    <NatTable
      table={run.natTable}
      routerLabel={routerLabel}
      virtualTime={cursor}
      durationMs={run.result.durationMs}
    />
  );
}

export function PacketJourneyModule() {
  const [scenarioId, setScenarioId] = useState<string>(DEFAULT_JOURNEY_ID);
  const [options, setOptions] = useState<JourneyOptions>(AUTHORED_OPTIONS);

  const scenario = getJourneyScenario(scenarioId) ?? TCP_WEB_REQUEST;

  const run = useMemo(
    () => runJourneyDetailed(scenario, journeyOverrides(scenario, options)),
    [scenario, options],
  );

  const simulation = useMemo<VisualizedRun>(
    () => ({ topology: scenario.topology, result: run.result }),
    [scenario, run],
  );

  const rows = useMemo(() => buildLedger(run.result, scenario.topology), [run, scenario]);

  const labels = useMemo(() => labelsFor(scenario.topology), [scenario]);

  const selectScenario = useCallback((id: string) => {
    setScenarioId(id);
    // A different journey is a different lesson: the knobs go back to what that scenario
    // was written with rather than carrying one scenario's "what if" into the next.
    setOptions(AUTHORED_OPTIONS);
  }, []);

  return (
    <SimulationView
      simulation={simulation}
      label={`${scenario.title} packet journey`}
      controlPanel={
        <JourneyControls
          scenarios={PACKET_JOURNEY_SCENARIOS}
          scenarioId={scenario.id}
          onScenarioChange={selectScenario}
          options={options}
          onOptionsChange={setOptions}
        />
      }
      footer={
        <div className="grid min-w-0 gap-3 xl:grid-cols-[20rem_minmax(0,1fr)]">
          <LiveEncapsulation result={run.result} labels={labels} />

          <div className="flex min-w-0 flex-col gap-3">
            <LiveHopTable
              result={run.result}
              rows={rows}
              durationMs={run.result.durationMs}
              labels={labels}
            />
            {scenario.nat ? (
              <LiveNatTable
                run={run}
                routerLabel={labels[scenario.nat.nodeId] ?? scenario.nat.nodeId}
              />
            ) : null}
          </div>
        </div>
      }
    />
  );
}
