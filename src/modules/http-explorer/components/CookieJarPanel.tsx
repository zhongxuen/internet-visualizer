'use client';

import { useState } from 'react';

import { Badge, Panel, type BadgeTone } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';

import { COOKIE_DEFENCES, type Cookie, type CookieJar } from '../sim/cookies';
import type { HttpExchange } from '../sim/exchange';

/**
 * The jar, and the three reasons a cookie is not in it.
 *
 * A cookie panel that lists names and values teaches nothing, because the name and the
 * value are the part that does not matter. The attributes are the security model: one of
 * them is what stops an injected script reading a session, another is what stops another
 * site spending it, and a third is what keeps it off a plaintext wire. So every cookie is
 * drawn as its attributes, with the missing ones as visible absences rather than as
 * nothing at all -- a cookie without `HttpOnly` should look like it is missing something,
 * because it is.
 *
 * ## Why it was not sent
 *
 * The exclusions get equal billing with the matches. "Why was my cookie not sent?" is the
 * question this panel exists to answer, and the answer is always one line from
 * `cookiesFor` in `sim/cookies.ts` -- expired, wrong domain, wrong path, needs a secure
 * channel, withheld from a cross-site request. Printing that reason beside the cookie
 * turns the commonest half-hour of confused debugging into a sentence.
 *
 * ## Set-Cookie that was refused
 *
 * A rejected `Set-Cookie` is invisible in a real browser unless the console is open, and
 * the rejections are the interesting ones: a `Domain` that tried to widen the cookie onto
 * somebody else's site, `SameSite=None` without `Secure`, a `__Host-` name whose
 * attributes do not back the promise the name makes. They are listed here with the rule
 * that refused them.
 */

export interface CookieJarPanelProps {
  /** The jar as the run left it. */
  jar: CookieJar;
  /** Exchanges up to the playhead. The last one supplies what was sent and what was not. */
  exchanges: readonly HttpExchange[];
  className?: string;
}

/** One attribute chip: present and meaningful, or absent and worth noticing. */
function Attribute({
  label,
  on,
  hint,
  tone = 'ok',
}: {
  label: string;
  on: boolean;
  hint: string;
  tone?: BadgeTone;
}) {
  return (
    <span
      title={hint}
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[0.5625rem]',
        on
          ? tone === 'ok'
            ? 'border-state-ok/40 bg-state-ok/10 text-state-ok'
            : 'border-accent/40 bg-accent/10 text-accent'
          : 'border-border text-fg-muted line-through opacity-60',
      )}
    >
      {label}
    </span>
  );
}

const SAME_SITE_HINTS: Readonly<Record<string, string>> = {
  Strict: 'Never sent on any cross-site request, including a link the user clicked.',
  Lax: 'Withheld from cross-site requests except a safe top-level navigation. The default.',
  None: 'Sent on every cross-site request. Requires Secure, and is what a tracker wants.',
};

function CookieRow({ cookie }: { cookie: Cookie }) {
  return (
    <li className="border-border/60 bg-surface rounded-lg border px-2 py-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-fg font-mono text-xs break-all">
          {cookie.name}
          <span className="text-fg-muted">=</span>
          <span className="text-fg-secondary">{cookie.value}</span>
        </span>
        <span className="text-fg-muted font-mono text-[0.5625rem]">
          {cookie.expiresAt === undefined ? 'session' : 'persistent'}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <span
          title={
            cookie.hostOnly
              ? 'No Domain attribute was sent, so this cookie goes to this exact host and no subdomain of it. The safer default, and you get it by omitting Domain.'
              : 'A Domain attribute was sent, which widened this cookie to every subdomain — including whichever one somebody else is running.'
          }
          className={cn(
            'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[0.5625rem]',
            cookie.hostOnly
              ? 'border-state-ok/40 bg-state-ok/10 text-state-ok'
              : 'border-state-warn/40 bg-state-warn/10 text-state-warn',
          )}
        >
          {cookie.hostOnly ? `host-only ${cookie.domain}` : `Domain=${cookie.domain}`}
        </span>

        <span
          title="Path scopes where the cookie is sent. It is organisation, not isolation: same-origin script reads across paths anyway."
          className="border-border text-fg-muted inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[0.5625rem]"
        >
          Path={cookie.path}
        </span>

        <Attribute
          label="HttpOnly"
          on={cookie.httpOnly}
          hint="Invisible to document.cookie, so an injected script cannot read it. Without this, one XSS is one stolen session."
        />
        <Attribute
          label="Secure"
          on={cookie.secure}
          hint="Never sent over http://. Without it, a single plaintext request puts the session on the wire."
        />
        <span
          title={SAME_SITE_HINTS[cookie.sameSite] ?? ''}
          className={cn(
            'inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[0.5625rem]',
            cookie.sameSite === 'None'
              ? 'border-state-warn/40 bg-state-warn/10 text-state-warn'
              : 'border-state-ok/40 bg-state-ok/10 text-state-ok',
          )}
        >
          SameSite={cookie.sameSite}
          {cookie.sameSiteExplicit ? '' : ' (default)'}
        </span>
        {cookie.partitioned ? (
          <Attribute
            label="Partitioned"
            on
            tone="accent"
            hint="CHIPS: the cookie is keyed by top-level site as well, so it cannot follow a user between sites."
          />
        ) : null}
      </div>
    </li>
  );
}

export function CookieJarPanel({ jar, exchanges, className }: CookieJarPanelProps) {
  const [showDefences, setShowDefences] = useState(false);
  const current = exchanges.at(-1);

  const sent = current?.cookiesSent ?? [];
  const excluded = current?.cookiesExcluded ?? [];
  const refused = (current?.cookiesSet ?? []).filter((result) => !result.accepted);

  return (
    <Panel
      title="Cookie jar"
      aside={
        <div className="flex items-center gap-2">
          <span className="text-fg-muted text-[0.625rem]">
            {jar.cookies.length} stored
          </span>
          <button
            type="button"
            aria-expanded={showDefences}
            onClick={() => setShowDefences((open) => !open)}
            className={cn(
              'border-border bg-surface text-fg-secondary hover:border-border-strong rounded-md border px-2 py-0.5 text-[0.625rem] transition-colors',
              focusRing,
            )}
          >
            what each attribute stops
          </button>
        </div>
      }
      scroll
      className={cn('max-h-[34rem]', className)}
    >
      <div className="flex flex-col gap-3">
        {showDefences ? (
          <ul className="border-accent/30 bg-accent/5 flex flex-col gap-2 rounded-lg border p-2">
            {COOKIE_DEFENCES.map((defence) => (
              <li key={defence.attribute} className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-2">
                  <code className="text-accent font-mono text-[0.6875rem]">
                    {defence.attribute}
                  </code>
                  <span className="text-fg text-[0.6875rem] font-medium">
                    stops: {defence.stops}
                  </span>
                </div>
                <p className="text-fg-secondary mt-0.5 text-[0.625rem] leading-snug">
                  {defence.how}
                </p>
                <p className="text-state-warn/90 mt-0.5 text-[0.625rem] leading-snug">
                  Without it: {defence.withoutIt}
                </p>
                <p className="text-fg-muted mt-0.5 font-mono text-[0.5625rem]">
                  {defence.rfc}
                </p>
              </li>
            ))}
          </ul>
        ) : null}

        <section aria-labelledby="jar-stored">
          <h3
            id="jar-stored"
            className="text-fg-muted text-[0.625rem] font-medium tracking-widest uppercase"
          >
            In the jar
          </h3>
          {jar.cookies.length === 0 ? (
            <p className="text-fg-muted mt-1 text-[0.6875rem] leading-snug">
              Empty. A fresh browser profile — nothing has asked the browser to remember
              anything yet.
            </p>
          ) : (
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {jar.cookies.map((cookie) => (
                <CookieRow
                  key={`${cookie.name}|${cookie.domain}|${cookie.path}`}
                  cookie={cookie}
                />
              ))}
            </ul>
          )}
        </section>

        {current ? (
          <section aria-labelledby="jar-current">
            <h3
              id="jar-current"
              className="text-fg-muted text-[0.625rem] font-medium tracking-widest uppercase"
            >
              On {current.request.method} {current.request.target}
            </h3>

            <p className="text-fg-secondary mt-1 text-[0.6875rem] leading-snug">
              {sent.length === 0
                ? 'No cookies attached.'
                : `Attached automatically: ${sent.map((cookie) => cookie.name).join(', ')}. The browser sent these because of where the request was going, not because of who caused it — which is the whole of CSRF.`}
            </p>

            {excluded.length > 0 ? (
              <ul className="mt-1.5 flex flex-col gap-1">
                {excluded.map((exclusion, index) => (
                  <li
                    key={`${exclusion.cookie.name}-${index}`}
                    className="border-state-warn/30 bg-state-warn/5 rounded border px-2 py-1"
                  >
                    <span className="text-fg font-mono text-[0.625rem]">
                      {exclusion.cookie.name}
                    </span>
                    <span className="text-fg-secondary text-[0.625rem]">
                      {' '}
                      held back — {exclusion.reason}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

            {refused.length > 0 ? (
              <ul className="mt-1.5 flex flex-col gap-1">
                {refused.map((result, index) => (
                  <li
                    key={index}
                    className="border-state-error/30 bg-state-error/5 rounded border px-2 py-1"
                  >
                    <Badge tone="error">Set-Cookie refused</Badge>
                    <span className="text-fg-secondary ml-1.5 text-[0.625rem]">
                      {result.reason}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}
      </div>
    </Panel>
  );
}
