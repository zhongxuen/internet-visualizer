'use client';

import { Panel } from '@/components/ui';
import { formatTimecode } from '@/components/viz';
import { cn } from '@/lib/cn';

import { formatEndpoint, type NatTable as NatTableState } from '../sim/nat';

/**
 * The translation table, as the router fills it in.
 *
 * This is the clearest available answer to "why can't I just connect to my computer from
 * outside the house". Three devices share one public address; the only thing that can
 * tell their replies apart is this table, and it is written by the outgoing packet. A
 * reply that matches no row has nothing to be sent back to, which is what a port forward
 * exists to arrange in advance.
 *
 * ## Live, not final
 *
 * `runJourneyDetailed` hands back the table as the run left it -- every row it ever held.
 * Showing all of them at `t = 0` would be a spoiler and, worse, a lie about how a NAPT
 * works, so a row appears only once the playhead has passed the moment the outgoing
 * packet created it, and **Last used** stays empty until the playhead reaches the last
 * packet that matched the row in either direction.
 *
 * The reversal itself is not shown here, because it does not happen here: it is the
 * destination address changing back on the return leg, which the hop table prints on the
 * row where it happens. This table is the *reason* that is possible.
 */

export interface NatTableProps {
  /** The table at the end of the run, from `runJourneyDetailed`. */
  table: NatTableState;
  /** Display label of the translating router. */
  routerLabel: string;
  virtualTime: number;
  durationMs: number;
  className?: string;
}

const HEADINGS = [
  'Protocol',
  'Inside (private)',
  'Outside (public)',
  'Destination',
  'Created',
  'Last used',
];

export function NatTable({
  table,
  routerLabel,
  virtualTime,
  durationMs,
  className,
}: NatTableProps) {
  const rows = table.bindings.filter((binding) => binding.createdAt <= virtualTime);

  return (
    <Panel
      title="NAT translation table"
      aside={
        <span className="text-fg-muted text-[0.6875rem]">
          {routerLabel} · {table.publicIp}
        </span>
      }
      flush
      className={className}
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-xs">
          <caption className="text-fg-muted px-4 py-2 text-left text-[0.6875rem] leading-snug">
            Written by the packet on its way out and read backwards on the way in. Without
            the row, a reply arriving at {table.publicIp} could not be told which machine
            in the house had asked for it.
          </caption>
          <thead>
            <tr className="text-fg-muted text-[0.625rem] tracking-wider uppercase">
              {HEADINGS.map((heading) => (
                <th
                  key={heading}
                  scope="col"
                  className="border-border border-b px-3 py-2 font-medium whitespace-nowrap"
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={HEADINGS.length}
                  className="text-fg-muted px-3 py-3 text-[0.6875rem]"
                >
                  Empty. The first packet out of the house writes the first row.
                </td>
              </tr>
            ) : (
              rows.map((binding) => {
                // Refreshed by every packet that matches the row, outbound or inbound,
                // so this is "when was this conversation last alive" rather than a claim
                // about which direction touched it.
                const matchedAgain =
                  binding.lastUsedAt > binding.createdAt &&
                  binding.lastUsedAt <= virtualTime;

                return (
                  <tr
                    key={`${binding.protocol}-${formatEndpoint(binding.insideGlobal)}`}
                    className="border-border/40 border-t"
                  >
                    <td className="text-fg-muted px-3 py-1.5 font-mono uppercase">
                      {binding.protocol}
                    </td>
                    <td className="text-fg px-3 py-1.5 font-mono whitespace-nowrap">
                      {formatEndpoint(binding.insideLocal)}
                    </td>
                    <td className="text-state-warn px-3 py-1.5 font-mono whitespace-nowrap">
                      {formatEndpoint(binding.insideGlobal)}
                    </td>
                    <td className="text-fg-secondary px-3 py-1.5 font-mono whitespace-nowrap">
                      {formatEndpoint(binding.outside)}
                    </td>
                    <td className="text-fg-muted px-3 py-1.5 font-mono whitespace-nowrap">
                      {formatTimecode(binding.createdAt, durationMs)}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-1.5 font-mono whitespace-nowrap',
                        matchedAgain ? 'text-fg-secondary' : 'text-fg-muted',
                      )}
                    >
                      {matchedAgain ? (
                        formatTimecode(binding.lastUsedAt, durationMs)
                      ) : (
                        <span className="text-[0.6875rem]">
                          only the packet that made it
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
