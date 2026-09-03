'use client';

import { Panel } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';

import {
  STATUS_CLASSES,
  STATUS_SEMANTICS,
  type StatusClass,
  type StatusSemantics,
} from '../sim/semantics';
import { sourceForStatus } from '../statuses';

/**
 * The whole registry, with the current one lit up.
 *
 * Status codes are learned as a handful of famous numbers and a vague sense that the
 * first digit means something, which is why a grid is worth more than a list: the five
 * rows *are* the rule, and seeing 301 sit next to 302, 303, 307 and 308 explains the
 * family in a way that reading any one of their definitions does not.
 *
 * ## What is clickable, and what is not
 *
 * Only the codes this module can actually produce. A grid where every cell looks
 * activatable and half of them quietly do nothing is worse than one that is honest about
 * which half is live, so the reachable codes are buttons and the rest are plain cells
 * with the same tooltip text. `statuses.ts` holds that mapping and `statuses.test.ts`
 * runs every entry, so a code advertised here has been proved to come out of the run it
 * points at.
 *
 * ## Two facts per cell that are not the number
 *
 * The reason-phrase is advisory and must never be branched on (RFC 9112 §4), so it is
 * rendered small and grey rather than as a label. Heuristic cacheability is marked with a
 * dot, because the absences are the interesting part: 301 carries it and 302 does not,
 * which is the entire reason a mistyped permanent redirect outlives the deploy that fixed
 * it.
 */

export interface StatusCodeMapProps {
  /** The codes this run produced, in order. All are outlined; the last is filled. */
  active: readonly number[];
  /** Fired for a code the module knows how to reach. Absent codes are never clickable. */
  onSelect: (code: number) => void;
  className?: string;
}

const CLASS_TONES: Readonly<Record<StatusClass, string>> = {
  informational: 'border-state-pending/50 text-state-pending',
  successful: 'border-state-ok/50 text-state-ok',
  redirection: 'border-accent/50 text-accent',
  'client-error': 'border-state-warn/50 text-state-warn',
  'server-error': 'border-state-error/50 text-state-error',
};

/** The class heading's own colour, kept apart so nothing has to slice a class list. */
const CLASS_TEXT: Readonly<Record<StatusClass, string>> = {
  informational: 'text-state-pending',
  successful: 'text-state-ok',
  redirection: 'text-accent',
  'client-error': 'text-state-warn',
  'server-error': 'text-state-error',
};

const CLASS_FILLS: Readonly<Record<StatusClass, string>> = {
  informational: 'bg-state-pending/20',
  successful: 'bg-state-ok/20',
  redirection: 'bg-accent/20',
  'client-error': 'bg-state-warn/20',
  'server-error': 'bg-state-error/20',
};

/** Everything the cell's tooltip says, assembled once so both branches use it. */
function describe(status: StatusSemantics): string {
  const source = sourceForStatus(status.code);
  const heuristic = status.heuristicallyCacheable
    ? ' Heuristically cacheable: reusable with no explicit freshness information at all.'
    : '';
  return `${status.code} ${status.reason} — ${status.summary}${heuristic}${
    source ? ` Click to load a run that produces it: ${source.how}` : ''
  } (${status.rfc})`;
}

export function StatusCodeMap({ active, onSelect, className }: StatusCodeMapProps) {
  const current = active.at(-1);
  const seen = new Set(active);

  return (
    <Panel
      title="Status codes"
      aside={
        <span className="text-fg-muted text-[0.625rem]">
          click a lit code to load a run that produces it
        </span>
      }
      scroll
      className={cn('max-h-[34rem]', className)}
    >
      <div className="flex flex-col gap-3">
        {STATUS_CLASSES.map((group) => {
          const codes = STATUS_SEMANTICS.filter((status) => status.class === group.key);

          return (
            <section key={group.key} aria-labelledby={`status-${group.key}`}>
              <div className="flex flex-wrap items-baseline gap-2">
                <h3
                  id={`status-${group.key}`}
                  className={cn('font-mono text-xs font-medium', CLASS_TEXT[group.key])}
                >
                  {group.range}
                </h3>
                <span className="text-fg-secondary text-[0.6875rem]">{group.label}</span>
                <span className="text-fg-muted text-[0.625rem]">{group.summary}</span>
              </div>

              <ul className="mt-1.5 flex flex-wrap gap-1">
                {codes.map((status) => {
                  const reachable = sourceForStatus(status.code) !== undefined;
                  const isCurrent = status.code === current;
                  const wasSeen = seen.has(status.code);
                  const tooltip = describe(status);

                  const shell = cn(
                    'relative flex min-w-[3.25rem] flex-col items-center rounded-md border px-1.5 py-1 transition-colors',
                    isCurrent
                      ? cn(
                          CLASS_TONES[status.class],
                          CLASS_FILLS[status.class],
                          'font-medium',
                        )
                      : wasSeen
                        ? cn(CLASS_TONES[status.class], 'bg-surface-overlay')
                        : 'border-border bg-surface text-fg-muted',
                  );

                  const inner = (
                    <>
                      <span className="font-mono text-xs tabular-nums">
                        {status.code}
                      </span>
                      <span className="max-w-[5.5rem] truncate text-[0.5625rem] opacity-70">
                        {status.reason}
                      </span>
                      {status.heuristicallyCacheable ? (
                        <span
                          aria-hidden="true"
                          title="Heuristically cacheable"
                          className="absolute top-1 right-1 h-1 w-1 rounded-full bg-current opacity-70"
                        />
                      ) : null}
                    </>
                  );

                  return (
                    <li key={status.code}>
                      {reachable ? (
                        <button
                          type="button"
                          title={tooltip}
                          aria-current={isCurrent ? 'true' : undefined}
                          onClick={() => onSelect(status.code)}
                          className={cn(
                            shell,
                            focusRing,
                            'hover:border-border-strong hover:bg-surface-overlay cursor-pointer',
                          )}
                        >
                          {inner}
                          <span className="sr-only">{tooltip}</span>
                        </button>
                      ) : (
                        <div title={tooltip} className={shell}>
                          {inner}
                          <span className="sr-only">{tooltip}</span>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}

        <p className="text-fg-muted border-border/60 border-t pt-2 text-[0.625rem] leading-snug">
          A dot marks a code that is <em>heuristically cacheable</em> — reusable by a
          cache with no explicit freshness information at all. 301 has one and 302 does
          not, which is why a permanent redirect set by mistake is remembered long after
          it is taken back. The reason-phrase under each number is advisory and no client
          may branch on it (RFC 9112 §4); the number is the whole of the message.
        </p>
      </div>
    </Panel>
  );
}
