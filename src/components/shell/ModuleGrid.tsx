import { cn } from '@/lib/cn';
import {
  MODULES,
  modulesInChapter,
  type ModuleChapter,
  type ModuleMeta,
} from '@/modules/registry';

import { ModuleCard } from './ModuleCard';

export interface ModuleGridProps {
  /**
   * Show one chapter, in the chapter's own reading order (`MODULE_CHAPTERS`). Takes
   * precedence over `modules`.
   */
  chapter?: ModuleChapter;
  /** An explicit subset, for filtered views. Defaults to the whole registry. */
  modules?: readonly ModuleMeta[];
  /** Passed to every card. See `ModuleCardProps.headingLevel`. */
  headingLevel?: 3 | 4;
  className?: string;
}

/**
 * A list of module cards.
 *
 * Reads the registry directly, so adding an entry adds a card with no other edit: with
 * no props it is every module, and with a `chapter` it is that chapter's modules as the
 * registry orders them. No component in the shell holds a list of module ids.
 */
export function ModuleGrid({
  chapter,
  modules = MODULES,
  headingLevel,
  className,
}: ModuleGridProps) {
  const shown = chapter ? modulesInChapter(chapter) : modules;

  return (
    <ul
      className={cn(
        'grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-3',
        className,
      )}
    >
      {shown.map((module) => (
        <ModuleCard key={module.id} module={module} headingLevel={headingLevel} />
      ))}
    </ul>
  );
}
