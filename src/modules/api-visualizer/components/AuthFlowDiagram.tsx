'use client';

import { useState } from 'react';

import { Badge, CodeBlock, Panel } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';

import {
  API_KEY_PLACEMENTS,
  explainClaim,
  JWT_ALG_NONE_WARNING,
  JWT_PAYLOAD_NOT_ENCRYPTED,
  JWT_REVOCATION_NOTE,
  OAUTH_ACTORS,
  type AuthorizationCodeFlow,
  type DecodedJwt,
  type InterceptionOutcome,
  type JwtVerification,
  type OAuthActor,
  type OAuthStep,
} from '../sim/auth';
import type { ApiExchange, ExchangeAuth } from '../sim/exchange';

/**
 * How a request says who is making it, in whichever of the three ways this run uses.
 *
 * One component rather than three because the three are the same question asked at different
 * depths -- a key names an account, a token carries claims about one, and OAuth is how a
 * client gets a token without ever seeing a password -- and putting them behind one heading
 * is what makes that progression visible.
 *
 * ## The sentence this component exists to print
 *
 * Whenever a token is shown, {@link JWT_PAYLOAD_NOT_ENCRYPTED} is printed above it. Not as a
 * tooltip, not behind a disclosure: as the first thing under the heading, because the panel
 * has just decoded somebody's claims without a secret and the reader is entitled to know that
 * is not a trick. The constant lives in `sim/auth.ts` so it cannot drift and so grepping for
 * it finds every surface that renders claims.
 *
 * ## The ladder
 *
 * Four columns, one per party of RFC 6749, and each rung drawn between the two it involves.
 * Rungs that are *not* messages -- deriving the challenge, recomputing it, a person reading a
 * consent screen -- are drawn without an arrow, because drawing them as traffic would
 * misrepresent the flow's central property: the client's secret never travels, and the user's
 * password travels exactly once, to exactly one party.
 */

export interface AuthFlowDiagramProps {
  /** The OAuth ladder, for the run that has one. */
  flow?: AuthorizationCodeFlow;
  /** What happened when the code was stolen. Shown under the ladder. */
  interception?: InterceptionOutcome;
  /** The guessed-verifier attempt, when the scenario ran one. */
  guessedInterception?: InterceptionOutcome;
  /** Credential checks, one per exchange that presented something. */
  exchanges?: readonly ApiExchange[];
  /** Which exchange is selected, if the module is driving the selection. */
  selectedId?: string | null;
  onSelect?: (exchangeId: string) => void;
  className?: string;
}

const ACTOR_ORDER: readonly OAuthActor[] = [
  'user',
  'client',
  'authorization-server',
  'resource-server',
];

// ---------------------------------------------------------------------------
// The token
// ---------------------------------------------------------------------------

/** A base64url segment, wrapped so a long token does not blow the layout out. */
function Segment({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'accent' | 'ok' | 'warn';
}) {
  const colours = {
    accent: 'border-accent/40 bg-accent/8 text-accent',
    ok: 'border-state-ok/40 bg-state-ok/8 text-state-ok',
    warn: 'border-state-warn/40 bg-state-warn/8 text-state-warn',
  } as const;

  return (
    <div className={cn('min-w-0 rounded-lg border px-2 py-1.5', colours[tone])}>
      <p className="text-[0.5625rem] tracking-widest uppercase opacity-80">{label}</p>
      <p className="mt-0.5 font-mono text-[0.625rem] leading-snug break-all">
        {value === '' ? '(empty)' : value}
      </p>
    </div>
  );
}

function ClaimRow({ name, value }: { name: string; value: unknown }) {
  const explanation = explainClaim(name);
  const registered = explanation !== undefined;

  return (
    <li className="border-border/60 bg-surface rounded-lg border px-2.5 py-1.5">
      <div className="flex flex-wrap items-baseline gap-2">
        <code className={cn('font-mono text-xs', registered ? 'text-accent' : 'text-fg')}>
          {name}
        </code>
        <code className="text-fg-secondary min-w-0 flex-1 font-mono text-[0.6875rem] break-all">
          {typeof value === 'string' ? value : JSON.stringify(value)}
        </code>
        {registered ? null : <Badge tone="warn">private claim</Badge>}
      </div>
      <p className="text-fg-secondary mt-1 text-[0.6875rem] leading-relaxed">
        {explanation
          ? `${explanation.label}. ${explanation.what}`
          : 'Not a registered claim. Anything here is readable by whoever holds the token — which is the case against putting an email address, an internal id, or an unreleased feature name in one.'}
      </p>
      {explanation?.detail ? (
        <p className="text-fg-muted mt-0.5 text-[0.6875rem] leading-relaxed">
          {explanation.detail}
        </p>
      ) : null}
    </li>
  );
}

/** A decoded token, with the sentence that has to appear above it. */
export function JwtView({
  decoded,
  verification,
}: {
  decoded: DecodedJwt;
  verification?: JwtVerification;
}) {
  const algorithm =
    typeof decoded.header['alg'] === 'string' ? decoded.header['alg'] : '';

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="border-state-warn/40 bg-state-warn/8 rounded-lg border px-2.5 py-2">
        <p className="text-state-warn text-[0.5625rem] tracking-widest uppercase">
          Encoded, not encrypted
        </p>
        <p className="text-fg-secondary mt-1 text-xs leading-relaxed">
          {JWT_PAYLOAD_NOT_ENCRYPTED}
        </p>
      </div>

      <div className="grid min-w-0 gap-1.5 sm:grid-cols-3">
        <Segment label="header" value={decoded.segments.header} tone="accent" />
        <Segment label="payload" value={decoded.segments.payload} tone="ok" />
        <Segment label="signature" value={decoded.segments.signature} tone="warn" />
      </div>

      <p className="text-fg-muted text-[0.6875rem] leading-relaxed">
        The signature covers <code className="font-mono">header.payload</code>{' '}
        <em>as encoded text</em>, not as the JSON it decodes to — which is why a token
        cannot be re-serialised or pretty-printed and still verify.
      </p>

      <CodeBlock
        code={decoded.headerJson}
        language="json"
        caption="Header, decoded"
        showLineNumbers={false}
      />

      {algorithm === 'none' ? (
        <p className="text-state-error text-[0.6875rem] leading-relaxed">
          {JWT_ALG_NONE_WARNING}
        </p>
      ) : null}

      <div className="flex flex-col gap-1">
        <span className="text-fg-muted text-[0.5625rem] tracking-widest uppercase">
          Claims, read without a key
        </span>
        <ul className="flex flex-col gap-1">
          {Object.entries(decoded.claims).map(([name, value]) => (
            <ClaimRow key={name} name={name} value={value} />
          ))}
        </ul>
      </div>

      {verification ? (
        <div className="flex flex-col gap-1">
          <span className="text-fg-muted text-[0.5625rem] tracking-widest uppercase">
            What the verifier checked
          </span>
          <ul className="flex flex-col gap-1">
            {verification.checks.map((check) => (
              <li
                key={check.name}
                className={cn(
                  'rounded-lg border px-2.5 py-1.5',
                  check.passed
                    ? 'border-state-ok/40 bg-state-ok/8'
                    : 'border-state-error/50 bg-state-error/10',
                )}
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span aria-hidden="true" className="font-mono text-[0.6875rem]">
                    {check.passed ? '✓' : '✕'}
                  </span>
                  <code className="text-fg font-mono text-xs">{check.name}</code>
                  <span className="sr-only">{check.passed ? 'passed' : 'failed'}</span>
                </div>
                <p className="text-fg-secondary mt-0.5 text-[0.6875rem] leading-relaxed">
                  {check.what}
                </p>
                {check.detail ? (
                  <p className="text-fg-muted mt-0.5 font-mono text-[0.625rem] break-all">
                    {check.detail}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="text-fg-muted text-[0.6875rem] leading-relaxed">
            {JWT_REVOCATION_NOTE}
          </p>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Credentials, per request
// ---------------------------------------------------------------------------

function CredentialSummary({ auth }: { auth: ExchangeAuth }) {
  if (auth.credential.kind === 'none') {
    return (
      <p className="text-fg-secondary text-xs leading-relaxed">
        No credential was presented at all.
      </p>
    );
  }

  if (auth.credential.kind === 'api-key') {
    const chosen = auth.credential.placement;
    const placement = API_KEY_PLACEMENTS.find((entry) => entry.placement === chosen);
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={placement?.verdict === 'avoid' ? 'warn' : 'ok'}>
            key in the {chosen}
          </Badge>
          {placement ? (
            <code className="text-fg-muted font-mono text-[0.625rem]">
              {placement.example}
            </code>
          ) : null}
        </div>
        {placement ? (
          <>
            <p className="text-fg-secondary text-[0.6875rem] leading-relaxed">
              {placement.what}
            </p>
            {placement.verdict === 'avoid' ? (
              <ul className="flex flex-col gap-0.5">
                {placement.leaks.map((leak) => (
                  <li
                    key={leak}
                    className="text-state-warn text-[0.6875rem] leading-relaxed"
                  >
                    — {leak}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </div>
    );
  }

  if (auth.decodeError) {
    return (
      <p className="text-state-warn text-xs leading-relaxed">
        This token could not be decoded: {auth.decodeError}. Note that it failed here,
        before any secret was consulted — a malformed token never reaches the signature
        check.
      </p>
    );
  }

  return auth.decoded ? (
    <JwtView
      decoded={auth.decoded}
      {...(auth.verification ? { verification: auth.verification } : {})}
    />
  ) : null;
}

function CredentialList({
  exchanges,
  selectedId,
  onSelect,
}: {
  exchanges: readonly ApiExchange[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const withAuth = exchanges.filter((exchange) => exchange.auth !== undefined);
  const [ownSelection, setOwnSelection] = useState<string | null>(null);
  const current = selectedId ?? ownSelection ?? withAuth[0]?.id ?? null;
  const selected = withAuth.find((exchange) => exchange.id === current) ?? withAuth[0];

  if (withAuth.length === 0) {
    return (
      <p className="text-fg-muted text-xs leading-relaxed">
        No request in this run carries a credential.
      </p>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div role="group" aria-label="Request" className="flex flex-wrap gap-1">
        {withAuth.map((exchange) => {
          const active = exchange.id === selected?.id;
          const failed = exchange.status === 401 || exchange.status === 403;
          return (
            <button
              key={exchange.id}
              type="button"
              aria-pressed={active}
              // The visible label is the status, which is what makes the strip readable at a
              // glance; the accessible name has to say which request it belongs to.
              aria-label={`${exchange.status} — ${exchange.title}`}
              title={exchange.title}
              onClick={() => {
                setOwnSelection(exchange.id);
                onSelect?.(exchange.id);
              }}
              className={cn(
                'rounded-md border px-2 py-1 font-mono text-[0.625rem] transition-colors',
                focusRing,
                active
                  ? 'border-accent/60 bg-accent/12 text-fg'
                  : failed
                    ? 'border-state-warn/40 bg-surface text-fg-secondary hover:text-fg'
                    : 'border-border bg-surface text-fg-secondary hover:text-fg',
              )}
            >
              {exchange.status}
            </button>
          );
        })}
      </div>

      {selected?.auth ? (
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-fg text-sm font-medium">{selected.title}</span>
            <Badge tone={selected.status < 400 ? 'ok' : 'warn'}>
              {selected.status} {selected.response.reason}
            </Badge>
          </div>
          <p className="text-fg-secondary text-xs leading-relaxed">
            {selected.auth.verdict.why}
          </p>
          <CredentialSummary auth={selected.auth} />
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

function Rung({
  step,
  expanded,
  onToggle,
}: {
  step: OAuthStep;
  expanded: boolean;
  onToggle: () => void;
}) {
  const fromIndex = ACTOR_ORDER.indexOf(step.from);
  const toIndex = ACTOR_ORDER.indexOf(step.to);
  const local = fromIndex === toIndex;
  const left = Math.min(fromIndex, toIndex);
  const span = Math.abs(toIndex - fromIndex) + 1;
  const rightwards = toIndex > fromIndex;
  const carriesMessage = step.request !== undefined || step.response !== undefined;

  return (
    <li>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className={cn(
          'w-full rounded-lg border px-2 py-1.5 text-left transition-colors',
          focusRing,
          expanded
            ? 'border-accent/60 bg-accent/10'
            : 'border-border bg-surface hover:border-border-strong',
        )}
      >
        <div
          aria-hidden="true"
          className="grid grid-cols-4 items-center gap-1"
          style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}
        >
          <div
            className="flex items-center gap-1"
            style={{ gridColumn: `${left + 1} / span ${span}` }}
          >
            {local ? (
              <span className="border-border-strong text-fg-muted rounded border border-dashed px-1.5 py-0.5 text-[0.5625rem]">
                local
              </span>
            ) : (
              <>
                {!rightwards ? (
                  <span className="text-accent text-[0.625rem]">◀</span>
                ) : null}
                <span
                  className={cn(
                    'h-px flex-1',
                    carriesMessage
                      ? 'bg-accent/60'
                      : 'bg-border-strong [background-image:none]',
                  )}
                />
                {rightwards ? (
                  <span className="text-accent text-[0.625rem]">▶</span>
                ) : null}
              </>
            )}
          </div>
        </div>

        <p className="text-fg mt-1 text-xs leading-snug">
          <span className="text-fg-muted font-mono text-[0.625rem]">
            {step.index + 1}.
          </span>{' '}
          {step.title}
        </p>

        {expanded ? (
          <div className="mt-1.5 flex flex-col gap-1.5">
            <p className="text-fg-secondary text-[0.6875rem] leading-relaxed">
              {step.what}
            </p>
            {step.defends ? (
              <p className="text-state-ok text-[0.6875rem] leading-relaxed">
                Defends against: {step.defends}
              </p>
            ) : null}
            {step.url ? (
              <code className="text-fg-muted font-mono text-[0.625rem] break-all">
                {step.url}
              </code>
            ) : null}
            {step.request?.body ? (
              <code className="text-fg-muted font-mono text-[0.625rem] break-all">
                {step.request.body}
              </code>
            ) : null}
            {step.response?.body ? (
              <code className="text-fg-muted font-mono text-[0.625rem] break-all">
                {step.response.body}
              </code>
            ) : null}
            <span className="text-fg-muted font-mono text-[0.625rem]">
              RFC {step.reference.rfc}
              {step.reference.section ? ` §${step.reference.section}` : ''}
            </span>
          </div>
        ) : null}
      </button>
    </li>
  );
}

function Ladder({
  flow,
  interception,
  guessedInterception,
}: {
  flow: AuthorizationCodeFlow;
  interception?: InterceptionOutcome;
  guessedInterception?: InterceptionOutcome;
}) {
  const [open, setOpen] = useState<number | null>(2);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="grid grid-cols-4 gap-1">
        {ACTOR_ORDER.map((actor) => (
          <div
            key={actor}
            title={OAUTH_ACTORS[actor].what}
            className="border-border bg-surface-raised rounded-lg border px-1.5 py-1"
          >
            <p className="text-fg text-[0.625rem] leading-tight font-medium">
              {OAUTH_ACTORS[actor].label}
            </p>
          </div>
        ))}
      </div>

      <ul className="flex flex-col gap-1">
        {flow.steps.map((step) => (
          <Rung
            key={step.index}
            step={step}
            expanded={open === step.index}
            onToggle={() => setOpen(open === step.index ? null : step.index)}
          />
        ))}
      </ul>

      <div className="border-border bg-surface-raised flex flex-col gap-1 rounded-lg border px-2.5 py-2">
        <span className="text-fg-muted text-[0.5625rem] tracking-widest uppercase">
          PKCE
        </span>
        <p className="text-fg-secondary text-[0.6875rem] leading-relaxed">
          The verifier is the secret and never travels through the browser. The challenge
          is <code className="font-mono">BASE64URL(SHA256(verifier))</code>, committed in
          step 3 — before anyone has logged in and before any code exists.
        </p>
        <code className="text-fg-muted font-mono text-[0.625rem] break-all">
          verifier {flow.pkce.verifier}
        </code>
        <code className="text-accent font-mono text-[0.625rem] break-all">
          challenge {flow.pkce.challenge} ({flow.pkce.method})
        </code>
      </div>

      {interception ? (
        <div
          className={cn(
            'flex flex-col gap-1.5 rounded-lg border px-2.5 py-2',
            interception.refused
              ? 'border-state-ok/40 bg-state-ok/8'
              : 'border-state-error/50 bg-state-error/10',
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-fg-muted text-[0.5625rem] tracking-widest uppercase">
              The stolen code
            </span>
            <Badge tone={interception.refused ? 'ok' : 'error'}>
              {interception.response.status} {interception.response.reason}
            </Badge>
          </div>
          <p className="text-fg-secondary text-[0.6875rem] leading-relaxed">
            {interception.why}
          </p>
          <ul className="flex flex-col gap-0.5">
            {interception.attackerHeld.map((held) => (
              <li key={held} className="text-fg-muted text-[0.6875rem] leading-relaxed">
                — the attacker holds {held}
              </li>
            ))}
          </ul>
          {guessedInterception ? (
            <p className="text-fg-muted text-[0.6875rem] leading-relaxed">
              Guessing instead: {guessedInterception.why}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function AuthFlowDiagram({
  flow,
  interception,
  guessedInterception,
  exchanges,
  selectedId,
  onSelect,
  className,
}: AuthFlowDiagramProps) {
  return (
    <Panel
      title={flow ? 'Authorization code + PKCE' : 'Credentials'}
      aside={<Badge tone="neutral">{flow ? 'RFC 6749 + 7636' : 'RFC 6750 + 7519'}</Badge>}
      scroll
      className={cn('min-w-0', className)}
    >
      {flow ? (
        <Ladder
          flow={flow}
          {...(interception ? { interception } : {})}
          {...(guessedInterception ? { guessedInterception } : {})}
        />
      ) : (
        <CredentialList
          exchanges={exchanges ?? []}
          {...(selectedId !== undefined ? { selectedId } : {})}
          {...(onSelect ? { onSelect } : {})}
        />
      )}
    </Panel>
  );
}
