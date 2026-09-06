'use client';

import { Timer } from 'lucide-react';
import { useCallback, useSyncExternalStore } from 'react';

import { Badge, Panel } from '@/components/ui';
import { cn } from '@/lib/cn';

import type { LiveQuota } from '../live/client';

/**
 * The 429, shown as a fact rather than as a hiccup.
 *
 * The temptation with a rate limit is to hide it and retry — which is exactly what a
 * diagnostics module must not do. A silent retry loop is indistinguishable from probing,
 * it defeats the limiter that exists to keep this module from being usable as a scanner,
 * and it hides from the user that the deployment has a shared budget at all. So: the
 * refusal is displayed, the countdown runs in the open, and the only thing that starts
 * another request is the user pressing Run again after it reaches zero.
 *
 * The quota row is shown whenever the server sent `X-RateLimit-*`, not only on a
 * refusal, because a limit that first appears at the moment it stops you is a limit that
 * feels arbitrary. Seeing "3 of 10 left" two runs earlier is the difference between a
 * budget and an ambush.
 */

export interface RateLimitNoticeProps {
  /** Seconds still to wait. Zero or less means the next run is allowed. */
  secondsRemaining: number;
  /** The message the server sent. Shown as-is; it names which bucket refused. */
  message: string;
  quota?: LiveQuota;
  className?: string;
}

/**
 * Whole seconds left until `untilMs`, ticking down to zero and stopping there.
 *
 * Lives here rather than in the console because the countdown and the notice that
 * displays it are one idea, and because the console needs the same number to keep the
 * Run button disabled — one hook, one source of truth, no chance of a button that is
 * enabled while the panel above it still says to wait.
 */
export function useRetryCountdown(untilMs: number | undefined): number {
  // The clock is an external store, and this is what `useSyncExternalStore` is for: a
  // value React does not own, read consistently, with no `setState` in an effect and no
  // impure call in a render body. The snapshot is quantised to whole seconds so it is
  // stable between the ticks that ask for it, which is the caching React requires.
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (untilMs === undefined) return () => {};
      const id = setInterval(onStoreChange, 250);
      return () => clearInterval(id);
    },
    [untilMs],
  );

  const snapshot = useCallback(
    () =>
      untilMs === undefined ? 0 : Math.max(0, Math.ceil((untilMs - Date.now()) / 1000)),
    [untilMs],
  );

  // Zero on the server: a countdown belongs to the session that was refused, and there
  // is no such session during prerendering.
  return useSyncExternalStore(subscribe, snapshot, () => 0);
}

export function RateLimitNotice({
  secondsRemaining,
  message,
  quota,
  className,
}: RateLimitNoticeProps) {
  const waiting = secondsRemaining > 0;

  return (
    <Panel
      title="Rate limited"
      aside={
        <Badge tone={waiting ? 'warn' : 'ok'}>
          {waiting ? `${secondsRemaining}s` : 'You can run again'}
        </Badge>
      }
      className={cn('border-state-warn/40 min-w-0', className)}
    >
      <div className="flex flex-col gap-3">
        <p className="text-fg-secondary flex items-start gap-2 text-sm leading-relaxed">
          <Timer aria-hidden="true" className="text-state-warn mt-0.5 size-4 shrink-0" />
          {/* `role="status"` so the countdown reaching zero is announced rather than
              only seen. */}
          <span role="status">{message}</span>
        </p>

        <p className="text-fg-muted text-xs leading-relaxed">
          Nothing was retried, and nothing will be: this page makes exactly one request
          per press of Run. The limit is per client and per deployment, and it is what
          keeps a teaching tool from being usable as a scanner.
        </p>

        {quota ? (
          <dl className="text-fg-secondary grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-xs sm:grid-cols-3">
            <div className="flex justify-between gap-2">
              <dt className="text-fg-muted">limit</dt>
              <dd>{quota.limit}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-fg-muted">remaining</dt>
              <dd>{quota.remaining}</dd>
            </div>
            {quota.resetAt > 0 ? (
              <div className="flex justify-between gap-2">
                <dt className="text-fg-muted">full again</dt>
                <dd>{new Date(quota.resetAt * 1000).toLocaleTimeString()}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </div>
    </Panel>
  );
}
