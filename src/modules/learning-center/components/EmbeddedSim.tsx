'use client';

import Link from 'next/link';
import { CircleAlert, Loader } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { SafetyBadge } from '@/components/shell';
import { EmptyState } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { SimulationView, type VisualizedRun } from '@/components/viz';
import { cn } from '@/lib/cn';
import { getModule } from '@/modules/registry';
import {
  EMBEDDABLE_MODULE_IDS,
  loadEmbeddableScenarios,
  type EmbeddableScenario,
} from '@/modules/scenarios';

/**
 * A module's own simulation, playing inside a lesson.
 *
 * ```mdx
 * <EmbeddedSim module="dns-explorer" scenario="cold-cache" focus="resolver" autoplay />
 * ```
 *
 * ## It embeds, it does not reimplement
 *
 * Everything on screen below the caption is `SimulationView` -- phase 04's canvas,
 * timeline, playback controls, keyboard map, phase stepper, inspector and log, in its
 * `compact` size. There is no animation code in this file and there must never be any:
 * the moment a lesson draws its own version of a packet, the lesson can be wrong about
 * one, and the whole reason these are live simulations rather than screenshots is gone.
 *
 * The scenario is the module's own, resolved through `@/modules/scenarios` (which is
 * where the note on why the boundary rule sends it through a manifest lives). So a
 * lesson quotes the same run, the same title and the same summary the module's own
 * scenario picker shows, and cannot drift out of sync with it.
 *
 * ## Writing a lesson before the module exists
 *
 * A module or scenario that is not there yet renders a plain, specific message naming
 * what was asked for and what is available, instead of throwing. Lessons are written
 * against a curriculum, not against whatever happens to be built this week -- an author
 * can name `<EmbeddedSim module="cdn-explorer" ...>` today, see exactly that sentence,
 * and have it start playing on the day the module lands, with no edit to the lesson.
 *
 * ## Everything is readable with the animation off
 *
 * The caption below the diagram is not a caption in the decorative sense: it carries the
 * scenario's summary, what it demonstrates, and every phase of the run in order, as
 * text. It is always rendered and never collapsed -- a `<details>` would hide it from a
 * screen reader, which is one of the two audiences it exists for. The other is the
 * reader on reduced motion, whom `usePlayback` never auto-plays for, and who therefore
 * has to be able to *read* what the diagram would have shown.
 */

export interface EmbeddedSimProps {
  /** Registry id of the module that owns the scenario, e.g. `'dns-explorer'`. */
  module: string;
  /** Scenario id within that module, e.g. `'cold-cache'`. */
  scenario: string;
  /**
   * Machines to bring into view -- node ids, or a comma-separated list of them. Pans and
   * zooms onto them instead of fitting the whole diagram, for a paragraph that is about
   * one corner of it. Ids the run never touched are dropped, with a warning in
   * development.
   */
  focus?: string | readonly string[];
  /** Start playing on mount. Ignored under reduced motion, by `usePlayback`. */
  autoplay?: boolean;
  className?: string;
}

/**
 * `available` distinguishes the two ways this can be missing: `null` means the module
 * publishes no catalogue (or does not exist), an array means it does and the scenario is
 * not in it. An author needs to be told which.
 */
type Settled =
  | { readonly status: 'ready'; readonly scenario: EmbeddableScenario }
  | { readonly status: 'missing'; readonly available: readonly string[] | null };

/**
 * What the last completed load produced, and what it was a load *of*.
 *
 * The key is carried in the state rather than cleared by the effect: a component whose
 * props changed is showing a stale answer until the new one arrives, and comparing keys
 * during render says so without a second render to say it. (It is also the only shape
 * `react-hooks/set-state-in-effect` accepts, and it is right to.)
 */
type Resolution = Settled & { readonly key: string };

function parseFocus(focus: EmbeddedSimProps['focus']): readonly string[] {
  if (!focus) return [];
  const ids = typeof focus === 'string' ? focus.split(',') : focus;
  return ids.map((id) => id.trim()).filter(Boolean);
}

export function EmbeddedSim({
  module: moduleId,
  scenario: scenarioId,
  focus,
  autoplay = false,
  className,
}: EmbeddedSimProps) {
  const key = `${moduleId}/${scenarioId}`;
  const [loaded, setLoaded] = useState<Resolution | null>(null);

  const meta = getModule(moduleId);

  useEffect(() => {
    let cancelled = false;

    void loadEmbeddableScenarios(moduleId).then((scenarios) => {
      if (cancelled) return;

      if (!scenarios) {
        setLoaded({ key, status: 'missing', available: null });
        return;
      }

      const found = scenarios.find((entry) => entry.id === scenarioId);
      setLoaded(
        found
          ? { key, status: 'ready', scenario: found }
          : {
              key,
              status: 'missing',
              available: scenarios.map((entry) => entry.id),
            },
      );
    });

    return () => {
      cancelled = true;
    };
  }, [key, moduleId, scenarioId]);

  // Still loading whenever the answer on hand is for a different pair of props.
  const resolution = loaded?.key === key ? loaded : null;

  /*
   * Run it once, here rather than in a thunk handed to `SimulationView`, because this
   * component needs the run itself: the phase list is the text half of the accessible
   * caption, and the topology is what says whether a `focus` id is real. `resolution`
   * only changes identity on a state transition, so this is one simulation per embed.
   */
  const run = useMemo<VisualizedRun | null>(
    () => (resolution?.status === 'ready' ? resolution.scenario.run() : null),
    [resolution],
  );

  const focusNodeIds = useMemo(() => {
    const wanted = parseFocus(focus);
    if (!wanted.length || !run) return undefined;

    const known = new Set(run.topology.nodes.map((node) => node.id));
    const present = wanted.filter((id) => known.has(id));

    if (process.env.NODE_ENV !== 'production' && present.length < wanted.length) {
      const unknown = wanted.filter((id) => !known.has(id));
      // Loud in development, silent in production: a reader should never be shown a
      // note about a lesson's markup, and an author should never miss one.
      console.warn(
        `EmbeddedSim: ${moduleId}/${scenarioId} never touches ${unknown.join(', ')}, ` +
          'so focus ignored it. The ids are node ids in the run, not machine labels.',
      );
    }

    return present.length ? present : undefined;
  }, [focus, run, moduleId, scenarioId]);

  if (resolution?.status === 'missing') {
    return (
      <MissingSim
        moduleId={moduleId}
        moduleTitle={meta?.title}
        scenarioId={scenarioId}
        available={resolution.available}
        className={className}
      />
    );
  }

  if (!resolution || !run) {
    return (
      <div
        role="status"
        className={cn(
          'border-border text-fg-muted my-8 flex items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-16 text-sm',
          className,
        )}
      >
        <Loader aria-hidden="true" className="size-4 shrink-0" />
        Loading the {meta?.title ?? moduleId} simulation…
      </div>
    );
  }

  const { scenario } = resolution;

  return (
    <figure
      className={cn(
        'border-border bg-surface-raised my-8 overflow-hidden rounded-xl border',
        className,
      )}
    >
      <div className="border-border flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="text-fg text-sm font-semibold">{scenario.title}</p>
          {meta ? (
            <Link
              href={meta.route}
              className={cn(
                'text-fg-muted hover:text-fg mt-0.5 inline-block rounded-md text-xs transition-colors',
                focusRing,
              )}
            >
              Open in {meta.title}
            </Link>
          ) : null}
        </div>
        {/*
          The same badge the module's own chrome wears, for the same reason: a reader
          must never be unsure whether something on screen touched a network. Fixed at
          `simulated` because every scenario reachable from here is a pure function of a
          bundled fixture -- the one module that can reach a network publishes no
          catalogue, so there is nothing here to be honest about in the other direction.
        */}
        <SafetyBadge />
      </div>

      <div className="p-3 sm:p-4">
        <SimulationView
          compact
          simulation={run}
          autoPlay={autoplay}
          focusNodeIds={focusNodeIds}
          label={`${scenario.title}${meta ? ` — ${meta.title}` : ''}`}
        />
      </div>

      <figcaption className="border-border bg-surface border-t px-4 py-4">
        <p className="text-fg-secondary text-sm leading-relaxed">{scenario.summary}</p>

        {scenario.teaches.length ? (
          <ul
            aria-label="What this simulation demonstrates"
            className="text-fg-muted mt-3 flex flex-col gap-1 text-xs leading-relaxed"
          >
            {scenario.teaches.map((point) => (
              <li key={point} className="flex gap-2">
                <span aria-hidden="true" className="text-accent">
                  •
                </span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {/*
          The run written out. This is what makes a lesson complete with the animation
          disabled: the phases are the same chapters the stepper above steps through, in
          the same order, so a reader who never presses play still gets the story.
        */}
        {run.result.phases.length ? (
          <ol
            aria-label="What happens, step by step"
            className="border-border mt-4 flex flex-col gap-2 border-t pt-4 text-xs leading-relaxed"
          >
            {run.result.phases.map((phase, index) => (
              <li key={phase.id} className="flex gap-2.5">
                <span
                  aria-hidden="true"
                  className="text-fg-muted bg-surface-overlay border-border mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border text-[0.625rem]"
                >
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="text-fg-secondary font-medium">{phase.title}</span>
                  {phase.description ? (
                    <span className="text-fg-muted"> — {phase.description}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        ) : null}
      </figcaption>
    </figure>
  );
}

/**
 * What a lesson shows when it names something that is not built yet.
 *
 * Specific on purpose. "Simulation unavailable" would send an author reading source; the
 * message below says which half was wrong and, when the module is real, what it does
 * offer -- which is usually enough to spot the typo without leaving the page.
 */
function MissingSim({
  moduleId,
  moduleTitle,
  scenarioId,
  available,
  className,
}: {
  moduleId: string;
  moduleTitle?: string;
  scenarioId: string;
  available: readonly string[] | null;
  className?: string;
}) {
  const name = moduleTitle ?? moduleId;

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    console.warn(
      available
        ? `EmbeddedSim: "${moduleId}" has no scenario "${scenarioId}". It offers: ${available.join(', ')}.`
        : `EmbeddedSim: no embeddable module "${moduleId}". Embeddable modules: ${EMBEDDABLE_MODULE_IDS.join(', ')}.`,
    );
  }, [moduleId, scenarioId, available]);

  const description = available ? (
    <>
      <span className="font-mono">{scenarioId}</span> is not one of its scenarios. It
      offers <span className="font-mono">{available.join(', ')}</span>.
    </>
  ) : moduleTitle ? (
    <>
      {name} does not publish scenarios a lesson can embed yet, so{' '}
      <span className="font-mono">{scenarioId}</span> cannot be played here. The module
      itself works.
    </>
  ) : (
    <>
      No module has the id <span className="font-mono">{moduleId}</span>. This lesson was
      written ahead of it; the simulation will appear here once the module ships.
    </>
  );

  return (
    <EmptyState
      className={cn('my-8', className)}
      icon={<CircleAlert className="size-5" />}
      title={
        available || moduleTitle
          ? `${name} cannot play "${scenarioId}"`
          : `Simulation not available yet`
      }
      description={description}
    />
  );
}
