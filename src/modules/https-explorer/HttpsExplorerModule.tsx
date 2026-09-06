'use client';

import { useCallback, useMemo, useState } from 'react';

import { Badge } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import {
  SimulationView,
  usePlaybackContext,
  usePlaybackState,
  type VisualizedRun,
} from '@/components/viz';
import { cn } from '@/lib/cn';

import { CertificateChain } from './components/CertificateChain';
import { CipherSuiteBreakdown } from './components/CipherSuiteBreakdown';
import { EncryptionOverlay, type OverlayView } from './components/EncryptionOverlay';
import { HandshakeLadder } from './components/HandshakeLadder';
import { KeyScheduleDiagram } from './components/KeyScheduleDiagram';
import { VersionComparison } from './components/VersionComparison';
import {
  DEFAULT_TLS_SCENARIO_ID,
  getTlsScenario,
  TLS13_FRESH,
  TLS12_FRESH,
  TLS_SCENARIOS,
} from './scenarios';
import {
  DEFAULT_TLS12_SUITE,
  DEFAULT_TLS13_SUITE,
  getCipherSuite,
  type CipherSuite,
} from '@/core/protocols/tls/cipher';
import { runTlsScenario, type TlsRun } from './sim/connection';
import {
  VERSION_COMPARISON,
  type Tls12Handshake,
} from '@/core/protocols/tls/handshake12';
import type { HandshakeMessage, Tls13Handshake } from '@/core/protocols/tls/handshake13';

/**
 * HTTPS Explorer: the handshake, the keys, and what the padlock actually checked.
 *
 * Everything here is simulated and there is no cryptography in it. Every host, address,
 * certificate and key is a bundled fixture; every "secret" on screen is a placeholder
 * derived from a label string, and `sim/placeholder.ts` says so in the one sentence the
 * key-schedule panel prints at the top. Nothing in this module can reach a network --
 * there is no `fetch` and no code path that could acquire one.
 *
 * ## What this file is
 *
 * A composition root. The protocol is `sim/`'s, the seven authored runs are
 * `scenarios/`', playback and the diagram are `SimulationView`'s, and the five views are
 * the components beside this file. What is left is three pieces of state.
 *
 * ## The three pieces of state
 *
 * - **which run** — one of seven scenarios. State rather than a route, so putting the
 *   expired certificate next to the good one is one click.
 * - **which view** — participant or observer. This is the module's headline control and
 *   it is deliberately *not* local to the overlay: it also drives the handshake ladder,
 *   so switching it changes what the whole page claims to be able to read. A toggle that
 *   only changed one panel would teach that the observer view is a special display rather
 *   than a different vantage point on the same connection.
 * - **which message is expanded**, stamped with the run it was made against. A message id
 *   from the previous scenario means nothing on this one, so it is compared during render
 *   rather than cleared by an effect — an effect would show one frame of a message that
 *   is not there.
 *
 * The playhead is not in that list. It lives in the playback store inside
 * `SimulationView`, and the panels reach it through `PlaybackContext`, which is how the
 * ladder and the overlay dim what has not been sent yet without this component
 * re-rendering the world on every frame.
 *
 * ## The comparison runs
 *
 * `VersionComparison` needs both handshakes on one clock whatever scenario is loaded, so
 * the two reference runs are computed once at module scope. They are pure, deterministic
 * and cheap, and computing them per render would be the only expensive thing on the page.
 */

/** The two reference handshakes the comparison is always drawn from. */
const REFERENCE_13 = runTlsScenario(TLS13_FRESH).handshake as Tls13Handshake;
const REFERENCE_12 = runTlsScenario(TLS12_FRESH).handshake as Tls12Handshake;

/** The other version's usual suite, for the breakdown's compare line. */
function otherSuite(suite: CipherSuite): CipherSuite | undefined {
  return getCipherSuite(
    suite.version === 'TLS 1.3' ? DEFAULT_TLS12_SUITE : DEFAULT_TLS13_SUITE,
  );
}

/** The playhead, as the panels below the timeline read it. */
function useNow(): number {
  const store = usePlaybackContext();
  return usePlaybackState(store, (state) => state.virtualTime);
}

function LiveLadder({
  run,
  view,
  selectedId,
  onSelect,
}: {
  run: TlsRun;
  view: OverlayView;
  selectedId: string | null;
  onSelect: (message: HandshakeMessage | null) => void;
}) {
  const store = usePlaybackContext();
  const now = useNow();

  // Selecting a message also seeks to it, so the diagram above and the ladder below are
  // never describing different moments.
  const select = useCallback(
    (message: HandshakeMessage | null) => {
      onSelect(message);
      if (message) store.getState().seek(message.at);
    },
    [onSelect, store],
  );

  return (
    <HandshakeLadder
      messages={run.messages}
      flights={run.flights}
      encryptionStartsAt={run.handshake.encryptionStartsAt}
      view={view}
      now={now}
      selectedId={selectedId}
      onSelect={select}
      notes={run.handshake.notes}
      {...(run.abort ? { abort: run.abort } : {})}
    />
  );
}

function LiveOverlay({
  run,
  view,
  onViewChange,
}: {
  run: TlsRun;
  view: OverlayView;
  onViewChange: (view: OverlayView) => void;
}) {
  const now = useNow();
  return (
    <EncryptionOverlay run={run} view={view} onViewChange={onViewChange} now={now} />
  );
}

const VIEW_OPTIONS: readonly { value: OverlayView; label: string; hint: string }[] = [
  {
    value: 'participant',
    label: 'Participant view',
    hint: 'What the two endpoints hold: the actual request and response.',
  },
  {
    value: 'observer',
    label: 'Observer view',
    hint: 'What a machine on the path holds: headers, lengths, SNI, timings.',
  },
];

export function HttpsExplorerModule() {
  const [scenarioId, setScenarioId] = useState<string>(DEFAULT_TLS_SCENARIO_ID);
  const [view, setView] = useState<OverlayView>('participant');
  const [selected, setSelected] = useState<{ run: TlsRun; id: string } | null>(null);

  const scenario = useMemo(() => getTlsScenario(scenarioId) ?? TLS13_FRESH, [scenarioId]);

  // A whole connection, and this tree re-renders every frame while the animation plays,
  // so the run is memoized on the scenario and everything derived is memoized on the run.
  const run = useMemo(() => runTlsScenario(scenario), [scenario]);

  const simulation = useMemo<VisualizedRun>(
    () => ({ topology: run.topology, result: run.result }),
    [run],
  );

  // A message id from the previous run means nothing on this one, so the selection is
  // stamped with the run it was made against and compared during render.
  const selectedId = selected && selected.run === run ? selected.id : null;

  return (
    <SimulationView
      simulation={simulation}
      label={`${scenario.title} TLS connection`}
      controlPanel={
        <div className="flex flex-col gap-3">
          <div role="group" aria-label="Scenario" className="flex flex-wrap gap-1.5">
            {TLS_SCENARIOS.map((entry, index) => {
              const active = entry.id === scenarioId;

              return (
                <button
                  key={entry.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setScenarioId(entry.id);
                    setSelected(null);
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

          <div className="border-border bg-surface-raised flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2">
            <span className="text-fg-muted text-[0.625rem] tracking-widest uppercase">
              Reading this connection as
            </span>
            <div role="group" aria-label="Vantage point" className="flex gap-1.5">
              {VIEW_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={view === option.value}
                  title={option.hint}
                  onClick={() => setView(option.value)}
                  className={cn(
                    'rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
                    focusRing,
                    view === option.value
                      ? option.value === 'observer'
                        ? 'border-state-warn/60 bg-state-warn/12 text-fg'
                        : 'border-accent/60 bg-accent/12 text-fg'
                      : 'border-border bg-surface text-fg-secondary hover:border-border-strong hover:text-fg',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="text-fg-muted min-w-0 flex-1 text-[0.625rem] leading-snug">
              {VIEW_OPTIONS.find((option) => option.value === view)?.hint}
            </p>
          </div>
        </div>
      }
      footer={
        <div className="flex min-w-0 flex-col gap-3">
          <div className="grid min-w-0 gap-3 xl:grid-cols-2">
            <LiveLadder
              run={run}
              view={view}
              selectedId={selectedId}
              onSelect={(message) =>
                setSelected(message ? { run, id: message.id } : null)
              }
            />
            <LiveOverlay run={run} view={view} onViewChange={setView} />
          </div>

          <div className="grid min-w-0 gap-3 xl:grid-cols-2">
            <KeyScheduleDiagram schedule={run.keySchedule} />
            <CertificateChain
              store={scenario.store}
              {...(scenario.chain ? { chain: scenario.chain } : {})}
              {...(run.validation ? { validation: run.validation } : {})}
            />
          </div>

          {/*
            The suite breakdown sits beside the version comparison rather than in the
            inspector, which only renders when something on the diagram is selected. The
            pairing is not arbitrary: "why is this name two words shorter?" is a version
            question, and the answer is the row beside it.
          */}
          <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
            <CipherSuiteBreakdown
              suite={run.suite}
              {...(() => {
                const other = otherSuite(run.suite);
                return other ? { compareWith: other } : {};
              })()}
            />
            <VersionComparison
              tls12={REFERENCE_12}
              tls13={REFERENCE_13}
              rows={VERSION_COMPARISON}
              current={scenario.version}
            />
          </div>
        </div>
      }
    />
  );
}
