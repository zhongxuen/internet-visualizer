'use client';

import { useCallback, useState, type ReactNode } from 'react';

import { Panel } from '@/components/ui';
import { cn } from '@/lib/cn';

import { EventLog } from './EventLog';
import { usePlayback, usePlaybackState, PlaybackContext } from './hooks/usePlayback';
import { usePlaybackKeys } from './hooks/usePlaybackKeys';
import { useSimulation, type SimulationSource } from './hooks/useSimulation';
import { useVisibleState } from './hooks/useVisibleState';
import { Inspector } from './Inspector';
import { PhaseStepper } from './PhaseStepper';
import { PlaybackControls } from './PlaybackControls';
import { SimulationCanvas } from './SimulationCanvas';
import { Timeline } from './Timeline';
import type { CanvasSelection } from './types';

/**
 * The composed default layout every module uses.
 *
 * ```
 * +---------------------------+-------------------------+
 * |                           |  PhaseStepper           |
 * |     SimulationCanvas      |  Inspector              |
 * +---------------------------+-------------------------+
 * | Timeline + PlaybackControls                         |
 * +-----------------------------------------------------+
 * | footer (module slot, full width)                    |
 * +-----------------------------------------------------+
 * | EventLog (collapsible)                              |
 * +-----------------------------------------------------+
 * ```
 *
 * This is the point of the whole phase: **building a module means writing a scenario and
 * a scenario picker, not writing animation code.** A module renders one of these, passes
 * its run in, and gets playback, keyboard control, an inspector, a phase stepper, and a
 * log. Anything module-specific goes in a slot -- `controlPanel` above the diagram,
 * `inspectorExtra` below the standard detail, `footer` at full width beneath the
 * timeline -- so a module that needs something unusual overrides a slot rather than
 * forking the layout.
 *
 * ## Where the state lives
 *
 * Exactly one piece of mutable state drives everything on screen: `virtualTime`, in the
 * playback store. Every frame, `useVisibleState` turns that one number into the whole
 * picture through `projectAt`. Node highlights, packets in flight, pinned notes, and the
 * log are all *derived*, which is why scrubbing backwards is exact and why nothing here
 * has to be reset when the playhead moves.
 *
 * Selection is the one exception -- what the user has clicked is theirs, not the
 * timeline's, so it survives seeking. A module that needs to *know* what is selected (an
 * inspector tab about the selected machine) or to *move* it (a guided tour walking the
 * topology) passes `selection` and `onSelect` and owns it instead; the view falls back to
 * owning it whenever `selection` is omitted, which is the usual case.
 *
 * ## Reaching the playback store from a slot
 *
 * `controlPanel`, `inspectorExtra`, and `footer` render inside `PlaybackContext`, so slot
 * content can call `usePlaybackContext()` and read or seek the playhead. That is how a
 * module builds its own controls (a tour that follows the phase stepper, a hop table that
 * seeks) without this component growing a prop for each one.
 *
 * ## Responsive
 *
 * Below `lg` the side column stacks under the canvas and the diagram takes the full
 * width. The canvas itself is pan/zoom/fit-view at any size, so the layout never depends
 * on a fixed pixel viewport.
 */

export interface SimulationViewProps {
  /**
   * The run to visualize, and the topology it ran on. A thunk is evaluated once (see
   * `useSimulation`); it must be stable across renders.
   */
  simulation: SimulationSource;
  /** Start playing on mount. Ignored under reduced motion. */
  autoPlay?: boolean;
  /** Starting playback speed. */
  speed?: number;
  /** Module-specific controls -- a scenario picker, protocol options. Above the canvas. */
  controlPanel?: ReactNode;
  /** Module-specific inspector content, appended below the standard detail. */
  inspectorExtra?: ReactNode;
  /**
   * Module-specific content at full width, below the timeline and above the log.
   *
   * The side column is 22rem wide and the control panel sits above the diagram, so
   * neither can hold a wide running ledger -- Packet Journey's hop table is one, and this
   * is the slot it goes in. Like the other slots it renders inside `PlaybackContext`, so
   * its content can read and seek the playhead.
   */
  footer?: ReactNode;
  /**
   * Controlled selection. Omit to let the view own what is selected and simply listen
   * through `onSelect`.
   */
  selection?: CanvasSelection | null;
  /** Fired on every selection change, however it was made. `null` when cleared. */
  onSelect?: (selection: CanvasSelection | null) => void;
  /**
   * Machines to bring into view; changing the set pans and zooms onto them, emptying it
   * returns to the whole diagram. Omit unless something is driving the camera.
   */
  focusNodeIds?: readonly string[];
  /** Accessible name for the diagram region. */
  label?: string;
  className?: string;
}

export function SimulationView({
  simulation,
  autoPlay = false,
  speed,
  controlPanel,
  inspectorExtra,
  footer,
  selection: selectionProp,
  onSelect,
  focusNodeIds,
  label,
  className,
}: SimulationViewProps) {
  const { topology, result, labels } = useSimulation(simulation);
  const store = usePlayback({ result, autoPlay, speed });

  usePlaybackKeys(store);

  const virtualTime = usePlaybackState(store, (state) => state.virtualTime);
  const status = usePlaybackState(store, (state) => state.status);
  const playbackSpeed = usePlaybackState(store, (state) => state.speed);

  const visible = useVisibleState(result, virtualTime);

  // Uncontrolled by default; `selectionProp` takes over the moment a module passes one.
  const [ownSelection, setOwnSelection] = useState<CanvasSelection | null>(null);
  const controlled = selectionProp !== undefined;
  const selection = controlled ? selectionProp : ownSelection;

  const select = useCallback(
    (next: CanvasSelection | null) => {
      if (!controlled) setOwnSelection(next);
      onSelect?.(next);
    },
    [controlled, onSelect],
  );

  // The actions are created once with the store, so these are stable for the life of the
  // view -- no memoization needed and no new identity handed to a child each frame.
  const { seek, run } = store.getState();

  const currentPhaseIndex = visible.currentPhase?.index ?? -1;

  return (
    <PlaybackContext value={store}>
      <div className={cn('flex min-h-0 flex-col gap-3', className)}>
        {controlPanel}

        <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <SimulationCanvas
            topology={topology}
            nodeStates={visible.nodeStates}
            inFlight={visible.inFlight}
            pdus={result.pdus}
            selection={selection}
            onSelect={select}
            focusNodeIds={focusNodeIds}
            className="h-[26rem] lg:h-[32rem]"
            label={label}
          />

          <div className="flex min-h-0 flex-col gap-3 lg:h-[32rem]">
            <Panel title="Phases" scroll className="shrink-0 lg:max-h-[55%]">
              <PhaseStepper
                phases={result.phases}
                currentIndex={currentPhaseIndex}
                onSeek={seek}
              />
            </Panel>

            <Inspector
              topology={topology}
              selection={selection}
              pdus={result.pdus}
              nodeStates={visible.nodeStates}
              annotations={visible.activeAnnotations}
              onSelect={select}
              className="min-h-0 flex-1"
            >
              {inspectorExtra}
            </Inspector>
          </div>
        </div>

        <div className="border-border bg-surface-raised flex flex-col gap-3 rounded-xl border px-4 py-3">
          <Timeline
            durationMs={result.durationMs}
            virtualTime={virtualTime}
            phases={result.phases}
            currentPhaseIndex={currentPhaseIndex}
            onSeek={seek}
          />
          <PlaybackControls status={status} speed={playbackSpeed} onCommand={run} />
        </div>

        {footer}

        <EventLog
          events={result.events}
          virtualTime={virtualTime}
          durationMs={result.durationMs}
          labels={labels}
          pdus={result.pdus}
          onSeek={seek}
        />
      </div>
    </PlaybackContext>
  );
}
