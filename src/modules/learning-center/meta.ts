/**
 * The Learning Center's registry identity.
 *
 * `src/modules/registry.ts` is the single manifest -- title, route, topics, status and
 * the `usesRealNetwork` flag all live there, and this module never restates any of them.
 * What this file adds is the id as a constant and a typed accessor, so nothing inside
 * the module has to spell `'learning-center'` again and a rename is one edit.
 */

import { getModule, type ModuleMeta } from '@/modules/registry';

/** This module's registry id. */
export const LEARNING_CENTER_ID = 'learning-center';

/**
 * This module's registry entry.
 *
 * `undefined` is unreachable while the entry exists; callers that only want copy should
 * fall back rather than assert, because a missing entry is a registry bug and not a
 * state worth crashing a page over.
 */
export function learningCenterMeta(): ModuleMeta | undefined {
  return getModule(LEARNING_CENTER_ID);
}

/**
 * Where the Learning Center lives.
 *
 * Read from the registry rather than written down, so the route and the nav entry that
 * points at it cannot drift. Every link this module builds is this string plus a
 * suffix -- see `lessonHref` and `glossaryHref` in `content/lessons.ts`.
 */
export function learningCenterRoute(): string {
  return learningCenterMeta()?.route ?? '/learn';
}
