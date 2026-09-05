'use client';

import { Badge, CodeBlock, Panel } from '@/components/ui';
import { cn } from '@/lib/cn';

import {
  REST_VS_GRAPHQL,
  type GraphQLResult,
  type TransportComparison,
  type TransportCost,
} from '../sim/graphql';

/**
 * Both bills, itemised, with neither one rounded in its own favour.
 *
 * The numbers come from `compareTransports`, which counts what actually happened in the run
 * above rather than what a comparison table would like to have happened. Four of them are
 * worth reading together and are easy to conflate:
 *
 * - **Round trips** are not all equal. Three REST calls that can be issued at once cost one
 *   round trip of latency; three where each needs an id from the last cost three. The
 *   *sequential* count is the one that shows up as a slow screen.
 * - **Wasted bytes** are the over-fetching half, and they are the cheaper half: bandwidth gets
 *   better every year and latency does not.
 * - **Request bytes** favour REST, because a GraphQL query travels in the body. On a small
 *   response that is a real fraction of the total, so it is counted rather than dropped.
 * - **Data-source calls** are the server's bill, which the client stopped paying and somebody
 *   still does. Shown twice: as a naive resolver runs it, and with per-field batching.
 *
 * `REST_VS_GRAPHQL` beneath is data in `sim/graphql.ts`, and its test asserts that every row
 * says something substantive on both sides -- that the caching row credits REST and the
 * fetching row credits GraphQL. A comparison that only listed one side's wins would be an
 * advertisement rather than an explanation.
 */

export interface TransportBillProps {
  comparison: TransportComparison;
  /** The query as a naive resolver runs it: one data-source call per field, per parent. */
  unbatched: GraphQLResult;
  /** The same query with per-field batching, as DataLoader does it. */
  batched: GraphQLResult;
  query: string;
  className?: string;
}

interface Row {
  readonly label: string;
  readonly hint: string;
  readonly read: (cost: TransportCost) => string;
  /** Which side the smaller number favours, for the marker. */
  readonly lowerIsBetter: boolean;
  readonly value: (cost: TransportCost) => number;
}

const ROWS: readonly Row[] = [
  {
    label: 'Requests',
    hint: 'How many times the client asked for something.',
    read: (cost) => `${cost.roundTrips}`,
    value: (cost) => cost.roundTrips,
    lowerIsBetter: true,
  },
  {
    label: 'Sequential round trips',
    hint: 'Requests that could not be issued until an earlier one returned. This is the latency number.',
    read: (cost) => `${cost.sequentialRoundTrips}`,
    value: (cost) => cost.sequentialRoundTrips,
    lowerIsBetter: true,
  },
  {
    label: 'Request bytes',
    hint: 'Everything sent. GraphQL is larger here, because the query is the body.',
    read: (cost) => `${cost.requestBytes}`,
    value: (cost) => cost.requestBytes,
    lowerIsBetter: true,
  },
  {
    label: 'Response bytes',
    hint: 'Everything received.',
    read: (cost) => `${cost.responseBytes}`,
    value: (cost) => cost.responseBytes,
    lowerIsBetter: true,
  },
  {
    label: 'Bytes the screen read',
    hint: 'Of what came back, how much was actually rendered.',
    read: (cost) => `${cost.usedBytes}`,
    value: (cost) => cost.usedBytes,
    lowerIsBetter: false,
  },
  {
    label: 'Bytes discarded',
    hint: 'Over-fetching, measured rather than asserted.',
    read: (cost) => `${cost.wastedBytes}`,
    value: (cost) => cost.wastedBytes,
    lowerIsBetter: true,
  },
];

export function TransportBill({
  comparison,
  unbatched,
  batched,
  query,
  className,
}: TransportBillProps) {
  return (
    <Panel
      title="Both bills"
      aside={<Badge tone="neutral">measured, not claimed</Badge>}
      scroll
      className={cn('min-w-0', className)}
    >
      <div className="flex min-w-0 flex-col gap-3">
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full min-w-[22rem] text-left text-xs">
            <thead>
              <tr className="text-fg-muted text-[0.5625rem] tracking-widest uppercase">
                <th scope="col" className="py-1 font-normal">
                  Measure
                </th>
                <th scope="col" className="py-1 text-right font-normal">
                  REST
                </th>
                <th scope="col" className="py-1 text-right font-normal">
                  GraphQL
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => {
                const rest = row.value(comparison.rest);
                const graphql = row.value(comparison.graphql);
                const restWins = row.lowerIsBetter ? rest < graphql : rest > graphql;
                const graphqlWins = row.lowerIsBetter ? graphql < rest : graphql > rest;

                return (
                  <tr key={row.label} className="border-border/60 border-t align-top">
                    <th scope="row" className="py-1.5 pr-2 font-normal">
                      <span className="text-fg">{row.label}</span>
                      <span className="text-fg-muted block text-[0.625rem] leading-snug">
                        {row.hint}
                      </span>
                    </th>
                    <td
                      className={cn(
                        'py-1.5 text-right font-mono tabular-nums',
                        restWins ? 'text-state-ok' : 'text-fg',
                      )}
                    >
                      {row.read(comparison.rest)}
                    </td>
                    <td
                      className={cn(
                        'py-1.5 text-right font-mono tabular-nums',
                        graphqlWins ? 'text-state-ok' : 'text-fg',
                      )}
                    >
                      {row.read(comparison.graphql)}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-border/60 border-t align-top">
                <th scope="row" className="py-1.5 pr-2 font-normal">
                  <span className="text-fg">Data-source calls on the server</span>
                  <span className="text-fg-muted block text-[0.625rem] leading-snug">
                    Work the client stopped doing and somebody still pays for. The second
                    number is the same query with per-field batching.
                  </span>
                </th>
                <td className="text-fg-muted py-1.5 text-right font-mono text-[0.625rem]">
                  one per endpoint
                </td>
                <td className="py-1.5 text-right font-mono tabular-nums">
                  <span className="text-state-warn">
                    {unbatched.stats.dataSourceCalls}
                  </span>
                  <span className="text-fg-muted"> → </span>
                  <span className="text-state-ok">{batched.stats.dataSourceCalls}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <ul className="flex flex-col gap-1">
          {comparison.notes.map((note) => (
            <li key={note} className="text-fg-secondary text-[0.6875rem] leading-relaxed">
              — {note}
            </li>
          ))}
        </ul>

        <CodeBlock
          code={query}
          language="graphql"
          caption="The query — which is also the shape of the response"
          showLineNumbers={false}
        />

        <div className="flex flex-col gap-1.5">
          <span className="text-fg-muted text-[0.5625rem] tracking-widest uppercase">
            Where each one is stronger
          </span>
          <ul className="flex flex-col gap-1">
            {REST_VS_GRAPHQL.map((tradeoff) => (
              <li
                key={tradeoff.topic}
                className="border-border/60 bg-surface rounded-lg border px-2.5 py-2"
              >
                <p className="text-fg text-xs font-medium">{tradeoff.topic}</p>
                <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
                  <div>
                    <p className="text-fg-muted text-[0.5625rem] tracking-widest uppercase">
                      REST
                    </p>
                    <p className="text-fg-secondary text-[0.6875rem] leading-relaxed">
                      {tradeoff.rest}
                    </p>
                  </div>
                  <div>
                    <p className="text-fg-muted text-[0.5625rem] tracking-widest uppercase">
                      GraphQL
                    </p>
                    <p className="text-fg-secondary text-[0.6875rem] leading-relaxed">
                      {tradeoff.graphql}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Panel>
  );
}
