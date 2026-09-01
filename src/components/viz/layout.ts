/**
 * Where each machine sits on the canvas.
 *
 * A `Topology` deliberately carries no coordinates — it is the network, not a picture of
 * one — so something has to place the nodes, and that something belongs on the
 * visualization side of the boundary rather than in `src/core`.
 *
 * The rule is breadth-first distance from the client: one column per hop, so the diagram
 * reads left to right in the order a packet actually visits things. That is the mental
 * model the whole product is teaching, and it falls out of the graph for free instead of
 * needing a hand-placed layout per scenario.
 *
 * Deterministic by construction: seeds are taken in `topology.nodes` order, neighbours in
 * `topology.links` order, so the same topology always produces the same picture. A module
 * that wants a specific arrangement passes its own `positions` to `SimulationCanvas` and
 * skips this entirely.
 */

import type { Topology } from '@/core/types/topology';

/** Canvas units. Nodes are a fixed width so columns line up and text wraps predictably. */
export const NODE_WIDTH = 232;

/**
 * Placeholder height used until the browser has measured a node. Only affects the first
 * frame — and it is what makes nodes render at all in a test environment, where nothing
 * is ever measured.
 */
export const NODE_HEIGHT = 124;

export interface XY {
  x: number;
  y: number;
}

export interface LayoutOptions {
  /** Horizontal distance between hops. */
  columnGap?: number;
  /** Vertical distance between machines that are the same number of hops out. */
  rowGap?: number;
}

/**
 * `columnGap` is deliberately more than `NODE_WIDTH`: the difference is the clear space a
 * link's label sits in, and a label that lands on top of a node is worse than a longer
 * diagram.
 */
const DEFAULTS = { columnGap: 360, rowGap: 170 } satisfies Required<LayoutOptions>;

/**
 * Order in which components are laid out: clients first, so the packet's origin lands in
 * column 0 and everything else is measured outward from it. Remaining nodes seed any
 * component the clients do not reach, in declaration order.
 */
function seedOrder(topology: Topology): string[] {
  const clients = topology.nodes.filter((node) => node.kind === 'client');
  return [...clients, ...topology.nodes].map((node) => node.id);
}

function buildAdjacency(topology: Topology): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const node of topology.nodes) adjacency.set(node.id, []);

  for (const link of topology.links) {
    // A link naming a node the topology does not declare is a broken scenario, not a
    // layout problem. Drop the whole link rather than invent a position for a phantom
    // -- half-adding it would put the phantom in a column and leave a hop dangling.
    const from = adjacency.get(link.from);
    const to = adjacency.get(link.to);
    if (!from || !to) continue;

    from.push(link.to);
    to.push(link.from);
  }

  return adjacency;
}

/**
 * Breadth-first columns, one per hop from the nearest client.
 *
 * Returns a position for every node in `topology.nodes` — including isolated ones, which
 * simply seed their own column 0 and stack below whatever is already there.
 */
export function layoutTopology(
  topology: Topology,
  options: LayoutOptions = {},
): Record<string, XY> {
  const { columnGap, rowGap } = { ...DEFAULTS, ...options };
  const adjacency = buildAdjacency(topology);

  const depths = new Map<string, number>();
  /** Node ids in visit order; ties inside a column resolve to this order. */
  const visited: string[] = [];

  for (const seed of seedOrder(topology)) {
    if (depths.has(seed)) continue;
    depths.set(seed, 0);

    const queue = [seed];
    // Index cursor rather than shift(): the queue is the whole component and shifting
    // it is quadratic on the larger topologies the Internet Simulator will build.
    for (let head = 0; head < queue.length; head += 1) {
      const id = queue[head];
      visited.push(id);

      for (const neighbour of adjacency.get(id) ?? []) {
        if (depths.has(neighbour)) continue;
        depths.set(neighbour, (depths.get(id) ?? 0) + 1);
        queue.push(neighbour);
      }
    }
  }

  const columns = new Map<number, string[]>();
  for (const id of visited) {
    const depth = depths.get(id) ?? 0;
    const column = columns.get(depth);
    if (column) column.push(id);
    else columns.set(depth, [id]);
  }

  const positions: Record<string, XY> = {};
  for (const [depth, ids] of columns) {
    ids.forEach((id, row) => {
      positions[id] = {
        x: depth * columnGap,
        // Centred on y = 0 so every column shares a horizontal axis regardless of how
        // many machines are in it.
        y: (row - (ids.length - 1) / 2) * rowGap,
      };
    });
  }

  return positions;
}
