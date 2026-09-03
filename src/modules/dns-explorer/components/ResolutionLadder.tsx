'use client';

import { useEffect, useRef } from 'react';

import { useReducedMotionSafe } from '@/components/motion';
import { Panel } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { formatTimecode } from '@/components/viz';
import { cn } from '@/lib/cn';

import { currentRungIndex, type Ladder, type LadderRung, type RungTone } from '../ladder';

/**
 * The walk as a sequence diagram: machines across the top, time down the side.
 *
 * This is the view the module exists for, because it is the one that makes the two usual
 * misconceptions impossible to hold. Every arrow lands on a named column, so the root
 * server's reply visibly goes *back* rather than onward, and the answer visibly comes
 * from the third server contacted rather than the first. And every outgoing arrow is
 * labelled with which kind of query it is: one recursive arrow at the top, several
 * iterative ones below it, which is the asymmetry the whole design rests on.
 *
 * ## Synced to the timeline, in both directions
 *
 * Reading it: the rung under the playhead is marked `aria-current` and scrolled into
 * view, and everything after it is dimmed rather than hidden -- a ladder that grew a rung
 * at a time could not be used as an index, and seeing that four more exchanges are coming
 * is part of understanding where the resolver is.
 *
 * Driving it: every rung is a button that seeks to the moment that message was on the
 * wire, so the ladder doubles as a table of contents for the run. Selecting one also pins
 * it for the record table beside it, which is how a learner gets from "the root said
 * something" to the actual bytes of what it said.
 *
 * ## Why the arrows are positioned rather than laid out
 *
 * An arrow spans from one column's centre to another's, and there is no flow layout that
 * expresses that. So the columns are a fixed fraction of the width, and each arrow is
 * placed at the percentage its endpoints work out to. The lifelines behind them use the
 * same arithmetic ({@link centre}), which is what keeps the two aligned.
 */

export interface ResolutionLadderProps {
  ladder: Ladder;
  virtualTime: number;
  /** Total run length, so times print in the timeline's own unit. */
  durationMs: number;
  /** Move the playhead. Wired to the playback store's `seek`. */
  onSeek: (time: number) => void;
  /** The rung whose message is being inspected, if one is pinned. */
  selectedRungId?: string | null;
  onSelectRung?: (rung: LadderRung) => void;
  /** Right-aligned header slot -- the query count and elapsed time. */
  summary?: string;
  className?: string;
}

/**
 * One border colour per tone, used for both the shaft and the head so an arrow is one
 * object. Colour is never the only signal: {@link LadderRung.detail} says what it is.
 */
const TONE_BORDER: Readonly<Record<RungTone, string>> = {
  neutral: 'border-border-strong',
  accent: 'border-accent/70',
  ok: 'border-state-ok/70',
  warn: 'border-state-warn/70',
  error: 'border-state-error/70',
};

const TONE_TEXT: Readonly<Record<RungTone, string>> = {
  neutral: 'text-fg-secondary',
  accent: 'text-accent',
  ok: 'text-state-ok',
  warn: 'text-state-warn',
  error: 'text-state-error',
};

/** Where a column's lifeline sits, as a percentage of the diagram's width. */
function centre(index: number, count: number): number {
  return ((index + 0.5) / count) * 100;
}

export function ResolutionLadder({
  ladder,
  virtualTime,
  durationMs,
  onSeek,
  selectedRungId,
  onSelectRung,
  summary,
  className,
}: ResolutionLadderProps) {
  const { reduced } = useReducedMotionSafe();
  const currentRef = useRef<HTMLLIElement | null>(null);
  const { columns, rungs } = ladder;

  const current = currentRungIndex(rungs, virtualTime);
  const currentId = rungs[current]?.id;

  // On the id rather than on `virtualTime`: the playhead moves sixty times a second and
  // the rung under it changes a couple of dozen times in a whole run.
  useEffect(() => {
    if (!currentId) return;
    currentRef.current?.scrollIntoView?.({
      block: 'nearest',
      behavior: reduced ? 'auto' : 'smooth',
    });
  }, [currentId, reduced]);

  if (columns.length === 0 || rungs.length === 0) {
    return (
      <Panel title="Resolution ladder" className={className}>
        <p className="text-fg-muted text-xs">This run asked nobody anything.</p>
      </Panel>
    );
  }

  return (
    <Panel
      title="Resolution ladder"
      aside={
        <span className="text-fg-muted text-[0.6875rem]">
          {summary ? `${summary} · ` : ''}click a rung to seek
        </span>
      }
      scroll
      flush
      className={cn('max-h-[34rem]', className)}
    >
      <div className="overflow-x-auto">
        {/*
          Wide enough that two adjacent lifelines are far enough apart to read an arrow
          label between them, and no wider -- past that the panel scrolls, which is the
          right trade for the DNSSEC run's eight columns and the wrong one for the
          three-column runs that make up most of the module.
        */}
        <div className="min-w-[42rem]">
          {/* The machines. Left to right is down the tree. */}
          <ol
            aria-label="Machines in this resolution"
            className="bg-surface-raised border-border sticky top-0 z-10 flex border-b"
          >
            {columns.map((column) => (
              <li
                key={column.id}
                className="flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 py-2 text-center"
              >
                <span className="text-fg text-[0.6875rem] font-medium">
                  {column.label}
                </span>
                <span className="text-fg-muted truncate font-mono text-[0.625rem]">
                  {column.name}
                </span>
                <span className="text-fg-muted/70 truncate font-mono text-[0.5625rem]">
                  {column.address}
                </span>
              </li>
            ))}
          </ol>

          <div className="relative">
            {/* Lifelines, behind everything and inert. */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-0">
              {columns.map((column, index) => (
                <span
                  key={column.id}
                  style={{ left: `${centre(index, columns.length)}%` }}
                  className="bg-border/70 absolute top-0 bottom-0 w-px"
                />
              ))}
            </div>

            <ol className="relative">
              {rungs.map((rung, index) => {
                const isCurrent = index === current;
                const isFuture = index > current;
                const isSelected = rung.id === selectedRungId;
                const time = formatTimecode(rung.at, durationMs);

                const from = centre(rung.from, columns.length);
                const to = centre(rung.to, columns.length);
                const rightward = to >= from;
                const left = Math.min(from, to);
                const width = Math.max(Math.abs(to - from), 1.5);

                const description = `${rung.kind === 'query' ? 'Query' : 'Reply'}: ${rung.title}, ${rung.detail}, at ${time}`;

                return (
                  <li
                    key={rung.id}
                    ref={isCurrent ? currentRef : null}
                    aria-current={isCurrent ? 'true' : undefined}
                  >
                    <button
                      type="button"
                      aria-label={`Seek to ${description}`}
                      aria-pressed={isSelected}
                      onClick={() => {
                        onSeek(rung.at);
                        onSelectRung?.(rung);
                      }}
                      className={cn(
                        'relative block w-full cursor-pointer border-t border-transparent py-2.5 text-left transition-colors',
                        'hover:bg-surface-overlay/50',
                        focusRing,
                        isCurrent && 'bg-accent/10',
                        isSelected && 'border-accent/50 bg-accent/12',
                        isFuture && 'opacity-45',
                      )}
                    >
                      <span
                        className="text-fg-muted absolute top-2.5 left-1 font-mono text-[0.5625rem] tabular-nums"
                        aria-hidden="true"
                      >
                        {time}
                      </span>

                      {/* The arrow, and its label sitting on top of it. */}
                      <span
                        aria-hidden="true"
                        style={{ left: `${left}%`, width: `${width}%` }}
                        className="relative block"
                      >
                        <span className="flex flex-col items-center gap-1">
                          <span
                            className={cn(
                              'max-w-full truncate px-1 font-mono text-[0.6875rem]',
                              isFuture ? 'text-fg-muted' : 'text-fg',
                            )}
                          >
                            {rung.title}
                          </span>

                          <span className="flex w-full items-center">
                            {!rightward ? (
                              <span
                                className={cn(
                                  'size-0 border-y-[3px] border-r-[5px]',
                                  TONE_BORDER[rung.tone],
                                  'border-y-transparent',
                                )}
                              />
                            ) : null}
                            <span
                              className={cn(
                                'flex-1 border-t',
                                TONE_BORDER[rung.tone],
                                // A reply is a dashed line, the convention every sequence
                                // diagram uses -- and one that survives greyscale.
                                rung.kind === 'response' && 'border-dashed',
                              )}
                            />
                            {rightward ? (
                              <span
                                className={cn(
                                  'size-0 border-y-[3px] border-l-[5px]',
                                  TONE_BORDER[rung.tone],
                                  'border-y-transparent',
                                )}
                              />
                            ) : null}
                          </span>

                          <span
                            className={cn(
                              'max-w-full truncate px-1 text-[0.625rem]',
                              TONE_TEXT[rung.tone],
                            )}
                          >
                            {rung.detail}
                          </span>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </div>
    </Panel>
  );
}
