/**
 * The module's scenario catalogue.
 *
 * The topologies themselves are checked in `src/core/topologies/__tests__`; what matters
 * here is only that the Network Map offers the four scenarios phase 05 says it does, in
 * the order that makes them build on each other, and that nothing has quietly become a
 * copy of the shared data.
 */

import { describe, expect, it } from 'vitest';

import { HOME_LAN as CORE_HOME_LAN, SCENARIO_TOPOLOGIES } from '@/core/topologies';

import {
  DATACENTER,
  DEFAULT_SCENARIO_ID,
  getNetworkMapScenario,
  HOME_LAN,
  ISP_PATH,
  NETWORK_MAP_SCENARIOS,
  SMALL_OFFICE,
} from './index';

describe('network map scenarios', () => {
  it('offers the four scenarios, smallest network first', () => {
    expect(NETWORK_MAP_SCENARIOS.map((scenario) => scenario.id)).toEqual([
      'home-lan',
      'small-office',
      'isp-path',
      'datacenter',
    ]);
  });

  it('reuses the shared topologies rather than copying them', () => {
    expect(HOME_LAN).toBe(CORE_HOME_LAN);
    expect([HOME_LAN, SMALL_OFFICE, ISP_PATH, DATACENTER]).toEqual([
      ...SCENARIO_TOPOLOGIES,
    ]);
  });

  it('opens on a scenario it actually offers', () => {
    expect(getNetworkMapScenario(DEFAULT_SCENARIO_ID)).toBe(HOME_LAN);
  });

  it('returns undefined for a scenario it does not offer', () => {
    expect(getNetworkMapScenario('dns-hierarchy')).toBeUndefined();
  });
});
