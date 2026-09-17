'use client';

import {
  memo,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { useDetail } from '@/components/prefs';
import { Badge, Disclosure, Panel, StepDots, Tabs } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';

import { EventLog } from './EventLog';
import { FrameClockContext, type FrameClock } from './frameClock';
import { SimulationCanvasSlot } from './LazyCanvas';
import { LG_QUERY, useMediaQuery } from './hooks/useMediaQuery';
import { usePlayback, usePlaybackState, PlaybackContext } from './hooks/usePlayback';
import { usePlaybackKeys } from './hooks/usePlaybackKeys';
import { useSimulation, type SimulationSource } from './hooks/useSimulation';
import { useSteadyPackets, useVisibleState } from './hooks/useVisibleState';
import { Inspector } from './Inspector';
import { PhaseStepper } from './PhaseStepper';
import { PlaybackControls } from './PlaybackControls';
import { RunRecap } from './RunRecap';
import {
  nextStory,
  orderDeeperTabs,
  stageMoment,
  type DeeperTab,
  type Detail,
  type StoriesProp,
  type StoryOption,
} from './stage';
import { StageHelp } from './StageHelp';
import { StartOverlay } from './StartOverlay';
import { StepCaption } from './StepCaption';
import { StoryPicker } from './StoryPicker';
import { Timeline } from './Timeline';
import { TopologyList } from './TopologyList';
import type { CanvasSelection } from './types';

/**
 * The Stage: the one layout every module uses (uiux-spec.md §5.3).
 *
 * ```
 * lg and up                                        below lg
 * +------------------------------------------+     +----------------------+
 * | Story picker / input                 (?) |     | Story [select]   (?) |
 * | controlPanel (deprecated)                |     | canvas, 60svh        |
 * +------------------------------+-----------+     |  [Watch it happen]   |
 * | canvas                       | Steps     |     +----------------------+
 * |    [Watch it happen]         |           |     | Step 2 of 4 · ...    |
 * | +--------------------------+ | Details   |     | [Steps][Details][Go deeper]
 * | | Step 2 of 4 · ...        | |           |     | ...                  |
 * +------------------------------+-----------+     |#Back# #Play# #Next# #| <- sticky
 * | Back  Play  Next  ●●○○ ━━━○━━  1x  [x] ⌨ | <- sticky while the stage is in view
 * +------------------------------------------+
 *   footer (deprecated)
 *   > What you'll learn     > Experiment
 *   Go deeper: [tab] [tab] [Advanced tab]      (only the active tab is mounted)
 *   Event log, then the machines as a list
 * ```
 *
 * The point of the whole visualization layer still holds: **building a module means
 * writing a scenario, not animation code.** A module passes its run and, since UX-2.3,
 * its stories (`stories`), the thing a viewer types when there is one (`input`), its
 * knobs (`experiment`), its extra explanations (`deeper`) and a few lines of help
 * (`help`). The types are in `./stage.ts`.
 *
 * `controlPanel` and `footer` still render where they always did -- above the canvas and
 * under the transport -- because ten modules use them until their wave-3 pass. Nothing
 * new should.
 *
 * ## Where the state lives
 *
 * Exactly one piece of mutable state drives everything on screen: `virtualTime`, in the
 * playback store. `useVisibleState` turns it into the picture through `projectAt`. Node
 * highlights, packets in flight, pinned notes, the log, the step caption and the two
 * overlays are all *derived* -- the overlays from `stageMoment`, which changes three
 * times in a run -- which is why scrubbing backwards is exact and why nothing here has to
 * be reset when the playhead moves. The only state of the view's own is the viewer's:
 * what is selected, which tab is open, and whether they closed the recap.
 *
 * ## Two representations, one state
 *
 * `TopologyList` renders the same `Topology` as tab-through buttons and writes to the
 * same selection, and `StepCaption` says the current step in the view's one `aria-live`
 * region -- so a run is followable, and a network readable, with no pointer and no canvas.
 *
 * Selection is the viewer's, not the timeline's, so it survives seeking. A module that
 * needs to know or move it passes `selection` and `onSelect`.
 *
 * ## Reaching the playback store from a slot
 *
 * Every slot renders inside `PlaybackContext`, so its content can call
 * `usePlaybackContext()` and read or seek the playhead.
 *
 * ## Responsive, without a layout shift
 *
 * Every size and position change between phone and desktop is a Tailwind breakpoint, so
 * the server HTML is right at every width. `useMediaQuery` decides only two things that
 * cannot be CSS: the ARIA roles of the phone's Steps / Details / Go deeper tabs, and
 * whether "Go deeper" mounts in that tab or below the stage -- mounting it twice would
 * double the document, and document size is what costs frames on this page (CLAUDE.md).
 *
 * The transport is `position: sticky` to the bottom of the viewport. Sticky is bounded by
 * its parent, so the parent is the stage and not the page: the bar stays in reach while
 * any of the stage is on screen, and settles under the canvas once the reader has
 * scrolled past it.
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
  /** The scenarios to choose between, shown by `StoryPicker` in the stage header. */
  stories?: StoriesProp;
  /** The typed input that is the module: a DNS name, a URL bar, a diagnostics target. */
  input?: ReactNode;
  /** The module's knobs, inside the "Experiment" disclosure below the stage. */
  experiment?: ReactNode;
  /** Extra explanations, as tabs below the stage. Only the active tab is mounted. */
  deeper?: readonly DeeperTab[];
  /** The module's own lines for "How to use this page". */
  help?: readonly string[];
  /**
   * Module-specific controls above the canvas.
   *
   * @deprecated Use `stories`, `input` and `experiment`. Removed in UX-4.3.
   */
  controlPanel?: ReactNode;
  /** Module-specific inspector content, appended below the standard detail. */
  inspectorExtra?: ReactNode;
  /**
   * Module-specific content at full width, below the transport and above the log.
   *
   * @deprecated Use `deeper`. Removed in UX-4.3.
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
   * Shorten the stage, for a view embedded in something else (a lesson).
   *
   * The canvas and side column are shorter, the transport is not sticky, and there is no
   * help button or `?` key: a lesson page may hold several of these, and only a module
   * page is one stage. Same canvas, same controls, same keyboard map, same log.
   */
  compact?: boolean;
  /** Accessible name for the diagram region. */
  label?: string;
  className?: string;
}

type SideTab = 'steps' | 'details' | 'deeper';

const SIDE_TAB_LABEL: Record<SideTab, string> = {
  steps: 'Steps',
  details: 'Details',
  deeper: 'Go deeper',
};

export function SimulationView({
  simulation,
  autoPlay = false,
  speed,
  stories,
  input,
  experiment,
  deeper,
  help,
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
  // A string that changes three times a run, not a number that changes every frame.
  const moment = usePlaybackState(store, (state) =>
    stageMoment(state.status, state.virtualTime),
  );

  const detail = useDetail();
  const isLg = useMediaQuery(LG_QUERY, true);

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
    still drives everything discrete -- which nodes are lit, which step is current, how
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

  const [sideTab, setSideTab] = useState<SideTab>('steps');

  // Uncontrolled by default; `selectionProp` takes over the moment a module passes one.
  const [ownSelection, setOwnSelection] = useState<CanvasSelection | null>(null);
  const controlled = selectionProp !== undefined;
  const selection = controlled ? selectionProp : ownSelection;

  const select = useCallback(
    (next: CanvasSelection | null) => {
      if (!controlled) setOwnSelection(next);
      // On a phone the details are a tab away; choosing something is asking to see them.
      if (next) setSideTab('details');
      onSelect?.(next);
    },
    [controlled, onSelect],
  );

  // The actions are created once with the store, so these are stable for the life of the
  // view -- no memoization needed and no new identity handed to a child each frame.
  const { seek, run, play } = store.getState();

  const currentPhaseIndex = visible.currentPhase?.index ?? -1;

  const selectedStory = stories
    ? (stories.options.find((option) => option.id === stories.selectedId) ??
      stories.options[0])
    : undefined;
  const question = selectedStory?.story?.question;

  /*
    The recap closes on request and comes back at the next end. Reset while rendering, when
    the moment changes, rather than in an effect: React's pattern for state that follows a
    value, and it costs no second commit.
  */
  const [recapDismissed, setRecapDismissed] = useState(false);
  const [recapMoment, setRecapMoment] = useState(moment);
  if (moment !== recapMoment) {
    setRecapMoment(moment);
    if (moment !== 'done') setRecapDismissed(false);
  }

  const rootRef = useRef<HTMLDivElement>(null);
  const dismissRecap = useCallback(() => {
    setRecapDismissed(true);
    // The button that had focus is gone with the recap; Play is where a viewer goes next.
    rootRef.current?.querySelector<HTMLElement>('[data-transport-play]')?.focus();
  }, []);

  const following =
    stories && selectedStory ? nextStory(stories.options, selectedStory.id) : null;
  const onSelectStory = stories?.onSelect;
  const goToNextStory = useMemo(
    () => (following && onSelectStory ? () => onSelectStory(following.id) : undefined),
    [following, onSelectStory],
  );
  const playAgain = useCallback(() => run({ type: 'toggle' }), [run]);

  const deeperTabs = useMemo(
    () => (deeper?.length ? orderDeeperTabs(deeper) : []),
    [deeper],
  );
  const sideTabs: SideTab[] = deeperTabs.length
    ? ['steps', 'details', 'deeper']
    : ['steps', 'details'];
  const activeSideTab = sideTabs.includes(sideTab) ? sideTab : 'steps';

  const tabsId = useId();
  const tabProps = (tab: SideTab) =>
    isLg
      ? {}
      : {
          role: 'tabpanel',
          id: `${tabsId}-panel-${tab}`,
          'aria-labelledby': `${tabsId}-tab-${tab}`,
        };

  /*
    "?" belongs in the stage header, beside the story picker. Until a module passes
    `stories` or `input` there is no header to put it in, and a row holding one round
    button would push the canvas down for nothing -- so it waits in the canvas's top
    corner instead, where nothing else on the canvas sits.
  */
  const hasHeader = Boolean(stories || input);
  const showHelp = !compact;

  return (
    <PlaybackContext value={store}>
      <FrameClockContext value={frameClock}>
        <div ref={rootRef} className={cn('flex min-h-0 flex-col gap-4', className)}>
          {/* The stage: the bounds the sticky transport stays within. */}
          <div className="flex min-h-0 flex-col gap-3">
            {hasHeader ? (
              <div className="flex items-start gap-3">
                <div className="flex min-w-0 flex-1 flex-col gap-3">
                  {stories ? <StoryPicker {...stories} /> : null}
                  {input}
                </div>
                {showHelp ? <StageHelp help={help} className="ml-auto" /> : null}
              </div>
            ) : null}

            {controlPanel}

            <div
              className={cn(
                'grid min-h-0 gap-3',
                compact
                  ? 'lg:grid-cols-[minmax(0,1fr)_18rem]'
                  : 'lg:grid-cols-[minmax(0,1fr)_22rem]',
              )}
            >
              <div className="relative min-w-0">
                {/*
                  The height lives on this box rather than on the canvas, so it is already
                  the right size before the canvas's chunk has arrived and the diagram
                  drops into reserved space (./LazyCanvas.tsx). The overlays are inside it
                  for the same reason: they cover a box that never changes size.
                  ModuleSkeleton copies these heights; change both together.
                */}
                <div
                  className={cn(
                    'relative min-h-0',
                    compact ? 'h-[19rem] lg:h-[22rem]' : 'h-[60svh] lg:h-[32rem]',
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

                  {showHelp && !hasHeader ? (
                    <StageHelp
                      help={help}
                      className="bg-surface-raised absolute top-3 right-3 z-20"
                    />
                  ) : null}

                  {moment === 'ready' ? (
                    <StartOverlay
                      question={question}
                      stepCount={result.phases.length}
                      onStart={play}
                    />
                  ) : null}

                  {moment === 'done' && !recapDismissed ? (
                    <RunRecap
                      phases={result.phases}
                      detail={detail}
                      onPlayAgain={playAgain}
                      onNextStory={goToNextStory}
                      onDismiss={dismissRecap}
                      className="z-30"
                    />
                  ) : null}
                </div>

                <StepCaption
                  phases={result.phases}
                  currentIndex={currentPhaseIndex}
                  moment={moment}
                  detail={detail}
                  question={question}
                  className={cn(
                    // One height for every step: a caption sized to its sentence would move
                    // its edge each time the step changed, which CLS counts as a shift.
                    // Longer text scrolls inside it.
                    'border-border bg-surface-raised mt-3 h-30 rounded-xl border px-4 py-3',
                    'lg:bg-surface-raised/95 lg:absolute lg:inset-x-3 lg:bottom-3 lg:z-20 lg:mt-0 lg:h-36 lg:max-w-3xl lg:shadow-lg',
                  )}
                />
              </div>

              <div
                className={cn(
                  'flex min-h-0 min-w-0 flex-col gap-3',
                  compact ? 'lg:h-[22rem]' : 'lg:h-[32rem]',
                )}
              >
                <SideTabList
                  baseId={tabsId}
                  tabs={sideTabs}
                  active={activeSideTab}
                  onChange={setSideTab}
                  enabled={!isLg}
                />

                <div
                  {...tabProps('steps')}
                  className={cn(
                    'flex min-h-0 flex-col lg:contents',
                    activeSideTab !== 'steps' && 'max-lg:hidden',
                  )}
                >
                  <Panel title="Steps" scroll className="shrink-0 lg:max-h-[55%]">
                    <PhaseStepper
                      phases={result.phases}
                      currentIndex={currentPhaseIndex}
                      onSeek={seek}
                    />
                  </Panel>
                </div>

                <div
                  {...tabProps('details')}
                  className={cn(
                    'flex min-h-0 flex-col lg:contents',
                    activeSideTab !== 'details' && 'max-lg:hidden',
                  )}
                >
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

                {!isLg && deeperTabs.length ? (
                  <div
                    {...tabProps('deeper')}
                    className={cn(activeSideTab !== 'deeper' && 'hidden')}
                  >
                    {activeSideTab === 'deeper' ? <DeeperTabs tabs={deeperTabs} /> : null}
                  </div>
                ) : null}
              </div>
            </div>

            <div
              className={cn(
                'border-border bg-surface-raised rounded-xl border px-2 py-2 sm:px-4',
                !compact && 'sticky bottom-0 z-30 shadow-lg',
              )}
            >
              <PlaybackControls status={status} speed={playbackSpeed} onCommand={run}>
                <StepDots
                  current={currentPhaseIndex + 1}
                  total={result.phases.length}
                  className="shrink-0 max-sm:[&>span:first-child]:hidden"
                />
                <Timeline
                  durationMs={result.durationMs}
                  virtualTime={virtualTime}
                  phases={result.phases}
                  currentPhaseIndex={currentPhaseIndex}
                  onSeek={seek}
                  className="min-w-0 flex-1"
                />
              </PlaybackControls>
            </div>
          </div>

          {footer}

          <BelowStage
            story={selectedStory}
            experiment={experiment}
            deeperTabs={isLg ? deeperTabs : undefined}
            detail={detail}
          />

          <EventLog
            events={result.events}
            virtualTime={virtualTime}
            durationMs={result.durationMs}
            labels={labels}
            pdus={result.pdus}
            onSeek={seek}
          />

          {/*
            The canvas, again, as a list. Last because the diagram is the product; see the
            note in `TopologyList` on why it is a `<details>` and why that is enough to
            satisfy "reachable without a pointer".
          */}
          <TopologyList
            topology={topology}
            nodeStates={visible.nodeStates}
            selection={selection}
            onSelect={select}
          />
        </div>
      </FrameClockContext>
    </PlaybackContext>
  );
}

/**
 * Steps / Details / Go deeper, as tabs, below `lg` only.
 *
 * At `lg` the list is `display: none` and the panels sit side by side; `enabled` is
 * false there, so the panels carry no tab roles either. Arrow keys, `Home` and `End` move
 * between tabs, with one tab stop for the list, as the ARIA tabs pattern has it.
 */
function SideTabList({
  baseId,
  tabs,
  active,
  onChange,
  enabled,
}: {
  baseId: string;
  tabs: readonly SideTab[];
  active: SideTab;
  onChange: (tab: SideTab) => void;
  enabled: boolean;
}) {
  const refs = useRef(new Map<SideTab, HTMLButtonElement | null>());

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1;
    const target =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index + last) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : -1;
    if (target === -1) return;
    event.preventDefault();
    const tab = tabs[target]!;
    onChange(tab);
    refs.current.get(tab)?.focus();
  };

  return (
    <div
      role={enabled ? 'tablist' : undefined}
      aria-label={enabled ? 'About this run' : undefined}
      className="border-border flex items-center gap-1 border-b lg:hidden"
    >
      {tabs.map((tab, index) => {
        const selected = tab === active;
        return (
          <button
            key={tab}
            ref={(node) => {
              refs.current.set(tab, node);
            }}
            type="button"
            id={`${baseId}-tab-${tab}`}
            role={enabled ? 'tab' : undefined}
            aria-selected={enabled ? selected : undefined}
            aria-controls={enabled ? `${baseId}-panel-${tab}` : undefined}
            tabIndex={enabled && !selected ? -1 : 0}
            onClick={() => onChange(tab)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              'min-h-target -mb-px flex-1 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              focusRing,
              selected
                ? 'border-accent text-fg'
                : 'text-fg-muted hover:text-fg border-transparent',
            )}
          >
            {SIDE_TAB_LABEL[tab]}
          </button>
        );
      })}
    </div>
  );
}

/** The "Go deeper" tabs. Only the active tab's `render()` is called. */
function DeeperTabs({ tabs }: { tabs: readonly DeeperTab[] }) {
  const [activeId, setActiveId] = useState(tabs[0]?.id);
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  return (
    <Tabs
      label="Go deeper"
      tabId={active?.id}
      onTabChange={setActiveId}
      tabListClassName="flex-wrap"
      items={tabs.map((tab) => ({
        id: tab.id,
        label: (
          <span className="inline-flex items-center gap-2">
            {tab.title}
            {tab.level === 'advanced' ? <Badge tone="warn">Advanced</Badge> : null}
          </span>
        ),
        content:
          tab.id === active?.id ? (
            <div className="flex min-w-0 flex-col gap-3">
              {tab.hint ? (
                <p className="text-fg-secondary text-body">{tab.hint}</p>
              ) : null}
              {tab.render()}
            </div>
          ) : null,
      }))}
    />
  );
}

/**
 * Everything under the stage that the viewer opens on purpose: what the story teaches,
 * the module's knobs, and "Go deeper".
 *
 * Memoized, because the view re-renders every frame while playing and none of this
 * depends on the playhead. The disclosures are `lazy`: Simple unmounts what it hides
 * rather than hiding it (uiux-spec.md §5.2).
 */
const BelowStage = memo(function BelowStage({
  story,
  experiment,
  deeperTabs,
  detail,
}: {
  story: StoryOption | undefined;
  experiment: ReactNode;
  deeperTabs: readonly DeeperTab[] | undefined;
  detail: Detail;
}) {
  // `null` until the viewer chooses; open by default only in Full detail.
  const [experimentChoice, setExperimentChoice] = useState<boolean | null>(null);
  const headingId = useId();

  const teaches = story?.teaches ?? [];
  if (!teaches.length && !experiment && !deeperTabs?.length) return null;

  return (
    <div className="flex flex-col gap-4">
      {teaches.length || experiment ? (
        <div className="flex flex-col gap-2">
          {teaches.length ? (
            <Disclosure summary="What you'll learn" lazy>
              <ul className="text-fg-secondary flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed">
                {teaches.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </Disclosure>
          ) : null}
          {experiment ? (
            <Disclosure
              summary="Experiment"
              lazy
              open={experimentChoice ?? detail === 'full'}
              onToggle={setExperimentChoice}
            >
              {experiment}
            </Disclosure>
          ) : null}
        </div>
      ) : null}

      {deeperTabs?.length ? (
        <section aria-labelledby={headingId} className="flex flex-col gap-2">
          <h2 id={headingId} className="text-fg text-lead font-semibold">
            Go deeper
          </h2>
          <DeeperTabs tabs={deeperTabs} />
        </section>
      ) : null}
    </div>
  );
});
