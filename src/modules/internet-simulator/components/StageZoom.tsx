'use client';

import Link from 'next/link';
import { ArrowUpRight, X } from 'lucide-react';

import { Badge, buttonClasses, Panel } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { formatDuration } from '@/components/viz';
import { cn } from '@/lib/cn';

import { handoffFor } from '../input';
import { stageFacts } from '../stageDetail';
import type { PageLoadRun, StageRun } from '../sim/pipeline';
import type { ParsedUrl } from '../sim/stages/url-parse';

/**
 * One stage, opened up -- and then handed over.
 *
 * The panel deliberately stops short of being a small copy of the DNS Explorer or the HTTPS
 * Explorer. It shows what this stage established (a handful of numbers a learner would
 * quote back), what it cost, what it said as it went, and then a link into the module that
 * takes this protocol apart properly, carrying the URL that is currently in the address
 * bar. The phase doc calls that handoff "what turns a demo into a learning path", and it is
 * the reason this panel can afford to be short.
 *
 * ## The skipped case is the interesting one
 *
 * A repeat visit skips five of the eight stages, and a panel that simply showed nothing for
 * them would waste the best lesson in the module. So a skipped stage keeps its slot, keeps
 * its heading, and prints the pipeline's own sentence about *why* it was unnecessary --
 * which is a different and more useful thing than a stage that merely finished quickly.
 */

export interface StageZoomProps {
  run: PageLoadRun;
  stage: StageRun;
  /** The URL the run was made from; the handoff link carries it onward. */
  url: ParsedUrl;
  /** Move the playhead. Called with an absolute virtual millisecond. */
  onSeek: (ms: number) => void;
  onClose: () => void;
  className?: string;
}

/** The lines this stage wrote, in order. Warnings first-class, not filtered out. */
function narration(stage: StageRun) {
  return stage.events.filter(
    (event): event is Extract<typeof event, { kind: 'log' }> => event.kind === 'log',
  );
}

export function StageZoom({
  run,
  stage,
  url,
  onSeek,
  onClose,
  className,
}: StageZoomProps) {
  const facts = stageFacts(run, stage.id);
  const handoff = handoffFor(stage.id, url);
  const failed = run.failure?.stage === stage.id;
  const lines = narration(stage);

  return (
    <Panel
      title={`Stage: ${stage.title}`}
      className={cn('min-w-0', className)}
      aside={
        <div className="flex items-center gap-2">
          {failed ? (
            <Badge tone="error">Run ended here</Badge>
          ) : stage.status === 'ran' ? (
            <Badge tone="accent">
              {formatDuration(stage.durationMs)} · {Math.round(stage.share * 100)}%
            </Badge>
          ) : (
            <Badge tone="neutral">
              {stage.status === 'skipped' ? 'Skipped' : 'Never reached'}
            </Badge>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the stage detail"
            className={cn(
              'text-fg-muted hover:text-fg rounded p-1 transition-colors',
              focusRing,
            )}
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      }
    >
      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-fg-secondary text-sm leading-relaxed">
          {stage.skipReason ?? stage.summary}
        </p>

        {stage.status === 'ran' ? (
          <button
            type="button"
            onClick={() => onSeek(stage.startMs)}
            className={cn(
              'text-fg-muted hover:text-accent self-start font-mono text-[0.6875rem] underline decoration-dotted underline-offset-2 transition-colors',
              focusRing,
            )}
          >
            Seek the timeline to {formatDuration(stage.startMs)}
          </button>
        ) : null}

        {facts.length > 0 ? (
          <dl className="grid gap-1.5">
            {facts.map((fact) => (
              <div
                key={fact.label}
                className="border-border/60 bg-surface grid gap-0.5 rounded-lg border px-2.5 py-1.5"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <dt className="text-fg-muted text-[0.5625rem] tracking-widest uppercase">
                    {fact.label}
                  </dt>
                  <dd className="text-fg font-mono text-xs">{fact.value}</dd>
                </div>
                {fact.note ? (
                  <p className="text-fg-secondary text-[0.6875rem] leading-relaxed">
                    {fact.note}
                  </p>
                ) : null}
              </div>
            ))}
          </dl>
        ) : null}

        {failed && run.failure ? (
          <div className="border-state-error/50 bg-state-error/10 rounded-lg border px-3 py-2">
            <p className="text-state-error font-mono text-xs">{run.failure.code}</p>
            <p className="text-fg-secondary mt-1 text-xs leading-relaxed">
              {run.failure.explanation}
            </p>
          </div>
        ) : null}

        {lines.length > 0 ? (
          <div className="flex flex-col gap-1">
            <span className="text-fg-muted text-[0.5625rem] tracking-widest uppercase">
              What this stage said
            </span>
            <ol className="flex flex-col gap-0.5">
              {lines.map((event, index) => (
                <li key={`${event.at}-${index}`}>
                  <button
                    type="button"
                    onClick={() => onSeek(event.at)}
                    className={cn(
                      'hover:bg-surface-overlay flex w-full items-baseline gap-2 rounded px-1.5 py-1 text-left transition-colors',
                      focusRing,
                    )}
                  >
                    <span className="text-fg-muted shrink-0 font-mono text-[0.625rem] tabular-nums">
                      {formatDuration(event.at)}
                    </span>
                    <span
                      className={cn(
                        'text-[0.6875rem] leading-relaxed',
                        event.level === 'warn'
                          ? 'text-state-warn'
                          : event.level === 'error'
                            ? 'text-state-error'
                            : 'text-fg-secondary',
                      )}
                    >
                      {event.text}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        {handoff ? (
          <div className="border-border/60 bg-surface flex min-w-0 flex-col gap-2 rounded-lg border px-3 py-2.5">
            <p className="text-fg-secondary text-xs leading-relaxed">{handoff.note}</p>
            <Link
              href={handoff.href}
              className={buttonClasses({ variant: 'secondary', size: 'sm' })}
            >
              {handoff.label}
              <ArrowUpRight aria-hidden="true" className="ml-1 size-3.5" />
            </Link>
            <p className="text-fg-muted font-mono text-[0.625rem] break-all">
              {handoff.href}
            </p>
          </div>
        ) : (
          <p className="text-fg-muted text-[0.6875rem] leading-relaxed">
            No module of its own: parsing a URL and painting a page are browser behaviour
            rather than protocols, so there is nowhere honest to hand this one off to.
          </p>
        )}
      </div>
    </Panel>
  );
}
