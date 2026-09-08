'use client';

import { ShieldAlert } from 'lucide-react';

import { Badge, CodeBlock, Panel } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';

import { WHY_SILENCE_IS_NOT_DOWN, type PingProbe, type PingRun } from '../sim/ping';

/**
 * The ping result, arranged so the two halves of the argument cannot be read separately.
 *
 * The layout is the point. A round-trip chart on its own teaches a learner to read a loss
 * percentage as a verdict on the host, which is the single most common wrong inference in
 * network debugging. So the chart is never shown alone: the TCP check sits directly
 * beside it, the verdict states in one line what the numbers do and do not prove, and the
 * four standing reasons are below both.
 *
 * Colour is never the only signal anywhere here. A lost probe is a hatched bar *and* a
 * `timeout` label *and* a row in the transcript; a filtered host is a warning tone *and*
 * the words "up the whole time".
 */

export interface PingViewProps {
  run: PingRun;
  /** Virtual milliseconds. Probes past this are dimmed, so the panel follows playback. */
  now: number;
  /** Move the playhead; clicking a bar seeks to the moment that probe was sent. */
  onSeek: (time: number) => void;
  className?: string;
}

/** Bar height as a fraction of the tallest round trip on the chart. */
function heightOf(probe: PingProbe, ceiling: number): number {
  if (probe.rttMs === undefined) return 1;
  return Math.max(0.06, probe.rttMs / ceiling);
}

function toneFor(probe: PingProbe): string {
  switch (probe.outcome) {
    case 'reply':
      return 'bg-state-ok/70 group-hover:bg-state-ok';
    case 'timeout':
      return 'bg-state-error/25 group-hover:bg-state-error/40';
    default:
      return 'bg-state-warn/60 group-hover:bg-state-warn';
  }
}

const OUTCOME_LABEL: Record<PingProbe['outcome'], string> = {
  reply: 'reply',
  timeout: 'timeout',
  prohibited: 'filtered',
  'host-unreachable': 'unreachable',
};

/** The round trips, as bars. A timeout is a stub with a hatched fill, never a gap. */
function RttChart({
  run,
  now,
  onSeek,
}: {
  run: PingRun;
  now: number;
  onSeek: (time: number) => void;
}) {
  const ceiling = Math.max(run.stats.maxMs ?? 1, 1);

  return (
    <div className="flex flex-col gap-2">
      <ol
        className="flex h-32 items-end gap-1.5"
        aria-label={`Round-trip time per probe, ${run.stats.sent} probes`}
      >
        {run.probes.map((probe) => {
          const reached = now >= probe.settledAt;
          const label =
            probe.rttMs === undefined
              ? `Probe ${probe.sequence}: ${OUTCOME_LABEL[probe.outcome]}`
              : `Probe ${probe.sequence}: ${probe.rttMs} ms`;

          return (
            <li
              key={probe.sequence}
              className="flex h-full min-w-0 flex-1 flex-col justify-end"
            >
              <button
                type="button"
                onClick={() => onSeek(probe.sentAt)}
                aria-label={`${label}.${reached ? '' : ' Not sent yet.'} Seek to it.`}
                className={cn(
                  'group flex h-full w-full flex-col justify-end rounded-t-sm',
                  focusRing,
                )}
              >
                <span
                  className={cn(
                    'w-full rounded-t-sm transition-[height,background-color]',
                    /*
                     * A probe the run has not sent yet is drawn as an outline rather than
                     * dimmed. It used to be `opacity-35` on the whole button, which took
                     * a bar that already sits at 70% tint down to about 2:1 -- well under
                     * the 3:1 a graphic that carries meaning has to hold. An outline is a
                     * difference in *shape*, so it also survives the grayscale pass, and
                     * the button's label says "Not sent yet" besides.
                     */
                    reached
                      ? toneFor(probe)
                      : 'border-border-strong border border-dashed bg-transparent',
                    reached &&
                      probe.outcome === 'timeout' &&
                      'border-state-error/60 border border-dashed',
                  )}
                  style={{ height: `${heightOf(probe, ceiling) * 100}%` }}
                />
              </button>
            </li>
          );
        })}
      </ol>

      <ol
        className="text-fg-muted flex gap-1.5 font-mono text-[0.65rem]"
        aria-hidden="true"
      >
        {run.probes.map((probe) => (
          <li key={probe.sequence} className="min-w-0 flex-1 truncate text-center">
            {probe.rttMs === undefined
              ? OUTCOME_LABEL[probe.outcome]
              : `${probe.rttMs.toFixed(1)}`}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** min / avg / max / mdev, with mdev explained because nobody remembers what it is. */
function Statistics({ run }: { run: PingRun }) {
  const { stats } = run;
  const cells: { label: string; value: string; note?: string }[] = [
    { label: 'Sent', value: String(stats.sent) },
    { label: 'Received', value: String(stats.received) },
    {
      label: 'Loss',
      value: `${stats.lossPercent}%`,
      note: 'Of the probes. Not of your traffic.',
    },
    ...(stats.minMs === undefined
      ? []
      : [
          { label: 'min', value: `${stats.minMs.toFixed(1)} ms` },
          { label: 'avg', value: `${stats.avgMs?.toFixed(1)} ms` },
          { label: 'max', value: `${stats.maxMs?.toFixed(1)} ms` },
          {
            label: 'mdev',
            value: `${stats.mdevMs?.toFixed(2)} ms`,
            note: 'Jitter: how far the round trips spread around the average. A low average with a high mdev is unusable for anything interactive.',
          },
        ]),
  ];

  return (
    <dl className="grid grid-cols-3 gap-x-4 gap-y-3 sm:grid-cols-4 lg:grid-cols-7">
      {cells.map((cell) => (
        <div key={cell.label} className="min-w-0">
          <dt className="text-fg-muted text-[0.65rem] tracking-wider uppercase">
            {cell.label}
          </dt>
          <dd className="text-fg font-mono text-sm" title={cell.note}>
            {cell.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function PingView({ run, now, onSeek, className }: PingViewProps) {
  const { verdict, contrast } = run;
  const worrying = run.stats.lossPercent > 0;

  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)}>
      <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel
          title="Round trips"
          aside={
            <Badge tone={worrying ? 'warn' : 'ok'}>
              {run.stats.received}/{run.stats.sent} answered
            </Badge>
          }
        >
          <div className="flex flex-col gap-4">
            <RttChart run={run} now={now} onSeek={onSeek} />
            <Statistics run={run} />
          </div>
        </Panel>

        {/*
          The counterweight. Deliberately the same size and the same prominence as the
          chart, because the whole claim of this panel is that the two measurements are
          equally valid answers to different questions -- and only one of them was asked.
        */}
        <Panel
          title="Is the host actually up?"
          aside={
            <Badge tone={contrast.connected ? 'ok' : 'error'}>
              TCP {contrast.port} {contrast.connected ? 'open' : 'no answer'}
            </Badge>
          }
        >
          <div className="flex flex-col gap-3">
            <p className="text-fg text-sm leading-relaxed">{contrast.summary}</p>
            <p className="text-fg-muted text-xs leading-relaxed">
              This is a TCP connection attempt, not an ICMP echo. It measures a different
              protocol reaching a different layer of the far end, which is exactly why it
              can disagree with the column beside it.
            </p>
          </div>
        </Panel>
      </div>

      <Panel
        title="What this result proves"
        aside={
          <Badge
            tone={worrying ? 'warn' : 'neutral'}
            icon={<ShieldAlert className="size-3.5" />}
          >
            read before concluding
          </Badge>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-fg text-sm leading-relaxed font-medium">
            {verdict.headline}
          </p>

          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-state-ok text-[0.65rem] tracking-wider uppercase">
                It proves
              </dt>
              <dd className="text-fg-secondary mt-1 text-sm leading-relaxed">
                {verdict.proves}
              </dd>
            </div>
            <div>
              <dt className="text-state-warn text-[0.65rem] tracking-wider uppercase">
                It does not prove
              </dt>
              <dd className="text-fg-secondary mt-1 text-sm leading-relaxed">
                {verdict.doesNotProve}
              </dd>
            </div>
          </dl>

          {verdict.causes.length > 0 ? (
            <div>
              <p className="text-fg-muted text-[0.65rem] tracking-wider uppercase">
                What could produce this
              </p>
              <ul className="text-fg-secondary mt-1.5 flex flex-col gap-1 text-sm">
                {verdict.causes.map((cause) => (
                  <li key={cause} className="flex gap-2">
                    <span aria-hidden="true" className="text-fg-muted">
                      &bull;
                    </span>
                    {cause}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="border-accent/40 bg-accent/8 text-fg-secondary rounded-lg border-l-2 px-3 py-2 text-sm leading-relaxed">
            <span className="text-accent font-medium">Next: </span>
            {verdict.nextStep}
          </p>
        </div>
      </Panel>

      <div className="grid min-w-0 gap-3 xl:grid-cols-2">
        <Panel title="Why silence is weak evidence" scroll className="max-h-[26rem]">
          <ol className="flex flex-col gap-3">
            {WHY_SILENCE_IS_NOT_DOWN.map((reason, index) => (
              <li key={reason.claim} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="text-fg-muted mt-0.5 font-mono text-xs"
                >
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-fg text-sm font-medium">{reason.claim}</p>
                  <p className="text-fg-secondary mt-1 text-sm leading-relaxed">
                    {reason.detail}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Panel>

        <CodeBlock
          language="ping"
          caption={`Simulated output for ${run.path.destination.hostname}`}
          code={run.output.join('\n')}
          showLineNumbers={false}
          className="max-h-[26rem] overflow-y-auto"
        />
      </div>
    </div>
  );
}
