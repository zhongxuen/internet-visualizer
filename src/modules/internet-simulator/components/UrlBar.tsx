'use client';

import { useId, useMemo, useState, type FormEvent } from 'react';
import { CornerDownLeft, Globe, Lock, ShieldAlert, Unlock } from 'lucide-react';

import { SafetyBadge } from '@/components/shell';
import { Badge } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';

import { coverageFor, parseAddress, SUGGESTED_URLS } from '../input';
import type { ParsedUrl } from '../sim/stages/url-parse';

/**
 * The address bar, which is where the whole module starts.
 *
 * It looks like a browser's because that is the point: the thing being explained is what
 * happens between pressing enter and seeing a page, and the fastest way to say so is to put
 * the learner in front of the control they already press. The badge beside it is the one
 * place that difference is stated, and it never moves and never softens -- everything below
 * is a simulation, and a bar that looked exactly like Chrome's without saying so would be
 * the single most misleading component in this product.
 *
 * ## Validation happens twice, on purpose
 *
 * As you type, {@link parseAddress} runs and its verdict is shown, but the run is not
 * touched: retyping a host one character at a time would otherwise re-run eight stages per
 * keystroke and flicker the whole page. Submitting is what commits. So the field is a
 * draft, the run is committed state, and the two are allowed to disagree while typing --
 * which is exactly how a real address bar behaves.
 *
 * ## Coverage, before the run rather than after
 *
 * Most host names are not in the bundled zones, and a run against one ends honestly in
 * `DNS_PROBE_FINISHED_NXDOMAIN`. That is a true statement about this simulated Internet and
 * a false one about the real site, so the warning is shown *while typing* -- a learner who
 * types a site they know is up should read "this simulator has never heard of it" before
 * they press enter, not an error page afterwards.
 */

export interface UrlBarProps {
  /** The committed URL: what the run below was made from. */
  value: string;
  /** Fired when a valid URL is submitted. The parse is handed over, already done. */
  onSubmit: (url: string, parsed: ParsedUrl) => void;
  /** Disable the field while a run is being recomputed. */
  busy?: boolean;
  className?: string;
}

/** Scheme glyph: the padlock every user already reads, and its absence. */
function SchemeMark({ secure, valid }: { secure: boolean; valid: boolean }) {
  if (!valid) {
    return <ShieldAlert aria-hidden="true" className="text-state-warn size-4 shrink-0" />;
  }
  if (secure) {
    return <Lock aria-hidden="true" className="text-state-ok size-4 shrink-0" />;
  }
  return <Unlock aria-hidden="true" className="text-state-warn size-4 shrink-0" />;
}

export function UrlBar({ value, onSubmit, busy = false, className }: UrlBarProps) {
  const [draft, setDraft] = useState(value);
  const inputId = useId();
  const messageId = useId();

  // The draft follows the committed value when a scenario switch changes it underneath,
  // compared during render rather than synchronised by an effect -- an effect would show
  // one frame of the previous scenario's URL in the field.
  const [lastCommitted, setLastCommitted] = useState(value);
  if (value !== lastCommitted) {
    setLastCommitted(value);
    setDraft(value);
  }

  const parsed = useMemo(() => parseAddress(draft), [draft]);
  const coverage = useMemo(
    () => (parsed.ok ? coverageFor(parsed.value.host) : undefined),
    [parsed],
  );
  const dirty = draft.trim() !== value.trim();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!parsed.ok) return;
    onSubmit(parsed.value.href, parsed.value);
  }

  return (
    <form
      onSubmit={submit}
      className={cn('flex min-w-0 flex-col gap-2', className)}
      aria-label="Load a page"
    >
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor={inputId}
          className="text-fg-muted text-xs font-medium tracking-widest uppercase"
        >
          Address bar
        </label>
        <SafetyBadge variant="simulated" />
        {parsed.ok && !parsed.value.hostIsAddress && coverage && !coverage.known ? (
          <Badge tone="warn">Unknown to the bundled zones</Badge>
        ) : null}
      </div>

      <div
        className={cn(
          'border-border bg-surface-raised flex min-w-0 items-center gap-2 rounded-full border px-3 py-2',
          'focus-within:border-accent/60 transition-colors',
          !parsed.ok && draft.trim() !== '' && 'border-state-error/60',
        )}
      >
        <SchemeMark
          secure={parsed.ok && parsed.value.scheme === 'https'}
          valid={parsed.ok}
        />

        <input
          id={inputId}
          name="url"
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-invalid={!parsed.ok}
          aria-describedby={messageId}
          placeholder="https://www.example.com/"
          className={cn(
            'text-fg placeholder:text-fg-muted min-w-0 flex-1 bg-transparent font-mono text-sm outline-none',
            focusRing,
          )}
        />

        <button
          type="submit"
          disabled={!parsed.ok || busy}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
            focusRing,
            dirty && parsed.ok
              ? 'bg-accent text-accent-ink hover:bg-accent-strong'
              : 'border-border text-fg-secondary hover:bg-surface-overlay border',
            'disabled:pointer-events-none disabled:opacity-50',
          )}
        >
          <CornerDownLeft aria-hidden="true" className="size-3.5" />
          {dirty ? 'Load' : 'Reload'}
        </button>
      </div>

      {/*
        One live region for both messages. A rejection replaces the coverage note rather
        than stacking beneath it: while the URL is unparseable there is no host to have an
        opinion about, and two red-ish paragraphs would compete.
      */}
      <p
        id={messageId}
        role="status"
        aria-live="polite"
        className={cn(
          'min-h-[1.5rem] text-xs leading-relaxed',
          parsed.ok ? 'text-fg-muted' : 'text-state-error',
        )}
      >
        {parsed.ok
          ? (coverage?.note ??
            'Everything below runs in this tab. No packets leave this machine.')
          : parsed.error}
      </p>

      <ul aria-label="Example addresses" className="flex flex-wrap gap-1.5">
        {SUGGESTED_URLS.map((suggestion) => {
          const active = suggestion.url === value;
          return (
            <li key={suggestion.url}>
              <button
                type="button"
                aria-pressed={active}
                title={suggestion.note}
                disabled={busy}
                onClick={() => {
                  const next = parseAddress(suggestion.url);
                  setDraft(suggestion.url);
                  if (next.ok) onSubmit(next.value.href, next.value);
                }}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[0.6875rem] transition-colors',
                  focusRing,
                  active
                    ? 'border-accent/60 bg-accent/12 text-fg'
                    : 'border-border bg-surface-raised text-fg-secondary hover:border-border-strong hover:bg-surface-overlay hover:text-fg',
                )}
              >
                <Globe aria-hidden="true" className="size-3 opacity-60" />
                {suggestion.url.replace(/^https?:\/\//, '')}
              </button>
            </li>
          );
        })}
      </ul>
    </form>
  );
}
