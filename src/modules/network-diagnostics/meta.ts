/**
 * Network Diagnostics' registry identity.
 *
 * `src/modules/registry.ts` is the single manifest -- title, route, topics, status, and the
 * `usesRealNetwork` flag all live there, and this module never restates any of them. What this
 * file adds is the id as a constant and a typed accessor, so nothing inside the module has to
 * spell `'network-diagnostics'` again and a rename is one edit.
 *
 * This is the one module the registry will ever allow `usesRealNetwork: true` on, and phase
 * 12 set it: the three Route Handlers exist and Live mode can reach them. The flag is a
 * statement about *capability*, which is what the home page's card and the nav need. What
 * the module is doing at any moment is a different question, and it is answered by the
 * badge inside `ModeSwitch` -- `simulated` in Learn mode, `live` in Live mode -- and by the
 * second `live` badge on the console itself. Keeping those two apart is the point: a page
 * that could reach a network is not the same claim as a control that is about to.
 */

import { getModule, type ModuleMeta } from '@/modules/registry';

/** This module's registry id. */
export const NETWORK_DIAGNOSTICS_ID = 'network-diagnostics';

/**
 * This module's registry entry.
 *
 * `undefined` is unreachable while the entry exists; callers that only want copy should fall
 * back rather than assert, because a missing entry is a registry bug and not a state worth
 * crashing a page over.
 */
export function networkDiagnosticsMeta(): ModuleMeta | undefined {
  return getModule(NETWORK_DIAGNOSTICS_ID);
}
