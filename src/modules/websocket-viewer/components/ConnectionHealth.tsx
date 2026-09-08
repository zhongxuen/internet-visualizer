'use client';

import { Badge, Panel } from '@/components/ui';
import { percentOf } from '@/components/viz';
import { cn } from '@/lib/cn';

import type { BackoffAttempt, KeepaliveRun } from '../sim/lifecycle';

/**
 * The connection over time: the beat that proves it is alive, and the ladder back after it
 * was not.
 *
 * Two panels in one file because they are two halves of the same question. A keepalive is how
 * an endpoint finds out the connection is gone; backoff is what it does about it. Neither is
 * in the frame format and both are the difference between a WebSocket that works in a demo
 * and one that works on a train.
 *
 * ## The keepalive trace
 *
 * Each beat is a ping out and a pong back, with the round trip measured *on this connection* —
 * through the same proxies and the same queues the application's own messages travel through,
 * which is worth more than a fresh ping to the same host. The last beat has no pong, and the
 * gap after it is the pong timeout: the interval during which everything still looks fine.
 *
 * ## The backoff ladder, twice
 *
 * The upper row is the schedule with jitter; the lower is the same schedule without it. The
 * lower one is what everybody writes first, and it is the one that causes the outage: every
 * client that dropped in the same second computes the identical delay, so they all come back
 * in the same instant, all fail together, and all wait exactly twice as long. The recovering
 * server meets the whole herd at every step.
 *
 * Drawing both is the only way to make that visible, because a single jittered schedule looks
 * like an arbitrary set of numbers until there is a regular one beside it.
 */

export interface ConnectionHealthProps {
  /** The keepalive half. Omit on a scenario that has no beats. */
  keepalive?: KeepaliveRun;
  /** The backoff half. */
  backoff?: {
    readonly schedule: readonly BackoffAttempt[];
    readonly withoutJitter: readonly BackoffAttempt[];
    readonly explain: { headline: string; detail: string };
    /** How many attempts actually ran before one succeeded. */
    readonly used: number;
  };
  className?: string;
}

function KeepaliveTrace({ run }: { run: KeepaliveRun }) {
  const end = run.deadAt ?? (run.beats[run.beats.length - 1]?.sentAt ?? 0) + 5_000;

  return (
    <section aria-label="Keepalive" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <h4 className="text-fg-secondary text-xs font-medium tracking-widest uppercase">
          Keepalive
        </h4>
        <Badge tone="neutral">{run.overheadBytes} B over the run</Badge>
        {run.deadAt === undefined ? null : (
          <Badge tone="error">declared dead at {Math.round(run.deadAt / 1000)} s</Badge>
        )}
      </div>

      <div className="relative h-8 min-w-0">
        <div className="border-border bg-surface absolute inset-x-0 top-3.5 h-1 rounded-full border" />
        {run.beats.map((beat) => (
          <span key={beat.index} className="contents">
            <span
              aria-hidden="true"
              title={`Ping ${beat.index} at ${Math.round(beat.sentAt / 1000)} s`}
              className="bg-accent absolute top-1 h-3 w-[3px] rounded-full"
              style={{ left: `${percentOf(beat.sentAt, end)}%` }}
            />
            {beat.pongAt === undefined ? null : (
              <span
                aria-hidden="true"
                title={`Pong ${beat.index}, round trip ${beat.roundTripMs} ms`}
                className="bg-state-ok absolute top-4 h-3 w-[3px] rounded-full"
                style={{ left: `${percentOf(beat.pongAt, end)}%` }}
              />
            )}
          </span>
        ))}
        {run.deadAt === undefined ? null : (
          <span
            aria-hidden="true"
            className="bg-state-error absolute inset-y-0 w-px"
            style={{ left: `${percentOf(run.deadAt, end)}%` }}
          />
        )}
      </div>

      <ol className="flex flex-wrap gap-1.5">
        {run.beats.map((beat) => (
          <li
            key={beat.index}
            className={cn(
              'rounded-lg border px-2 py-1 text-[0.625rem]',
              beat.timedOut
                ? 'border-state-error/50 bg-state-error/10 text-state-error'
                : 'border-border bg-surface text-fg-secondary',
            )}
          >
            <span className="font-mono tabular-nums">
              {Math.round(beat.sentAt / 1000)} s
            </span>
            <span className="text-fg-muted"> · </span>
            {beat.timedOut ? 'no pong' : `${beat.roundTripMs} ms round trip`}
          </li>
        ))}
      </ol>

      <p className="text-fg-muted text-[0.6875rem] leading-relaxed">{run.explain}</p>
    </section>
  );
}

function BackoffLadder({
  backoff,
}: {
  backoff: NonNullable<ConnectionHealthProps['backoff']>;
}) {
  const widest = Math.max(
    ...backoff.withoutJitter.map((attempt) => attempt.capMs),
    ...backoff.schedule.map((attempt) => attempt.delayMs),
    1,
  );

  return (
    <section aria-label="Reconnection backoff" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <h4 className="text-fg-secondary text-xs font-medium tracking-widest uppercase">
          Reconnecting
        </h4>
        <Badge tone="accent">{backoff.used} attempts used</Badge>
      </div>

      <p className="text-fg text-xs font-medium">{backoff.explain.headline}</p>
      <p className="text-fg-secondary text-[0.6875rem] leading-relaxed">
        {backoff.explain.detail}
      </p>

      <table className="w-full border-collapse text-left text-xs">
        <caption className="text-fg-muted pb-2 text-left text-[0.6875rem] leading-snug">
          The window doubles either way. What the randomisation changes is where inside it
          each client lands.
        </caption>
        <thead>
          <tr className="text-fg-muted text-[0.625rem] tracking-wider uppercase">
            <th scope="col" className="py-1 pr-3 font-medium">
              Attempt
            </th>
            <th scope="col" className="py-1 pr-3 font-medium">
              Window
            </th>
            <th scope="col" className="py-1 font-medium">
              Waited
            </th>
          </tr>
        </thead>
        <tbody>
          {backoff.schedule.map((attempt, index) => {
            const plain = backoff.withoutJitter[index];
            const used = attempt.attempt <= backoff.used;

            return (
              <tr
                key={attempt.attempt}
                className={cn(
                  'border-border/60 border-t align-middle',
                  !used && 'state-dim',
                )}
              >
                <td className="text-fg py-2 pr-3 font-mono text-[0.6875rem] tabular-nums">
                  {attempt.attempt}
                  {used ? '' : ' (not needed)'}
                </td>
                <td className="text-fg-muted py-2 pr-3 font-mono text-[0.6875rem] whitespace-nowrap tabular-nums">
                  0 – {Math.round(attempt.capMs)} ms
                </td>
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    <div className="border-border bg-surface relative h-4 min-w-0 flex-1 overflow-hidden rounded border">
                      <span
                        aria-hidden="true"
                        className="bg-border-strong/50 absolute inset-y-0 left-0"
                        style={{ width: `${(attempt.capMs / widest) * 100}%` }}
                      />
                      <span
                        aria-hidden="true"
                        className="bg-accent absolute inset-y-0 left-0"
                        style={{ width: `${(attempt.delayMs / widest) * 100}%` }}
                      />
                      {plain ? (
                        <span
                          aria-hidden="true"
                          title="Where every client would land with no jitter"
                          className="bg-state-warn absolute inset-y-0 w-px"
                          style={{ left: `${(plain.delayMs / widest) * 100}%` }}
                        />
                      ) : null}
                    </div>
                    <span className="text-fg font-mono text-[0.6875rem] tabular-nums">
                      {Math.round(attempt.delayMs)} ms
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="text-fg-muted text-[0.625rem] leading-relaxed">
        The pale bar is the window, the solid one is where this client actually landed,
        and the amber line is where <em>every</em> client lands with no jitter at all —
        the same instant, every round.
      </p>
    </section>
  );
}

export function ConnectionHealth({
  keepalive,
  backoff,
  className,
}: ConnectionHealthProps) {
  if (keepalive === undefined && backoff === undefined) return null;

  return (
    <Panel title="Connection health" className={cn('min-w-0', className)}>
      <div className="flex min-w-0 flex-col gap-4">
        {keepalive ? <KeepaliveTrace run={keepalive} /> : null}
        {backoff ? <BackoffLadder backoff={backoff} /> : null}
      </div>
    </Panel>
  );
}
