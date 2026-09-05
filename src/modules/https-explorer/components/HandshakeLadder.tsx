'use client';

import { Badge, Panel } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';

import type { ConnectionAbort } from '../sim/connection';
import type {
  Flight,
  HandshakeMessage,
  HandshakeNote,
  MessageEncryption,
  MessageField,
} from '../sim/handshake13';

import type { OverlayView } from './EncryptionOverlay';

/**
 * The message ladder, with the moment encryption begins drawn as a line across it.
 *
 * The RFC draws handshakes as a ladder for a reason, and the notation carries the whole
 * lesson: `ClientHello` is bare, `{Certificate}` is under handshake keys, and
 * `[Application Data]` is under application keys. This component keeps that notation
 * literally — the braces and brackets are rendered — and then adds the one thing a static
 * diagram cannot: a rule labelled "encryption starts here", positioned by the model
 * rather than by hand.
 *
 * That rule is the comparison. In TLS 1.3 it lands immediately after `ServerHello`, so
 * everything below it — including the certificate — is already protected. In TLS 1.2 it
 * lands after `ChangeCipherSpec`, a full round trip later, with the certificate above it
 * in the clear. Switching scenarios moves the line, and the point makes itself.
 *
 * ## The observer view
 *
 * When `view` is `observer` the ladder does not become a different diagram. It stays the
 * same ladder with the fields the observer cannot read replaced by their length — which
 * is exactly what an eavesdropper has: the record is still there, still that size, still
 * at that instant, and its contents are gone. A separate "here is what they see" diagram
 * would lose the correspondence that makes the point land.
 *
 * Field-level visibility comes from `MessageField.visibleToObserver`, not from the
 * message's encryption level, because the two are not the same: the record header of an
 * encrypted message is still on the wire, and so are its length and timing.
 *
 * ## Playhead
 *
 * `now` dims messages that have not been sent yet. Messages are not hidden, because the
 * shape of the whole handshake is worth seeing before it runs — and a ladder that grew a
 * row at a time would make the flights impossible to compare.
 */

export interface HandshakeLadderProps {
  /** The messages that actually happened. Shorter than the model's on an aborted run. */
  messages: readonly HandshakeMessage[];
  flights: readonly Flight[];
  /** Id of the first message that is not in the clear. */
  encryptionStartsAt: string;
  /** Which side of the encryption the reader is standing on. */
  view: OverlayView;
  /** The playhead, in virtual milliseconds. Messages after it are dimmed. */
  now: number;
  /** The expanded message, owned by the module so selecting one can also seek. */
  selectedId: string | null;
  onSelect: (message: HandshakeMessage | null) => void;
  /**
   * The cited observations this run produced, warnings first.
   *
   * These are also emitted as annotations onto the timeline, but a `warning` — 0-RTT
   * being replayable, a resumed session having no forward secrecy — is not something to
   * make a reader scrub the event log for. It is stated beside the ladder that caused it.
   */
  notes: readonly HandshakeNote[];
  /** Set when the client tore the connection down instead of finishing. */
  abort?: ConnectionAbort;
  className?: string;
}

/** How each protection level is labelled and coloured. */
const ENCRYPTION: Readonly<
  Record<MessageEncryption, { label: string; open: string; close: string; tone: string }>
> = {
  none: {
    label: 'cleartext',
    open: '',
    close: '',
    tone: 'border-state-warn/40 bg-state-warn/10 text-state-warn',
  },
  'early-data': {
    label: '0-RTT keys',
    open: '(',
    close: ')',
    tone: 'border-state-error/40 bg-state-error/10 text-state-error',
  },
  handshake: {
    label: 'handshake keys',
    open: '{',
    close: '}',
    tone: 'border-accent/40 bg-accent/12 text-accent',
  },
  application: {
    label: 'application keys',
    open: '[',
    close: ']',
    tone: 'border-state-ok/40 bg-state-ok/12 text-state-ok',
  },
};

/** One field row inside an expanded message. */
function Field({ field, view }: { field: MessageField; view: OverlayView }) {
  const hidden = view === 'observer' && !field.visibleToObserver;

  return (
    <div className="border-border/60 border-t px-2.5 py-1.5 first:border-t-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span
          className={cn(
            'font-mono text-[0.625rem]',
            hidden ? 'text-fg-muted' : 'text-fg',
          )}
        >
          {field.name}
        </span>
        {field.reference ? (
          <span className="text-fg-muted font-mono text-[0.5625rem]">
            RFC {field.reference.rfc} § {field.reference.section}
          </span>
        ) : null}
      </div>

      {hidden ? (
        <p className="text-fg-muted mt-0.5 flex items-center gap-1.5 font-mono text-[0.5625rem]">
          <span
            aria-hidden="true"
            className="bg-fg-muted/25 inline-block h-2 w-24 rounded-sm"
          />
          encrypted — not on the wire in the clear
        </p>
      ) : (
        <p className="text-fg-secondary mt-0.5 font-mono text-[0.625rem] break-all">
          {field.value}
        </p>
      )}

      <p className="text-fg-muted mt-1 text-[0.5625rem] leading-snug">{field.explain}</p>

      {view === 'observer' && field.visibleToObserver ? (
        <p className="text-state-warn mt-0.5 text-[0.5625rem] leading-snug">
          Readable by anyone on the path.
        </p>
      ) : null}
    </div>
  );
}

/** One rung: the name in RFC notation, sized and timed, expandable into its fields. */
function Rung({
  message,
  view,
  sent,
  expanded,
  onSelect,
}: {
  message: HandshakeMessage;
  view: OverlayView;
  sent: boolean;
  expanded: boolean;
  onSelect: (message: HandshakeMessage | null) => void;
}) {
  const style = ENCRYPTION[message.encryption];
  const fromClient = message.from === 'client';
  const readable =
    view === 'participant' || message.fields.some((field) => field.visibleToObserver);

  return (
    <div className={cn('flex flex-col', !sent && 'opacity-45')}>
      <div
        className={cn(
          'grid items-center gap-2',
          'grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1fr)]',
        )}
      >
        <div className={cn('min-w-0', fromClient ? 'justify-self-stretch' : 'hidden')}>
          {fromClient ? (
            <MessageButton
              message={message}
              expanded={expanded}
              readable={readable}
              onSelect={onSelect}
            />
          ) : null}
        </div>

        <span
          aria-hidden="true"
          className={cn(
            'text-center font-mono text-xs',
            fromClient ? 'text-accent' : 'text-fg-secondary',
          )}
        >
          {fromClient ? '→' : '←'}
        </span>

        <div className={cn('min-w-0', fromClient ? 'hidden' : 'justify-self-stretch')}>
          {fromClient ? null : (
            <MessageButton
              message={message}
              expanded={expanded}
              readable={readable}
              onSelect={onSelect}
            />
          )}
        </div>
      </div>

      {expanded ? (
        <div className="border-border bg-surface mt-1 overflow-hidden rounded-lg border">
          <p className="border-border/60 text-fg-secondary border-b px-2.5 py-1.5 text-[0.625rem] leading-snug">
            {message.summary}
          </p>
          <p className="border-border/60 text-fg-muted flex flex-wrap gap-x-3 gap-y-0.5 border-b px-2.5 py-1 font-mono text-[0.5625rem]">
            <span>t = {message.at} ms</span>
            <span>{message.bytes} bytes</span>
            <span className={style.tone.split(' ').pop()}>{style.label}</span>
            <span>
              RFC {message.reference.rfc} § {message.reference.section}
            </span>
          </p>
          {message.fields.length > 0 ? (
            message.fields.map((field) => (
              <Field key={field.name} field={field} view={view} />
            ))
          ) : (
            <p className="text-fg-muted px-2.5 py-1.5 text-[0.625rem]">
              No fields worth listing — this message is a marker rather than a payload.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function MessageButton({
  message,
  expanded,
  readable,
  onSelect,
}: {
  message: HandshakeMessage;
  expanded: boolean;
  readable: boolean;
  onSelect: (message: HandshakeMessage | null) => void;
}) {
  const style = ENCRYPTION[message.encryption];

  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={() => onSelect(expanded ? null : message)}
      title={message.summary}
      className={cn(
        'w-full rounded-lg border px-2.5 py-1.5 text-left transition-colors',
        focusRing,
        expanded ? 'border-border-strong bg-surface-overlay' : style.tone,
        !readable && 'opacity-70',
      )}
    >
      <span className="flex flex-wrap items-baseline justify-between gap-1.5">
        <span className="font-mono text-[0.6875rem] font-medium">
          {style.open}
          {message.name}
          {style.close}
        </span>
        <span className="text-fg-muted font-mono text-[0.5625rem] tabular-nums">
          {message.bytes} B
        </span>
      </span>
      {message.optional ? (
        <span className="text-fg-muted mt-0.5 block text-[0.5625rem]">optional</span>
      ) : null}
    </button>
  );
}

export function HandshakeLadder({
  messages,
  flights,
  encryptionStartsAt,
  view,
  now,
  selectedId,
  onSelect,
  notes,
  abort,
  className,
}: HandshakeLadderProps) {
  const flightOf = new Map(flights.map((flight) => [flight.number, flight]));
  const seenFlights = new Set<number>();

  // Warnings first. Everything here is true of the run, but the things that are
  // *dangerous* rather than merely interesting have to be read, not scrolled past.
  const ordered = [...notes].sort((a, b) =>
    a.level === b.level ? 0 : a.level === 'warning' ? -1 : 1,
  );

  return (
    <Panel
      title="Handshake ladder"
      aside={
        <span className="text-fg-muted text-[0.625rem]">
          {view === 'observer' ? 'as an observer sees it' : 'as a participant sees it'}
        </span>
      }
      className={className}
    >
      <div className="flex flex-col gap-2">
        <div
          aria-hidden="true"
          className="text-fg-muted grid grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1fr)] gap-2 text-[0.5625rem] tracking-widest uppercase"
        >
          <span>Client</span>
          <span />
          <span className="text-right">Server</span>
        </div>

        <ol className="flex flex-col gap-1.5">
          {messages.map((message) => {
            const flight = flightOf.get(message.flight);
            const isNewFlight = flight !== undefined && !seenFlights.has(flight.number);
            if (flight) seenFlights.add(flight.number);

            return (
              <li key={message.id} className="flex flex-col gap-1.5">
                {isNewFlight && flight ? (
                  <p className="text-fg-muted mt-1 flex items-baseline gap-2 text-[0.5625rem] leading-snug first:mt-0">
                    <span className="tracking-widest uppercase">
                      Flight {flight.number}
                    </span>
                    <span className="min-w-0 flex-1">{flight.summary}</span>
                  </p>
                ) : null}

                {message.id === encryptionStartsAt ? (
                  <p className="border-accent/50 text-accent my-1 flex items-center gap-2 border-t border-dashed pt-1.5 text-[0.5625rem] tracking-widest uppercase">
                    Encryption starts here
                    <span className="text-fg-muted tracking-normal normal-case">
                      — everything below this line is protected
                    </span>
                  </p>
                ) : null}

                <Rung
                  message={message}
                  view={view}
                  sent={message.at <= now}
                  expanded={selectedId === message.id}
                  onSelect={onSelect}
                />
              </li>
            );
          })}
        </ol>

        {abort ? (
          <div className="border-state-error/50 bg-state-error/10 mt-1 rounded-lg border px-2.5 py-2">
            <p className="text-state-error flex flex-wrap items-baseline justify-between gap-2 text-[0.6875rem] font-medium">
              <span>
                Connection aborted — Alert: {abort.alert.description} ({abort.alert.code})
              </span>
              <span className="font-mono text-[0.5625rem]">t = {abort.at} ms</span>
            </p>
            <p className="text-fg-secondary mt-1 text-[0.625rem] leading-snug">
              {abort.detail}
            </p>
            {abort.browserError ? (
              <p className="text-fg-muted mt-1 font-mono text-[0.5625rem]">
                {abort.browserError}
              </p>
            ) : null}
            <p className="text-fg-muted mt-1 text-[0.5625rem] leading-snug">
              {abort.alert.explain} No application data is ever exchanged — the ladder
              stops here.
            </p>
          </div>
        ) : null}

        {ordered.length > 0 ? (
          <section aria-labelledby="ladder-notes" className="mt-1">
            <h3
              id="ladder-notes"
              className="text-fg-muted text-[0.625rem] font-medium tracking-widest uppercase"
            >
              What is worth noticing about this handshake
            </h3>
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {ordered.map((note) => (
                <li
                  key={note.id}
                  className={cn(
                    'rounded-lg border px-2.5 py-2',
                    note.level === 'warning'
                      ? 'border-state-error/50 bg-state-error/10'
                      : 'border-border bg-surface',
                  )}
                >
                  <p className="flex flex-wrap items-baseline justify-between gap-2">
                    <span
                      className={cn(
                        'text-[0.6875rem] font-medium',
                        note.level === 'warning' ? 'text-state-error' : 'text-fg',
                      )}
                    >
                      {note.level === 'warning' ? '⚠ ' : ''}
                      {note.title}
                    </span>
                    <span className="text-fg-muted font-mono text-[0.5625rem]">
                      RFC {note.reference.rfc} § {note.reference.section}
                    </span>
                  </p>
                  <p className="text-fg-secondary mt-1 text-[0.625rem] leading-snug">
                    {note.body}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <ul
          aria-label="Notation"
          className="border-border/60 flex flex-wrap gap-1.5 border-t pt-2"
        >
          {(['none', 'early-data', 'handshake', 'application'] as const).map((level) => (
            <li key={level}>
              <Badge tone="neutral" className={cn('font-mono', ENCRYPTION[level].tone)}>
                {ENCRYPTION[level].open || '—'}
                {ENCRYPTION[level].close} {ENCRYPTION[level].label}
              </Badge>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}
