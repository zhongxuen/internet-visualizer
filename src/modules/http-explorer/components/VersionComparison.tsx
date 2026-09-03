'use client';

import { useState } from 'react';

import { Badge, Panel } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { formatDuration } from '@/components/viz';
import { cn } from '@/lib/cn';

import { HTTP_VERSIONS, type HttpVersion } from '../sim/message';
import {
  HEAD_OF_LINE_BLOCKING,
  VERSION_PROFILES,
  type StreamTiming,
  type VersionComparison as Comparison,
  type VersionRun,
} from '../sim/versions';

/**
 * The same page load, three ways, on one scale.
 *
 * This is the module's first-class comparison view, and the reason it exists rather than
 * a paragraph is that "HTTP/2 is faster" is a claim people already believe and cannot
 * explain. What they usually cannot say is that it is faster for one reason and *slower*
 * for another, and that only HTTP/3 fixes the second -- so the panel is arranged to make
 * the second row unavoidable.
 *
 * ## Two head-of-line blockings, not one
 *
 * | | HTTP/1.1 | HTTP/2 | HTTP/3 |
 * | --- | --- | --- | --- |
 * | Application layer | blocked | **clear** | clear |
 * | Transport layer | per request | **all streams** | **clear** |
 *
 * HTTP/2 put every stream inside one TCP byte stream, so a single lost segment stalls all
 * of them -- which is worse than HTTP/1.1, where six connections mean one lost segment
 * stalls one request. That row is the one left out of nearly every explanation, and it is
 * the entire reason QUIC had to be built on UDP. Both rows are rendered from
 * `HEAD_OF_LINE_BLOCKING` in `sim/versions.ts`, so the prose and the simulation are the
 * same source.
 *
 * ## The bars are the same scale, and the losses are the same losses
 *
 * Every bar is measured against the slowest run, so the widths are directly comparable.
 * More importantly the packet losses are drawn once per *resource* and shared by all
 * three runs, which is what makes this a comparison rather than three runs of three
 * different networks: the three versions meet one identical network event and score
 * differently on it.
 */

export interface VersionComparisonProps {
  comparison: Comparison;
  className?: string;
}

const VERSION_TONES: Readonly<Record<HttpVersion, string>> = {
  'HTTP/1.1': 'bg-state-warn/60',
  'HTTP/2': 'bg-accent/60',
  'HTTP/3': 'bg-state-ok/60',
};

/** `ms` at the precision a page-load number is worth quoting to. */
function ms(value: number): string {
  return formatDuration(value);
}

/** One resource's life on the wire, as a positioned bar. */
function StreamBar({ stream, scale }: { stream: StreamTiming; scale: number }) {
  const left = (stream.queuedAt / scale) * 100;
  const blocked = ((stream.startedAt - stream.queuedAt) / scale) * 100;
  const waiting = ((stream.firstByteAt - stream.startedAt) / scale) * 100;
  const body = ((stream.completedAt - stream.firstByteAt) / scale) * 100;
  const stalled = ((stream.ownStallMs + stream.holStallMs) / scale) * 100;

  return (
    <li className="flex items-center gap-2">
      <span className="text-fg-muted w-24 shrink-0 truncate font-mono text-[0.5625rem]">
        {stream.label}
      </span>
      <span className="bg-surface relative h-2.5 min-w-0 flex-1 overflow-hidden rounded-sm">
        <span
          className="absolute inset-y-0 flex"
          style={{
            left: `${left}%`,
            width: `${Math.max(blocked + waiting + body, 0.5)}%`,
          }}
        >
          {blocked > 0 ? (
            <span
              title={`queued ${ms(stream.blockedMs)} behind another request`}
              className="bg-state-error/50 h-full"
              style={{ width: `${(blocked / (blocked + waiting + body)) * 100}%` }}
            />
          ) : null}
          <span
            title={`waiting ${ms(stream.firstByteAt - stream.startedAt)} for the first byte`}
            className="bg-border h-full"
            style={{ width: `${(waiting / (blocked + waiting + body)) * 100}%` }}
          />
          <span
            title={`${stream.responseBytes} bytes arriving`}
            className="bg-accent/60 h-full"
            style={{ width: `${(body / (blocked + waiting + body)) * 100}%` }}
          />
        </span>
      </span>
      <span className="text-fg-muted w-16 shrink-0 text-right font-mono text-[0.5625rem] tabular-nums">
        {ms(stream.completedAt)}
        {stalled > 0 ? <span className="text-state-error"> ⚠</span> : null}
      </span>
    </li>
  );
}

/** The numbers behind one version's bar. */
function Breakdown({ run }: { run: VersionRun }) {
  const rows: [string, string, string][] = [
    [
      'Setup',
      `${run.handshake.roundTrips} RTT · ${ms(run.handshake.ms)}`,
      run.handshake.explanation,
    ],
    [
      'Connections',
      `${run.connections.length} × ${run.profile.transport}`,
      run.profile.connectionsPerOrigin === 1
        ? 'One connection carrying every request as a stream.'
        : `Up to ${run.profile.connectionsPerOrigin} to one origin, because each carries one exchange at a time.`,
    ],
    [
      'Queued behind others',
      ms(run.applicationHolMs),
      'Application-layer head-of-line blocking: bytes that were ready and not allowed out.',
    ],
    [
      'Stalled by another stream',
      ms(run.transportHolMs),
      'Transport-layer head-of-line blocking: somebody else’s lost packet, holding this one up.',
    ],
    [
      'Stalled by its own loss',
      ms(run.ownStallMs),
      'Unavoidable. Every version pays this one.',
    ],
    [
      'Request header bytes',
      `${run.requestHeaderBytesRaw} → ${run.requestHeaderBytesOnWire}`,
      run.profile.headerCompression === 'none'
        ? 'No compression: every request re-sends every field in full, forever.'
        : `${run.profile.headerCompression} is a table both ends keep in step, so repeats cost almost nothing.`,
    ],
  ];

  return (
    <dl className="mt-2 grid gap-x-3 gap-y-1 sm:grid-cols-2">
      {rows.map(([label, value, hint]) => (
        <div key={label} title={hint} className="min-w-0">
          <dt className="text-fg-muted text-[0.5625rem] tracking-wide uppercase">
            {label}
          </dt>
          <dd className="text-fg-secondary font-mono text-[0.6875rem]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function VersionComparison({ comparison, className }: VersionComparisonProps) {
  const [expanded, setExpanded] = useState<HttpVersion | null>(null);
  const scale = comparison.runs[comparison.slowest].completedAt || 1;

  return (
    <Panel
      title="The same page load, three ways"
      aside={
        <span className="text-fg-muted text-[0.625rem]">
          {comparison.resources.length} resources · {comparison.conditions.rttMs} ms RTT ·{' '}
          {comparison.losses.length} packet{' '}
          {comparison.losses.length === 1 ? 'loss' : 'losses'}
        </span>
      }
      scroll
      className={cn('max-h-[40rem]', className)}
    >
      <div className="flex flex-col gap-3">
        <ul className="flex flex-col gap-2">
          {comparison.verdicts.map((verdict) => {
            const run = comparison.runs[verdict.version];
            const open = expanded === verdict.version;
            const handshakeShare = (run.handshake.ms / scale) * 100;

            return (
              <li key={verdict.version}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? null : verdict.version)}
                  className={cn(
                    'w-full rounded-lg border px-2.5 py-2 text-left transition-colors',
                    focusRing,
                    open
                      ? 'border-border-strong bg-surface-overlay'
                      : 'border-border bg-surface hover:border-border-strong',
                  )}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="flex items-baseline gap-2">
                      <span className="text-fg font-mono text-xs font-medium">
                        {verdict.version}
                      </span>
                      <Badge tone={verdict.rank === 1 ? 'ok' : 'neutral'}>
                        {verdict.rank === 1 ? 'fastest' : `+${ms(verdict.deltaMs)}`}
                      </Badge>
                    </span>
                    <span className="text-fg-secondary font-mono text-xs tabular-nums">
                      {ms(verdict.completedAt)}
                    </span>
                  </div>

                  <span className="bg-surface-raised mt-1.5 flex h-3 w-full overflow-hidden rounded-sm">
                    <span
                      title={`setup: ${run.handshake.explanation}`}
                      className="bg-border h-full"
                      style={{ width: `${handshakeShare}%` }}
                    />
                    <span
                      className={cn('h-full', VERSION_TONES[verdict.version])}
                      style={{ width: `${verdict.relative - handshakeShare}%` }}
                    />
                  </span>

                  <span className="text-fg-muted mt-1 block text-[0.625rem] leading-snug">
                    {verdict.because}
                  </span>
                </button>

                {open ? (
                  <div className="border-border/60 bg-surface-raised mt-1 rounded-lg border px-2.5 py-2">
                    <Breakdown run={run} />
                    <p className="text-fg-muted mt-2 text-[0.5625rem] tracking-wide uppercase">
                      Each resource, on the shared scale
                    </p>
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {run.streams.map((stream) => (
                        <StreamBar
                          key={stream.resourceId}
                          stream={stream}
                          scale={scale}
                        />
                      ))}
                    </ul>
                    <p className="text-fg-muted mt-1.5 text-[0.5625rem] leading-snug">
                      Red is time queued behind another request, grey is waiting for the
                      first byte, and blue is the body arriving. ⚠ marks a transfer that
                      stalled on a retransmission.
                    </p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>

        <section aria-labelledby="hol-heading">
          <h3
            id="hol-heading"
            className="text-fg-muted text-[0.625rem] font-medium tracking-widest uppercase"
          >
            Head-of-line blocking is two problems
          </h3>

          <div className="mt-1.5 flex flex-col gap-2">
            {HEAD_OF_LINE_BLOCKING.map((analysis) => (
              <div
                key={analysis.id}
                className="border-border bg-surface rounded-lg border p-2.5"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h4 className="text-fg text-xs font-medium">{analysis.title}</h4>
                  <span className="text-fg-muted font-mono text-[0.5625rem]">
                    RFC {analysis.reference.rfc}
                  </span>
                </div>
                <p className="text-fg-secondary mt-1 text-[0.6875rem] leading-snug">
                  {analysis.what}
                </p>

                <ul className="mt-2 grid gap-1.5 lg:grid-cols-3">
                  {HTTP_VERSIONS.map((version) => {
                    const verdict = analysis.verdicts[version];
                    return (
                      <li
                        key={version}
                        className={cn(
                          'rounded border px-2 py-1.5',
                          verdict.blocked
                            ? 'border-state-warn/40 bg-state-warn/5'
                            : 'border-state-ok/40 bg-state-ok/5',
                        )}
                      >
                        <div className="flex items-baseline justify-between gap-1">
                          <span className="text-fg font-mono text-[0.6875rem]">
                            {VERSION_PROFILES[version].alias}
                          </span>
                          <Badge tone={verdict.blocked ? 'warn' : 'ok'}>
                            {verdict.blocked ? 'blocked' : 'clear'}
                          </Badge>
                        </div>
                        <p className="text-fg-muted mt-1 text-[0.5625rem] leading-snug">
                          {verdict.text}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <p className="text-fg-muted border-border/60 border-t pt-2 text-[0.625rem] leading-snug">
          The losses are drawn once per resource and met by all three runs, so this is one
          network scored three ways rather than three networks. That is why HTTP/2 can
          lose the transport row to HTTP/1.1 and still finish ahead: six connections limit
          the damage of a lost segment but cost six handshakes and re-send every header on
          every request. HTTP/3 is the only one that gets both, and only because QUIC does
          loss recovery per stream — which it can only do by not being TCP.
        </p>
      </div>
    </Panel>
  );
}
