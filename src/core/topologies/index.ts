/**
 * The shared scenario topologies.
 *
 * Import from here rather than from the individual files, so a scenario can be renamed
 * or split without touching the modules that draw it.
 */

export * from './types';

export { HOME_LAN } from './homeLan';
export { SMALL_OFFICE } from './smallOffice';
export { ISP_PATH } from './ispPath';
export { DATACENTER } from './datacenter';

import { DATACENTER } from './datacenter';
import { HOME_LAN } from './homeLan';
import { ISP_PATH } from './ispPath';
import { SMALL_OFFICE } from './smallOffice';
import type { ScenarioTopology } from './types';

/**
 * Every scenario, ordered smallest to largest -- which is also the order they build on
 * each other. A module is free to offer a subset, but not to reorder these arbitrarily:
 * the small office assumes the home LAN has been understood, and so on down the list.
 */
export const SCENARIO_TOPOLOGIES: readonly ScenarioTopology[] = [
  HOME_LAN,
  SMALL_OFFICE,
  ISP_PATH,
  DATACENTER,
];

/** Look up a scenario by its id. */
export function getScenarioTopology(id: string): ScenarioTopology | undefined {
  return SCENARIO_TOPOLOGIES.find((scenario) => scenario.id === id);
}
