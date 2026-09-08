'use client';

import { AlertTriangle } from 'lucide-react';
import { Fragment, memo, useCallback, useEffect, useRef, type RefObject } from 'react';

import { useReducedMotionSafe } from '@/components/motion';
import { Panel } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { formatTimecode } from '@/components/viz';
import { cn } from '@/lib/cn';

import { currentRowIndex, type HopChangeKind, type HopRow } from '../ledger';

/**
 * The ledger: every hop the run performed, and what changed at each one.
 *
 * This is the table that has to be right. Most explanations of routing get one of these
 * columns wrong -- usually by changing an IP address at every hop, or by decrementing the
 * TTL at a switch -- and the value of the table is that all four facts are visible on one
 * line, computed from the packet as it actually crossed rather than described:
 *
 * - both MAC addresses change at every hop, and
 * - neither IP address does, except at the NAT, where exactly one does, and
 * - the TTL comes down by one per router, and
 * - the header checksum is recomputed, because it covers the TTL that just changed.
 *
 * The **Changed** column is a diff against the same packet's previous hop, so it is a
 * statement about this run rather than a caption. A row through a transparent device
 * names it under **via** with nothing in Changed, which is the whole difference between a
 * switch and a router said in the smallest possible space.
 *
 * ## Clicking a row seeks
 *
 * Every row is a seek target: the first cell is a button that moves the playhead to the
 * moment the packet left, so the ledger doubles as an index into the timeline. The row
 * itself is clickable too, for the pointer; the button is what keyboard and screen-reader
 * users get, and it carries the whole description as its accessible name.
 *
 * ## Past, present, and future
 *
 * Rows the playhead has not reached are dimmed rather than hidden -- a ledger that grew a
 * row at a time would be unusable as an index, and being able to see that four more hops
 * are coming is part of understanding where the packet is. The row under the playhead is
 * marked `aria-current` and scrolled into view when it changes.
 */

export interface HopTableProps {
  /** Every hop of the run, from `buildLedger`. */
  rows: readonly HopRow[];
  virtualTime: number;
  /** Total run length, so times are printed in the timeline's own unit. */
  durationMs: number;
  /** Move the playhead. Wired to the playback store's `seek`. */
  onSeek: (time: number) => void;
  /** Node and link ids to display labels — `labelsFor(topology)`. */
  labels: Readonly<Record<string, string>>;
  className?: string;
}

/** Colour per kind of change. Never the only signal -- the text says what it is. */
const CHANGE_TONE: Record<HopChangeKind, string> = {
  mac: 'text-layer-link',
  address: 'text-state-warn',
  ttl: 'text-layer-network',
  checksum: 'text-fg-muted',
  ports: 'text-layer-transport',
};

const HEADINGS = ['Hop', 'Time', 'From → to', 'TTL', 'MAC', 'IP', 'Bytes', 'Changed'];

/**
 * One hop, memoized -- the same trick the event log uses, for the same reason.
 *
 * The ledger lists every hop of the run, and a full journey is a hundred-odd rows of
 * eight columns each. Moving the playhead across a hop changes `isCurrent` on two of them
 * and `isFuture` on one; without the comparison here that would re-render all of them,
 * and Packet Journey is the page where that showed up as measurable jank.
 *
 * `label` is taken rather than `labels` so the memo compares one stable function instead
 * of a record, and the row never has to know where a name came from.
 */
const HopRowView = memo(function HopRowView({
  row,
  isCurrent,
  isFuture,
  newPacket,
  time,
  description,
  label,
  onSeek,
  currentRef,
}: {
  row: HopRow;
  isCurrent: boolean;
  isFuture: boolean;
  /** This row starts a different packet, so it gets a heading above it. */
  newPacket: boolean;
  time: string;
  description: string;
  label: (id: string) => string;
  onSeek: (time: number) => void;
  currentRef: RefObject<HTMLTableRowElement | null>;
}) {
  return (
    <Fragment>
      {newPacket ? (
        <tr className="bg-surface/60">
          <th
            scope="colgroup"
            colSpan={HEADINGS.length}
            className="border-border/60 text-fg-secondary border-t px-2 pt-2.5 pb-1 text-left font-mono text-[0.6875rem] font-normal"
          >
            {row.summary}
          </th>
        </tr>
      ) : null}

      <tr
        ref={isCurrent ? currentRef : null}
        aria-current={isCurrent ? 'true' : undefined}
        onClick={() => onSeek(row.at)}
        className={cn(
          'border-border/40 cursor-pointer border-t align-top transition-colors',
          'hover:bg-surface-overlay/60',
          isCurrent && 'bg-accent/10',
          // `.state-dim`, not an alpha multiplier -- see globals.css.
          isFuture && 'state-dim',
          row.kind === 'drop' && 'bg-state-error/5',
        )}
      >
        <td className="px-2 py-1.5">
          <button
            type="button"
            aria-label={`Seek to ${description}${isFuture ? '. Not reached yet' : ''}`}
            onClick={(event) => {
              event.stopPropagation();
              onSeek(row.at);
            }}
            className={cn(
              'text-fg-muted hover:text-fg rounded px-1 font-mono text-[0.6875rem]',
              focusRing,
              isCurrent && 'text-accent',
            )}
          >
            {row.hop}
          </button>
        </td>

        <td className="text-fg-muted px-2 py-1.5 font-mono whitespace-nowrap">{time}</td>

        <td className="px-2 py-1.5">
          <span className="text-fg-secondary whitespace-nowrap">
            {row.kind === 'drop' ? (
              <span className="text-state-error inline-flex items-center gap-1">
                <AlertTriangle aria-hidden="true" className="size-3" />
                Dropped at {label(row.from)}
              </span>
            ) : (
              <>
                {label(row.from)} → {label(row.to)}
              </>
            )}
          </span>
          {row.via.length > 0 ? (
            <span className="text-fg-muted block text-[0.625rem]">
              via {row.via.map(label).join(', ')} — unchanged
            </span>
          ) : null}
          {row.reason ? (
            <span className="text-state-error block text-[0.625rem] leading-snug">
              {row.reason}
            </span>
          ) : null}
        </td>

        <td className="text-fg px-2 py-1.5 font-mono">{row.addressing.ttl}</td>

        <td className="text-fg-secondary px-2 py-1.5 font-mono text-[0.6875rem] whitespace-nowrap">
          {row.addressing.sourceMac}
          <span className="text-fg-muted"> → </span>
          {row.addressing.destinationMac}
        </td>

        <td className="text-fg-secondary px-2 py-1.5 font-mono text-[0.6875rem] whitespace-nowrap">
          {row.addressing.source}
          <span className="text-fg-muted"> → </span>
          {row.addressing.destination}
        </td>

        <td className="text-fg-muted px-2 py-1.5 font-mono whitespace-nowrap">
          {row.sizeBytes}
        </td>

        <td className="px-2 py-1.5">
          {row.changes.length === 0 ? (
            <span className="text-fg-muted text-[0.625rem]">
              {row.hop === 1 && row.kind === 'crossing' ? 'first hop' : '—'}
            </span>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {row.changes.map((change) => (
                <li
                  key={change.text}
                  className={cn(
                    'font-mono text-[0.625rem] leading-snug whitespace-nowrap',
                    CHANGE_TONE[change.kind],
                  )}
                >
                  {change.text}
                </li>
              ))}
            </ul>
          )}
        </td>
      </tr>
    </Fragment>
  );
});

export function HopTable({
  rows,
  virtualTime,
  durationMs,
  onSeek,
  labels,
  className,
}: HopTableProps) {
  const { reduced } = useReducedMotionSafe();
  const currentRef = useRef<HTMLTableRowElement | null>(null);
  const current = currentRowIndex(rows, virtualTime);
  const currentId = rows[current]?.id;

  // On the id rather than on `virtualTime`: the playhead moves sixty times a second and
  // the row under it changes a few dozen times in a whole run.
  useEffect(() => {
    if (!currentId) return;
    currentRef.current?.scrollIntoView?.({
      block: 'nearest',
      behavior: reduced ? 'auto' : 'smooth',
    });
  }, [currentId, reduced]);

  // Stable, because every row memoizes on it: a fresh closure here would re-render the
  // whole ledger on every render of this component.
  const label = useCallback((id: string) => labels[id] ?? id, [labels]);

  if (rows.length === 0) {
    return (
      <Panel title="Hop by hop" className={className}>
        <p className="text-fg-muted text-xs">This run never put a packet on a wire.</p>
      </Panel>
    );
  }

  return (
    <Panel
      title="Hop by hop"
      aside={
        <span className="text-fg-muted text-[0.6875rem]">
          {rows.length} hops · click a row to seek
        </span>
      }
      scroll
      flush
      className={cn('max-h-[26rem]', className)}
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-xs">
          <caption className="sr-only">
            Every layer-3 hop in this run, with the addressing the packet carried across
            it and what the sending machine changed first. Each row seeks the timeline.
          </caption>
          <thead className="bg-surface-raised sticky top-0 z-10">
            <tr className="text-fg-muted text-[0.625rem] tracking-wider uppercase">
              {HEADINGS.map((heading) => (
                <th
                  key={heading}
                  scope="col"
                  className="border-border border-b px-2 py-2 font-medium whitespace-nowrap"
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((row, index) => {
              const previous = rows[index - 1];

              return (
                <HopRowView
                  key={row.id}
                  row={row}
                  isCurrent={index === current}
                  isFuture={index > current}
                  newPacket={!previous || previous.pduId !== row.pduId}
                  time={formatTimecode(row.at, durationMs)}
                  description={`${row.summary}, hop ${row.hop}: ${label(row.from)} to ${label(
                    row.to,
                  )} at ${formatTimecode(row.at, durationMs)}`}
                  label={label}
                  onSeek={onSeek}
                  currentRef={currentRef}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
