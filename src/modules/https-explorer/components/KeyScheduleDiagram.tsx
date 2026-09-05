'use client';

import { useState } from 'react';

import { Badge, Panel } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';

import {
  knowledgeOf,
  observerLosesTrackAt,
  type KeySchedule,
  type KeyScheduleStep,
  type Party,
} from '../sim/keyschedule';

/**
 * Where the keys come from, and why watching every byte does not get you them.
 *
 * Three columns, one per party, and the third one is the argument. Reading down the
 * client and server columns, both fill up. Reading down the observer column — which
 * starts nearly as full as the others, because both Hello messages really are in the
 * clear — it stops. The step where it stops is marked, and it is the whole of public-key
 * cryptography stated as a diagram: two strangers who have never met agree on a secret in
 * front of somebody recording every word.
 *
 * Everything after that step is `HKDF`, and HKDF is not the interesting part. It is
 * drawn anyway, because "the key" is not one value — it is a tree of named secrets, each
 * bound to a transcript, each expanded into a separate write key and IV per direction,
 * and seeing that tree is what makes `KeyUpdate`, `EndOfEarlyData`, and 0-RTT's missing
 * forward secrecy legible later.
 *
 * ## No cryptography
 *
 * Every hex string on screen is a placeholder derived from a label, and
 * `schedule.notice` says so at the top of the panel rather than in a footnote. A fake
 * crypto implementation that looks real is worse than an honest diagram, so the values
 * are deliberately stamped `PLACEHOLDER` and the structure — which is the accurate part —
 * is what the layout emphasises.
 *
 * The toy Diffie–Hellman illustration is the one place with real arithmetic, and it is
 * real precisely because it is trivially breakable: a 5-bit group whose exponents you
 * could find by hand. It is there so the shape of the exchange is checkable, and it says
 * so.
 */

export interface KeyScheduleDiagramProps {
  schedule: KeySchedule;
  className?: string;
}

const PARTIES: readonly { key: Party; label: string; hint: string }[] = [
  { key: 'client', label: 'Client', hint: 'Holds its own private value.' },
  { key: 'server', label: 'Server', hint: 'Holds its own private value.' },
  {
    key: 'observer',
    label: 'Observer',
    hint: 'Saw every byte. Holds neither private value.',
  },
];

const PARTY_TONE: Readonly<Record<Party, string>> = {
  client: 'border-accent/40 bg-accent/8',
  server: 'border-state-ok/40 bg-state-ok/8',
  observer: 'border-state-warn/40 bg-state-warn/8',
};

/** One party's column for one step. */
function KnowledgeCell({
  step,
  party,
  blind,
}: {
  step: KeyScheduleStep;
  party: Party;
  blind: boolean;
}) {
  const items = knowledgeOf(step, party);

  return (
    <div
      className={cn(
        'min-w-0 rounded-lg border px-2 py-1.5',
        PARTY_TONE[party],
        blind && 'opacity-80',
      )}
    >
      {items.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => (
            <li
              key={item}
              className="text-fg-secondary text-[0.5625rem] leading-snug break-words"
            >
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-fg-muted text-[0.5625rem] leading-snug">
          Nothing new. The derivation needs a value this party does not have.
        </p>
      )}
    </div>
  );
}

function StepRow({
  step,
  index,
  blindFrom,
  expanded,
  onToggle,
}: {
  step: KeyScheduleStep;
  index: number;
  /** Index of the step at which the observer stops following, or -1. */
  blindFrom: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const blind = blindFrom >= 0 && index >= blindFrom;
  const isCutoff = blindFrom >= 0 && index === blindFrom;

  return (
    <li className="flex flex-col gap-1.5">
      {isCutoff ? (
        <p className="border-state-warn/50 text-state-warn mt-1 flex flex-wrap items-baseline gap-2 border-t border-dashed pt-1.5 text-[0.5625rem] tracking-widest uppercase">
          The observer stops here
          <span className="text-fg-muted tracking-normal normal-case">
            — it holds both public shares and neither private value, and there is no known
            way to get from one to the other.
          </span>
        </p>
      ) : null}

      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className={cn(
          'rounded-lg border px-2.5 py-1.5 text-left transition-colors',
          focusRing,
          expanded
            ? 'border-border-strong bg-surface-overlay'
            : 'border-border bg-surface hover:border-border-strong',
        )}
      >
        <span className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-fg text-xs font-medium">
            <span className="text-fg-muted mr-1.5 font-mono text-[0.625rem]">
              {index + 1}
            </span>
            {step.title}
          </span>
          <span className="text-fg-muted font-mono text-[0.5625rem]">
            RFC {step.reference.rfc} § {step.reference.section}
          </span>
        </span>
        <span className="text-fg-secondary mt-0.5 block text-[0.625rem] leading-snug">
          {step.explain}
        </span>
      </button>

      <div className="grid min-w-0 gap-1.5 sm:grid-cols-3">
        {PARTIES.map((party) => (
          <KnowledgeCell
            key={party.key}
            step={step}
            party={party.key}
            blind={party.key === 'observer' && blind}
          />
        ))}
      </div>

      {expanded && (step.output || step.keys) ? (
        <div className="border-border bg-surface rounded-lg border px-2.5 py-2">
          {step.output ? (
            <dl className="flex flex-col gap-1">
              <div>
                <dt className="text-fg-muted text-[0.5625rem] tracking-wide uppercase">
                  Produces
                </dt>
                <dd className="text-fg font-mono text-[0.625rem] break-all">
                  {step.output.name}
                </dd>
              </div>
              <div>
                <dt className="text-fg-muted text-[0.5625rem] tracking-wide uppercase">
                  Derivation
                </dt>
                <dd className="text-fg-secondary font-mono text-[0.5625rem] break-all">
                  {step.output.derivation}
                </dd>
              </div>
              <div>
                <dt className="text-fg-muted text-[0.5625rem] tracking-wide uppercase">
                  Transcript it is bound to
                </dt>
                <dd className="text-fg-secondary font-mono text-[0.5625rem] break-all">
                  {step.output.transcript || '(none — this label takes no transcript)'}
                </dd>
              </div>
              <div>
                <dt className="text-fg-muted text-[0.5625rem] tracking-wide uppercase">
                  Value ({step.output.bytes} bytes)
                </dt>
                <dd className="text-fg-muted font-mono text-[0.5625rem] break-all">
                  {step.output.value}
                </dd>
              </div>
              <p className="text-fg-muted mt-0.5 text-[0.5625rem] leading-snug">
                {step.output.purpose}
              </p>
            </dl>
          ) : null}

          {step.keys && step.keys.length > 0 ? (
            <ul className="border-border/60 mt-2 flex flex-col gap-1 border-t pt-2">
              {step.keys.map((keys) => (
                <li key={`${keys.from}-${keys.whoWrites}`} className="min-w-0">
                  <p className="text-fg-secondary text-[0.5625rem]">
                    <span className="text-fg-muted tracking-wide uppercase">
                      {keys.whoWrites} write keys
                    </span>{' '}
                    — from {keys.from}
                  </p>
                  <p className="text-fg-muted font-mono text-[0.5625rem] break-all">
                    key ({keys.keyBytes} B) {keys.key}
                  </p>
                  <p className="text-fg-muted font-mono text-[0.5625rem] break-all">
                    iv ({keys.ivBytes} B) {keys.iv}
                  </p>
                </li>
              ))}
              <li className="text-fg-muted text-[0.5625rem] leading-snug">
                The IV is not a nonce. It is XORed with the record sequence number to make
                one, which is why the sequence number never has to be transmitted.
              </li>
            </ul>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** The toy group, shown so the arithmetic is checkable by hand. */
function ToyExchange({ schedule }: { schedule: KeySchedule }) {
  const exchange = schedule.exchange;
  if (!exchange) return null;
  const toy = exchange.illustration;

  return (
    <details className="border-border bg-surface rounded-lg border px-2.5 py-2">
      <summary
        className={cn(
          'text-fg-secondary cursor-pointer text-[0.625rem] font-medium',
          focusRing,
        )}
      >
        The same exchange in numbers small enough to check by hand (p = {toy.group.p}, g ={' '}
        {toy.group.g})
      </summary>
      <ol className="mt-1.5 flex flex-col gap-0.5">
        {toy.lines.map((line) => (
          <li key={line} className="text-fg-secondary font-mono text-[0.5625rem]">
            {line}
          </li>
        ))}
      </ol>
      <p className="text-state-warn mt-1.5 text-[0.5625rem] leading-snug">{toy.caveat}</p>

      <div className="border-border/60 mt-2 border-t pt-2">
        <p className="text-fg-muted text-[0.5625rem] tracking-wide uppercase">
          What the observer holds after the real exchange
        </p>
        <ul className="mt-0.5 flex flex-col gap-0.5">
          {exchange.observerHolds.map((item) => (
            <li key={item} className="text-fg-secondary text-[0.5625rem] leading-snug">
              {item}
            </li>
          ))}
        </ul>
        <p className="text-fg-muted mt-1 text-[0.5625rem] leading-snug">
          {exchange.whyObserverFails}
        </p>
      </div>
    </details>
  );
}

export function KeyScheduleDiagram({ schedule, className }: KeyScheduleDiagramProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const cutoff = observerLosesTrackAt(schedule);
  const blindFrom = cutoff
    ? schedule.steps.findIndex((step) => step.id === cutoff.id)
    : -1;

  return (
    <Panel
      title="Key schedule — who knows what, and when"
      aside={
        <span className="flex flex-wrap items-center gap-1.5">
          {schedule.usedPsk ? <Badge tone="accent">resumed (PSK)</Badge> : null}
          {schedule.usedEarlyData ? <Badge tone="error">0-RTT</Badge> : null}
          <Badge tone="neutral">{schedule.suite.hash}</Badge>
        </span>
      }
      scroll
      className={cn('max-h-[46rem]', className)}
    >
      <div className="flex flex-col gap-3">
        <p className="border-state-warn/40 bg-state-warn/8 text-state-warn rounded-lg border px-2.5 py-2 text-[0.625rem] leading-snug">
          {schedule.notice}
        </p>

        <div aria-hidden="true" className="grid gap-1.5 sm:grid-cols-3">
          {PARTIES.map((party) => (
            <div
              key={party.key}
              className={cn('rounded-lg border px-2 py-1', PARTY_TONE[party.key])}
            >
              <p className="text-fg text-[0.625rem] font-medium tracking-widest uppercase">
                {party.label}
              </p>
              <p className="text-fg-muted text-[0.5625rem] leading-snug">{party.hint}</p>
            </div>
          ))}
        </div>

        <ol aria-label="Key derivation steps" className="flex flex-col gap-2">
          {schedule.steps.map((step, index) => (
            <StepRow
              key={step.id}
              step={step}
              index={index}
              blindFrom={blindFrom}
              expanded={expanded === step.id}
              onToggle={() => setExpanded(expanded === step.id ? null : step.id)}
            />
          ))}
        </ol>

        <ToyExchange schedule={schedule} />
      </div>
    </Panel>
  );
}
