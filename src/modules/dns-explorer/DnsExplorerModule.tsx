'use client';

import { useCallback, useMemo, useState } from 'react';

import { Badge, Panel } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import {
  SimulationView,
  usePlaybackContext,
  usePlaybackState,
  type VisualizedRun,
} from '@/components/viz';
import { cn } from '@/lib/cn';

import { CachePanel } from './components/CachePanel';
import { DomainInput } from './components/DomainInput';
import { RecordTable } from './components/RecordTable';
import { ResolutionLadder } from './components/ResolutionLadder';
import {
  buildLadder,
  ladderSummary,
  rungAt,
  type Ladder,
  type LadderRung,
} from './ladder';
import {
  coverageFor,
  CUSTOM_LOOKUP_ID,
  DEFAULT_DRAFT,
  lookupScenario,
  TRANSPORT_LABELS,
  type Lookup,
  type LookupDraft,
} from './lookup';
import {
  COLD_CACHE,
  DEFAULT_DNS_SCENARIO_ID,
  DNS_SCENARIOS,
  getDnsScenario,
  runDnsScenario,
  type DnsRun,
} from './scenarios';
import type { DnsCache } from './sim/cache';

/**
 * DNS Explorer: a name becoming an address, one server at a time.
 *
 * Everything here is simulated. Every zone, every server, and every address comes from
 * the fixtures in `sim/records.ts`, and no name -- authored or typed -- is ever looked up
 * on a real network. The live DNS tool is phase 12 and lives on its own badged surface,
 * which is the point of keeping them apart.
 *
 * ## What this file is
 *
 * A composition root, and deliberately little else. The protocol is `sim/`'s, the six
 * authored runs are `scenarios/`', the diagram and playback are `SimulationView`'s
 * (phase 04), and the two derivations the UI needs -- the sequence-diagram ladder, and
 * whether the fixtures cover a typed-in name -- are pure functions in `./ladder.ts` and
 * `./lookup.ts`. What is left is three pieces of state and the wiring between them.
 *
 * ## The three pieces of state
 *
 * - **which run** -- one of the six authored scenarios, or the lookup typed into
 *   `DomainInput`. State rather than a route, so comparing a cold walk against a warm one
 *   is one click.
 * - **the form** -- kept here rather than inside the field so that picking an authored
 *   scenario can leave it alone, and so that submitting the same name twice produces a
 *   new run object and therefore an actual re-run.
 * - **which rung is pinned** -- the exchange whose message is in the record table.
 *   Cleared whenever the run changes, since a rung id from the previous ladder means
 *   nothing on this one.
 *
 * The playhead is not in that list. It stays in the playback store inside
 * `SimulationView`, and the three live panels below reach it through `PlaybackContext` --
 * which is also why re-running is safe: a new `SimResult` restarts the timeline rather
 * than dropping the viewer into the middle of a run they have not seen the start of.
 */

/** The live panels each read the playhead themselves; this is what they read it from. */
function useVirtualTime(): number {
  const store = usePlaybackContext();
  return usePlaybackState(store, (state) => state.virtualTime);
}

function LiveLadder({
  ladder,
  durationMs,
  summary,
  selectedRungId,
  onSelectRung,
}: {
  ladder: Ladder;
  durationMs: number;
  summary: string;
  selectedRungId: string | null;
  onSelectRung: (rung: LadderRung) => void;
}) {
  const store = usePlaybackContext();
  const virtualTime = usePlaybackState(store, (state) => state.virtualTime);
  const { seek } = store.getState();

  return (
    <ResolutionLadder
      ladder={ladder}
      virtualTime={virtualTime}
      durationMs={durationMs}
      onSeek={seek}
      selectedRungId={selectedRungId}
      onSelectRung={onSelectRung}
      summary={summary}
    />
  );
}

/** The RFC a step cites, folded into its note so the table needs no extra slot. */
function noteWithReference(rung: LadderRung): string {
  if (!rung.reference) return rung.note;
  const section = rung.reference.section ? ` §${rung.reference.section}` : '';
  return `${rung.note} (RFC ${rung.reference.rfc}${section} — ${rung.reference.title})`;
}

function LiveRecordTable({
  ladder,
  pinnedRungId,
}: {
  ladder: Ladder;
  pinnedRungId: string | null;
}) {
  const virtualTime = useVirtualTime();

  // A pinned rung wins; otherwise the table follows the playhead, so simply pressing
  // play walks the message fields alongside the diagram.
  const rung =
    ladder.rungs.find((candidate) => candidate.id === pinnedRungId) ??
    rungAt(ladder.rungs, virtualTime);

  if (!rung?.message) {
    return (
      <Panel title="DNS message">
        <p className="text-fg-muted text-xs leading-snug">
          Nothing is on the wire yet. Press play, or click a rung of the ladder to read
          the message it carried.
        </p>
      </Panel>
    );
  }

  const from = ladder.columns[rung.from];
  const to = ladder.columns[rung.to];

  return (
    <RecordTable
      message={rung.message}
      title={`${rung.kind === 'query' ? 'Query' : 'Reply'}: ${from.label} → ${to.label}`}
      note={noteWithReference(rung)}
      aside={
        <Badge tone={rung.kind === 'query' ? 'neutral' : 'accent'}>
          {TRANSPORT_LABELS[rung.transport]}
        </Badge>
      }
    />
  );
}

function LiveCachePanel({ cache }: { cache: DnsCache }) {
  const virtualTime = useVirtualTime();

  return <CachePanel cache={cache} virtualTime={virtualTime} />;
}

export function DnsExplorerModule() {
  const [scenarioId, setScenarioId] = useState<string>(DEFAULT_DNS_SCENARIO_ID);
  const [draft, setDraft] = useState<LookupDraft>(DEFAULT_DRAFT);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [pinned, setPinned] = useState<{ run: DnsRun; id: string } | null>(null);

  const custom = scenarioId === CUSTOM_LOOKUP_ID && lookup !== null;

  const scenario = useMemo(
    () =>
      custom && lookup
        ? lookupScenario(lookup)
        : (getDnsScenario(scenarioId) ?? COLD_CACHE),
    [custom, lookup, scenarioId],
  );

  // `runDnsScenario` is a full resolution and this tree re-renders on every frame while
  // the animation plays, so the run is memoized on the scenario and everything derived
  // from it is memoized on the run.
  const run = useMemo(() => runDnsScenario(scenario), [scenario]);

  const simulation = useMemo<VisualizedRun>(
    () => ({ topology: run.topology, result: run.result }),
    [run],
  );

  const ladder = useMemo(() => buildLadder(run.resolutions), [run]);
  const summary = useMemo(() => ladderSummary(run.resolutions), [run]);

  // A rung id from the previous ladder means nothing on this one, so the pin is stamped
  // with the run it was made against and compared during render rather than cleared by
  // an effect -- which would show one frame of a rung that is not there any more.
  const pinnedRungId = pinned && pinned.run === run ? pinned.id : null;

  const coverage = useMemo(
    () => (custom && lookup ? coverageFor(lookup.name) : undefined),
    [custom, lookup],
  );

  const submit = useCallback((next: Lookup) => {
    // A new object every time, even for an identical lookup: that is what makes pressing
    // Resolve again re-run the walk rather than do nothing.
    setLookup(next);
    setScenarioId(CUSTOM_LOOKUP_ID);
  }, []);

  return (
    <SimulationView
      simulation={simulation}
      label={`${scenario.title} DNS resolution`}
      controlPanel={
        <div className="flex flex-col gap-3">
          <div role="group" aria-label="Scenario" className="flex flex-wrap gap-1.5">
            {DNS_SCENARIOS.map((entry, index) => {
              const active = !custom && entry.id === scenarioId;

              return (
                <button
                  key={entry.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setScenarioId(entry.id)}
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

          <DomainInput
            draft={draft}
            onDraftChange={setDraft}
            onSubmit={submit}
            {...(coverage ? { coverage } : {})}
          />
        </div>
      }
      footer={
        <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <LiveLadder
            ladder={ladder}
            durationMs={run.result.durationMs}
            summary={summary}
            selectedRungId={pinnedRungId}
            onSelectRung={(rung) => setPinned({ run, id: rung.id })}
          />

          <div className="flex min-w-0 flex-col gap-3">
            <LiveRecordTable ladder={ladder} pinnedRungId={pinnedRungId} />
            <LiveCachePanel cache={run.cache} />
          </div>
        </div>
      }
    />
  );
}
