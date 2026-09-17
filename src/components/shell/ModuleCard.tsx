import Link from 'next/link';
import { ArrowRight, Clock } from 'lucide-react';

import { Badge, type BadgeTone } from '@/components/ui/Badge';
import type { Level } from '@/core/types/story';
import { cn } from '@/lib/cn';
import type { ModuleMeta } from '@/modules/registry';

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

/**
 * The level in words, always -- the tone is a second signal, never the only one. Neutral
 * for beginner on purpose: the first thing a newcomer sees should not look like a grade.
 */
const LEVEL: Record<Level, { label: string; tone: BadgeTone }> = {
  beginner: { label: 'Beginner', tone: 'neutral' },
  intermediate: { label: 'Intermediate', tone: 'accent' },
  advanced: { label: 'Advanced', tone: 'warn' },
};

export interface ModuleCardProps {
  module: ModuleMeta;
  /**
   * The title's heading level. 3 under a page section (`h2`); 4 when the grid sits under
   * a chapter heading of its own, so no level is skipped.
   */
  headingLevel?: 3 | 4;
  className?: string;
}

/**
 * One module, as a beginner meets it (uiux-spec.md §5.5): its name, the question it
 * answers, how hard it is and how long it takes.
 *
 * Renders an `<li>`: it is always a child of `ModuleGrid`'s list, and a real list item
 * (rather than a `display: contents` wrapper) keeps "3 of 10" announced correctly.
 *
 * No status badge. Every module is ready, and a word that is the same on every card is
 * noise to someone deciding where to start.
 */
export function ModuleCard({ module, headingLevel = 3, className }: ModuleCardProps) {
  const { id, title, route, question, level, minutes, usesRealNetwork } = module;
  const Heading = headingLevel === 4 ? 'h4' : 'h3';
  const levelSpec = LEVEL[level];

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
        <Heading className="text-fg text-base font-medium">
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
        </Heading>
        <ModuleGlyph
          variant={GLYPH_BY_MODULE[id]}
          className="shrink-0 opacity-80 transition-opacity group-hover:opacity-100"
        />
      </div>

      <p className="text-fg-secondary mt-2 text-sm leading-relaxed">{question}</p>

      {/* `mt-auto` pins the footer down so cards with shorter questions still align. */}
      <div className="mt-auto pt-4">
        <div className="border-border flex flex-wrap items-center gap-2 border-t pt-3">
          <Badge tone={levelSpec.tone}>{levelSpec.label}</Badge>
          {minutes !== undefined ? (
            <span className="text-fg-muted inline-flex items-center gap-1 text-xs">
              <Clock aria-hidden="true" className="size-3.5" />
              {minutes} min
            </span>
          ) : null}

          {/*
          Every card states its safety posture — not just the live one. A user should
          read the badge, never have to notice the absence of one. Compact, so the word
          is its accessible name and its tooltip rather than more text on the card.

          `z-10` lifts it out from under the stretched link so its tooltip is still
          reachable by pointer; keyboard focus reaches it either way.
        */}
          <span className="relative z-10 ml-auto">
            <SafetyBadge variant={usesRealNetwork ? 'live' : 'simulated'} compact />
          </span>
          <ArrowRight
            aria-hidden="true"
            className="text-fg-muted group-hover:text-accent size-4 transition-colors"
          />
        </div>
      </div>
    </li>
  );
}
