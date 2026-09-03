'use client';

import { Badge } from '@/components/ui';
import { cn } from '@/lib/cn';

import type { HttpExchange } from '../sim/exchange';

/**
 * The request was sent. The server ran it. Only the response was blocked.
 *
 * CORS confusion is near-universal and it has one shape: people read a browser console
 * error as "the request was blocked" and conclude that CORS is a server-side access
 * control they have configured wrongly. It is neither. The request left, arrived, and was
 * executed -- side effects and all -- and what the browser withheld was the *answer*, from
 * the page, after it had already arrived.
 *
 * So this is three steps in fixed order rather than a status badge, and the third is
 * visibly separate from the first two. Reading them left to right is the correction: two
 * green steps and then a red one is a shape that cannot be misread as "it never left".
 *
 * The rule behind it is historical rather than logical, and worth saying: a request is
 * "simple" when an HTML form of 1999 could already have made it, so permitting it grants
 * an attacker nothing they did not already have. That is exactly why a simple request is
 * sent without asking and only its response is guarded, and why anything else -- a JSON
 * content type, an Authorization field -- costs a preflight round trip first.
 */

export interface CorsVerdictProps {
  /** The exchange being described. Renders nothing when it was same-origin. */
  exchange: HttpExchange;
  className?: string;
}

function Step({
  n,
  label,
  detail,
  tone,
}: {
  n: number;
  label: string;
  detail: string;
  tone: 'ok' | 'error' | 'neutral';
}) {
  return (
    <li
      className={cn(
        'min-w-0 flex-1 rounded-lg border px-2.5 py-2',
        tone === 'ok'
          ? 'border-state-ok/40 bg-state-ok/5'
          : tone === 'error'
            ? 'border-state-error/50 bg-state-error/8'
            : 'border-border bg-surface',
      )}
    >
      <div className="flex items-baseline gap-1.5">
        <span
          aria-hidden="true"
          className="text-fg-muted font-mono text-[0.625rem] tabular-nums"
        >
          {n}
        </span>
        <span className="text-fg text-xs font-medium">{label}</span>
      </div>
      <p className="text-fg-secondary mt-1 text-[0.6875rem] leading-snug">{detail}</p>
    </li>
  );
}

export function CorsVerdict({ exchange, className }: CorsVerdictProps) {
  const { cors, response, blockedFromPage } = exchange;
  if (!cors.crossOrigin) return null;

  const blocked = blockedFromPage;

  return (
    <section
      aria-label="Cross-origin verdict"
      className={cn(
        'border-border bg-surface-raised rounded-xl border px-3 py-2.5',
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-fg-secondary text-xs font-medium tracking-widest uppercase">
          Cross-origin
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="neutral">Origin: {cors.requestOrigin ?? 'none'}</Badge>
          {cors.preflightRequired ? (
            <Badge tone="warn">preflight required</Badge>
          ) : cors.simple ? (
            <Badge tone="neutral">simple request</Badge>
          ) : null}
          <Badge tone={blocked ? 'error' : 'ok'}>
            {blocked ? 'response blocked' : 'page may read it'}
          </Badge>
        </div>
      </div>

      <ol className="mt-2 flex flex-col gap-1.5 sm:flex-row">
        <Step
          n={1}
          tone="ok"
          label="The request was sent"
          detail={`${exchange.request.method} ${exchange.request.target} left the browser and crossed the network. Nothing about CORS stops this${cors.preflightRequired ? ', once the preflight before it came back with permission' : ''}.`}
        />
        <Step
          n={2}
          tone="ok"
          label="The server ran it"
          detail={`The origin executed the request and answered ${response.status} ${response.reason}. Any side effect it had, it has had — a blocked response does not undo a write.`}
        />
        <Step
          n={3}
          tone={blocked ? 'error' : 'ok'}
          label={
            blocked ? 'The page was refused the answer' : 'The page may read the answer'
          }
          detail={cors.reason}
        />
      </ol>

      {blocked ? (
        <p className="text-fg-muted mt-2 text-[0.625rem] leading-snug">
          This is the step people read as &ldquo;the request was blocked&rdquo;. It was
          not. CORS is a rule about who may <em>read</em> a response, enforced by the
          browser on behalf of the page — it is not, and has never been, server-side
          access control. A server that must not answer this caller has to refuse it
          itself.
        </p>
      ) : null}
    </section>
  );
}
