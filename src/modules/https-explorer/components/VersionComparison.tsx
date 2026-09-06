'use client';

import { Badge, Panel } from '@/components/ui';
import { cn } from '@/lib/cn';

import type {
  Tls12Handshake,
  VersionComparisonRow,
} from '@/core/protocols/tls/handshake12';
import type { HandshakeMessage, Tls13Handshake } from '@/core/protocols/tls/handshake13';

/**
 * TLS 1.2 and TLS 1.3, on one scale.
 *
 * The table alone would be a list of assertions. The timeline above it is the evidence:
 * the same connection, the same 40 ms round trip, drawn as two tracks against one clock —
 * so the extra round trip is a visible gap rather than a number in a cell, and the moment
 * encryption begins is a marker whose position you can compare with your eye.
 *
 * Two markers per track carry the whole comparison:
 *
 * - **the lock** — where encryption starts. One message into TLS 1.3; a full round trip
 *   and a `ChangeCipherSpec` into TLS 1.2, by which point the certificate has already
 *   gone past in the clear.
 * - **the arrow** — the first instant application data may be sent. That is the round
 *   trip TLS 1.3 removed, and it is the reason the two tracks end in different places.
 *
 * The table below includes the row where TLS 1.3 is *worse* (0-RTT is replayable). A
 * comparison that only listed wins would be marketing, and the one honest trade-off is
 * the row a learner most needs to have read.
 */

export interface VersionComparisonProps {
  tls12: Tls12Handshake;
  tls13: Tls13Handshake;
  rows: readonly VersionComparisonRow[];
  /** The version the current run negotiated, highlighted in the timeline. */
  current: 'TLS 1.2' | 'TLS 1.3';
  className?: string;
}

interface Track {
  readonly version: 'TLS 1.2' | 'TLS 1.3';
  readonly messages: readonly HandshakeMessage[];
  readonly encryptionStartsAt: string;
  readonly applicationDataAt: number;
  readonly completedAt: number;
  readonly roundTrips: number;
}

/** One version's handshake as a positioned track. */
function HandshakeTrack({
  track,
  scale,
  active,
}: {
  track: Track;
  scale: number;
  active: boolean;
}) {
  const encryptionAt = track.messages.find(
    (message) => message.id === track.encryptionStartsAt,
  )?.at;

  const percent = (value: number) => `${(value / scale) * 100}%`;

  return (
    <li
      className={cn(
        'rounded-lg border px-2.5 py-2 transition-colors',
        active ? 'border-accent/60 bg-accent/8' : 'border-border bg-surface',
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="flex items-baseline gap-2">
          <span className="text-fg font-mono text-xs font-medium">{track.version}</span>
          <Badge tone={track.roundTrips <= 1 ? 'ok' : 'warn'}>
            {track.roundTrips} RTT before application data
          </Badge>
          {active ? <Badge tone="accent">this run</Badge> : null}
        </span>
        <span className="text-fg-secondary font-mono text-[0.625rem] tabular-nums">
          {track.applicationDataAt} ms
        </span>
      </div>

      <div className="relative mt-2 h-9">
        {/* The two lanes: client above, server below, so direction is legible. */}
        <span aria-hidden="true" className="bg-border/60 absolute inset-x-0 top-2 h-px" />
        <span
          aria-hidden="true"
          className="bg-border/60 absolute inset-x-0 bottom-2 h-px"
        />

        {track.messages.map((message) => (
          <span
            key={message.id}
            title={`${message.name} — ${message.from}, t = ${message.at} ms, ${message.encryption === 'none' ? 'in the clear' : message.encryption + ' keys'}`}
            className={cn(
              'absolute h-2.5 w-1.5 rounded-[2px]',
              message.from === 'client' ? 'top-[3px]' : 'bottom-[3px]',
              message.encryption === 'none'
                ? 'bg-state-warn/70'
                : message.encryption === 'early-data'
                  ? 'bg-state-error/70'
                  : message.encryption === 'handshake'
                    ? 'bg-accent/80'
                    : 'bg-state-ok/80',
            )}
            style={{ left: percent(message.at) }}
          />
        ))}

        {encryptionAt !== undefined ? (
          <span
            title={`Encryption starts at t = ${encryptionAt} ms`}
            className="border-accent absolute inset-y-0 border-l border-dashed"
            style={{ left: percent(encryptionAt) }}
          >
            <span className="text-accent absolute -top-0.5 left-1 font-mono text-[0.5rem] whitespace-nowrap">
              encryption starts
            </span>
          </span>
        ) : null}

        <span
          title={`Application data may be sent at t = ${track.applicationDataAt} ms`}
          className="border-state-ok absolute inset-y-0 border-l"
          style={{ left: percent(track.applicationDataAt) }}
        >
          <span className="text-state-ok absolute -bottom-0.5 left-1 font-mono text-[0.5rem] whitespace-nowrap">
            request can go
          </span>
        </span>
      </div>
    </li>
  );
}

export function VersionComparison({
  tls12,
  tls13,
  rows,
  current,
  className,
}: VersionComparisonProps) {
  const tracks: readonly Track[] = [
    {
      version: 'TLS 1.3',
      messages: tls13.messages,
      encryptionStartsAt: tls13.encryptionStartsAt,
      applicationDataAt: tls13.applicationDataAt,
      completedAt: tls13.completedAt,
      roundTrips: tls13.roundTrips,
    },
    {
      version: 'TLS 1.2',
      messages: tls12.messages,
      encryptionStartsAt: tls12.encryptionStartsAt,
      applicationDataAt: tls12.applicationDataAt,
      completedAt: tls12.completedAt,
      roundTrips: tls12.roundTrips,
    },
  ];

  const scale =
    Math.max(
      ...tracks.map((track) => Math.max(track.completedAt, track.applicationDataAt)),
    ) || 1;
  const extra = tls12.applicationDataAt - tls13.applicationDataAt;

  return (
    <Panel
      title="TLS 1.2 vs TLS 1.3"
      aside={
        <span className="text-fg-muted text-[0.625rem]">
          same 40 ms round trip, one scale
        </span>
      }
      scroll
      className={cn('max-h-[42rem]', className)}
    >
      <div className="flex flex-col gap-3">
        <ul aria-label="Handshake timelines" className="flex flex-col gap-2">
          {tracks.map((track) => (
            <HandshakeTrack
              key={track.version}
              track={track}
              scale={scale}
              active={track.version === current}
            />
          ))}
        </ul>

        <p className="text-fg-secondary text-[0.6875rem] leading-snug">
          TLS 1.2 waits <span className="text-fg font-mono">{extra} ms</span> longer
          before the request can leave — one extra round trip, on every new connection, to
          every origin. It also starts encrypting a full round trip later, which is why
          its certificate is above the dashed line and TLS 1.3&rsquo;s is below it. Both
          come from the same change: TLS 1.3 makes the client guess the group and send its
          <span className="text-fg font-mono"> key_share</span> in the very first message,
          so the server can derive handshake keys the moment it has read the ClientHello.
        </p>

        <table className="w-full border-collapse text-left">
          <caption className="sr-only">
            TLS 1.2 compared with TLS 1.3, aspect by aspect
          </caption>
          <thead>
            <tr className="border-border border-b">
              <th className="text-fg-muted py-1 pr-2 text-[0.5625rem] font-medium tracking-widest uppercase">
                Aspect
              </th>
              <th className="text-fg-muted py-1 pr-2 text-[0.5625rem] font-medium tracking-widest uppercase">
                TLS 1.2
              </th>
              <th className="text-fg-muted py-1 text-[0.5625rem] font-medium tracking-widest uppercase">
                TLS 1.3
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.aspect}
                className={cn(
                  'border-border/60 border-b align-top',
                  !row.improved && 'bg-state-warn/8',
                )}
              >
                <th
                  scope="row"
                  className="text-fg py-1.5 pr-2 text-[0.625rem] font-medium"
                >
                  {row.aspect}
                  <span className="text-fg-muted mt-0.5 block font-mono text-[0.5rem] font-normal">
                    RFC {row.reference.rfc} § {row.reference.section}
                  </span>
                </th>
                <td className="text-fg-secondary py-1.5 pr-2 text-[0.625rem] leading-snug">
                  {row.tls12}
                </td>
                <td
                  className={cn(
                    'py-1.5 text-[0.625rem] leading-snug',
                    row.improved ? 'text-state-ok' : 'text-state-warn',
                  )}
                >
                  {row.tls13}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="text-fg-muted text-[0.5625rem] leading-snug">
          The shaded row is the one where TLS 1.3 is not simply better. 0-RTT early data
          buys a round trip by sending the request under a key derived from a ticket, and
          a key derived from a ticket cannot be fresh — so a recorded 0-RTT flight can be
          replayed. It is safe only for requests that are safe to run twice.
        </p>

        <p className="text-fg-muted border-border/60 border-t pt-2 text-[0.625rem] leading-snug">
          Most of what happened between the two versions is <em>removal</em>:
          renegotiation, compression, static RSA key exchange, custom Diffie–Hellman
          groups, CBC, and every hash weaker than SHA-256 are all gone. Static RSA is the
          one worth naming — the client encrypted the premaster secret to the
          server&rsquo;s long-term certificate key, so one leaked key decrypts every
          session ever recorded. That is what forward secrecy means, and TLS 1.3 made it
          non-optional by deleting the alternative.
        </p>
      </div>
    </Panel>
  );
}
