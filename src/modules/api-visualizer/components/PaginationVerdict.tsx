'use client';

import { Badge, Panel } from '@/components/ui';
import { cn } from '@/lib/cn';

import type { CollectionItem } from '../sim/exchange';
import { PAGINATION_TRADEOFFS, type DriftRun } from '../sim/pagination';

/**
 * The two runs, side by side, with what each client ended up holding.
 *
 * The verdict is the whole point of the scenario and it has to be countable rather than
 * argued: same rows, same edits, same page size, and one client received an item twice while
 * the other did not. So the panel draws the received sequence as a strip of ids, marks the
 * repeats and the gaps, and puts the two strips one above the other.
 *
 * ## The row that keeps this honest
 *
 * `PAGINATION_TRADEOFFS` is data in `sim/pagination.ts` and its test asserts that each entry
 * says something substantive on both sides -- that the cursor row admits it cannot jump to
 * page fifty and cannot show a total without a second query, and that the offset row is
 * credited with both. A comparison that only listed the winner's wins would be an
 * advertisement, and the correctness result above is strong enough not to need one.
 */

export interface PaginationVerdictProps {
  offset: DriftRun<CollectionItem>;
  cursor: DriftRun<CollectionItem>;
  /** Every id that was in the collection for the whole run. */
  items: readonly CollectionItem[];
  className?: string;
}

function Strip({ run, label }: { run: DriftRun<CollectionItem>; label: string }) {
  const seen = new Set<string>();

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-fg text-xs font-medium">{label}</span>
        <Badge tone={run.correct ? 'ok' : 'error'}>
          {run.correct ? 'every stable row exactly once' : 'wrong'}
        </Badge>
      </div>

      <ol className="flex flex-wrap gap-1">
        {run.received.map((id, index) => {
          const repeat = seen.has(id);
          seen.add(id);
          return (
            <li key={`${id}-${index}`}>
              <span
                title={repeat ? `${id} was already sent` : id}
                className={cn(
                  'inline-block rounded border px-1.5 py-0.5 font-mono text-[0.625rem]',
                  repeat
                    ? 'border-state-error/60 bg-state-error/15 text-state-error'
                    : 'border-border bg-surface text-fg-secondary',
                )}
              >
                {id}
                {repeat ? <span className="sr-only"> (repeated)</span> : null}
              </span>
            </li>
          );
        })}
      </ol>

      <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-[0.6875rem]">
        <div className="flex gap-1.5">
          <dt className="text-fg-muted">received</dt>
          <dd className="text-fg font-mono tabular-nums">{run.received.length}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-fg-muted">repeated</dt>
          <dd
            className={cn(
              'font-mono tabular-nums',
              run.duplicated.length > 0 ? 'text-state-error' : 'text-fg',
            )}
          >
            {run.duplicated.length > 0 ? run.duplicated.join(', ') : 'none'}
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-fg-muted">never sent</dt>
          <dd
            className={cn(
              'font-mono tabular-nums',
              run.missed.length > 0 ? 'text-state-error' : 'text-fg',
            )}
          >
            {run.missed.length > 0 ? run.missed.join(', ') : 'none'}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function PaginationVerdict({
  offset,
  cursor,
  items,
  className,
}: PaginationVerdictProps) {
  return (
    <Panel
      title="What each client ended up with"
      aside={<Badge tone="neutral">{items.length} stable rows</Badge>}
      scroll
      className={cn('min-w-0', className)}
    >
      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-fg-secondary text-xs leading-relaxed">
          Same rows, same page size, same two edits at the same two moments. The only
          difference is what the client asked for on page two.
        </p>

        <Strip run={offset} label="Offset: ?offset=n&limit=5" />
        <Strip run={cursor} label="Cursor: ?after=<position>&limit=5" />

        <p className="text-fg-muted text-[0.6875rem] leading-relaxed">
          A row that was inserted or deleted mid-run is excluded from &ldquo;never
          sent&rdquo; on purpose — whether a client sees one of those is genuinely a
          matter of timing. What is left is the damning set: rows that were in the
          collection from the first request to the last and were still missed.
        </p>

        <div className="flex flex-col gap-1.5">
          <span className="text-fg-muted text-[0.5625rem] tracking-widest uppercase">
            What each one costs
          </span>
          <ul className="flex flex-col gap-1">
            {PAGINATION_TRADEOFFS.map((tradeoff) => (
              <li
                key={tradeoff.strategy}
                className="border-border/60 bg-surface rounded-lg border px-2.5 py-2"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-fg font-mono text-xs">{tradeoff.strategy}</span>
                  <Badge tone={tradeoff.stableUnderWrites ? 'ok' : 'warn'}>
                    {tradeoff.stableUnderWrites
                      ? 'stable under writes'
                      : 'drifts under writes'}
                  </Badge>
                  <Badge tone={tradeoff.randomAccess ? 'ok' : 'neutral'}>
                    {tradeoff.randomAccess ? 'jump to any page' : 'no random access'}
                  </Badge>
                  <Badge tone={tradeoff.totalCount === 'free' ? 'ok' : 'neutral'}>
                    total: {tradeoff.totalCount}
                  </Badge>
                </div>
                <p className="text-fg-secondary mt-1 text-[0.6875rem] leading-relaxed">
                  Deep pages: {tradeoff.deepPageCost}
                </p>
                <p className="text-fg-muted mt-0.5 text-[0.6875rem] leading-relaxed">
                  Use when: {tradeoff.useWhen}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Panel>
  );
}
