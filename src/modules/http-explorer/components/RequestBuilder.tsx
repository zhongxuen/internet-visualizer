'use client';

import { Send } from 'lucide-react';
import { useId, useState, type FormEvent, type ReactNode } from 'react';

import { SafetyBadge } from '@/components/shell';
import { Badge, Button } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';

import {
  coverageFor,
  parseRequestDraft,
  SANDBOX_HOST,
  SANDBOX_PAGE_ORIGIN,
  SANDBOX_ROUTES,
  type BuiltRequest,
  type RequestDraft,
} from '../builder';
import {
  HTTP_METHODS,
  HTTP_VERSIONS,
  type HttpMethod,
  type HttpVersion,
} from '../sim/message';
import { methodSemantics } from '../sim/semantics';

/**
 * Describe a request, and watch it happen.
 *
 * The seven authored scenarios are the lesson; this is the part where a learner tries
 * something they picked, which is when it stops being a demonstration. Everything typed
 * here is answered by the route table in `builder.ts`, in this tab, and the panel says so
 * twice: the `Simulated` badge beside the title, and a sentence under it.
 *
 * ## The rule this panel is built around
 *
 * **No input to this form can cause a network request.** Not a fallback, not an "if the
 * fixture does not have it" path, not a proxy. There is no host field at all -- the one
 * origin it can address is `sandbox.example`, which lives in the TLD RFC 2606 reserves so
 * that it can never be registered by anybody, at an RFC 5737 documentation address. A
 * path the fixtures do not serve comes back 404 from the simulated server, and the
 * coverage line under the field says in as many words that this is a fact about a table
 * in the repository rather than about anything on the Internet.
 *
 * ## Validated on submit, not per keystroke
 *
 * `/index.htm` is not a mistake, it is somebody halfway through typing `/index.html`, and
 * a field that goes red while you type is a field that is wrong most of the time. So the
 * error appears on Send and clears on the next edit. `../builder.ts` does the checking,
 * and the messages it returns name the rule rather than the symptom -- a field value with
 * a bare CR is refused as header injection, because that is what it is.
 */

export interface RequestBuilderProps {
  /** The form state. Owned by the parent so picking a scenario can leave it alone. */
  draft: RequestDraft;
  onDraftChange: (draft: RequestDraft) => void;
  /** Fired only with a validated request -- an invalid one never reaches the parent. */
  onSubmit: (request: BuiltRequest) => void;
  className?: string;
}

const controlClasses = cn(
  'border-border bg-surface text-fg h-9 rounded-md border px-2 text-xs',
  'hover:border-border-strong transition-colors',
  focusRing,
);

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

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-1.5">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className={cn(
          'accent-accent mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer',
          focusRing,
        )}
      />
      <label htmlFor={id} className="cursor-pointer">
        <span className="text-fg-secondary block text-xs">{label}</span>
        <span className="text-fg-muted block text-[0.625rem] leading-snug">{hint}</span>
      </label>
    </div>
  );
}

export function RequestBuilder({
  draft,
  onDraftChange,
  onSubmit,
  className,
}: RequestBuilderProps) {
  const baseId = useId();
  const [error, setError] = useState<string | null>(null);

  const titleId = `${baseId}-title`;
  const hintId = `${baseId}-hint`;
  const errorId = `${baseId}-error`;
  const coverageId = `${baseId}-coverage`;

  const semantics = methodSemantics(draft.method);
  const coverage = coverageFor({ target: draft.target, method: draft.method });

  const set = (patch: Partial<RequestDraft>) => {
    setError(null);
    onDraftChange({ ...draft, ...patch });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = parseRequestDraft(draft);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    onDraftChange({ ...draft, target: result.value.target });
    onSubmit(result.value);
  };

  return (
    <form
      onSubmit={submit}
      aria-labelledby={titleId}
      className={cn(
        'border-border bg-surface-raised flex flex-col gap-3 rounded-xl border px-4 py-3',
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id={titleId}
          className="text-fg-secondary text-xs font-medium tracking-widest uppercase"
        >
          Build a request
        </h2>
        <SafetyBadge variant="simulated" />
      </div>

      <p id={hintId} className="text-fg-muted max-w-3xl text-[0.6875rem] leading-snug">
        Answered by the fixture routes bundled with this page, inside this browser tab.
        There is no host field because there is only one host: <code>{SANDBOX_HOST}</code>
        , a name in the TLD reserved so it can never be registered. Nothing typed here is
        ever sent to a real server, and there is no code path in this module that could
        send it.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <Control
          label="Method"
          htmlFor={`${baseId}-method`}
          hint={`${semantics.safe ? 'Safe' : 'Not safe'} · ${semantics.idempotent ? 'idempotent' : 'not idempotent'}`}
        >
          <select
            id={`${baseId}-method`}
            value={draft.method}
            onChange={(event) => set({ method: event.target.value as HttpMethod })}
            className={cn(controlClasses, 'w-28 font-mono')}
          >
            {HTTP_METHODS.map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </select>
        </Control>

        <div className="flex min-w-[14rem] flex-1 flex-col gap-1.5">
          <label
            htmlFor={`${baseId}-target`}
            className="text-fg-muted text-[0.625rem] font-medium tracking-widest uppercase"
          >
            Request target
          </label>
          <input
            id={`${baseId}-target`}
            name="target"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="/index.html"
            value={draft.target}
            aria-invalid={error ? true : undefined}
            aria-describedby={[hintId, coverageId, error ? errorId : null]
              .filter(Boolean)
              .join(' ')}
            onChange={(event) => set({ target: event.target.value })}
            className={cn(controlClasses, 'w-full font-mono text-sm')}
          />
        </div>

        <Control label="Version" htmlFor={`${baseId}-version`}>
          <select
            id={`${baseId}-version`}
            value={draft.version}
            onChange={(event) => set({ version: event.target.value as HttpVersion })}
            className={cn(controlClasses, 'w-28 font-mono')}
          >
            {HTTP_VERSIONS.map((version) => (
              <option key={version} value={version}>
                {version}
              </option>
            ))}
          </select>
        </Control>

        <Button type="submit" icon={<Send size={14} />}>
          Send
        </Button>
      </div>

      {error ? (
        <p id={errorId} role="alert" className="text-state-error text-xs leading-snug">
          {error}
        </p>
      ) : null}

      <p id={coverageId} className="text-fg-muted text-[0.6875rem] leading-snug">
        {coverage.note}
      </p>

      <div className="grid gap-3 lg:grid-cols-2">
        <Control
          label="Extra header fields"
          htmlFor={`${baseId}-headers`}
          hint="One per line, as Name: value. The browser adds Host, User-Agent, Accept and the rest by itself — these go on top."
        >
          <textarea
            id={`${baseId}-headers`}
            rows={3}
            spellCheck={false}
            placeholder={'X-Request-Id: 7f1a\nAuthorization: Bearer demo'}
            value={draft.headers}
            onChange={(event) => set({ headers: event.target.value })}
            className={cn(controlClasses, 'h-auto w-full py-1.5 font-mono')}
          />
        </Control>

        <Control
          label="Body"
          htmlFor={`${baseId}-body`}
          hint={
            semantics.requestContent === 'forbidden'
              ? `${draft.method} must not carry content (${semantics.rfc}).`
              : semantics.requestContent === 'no-defined-semantics'
                ? `Content on ${draft.method} is legal but has no defined meaning, and servers may reject it.`
                : 'Content-Length is added for you, counting octets rather than characters.'
          }
        >
          <textarea
            id={`${baseId}-body`}
            rows={3}
            spellCheck={false}
            disabled={semantics.requestContent === 'forbidden'}
            placeholder={'{ "name": "third" }'}
            value={draft.body}
            onChange={(event) => set({ body: event.target.value })}
            className={cn(
              controlClasses,
              'h-auto w-full py-1.5 font-mono disabled:opacity-50',
            )}
          />
        </Control>
      </div>

      <fieldset className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="sr-only">Request conditions</legend>
        <Toggle
          label="Over TLS"
          hint="https rather than http. Secure cookies need this to be true."
          checked={draft.secure}
          onChange={(secure) => set({ secure })}
        />
        <Toggle
          label="Send it twice"
          hint="Three seconds apart, by a client that has already learned whatever the first taught it."
          checked={draft.repeat}
          onChange={(repeat) => set({ repeat })}
        />
        <Toggle
          label="Reload"
          hint="Cache-Control: no-cache on the request — revalidate whatever is stored."
          checked={draft.reload}
          onChange={(reload) => set({ reload })}
        />
        <Toggle
          label="Follow redirects"
          hint="Off stops on the 3xx, so the Location field can be read before it is acted on."
          checked={draft.followRedirects}
          onChange={(followRedirects) => set({ followRedirects })}
        />
        <Toggle
          label={`From ${SANDBOX_PAGE_ORIGIN}`}
          hint="Makes it cross-origin, so CORS applies and a preflight may be required."
          checked={draft.crossOrigin}
          onChange={(crossOrigin) => set({ crossOrigin })}
        />
        <Toggle
          label="With credentials"
          hint="Attach cookies to the cross-origin request, as credentials: 'include' does."
          checked={draft.withCredentials}
          onChange={(withCredentials) => set({ withCredentials })}
        />
      </fieldset>

      <div>
        <span className="text-fg-muted text-[0.625rem] font-medium tracking-widest uppercase">
          Routes this server has
        </span>
        <ul className="mt-1.5 flex flex-wrap gap-1">
          {SANDBOX_ROUTES.map((route) => {
            const active = coverage.route?.path === route.path;
            return (
              <li key={route.path}>
                <button
                  type="button"
                  title={route.note}
                  aria-pressed={active}
                  onClick={() =>
                    set({
                      target: route.path,
                      method: (route.methods ?? ['GET'])[0],
                    })
                  }
                  className={cn(
                    'rounded-md border px-2 py-0.5 font-mono text-[0.625rem] transition-colors',
                    focusRing,
                    active
                      ? 'border-accent/60 bg-accent/12 text-fg'
                      : 'border-border bg-surface text-fg-secondary hover:border-border-strong',
                  )}
                >
                  {route.path}
                </button>
              </li>
            );
          })}
          <li>
            <Badge tone="neutral">anything else → 404</Badge>
          </li>
        </ul>
      </div>
    </form>
  );
}
