'use client';

import { useCallback, useMemo, useState } from 'react';

import {
  AddressVisibilityContext,
  DimmedNodesContext,
  SimulationView,
  type CanvasSelection,
  type VisualizedRun,
} from '@/components/viz';
import type { LayerKey } from '@/lib/theme';

import { AddressToggle } from './components/AddressToggle';
import { GuidedTour } from './components/GuidedTour';
import { LayerFilter } from './components/LayerFilter';
import { NodeDetailTab } from './components/NodeDetailTab';
import { ScenarioPicker } from './components/ScenarioPicker';
import { TopologyLegend } from './components/TopologyLegend';
import { dimmedForLayer } from './layers';
import {
  DEFAULT_SCENARIO_ID,
  getNetworkMapScenario,
  HOME_LAN,
  NETWORK_MAP_SCENARIOS,
} from './scenarios';
import { buildTour, type TourStep } from './tour';

/**
 * The Network Map: four networks, from one house to a datacenter, drawn and explained.
 *
 * Everything here is simulated. No address in any scenario is ever contacted, and this
 * module has no code path that could reach a network even if one were.
 *
 * ## What this file actually is
 *
 * A composition root, and deliberately little else. The diagram, the playback, the
 * keyboard map, the inspector, the phase stepper, and the log are all `SimulationView`'s
 * (phase 04); the networks and the prose are `@/core/topologies`' (shared, because phase
 * 06 animates traffic across these same files); the tour is a `SimResult` built from the
 * scenario's own notes (`./tour.ts`); the layer filter is a set of node ids
 * (`./layers.ts`). What is left over -- five pieces of view state and the wiring between
 * them -- is what a module is supposed to be.
 *
 * ## The five pieces of state
 *
 * - **which scenario** -- state, not a route, so comparing two networks is one click
 * - **which layer is in focus** -- dims the rest; reset when the scenario changes, since
 *   a layer the new topology has no machines at would dim the whole diagram
 * - **whether addresses are drawn** -- on the canvas only; the inspector always has them
 * - **what is selected** -- owned here rather than by the view, because both the tour and
 *   the module's inspector section need to read and move it
 * - **whether the map follows the tour** -- when it does, each stop selects its machine
 *   and brings it into view
 *
 * The playhead is not in that list. It stays where it belongs, in the playback store
 * inside `SimulationView`, and the tour controls reach it through `PlaybackContext`.
 */

/** Stable empty focus, so "no opinion about the camera" is one object, not a new one. */
const NO_FOCUS: readonly string[] = [];

export function NetworkMapModule() {
  const [scenarioId, setScenarioId] = useState<string>(DEFAULT_SCENARIO_ID);
  const [layer, setLayer] = useState<LayerKey | null>(null);
  // Default on: addressing is the teaching content of the first scenario, and the toggle
  // exists so a viewer can put it away, not so they have to go looking for it.
  const [showAddresses, setShowAddresses] = useState(true);
  const [selection, setSelection] = useState<CanvasSelection | null>(null);
  const [following, setFollowing] = useState(false);
  const [focusNodeIds, setFocusNodeIds] = useState<readonly string[]>(NO_FOCUS);

  const scenario = getNetworkMapScenario(scenarioId) ?? HOME_LAN;

  const tour = useMemo(() => buildTour(scenario), [scenario]);

  /**
   * The run, built once per scenario.
   *
   * `useSimulation` memoizes on the identity of what it is handed, and this tree
   * re-renders on every frame while the tour plays -- a fresh object here would rebuild
   * the tour sixty times a second.
   */
  const simulation = useMemo<VisualizedRun>(
    () => ({ topology: scenario.topology, result: tour.result }),
    [scenario, tour],
  );

  const dimmed = useMemo(
    () => dimmedForLayer(scenario.topology, layer),
    [scenario, layer],
  );

  const selectScenario = useCallback((id: string) => {
    setScenarioId(id);
    // A different network is a different picture: nothing selected, nothing dimmed,
    // nothing framed, and the tour back to its own first stop.
    setSelection(null);
    setLayer(null);
    setFollowing(false);
    setFocusNodeIds(NO_FOCUS);
  }, []);

  const followStep = useCallback((step: TourStep) => {
    setSelection({ type: step.target.type, id: step.target.id });
    setFocusNodeIds(step.focusNodeIds);
  }, []);

  const changeFollowing = useCallback((next: boolean) => {
    setFollowing(next);
    // Letting go of the tour hands the camera back: the view returns to the whole
    // diagram rather than staying zoomed in on wherever it stopped.
    if (!next) setFocusNodeIds(NO_FOCUS);
  }, []);

  return (
    <AddressVisibilityContext value={showAddresses}>
      <DimmedNodesContext value={dimmed}>
        <SimulationView
          simulation={simulation}
          label={`${scenario.title} topology`}
          selection={selection}
          onSelect={setSelection}
          focusNodeIds={focusNodeIds}
          controlPanel={
            <div className="flex flex-col gap-3">
              <ScenarioPicker
                scenarios={NETWORK_MAP_SCENARIOS}
                scenarioId={scenario.id}
                onSelect={selectScenario}
              />

              <div className="border-border bg-surface-raised flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-3 py-2">
                <LayerFilter
                  topology={scenario.topology}
                  layer={layer}
                  onChange={setLayer}
                />
                <AddressToggle
                  showAddresses={showAddresses}
                  onChange={setShowAddresses}
                />
                <GuidedTour
                  tour={tour}
                  following={following}
                  onFollowingChange={changeFollowing}
                  onStep={followStep}
                />
              </div>

              <TopologyLegend topology={scenario.topology} />
            </div>
          }
          inspectorExtra={
            <NodeDetailTab scenario={scenario} selection={selection} tour={tour} />
          }
        />
      </DimmedNodesContext>
    </AddressVisibilityContext>
  );
}
