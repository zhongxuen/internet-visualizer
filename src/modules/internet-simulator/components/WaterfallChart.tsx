'use client';

import { Panel } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { formatDuration, percentOf } from '@/components/viz';
import { cn } from '@/lib/cn';

import {
  SEGMENT_NOTES,
  WATERFALL_SEGMENTS,
  type Waterfall,
  type WaterfallRow,
  type WaterfallSegmentName,
} from '../waterfall';

/**
 * The run as a browser's Network panel would draw it.
 *
 * The names are Chrome's, and that is the point of the component: a learner who reads
 * `Waiting (TTFB)` here should find the identical words in a real profile and be looking at
 * the identical thing. Everything about which span gets which name is decided in
 * `../waterfall.ts`; this file puts the result on screen.
 *
 * ## Why the segments are coloured by OSI layer
 *
 * Because it is the one colour scheme that is true rather than decorative, and this product
 * already uses it everywhere else. `DNS Lookup` is pink because DNS is an application
 * protocol; `Initial connection` is cyan because TCP is transport; `SSL` is violet because
 * a handshake is a session being established. The three HTTP-exchange segments share the
 * accent at increasing strength, because they are one exchange in three phases rather than
 * three unrelated things -- and the eye reads them as a single block, which is what they
 * are.
 *
 * ## First Paint and LCP are on the chart, not beside it
 *
 * A waterfall with no paint markers invites the conclusion that a page is done when the
 * last row finishes, which is the single most common misreading of one. With the markers
 * drawn through every row, the render-blocking stylesheet's bar visibly ends *at* the First
 * Paint line, and the argument makes itself.
 */

export interface WaterfallChartProps {
  waterfall: Waterfall;
  /** Absolute virtual millisecond of the first frame, if the page painted. */
  firstPaintMs?: number;
  /** Absolute virtual millisecond of the largest contentful paint. */
  largestContentfulPaintMs?: number;
  /** The playhead, so the chart can show where the animation has got to. */
  now?: number;
  /** Seek the timeline. Clicking a row jumps to where that request started. */
  onSeek?: (ms: number) => void;
  className?: string;
}

/** Fill for each segment, as a CSS colour. See the note above on why these are layers. */
const SEGMENT_FILLS: Readonly<Record<WaterfallSegmentName, string>> = {
  Queueing: 'color-mix(in oklab, var(--text-muted) 45%, transparent)',
  Stalled: 'color-mix(in oklab, var(--state-warn) 60%, transparent)',
  'DNS Lookup': 'color-mix(in oklab, var(--layer-application) 75%, transparent)',
  'Initial connection': 'color-mix(in oklab, var(--layer-transport) 75%, transparent)',
  SSL: 'color-mix(in oklab, var(--layer-session) 80%, transparent)',
  'Request sent': 'color-mix(in oklab, var(--accent) 35%, transparent)',
  'Waiting (TTFB)': 'color-mix(in oklab, var(--accent) 60%, transparent)',
  'Content Download': 'color-mix(in oklab, var(--accent) 92%, transparent)',
};

function sizeLabel(row: WaterfallRow): string {
  if (row.fromCache) return '(from cache)';
  if (row.transferredBytes === 0) return '--';
  if (row.transferredBytes < 1024) return `${row.transferredBytes} B`;
  return `${(row.transferredBytes / 1024).toFixed(1)} kB`;
}

/** A vertical rule through the whole chart, for a paint milestone. */
function Marker({
  label,
  atMs,
  durationMs,
  tone,
}: {
  label: string;
  atMs: number;
  durationMs: number;
  tone: 'paint' | 'lcp';
}) {
  return (
    <div
      className="pointer-events-none absolute inset-y-0 z-10 flex flex-col items-start"
      style={{ left: `${percentOf(atMs, durationMs)}%` }}
    >
      <span
        aria-hidden="true"
        className={cn(
          'block h-full w-px',
          tone === 'paint' ? 'bg-state-ok/70' : 'bg-layer-link/70',
        )}
      />
      <span
        className={cn(
          'absolute top-0 left-1 font-mono text-[0.5625rem] whitespace-nowrap',
          tone === 'paint' ? 'text-state-ok' : 'text-layer-link',
        )}
      >
        {label}
      </span>
    </div>
  );
}

export function WaterfallChart({
  waterfall,
  firstPaintMs,
  largestContentfulPaintMs,
  now,
  onSeek,
  className,
}: WaterfallChartProps) {
  const total = waterfall.durationMs;
  // Only the names this run actually produced: a legend listing `Stalled` on a run with no
  // head-of-line blocking teaches that it happened.
  const used = new Set(
    waterfall.rows.flatMap((row) => row.segments.map((segment) => segment.name)),
  );

  return (
    <Panel
      title="Network waterfall"
      aside={
        <span className="text-fg-muted font-mono text-[0.625rem]">
          {waterfall.rows.length} request{waterfall.rows.length === 1 ? '' : 's'} ·{' '}
          {formatDuration(total)}
        </span>
      }
      className={cn('min-w-0', className)}
    >
      <div className="flex min-w-0 flex-col gap-3">
        {/*
          Table and marker strip share one scroll container and one fixed column layout, so
          the First Paint rule lands on the same pixel column as the bars above it however
          narrow the viewport gets. `table-fixed` is what makes that alignment exact rather
          than approximate: the three leading columns are 10rem + 4rem + 4rem + 0.75rem of
          padding, which is the 18.75rem the strip below indents by.
        */}
        <div className="min-w-0 overflow-x-auto">
          <div className="min-w-[36rem]">
            <table className="w-full table-fixed text-left">
              <caption className="sr-only">
                Every request this page load made, with the standard browser devtools
                timing segments.
              </caption>
              <thead>
                <tr className="text-fg-muted text-[0.5625rem] tracking-widest uppercase">
                  <th scope="col" className="w-40 py-1 font-normal">
                    Name
                  </th>
                  <th scope="col" className="w-16 py-1 text-right font-normal">
                    Size
                  </th>
                  <th scope="col" className="w-16 py-1 text-right font-normal">
                    Time
                  </th>
                  <th scope="col" className="py-1 pl-3 font-normal">
                    Waterfall
                  </th>
                </tr>
              </thead>
              <tbody>
                {waterfall.rows.map((row) => (
                  <tr key={row.id} className="border-border/50 border-t align-middle">
                    <th scope="row" className="min-w-0 py-1.5 pr-2 font-normal">
                      <button
                        type="button"
                        onClick={() => onSeek?.(row.startMs)}
                        disabled={!onSeek}
                        className={cn(
                          'block max-w-full truncate text-left text-xs transition-colors',
                          focusRing,
                          onSeek ? 'text-fg hover:text-accent' : 'text-fg',
                        )}
                        title={`${row.label} — ${row.kind}${row.status ? `, ${row.status}` : ''}`}
                      >
                        {row.label}
                      </button>
                      <span className="text-fg-muted block text-[0.5625rem] tracking-wide uppercase">
                        {row.kind}
                        {row.status ? ` · ${row.status}` : ''}
                      </span>
                    </th>

                    <td
                      className={cn(
                        'py-1.5 text-right font-mono text-[0.6875rem] tabular-nums',
                        row.fromCache ? 'text-state-ok' : 'text-fg-secondary',
                      )}
                    >
                      {sizeLabel(row)}
                    </td>

                    <td className="text-fg-secondary py-1.5 text-right font-mono text-[0.6875rem] tabular-nums">
                      {formatDuration(row.durationMs)}
                    </td>

                    <td className="py-1.5 pl-3">
                      <div className="bg-surface border-border/40 relative h-5 w-full overflow-hidden rounded border">
                        {row.segments.map((segment, index) => (
                          <span
                            key={`${segment.name}-${index}`}
                            title={`${segment.name}: ${formatDuration(segment.durationMs)} — ${SEGMENT_NOTES[segment.name]}`}
                            className="absolute inset-y-0 block"
                            style={{
                              left: `${percentOf(segment.startMs, total)}%`,
                              width: `${Math.max(0.4, percentOf(segment.durationMs, total))}%`,
                              background: SEGMENT_FILLS[segment.name],
                            }}
                          />
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="relative mt-2 ml-[18.75rem] h-8">
              <div className="bg-surface border-border/40 absolute inset-0 rounded border" />
              {firstPaintMs !== undefined ? (
                <Marker
                  label={`First Paint ${formatDuration(firstPaintMs)}`}
                  atMs={firstPaintMs}
                  durationMs={total}
                  tone="paint"
                />
              ) : null}
              {largestContentfulPaintMs !== undefined &&
              largestContentfulPaintMs !== firstPaintMs ? (
                <Marker
                  label={`LCP ${formatDuration(largestContentfulPaintMs)}`}
                  atMs={largestContentfulPaintMs}
                  durationMs={total}
                  tone="lcp"
                />
              ) : null}
              {now !== undefined ? (
                <span
                  aria-hidden="true"
                  className="bg-fg absolute inset-y-0 z-20 w-px opacity-60"
                  style={{ left: `${percentOf(now, total)}%` }}
                />
              ) : null}
            </div>
          </div>
        </div>

        <ul aria-label="Segment key" className="flex flex-wrap gap-x-3 gap-y-1">
          {WATERFALL_SEGMENTS.filter((name) => used.has(name)).map((name) => (
            <li
              key={name}
              title={SEGMENT_NOTES[name]}
              className="text-fg-secondary flex items-center gap-1.5 text-[0.625rem]"
            >
              <span
                aria-hidden="true"
                className="border-border/50 block size-2.5 rounded-[3px] border"
                style={{ background: SEGMENT_FILLS[name] }}
              />
              {name}
            </li>
          ))}
        </ul>

        <p className="text-fg-muted text-[0.6875rem] leading-relaxed">
          These are Chrome&rsquo;s own segment names. Subresource rows carry no{' '}
          <span className="text-fg-secondary">DNS Lookup</span>,{' '}
          <span className="text-fg-secondary">Initial connection</span> or{' '}
          <span className="text-fg-secondary">SSL</span> because the document already paid
          for all three, and they reuse its connection &mdash; which is most of what
          connection reuse is worth.
        </p>
      </div>
    </Panel>
  );
}
