'use client';

import { Search } from 'lucide-react';
import { useId, useState, type FormEvent, type ReactNode } from 'react';

import { SafetyBadge } from '@/components/shell';
import { Badge } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';

import {
  parseLookup,
  reversePtrName,
  TRANSPORT_LABELS,
  TRANSPORT_NOTES,
  type CacheState,
  type Lookup,
  type LookupCoverage,
  type LookupDraft,
} from '../lookup';
import {
  EXAMPLE_LOOKUPS,
  QUERYABLE_TYPES,
  RR_TYPE_NOTES,
  type RrType,
} from '../sim/records';
import type { DnsTransport } from '../sim/resolver';

/**
 * Ask about a name of your own.
 *
 * The six authored scenarios are the lesson; this is the part where a learner tests it
 * against something they picked, which is when it stops being a demo. Everything typed
 * here is resolved against the zone fixtures in `sim/records.ts`, in this tab, and the
 * field says so twice: the `Simulated` badge beside the label, and a sentence under it.
 *
 * ## The rule this field is built around
 *
 * **No input to this field can cause a network request.** Not a fallback, not a "if the
 * fixtures do not have it" path, not a DoH probe. The transport control below offers DoH
 * and DoT, and both of them are *annotations* -- they change what the ladder says the
 * query was carried over, and nothing else. A name the fixtures have never heard of is
 * answered NXDOMAIN by the simulated hierarchy, and {@link DomainInputProps.coverage}
 * prints why in as many words. Anything less than that teaches a fixture as a fact.
 *
 * ## Validated at submit, not per keystroke
 *
 * `example.c` is not a mistake, it is somebody halfway through typing `example.com`, and
 * a field that goes red while you type is a field that is wrong most of the time. So the
 * error appears on submit and clears on the next edit. `../lookup.ts` does the checking;
 * a URL or an email address pasted in is unwrapped rather than rejected, because both
 * contain exactly the name that was meant.
 */

export interface DomainInputProps {
  /** The form state. Owned by the parent so a scenario change can reset it. */
  draft: LookupDraft;
  onDraftChange: (draft: LookupDraft) => void;
  /** Fired only with a validated lookup -- an invalid one never reaches the parent. */
  onSubmit: (lookup: Lookup) => void;
  /**
   * What the bundled zones can say about the name currently on the diagram. Omit while
   * an authored scenario is running: it describes this field's own last answer.
   */
  coverage?: LookupCoverage;
  className?: string;
}

const CACHE_CHOICES: readonly { value: CacheState; label: string; hint: string }[] = [
  {
    value: 'cold',
    label: 'Cold',
    hint: 'The resolver knows only the root hints, so this costs the whole walk.',
  },
  {
    value: 'warm',
    label: 'Warm',
    hint: 'The same question is asked twice. The second one is where the point is.',
  },
];

const controlClasses = cn(
  'border-border bg-surface text-fg h-9 rounded-md border px-2 text-xs',
  'hover:border-border-strong transition-colors',
  focusRing,
);

/** The shared shell for one labelled knob, matching the module's other control panels. */
function Control({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-fg-muted text-[0.625rem] font-medium tracking-widest uppercase"
      >
        {label}
      </label>
      {children}
      {hint ? (
        <p className="text-fg-muted text-[0.6875rem] leading-snug">{hint}</p>
      ) : null}
    </div>
  );
}

export function DomainInput({
  draft,
  onDraftChange,
  onSubmit,
  coverage,
  className,
}: DomainInputProps) {
  const baseId = useId();
  const [error, setError] = useState<string | null>(null);

  const nameId = `${baseId}-name`;
  const errorId = `${baseId}-error`;
  const hintId = `${baseId}-hint`;
  const ptrId = `${baseId}-ptr`;

  // Typing an address into a box marked "domain name" is a reasonable mistake, and the
  // reversed form is the answer and the lesson at once.
  const ptr = reversePtrName(draft.name);

  const set = (patch: Partial<LookupDraft>) => {
    setError(null);
    onDraftChange({ ...draft, ...patch });
  };

  /** Validate, then hand the parent something it cannot get wrong. */
  const commit = (next: LookupDraft) => {
    const result = parseLookup(next);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    // The field shows the canonical name it actually resolved, not what was pasted.
    onDraftChange({ ...next, name: result.value.name });
    onSubmit(result.value);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    commit(draft);
  };

  return (
    <form
      onSubmit={submit}
      aria-labelledby={`${baseId}-title`}
      className={cn(
        'border-border bg-surface-raised flex flex-col gap-3 rounded-xl border px-4 py-3',
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id={`${baseId}-title`}
          className="text-fg-secondary text-xs font-medium tracking-widest uppercase"
        >
          Look up a name
        </h2>
        <SafetyBadge variant="simulated" />
      </div>

      <p id={hintId} className="text-fg-muted max-w-3xl text-[0.6875rem] leading-snug">
        Resolved against the zone fixtures bundled with this page, inside this browser
        tab. No name typed here is ever sent to a real nameserver, and there is no code
        path in this module that could send one.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-[14rem] flex-1 flex-col gap-1.5">
          <label
            htmlFor={nameId}
            className="text-fg-muted text-[0.625rem] font-medium tracking-widest uppercase"
          >
            Domain name
          </label>
          <input
            id={nameId}
            name="name"
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="www.example.com"
            value={draft.name}
            aria-invalid={error ? true : undefined}
            aria-describedby={[hintId, error ? errorId : null, ptr ? ptrId : null]
              .filter(Boolean)
              .join(' ')}
            onChange={(event) => set({ name: event.target.value })}
            className={cn(controlClasses, 'w-full font-mono text-sm')}
          />
        </div>

        <Control
          label="Record type"
          htmlFor={`${baseId}-type`}
          hint={RR_TYPE_NOTES[draft.type]}
        >
          <select
            id={`${baseId}-type`}
            value={draft.type}
            onChange={(event) => set({ type: event.target.value as RrType })}
            className={cn(controlClasses, 'w-28')}
          >
            {QUERYABLE_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </Control>

        <button
          type="submit"
          className={cn(
            'border-accent/60 bg-accent/15 text-fg inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors',
            'hover:bg-accent/25',
            focusRing,
          )}
        >
          <Search aria-hidden="true" className="size-3.5" />
          Resolve
        </button>
      </div>

      {error ? (
        <p id={errorId} role="alert" className="text-state-error text-xs">
          {error}
        </p>
      ) : null}

      {ptr ? (
        <p id={ptrId} className="text-fg-secondary text-xs leading-snug">
          That is an address, not a name. Reverse lookups are written backwards under{' '}
          <code className="font-mono">in-addr.arpa</code>, because names delegate right to
          left:{' '}
          <button
            type="button"
            onClick={() => commit({ ...draft, name: ptr, type: 'PTR' })}
            className={cn(
              'text-accent rounded font-mono underline underline-offset-2',
              focusRing,
            )}
          >
            {ptr} PTR
          </button>
        </p>
      ) : null}

      <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
        <Control
          label="Resolver cache"
          hint={CACHE_CHOICES.find((choice) => choice.value === draft.cache)?.hint}
        >
          <div role="group" aria-label="Resolver cache" className="flex gap-1.5">
            {CACHE_CHOICES.map((choice) => {
              const active = draft.cache === choice.value;

              return (
                <button
                  key={choice.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => set({ cache: choice.value })}
                  className={cn(
                    'h-9 flex-1 rounded-md border px-2 text-xs font-medium transition-colors',
                    focusRing,
                    active
                      ? 'border-accent/60 bg-accent/12 text-fg'
                      : 'border-border bg-surface text-fg-secondary hover:border-border-strong',
                  )}
                >
                  {choice.label}
                </button>
              );
            })}
          </div>
        </Control>

        <Control
          label="Transport"
          htmlFor={`${baseId}-transport`}
          hint={TRANSPORT_NOTES[draft.transport]}
        >
          <select
            id={`${baseId}-transport`}
            value={draft.transport}
            onChange={(event) => set({ transport: event.target.value as DnsTransport })}
            className={cn(controlClasses, 'w-full')}
          >
            {(Object.keys(TRANSPORT_LABELS) as DnsTransport[]).map((transport) => (
              <option key={transport} value={transport}>
                {TRANSPORT_LABELS[transport]}
              </option>
            ))}
          </select>
        </Control>

        <Control
          label="DNSSEC"
          hint={
            draft.dnssec
              ? 'The DO bit is set: signatures come back, and the chain is walked from the root down.'
              : 'Unsigned. The answer is believed because of where it came from, not because it can be proved.'
          }
        >
          <button
            type="button"
            role="switch"
            aria-checked={draft.dnssec}
            onClick={() => set({ dnssec: !draft.dnssec })}
            className={cn(
              'flex h-9 items-center gap-2 rounded-md border px-2 text-xs font-medium transition-colors',
              focusRing,
              draft.dnssec
                ? 'border-accent/60 bg-accent/12 text-fg'
                : 'border-border bg-surface text-fg-secondary hover:border-border-strong',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'relative h-4 w-7 shrink-0 rounded-full border transition-colors',
                draft.dnssec ? 'border-accent/60 bg-accent/30' : 'border-border',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 size-2.5 rounded-full transition-[left]',
                  draft.dnssec ? 'bg-accent left-3.5' : 'bg-border-strong left-0.5',
                )}
              />
            </span>
            {draft.dnssec ? 'Validating' : 'Not validating'}
          </button>
        </Control>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-fg-muted text-[0.625rem] font-medium tracking-widest uppercase">
          Names these zones can answer for
        </p>
        <ul className="flex flex-wrap gap-1.5">
          {EXAMPLE_LOOKUPS.map((example) => (
            <li key={`${example.name}:${example.type}`}>
              <button
                type="button"
                title={example.note}
                onClick={() =>
                  commit({ ...draft, name: example.name, type: example.type })
                }
                className={cn(
                  'border-border bg-surface text-fg-secondary hover:border-border-strong hover:text-fg inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[0.6875rem] transition-colors',
                  focusRing,
                )}
              >
                {example.name}
                <span className="text-fg-muted">{example.type}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {coverage ? (
        <p
          className={cn(
            'rounded-lg border px-3 py-2 text-xs leading-relaxed',
            coverage.known
              ? 'border-border bg-surface text-fg-secondary'
              : 'border-state-warn/40 bg-state-warn/10 text-fg-secondary',
          )}
        >
          <Badge tone={coverage.known ? 'neutral' : 'warn'} className="mr-2 align-middle">
            {coverage.known ? 'In the bundled zones' : 'Simulated zone only'}
          </Badge>
          {coverage.note}
        </p>
      ) : null}
    </form>
  );
}
