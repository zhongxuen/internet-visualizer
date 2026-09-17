/**
 * The structural invariant every `Topology` promises, as one checkable function.
 *
 * `Topology`'s doc comment states it: links name real nodes, nodes name real zones, and
 * ids are unique within their own collection. Before zones there was no runtime check at
 * all -- each module's tests re-asserted the link half by hand. Zones add a second kind
 * of reference that can dangle, and ten module passes will be adding them in parallel
 * (docs/implementation/uiux.md, wave 3), so the rule lives here once and
 * `tests/topologies.test.ts` runs it over every topology in the codebase.
 *
 * Returns problems rather than throwing, so a test can print all of them at once and
 * a renderer that ever wants to degrade can ask without a try/catch.
 */

import type { Topology } from '../types/topology';

function duplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) repeated.add(id);
    seen.add(id);
  }
  return [...repeated];
}

/** Every way `topology` breaks its invariant, one sentence each. Empty means sound. */
export function topologyProblems(topology: Topology): string[] {
  const problems: string[] = [];
  const zones = topology.zones ?? [];

  for (const id of duplicates(topology.nodes.map((node) => node.id))) {
    problems.push(`node id "${id}" is used more than once`);
  }
  for (const id of duplicates(topology.links.map((link) => link.id))) {
    problems.push(`link id "${id}" is used more than once`);
  }
  for (const id of duplicates(zones.map((zone) => zone.id))) {
    problems.push(`zone id "${id}" is used more than once`);
  }

  const nodeIds = new Set(topology.nodes.map((node) => node.id));
  for (const link of topology.links) {
    for (const end of [link.from, link.to]) {
      if (!nodeIds.has(end))
        problems.push(`link "${link.id}" names unknown node "${end}"`);
    }
  }

  const zoneIds = new Set(zones.map((zone) => zone.id));
  for (const node of topology.nodes) {
    if (node.zone !== undefined && !zoneIds.has(node.zone)) {
      problems.push(`node "${node.id}" is in unknown zone "${node.zone}"`);
    }
  }

  return problems;
}
