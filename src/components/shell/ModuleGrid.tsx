import { cn } from '@/lib/cn';
import { MODULES, type ModuleMeta } from '@/modules/registry';

import { ModuleCard } from './ModuleCard';

export interface ModuleGridProps {
  /** Defaults to the whole registry — the home page passes nothing. */
  modules?: readonly ModuleMeta[];
  className?: string;
}

/**
 * The module explorer grid.
 *
 * Reads `MODULES` directly so adding a registry entry adds a card with no other edit.
 * The `modules` prop exists for filtered views (a group page, search results), not for
 * hand-assembling a list.
 */
export function ModuleGrid({ modules = MODULES, className }: ModuleGridProps) {
  return (
    <ul
      className={cn(
        'grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-3',
        className,
      )}
    >
      {modules.map((module) => (
        <ModuleCard key={module.id} module={module} />
      ))}
    </ul>
  );
}
