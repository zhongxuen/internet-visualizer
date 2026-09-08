'use client';

import { useMemo, useState } from 'react';

import { Badge, Panel } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import {
  SimulationView,
  usePlaybackContext,
  usePlaybackState,
  type VisualizedRun,
} from '@/components/viz';
import { cn } from '@/lib/cn';

import { ApiConsole } from './components/ApiConsole';
import { AuthFlowDiagram } from './components/AuthFlowDiagram';
import { EndpointExplorer } from './components/EndpointExplorer';
import { PaginationVerdict } from './components/PaginationVerdict';
import { RateLimitMeter } from './components/RateLimitMeter';
import { ResponseShape } from './components/ResponseShape';
import { TransportBill } from './components/TransportBill';
import { RESOURCES } from './scenarios/common';
import {
  API_SCENARIOS,
  DEFAULT_API_SCENARIO_ID,
  getApiScenario,
  REST_CRUD,
} from './scenarios';
import type { HttpMethod } from './sim/message';
import { runApiScenario, type ApiExchange, type ApiRun } from './sim/exchange';

/**
 * API Visualizer: what every API adds to HTTP, one addition at a time.
 *
 * Everything here is simulated. There is no `fetch` in this module, no host name outside the
 * `.example` TLD that RFC 2606 reserves so it can never be registered, and no address outside
 * the `203.0.113.0/24` block RFC 5737 reserves for documentation. The console below says
 * &ldquo;send&rdquo; because that is the word a learner has in their head; what it does is
 * call a pure function and keep the value it returns.
 *
 * ## What this file is
 *
 * A composition root. The protocol is `sim/`'s, the seven authored runs are `scenarios/`',
 * playback and the diagram are `SimulationView`'s, and the panels are the components beside
 * this file. What is left is three pieces of state and one decision about which panel a
 * scenario gets.
 *
 * ## The three pieces of state
 *
 * - **which run** — one of seven. State rather than a route, so putting the `403` next to the
 *   `401` is one click.
 * - **which exchange is selected**, stamped with the run it was chosen against. An exchange id
 *   from the previous scenario means nothing on this one, so it is compared during render
 *   rather than cleared by an effect — an effect would show one frame of a request that is not
 *   there.
 * - **what the console is pointed at**, so activating a verb chip in the endpoint explorer
 *   fills the console in and the explorer marks the path the console is on. Two panels, one
 *   fact between them, and the module owns it because neither one should own the other.
 *
 * The playhead is not in that list. It lives in the playback store inside `SimulationView`,
 * and the panels that need it reach it through `PlaybackContext` — which is how the rate
 * meter fills and empties in step with the animation without this component re-rendering the
 * world on every frame.
 *
 * ## Why the console and the explorer are on every scenario
 *
 * Because the run above is somebody else's request and the console is the reader's. Six of the
 * seven scenarios are things you cannot easily try at home -- an OAuth ladder, a rate limiter,
 * a webhook retry -- and the seventh is the one where poking at it is the whole point. Keeping
 * both available means the answer to "what would happen if I sent a PATCH with the wrong
 * media type" is always three clicks away, on the same page as the sentence that raised it.
 */

/** The playhead, as the panels below the timeline read it. */
function useNow(): number {
  const store = usePlaybackContext();
  return usePlaybackState(store, (state) => state.virtualTime);
}

/** The rate meter, wired to the playhead so the bucket fills as the animation plays. */
function LiveRateMeter({ run }: { run: ApiRun }) {
  const now = useNow();
  if (run.detail.kind !== 'rate-limit') return null;

  const attempts = run.exchanges
    .filter((exchange) => exchange.limit !== undefined)
    .map((exchange) => ({
      atMs: exchange.sentAt,
      limit: exchange.limit as NonNullable<ApiExchange['limit']>,
    }));

  return (
    <RateLimitMeter
      initial={run.detail.initialBucket}
      attempts={attempts}
      now={now}
      run={run.detail.run}
      {...(run.detail.ignoringRetryAfter
        ? { ignoringRetryAfter: run.detail.ignoringRetryAfter }
        : {})}
    />
  );
}

function statusTone(status: number): 'ok' | 'accent' | 'warn' | 'error' | 'neutral' {
  if (status === 0) return 'neutral';
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  if (status >= 300) return 'accent';
  return 'ok';
}

/**
 * Every request the run made, in order, with the reason for each answer.
 *
 * A ledger rather than a list, because the interesting comparisons in this module are between
 * *adjacent rows*: the two creates with different ids, the `401` above the `403`, the page
 * that repeats an item above the one that does not. Selecting a row seeks the timeline to it,
 * so the diagram and the shape panel are never describing different moments.
 */
function ExchangeLedger({
  run,
  selectedId,
  onSelect,
}: {
  run: ApiRun;
  selectedId: string | null;
  onSelect: (exchange: ApiExchange) => void;
}) {
  const store = usePlaybackContext();
  const now = useNow();

  return (
    <Panel
      title="Requests"
      aside={<Badge tone="neutral">{run.exchanges.length}</Badge>}
      scroll
      className="min-w-0"
    >
      <ul className="flex min-w-0 flex-col gap-1">
        {run.exchanges.map((exchange) => {
          const active = exchange.id === selectedId;
          const arrived = now >= exchange.receivedAt;

          return (
            <li key={exchange.id}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => {
                  onSelect(exchange);
                  store.getState().seek(exchange.receivedAt);
                }}
                className={cn(
                  'w-full rounded-lg border px-2.5 py-2 text-left transition-colors',
                  focusRing,
                  active
                    ? 'border-accent/60 bg-accent/10'
                    : 'border-border bg-surface hover:border-border-strong',
                  // `.state-dim`, never an opacity: see globals.css. Skipped while the
                  // row is selected, because the dim token is only guaranteed against
                  // a plain surface and the selected row draws an accent tint.
                  !arrived && !active && 'state-dim',
                )}
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  {/* Dimness is not a label: say it. */}
                  {arrived ? null : <span className="sr-only">Not sent yet. </span>}
                  <code className="text-fg-secondary font-mono text-[0.6875rem]">
                    {exchange.request.method}
                  </code>
                  <code className="text-fg min-w-0 flex-1 truncate font-mono text-[0.6875rem]">
                    {exchange.request.target}
                  </code>
                  <Badge tone={statusTone(exchange.status)}>
                    {exchange.status === 0 ? 'no reply' : exchange.status}
                  </Badge>
                </div>
                <p className="text-fg-secondary mt-1 text-[0.6875rem] leading-relaxed">
                  {exchange.why}
                </p>
                {active
                  ? exchange.notes.map((note) => (
                      <p
                        key={note}
                        className="text-fg-muted mt-1 text-[0.6875rem] leading-relaxed"
                      >
                        {note}
                      </p>
                    ))
                  : null}
                {active && exchange.signature ? (
                  <p
                    className={cn(
                      'mt-1 text-[0.6875rem] leading-relaxed',
                      exchange.signature.valid ? 'text-state-ok' : 'text-state-error',
                    )}
                  >
                    Signature {exchange.signature.valid ? 'verified' : 'refused'}:{' '}
                    {exchange.signature.checks
                      .map((check) => `${check.name} ${check.passed ? '✓' : '✕'}`)
                      .join(', ')}
                  </p>
                ) : null}
                {active && exchange.page && exchange.page.repeated.length > 0 ? (
                  <p className="text-state-error mt-1 text-[0.6875rem] leading-relaxed">
                    Already sent on an earlier page: {exchange.page.repeated.join(', ')}
                  </p>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/** The scenario-specific panel. Absent for the runs whose ledger already says everything. */
function DetailPanel({
  run,
  selectedId,
  onSelectExchange,
}: {
  run: ApiRun;
  selectedId: string | null;
  onSelectExchange: (id: string) => void;
}) {
  const detail = run.detail;

  switch (detail.kind) {
    case 'auth':
      return (
        <AuthFlowDiagram
          exchanges={run.exchanges}
          selectedId={selectedId}
          onSelect={onSelectExchange}
        />
      );
    case 'oauth':
      return (
        <AuthFlowDiagram
          flow={detail.flow}
          {...(detail.interception ? { interception: detail.interception } : {})}
          {...(detail.guessedInterception
            ? { guessedInterception: detail.guessedInterception }
            : {})}
        />
      );
    case 'rate-limit':
      return <LiveRateMeter run={run} />;
    case 'pagination':
      return (
        <PaginationVerdict
          offset={detail.offset}
          cursor={detail.cursor}
          items={detail.items}
        />
      );
    case 'graphql':
      return (
        <TransportBill
          comparison={detail.comparison}
          unbatched={detail.unbatched}
          batched={detail.batched}
          query={detail.query}
        />
      );
    default:
      return null;
  }
}

export function ApiVisualizerModule() {
  const [scenarioId, setScenarioId] = useState<string>(DEFAULT_API_SCENARIO_ID);
  const [selected, setSelected] = useState<{ run: ApiRun; id: string } | null>(null);
  const [consoleTarget, setConsoleTarget] = useState('/articles');
  const [prefill, setPrefill] = useState<
    { method: HttpMethod; target: string } | undefined
  >(undefined);

  const scenario = useMemo(() => getApiScenario(scenarioId) ?? REST_CRUD, [scenarioId]);

  // A whole run, and this tree re-renders every frame while the animation plays, so the run
  // is memoized on the scenario and everything derived is memoized on the run.
  const run = useMemo(() => runApiScenario(scenario), [scenario]);

  const simulation = useMemo<VisualizedRun>(
    () => ({ topology: run.topology, result: run.result }),
    [run],
  );

  // An exchange id from the previous run means nothing on this one, so the selection is
  // stamped with the run it was made against and compared during render.
  const selectedId = selected && selected.run === run ? selected.id : null;
  const current =
    run.exchanges.find((exchange) => exchange.id === selectedId) ?? run.exchanges[0];

  const resourceOf = current?.decision?.target.resource;
  const detail = (
    <DetailPanel
      run={run}
      selectedId={selectedId}
      onSelectExchange={(id) => setSelected({ run, id })}
    />
  );

  return (
    <SimulationView
      simulation={simulation}
      label={`${scenario.title} API run`}
      controlPanel={
        <div className="flex flex-col gap-3">
          <div role="group" aria-label="Scenario" className="flex flex-wrap gap-1.5">
            {API_SCENARIOS.map((entry, index) => {
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
        </div>
      }
      footer={
        <div className="flex min-w-0 flex-col gap-3">
          <div className="grid min-w-0 gap-3 xl:grid-cols-2">
            <ExchangeLedger
              run={run}
              selectedId={selectedId ?? current?.id ?? null}
              onSelect={(exchange) => setSelected({ run, id: exchange.id })}
            />
            <ResponseShape
              body={current?.response.body}
              {...(resourceOf ? { resource: resourceOf } : {})}
              title="What came back, key by key"
              aside={
                current ? (
                  <Badge tone={statusTone(current.status)}>
                    {current.status === 0 ? 'no reply' : current.status}
                  </Badge>
                ) : undefined
              }
              caption="Fields of the resource are explained by its own definition; everything else comes from a specification or a convention, and the badge on each says which."
            />
          </div>

          {detail}

          <div className="grid min-w-0 gap-3 xl:grid-cols-2">
            <EndpointExplorer
              resources={RESOURCES}
              activeTarget={consoleTarget}
              onSelect={(choice) => {
                setPrefill(choice);
                setConsoleTarget(choice.target);
              }}
            />
            <ApiConsole prefill={prefill} onTargetChange={setConsoleTarget} />
          </div>
        </div>
      }
    />
  );
}
