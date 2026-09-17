import { describe, expect, it } from 'vitest';

import { topologyProblems } from '@/core/sim/topology';
import type { Topology } from '@/core/types/topology';
import {
  DIAGNOSTIC_PATHS,
  LOOKUP_EXAMPLES,
  REGISTRATION_RECORDS,
  runLookup,
  runPing,
  runRegistrationLookup,
  runTraceroute,
} from '@/modules/network-diagnostics';
import {
  EMBEDDABLE_MODULE_IDS,
  loadEmbeddableScenarios,
  type EmbeddableScenario,
} from '@/modules/scenarios';

/**
 * Every topology the product draws keeps the `Topology` invariant: links name real
 * nodes, nodes name real zones, ids are unique.
 *
 * Zones arrive module by module (docs/implementation/uiux.md, waves 2 and 3), and a
 * node pointing at a zone that is not there would simply draw outside any place, with
 * no error anywhere. One sweep here covers every module's topologies without each module
 * restating the rule, and it finds scenarios the same way `determinism.test.ts` does: through
 * the `scenarios.ts` manifest, so a new scenario is covered with no edit to this file.
 * Network Diagnostics has no catalogue there, so its four tools are crossed with their
 * fixtures by hand, as in the determinism guard.
 */

const CATALOGUES = await Promise.all(
  EMBEDDABLE_MODULE_IDS.map(
    async (moduleId) =>
      [moduleId, (await loadEmbeddableScenarios(moduleId)) ?? []] as const,
  ),
);

function expectSound(label: string, topology: Topology) {
  expect(topology.nodes.length, `${label} has no nodes`).toBeGreaterThan(0);
  expect(topologyProblems(topology), label).toEqual([]);
}

describe('every module scenario draws a sound topology', () => {
  for (const [moduleId, scenarios] of CATALOGUES) {
    describe(moduleId, () => {
      for (const scenario of scenarios as readonly EmbeddableScenario[]) {
        it(scenario.id, () => {
          expectSound(`${moduleId}/${scenario.id}`, scenario.run().topology);
        });
      }
    });
  }
});

describe('every network-diagnostics Learn-mode run draws a sound topology', () => {
  for (const path of DIAGNOSTIC_PATHS) {
    it(`ping and traceroute over ${path.id}`, () => {
      expectSound(`ping/${path.id}`, runPing(path).topology);
      expectSound(`traceroute/${path.id}`, runTraceroute(path).topology);
    });
  }

  it('every lookup and registration fixture', () => {
    for (const example of LOOKUP_EXAMPLES) {
      expectSound(`lookup/${example.name}/${example.type}`, runLookup(example).topology);
    }
    for (const record of REGISTRATION_RECORDS) {
      expectSound(`rdap/${record.id}`, runRegistrationLookup(record).topology);
    }
  });
});
