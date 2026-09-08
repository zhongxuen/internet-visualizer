'use client';

import { useCallback, useMemo, useState, type ReactNode } from 'react';

import { Panel } from '@/components/ui';
import { cn } from '@/lib/cn';

import { EventLog } from './EventLog';
import { FrameClockContext, type FrameClock } from './frameClock';
import { SimulationCanvasSlot } from './LazyCanvas';
import { usePlayback, usePlaybackState, PlaybackContext } from './hooks/usePlayback';
import { usePlaybackKeys } from './hooks/usePlaybackKeys';
import { useSimulation, type SimulationSource } from './hooks/useSimulation';
import { useSteadyPackets, useVisibleState } from './hooks/useVisibleState';
import { Inspector } from './Inspector';
import { PhaseAnnouncer } from './PhaseAnnouncer';
import { PhaseStepper } from './PhaseStepper';
import { PlaybackControls } from './PlaybackControls';
import { Timeline } from './Timeline';
import { TopologyList } from './TopologyList';
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
 * | TopologyList (collapsible)                          |
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
 * ## Two representations, one state
 *
 * The diagram is not the only way out of this component. `TopologyList` renders the same
 * `Topology` as tab-through buttons and writes to the same selection, and
 * `PhaseAnnouncer` states the current chapter in an `aria-live` region -- so a run is
 * followable, and a network readable, with no pointer and no canvas at all. Both read the
 * state already computed here; neither owns anything of its own.
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
  /**
   * Shorten the diagram and the side column, for a view embedded in something else.
   *
   * A slot cannot do this -- the height belongs to the layout, not to the content -- and
   * a lesson that drops a simulation into the middle of its prose needs one that fits
   * between two paragraphs rather than one that fills the screen. Nothing else changes:
   * same canvas, same controls, same keyboard map, same log.
   */
  compact?: boolean;
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
  compact = false,
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

  /*
    The packets, held still while the same ones are travelling. The sprites move
    themselves from the clock below, so the canvas only ever needs to know *which* packets
    are on the wire; a value that changes sixty times a second would stop it being
    memoized for no reason. See `useSteadyPackets`.
  */
  const packets = useSteadyPackets(visible.inFlight);

  /*
    The playhead, readable by the packet sprites without a render. `virtualTime` above
    still drives everything discrete -- which nodes are lit, which phase is current, how
    much of the log has been reached -- and all of that changes a few dozen times in a
    run. Packet position changes sixty times a second, and this is the path it takes to
    the DOM instead. See `./frameClock.ts`.
  */
  const frameClock = useMemo<FrameClock>(
    () => ({
      now: () => store.getState().virtualTime,
      subscribe: (listener) =>
        store.subscribe((state, previous) => {
          if (state.virtualTime !== previous.virtualTime) listener(state.virtualTime);
        }),
    }),
    [store],
  );

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
      <FrameClockContext value={frameClock}>
        <div className={cn('flex min-h-0 flex-col gap-3', className)}>
          <PhaseAnnouncer phases={result.phases} currentIndex={currentPhaseIndex} />

          {controlPanel}

          <div
            className={cn(
              'grid min-h-0 gap-3',
              compact
                ? 'lg:grid-cols-[minmax(0,1fr)_18rem]'
                : 'lg:grid-cols-[minmax(0,1fr)_22rem]',
            )}
          >
            {/*
              The height lives on this wrapper rather than on the canvas, so the box is
              already the right size before the canvas's chunk has arrived and the
              diagram drops into reserved space. See `./LazyCanvas.tsx`.
            */}
            <div
              className={cn(
                'min-h-0',
                compact ? 'h-[19rem] lg:h-[22rem]' : 'h-[26rem] lg:h-[32rem]',
              )}
            >
              <SimulationCanvasSlot
                topology={topology}
                nodeStates={visible.nodeStates}
                inFlight={packets}
                pdus={result.pdus}
                selection={selection}
                onSelect={select}
                focusNodeIds={focusNodeIds}
                label={label}
              />
            </div>

            <div
              className={cn(
                'flex min-h-0 flex-col gap-3',
                compact ? 'lg:h-[22rem]' : 'lg:h-[32rem]',
              )}
            >
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

          {/*
          The canvas, again, as a list. Second in reading order rather than first because
          the diagram is the product; see the note in `TopologyList` on why it is a
          `<details>` and why that is enough to satisfy "reachable without a pointer".
        */}
          <TopologyList
            topology={topology}
            nodeStates={visible.nodeStates}
            selection={selection}
            onSelect={select}
          />

          <EventLog
            events={result.events}
            virtualTime={virtualTime}
            durationMs={result.durationMs}
            labels={labels}
            pdus={result.pdus}
            onSeek={seek}
          />
        </div>
      </FrameClockContext>
    </PlaybackContext>
  );
}
