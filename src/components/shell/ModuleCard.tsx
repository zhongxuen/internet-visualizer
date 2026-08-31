import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import type { ModuleMeta, ModuleStatus } from '@/modules/registry';

import { ModuleGlyph, type GlyphVariant } from './ModuleGlyph';
import { SafetyBadge } from './SafetyBadge';

/**
 * Which idle animation hints at which module.
 *
 * Deliberately *not* a registry field: the registry describes what a module teaches,
 * and a decorative loop is a presentation detail the shell owns. An id missing from
 * this map still gets a card — it just falls back to the generic glyph — so the
 * "adding a registry entry adds a card with no other edit" rule holds.
 */
const GLYPH_BY_MODULE: Record<string, GlyphVariant> = {
  'network-map': 'graph',
  'packet-journey': 'path',
  'dns-explorer': 'resolve',
  'http-explorer': 'exchange',
  'https-explorer': 'handshake',
  'api-visualizer': 'exchange',
  'websocket-viewer': 'stream',
  'internet-simulator': 'path',
  'network-diagnostics': 'ping',
  'learning-center': 'lesson',
};

const STATUS_LABEL: Record<ModuleStatus, string> = {
  planned: 'Planned',
  'in-progress': 'In progress',
  ready: 'Ready',
};

const STATUS_TONE = {
  planned: 'pending',
  'in-progress': 'warn',
  ready: 'ok',
} as const;

/** Beyond this the topic row wraps and cards stop lining up. */
const MAX_TOPICS = 3;

export interface ModuleCardProps {
  module: ModuleMeta;
  className?: string;
}

/**
 * One module on the home page explorer.
 *
 * Renders an `<li>`: it is always a child of `ModuleGrid`'s list, and a real list item
 * (rather than a `display: contents` wrapper) keeps "3 of 10" announced correctly.
 *
 * `planned` modules are muted, not unclickable. Every module in the registry is
 * planned today, so disabling the links would leave the product inert and the
 * EmptyState on each route unreachable — the opposite of what "planned modules route
 * to an EmptyState" asks for. The status badge and the dimmed glyph carry the message.
 */
export function ModuleCard({ module, className }: ModuleCardProps) {
  const { id, title, route, summary, status, topics, usesRealNetwork } = module;
  const shown = topics.slice(0, MAX_TOPICS);
  const overflow = topics.length - shown.length;
  const planned = status === 'planned';

  return (
    <li
      className={cn(
        'group border-border bg-surface-raised relative flex flex-col rounded-xl border p-5',
        'hover:border-border-strong hover:bg-surface-overlay transition-colors',
        // The whole card is one hit target (the stretched link below), so the focus
        // ring belongs on the card, not on the few pixels of heading text.
        'has-[a:focus-visible]:outline-focus has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-fg text-base font-medium">
          {/*
            Stretched link: the accessible name stays the module title while the click
            target becomes the whole card. Anything that must stay independently
            interactive has to sit above the overlay — see the safety badge below.
          */}
          <Link
            href={route}
            className="rounded-sm outline-none after:absolute after:inset-0 after:rounded-xl"
          >
            {title}
          </Link>
        </h3>
        <Badge tone={STATUS_TONE[status]} className="shrink-0">
          {STATUS_LABEL[status]}
        </Badge>
      </div>

      <p className="text-fg-muted mt-2 text-sm leading-relaxed">{summary}</p>

      {/* `mt-auto` pins the footer down so cards with shorter summaries still align. */}
      <div className="mt-auto flex items-end justify-between gap-3 pt-5">
        <div className="flex flex-wrap items-center gap-1.5">
          {shown.map((topic) => (
            <Badge key={topic} tone="neutral">
              {topic}
            </Badge>
          ))}
          {overflow > 0 ? (
            <span className="text-fg-muted text-xs" title={topics.join(', ')}>
              +{overflow} more
            </span>
          ) : null}
        </div>

        <ModuleGlyph
          variant={GLYPH_BY_MODULE[id]}
          className={cn(
            'shrink-0 transition-opacity group-hover:opacity-100',
            planned ? 'opacity-45' : 'opacity-80',
          )}
        />
      </div>

      <div className="border-border mt-4 flex items-center justify-between gap-3 border-t pt-3">
        {/*
          Every card states its safety posture — not just the live ones. A user should
          read the badge, never have to notice the absence of one.

          `z-10` lifts it out from under the stretched link so its tooltip is still
          reachable by pointer; keyboard focus reaches it either way.
        */}
        <span className="relative z-10">
          <SafetyBadge variant={usesRealNetwork ? 'live' : 'simulated'} />
        </span>
        <span
          aria-hidden="true"
          className="text-fg-muted group-hover:text-accent inline-flex items-center gap-1 text-xs transition-colors"
        >
          {planned ? 'Preview' : 'Open'}
          <ArrowRight className="size-3.5" />
        </span>
      </div>
    </li>
  );
}
