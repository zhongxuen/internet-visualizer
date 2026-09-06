'use client';

import { Badge, Panel } from '@/components/ui';
import { cn } from '@/lib/cn';

import {
  CLOSE_CODES,
  closeCodeRange,
  describeCloseCodeRange,
  type CloseCodeRange,
} from '../sim/lifecycle';

/**
 * Every close code, with the column that matters.
 *
 * This is data rather than prose for one reason: four codes in the middle of the range look
 * exactly like the others and can never be sent. No paragraph explaining that works as well as
 * a table with a column saying so, because the reader who needs it is not reading the
 * paragraph — they are scanning for the number they found in their logs.
 *
 * ## 1006 is the number they found
 *
 * It appears in a log, it looks exactly like a code a peer chose, and looking it up finds
 * nothing that explains anything, because it means *no Close frame arrived*. It is the name
 * for the absence of an explanation, and an endpoint that tried to send it would be writing a
 * frame its peer must reject with 1002. 1005 (a Close frame with no payload at all), 1015 (the
 * TLS handshake failed, so there was never a WebSocket) and 1004 (reserved, never defined)
 * are the same kind of thing.
 *
 * ## The ranges are the part worth keeping
 *
 * 4000–4999 is private use: yours, with no registration and no chance of colliding with the
 * protocol, ever. Reaching for 1008 to mean "your subscription lapsed" wastes that and puts an
 * application's meaning on a number the specification may one day define differently.
 */

export interface CloseCodeTableProps {
  /** The code this run ended on, highlighted in the table. */
  activeCode?: number;
  className?: string;
}

const RANGES: readonly CloseCodeRange[] = ['protocol', 'registered', 'private'];

export function CloseCodeTable({ activeCode, className }: CloseCodeTableProps) {
  const activeRange = activeCode === undefined ? undefined : closeCodeRange(activeCode);

  return (
    <Panel
      title="Close codes"
      aside={
        activeCode === undefined ? null : (
          <Badge tone={activeCode === 1006 ? 'error' : 'accent'}>
            this run closed with {activeCode}
          </Badge>
        )
      }
      scroll
      className={cn('min-w-0', className)}
    >
      <div className="flex min-w-0 flex-col gap-3">
        <table className="w-full border-collapse text-left text-xs">
          <caption className="text-fg-muted pb-2 text-left text-[0.6875rem] leading-snug">
            The <em>on the wire</em> column is the whole reason this is a table. Four of
            these can never appear in a frame.
          </caption>
          <thead>
            <tr className="text-fg-muted text-[0.625rem] tracking-wider uppercase">
              <th scope="col" className="py-1 pr-3 font-medium">
                Code
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                On the wire
              </th>
              <th scope="col" className="py-1 font-medium">
                Meaning
              </th>
            </tr>
          </thead>
          <tbody>
            {CLOSE_CODES.map((info) => {
              const active = info.code === activeCode;
              return (
                <tr
                  key={info.code}
                  className={cn(
                    'border-border/60 border-t align-top',
                    active && 'bg-accent/10',
                  )}
                >
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <code className="text-fg font-mono text-[0.6875rem] tabular-nums">
                      {info.code}
                    </code>
                    <p className="text-fg-secondary mt-0.5 text-[0.6875rem]">
                      {info.name}
                    </p>
                    {info.sender ? (
                      <p className="text-fg-muted text-[0.625rem]">
                        sent by the {info.sender}
                      </p>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <Badge tone={info.sendable ? 'ok' : 'error'}>
                      {info.sendable ? 'sendable' : 'never sent'}
                    </Badge>
                  </td>
                  <td className="text-fg-muted py-2 text-[0.6875rem] leading-relaxed">
                    {info.meaning}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <dl className="flex flex-col gap-1.5">
          {RANGES.map((range) => (
            <div
              key={range}
              className={cn(
                'rounded-lg border px-3 py-2',
                activeRange === range
                  ? 'border-accent/60 bg-accent/10'
                  : 'border-border bg-surface',
              )}
            >
              <dt className="sr-only">{range} range</dt>
              <dd className="text-fg-muted text-[0.6875rem] leading-relaxed">
                {describeCloseCodeRange(range)}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Panel>
  );
}
