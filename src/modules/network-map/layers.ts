/**
 * The layer filter, as data.
 *
 * "Show me just layer 2" is a question about the *kinds* of machine on the diagram, and
 * the kind-to-layer mapping already exists once, in the visualization layer's
 * `nodes/kinds.ts` (a switch forwards frames at L2, a router routes packets at L3). This
 * file reads that table rather than restating it, so a new `NodeKind` cannot end up
 * filtered into the wrong layer.
 *
 * Pure functions over a `Topology`: no React, no classes, no colours. What the filter
 * does with the result -- dim, hide, colour -- is the component's business.
 */

import { nodeKindToken } from '@/components/viz';
import type { Topology } from '@/core/types/topology';
import { LAYER_KEYS, type LayerKey } from '@/lib/theme';

/** The OSI layer a machine does its work at. */
export function layerOf(kind: Parameters<typeof nodeKindToken>[0]): LayerKey {
  return nodeKindToken(kind).layer;
}

/**
 * The layers this scenario actually has machines at, in OSI order.
 *
 * The picker offers only these: a home LAN has no load balancer, and a filter button for
 * a layer that would dim the entire diagram teaches nothing.
 */
export function layersInTopology(topology: Topology): LayerKey[] {
  const present = new Set(topology.nodes.map((node) => layerOf(node.kind)));
  return LAYER_KEYS.filter((key) => present.has(key));
}

/**
 * The machines to push into the background so that `layer` stands out.
 *
 * `null` means no filter, which is an empty set rather than a special case -- callers
 * hand the result straight to `DimmedNodesContext` either way.
 */
export function dimmedForLayer(
  topology: Topology,
  layer: LayerKey | null,
): ReadonlySet<string> {
  if (!layer) return new Set();

  return new Set(
    topology.nodes.filter((node) => layerOf(node.kind) !== layer).map((node) => node.id),
  );
}

/** How many machines a layer has in this scenario, for the filter's counts. */
export function countAtLayer(topology: Topology, layer: LayerKey): number {
  return topology.nodes.filter((node) => layerOf(node.kind) === layer).length;
}
