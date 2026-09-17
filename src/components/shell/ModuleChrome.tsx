'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, Clock } from 'lucide-react';
import { useId, type ReactNode } from 'react';

import { GlossaryTermButton, useInlineGlossary } from '@/components/glossary';
import { Badge } from '@/components/ui/Badge';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';
import { getChapter, getModuleByRoute } from '@/modules/registry';

import { LEVEL_LABEL } from './navItems';
import { SafetyBadge } from './SafetyBadge';

export interface ModuleChromeProps {
  children: ReactNode;
  /**
   * The explanation panel, filled by the `@panel` parallel route. Collapses to nothing
   * when a module has not supplied one.
   */
  panel?: ReactNode;
}

/**
 * One box for a topic, whether or not the glossary defines it, so the row does not
 * shift when the glossary's chunk arrives and a plain badge becomes a definition button.
 * `min-h-target-floor` is also the 24px target floor for the buttons.
 */
const CHIP = 'min-h-target-floor rounded-full border px-2.5 text-caption font-medium';

const crumbLink = cn(
  'text-fg-muted hover:text-fg rounded-sm underline-offset-4 transition-colors hover:underline',
  focusRing,
);

/**
 * The frame every module route wears: a breadcrumb, the title with its question, the
 * level, the minutes, the safety badge, the words the page uses, and the right-hand slot
 * for the explanation panel. Modules supply content, never chrome — nothing below is a
 * module's to re-declare or restyle.
 *
 * Compact on purpose: the whole header fits in 140px at 1366 wide, so the simulation --
 * which is the page -- starts above the fold (uiux-spec.md §4, "one obvious next
 * action").
 *
 * The module is resolved from the URL rather than passed in, so a module route can
 * stay a server component with no metadata plumbing, and so this cannot silently
 * disagree with the registry the nav and home page read.
 */
export function ModuleChrome({ children, panel }: ModuleChromeProps) {
  const pathname = usePathname() ?? '';
  const meta = getModuleByRoute(pathname);
  const glossary = useInlineGlossary();
  const wordsId = useId();

  // A route under (modules) with no registry entry is a bug, not a state to design
  // for. Render the content bare rather than inventing a title for it.
  if (!meta) return <>{children}</>;

  const chapter = getChapter(meta.chapter);
  const crumbs: { label: string; href?: string }[] = [
    { label: 'Home', href: '/' },
    { label: 'Explore', href: '/#explore' },
    ...(chapter ? [{ label: chapter.label }] : []),
  ];

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pt-4 pb-8 sm:px-6">
      <div data-module-header="">
        <nav aria-label="Breadcrumb">
          <ol className="text-caption flex flex-wrap items-center gap-1">
            {crumbs.map((crumb) => (
              <li
                key={crumb.label}
                className="text-fg-muted inline-flex items-center gap-1"
              >
                {crumb.href ? (
                  <Link href={crumb.href} className={crumbLink}>
                    {crumb.label}
                  </Link>
                ) : (
                  crumb.label
                )}
                <ChevronRight aria-hidden="true" className="size-3" />
              </li>
            ))}
            <li aria-current="page" className="text-fg-secondary">
              {meta.title}
            </li>
          </ol>
        </nav>

        <div className="mt-1.5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            {/* The one h1 on a module page. Modules must not add another. */}
            <h1 className="text-fg text-2xl leading-8 font-semibold tracking-tight">
              {meta.title}
            </h1>
            <p className="text-fg-secondary text-small">{meta.question}</p>
          </div>

          <div className="flex min-w-0 flex-col items-start gap-1.5 lg:items-end">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral">{LEVEL_LABEL[meta.level]}</Badge>
              {meta.minutes ? (
                <span className="text-fg-muted text-caption inline-flex items-center gap-1">
                  <Clock aria-hidden="true" className="size-3.5" />
                  {meta.minutes} min
                </span>
              ) : null}
              <SafetyBadge variant={meta.usesRealNetwork ? 'live' : 'simulated'} />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span id={wordsId} className="text-fg-muted text-caption">
                Words you&rsquo;ll meet:
              </span>
              <ul
                aria-labelledby={wordsId}
                className="flex flex-wrap items-center gap-1.5"
              >
                {meta.topics.map((topic) => {
                  const entry = glossary?.inlineTerm(topic);
                  return (
                    <li key={topic} className="inline-flex">
                      {entry ? (
                        <GlossaryTermButton
                          entry={entry}
                          className={cn(
                            CHIP,
                            'border-border bg-surface-overlay inline-flex items-center',
                          )}
                        >
                          {topic}
                        </GlossaryTermButton>
                      ) : (
                        <Badge tone="neutral" className={cn(CHIP, 'py-0')}>
                          {topic}
                        </Badge>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-col items-stretch gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">{children}</div>
        {/*
          `empty:hidden` so the layout is single-column until a module actually fills
          the slot — an always-present empty column would be dead space on every route
          that has no explanation panel yet.
        */}
        <aside className="shrink-0 empty:hidden lg:w-80 xl:w-96">{panel}</aside>
      </div>
    </div>
  );
}
