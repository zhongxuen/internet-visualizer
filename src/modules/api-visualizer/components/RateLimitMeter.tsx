'use client';

import { Badge, Panel } from '@/components/ui';
import { cn } from '@/lib/cn';

import type { ExchangeLimit } from '../sim/exchange';
import {
  bucketLevel,
  LIMITER_ALGORITHMS,
  RATELIMIT_HEADER_STATUS,
  type ClientRun,
  type TokenBucket,
} from '../sim/ratelimit';

/**
 * The bucket, live, as the playhead moves.
 *
 * A token bucket has no timer in it. The level is *computed* from a stored number and a
 * stored timestamp whenever anyone looks -- which is how a real limiter tracking a million
 * clients works too, because a million refill timers is not a design. That is why this meter
 * can be scrubbed backwards and forwards exactly: it is not animating a value, it is asking
 * `bucketLevel` what the level is at whatever millisecond the playhead is on.
 *
 * ## What to watch
 *
 * The bar does not fall across a `429`. A refused request costs no token, which is what stops
 * a client in a retry loop from starving its own bucket -- and what makes refusing cheap,
 * since saying no is arithmetic on two numbers rather than work.
 *
 * ## Why the fill is fractional
 *
 * Because the bucket is. Rounding the level to whole tokens would make the refill jerk forward
 * one token at a time and would lose the remainder on every partial interval, so a bucket
 * refilling at half a token per second, consulted once a second and rounded down, would never
 * refill at all.
 */

export interface RateLimitMeterProps {
  /** The bucket as it was before the first attempt. */
  initial: TokenBucket;
  /** Every attempt, with the bucket each one left behind. */
  attempts: readonly { readonly atMs: number; readonly limit: ExchangeLimit }[];
  /** The playhead, in virtual milliseconds. */
  now: number;
  /** The same client ignoring `Retry-After`, for the contrast. */
  ignoringRetryAfter?: ClientRun;
  /** The obedient run, for the same comparison. */
  run?: ClientRun;
  className?: string;
}

/** The most recent attempt at or before `now`; the bucket refills forward from there. */
function currentBucket(props: RateLimitMeterProps): {
  readonly bucket: TokenBucket;
  readonly last?: ExchangeLimit;
} {
  let bucket = props.initial;
  let last: ExchangeLimit | undefined;
  for (const attempt of props.attempts) {
    if (attempt.atMs > props.now) break;
    bucket = attempt.limit.bucket;
    last = attempt.limit;
  }
  return { bucket, ...(last ? { last } : {}) };
}

function Meter({ bucket, now }: { bucket: TokenBucket; now: number }) {
  const level = Math.max(
    0,
    Math.min(1, bucketLevel(bucket, Math.max(now, bucket.updatedAtMs))),
  );
  const tokens = level * bucket.capacity;
  const empty = tokens < 1;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-fg-muted text-[0.5625rem] tracking-widest uppercase">
          Tokens available
        </span>
        <span
          className={cn(
            'font-mono text-sm tabular-nums',
            empty ? 'text-state-warn' : 'text-fg',
          )}
        >
          {tokens.toFixed(2)} / {bucket.capacity}
        </span>
      </div>

      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={bucket.capacity}
        aria-valuenow={Number(tokens.toFixed(2))}
        aria-label="Tokens available in the bucket"
        className="border-border bg-surface relative h-6 overflow-hidden rounded-lg border"
      >
        <div
          className={cn(
            'h-full transition-[width] duration-150',
            empty ? 'bg-state-warn/40' : 'bg-accent/40',
          )}
          style={{ width: `${level * 100}%` }}
        />
        {/* One tick per whole token: the burst size is a count, not a percentage, and a bar
            without them reads as a continuous quota rather than as five discrete requests. */}
        <div aria-hidden="true" className="absolute inset-0 flex">
          {Array.from({ length: bucket.capacity }, (_, index) => (
            <span
              key={index}
              className="border-border/70 h-full flex-1 border-r last:border-r-0"
            />
          ))}
        </div>
      </div>

      <p className="text-fg-muted text-[0.625rem] leading-snug">
        Capacity {bucket.capacity} is the <em>burst</em>; {bucket.refillPerSecond} per
        second is the <em>sustained</em> rate. They are different numbers, and an
        integration written against the first will meet the second in production.
      </p>
    </div>
  );
}

function Comparison({ run, ignoring }: { run: ClientRun; ignoring: ClientRun }) {
  const refusals = (client: ClientRun) =>
    client.attempts.filter((attempt) => !attempt.allowed).length;

  const rows = [
    {
      label: 'Obeys Retry-After',
      run,
      note: 'Uses the number the server sent, which is the moment a token exists.',
    },
    {
      label: 'Own backoff curve',
      run: ignoring,
      note: 'Uses an exponential guess made without that information.',
    },
  ];

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-fg-muted text-[0.5625rem] tracking-widest uppercase">
        The same nine requests, two clients
      </span>
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="text-fg-muted text-[0.5625rem] tracking-widest uppercase">
            <th scope="col" className="py-1 font-normal">
              Client
            </th>
            <th scope="col" className="py-1 text-right font-normal">
              Refusals
            </th>
            <th scope="col" className="py-1 text-right font-normal">
              Attempts
            </th>
            <th scope="col" className="py-1 text-right font-normal">
              Finished
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-border/60 border-t align-top">
              <th scope="row" className="text-fg py-1.5 pr-2 font-normal">
                {row.label}
                <span className="text-fg-muted block text-[0.625rem] leading-snug">
                  {row.note}
                </span>
              </th>
              <td className="text-fg py-1.5 text-right font-mono tabular-nums">
                {refusals(row.run)}
              </td>
              <td className="text-fg py-1.5 text-right font-mono tabular-nums">
                {row.run.attempts.length}
              </td>
              <td className="text-fg py-1.5 text-right font-mono tabular-nums">
                {(row.run.endedAtMs / 1000).toFixed(1)}s
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RateLimitMeter(props: RateLimitMeterProps) {
  const { bucket, last } = currentBucket(props);
  const { now, run, ignoringRetryAfter, className } = props;

  return (
    <Panel
      title="Token bucket"
      aside={
        last ? (
          <Badge tone={last.allowed ? 'ok' : 'warn'}>
            {last.allowed
              ? '200 — token spent'
              : `429 — retry in ${last.retryAfterSeconds}s`}
          </Badge>
        ) : (
          <Badge tone="neutral">idle</Badge>
        )
      }
      scroll
      className={cn('min-w-0', className)}
    >
      <div className="flex min-w-0 flex-col gap-3">
        <Meter bucket={bucket} now={now} />

        {last && !last.allowed ? (
          <p className="text-state-warn text-xs leading-relaxed">
            Refused, and the bar did not move. A refused request costs no token — a
            limiter that charged for saying no would let a client in a tight retry loop
            hold its own bucket empty indefinitely.
          </p>
        ) : null}

        {run && ignoringRetryAfter ? (
          <Comparison run={run} ignoring={ignoringRetryAfter} />
        ) : null}

        <div className="flex flex-col gap-1.5">
          <span className="text-fg-muted text-[0.5625rem] tracking-widest uppercase">
            What is actually specified
          </span>
          <p className="text-fg-secondary text-[0.6875rem] leading-relaxed">
            {RATELIMIT_HEADER_STATUS}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-fg-muted text-[0.5625rem] tracking-widest uppercase">
            Other ways to count
          </span>
          <ul className="flex flex-col gap-1">
            {LIMITER_ALGORITHMS.map((algorithm) => (
              <li
                key={algorithm.name}
                className="border-border/60 bg-surface rounded-lg border px-2.5 py-1.5"
              >
                <p className="text-fg text-xs font-medium">{algorithm.name}</p>
                <p className="text-fg-secondary mt-0.5 text-[0.6875rem] leading-relaxed">
                  {algorithm.how}
                </p>
                <p className="text-state-ok mt-0.5 text-[0.6875rem] leading-relaxed">
                  {algorithm.strength}
                </p>
                <p className="text-fg-muted mt-0.5 text-[0.6875rem] leading-relaxed">
                  {algorithm.weakness}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Panel>
  );
}
