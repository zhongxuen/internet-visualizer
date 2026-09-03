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

import { CacheStatePanel } from './components/CacheStatePanel';
import { CookieJarPanel } from './components/CookieJarPanel';
import { CorsVerdict } from './components/CorsVerdict';
import { HeaderExplainer } from './components/HeaderExplainer';
import { RequestBuilder } from './components/RequestBuilder';
import { StatusCodeMap } from './components/StatusCodeMap';
import { VersionComparison } from './components/VersionComparison';
import { WireView } from './components/WireView';
import {
  builderScenario,
  BUILDER_SCENARIO_ID,
  DEFAULT_REQUEST_DRAFT,
  parseRequestDraft,
  type BuiltRequest,
  type RequestDraft,
} from './builder';
import {
  DEFAULT_HTTP_SCENARIO_ID,
  getHttpScenario,
  HTTP_SCENARIOS,
  SIMPLE_GET,
} from './scenarios';
import { runHttpScenario, type HttpExchange, type HttpRun } from './sim/exchange';
import type { CrlfDisplay } from './sim/message';
import { sourceForStatus } from './statuses';
import { wireMessages, wireResponse } from './wire';

/**
 * HTTP Explorer: a request and a response, byte by byte.
 *
 * Everything here is simulated. Every origin, every route, and every address comes from
 * the fixtures in `scenarios/` and `builder.ts`, and nothing typed into the builder --
 * or clicked on the status map -- can cause a real request. There is no `fetch` anywhere
 * in this module and no code path that could acquire one; the live network tools are
 * phase 12 and live on their own badged surface, which is the point of keeping them
 * apart.
 *
 * ## What this file is
 *
 * A composition root, and deliberately little else. The protocol is `sim/`'s, the seven
 * authored runs are `scenarios/`', the diagram and playback are `SimulationView`'s
 * (phase 04), and the three derivations the UI needs -- what crossed the wire, what a
 * field means, and which run produces a status -- are pure functions in `./wire.ts`,
 * `./headers.ts` and `./statuses.ts`, each with its own tests. What is left is four
 * pieces of state and the wiring between them.
 *
 * ## The four pieces of state
 *
 * - **which run** -- one of the seven authored scenarios, or the request built in the
 *   panel. State rather than a route, so comparing a conditional request against a
 *   cookie session is one click.
 * - **the form** -- kept here rather than inside the builder so that picking a scenario
 *   can leave it alone, and so that sending the same request twice produces a new run
 *   object and therefore an actual re-run.
 * - **which exchange is pinned** -- the request and response in the wire view. Stamped
 *   with the run it was made against and compared during render, because an index from
 *   the previous run means nothing on this one and an effect that cleared it would show
 *   one frame of the wrong message.
 * - **which field is selected**, and **how terminators are drawn**. Both belong to the
 *   reader rather than to the run, so neither is reset when the scenario changes.
 *
 * The playhead is not in that list. It stays in the playback store inside
 * `SimulationView`, and the live panels below reach it through `PlaybackContext` --
 * which is also why re-running is safe: a new `SimResult` restarts the timeline rather
 * than dropping the viewer into the middle of a run they have not seen the start of.
 */

/** The exchanges that have finished by the playhead. Empty before the first one lands. */
function useExchangesSoFar(run: HttpRun): readonly HttpExchange[] {
  const store = usePlaybackContext();
  const virtualTime = usePlaybackState(store, (state) => state.virtualTime);
  return run.exchanges.filter((exchange) => exchange.receivedAt <= virtualTime);
}

/** The exchange the panels are describing: the pinned one, or the latest one so far. */
function useCurrentExchange(
  run: HttpRun,
  pinnedIndex: number | null,
): { exchange: HttpExchange | undefined; soFar: readonly HttpExchange[] } {
  const soFar = useExchangesSoFar(run);
  const pinned = pinnedIndex === null ? undefined : run.exchanges[pinnedIndex];
  return { exchange: pinned ?? soFar.at(-1) ?? undefined, soFar };
}

function LiveWireView({
  run,
  pinnedIndex,
  crlf,
  onCrlfChange,
  selected,
  onSelectHeader,
}: {
  run: HttpRun;
  pinnedIndex: number | null;
  crlf: CrlfDisplay;
  onCrlfChange: (display: CrlfDisplay) => void;
  selected: { name: string; value: string; id: string } | null;
  onSelectHeader: (next: { name: string; value: string; id: string } | null) => void;
}) {
  const { exchange } = useCurrentExchange(run, pinnedIndex);

  // Before the playhead reaches anything, show the run's first exchange rather than an
  // empty box. The bytes are the point of this module and an empty centrepiece on load
  // is a poor first thing to see -- but it is labelled as not having happened yet, and
  // the caches and the jar beside it stay empty, because those two are about
  // accumulation over time and previewing them would be a claim rather than a preview.
  const preview = exchange ?? run.exchanges[0];
  if (!preview) {
    return (
      <div className="border-border bg-surface-raised text-fg-muted rounded-xl border px-4 py-6 text-xs leading-relaxed">
        This run has no exchange to show.
      </div>
    );
  }

  const { request, response, reconstructedNote } = wireMessages(preview);
  const pending =
    exchange === undefined
      ? 'Not sent yet — this is the first exchange of the run, shown so there is ' +
        'something to read. Press play, or pick an exchange from the ledger above.'
      : undefined;
  const note = [pending, reconstructedNote].filter(Boolean).join(' ');

  return (
    <WireView
      request={request}
      response={response}
      version={preview.request.version}
      crlf={crlf}
      onCrlfChange={onCrlfChange}
      selectedId={selected?.id ?? null}
      onSelectHeader={onSelectHeader}
      requestMessage={preview.request}
      responseMessage={wireResponse(preview)}
      secure={run.scenario.secure ?? false}
      {...(note ? { note } : {})}
    />
  );
}

function LiveCachePanel({
  run,
  pinnedIndex,
}: {
  run: HttpRun;
  pinnedIndex: number | null;
}) {
  const { exchange, soFar } = useCurrentExchange(run, pinnedIndex);
  const shown = exchange ? [...soFar.filter((e) => e !== exchange), exchange] : soFar;

  return (
    <CacheStatePanel
      exchanges={shown}
      views={run.cacheViews}
      hasCdn={run.cdnCache !== undefined}
    />
  );
}

function LiveCookiePanel({
  run,
  pinnedIndex,
}: {
  run: HttpRun;
  pinnedIndex: number | null;
}) {
  const { exchange, soFar } = useCurrentExchange(run, pinnedIndex);
  const shown = exchange ? [...soFar.filter((e) => e !== exchange), exchange] : soFar;

  return <CookieJarPanel jar={run.jar} exchanges={shown} />;
}

/**
 * The cross-origin verdict, which renders itself away for a same-origin exchange.
 *
 * It follows the same preview rule as the wire view rather than the accumulate rule of
 * the caches: it describes one exchange, and the whole point of it is legible before the
 * playhead has moved.
 */
function LiveCorsVerdict({
  run,
  pinnedIndex,
}: {
  run: HttpRun;
  pinnedIndex: number | null;
}) {
  const { exchange } = useCurrentExchange(run, pinnedIndex);
  const shown = exchange ?? run.exchanges[0];

  return shown ? <CorsVerdict exchange={shown} /> : null;
}

function LiveStatusMap({
  run,
  pinnedIndex,
  onSelect,
}: {
  run: HttpRun;
  pinnedIndex: number | null;
  onSelect: (code: number) => void;
}) {
  const { exchange, soFar } = useCurrentExchange(run, pinnedIndex);
  const seen = soFar.map((entry) => wireResponse(entry).status);
  const active = exchange ? [...seen, wireResponse(exchange).status] : seen;

  return <StatusCodeMap active={active} onSelect={onSelect} />;
}

/** The running ledger: every exchange, clickable, so the wire view can be pinned. */
function ExchangeLedger({
  run,
  pinnedIndex,
  onPin,
}: {
  run: HttpRun;
  pinnedIndex: number | null;
  onPin: (index: number | null) => void;
}) {
  const store = usePlaybackContext();
  const virtualTime = usePlaybackState(store, (state) => state.virtualTime);
  const { seek } = store.getState();

  return (
    <div
      role="group"
      aria-label="Exchanges in this run"
      className="border-border bg-surface-raised flex flex-wrap gap-1.5 rounded-xl border px-3 py-2"
    >
      {run.exchanges.map((exchange, index) => {
        const arrived = exchange.receivedAt <= virtualTime;
        const pinned = pinnedIndex === index;
        const status = wireResponse(exchange).status;

        return (
          <button
            key={exchange.id}
            type="button"
            aria-pressed={pinned}
            title={exchange.note}
            onClick={() => {
              onPin(pinned ? null : index);
              seek(exchange.receivedAt);
            }}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[0.625rem] transition-colors',
              focusRing,
              pinned
                ? 'border-accent/60 bg-accent/12 text-fg'
                : arrived
                  ? 'border-border bg-surface text-fg-secondary hover:border-border-strong'
                  : 'border-border/50 bg-surface text-fg-muted opacity-60',
            )}
          >
            {exchange.kind !== 'request' ? (
              <span className="text-fg-muted">{exchange.kind}</span>
            ) : null}
            <span>
              {exchange.request.method} {exchange.request.target}
            </span>
            <span
              className={cn(
                status >= 500
                  ? 'text-state-error'
                  : status >= 400
                    ? 'text-state-warn'
                    : status >= 300
                      ? 'text-accent'
                      : 'text-state-ok',
              )}
            >
              {status}
            </span>
            {exchange.blockedFromPage ? (
              <span className="text-state-error">blocked</span>
            ) : null}
          </button>
        );
      })}
      {pinnedIndex !== null ? (
        <button
          type="button"
          onClick={() => onPin(null)}
          className={cn(
            'border-border text-fg-muted hover:text-fg rounded-md border px-2 py-1 text-[0.625rem] transition-colors',
            focusRing,
          )}
        >
          follow the playhead
        </button>
      ) : null}
    </div>
  );
}

export function HttpExplorerModule() {
  const [scenarioId, setScenarioId] = useState<string>(DEFAULT_HTTP_SCENARIO_ID);
  const [draft, setDraft] = useState<RequestDraft>(DEFAULT_REQUEST_DRAFT);
  const [built, setBuilt] = useState<BuiltRequest | null>(null);
  const [pinned, setPinned] = useState<{ run: HttpRun; index: number } | null>(null);
  const [selected, setSelected] = useState<{
    name: string;
    value: string;
    id: string;
  } | null>(null);
  const [crlf, setCrlf] = useState<CrlfDisplay>('hidden');

  const custom = scenarioId === BUILDER_SCENARIO_ID && built !== null;

  const scenario = useMemo(
    () =>
      custom && built
        ? builderScenario(built)
        : (getHttpScenario(scenarioId) ?? SIMPLE_GET),
    [custom, built, scenarioId],
  );

  // `runHttpScenario` is a whole page load and this tree re-renders on every frame while
  // the animation plays, so the run is memoized on the scenario and everything derived
  // from it is memoized on the run.
  const run = useMemo(() => runHttpScenario(scenario), [scenario]);

  const simulation = useMemo<VisualizedRun>(
    () => ({ topology: run.topology, result: run.result }),
    [run],
  );

  // An index from the previous run means nothing on this one, so the pin is stamped with
  // the run it was made against and compared during render rather than cleared by an
  // effect -- which would show one frame of an exchange that is not there any more.
  const pinnedIndex = pinned && pinned.run === run ? pinned.index : null;

  const submit = useCallback((next: BuiltRequest) => {
    // A new object every time, even for an identical request: that is what makes pressing
    // Send again re-run the exchange rather than do nothing.
    setBuilt(next);
    setScenarioId(BUILDER_SCENARIO_ID);
    setPinned(null);
  }, []);

  /** A status code was clicked: load whatever produces it. */
  const goToStatus = useCallback((code: number) => {
    const source = sourceForStatus(code);
    if (!source) return;

    setPinned(null);
    if (source.kind === 'scenario') {
      setScenarioId(source.scenarioId);
      setBuilt(null);
      return;
    }
    const next: RequestDraft = { ...DEFAULT_REQUEST_DRAFT, ...source.draft };
    // Through the same validator the form uses, even though this draft came from a table
    // in this repository rather than from a text field. A second way into
    // `builderScenario` would be a second thing to keep safe, and `statuses.test.ts`
    // asserts every draft here validates -- so this branch cannot silently go missing.
    const parsed = parseRequestDraft(next);
    if (!parsed.ok) return;

    setDraft(next);
    setBuilt(parsed.value);
    setScenarioId(BUILDER_SCENARIO_ID);
  }, []);

  return (
    <SimulationView
      simulation={simulation}
      label={`${scenario.title} HTTP exchange`}
      controlPanel={
        <div className="flex flex-col gap-3">
          <div role="group" aria-label="Scenario" className="flex flex-wrap gap-1.5">
            {HTTP_SCENARIOS.map((entry, index) => {
              const active = !custom && entry.id === scenarioId;

              return (
                <button
                  key={entry.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setScenarioId(entry.id);
                    setBuilt(null);
                    setPinned(null);
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

          <RequestBuilder draft={draft} onDraftChange={setDraft} onSubmit={submit} />
        </div>
      }
      footer={
        <div className="flex min-w-0 flex-col gap-3">
          <ExchangeLedger
            run={run}
            pinnedIndex={pinnedIndex}
            onPin={(index) => setPinned(index === null ? null : { run, index })}
          />

          <LiveCorsVerdict run={run} pinnedIndex={pinnedIndex} />

          <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <LiveWireView
              run={run}
              pinnedIndex={pinnedIndex}
              crlf={crlf}
              onCrlfChange={setCrlf}
              selected={selected}
              onSelectHeader={setSelected}
            />
            <HeaderExplainer
              name={selected?.name ?? null}
              {...(selected ? { value: selected.value } : {})}
            />
          </div>

          <div className="grid min-w-0 gap-3 xl:grid-cols-2">
            <LiveCachePanel run={run} pinnedIndex={pinnedIndex} />
            <LiveCookiePanel run={run} pinnedIndex={pinnedIndex} />
          </div>

          {run.comparison ? <VersionComparison comparison={run.comparison} /> : null}

          <LiveStatusMap run={run} pinnedIndex={pinnedIndex} onSelect={goToStatus} />
        </div>
      }
    />
  );
}
