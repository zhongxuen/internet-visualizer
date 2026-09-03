/**
 * HTTP Explorer's registry identity.
 *
 * `src/modules/registry.ts` is the single manifest -- title, route, topics, status, and
 * the `usesRealNetwork` flag all live there, and this module never restates any of them.
 * What this file adds is the id as a constant and a typed accessor, so nothing inside the
 * module has to spell `'http-explorer'` again and a rename is one edit.
 */

import { getModule, type ModuleMeta } from '@/modules/registry';

/** This module's registry id. */
export const HTTP_EXPLORER_ID = 'http-explorer';

/**
 * This module's registry entry.
 *
 * `undefined` is unreachable while the entry exists; callers that only want copy should
 * fall back rather than assert, because a missing entry is a registry bug and not a state
 * worth crashing a page over.
 */
export function httpExplorerMeta(): ModuleMeta | undefined {
  return getModule(HTTP_EXPLORER_ID);
}
