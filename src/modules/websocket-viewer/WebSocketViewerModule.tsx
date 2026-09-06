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

import { CloseCodeTable } from './components/CloseCodeTable';
import { ConnectionHealth } from './components/ConnectionHealth';
import { FrameInspector } from './components/FrameInspector';
import { MessageStream } from './components/MessageStream';
import { TransportComparison } from './components/TransportComparison';
import {
  DEFAULT_WEBSOCKET_SCENARIO_ID,
  getWebSocketScenario,
  HANDSHAKE_AND_CHAT,
  WEBSOCKET_SCENARIOS,
} from './scenarios';
import { UpgradePanel } from './components/UpgradePanel';
import { runWebSocketScenario, type WebSocketRun } from './sim/exchange';

/**
 * WebSocket Viewer: the connection that stops being HTTP, and everything on the far side.
 *
 * Everything here is simulated. There is no `WebSocket` constructor in this module, no
 * `fetch`, no host name outside the TLDs RFC 2606 reserves, and no address outside the RFC
 * 5737 documentation ranges. The handshake, the frames, the masking, and the transport
 * comparison are all computed by pure functions in `sim/`, and this file draws what they
 * return.
 *
 * ## What this file is
 *
 * A composition root, and deliberately little else. The protocol is `sim/`'s, the seven
 * authored runs are `scenarios/`', playback and the diagram are `SimulationView`'s, and the
 * panels are the components beside this file. What is left is two pieces of state and one
 * decision about which panels a scenario gets.
 *
 * ## The two pieces of state
 *
 * - **which run** — one of seven. State rather than a route, so putting the fragmented
 *   message next to the unfragmented one is one click.
 * - **which frame is selected**, stamped with the run it was chosen against. A frame id from
 *   the previous scenario means nothing on this one, so it is compared during render rather
 *   than cleared by an effect — an effect would show one frame of an inspector describing a
 *   frame that is not there.
 *
 * The playhead is not in that list. It lives in the playback store inside `SimulationView`,
 * and the panels that need it reach it through `PlaybackContext` — which is how the transport
 * lanes fill in step with the animation without this component re-rendering the world on
 * every frame.
 *
 * ## Why the panel set changes with the scenario
 *
 * Because a panel with nothing to say is worse than no panel. The close-code table belongs
 * beside the run that closes; the backoff ladder belongs beside the one that drops. The frame
 * inspector and the message stream are on every scenario that has frames, because those two
 * are the module — and the transport comparison replaces both on the one scenario that has no
 * connection at all.
 */

/** The playhead, as the panels below the timeline read it. */
function useNow(): number {
  const store = usePlaybackContext();
  return usePlaybackState(store, (state) => state.virtualTime);
}

/** The transport race, wired to the playhead so all four lanes advance together. */
function LiveComparison({ run }: { run: WebSocketRun }) {
  const now = useNow();
  if (run.detail.kind !== 'comparison') return null;
  return <TransportComparison comparison={run.detail.comparison} now={now} />;
}

/** The stream and the inspector, side by side and sharing one selection. */
function FrameWorkbench({
  run,
  selectedId,
  onSelect,
}: {
  run: WebSocketRun;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const store = usePlaybackContext();
  const now = useNow();
  const current = run.frames.find((record) => record.id === selectedId) ?? run.frames[0];

  return (
    <div className="grid min-w-0 gap-3 xl:grid-cols-2">
      <MessageStream
        frames={run.frames}
        now={now}
        durationMs={run.result.durationMs}
        selectedId={current?.id ?? null}
        onSelect={(record) => {
          onSelect(record.id);
          store.getState().seek(record.receivedAt);
        }}
        className="max-h-[34rem]"
      />
      <FrameInspector {...(current ? { record: current } : {})} />
    </div>
  );
}

/**
 * How many reconnection attempts actually ran.
 *
 * Read off the handshake that succeeded rather than counted separately, so the ladder cannot
 * disagree with the run: the scenario schedules five attempts and the third one connects, so
 * the last two are drawn as "not needed" rather than silently dropped.
 */
function attemptsUsed(run: WebSocketRun): number {
  const reconnection = run.handshakes.find((record) => record.id.startsWith('attempt-'));
  const parsed = Number.parseInt(reconnection?.id.slice('attempt-'.length) ?? '', 10);
  return Number.isNaN(parsed) ? run.handshakes.length : parsed;
}

/** The scenario-specific panel, or nothing when the run's own frames say it all. */
function DetailPanel({ run }: { run: WebSocketRun }) {
  const detail = run.detail;

  switch (detail.kind) {
    case 'keepalive':
      return (
        <div className="grid min-w-0 gap-3 xl:grid-cols-2">
          <ConnectionHealth keepalive={detail.keepalive} />
          <CloseCodeTable
            {...(detail.server.closeCode === undefined
              ? {}
              : { activeCode: detail.server.closeCode })}
          />
        </div>
      );
    case 'reconnect':
      return (
        <div className="grid min-w-0 gap-3 xl:grid-cols-2">
          <ConnectionHealth
            backoff={{
              schedule: detail.schedule,
              withoutJitter: detail.withoutJitter,
              explain: detail.explain,
              used: attemptsUsed(run),
            }}
          />
          <CloseCodeTable activeCode={1006} />
        </div>
      );
    case 'session':
      return detail.client.closeCode === undefined ? null : (
        <CloseCodeTable activeCode={detail.client.closeCode} />
      );
    default:
      return null;
  }
}

export function WebSocketViewerModule() {
  const [scenarioId, setScenarioId] = useState<string>(DEFAULT_WEBSOCKET_SCENARIO_ID);
  const [selected, setSelected] = useState<{ run: WebSocketRun; id: string } | null>(
    null,
  );
  const [handshakeId, setHandshakeId] = useState<string | null>(null);

  const scenario = useMemo(
    () => getWebSocketScenario(scenarioId) ?? HANDSHAKE_AND_CHAT,
    [scenarioId],
  );

  // A whole run, and this tree re-renders every frame while the animation plays, so the run
  // is memoized on the scenario and everything derived is memoized on the run.
  const run = useMemo(() => runWebSocketScenario(scenario), [scenario]);

  const simulation = useMemo<VisualizedRun>(
    () => ({ topology: run.topology, result: run.result }),
    [run],
  );

  // A frame id from the previous run means nothing on this one, so the selection is stamped
  // with the run it was made against and compared during render.
  const selectedId = selected && selected.run === run ? selected.id : null;
  const handshake =
    run.handshakes.find((record) => record.id === handshakeId) ?? run.handshakes[0];

  return (
    <SimulationView
      simulation={simulation}
      label={`${scenario.title} WebSocket run`}
      controlPanel={
        <div className="flex flex-col gap-3">
          <div role="group" aria-label="Scenario" className="flex flex-wrap gap-1.5">
            {WEBSOCKET_SCENARIOS.map((entry, index) => {
              const active = entry.id === scenarioId;

              return (
                <button
                  key={entry.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setScenarioId(entry.id);
                    setSelected(null);
                    setHandshakeId(null);
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
          </div>
        </div>
      }
      footer={
        <div className="flex min-w-0 flex-col gap-3">
          {handshake ? (
            <UpgradePanel
              handshake={handshake}
              handshakes={run.handshakes}
              onSelect={setHandshakeId}
            />
          ) : null}

          {run.frames.length > 0 ? (
            <FrameWorkbench
              run={run}
              selectedId={selectedId}
              onSelect={(id) => setSelected({ run, id })}
            />
          ) : null}

          <DetailPanel run={run} />

          {run.detail.kind === 'comparison' ? <LiveComparison run={run} /> : null}
        </div>
      }
    />
  );
}
