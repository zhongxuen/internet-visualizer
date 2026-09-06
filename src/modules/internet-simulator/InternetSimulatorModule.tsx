'use client';

import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import {
  SimulationView,
  usePlaybackContext,
  usePlaybackState,
  type VisualizedRun,
} from '@/components/viz';
import { cn } from '@/lib/cn';

import { BrowserFrame } from './components/BrowserFrame';
import { NetworkProfileControls } from './components/NetworkProfileControls';
import { StageRail } from './components/StageRail';
import { StageZoom } from './components/StageZoom';
import { UrlBar } from './components/UrlBar';
import { WaterfallChart } from './components/WaterfallChart';
import {
  DEFAULT_SIMULATOR_SCENARIO_ID,
  FIRST_VISIT_HTTPS,
  getSimulatorScenario,
  SIMULATOR_SCENARIOS,
} from './scenarios';
import { runPageLoad, type PageLoadRun } from './sim/pipeline';
import {
  DEFAULT_PROFILE_ID,
  NETWORK_PROFILES,
  type NetworkProfileId,
  type SimulatorScenario,
  type StageId,
} from './sim/stage';
import { buildWaterfall } from './waterfall';

/**
 * Internet Simulator: type a URL, and watch everything happen.
 *
 * The flagship, and a composite rather than a protocol module -- which changes what this
 * file is for. The other six modules each own one protocol and explain it in depth. This one
 * owns none of them: `sim/` composes the eight stages out of `@/core/protocols`, every stage
 * has a dedicated module that explains it better, and what is added here is the thing none
 * of them can show on their own -- the *arrangement*. Eight stages, one timeline, real
 * proportions, and a way out of any of them into the module that goes deeper.
 *
 * Everything is simulated. There is no `fetch` in this module, no socket, no host outside
 * the ranges RFC 2606 and RFC 5737 reserve, and no code path from the address bar to a real
 * name server -- see the note at the top of `input.ts`, which is the safety boundary.
 *
 * ## What this component owns
 *
 * Four pieces of state, and no logic worth the name:
 *
 * - **which scenario** -- one of eight authored page loads.
 * - **the URL** -- committed on submit, not on keystroke. Changing it overrides the
 *   scenario's own URL and leaves everything else about the scenario intact, which is what
 *   makes "the same page load, different host" a controlled comparison instead of a
 *   different run.
 * - **the network profile** -- the same scenario across a different link.
 * - **which stage is zoomed**, or none.
 *
 * The playhead is not among them: it lives in the playback store inside `SimulationView`,
 * and the frame and the waterfall read it through `PlaybackContext` so they advance with
 * the animation without re-rendering this tree every frame.
 *
 * ## Why five runs and not one
 *
 * `NetworkProfileControls` draws the current scenario's load time on all five links at once,
 * because the comparison *is* the lesson and a number a learner has to hold in their head
 * while clicking is not a comparison. A run is a pure function of a scenario and a profile,
 * so five of them are five function calls, memoized together.
 */

/** Scenario, URL override, and profile -- everything a run is made of. */
interface RunInput {
  readonly scenario: SimulatorScenario;
  readonly url: string;
  readonly profileId: NetworkProfileId;
}

/** The scenario as run: its own declarations, with whatever is in the address bar. */
function scenarioFor(input: RunInput): SimulatorScenario {
  return input.url === input.scenario.url
    ? input.scenario
    : { ...input.scenario, url: input.url };
}

/** The playhead, as the panels below the timeline read it. */
function useNow(): number {
  const store = usePlaybackContext();
  return usePlaybackState(store, (state) => state.virtualTime);
}

/**
 * Everything below the timeline, inside the playback context.
 *
 * Split out because the rail seeks and the frame follows: both need the store, and a
 * component that reads the playhead re-renders on every animation frame. Keeping that
 * inside this subtree is what stops the address bar and the scenario picker from
 * re-rendering sixty times a second.
 */
function Workbench({
  run,
  loadByProfile,
  profileId,
  onProfileChange,
  selectedStage,
  onSelectStage,
}: {
  run: PageLoadRun;
  loadByProfile: Readonly<Partial<Record<NetworkProfileId, number>>>;
  profileId: NetworkProfileId;
  onProfileChange: (id: NetworkProfileId) => void;
  selectedStage: StageId | null;
  onSelectStage: (id: StageId | null) => void;
}) {
  const store = usePlaybackContext();
  const now = useNow();

  const waterfall = useMemo(() => buildWaterfall(run), [run]);
  const zoomed = run.stages.find((stage) => stage.id === selectedStage);
  // The address bar is validated before a run is made, so this parse cannot fail for a
  // committed URL; the stage's own parse is preferred when it exists.
  const parsed = run.state.url ?? undefined;

  const seek = (ms: number) => store.getState().seek(ms);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <StageRail
        stages={run.stages}
        durationMs={run.result.durationMs}
        selected={selectedStage}
        onSelect={(id) => {
          const next = id === selectedStage ? null : id;
          onSelectStage(next);
          const stage = run.stages.find((entry) => entry.id === id);
          if (next && stage) seek(stage.startMs);
        }}
        {...(run.failure ? { failure: run.failure } : {})}
      />

      {zoomed && parsed ? (
        <StageZoom
          run={run}
          stage={zoomed}
          url={parsed}
          onSeek={seek}
          onClose={() => onSelectStage(null)}
        />
      ) : null}

      <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <BrowserFrame run={run} now={now} />
        <NetworkProfileControls
          value={profileId}
          onChange={onProfileChange}
          loadByProfile={loadByProfile}
        />
      </div>

      <WaterfallChart
        waterfall={waterfall}
        {...(run.metrics.firstPaintMs === undefined
          ? {}
          : { firstPaintMs: run.metrics.firstPaintMs })}
        {...(run.metrics.largestContentfulPaintMs === undefined
          ? {}
          : { largestContentfulPaintMs: run.metrics.largestContentfulPaintMs })}
        now={now}
        onSeek={seek}
      />
    </div>
  );
}

export function InternetSimulatorModule() {
  const [scenarioId, setScenarioId] = useState<string>(DEFAULT_SIMULATOR_SCENARIO_ID);

  const scenario = useMemo(
    () => getSimulatorScenario(scenarioId) ?? FIRST_VISIT_HTTPS,
    [scenarioId],
  );

  // The URL and the profile default to the scenario's own and are then owned by the user.
  // Both are re-seeded during render when the scenario changes, rather than by an effect:
  // an effect would render one frame of the new scenario carrying the old scenario's URL.
  const [url, setUrl] = useState(scenario.url);
  const [profileId, setProfileId] = useState<NetworkProfileId>(
    scenario.profileId ?? DEFAULT_PROFILE_ID,
  );
  const [seeded, setSeeded] = useState(scenario);
  if (seeded !== scenario) {
    setSeeded(scenario);
    setUrl(scenario.url);
    setProfileId(scenario.profileId ?? DEFAULT_PROFILE_ID);
  }

  const [selectedStage, setSelectedStage] = useState<StageId | null>(null);

  const running = useMemo(
    () => scenarioFor({ scenario, url, profileId }),
    [scenario, url, profileId],
  );

  // One run for the page, and five more for the profile comparison. All pure, all memoized
  // on the same inputs, so nothing here recomputes while the animation plays.
  const run = useMemo(
    () => runPageLoad(running, { profile: profileId }),
    [running, profileId],
  );

  const loadByProfile = useMemo(() => {
    const times: Partial<Record<NetworkProfileId, number>> = {};
    for (const profile of NETWORK_PROFILES) {
      times[profile.id] =
        profile.id === profileId
          ? run.metrics.loadMs
          : runPageLoad(running, { profile: profile.id }).metrics.loadMs;
    }
    return times;
  }, [running, profileId, run]);

  const simulation = useMemo<VisualizedRun>(
    () => ({ topology: run.topology, result: run.result }),
    [run],
  );

  return (
    <SimulationView
      simulation={simulation}
      label={`${scenario.title} page load`}
      controlPanel={
        <div className="flex flex-col gap-3">
          <UrlBar value={url} onSubmit={(next) => setUrl(next)} />

          <div role="group" aria-label="Scenario" className="flex flex-wrap gap-1.5">
            {SIMULATOR_SCENARIOS.map((entry, index) => {
              const active = entry.id === scenarioId;

              return (
                <button
                  key={entry.id}
                  type="button"
                  aria-pressed={active}
                  title={entry.summary}
                  onClick={() => {
                    setScenarioId(entry.id);
                    setSelectedStage(null);
                  }}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                    focusRing,
                    active
                      ? 'border-accent/60 bg-accent/12 text-fg'
                      : 'border-border bg-surface-raised text-fg-secondary hover:border-border-strong hover:bg-surface-overlay hover:text-fg',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'font-mono text-[0.6875rem]',
                      active ? 'text-accent' : 'text-fg-muted',
                    )}
                  >
                    {index + 1}
                  </span>
                  {entry.title}
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-fg-secondary max-w-3xl text-sm leading-relaxed">
              {scenario.summary}
            </p>
            <ul aria-label="What this run teaches" className="flex flex-wrap gap-1.5">
              {scenario.teaches.map((topic) => (
                <li key={topic}>
                  <Badge tone="neutral">{topic}</Badge>
                </li>
              ))}
            </ul>
            {url !== scenario.url ? (
              <p className="text-fg-muted text-xs leading-relaxed">
                Running this scenario against{' '}
                <span className="text-fg-secondary font-mono">{url}</span> instead of the
                host it was written for. Everything else about the scenario is unchanged,
                so the difference you see is the host.
              </p>
            ) : null}
          </div>
        </div>
      }
      footer={
        <Workbench
          run={run}
          loadByProfile={loadByProfile}
          profileId={profileId}
          onProfileChange={setProfileId}
          selectedStage={selectedStage}
          onSelectStage={setSelectedStage}
        />
      }
    />
  );
}
