'use client';

import { useState } from 'react';

import { Badge, Panel, type BadgeTone } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';

import {
  CACHE_TIER_LABELS,
  NO_CACHE_VS_NO_STORE,
  type CacheEntryView,
  type CacheOutcome,
  type CacheTier,
} from '../sim/caching';
import type { HttpExchange } from '../sim/exchange';

/**
 * Two caches, because there are two caches.
 *
 * Nearly every explanation of HTTP caching describes one, and the single most common
 * production surprise -- a change deployed, the browser showing it, and half the world
 * still on the old copy -- is the second one. So the browser cache and the shared cache
 * at the edge are drawn side by side and never merged, with the directives that
 * distinguish them called out: `s-maxage` binds only the right-hand column, `private`
 * forbids only the right-hand column, and the `Authorization` rule of RFC 9111 §3.5
 * applies only there too.
 *
 * ## The outcome badge is per tier, not per exchange
 *
 * `HIT`, `MISS`, `REVALIDATED`, and `BYPASS` are answers to "what did *this* cache do",
 * and the two tiers routinely give different ones: the browser missing while the edge
 * hits is the ordinary case and is what a CDN is for. Reading a single badge for the
 * whole exchange would collapse exactly the distinction the panel exists to draw.
 *
 * ## no-cache versus no-store
 *
 * Given its own block rather than a tooltip, because it is the misconception this module
 * was written to remove and a tooltip is where explanations go to be missed. The wording
 * comes from `NO_CACHE_VS_NO_STORE` in `sim/caching.ts`, so the sentence a learner reads
 * and the rule the simulation applies come from the same place and cannot drift apart.
 */

export interface CacheStatePanelProps {
  /** The exchanges up to the playhead. The last one's outcomes are the current ones. */
  exchanges: readonly HttpExchange[];
  /** Both caches as they stand, from `HttpRun.cacheViews`. */
  views: Readonly<Record<CacheTier, CacheEntryView[]>>;
  /** False when the scenario declared no shared cache; the column says so rather than lying. */
  hasCdn: boolean;
  className?: string;
}

const OUTCOME_TONES: Readonly<Record<CacheOutcome, BadgeTone>> = {
  HIT: 'ok',
  MISS: 'warn',
  REVALIDATED: 'accent',
  BYPASS: 'neutral',
};

const OUTCOME_NOTES: Readonly<Record<CacheOutcome, string>> = {
  HIT: 'Served from store. Nothing was sent, so nothing could be slow.',
  MISS: 'Nothing usable stored. The full response crossed the network.',
  REVALIDATED:
    'A stored copy was checked and confirmed: 304, no body, cached bytes served.',
  BYPASS: 'The request or the response forbade this cache from taking part at all.',
};

const TIER_RULES: Readonly<Record<CacheTier, string>> = {
  browser:
    'Private, holding one person’s responses. Ignores s-maxage entirely, and stores ' +
    'private responses happily.',
  cdn:
    'Shared, holding everybody’s. Obeys s-maxage in preference to max-age, refuses ' +
    'anything marked private, and will not store a response to a request carrying ' +
    'Authorization unless the response explicitly allows it (RFC 9111 §3.5).',
};

function OutcomeCell({ outcome }: { outcome: CacheOutcome | undefined }) {
  if (!outcome) {
    return <span className="text-fg-muted text-[0.6875rem]">not consulted</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge tone={OUTCOME_TONES[outcome]}>{outcome}</Badge>
    </span>
  );
}

/** One tier's column: what it did on the current exchange, and what it now holds. */
function TierColumn({
  tier,
  outcome,
  entries,
  disabled,
}: {
  tier: CacheTier;
  outcome: CacheOutcome | undefined;
  entries: readonly CacheEntryView[];
  disabled?: string;
}) {
  return (
    <section
      aria-label={CACHE_TIER_LABELS[tier]}
      className="border-border bg-surface min-w-0 rounded-lg border p-2.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-fg text-xs font-medium">{CACHE_TIER_LABELS[tier]}</h3>
        {disabled ? (
          <Badge tone="neutral">none</Badge>
        ) : (
          <OutcomeCell outcome={outcome} />
        )}
      </div>

      <p className="text-fg-muted mt-1 text-[0.625rem] leading-snug">
        {disabled ?? TIER_RULES[tier]}
      </p>

      {!disabled && outcome ? (
        <p className="text-fg-secondary mt-1.5 text-[0.6875rem] leading-snug">
          {OUTCOME_NOTES[outcome]}
        </p>
      ) : null}

      {disabled ? null : entries.length === 0 ? (
        <p className="text-fg-muted mt-2 text-[0.6875rem] italic">
          Holding nothing. Either nothing storable has come back yet, or something said
          no-store.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {entries.map((entry) => (
            <li
              key={entry.key}
              className="border-border/60 bg-surface-raised rounded border px-2 py-1.5"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-fg-secondary truncate font-mono text-[0.6875rem]">
                  {entry.key}
                </span>
                <span className="text-fg-muted font-mono text-[0.625rem]">
                  {entry.status}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge tone={entry.freshness.isFresh ? 'ok' : 'warn'}>
                  {entry.label}
                </Badge>
                <span className="text-fg-muted text-[0.5625rem]">
                  {entry.freshness.lifetime.explanation}
                </span>
                {entry.revalidations > 0 ? (
                  <span className="text-fg-muted text-[0.5625rem]">
                    · confirmed {entry.revalidations}×
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function CacheStatePanel({
  exchanges,
  views,
  hasCdn,
  className,
}: CacheStatePanelProps) {
  const [showDirectives, setShowDirectives] = useState(false);
  const current = exchanges.at(-1);

  return (
    <Panel
      title="Caches"
      aside={
        <button
          type="button"
          aria-expanded={showDirectives}
          onClick={() => setShowDirectives((open) => !open)}
          className={cn(
            'border-border bg-surface text-fg-secondary hover:border-border-strong rounded-md border px-2 py-0.5 text-[0.625rem] transition-colors',
            focusRing,
          )}
        >
          no-cache vs no-store
        </button>
      }
      scroll
      className={cn('max-h-[34rem]', className)}
    >
      <div className="flex flex-col gap-3">
        {showDirectives ? (
          <div className="border-accent/30 bg-accent/5 grid gap-2 rounded-lg border p-2 sm:grid-cols-2">
            {NO_CACHE_VS_NO_STORE.map((directive) => (
              <div key={directive.directive} className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <code className="text-accent font-mono text-xs">
                    {directive.directive}
                  </code>
                  <Badge tone={directive.stored ? 'ok' : 'error'}>
                    {directive.stored ? 'stored' : 'never stored'}
                  </Badge>
                </div>
                <p className="text-fg-secondary mt-1 text-[0.6875rem] leading-snug">
                  {directive.meaning}
                </p>
                <p className="text-fg-muted mt-1 text-[0.625rem] leading-snug">
                  <strong className="font-medium">Costs:</strong>{' '}
                  {directive.costPerRequest}
                </p>
                <p className="text-fg-muted mt-1 text-[0.625rem] leading-snug">
                  <strong className="font-medium">Use it for:</strong>{' '}
                  {directive.useItFor}
                </p>
                <p className="text-state-warn/90 mt-1 text-[0.625rem] leading-snug">
                  {directive.misconception}
                </p>
                <p className="text-fg-muted mt-1 font-mono text-[0.5625rem]">
                  {directive.rfc}
                </p>
              </div>
            ))}
          </div>
        ) : null}

        {current ? (
          <p className="text-fg-secondary text-[0.6875rem] leading-snug">
            <span className="text-fg font-mono">
              {current.request.method} {current.request.target}
            </span>{' '}
            — {current.cacheReason}
          </p>
        ) : (
          <p className="text-fg-muted text-[0.6875rem]">
            Nothing has been asked for yet. Press play.
          </p>
        )}

        <div className="grid min-w-0 gap-2 lg:grid-cols-2">
          <TierColumn
            tier="browser"
            outcome={current?.browserCache}
            entries={views.browser}
          />
          <TierColumn
            tier="cdn"
            outcome={current?.cdnCache}
            entries={views.cdn}
            {...(hasCdn
              ? {}
              : {
                  disabled:
                    'This run has no shared cache in the path, so the browser talks ' +
                    'straight to the origin and pays the whole round trip itself.',
                })}
          />
        </div>
      </div>
    </Panel>
  );
}
