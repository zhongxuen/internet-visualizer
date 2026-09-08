import Link from 'next/link';
import { Compass, HardHat } from 'lucide-react';
import type { Metadata } from 'next';

import { EmptyState } from '@/components/ui/EmptyState';
import { buttonClasses } from '@/components/ui/Button';
import { pageMetadata } from '@/lib/metadata';
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
 * Keeps the browser tab, the nav, the page heading, the canonical URL and the shared
 * link's unfurl all quoting the same two strings; the root layout's title template
 * appends the product name. `pageMetadata` supplies the rest of the shape so a module
 * route and a lesson route describe themselves identically.
 *
 * An unknown id still returns `{}` rather than throwing. The registry is the manifest
 * every route resolves itself against, and a page that named an id not in it has a
 * bigger problem than its `<title>` -- one that `tests/registry.test.ts` catches, and
 * that a build-time throw here would only obscure.
 */
export function moduleMetadata(moduleId: string): Metadata {
  const meta = getModule(moduleId);
  if (!meta) return {};

  return pageMetadata({
    title: meta.title,
    description: meta.summary,
    path: meta.route,
  });
}
