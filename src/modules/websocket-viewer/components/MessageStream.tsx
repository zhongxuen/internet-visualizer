'use client';

import { Badge, EmptyState, Panel } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { formatTimecode } from '@/components/viz';
import { cn } from '@/lib/cn';

import type { FrameRecord } from '../sim/exchange';

/**
 * Both directions, on one timeline.
 *
 * The layout is the argument. Two columns, client and server, with every frame drawn as an
 * arrow crossing between them in the direction it travelled — because the thing that makes a
 * WebSocket different from everything before it is that the arrows point both ways and
 * neither direction is a reply to the other. A request/response ledger, which is the right
 * shape for the HTTP modules, would quietly teach the opposite.
 *
 * ## Why it is ordered by time and not paired
 *
 * There is no pairing to draw. After the handshake the two directions are independent
 * streams: the server may send four frames while the client sends none, a pong may arrive
 * between two fragments of a message, and nothing in the protocol correlates any frame with
 * any other. Ordering by the moment each frame left its sender is the only ordering the
 * protocol actually has.
 *
 * ## What the dimming means
 *
 * A frame past the playhead is dimmed rather than hidden, so the shape of the whole
 * conversation is visible while it plays — and so scrubbing backwards is exact, because
 * nothing here is animated state. Everything is derived from one number.
 *
 * ## The three badges
 *
 * `masked` is on every client frame and no server frame, and putting it on every row is
 * deliberate: the asymmetry should be visible as a *column*, not discovered one frame at a
 * time. `obligated` marks the pongs and the echoing Close, which the state machine produced
 * rather than the application. `lost` marks a frame that left and never arrived — which from
 * the sender's side is indistinguishable from one that did, and is the entire reason a
 * keepalive exists.
 */

export interface MessageStreamProps {
  frames: readonly FrameRecord[];
  /** The playhead, in virtual milliseconds. */
  now: number;
  durationMs: number;
  selectedId?: string | null;
  onSelect?: (record: FrameRecord) => void;
  className?: string;
}

function opcodeTone(record: FrameRecord): 'accent' | 'ok' | 'warn' | 'error' | 'neutral' {
  if (!record.delivered) return 'error';
  switch (record.frame.opcode) {
    case 'close':
      return 'warn';
    case 'ping':
    case 'pong':
      return 'accent';
    case 'continuation':
      return 'neutral';
    default:
      return 'ok';
  }
}

/** The arrow between the two columns, drawn in the direction of travel. */
function Arrow({ record, reached }: { record: FrameRecord; reached: boolean }) {
  const rightward = record.from === 'client';

  return (
    <div aria-hidden="true" className="flex min-w-0 items-center gap-1">
      <span
        className={cn(
          'h-px flex-1',
          reached ? 'bg-border-strong' : 'bg-border',
          !record.delivered && 'bg-state-error/60',
        )}
        style={
          record.delivered
            ? undefined
            : { backgroundImage: 'none', borderTop: '1px dashed currentColor' }
        }
      />
      <span
        className={cn(
          'shrink-0 font-mono text-[0.625rem]',
          record.delivered ? 'text-fg-muted' : 'text-state-error',
        )}
      >
        {record.delivered ? (rightward ? '▶' : '◀') : '✕'}
      </span>
      <span className={cn('h-px flex-1', reached ? 'bg-border-strong' : 'bg-border')} />
    </div>
  );
}

export function MessageStream({
  frames,
  now,
  durationMs,
  selectedId,
  onSelect,
  className,
}: MessageStreamProps) {
  if (frames.length === 0) {
    return (
      <Panel title="Message stream" className={cn('min-w-0', className)}>
        <EmptyState
          title="No frames in this run"
          description="This scenario races four transports rather than opening one connection — the comparison below is where it happens."
        />
      </Panel>
    );
  }

  const clientFrames = frames.filter((record) => record.from === 'client').length;
  const bytes = frames.reduce((sum, record) => sum + record.wireBytes, 0);

  return (
    <Panel
      title="Message stream"
      aside={
        <>
          <Badge tone="neutral">
            {clientFrames} ↑ / {frames.length - clientFrames} ↓
          </Badge>
          <Badge tone="neutral">{bytes} B</Badge>
        </>
      }
      scroll
      className={cn('min-w-0', className)}
    >
      <div className="flex min-w-0 flex-col gap-2">
        <div
          aria-hidden="true"
          className="text-fg-muted grid grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)] gap-2 text-[0.625rem] tracking-wider uppercase"
        >
          <span>Time</span>
          <span>Client</span>
          <span className="text-center">Wire</span>
          <span className="text-right">Server</span>
        </div>

        <ol className="flex min-w-0 flex-col gap-1">
          {frames.map((record) => {
            const reached = now >= record.receivedAt;
            const active = record.id === selectedId;
            const fromClient = record.from === 'client';

            return (
              <li key={record.id}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSelect?.(record)}
                  className={cn(
                    'grid w-full grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)] items-center gap-2 rounded-lg border px-2 py-2 text-left transition-colors',
                    focusRing,
                    active
                      ? 'border-accent/60 bg-accent/10'
                      : 'border-border bg-surface hover:border-border-strong',
                    !reached && 'opacity-55',
                  )}
                >
                  <span className="text-fg-muted font-mono text-[0.625rem] tabular-nums">
                    {formatTimecode(record.sentAt, durationMs)}
                  </span>

                  <span className="min-w-0">
                    {fromClient ? (
                      <span className="flex min-w-0 flex-col items-start gap-0.5">
                        <span className="text-fg truncate text-[0.6875rem] font-medium">
                          {record.title}
                        </span>
                        <Badge tone="accent">masked</Badge>
                      </span>
                    ) : null}
                  </span>

                  <span className="flex min-w-0 flex-col gap-1">
                    <Arrow record={record} reached={reached} />
                    <span className="flex flex-wrap items-center justify-center gap-1">
                      <Badge tone={opcodeTone(record)}>{record.frame.opcode}</Badge>
                      <span className="text-fg-muted font-mono text-[0.625rem] tabular-nums">
                        {record.wireBytes} B
                      </span>
                      {record.frame.fin ? null : <Badge tone="neutral">FIN 0</Badge>}
                      {record.automatic ? <Badge tone="neutral">obligated</Badge> : null}
                      {record.delivered ? null : <Badge tone="error">lost</Badge>}
                    </span>
                  </span>

                  <span className="min-w-0">
                    {fromClient ? null : (
                      <span className="flex min-w-0 flex-col items-end gap-0.5">
                        <span className="text-fg truncate text-[0.6875rem] font-medium">
                          {record.title}
                        </span>
                        <Badge tone="neutral">unmasked</Badge>
                      </span>
                    )}
                  </span>

                  {active ? (
                    <span className="col-span-4 flex flex-col gap-1 pt-1">
                      <span className="text-fg-secondary text-[0.6875rem] leading-relaxed">
                        {record.why}
                      </span>
                      {record.message ? (
                        <span className="text-fg-muted text-[0.6875rem] leading-relaxed">
                          Delivered to the application as one {record.message.opcode} message
                          of {record.message.bytes} bytes
                          {record.message.frameCount > 1
                            ? `, reassembled from ${record.message.frameCount} frames`
                            : ''}
                          {record.message.text === undefined
                            ? '.'
                            : `: “${record.message.text}”`}
                        </span>
                      ) : null}
                      {record.close ? (
                        <span className="text-state-warn text-[0.6875rem] leading-relaxed">
                          Close code {record.close.code ?? '(none — reported locally as 1005)'}
                          {record.close.reason === '' ? '' : ` — ${record.close.reason}`}
                        </span>
                      ) : null}
                      {record.notes.map((note) => (
                        <span
                          key={note}
                          className="text-fg-muted text-[0.6875rem] leading-relaxed"
                        >
                          {note}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ol>

        <p className="text-fg-muted text-[0.625rem] leading-relaxed">
          Both directions, ordered by the moment each frame left its sender — which is the only
          ordering the protocol has. After the handshake there is no request/response pairing
          at all: two independent streams sharing one TCP connection, and nothing correlates a
          frame in one with a frame in the other.
        </p>
      </div>
    </Panel>
  );
}
