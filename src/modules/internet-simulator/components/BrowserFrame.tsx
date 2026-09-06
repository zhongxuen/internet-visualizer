'use client';

import { Image as ImageIcon, Lock, ShieldAlert, Unlock } from 'lucide-react';

import { Badge, Panel } from '@/components/ui';
import { formatDuration, percentOf } from '@/components/viz';
import { cn } from '@/lib/cn';

import type { PageLoadRun } from '../sim/pipeline';
import { stageOf } from '../sim/pipeline';

/**
 * What the user actually sees, and when.
 *
 * Every other panel in this module measures the page load. This one *is* the page load, from
 * the only seat that matters: a viewport that stays blank while eight stages happen behind
 * it, then paints. Scrub the playhead and the frame changes; that coupling is the entire
 * component.
 *
 * ## Blank is not a missing state
 *
 * The most common misreading of a performance profile is that a page is "loading" -- doing
 * something visible -- while the network works. It is not. Until first paint the frame is
 * empty, and on a page with a render-blocking stylesheet it stays empty *after* the HTML has
 * arrived and been parsed, because the browser would rather show nothing than show text in
 * the wrong font and re-lay it out a moment later. So this frame draws blank when blank is
 * the truth, and prints the reason it is still blank underneath. That pairing -- an empty
 * rectangle plus the name of the file holding it empty -- is the most useful performance
 * lesson in the module, and it does not survive being softened into a spinner.
 *
 * ## Four states, in the order they occur
 *
 * `blank` (nothing has arrived) to `parsed` (the HTML is in hand, still nothing painted) to
 * `painted` (first paint: layout and text) to `complete` (the largest contentful element has
 * arrived). A run that fails never reaches any of them and shows the browser's own error
 * page instead, which is the honest ending and the one users recognise.
 */

export interface BrowserFrameProps {
  run: PageLoadRun;
  /** The playhead, in absolute virtual milliseconds. */
  now: number;
  className?: string;
}

/** How far through the load the frame is, at `now`. */
type PaintState = 'blank' | 'parsed' | 'painted' | 'complete';

interface Milestones {
  /** When the document's last byte arrived: the render stage's start. */
  readonly documentAtMs?: number;
  readonly firstPaintMs?: number;
  readonly largestContentfulPaintMs?: number;
  readonly loadMs: number;
}

function milestonesOf(run: PageLoadRun): Milestones {
  const render = stageOf(run, 'render');
  return {
    ...(render && render.status === 'ran' ? { documentAtMs: render.startMs } : {}),
    ...(run.metrics.firstPaintMs === undefined
      ? {}
      : { firstPaintMs: run.metrics.firstPaintMs }),
    ...(run.metrics.largestContentfulPaintMs === undefined
      ? {}
      : { largestContentfulPaintMs: run.metrics.largestContentfulPaintMs }),
    loadMs: run.metrics.loadMs,
  };
}

function paintStateAt(now: number, marks: Milestones): PaintState {
  if (
    marks.largestContentfulPaintMs !== undefined &&
    now >= marks.largestContentfulPaintMs
  ) {
    return 'complete';
  }
  if (marks.firstPaintMs !== undefined && now >= marks.firstPaintMs) return 'painted';
  if (marks.documentAtMs !== undefined && now >= marks.documentAtMs) return 'parsed';
  return 'blank';
}

/** The mock chrome: enough of a browser to be unmistakable, and no more. */
function Chrome({ run }: { run: PageLoadRun }) {
  const url = run.state.url;
  const secure = url?.scheme === 'https';
  const failed = run.failure !== undefined;

  return (
    <div className="border-border bg-surface-overlay flex items-center gap-2 border-b px-3 py-2">
      <span aria-hidden="true" className="flex gap-1.5">
        <span className="bg-state-error/60 block size-2.5 rounded-full" />
        <span className="bg-state-warn/60 block size-2.5 rounded-full" />
        <span className="bg-state-ok/60 block size-2.5 rounded-full" />
      </span>

      <div className="bg-surface border-border/60 flex min-w-0 flex-1 items-center gap-1.5 rounded-full border px-2.5 py-1">
        {failed ? (
          <ShieldAlert aria-hidden="true" className="text-state-warn size-3 shrink-0" />
        ) : secure ? (
          <Lock aria-hidden="true" className="text-state-ok size-3 shrink-0" />
        ) : (
          <Unlock aria-hidden="true" className="text-state-warn size-3 shrink-0" />
        )}
        <span className="text-fg-secondary min-w-0 truncate font-mono text-[0.6875rem]">
          {url?.href ?? run.scenario.url}
        </span>
      </div>
    </div>
  );
}

/** The browser's own error page: the ending every failure scenario actually has. */
function ErrorPage({ run }: { run: PageLoadRun }) {
  const failure = run.failure!;

  return (
    <div className="flex h-full flex-col justify-center gap-2 px-6 py-6">
      <div className="bg-surface-overlay text-fg-muted flex size-9 items-center justify-center rounded-full text-lg">
        :(
      </div>
      <h3 className="text-fg text-base font-medium">{failure.title}</h3>
      <p className="text-fg-secondary max-w-md text-xs leading-relaxed">
        {failure.message}
      </p>
      <p className="text-fg-muted font-mono text-[0.6875rem]">{failure.code}</p>
      <p className="text-state-warn border-state-warn/40 bg-state-warn/10 mt-1 max-w-md rounded-lg border px-2.5 py-2 text-[0.6875rem] leading-relaxed">
        {failure.explanation}
      </p>
    </div>
  );
}

/**
 * The painted page.
 *
 * A wireframe rather than a rendering: the point is *when* things appear, so the content is
 * deliberately generic and the transitions are what carry meaning. The hero block is sized
 * from the page's own LCP candidate so the largest element on screen really is the one the
 * metric is about.
 */
function Viewport({ state, run }: { state: PaintState; run: PageLoadRun }) {
  const lcp = run.page.subresources.find((resource) => resource.lcpCandidate);
  const blocking = run.state.render?.blockedFirstPaintBy ?? [];

  if (state === 'blank' || state === 'parsed') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <span className="border-border/60 text-fg-muted block rounded-lg border border-dashed px-4 py-3 text-[0.6875rem]">
          Nothing painted yet
        </span>
        <p className="text-fg-muted max-w-sm text-[0.6875rem] leading-relaxed">
          {state === 'blank'
            ? 'The document has not arrived. Everything happening on the rail above is happening behind an empty frame.'
            : blocking.length > 0
              ? `The HTML is parsed, and the frame is still blank: ${blocking.join(', ')} blocks rendering. The browser would rather show nothing than show unstyled text and re-paint it.`
              : 'The HTML is parsed and the first frame is a moment away.'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2.5 px-5 py-4">
      <div className="bg-fg/85 h-3 w-2/5 rounded-sm" />
      <div className="flex flex-col gap-1.5">
        <div className="bg-fg-muted/60 h-1.5 w-full rounded-sm" />
        <div className="bg-fg-muted/60 h-1.5 w-11/12 rounded-sm" />
        <div className="bg-fg-muted/60 h-1.5 w-3/4 rounded-sm" />
      </div>

      <div
        className={cn(
          'border-border/60 relative flex flex-1 items-center justify-center overflow-hidden rounded-md border transition-colors duration-300',
          state === 'complete' ? 'bg-accent/25' : 'bg-surface-overlay border-dashed',
        )}
      >
        {state === 'complete' ? (
          <span className="text-fg-secondary text-[0.625rem]">
            {lcp?.label ?? 'hero image'} &mdash; largest contentful element
          </span>
        ) : (
          <span className="text-fg-muted flex items-center gap-1.5 text-[0.625rem]">
            <ImageIcon aria-hidden="true" className="size-3.5" />
            {lcp?.label ?? 'image'} still downloading
          </span>
        )}
      </div>
    </div>
  );
}

/** The two paint milestones on a strip, with the playhead moving across them. */
function PaintTimeline({ marks, now }: { marks: Milestones; now: number }) {
  const total = Math.max(marks.loadMs, marks.largestContentfulPaintMs ?? 0, 1);

  const ticks = [
    marks.firstPaintMs === undefined
      ? undefined
      : { label: 'FP', at: marks.firstPaintMs, tone: 'ok' as const },
    marks.largestContentfulPaintMs === undefined ||
    marks.largestContentfulPaintMs === marks.firstPaintMs
      ? undefined
      : { label: 'LCP', at: marks.largestContentfulPaintMs, tone: 'link' as const },
  ].filter((tick): tick is { label: string; at: number; tone: 'ok' | 'link' } => !!tick);

  return (
    <div className="flex flex-col gap-1">
      <div className="bg-surface border-border/50 relative h-6 overflow-hidden rounded border">
        <span
          aria-hidden="true"
          className="bg-accent/20 absolute inset-y-0 left-0 block transition-[width] duration-150"
          style={{ width: `${percentOf(now, total)}%` }}
        />
        {ticks.map((tick) => (
          <span
            key={tick.label}
            className="absolute inset-y-0 flex items-center"
            style={{ left: `${percentOf(tick.at, total)}%` }}
          >
            <span
              aria-hidden="true"
              className={cn(
                'block h-full w-px',
                tick.tone === 'ok' ? 'bg-state-ok' : 'bg-layer-link',
              )}
            />
            <span
              className={cn(
                'ml-1 font-mono text-[0.5625rem] whitespace-nowrap',
                tick.tone === 'ok' ? 'text-state-ok' : 'text-layer-link',
              )}
            >
              {tick.label} {formatDuration(tick.at)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function BrowserFrame({ run, now, className }: BrowserFrameProps) {
  const marks = milestonesOf(run);
  const state = run.failure ? 'blank' : paintStateAt(now, marks);

  const metrics: readonly { label: string; value: string }[] = [
    {
      label: 'TTFB',
      value: run.metrics.ttfbMs === undefined ? '--' : formatDuration(run.metrics.ttfbMs),
    },
    {
      label: 'First Paint',
      value: marks.firstPaintMs === undefined ? '--' : formatDuration(marks.firstPaintMs),
    },
    {
      label: 'LCP',
      value:
        marks.largestContentfulPaintMs === undefined
          ? '--'
          : formatDuration(marks.largestContentfulPaintMs),
    },
    { label: 'Load', value: formatDuration(run.metrics.loadMs) },
    {
      label: 'Transferred',
      value: `${(run.metrics.transferredBytes / 1024).toFixed(1)} kB`,
    },
    {
      label: 'Requests',
      value: `${run.metrics.networkRequests} network, ${run.metrics.cachedRequests} cached`,
    },
  ];

  return (
    <Panel
      title="Viewport"
      aside={
        run.failure ? (
          <Badge tone="error">{run.failure.code}</Badge>
        ) : (
          <Badge
            tone={
              state === 'complete' ? 'ok' : state === 'painted' ? 'accent' : 'neutral'
            }
          >
            {state === 'blank'
              ? 'Blank'
              : state === 'parsed'
                ? 'HTML received'
                : state === 'painted'
                  ? 'First paint'
                  : 'Complete'}
          </Badge>
        )
      }
      className={cn('min-w-0', className)}
    >
      <div className="flex min-w-0 flex-col gap-3">
        <div className="border-border bg-surface-raised overflow-hidden rounded-xl border">
          <Chrome run={run} />
          <div className="bg-surface h-56">
            {run.failure ? <ErrorPage run={run} /> : <Viewport state={state} run={run} />}
          </div>
        </div>

        {run.failure ? null : <PaintTimeline marks={marks} now={now} />}

        <dl className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {metrics.map((metric) => (
            <div
              key={metric.label}
              className="border-border/60 bg-surface rounded-lg border px-2.5 py-1.5"
            >
              <dt className="text-fg-muted text-[0.5625rem] tracking-widest uppercase">
                {metric.label}
              </dt>
              <dd className="text-fg font-mono text-xs tabular-nums">{metric.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Panel>
  );
}
