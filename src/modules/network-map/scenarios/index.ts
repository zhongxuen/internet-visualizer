/**
 * The Network Map's scenario catalogue.
 *
 * The four networks the module offers, in the order they build on each other. The
 * scenario picker, the guided tour, and the route all read this list; nothing else
 * hardcodes a scenario id.
 */

import type { ScenarioTopology } from '@/core/topologies';

import { DATACENTER } from './datacenter';
import { HOME_LAN } from './home-lan';
import { ISP_PATH } from './isp-path';
import { SMALL_OFFICE } from './small-office';

export { HOME_LAN, SMALL_OFFICE, ISP_PATH, DATACENTER };

/** The ids this module knows about, so a route param can be narrowed to one of them. */
export type NetworkMapScenarioId =
  'home-lan' | 'small-office' | 'isp-path' | 'datacenter';

/**
 * Smallest network first. Each scenario assumes the one before it has been understood --
 * the small office is the home LAN segmented, and the ISP path starts where the home LAN
 * ends -- so this order is the lesson, not a preference.
 */
export const NETWORK_MAP_SCENARIOS: readonly ScenarioTopology[] = [
  HOME_LAN,
  SMALL_OFFICE,
  ISP_PATH,
  DATACENTER,
];

/** The scenario the module opens on. */
export const DEFAULT_SCENARIO_ID: NetworkMapScenarioId = 'home-lan';

/** Look up a scenario by id; `undefined` for anything this module does not offer. */
export function getNetworkMapScenario(id: string): ScenarioTopology | undefined {
  return NETWORK_MAP_SCENARIOS.find((scenario) => scenario.id === id);
}
