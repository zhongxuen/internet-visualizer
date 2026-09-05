'use client';

import { useMemo, useState, type FormEvent } from 'react';

import { Badge, Button, CodeBlock, Panel } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';

import {
  buildConsoleRequest,
  consoleStore,
  coverageFor,
  CONSOLE_API_KEY,
  CONSOLE_CONTENT_TYPES,
  DEFAULT_CONSOLE_DRAFT,
  parseConsoleDraft,
  runConsoleRequest,
  type ConsoleContentType,
  type ConsoleCredentialKind,
  type ConsoleDraft,
} from '../sandbox';
import { HTTP_METHODS, type HttpMethod } from '../sim/message';
import {
  statusChoice,
  verbSemantics,
  type RestOutcome,
  type RestStore,
} from '../sim/rest';

import { ResponseShape } from './ResponseShape';

/**
 * Build a request, send it at nothing, and read the answer.
 *
 * "Send" is the word a learner has in their head and so it is the word on the button. What
 * actually happens is a function call: `handleRest` takes the store held in this component's
 * state and returns a new one. Nothing leaves the tab. The `simulated` badge and the note
 * under the form say so, `sandbox.ts` is where the property is enforced, and the enforcement
 * is structural rather than careful -- there is no host field in the form and no `fetch`
 * anywhere in the module.
 *
 * ## Why the store lives here
 *
 * A console whose store reset between requests could not show anything interesting: the whole
 * point of sending `POST /articles` twice is that the second one lands in a collection the
 * first one changed. So the store is state, it survives every send, and there is a button to
 * put it back -- which is also the only honest way to offer "start again", because the store
 * is immutable and the reset is literally a fresh value rather than an undo.
 *
 * ## What the panel refuses to send, and what it insists on sending
 *
 * It refuses an absolute URL, a target with a space in it, and a body on a method that has no
 * content -- three things that are malformed rather than wrong, and whose answer would be a
 * message from the parser rather than from the API.
 *
 * It *insists* on sending everything else, including a `POST` with no body, a `PATCH` with the
 * wrong media type, and a path nothing is routed at. Those all have interesting answers --
 * `400`, `415`, `404` -- and a console that helpfully prevented them would be teaching its own
 * opinion in place of the specification's.
 */

export interface ApiConsoleProps {
  /** A target chosen elsewhere -- the endpoint explorer, usually -- to prefill the form. */
  prefill?: { method: HttpMethod; target: string } | undefined;
  /** Fired whenever the form's target changes, so the explorer can mark it. */
  onTargetChange?: (target: string) => void;
  className?: string;
}

const CREDENTIALS: readonly {
  value: ConsoleCredentialKind;
  label: string;
  hint: string;
}[] = [
  {
    value: 'none',
    label: 'None',
    hint: 'No credential. The gateway has nobody to refuse.',
  },
  {
    value: 'api-key-header',
    label: 'Key in header',
    hint: `X-API-Key: ${CONSOLE_API_KEY} — the placement that does not end up in a log.`,
  },
  {
    value: 'api-key-query',
    label: 'Key in query',
    hint: 'Same secret, appended to the request-target. Watch where it ends up.',
  },
  {
    value: 'bearer',
    label: 'Bearer token',
    hint: 'Anything you type. A malformed token is the interesting case, so nothing is checked here.',
  },
];

const FIELD_CLASS =
  'border-border bg-surface text-fg placeholder:text-fg-muted rounded-lg border px-2.5 py-1.5 font-mono text-xs';

function statusTone(status: number): 'ok' | 'accent' | 'warn' | 'error' | 'neutral' {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  if (status >= 300) return 'accent';
  if (status >= 200) return 'ok';
  return 'neutral';
}

/** The response, as the headers and body a client would actually receive. */
function responseText(outcome: RestOutcome): string {
  const lines = outcome.response.headers.map((field) => `${field.name}: ${field.value}`);
  return [
    `HTTP/1.1 ${outcome.response.status} ${outcome.response.reason}`,
    ...lines,
    '',
    outcome.response.body ?? '',
  ]
    .join('\n')
    .trimEnd();
}

/** The request, in the same form, so the two can be read side by side. */
function requestText(draft: ReturnType<typeof buildConsoleRequest>): string {
  const lines = draft.headers.map((field) => `${field.name}: ${field.value}`);
  return [`${draft.method} ${draft.target} HTTP/1.1`, ...lines, '', draft.body ?? '']
    .join('\n')
    .trimEnd();
}

export function ApiConsole({ prefill, onTargetChange, className }: ApiConsoleProps) {
  const [store, setStore] = useState<RestStore>(consoleStore);
  const [draft, setDraft] = useState<ConsoleDraft>(DEFAULT_CONSOLE_DRAFT);
  const [outcome, setOutcome] = useState<RestOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<ReturnType<typeof buildConsoleRequest> | null>(null);

  // A prefill from the explorer is applied on the render it arrives, not in an effect: an
  // effect would show one frame of the previous target and then jump.
  const [appliedPrefill, setAppliedPrefill] = useState<typeof prefill>(undefined);
  if (prefill && prefill !== appliedPrefill) {
    setAppliedPrefill(prefill);
    setDraft((current) => ({
      ...current,
      method: prefill.method,
      target: prefill.target,
    }));
  }

  const update = <K extends keyof ConsoleDraft>(key: K, value: ConsoleDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    if (key === 'target') onTargetChange?.(value as string);
  };

  const semantics = verbSemantics(draft.method);
  const coverage = useMemo(
    () => coverageFor(store, { target: draft.target, method: draft.method }),
    [store, draft.target, draft.method],
  );

  const send = (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseConsoleDraft(draft);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    const built = buildConsoleRequest(parsed.value);
    const result = runConsoleRequest(store, parsed.value);
    setStore(result.store);
    setSent(built);
    setOutcome(result);
  };

  const reset = () => {
    setStore(consoleStore());
    setOutcome(null);
    setSent(null);
    setError(null);
  };

  const choice = outcome ? statusChoice(outcome.response.status) : undefined;

  return (
    <Panel
      title="Console"
      aside={<Badge tone="ok">simulated</Badge>}
      className={cn('min-w-0', className)}
    >
      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-fg-secondary text-xs leading-relaxed">
          Build a request against the bundled mock API. Nothing here reaches a network:
          &ldquo;send&rdquo; is a function call, the response is its return value, and the
          only thing that changes is a value held in this page. There is no host field in
          the form and no <code className="font-mono">fetch</code> anywhere in this
          module.
        </p>

        <form onSubmit={send} className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-fg-muted text-[0.5625rem] tracking-widest uppercase">
                Method
              </span>
              <select
                value={draft.method}
                onChange={(event) => update('method', event.target.value as HttpMethod)}
                className={cn(FIELD_CLASS, focusRing)}
              >
                {HTTP_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex min-w-[12rem] flex-1 flex-col gap-1">
              <span className="text-fg-muted text-[0.5625rem] tracking-widest uppercase">
                Request-target
              </span>
              <input
                value={draft.target}
                onChange={(event) => update('target', event.target.value)}
                spellCheck={false}
                autoComplete="off"
                className={cn(FIELD_CLASS, focusRing, 'w-full')}
              />
            </label>
          </div>

          <p className="text-fg-muted text-[0.6875rem] leading-relaxed">
            <span className={semantics.safe ? 'text-state-ok' : 'text-fg-muted'}>
              {semantics.safe ? 'Safe' : 'Not safe'}
            </span>
            {', '}
            <span className={semantics.idempotent ? 'text-accent' : 'text-fg-muted'}>
              {semantics.idempotent ? 'idempotent' : 'not idempotent'}
            </span>
            . {semantics.detail}
          </p>

          <div className="flex flex-col gap-1">
            <span className="text-fg-muted text-[0.5625rem] tracking-widest uppercase">
              Credential
            </span>
            <div role="group" aria-label="Credential" className="flex flex-wrap gap-1.5">
              {CREDENTIALS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={draft.credential === option.value}
                  title={option.hint}
                  onClick={() => update('credential', option.value)}
                  className={cn(
                    'rounded-lg border px-2.5 py-1 text-xs transition-colors',
                    focusRing,
                    draft.credential === option.value
                      ? 'border-accent/60 bg-accent/12 text-fg'
                      : 'border-border bg-surface text-fg-secondary hover:border-border-strong hover:text-fg',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="text-fg-muted text-[0.625rem] leading-snug">
              {CREDENTIALS.find((option) => option.value === draft.credential)?.hint}
            </p>
          </div>

          {draft.credential === 'bearer' ? (
            <label className="flex flex-col gap-1">
              <span className="text-fg-muted text-[0.5625rem] tracking-widest uppercase">
                Token
              </span>
              <input
                value={draft.bearerToken}
                onChange={(event) => update('bearerToken', event.target.value)}
                placeholder="eyJhbGciOiJIUzI1NiJ9.…"
                spellCheck={false}
                autoComplete="off"
                className={cn(FIELD_CLASS, focusRing, 'w-full')}
              />
            </label>
          ) : null}

          {semantics.body !== 'none' ? (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-fg-muted text-[0.5625rem] tracking-widest uppercase">
                  Content-Type
                </span>
                <select
                  value={draft.contentType}
                  onChange={(event) =>
                    update('contentType', event.target.value as ConsoleContentType)
                  }
                  className={cn(FIELD_CLASS, focusRing)}
                >
                  {CONSOLE_CONTENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-fg-muted text-[0.5625rem] tracking-widest uppercase">
                  Body
                </span>
                <textarea
                  value={draft.body}
                  onChange={(event) => update('body', event.target.value)}
                  rows={4}
                  spellCheck={false}
                  placeholder={'{\n  "title": "…",\n  "body": "…"\n}'}
                  className={cn(FIELD_CLASS, focusRing, 'w-full resize-y')}
                />
              </label>
            </>
          ) : null}

          <p
            className={cn(
              'text-[0.6875rem] leading-relaxed',
              coverage.known ? 'text-fg-muted' : 'text-state-warn',
            )}
          >
            {coverage.note}
          </p>

          {error ? (
            <p role="alert" className="text-state-error text-xs leading-relaxed">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary" size="sm">
              Send
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={reset}>
              Reset the mock API
            </Button>
          </div>
        </form>

        {outcome && sent ? (
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={statusTone(outcome.response.status)}>
                {outcome.response.status} {outcome.response.reason}
              </Badge>
              {outcome.decision.changed.length > 0 ? (
                <Badge tone="neutral">
                  changed: {outcome.decision.changed.join(', ')}
                </Badge>
              ) : null}
            </div>

            <p className="text-fg-secondary text-xs leading-relaxed">
              {outcome.decision.why}
            </p>
            {choice?.contrast ? (
              <p className="text-fg-muted text-[0.6875rem] leading-relaxed">
                {choice.contrast}
              </p>
            ) : null}
            {outcome.decision.notes.map((note) => (
              <p key={note} className="text-fg-muted text-[0.6875rem] leading-relaxed">
                {note}
              </p>
            ))}

            <div className="grid min-w-0 gap-2 xl:grid-cols-2">
              <CodeBlock
                code={requestText(sent)}
                language="http"
                caption="What was sent"
                showLineNumbers={false}
              />
              <CodeBlock
                code={responseText(outcome)}
                language="http"
                caption="What came back"
                showLineNumbers={false}
              />
            </div>

            <ResponseShape
              body={outcome.response.body}
              {...(outcome.decision.target.resource
                ? { resource: outcome.decision.target.resource }
                : {})}
              title="What came back, key by key"
              caption="Fields of the resource are explained by its own definition; everything else comes from a specification or a convention, and the badge says which."
            />
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
