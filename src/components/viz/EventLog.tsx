'use client';

import { useEffect, useRef } from 'react';

import type { SimEvent } from '@/core/types/events';
import type { PDU } from '@/core/types/pdu';
import { cn } from '@/lib/cn';

import { describeEvent, type EventTone } from './events';
import { formatTimecode } from './time';

/**
 * The running commentary, and a way to travel through it.
 *
 * The whole run is listed, not just what has happened: events still ahead are dimmed and
 * marked, and clicking any line seeks to it. That makes the log a table of contents as
 * well as a transcript -- "take me to the moment the router dropped it" is one click,
 * forwards or backwards, because seeking is exact.
 *
 * It is also the accessible counterpart to the animation. Packet chips are hidden from
 * assistive technology (a position changing sixty times a second is noise); everything
 * they convey is here as ordinary text, in order, with timestamps.
 *
 * Collapsible via a native `<details>`, so it is keyboard-operable and correctly
 * announced without a line of JavaScript.
 */

export interface EventLogProps {
  /** Every event in the run, in order -- not only those already reached. */
  events: readonly SimEvent[];
  /** The playhead; events at or before it are shown as having happened. */
  virtualTime: number;
  durationMs: number;
  /** Node and link ids to display labels, from `labelsFor(topology)`. */
  labels?: Readonly<Record<string, string>>;
  pdus?: Readonly<Record<string, PDU>>;
  onSeek: (time: number) => void;
  defaultOpen?: boolean;
  className?: string;
}

/** Tone as a colour *and* a printed word, so the severity survives greyscale. */
const TONES: Record<EventTone, { className: string; word: string }> = {
  info: { className: 'text-fg-secondary', word: 'Info' },
  accent: { className: 'text-accent', word: 'Phase' },
  warn: { className: 'text-state-warn', word: 'Warning' },
  error: { className: 'text-state-error', word: 'Error' },
};

export function EventLog({
  events,
  virtualTime,
  durationMs,
  labels,
  pdus,
  onSeek,
  defaultOpen = true,
  className,
}: EventLogProps) {
  /** The last event that has already happened -- the line the log follows. */
  let latestIndex = -1;
  for (const [index, event] of events.entries()) {
    if (event.at <= virtualTime) latestIndex = index;
    else break;
  }

  const activeRef = useRef<HTMLLIElement | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);

  useEffect(() => {
    const list = listRef.current;
    const active = activeRef.current;
    if (!list || !active) return;

    /*
      The log's own box is scrolled by hand rather than with `scrollIntoView`, which
      cannot be used here at any `block` setting: it walks up the tree and scrolls every
      scrollable ancestor, the document included. Following the playhead would then drag
      the whole page -- once per event, thirty-odd times over a run -- and a viewer
      reading the diagram would have it slide out from under them. `block: 'nearest'`
      only minimizes the distance scrolled; it does not keep the scrolling local.

      Rects rather than `offsetTop`: the list is not a positioned element, so the offset
      parent is somewhere further up and the arithmetic would be against the wrong box.
    */
    const listBox = list.getBoundingClientRect();
    const activeBox = active.getBoundingClientRect();

    if (activeBox.top < listBox.top) {
      list.scrollTop -= listBox.top - activeBox.top;
    } else if (activeBox.bottom > listBox.bottom) {
      list.scrollTop += activeBox.bottom - listBox.bottom;
    }
  }, [latestIndex]);

  return (
    <details
      open={defaultOpen}
      className={cn('border-border bg-surface-raised group rounded-xl border', className)}
    >
      <summary className="focus-visible:outline-focus text-fg-secondary flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-2.5 text-xs font-medium tracking-widest uppercase focus-visible:outline-2 focus-visible:outline-offset-2">
        Event log
        <span className="text-fg-muted font-mono text-[0.6875rem] normal-case">
          {latestIndex + 1} / {events.length}
        </span>
      </summary>

      <ol
        ref={listRef}
        className="border-border max-h-56 overflow-y-auto border-t px-2 py-2"
      >
        {events.map((event, index) => {
          const line = describeEvent(event, { labels, pdus });
          const tone = TONES[line.tone];
          const reached = index <= latestIndex;
          const current = index === latestIndex;

          return (
            <li key={`${event.kind}-${index}`} ref={current ? activeRef : undefined}>
              <button
                type="button"
                onClick={() => onSeek(event.at)}
                className={cn(
                  'focus-visible:outline-focus flex w-full items-baseline gap-2.5 rounded px-2 py-1 text-left text-xs focus-visible:outline-2 focus-visible:outline-offset-1',
                  'hover:bg-surface-overlay',
                  current && 'bg-surface-overlay',
                  !reached && 'opacity-45',
                )}
              >
                <span className="text-fg-muted w-14 shrink-0 text-right font-mono text-[0.6875rem] tabular-nums">
                  {formatTimecode(event.at, durationMs)}
                </span>
                <span className={cn('min-w-0 flex-1', tone.className)}>
                  <span className="sr-only">
                    {tone.word}
                    {reached ? '. ' : '. Not reached yet. '}
                  </span>
                  {line.text}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </details>
  );
}
