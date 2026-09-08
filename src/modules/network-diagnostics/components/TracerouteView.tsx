'use client';

import { Badge, CodeBlock, Panel } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';

import {
  TRACEROUTE_CAVEATS,
  type TracerouteHop,
  type TracerouteRun,
  type TtlStep,
} from '../sim/traceroute';

/**
 * The hop list, the TTL arithmetic behind it, and the reasons not to trust it as a map.
 *
 * Three panels, in the order the understanding has to be built:
 *
 * 1. **The hop table**, which is what the tool prints -- one row per TTL, three times per
 *    row, `* * *` where nothing answered.
 * 2. **The TTL walk for the selected row**, which is why that row exists at all. Every
 *    step shows the hop limit going in, the hop limit coming out, and the header checksum
 *    changing because the hop limit is part of the header. The row where it reaches zero
 *    is the row that generated the ICMP Time Exceeded, and it is marked as such.
 * 3. **The caveats**, with the ones this particular trace demonstrates marked.
 *
 * Selecting a row seeks the timeline to that TTL's probe, so the table is also an index
 * into the animation.
 */

export interface TracerouteViewProps {
  run: TracerouteRun;
  /** The TTL whose walk is expanded. */
  selectedTtl: number;
  onSelect: (ttl: number) => void;
  /** Virtual milliseconds; rows the playhead has not reached are dimmed. */
  now: number;
  onSeek: (time: number) => void;
  className?: string;
}

/** `20.412` / `*`, in the column a real traceroute would print it in. */
function ProbeCell({ hop, index }: { hop: TracerouteHop; index: number }) {
  const probe = hop.probes[index];
  if (!probe || probe.rttMs === undefined) {
    return (
      <span className="text-fg-muted font-mono" title="No answer before the deadline">
        *
      </span>
    );
  }
  return <span className="text-fg font-mono">{probe.rttMs.toFixed(1)}</span>;
}

/** One TTL, as a table row that seeks. */
function HopRow({
  hop,
  selected,
  reached,
  onSelect,
}: {
  hop: TracerouteHop;
  selected: boolean;
  reached: boolean;
  onSelect: () => void;
}) {
  const responder = hop.silent ? null : hop.responders.join(' / ');

  return (
    <tr
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'border-border/60 border-t transition-colors',
        selected && 'bg-accent/10',
        // `.state-dim`, not an alpha multiplier (globals.css), and not on the selected
        // row, whose accent tint the dim token is not measured against.
        !reached && !selected && 'state-dim',
      )}
    >
      <th scope="row" className="py-1.5 pr-3 text-left align-top">
        <button
          type="button"
          onClick={onSelect}
          className={cn(
            'text-fg-muted hover:text-fg rounded font-mono text-xs',
            focusRing,
            selected && 'text-accent',
          )}
          aria-label={`Hop ${hop.ttl}${responder ? `, ${responder}` : ', no reply'}.${reached ? '' : ' Not reached yet.'} Show its TTL walk.`}
        >
          {hop.ttl}
        </button>
      </th>
      <td className="py-1.5 pr-3 align-top">
        {responder ? (
          <span className="text-fg font-mono text-xs break-all">{responder}</span>
        ) : (
          <span className="text-fg-muted text-xs italic">no reply</span>
        )}
        {hop.flag ? (
          <span className="text-state-warn ml-2 font-mono text-xs">{hop.flag}</span>
        ) : null}
      </td>
      <td className="py-1.5 pr-2 text-right align-top text-xs">
        <ProbeCell hop={hop} index={0} />
      </td>
      <td className="py-1.5 pr-2 text-right align-top text-xs">
        <ProbeCell hop={hop} index={1} />
      </td>
      <td className="py-1.5 pr-3 text-right align-top text-xs">
        <ProbeCell hop={hop} index={2} />
      </td>
      <td className="text-fg-muted py-1.5 align-top text-xs leading-relaxed">
        {hop.responders.length > 1 ? (
          <Badge tone="accent" className="mr-1.5 align-middle">
            two paths
          </Badge>
        ) : null}
        {hop.isDestination ? (
          <Badge tone="ok" className="mr-1.5 align-middle">
            arrived
          </Badge>
        ) : null}
        {hop.note}
      </td>
    </tr>
  );
}

/** The arithmetic that produced one row. */
function TtlWalk({ hop }: { hop: TracerouteHop }) {
  return (
    <ol className="flex flex-col gap-1.5">
      {hop.walk.map((step: TtlStep, index) => (
        <li
          key={step.nodeId}
          className={cn(
            'flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border px-3 py-2',
            step.expired
              ? 'border-state-error/50 bg-state-error/10'
              : 'border-border bg-surface-overlay/40',
          )}
        >
          <span className="text-fg-muted font-mono text-[0.65rem]">{index + 1}</span>
          <span className="text-fg min-w-0 flex-1 text-sm">{step.label}</span>
          <span className="text-fg-secondary font-mono text-xs">
            TTL {step.ttlIn}
            <span aria-hidden="true" className="text-fg-muted mx-1">
              &rarr;
            </span>
            <span className={cn(step.expired && 'text-state-error font-semibold')}>
              {step.ttlOut}
            </span>
          </span>
          <span
            className="text-fg-muted font-mono text-[0.65rem]"
            title="The header checksum covers the header, and the TTL is in the header -- so it is recomputed at every hop."
          >
            cksum {hex(step.checksumIn)} &rarr; {hex(step.checksumOut)}
          </span>
          {step.expired ? (
            <span className="text-state-error basis-full text-xs leading-relaxed">
              Zero. RFC 791 requires the datagram to be discarded here, and RFC 792
              requires this router to send back an ICMP Time Exceeded &mdash;{' '}
              {hop.silent
                ? 'which this one does not, so the row is three stars. The probe still got this far, and every row below proves it.'
                : 'which carries its own source address. That report is the only reason this hop appears in the list at all.'}
            </span>
          ) : null}
        </li>
      ))}
      {hop.isDestination ? (
        <li className="border-state-ok/50 bg-state-ok/10 text-fg-secondary rounded-md border px-3 py-2 text-xs leading-relaxed">
          The TTL survived every router, so nothing discarded the probe and it was
          delivered. The destination answers for itself, and traceroute stops.
        </li>
      ) : null}
    </ol>
  );
}

function hex(value: number): string {
  return `0x${value.toString(16).padStart(4, '0')}`;
}

export function TracerouteView({
  run,
  selectedTtl,
  onSelect,
  now,
  onSeek,
  className,
}: TracerouteViewProps) {
  const selected = run.hops.find((hop) => hop.ttl === selectedTtl) ?? run.hops[0];
  const demonstrated = new Set(run.caveats.map((caveat) => caveat.id));

  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)}>
      <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel
          title="Hops"
          aside={
            <Badge tone={run.reachedDestination ? 'ok' : 'warn'}>
              {run.reachedDestination
                ? `${run.hops.length} hops to ${run.path.destination.hostname}`
                : 'never arrived'}
            </Badge>
          }
          scroll
          className="max-h-[30rem]"
        >
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">
              One row per TTL. Three probes per row; a star is a probe that got no answer.
            </caption>
            <thead>
              <tr className="text-fg-muted text-[0.65rem] tracking-wider uppercase">
                <th scope="col" className="pr-3 pb-1.5 font-medium">
                  TTL
                </th>
                <th scope="col" className="pr-3 pb-1.5 font-medium">
                  Responded
                </th>
                <th
                  scope="col"
                  colSpan={3}
                  className="pr-3 pb-1.5 text-right font-medium"
                >
                  ms
                </th>
                <th scope="col" className="pb-1.5 font-medium">
                  Note
                </th>
              </tr>
            </thead>
            <tbody>
              {run.hops.map((hop) => (
                <HopRow
                  key={hop.ttl}
                  hop={hop}
                  selected={hop.ttl === selected?.ttl}
                  reached={now >= (hop.probes[0]?.sentAt ?? 0)}
                  onSelect={() => {
                    onSelect(hop.ttl);
                    onSeek(hop.probes[0]?.sentAt ?? 0);
                  }}
                />
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel
          title={selected ? `How hop ${selected.ttl} was found` : 'TTL walk'}
          aside={
            <Badge tone="neutral">
              {run.method === 'udp' ? 'UDP probe' : 'ICMP probe'}
            </Badge>
          }
          scroll
          className="max-h-[30rem]"
        >
          {selected ? (
            <div className="flex flex-col gap-3">
              <p className="text-fg-secondary text-sm leading-relaxed">
                The probe leaves with the hop limit set to {selected.ttl}. Each router
                subtracts one and recomputes the header checksum, because the checksum
                covers the header and the hop limit is in it.
              </p>
              <TtlWalk hop={selected} />
            </div>
          ) : null}
        </Panel>
      </div>

      <div className="grid min-w-0 gap-3 xl:grid-cols-2">
        <Panel title="What this output is not">
          <ol className="flex flex-col gap-3">
            {TRACEROUTE_CAVEATS.map((caveat) => (
              <li key={caveat.id} className="flex flex-col gap-1">
                <p className="text-fg flex flex-wrap items-center gap-2 text-sm font-medium">
                  {caveat.title}
                  {demonstrated.has(caveat.id) ? (
                    <Badge tone="accent">visible in this trace</Badge>
                  ) : null}
                </p>
                <p className="text-fg-secondary text-sm leading-relaxed">
                  {caveat.detail}
                </p>
              </li>
            ))}
          </ol>
        </Panel>

        <div className="flex min-w-0 flex-col gap-3">
          <CodeBlock
            language="traceroute"
            caption={`Simulated output for ${run.path.destination.hostname}`}
            code={run.output.join('\n')}
            showLineNumbers={false}
            className="overflow-x-auto"
          />
          <Panel title="The probe">
            <p className="text-fg-secondary text-sm leading-relaxed">
              {run.method === 'udp'
                ? 'The probe is a UDP datagram aimed at an unassigned high port. Every router on the way answers with Time Exceeded; the destination has nothing listening there, so it answers Destination Unreachable, code 3 -- which is how the tool knows it has arrived.'
                : 'The probe is an ICMP Echo Request. Routers answer Time Exceeded exactly as before, and the destination answers with an Echo Reply.'}
            </p>
            <p className="text-fg-muted mt-2 text-sm leading-relaxed">
              Filters treat the two methods differently, so a trace full of stars under
              one is often clean under the other. A path is not broken because a probe
              type is blocked.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
