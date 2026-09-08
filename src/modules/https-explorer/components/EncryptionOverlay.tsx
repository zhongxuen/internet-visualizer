'use client';

import { Badge, Panel } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';

import { CLIENT_IP, CLIENT_PORT, HTTPS_PORT, type TlsRun } from '../sim/connection';
import {
  isProtected,
  type ObservedRecord,
  type ObserverFact,
} from '@/core/protocols/tls/records';

/**
 * The two views of one connection, and the honest answer to "what does HTTPS hide?"
 *
 * This is the module's strongest teaching device and also the one easiest to get wrong,
 * because the tempting version — plaintext on the left, a wall of hex on the right —
 * teaches that HTTPS hides everything. It does not. It hides the *contents of the
 * payload*, and it hides nothing at all about the fact that a connection is happening,
 * where it is going, when, how often, or how big it is.
 *
 * So the observer column is not decoration. It is derived: `run.observed` is the same
 * record list with the fields TLS actually conceals deleted, and `run.observerFacts` is
 * built from the record list plus the connection context. Neither is hand-authored
 * prose, so the overlay cannot drift away from the protocol model, and the honest half —
 * the destination address, the SNI hostname, the timings, the sizes — falls out of the
 * model rather than being written down twice.
 *
 * ## What the observer column always shows
 *
 * - **IP and TCP headers** — outside TLS entirely. Source and destination address, and
 *   port 443, which announces this is HTTPS before a single TLS byte is parsed.
 * - **Record type and length** — in the five-byte cleartext record header, always. Under
 *   TLS 1.3 the *type* is a lie by design (every protected record claims
 *   `application_data`), but the length is not and cannot be.
 * - **SNI** — the hostname, in the clear in the ClientHello, because the server needs it
 *   to pick a certificate before any key exists.
 * - **Timing** — when each record was sent and the gaps between them.
 * - **Sizes** — per record and in total.
 *
 * The last row of the fact list is the one thing that *is* hidden: the path, headers,
 * cookies and body. It is deliberately last, because it is the part people already
 * assume and the part they worry about least.
 */

/** Which side of the encryption the reader is standing on. */
export type OverlayView = 'participant' | 'observer';

export interface EncryptionOverlayProps {
  run: TlsRun;
  view: OverlayView;
  onViewChange: (view: OverlayView) => void;
  /** The playhead, in virtual milliseconds. Records after it are not shown as sent. */
  now: number;
  className?: string;
}

const VIEWS: readonly { value: OverlayView; label: string; hint: string }[] = [
  {
    value: 'participant',
    label: 'Participant',
    hint: 'What the client and the server have: the actual bytes.',
  },
  {
    value: 'observer',
    label: 'Observer',
    hint: 'What a machine on the path has: headers, lengths, timings.',
  },
];

/** One row of the observer's record list. */
function ObservedRow({
  observed,
  at,
  sent,
}: {
  observed: ObservedRecord;
  at: number;
  sent: boolean;
}) {
  return (
    <li
      className={cn(
        'border-border bg-surface rounded-lg border px-2.5 py-1.5',
        // `.state-dim`, not an alpha multiplier -- see globals.css.
        !sent && 'state-dim',
      )}
    >
      {sent ? null : <span className="sr-only">Not sent yet. </span>}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 font-mono text-[0.5625rem]">
        <span className={observed.from === 'client' ? 'text-accent' : 'text-state-ok'}>
          {observed.from === 'client' ? 'client → server' : 'server → client'}
        </span>
        <span className="text-fg">
          type {observed.type}
          {observed.typeIsHonest ? '' : ' (real type encrypted)'}
        </span>
        <span className="text-fg-secondary">version {observed.legacyVersion}</span>
        <span className="text-fg-secondary tabular-nums">
          length {observed.length} · {observed.totalBytes} B on the wire
        </span>
        <span className="text-fg-muted tabular-nums">t = {at} ms</span>
      </div>
      <p
        className={cn(
          'mt-0.5 truncate font-mono text-[0.5625rem]',
          observed.plaintext ? 'text-fg-secondary' : 'text-fg-muted',
        )}
      >
        {observed.payload}
      </p>
    </li>
  );
}

/** One row of the participant's record list — the same records, with their contents. */
function PlainRow({
  label,
  from,
  protectedRecord,
  bytes,
  at,
  sent,
  plaintext,
}: {
  label: string;
  from: 'client' | 'server';
  protectedRecord: boolean;
  bytes: number;
  at: number;
  sent: boolean;
  plaintext?: string;
}) {
  return (
    <li
      className={cn(
        'border-border bg-surface rounded-lg border px-2.5 py-1.5',
        // `.state-dim`, not an alpha multiplier -- see globals.css.
        !sent && 'state-dim',
      )}
    >
      {sent ? null : <span className="sr-only">Not sent yet. </span>}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 font-mono text-[0.5625rem]">
        <span className={from === 'client' ? 'text-accent' : 'text-state-ok'}>
          {from === 'client' ? 'client → server' : 'server → client'}
        </span>
        <span className="text-fg">{label}</span>
        <span className="text-fg-secondary tabular-nums">{bytes} B</span>
        <span className="text-fg-muted tabular-nums">t = {at} ms</span>
        {protectedRecord ? (
          <span className="text-state-ok">encrypted on the wire</span>
        ) : (
          <span className="text-state-warn">in the clear</span>
        )}
      </div>
      {plaintext ? (
        <pre className="text-fg-secondary mt-1 overflow-x-auto font-mono text-[0.5625rem] leading-relaxed whitespace-pre-wrap">
          {plaintext}
        </pre>
      ) : null}
    </li>
  );
}

function FactRow({ fact }: { fact: ObserverFact }) {
  return (
    <li
      className={cn(
        'rounded-lg border px-2.5 py-1.5',
        fact.visible
          ? 'border-state-warn/40 bg-state-warn/8'
          : 'border-state-ok/40 bg-state-ok/8',
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-fg text-[0.6875rem] font-medium">{fact.label}</span>
        <Badge tone={fact.visible ? 'warn' : 'ok'}>
          {fact.visible ? 'visible' : 'hidden'}
        </Badge>
      </div>
      {fact.value ? (
        <p className="text-fg-secondary mt-0.5 font-mono text-[0.5625rem] break-all">
          {fact.value}
        </p>
      ) : null}
      <p className="text-fg-muted mt-1 text-[0.5625rem] leading-snug">{fact.detail}</p>
    </li>
  );
}

export function EncryptionOverlay({
  run,
  view,
  onViewChange,
  now,
  className,
}: EncryptionOverlayProps) {
  const observer = view === 'observer';
  const visible = run.observerFacts.filter((fact) => fact.visible);
  const hidden = run.observerFacts.filter((fact) => !fact.visible);

  const first = run.wire[0];
  const last = run.wire.at(-1);
  const span = first && last ? last.arrivesAt - first.at : 0;

  return (
    <Panel
      title="What is on the wire"
      aside={
        <div role="group" aria-label="View" className="flex gap-1">
          {VIEWS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={view === option.value}
              title={option.hint}
              onClick={() => onViewChange(option.value)}
              className={cn(
                'rounded-md border px-2 py-0.5 text-[0.625rem] font-medium transition-colors',
                focusRing,
                view === option.value
                  ? 'border-accent/60 bg-accent/12 text-fg'
                  : 'border-border bg-surface text-fg-secondary hover:border-border-strong hover:text-fg',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      }
      scroll
      className={cn('max-h-[46rem]', className)}
    >
      <div className="flex flex-col gap-3">
        <p className="text-fg-secondary text-[0.6875rem] leading-snug">
          {observer
            ? 'You are the machine in the middle — an ISP router, a café access point, a national tap. Every byte in both directions passes through you, and you are addressed by neither end. This is all of it.'
            : 'You are one of the two endpoints. You hold the traffic keys, so you have the records and their contents. Switch to the observer view to see the same connection from the path.'}
        </p>

        <section aria-labelledby="overlay-outside">
          <h3
            id="overlay-outside"
            className="text-fg-muted text-[0.625rem] font-medium tracking-widest uppercase"
          >
            Outside TLS entirely — the IP and TCP headers
          </h3>
          <dl className="border-state-warn/40 bg-state-warn/8 mt-1.5 grid gap-x-3 gap-y-1 rounded-lg border px-2.5 py-2 sm:grid-cols-2">
            <div>
              <dt className="text-fg-muted text-[0.5625rem] tracking-wide uppercase">
                IPv4 source → destination
              </dt>
              <dd className="text-fg-secondary font-mono text-[0.5625rem]">
                {CLIENT_IP} → {run.scenario.serverIp}
              </dd>
            </div>
            <div>
              <dt className="text-fg-muted text-[0.5625rem] tracking-wide uppercase">
                TCP source → destination port
              </dt>
              <dd className="text-fg-secondary font-mono text-[0.5625rem]">
                {CLIENT_PORT} → {HTTPS_PORT} (HTTPS)
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-fg-muted text-[0.5625rem] tracking-wide uppercase">
                Traffic shape
              </dt>
              <dd className="text-fg-secondary font-mono text-[0.5625rem]">
                {run.wire.length} records · {run.wireBytes} bytes · {span} ms from first
                byte to last
              </dd>
            </div>
          </dl>
          <p className="text-fg-muted mt-1 text-[0.5625rem] leading-snug">
            TLS protects the payload of a connection. It cannot hide the connection.
            Everything in this box is readable by every machine on the path, in both
            views, whatever version was negotiated.
          </p>
        </section>

        <section aria-labelledby="overlay-records">
          <h3
            id="overlay-records"
            className="text-fg-muted text-[0.625rem] font-medium tracking-widest uppercase"
          >
            {observer
              ? 'Every record, as the observer reads it'
              : 'Every record, as an endpoint holds it'}
          </h3>
          <ol aria-label="Records on the wire" className="mt-1.5 flex flex-col gap-1">
            {run.wire.map((entry, index) => {
              const record = entry.record;
              const sent = entry.at <= now;

              if (observer) {
                const observed = run.observed[index];
                return observed ? (
                  <ObservedRow
                    key={record.id}
                    observed={observed}
                    at={entry.at}
                    sent={sent}
                  />
                ) : null;
              }

              return (
                <PlainRow
                  key={record.id}
                  label={record.label}
                  from={record.from}
                  protectedRecord={isProtected(record.protection)}
                  bytes={record.totalBytes}
                  at={entry.at}
                  sent={sent}
                  {...(record.plaintext ? { plaintext: record.plaintext } : {})}
                />
              );
            })}
          </ol>
          {observer ? (
            <p className="text-fg-muted mt-1 text-[0.5625rem] leading-snug">
              The payloads above are placeholder bytes — there is no cryptography in this
              module. What is accurate is the framing: the five-byte header, the type, the
              length, and the instant each record went out. Those are what an observer
              really has.
            </p>
          ) : null}
        </section>

        <section aria-labelledby="overlay-facts">
          <h3
            id="overlay-facts"
            className="text-fg-muted text-[0.625rem] font-medium tracking-widest uppercase"
          >
            What HTTPS does not hide ({visible.length} of {run.observerFacts.length})
          </h3>
          <ul
            aria-label="Still visible to an observer"
            className="mt-1.5 flex flex-col gap-1.5"
          >
            {visible.map((fact) => (
              <FactRow key={fact.label} fact={fact} />
            ))}
          </ul>

          <h3 className="text-fg-muted mt-3 text-[0.625rem] font-medium tracking-widest uppercase">
            What it does hide
          </h3>
          <ul
            aria-label="Concealed by encryption"
            className="mt-1.5 flex flex-col gap-1.5"
          >
            {hidden.map((fact) => (
              <FactRow key={fact.label} fact={fact} />
            ))}
          </ul>
        </section>

        <p className="border-border/60 text-fg-muted border-t pt-2 text-[0.625rem] leading-snug">
          A padlock is a claim that the payload is confidential and authentic between you
          and the name on the certificate. It is not a claim of anonymity: the address,
          the hostname, the timing and the sizes all survive it, and website
          fingerprinting works on exactly those.
        </p>
      </div>
    </Panel>
  );
}
