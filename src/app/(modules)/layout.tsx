import type { ReactNode } from 'react';

import { ModuleChrome } from '@/components/shell';

/**
 * Shared chrome for every module route.
 *
 * The frame lives in `ModuleChrome`, which resolves the module from the URL against
 * the registry — so a module page only ever renders its own content. Back link,
 * title, topic badges and safety badge are not a module's to draw.
 *
 * `panel` is a parallel route (`@panel/`): a module fills the right-hand explanation
 * slot by adding `@panel/<route>/page.tsx`, and the column collapses when it has not.
 * Props are typed by hand rather than with the generated `LayoutProps`, because this
 * layout sits in a route group and shares its path with the root layout.
 */
export default function ModulesLayout({
  children,
  panel,
}: {
  children: ReactNode;
  panel: ReactNode;
}) {
  return <ModuleChrome panel={panel}>{children}</ModuleChrome>;
}
