import Link from 'next/link';
import { Compass, HardHat } from 'lucide-react';
import type { Metadata } from 'next';

import { EmptyState } from '@/components/ui/EmptyState';
import { buttonClasses } from '@/components/ui/Button';
import { getModule } from '@/modules/registry';

/**
 * What a module route renders until its own phase builds it.
 *
 * Every module is registered before it is implemented, so the shell, the nav, and the
 * home page are all real from day one and each later phase only has to replace this
 * one component with the module's composition root. It exists so a `planned` card
 * still leads somewhere honest rather than to a 404.
 */
export interface PlannedModuleProps {
  /** Registry id. The copy comes from the entry, so it cannot drift. */
  moduleId: string;
}

export function PlannedModule({ moduleId }: PlannedModuleProps) {
  const meta = getModule(moduleId);

  return (
    <EmptyState
      icon={<HardHat aria-hidden="true" className="size-7" />}
      title={`${meta?.title ?? 'This module'} is not built yet`}
      description={
        <>
          It is registered, so navigation and the Learning Center already know about it
          &mdash; the simulation itself arrives in a later phase. Nothing here has ever
          touched a real network.
        </>
      }
      action={
        <Link href="/" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
          <Compass aria-hidden="true" className="mr-2 size-4" />
          Browse the other modules
        </Link>
      }
      className="min-h-[24rem]"
    />
  );
}

/**
 * Page metadata for a module route, read from its registry entry.
 *
 * Keeps the browser tab, the nav, and the page heading quoting the same string; the
 * root layout's title template appends the product name.
 */
export function moduleMetadata(moduleId: string): Metadata {
  const meta = getModule(moduleId);
  if (!meta) return {};

  return { title: meta.title, description: meta.summary };
}
