'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/Badge';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';
import { getModuleByRoute, type ModuleStatus } from '@/modules/registry';

import { SafetyBadge } from './SafetyBadge';

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

export interface ModuleChromeProps {
  children: ReactNode;
  /**
   * The explanation panel, filled by the `@panel` parallel route. Collapses to nothing
   * when a module has not supplied one.
   */
  panel?: ReactNode;
}

/**
 * The frame every module route wears: back link, title, topic badges, safety badge,
 * and the right-hand slot for the explanation panel. Modules supply content, never
 * chrome — nothing below is a module's to re-declare or restyle.
 *
 * The module is resolved from the URL rather than passed in, so a module route can
 * stay a server component with no metadata plumbing, and so this cannot silently
 * disagree with the registry the nav and home page read.
 */
export function ModuleChrome({ children, panel }: ModuleChromeProps) {
  const pathname = usePathname() ?? '';
  const meta = getModuleByRoute(pathname);

  // A route under (modules) with no registry entry is a bug, not a state to design
  // for. Render the content bare rather than inventing a title for it.
  if (!meta) return <>{children}</>;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <Link
        href="/"
        className={cn(
          'text-fg-muted hover:text-fg -ml-1 inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-sm transition-colors',
          focusRing,
        )}
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        All modules
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          {/* The one h1 on a module page. Modules must not add another. */}
          <h1 className="text-fg text-2xl font-semibold tracking-tight sm:text-3xl">
            {meta.title}
          </h1>
          <p className="text-fg-muted mt-2 max-w-2xl text-sm leading-relaxed">
            {meta.summary}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <SafetyBadge variant={meta.usesRealNetwork ? 'live' : 'simulated'} />
          <Badge tone={STATUS_TONE[meta.status]}>{STATUS_LABEL[meta.status]}</Badge>
        </div>
      </div>

      <ul className="mt-4 flex flex-wrap items-center gap-1.5" aria-label="Topics">
        {meta.topics.map((topic) => (
          <li key={topic}>
            <Badge tone="neutral">{topic}</Badge>
          </li>
        ))}
      </ul>

      <div className="mt-8 flex flex-col items-stretch gap-6 lg:flex-row lg:items-start">
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
