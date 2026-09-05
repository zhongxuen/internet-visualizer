'use client';

import { Badge, Panel } from '@/components/ui';
import { percentOf } from '@/components/viz';
import { cn } from '@/lib/cn';

import {
  counters,
  TRANSPORT_SUMMARIES,
  type TransportComparison as Comparison,
  type TransportRun,
  type WireEvent,
} from '../sim/comparison';

/**
 * Four strategies racing over the same updates, on one clock.
 *
 * Every number here was counted, not estimated. `comparison.ts` builds a realistic browser
 * `GET` — with its cookies and its hundred-character `User-Agent` — for every poll, the real
 * handshake from `upgrade.ts` for the WebSocket column, and real frame headers from
 * `frames.ts` for every message. The polling figure comes out at roughly twenty times the
 * WebSocket figure, and that is only worth saying because nothing in it was assumed.
 *
 * ## The lanes share the playhead
 *
 * All four run against the same virtual clock as the animation above, so scrubbing moves
 * every lane together and the counters above each lane count only what has happened *so far*.
 * That is what makes it a race rather than four finished tables: at eight seconds polling has
 * issued two requests and delivered nothing, and the WebSocket has delivered two updates for
 * twenty-eight bytes.
 *
 * ## It is meant to be fair
 *
 * Each lane carries the verdict `comparison.ts` wrote for it, and three of the four say
 * something a WebSocket is worse at. Polling is stateless and scales horizontally with no
 * coordination at all. Long polling works through any HTTP/1.1 middlebox. Server-Sent Events
 * gets automatic reconnection and `Last-Event-ID` replay from the browser rather than from
 * your application — which is precisely the work the reconnection scenario had to do by hand.
 * A byte count is not a recommendation, and a panel that pretended otherwise would be
 * teaching a preference rather than a trade-off.
 *
 * The figures are HTTP/1.1. Under HTTP/2 HPACK compresses a repeated header set to a handful
 * of bytes, so the polling byte count is an upper bound — but the request count and the
 * average delay of half the poll interval do not move.
 */

export interface TransportComparisonProps {
  comparison: Comparison;
  /** The playhead, in virtual milliseconds. */
  now: number;
  className?: string;
}

const EVENT_TONE: Record<WireEvent['kind'], string> = {
  handshake: 'bg-layer-session',
  request: 'bg-layer-transport',
  response: 'bg-layer-network',
  empty: 'bg-state-warn',
  event: 'bg-layer-application',
  frame: 'bg-accent',
};

const EVENT_LABEL: Record<WireEvent['kind'], string> = {
  handshake: 'Handshake',
  request: 'Request',
  response: 'Response with data',
  empty: 'Empty response — a request that learned nothing',
  event: 'SSE event',
  frame: 'WebSocket frame',
};

/** What each lane has spent by `now`. */
function spentBy(run: TransportRun, now: number) {
  const seen = run.wire.filter((event) => event.at <= now);
  const requests = seen.filter(
    (event) => event.kind === 'request' || event.kind === 'handshake',
  ).length;
  const bytes = seen.reduce((sum, event) => sum + event.bytes, 0);
  const delivered = run.deliveries.filter((delivery) => delivery.deliveredAt <= now);
  const empty = seen.filter((event) => event.kind === 'empty').length;

  return { requests, bytes, empty, delivered: delivered.length };
}

function Counter({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'accent' | 'warn';
}) {
  return (
    <div className="min-w-0">
      <dt className="text-fg-muted text-[0.5625rem] tracking-wider uppercase">{label}</dt>
      <dd
        className={cn(
          'font-mono text-sm tabular-nums',
          tone === 'accent' ? 'text-accent' : tone === 'warn' ? 'text-state-warn' : 'text-fg',
        )}
      >
        {value}
      </dd>
      {hint ? <dd className="text-fg-muted text-[0.5625rem]">{hint}</dd> : null}
    </div>
  );
}

function Lane({
  run,
  comparison,
  now,
}: {
  run: TransportRun;
  comparison: Comparison;
  now: number;
}) {
  const duration = comparison.options.durationMs;
  const spent = spentBy(run, now);
  const total = counters(run);
  const leanest = comparison.leanest === run.transport;
  const fastest = comparison.fastest === run.transport;

  return (
    <li className="border-border bg-surface flex min-w-0 flex-col gap-2 rounded-xl border px-3 py-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h4 className="text-fg text-sm font-medium">{run.label}</h4>
        {run.bidirectional ? (
          <Badge tone="accent">bidirectional</Badge>
        ) : (
          <Badge tone="neutral">server → client only</Badge>
        )}
        {leanest ? <Badge tone="ok">fewest bytes</Badge> : null}
        {fastest ? <Badge tone="ok">lowest latency</Badge> : null}
      </div>

      <p className="text-fg-muted text-[0.6875rem] leading-relaxed">
        {TRANSPORT_SUMMARIES[run.transport]}
      </p>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Counter
          label="Requests"
          value={`${spent.requests}`}
          hint={`${total.requests} over the run`}
          {...(spent.empty > 0 ? { tone: 'warn' as const } : {})}
        />
        <Counter
          label="Bytes"
          value={spent.bytes.toLocaleString('en-US')}
          hint={`${total.totalBytes.toLocaleString('en-US')} over the run`}
        />
        <Counter
          label="Overhead"
          value={`${total.overheadPercent}%`}
          hint={`${run.overheadBytes.toLocaleString('en-US')} B not payload`}
        />
        <Counter
          label="Avg delivery"
          value={`${total.averageLatencyMs} ms`}
          hint={`worst ${run.worstLatencyMs} ms`}
          {...(fastest ? { tone: 'accent' as const } : {})}
        />
      </dl>

      <div className="relative h-7 min-w-0">
        <div className="border-border bg-surface-raised absolute inset-x-0 top-3 h-1 rounded-full border" />

        {run.wire.map((event, index) => (
          <span
            key={`${event.at}-${index}`}
            aria-hidden="true"
            title={`${EVENT_LABEL[event.kind]} — ${event.bytes} B at ${Math.round(event.at)} ms: ${event.note}`}
            className={cn(
              'absolute w-[3px] rounded-full transition-opacity',
              EVENT_TONE[event.kind],
              event.direction === 'up' ? 'top-0 h-3' : 'top-4 h-3',
              event.at <= now ? 'opacity-100' : 'opacity-25',
            )}
            style={{ left: `${percentOf(event.at, duration)}%` }}
          />
        ))}

        {run.deliveries.map((delivery) => (
          <span
            key={delivery.updateIndex}
            aria-hidden="true"
            title={`Update ${delivery.updateIndex + 1} reached the client ${Math.round(delivery.latencyMs)} ms after it happened`}
            className={cn(
              'bg-state-ok absolute top-2 h-3 w-[3px] rounded-full ring-2 ring-state-ok/30',
              delivery.deliveredAt <= now ? 'opacity-100' : 'opacity-25',
            )}
            style={{ left: `${percentOf(delivery.deliveredAt, duration)}%` }}
          />
        ))}

        <span
          aria-hidden="true"
          className="bg-accent absolute inset-y-0 w-px"
          style={{ left: `${percentOf(now, duration)}%` }}
        />
      </div>

      <p className="sr-only">
        {run.label}: {total.requests} requests and {total.totalBytes} bytes over the run,{' '}
        {total.overheadPercent}% of it overhead, average delivery {total.averageLatencyMs} ms.
      </p>

      <p className="text-fg-secondary text-[0.6875rem] leading-relaxed">{run.verdict}</p>
    </li>
  );
}

export function TransportComparison({
  comparison,
  now,
  className,
}: TransportComparisonProps) {
  const polling = comparison.runs.find((run) => run.transport === 'polling');
  const websocket = comparison.runs.find((run) => run.transport === 'websocket');
  const ratio =
    polling && websocket && websocket.totalBytes > 0
      ? Math.round(polling.totalBytes / websocket.totalBytes)
      : undefined;

  return (
    <Panel
      title="Four transports, one timeline"
      aside={
        <Badge tone="neutral">
          {comparison.options.updates.length} updates ·{' '}
          {Math.round(comparison.options.durationMs / 1000)} s
        </Badge>
      }
      className={cn('min-w-0', className)}
    >
      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-fg-secondary text-xs leading-relaxed">
          The same {comparison.options.updates.length} updates, at the same{' '}
          {comparison.options.updates.length} moments, delivered four ways over the same wire.
          {ratio === undefined
            ? ''
            : ` Polling costs about ${ratio}× what the WebSocket costs on this schedule — a number worth quoting only because every byte in it came from a message that was actually built.`}
        </p>

        <ul aria-hidden="true" className="flex flex-wrap gap-x-3 gap-y-1">
          {(Object.keys(EVENT_TONE) as WireEvent['kind'][]).map((kind) => (
            <li key={kind} className="text-fg-muted flex items-center gap-1.5 text-[0.625rem]">
              <span className={cn('inline-block h-2 w-[3px] rounded-full', EVENT_TONE[kind])} />
              {EVENT_LABEL[kind]}
            </li>
          ))}
          <li className="text-fg-muted flex items-center gap-1.5 text-[0.625rem]">
            <span className="bg-state-ok ring-state-ok/30 inline-block h-2 w-[3px] rounded-full ring-2" />
            An update reaching the client
          </li>
        </ul>

        <ul className="flex min-w-0 flex-col gap-2">
          {comparison.runs.map((run) => (
            <Lane key={run.transport} run={run} comparison={comparison} now={now} />
          ))}
        </ul>

        <p className="text-fg-muted text-[0.625rem] leading-relaxed">
          Counted over HTTP/1.1. Under HTTP/2, HPACK compresses a repeated header set down to a
          handful of bytes, so the polling byte count above is an upper bound — but the request
          count does not change, and neither does polling’s average delay of half the interval,
          which is a property of the timer rather than of the encoding.
        </p>
      </div>
    </Panel>
  );
}
