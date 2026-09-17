/**
 * Where each machine sits on the canvas, and how the camera frames it.
 *
 * A `Topology` deliberately carries no coordinates — it is the network, not a picture of
 * one — so something has to place the nodes, and that something belongs on the
 * visualization side of the boundary rather than in `src/core`.
 *
 * ## Places first, then hops
 *
 * The rule under everything is breadth-first distance from the client: one column per
 * hop, so the diagram reads left to right in the order a packet actually visits things.
 * That is the mental model the whole product is teaching, and it falls out of the graph
 * for free instead of needing a hand-placed layout per scenario.
 *
 * A topology with `zones` is laid out by place first (docs/implementation/uiux-spec.md
 * §5.4). Each zone is one block, the blocks run left to right in the order
 * `Topology.zones` declares them, and inside a block the machines keep their hop columns.
 * A block with more than {@link LayoutOptions.maxZoneColumns} columns wraps onto a second
 * row, the way a line of text does -- so a long path is a few readable blocks rather
 * than one line thousands of units wide. Machines with no zone, or naming one the
 * topology does not declare, form one last block of their own.
 *
 * A topology without zones draws exactly as it always has: one row of hop columns.
 *
 * Deterministic by construction: seeds are taken in `topology.nodes` order, neighbours in
 * `topology.links` order, so the same topology always produces the same picture. A module
 * that wants a specific arrangement passes its own `positions` to `SimulationCanvas` and
 * skips this entirely.
 *
 * ## Framing
 *
 * The rest of the file is the camera's arithmetic, kept here so it is plain data in and
 * data out: the boxes a zone backdrop draws around its machines, and the viewport that
 * frames a rectangle without ever zooming out past the point where a label is readable.
 * `SimulationCanvas` owns *when* the camera moves; this owns *where to*.
 */

import type { Topology, TopologyZone } from '@/core/types/topology';

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

/** An axis-aligned box: top-left corner and size, in flow units unless stated. */
export interface Rect extends XY {
  width: number;
  height: number;
}

export interface LayoutOptions {
  /** Horizontal distance between hops. */
  columnGap?: number;
  /** Vertical distance between machines that are the same number of hops out. */
  rowGap?: number;
  /** Extra horizontal distance between two zones, on top of `columnGap`. */
  zoneGap?: number;
  /** Vertical clear space between the two rows of a wrapped zone. */
  zoneRowGap?: number;
  /** The most hop columns a zone lays out in one row before it wraps onto a second. */
  maxZoneColumns?: number;
}

/**
 * `columnGap` is deliberately more than `NODE_WIDTH`: the difference is the clear space a
 * link's label sits in, and a label that lands on top of a node is worse than a longer
 * diagram. `zoneGap` is the room two zone backdrops and their padding need between them.
 */
const DEFAULTS = {
  columnGap: 360,
  rowGap: 170,
  zoneGap: 120,
  zoneRowGap: 150,
  maxZoneColumns: 3,
} satisfies Required<LayoutOptions>;

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

/** Hops from the nearest client per node id, and the ids in the order they were reached. */
function hops(topology: Topology): { depths: Map<string, number>; visited: string[] } {
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

  return { depths, visited };
}

/** `ids` grouped into columns by depth, shallowest first, each column in visit order. */
function columnsOf(ids: readonly string[], depths: Map<string, number>): string[][] {
  const byDepth = new Map<number, string[]>();
  for (const id of ids) {
    const depth = depths.get(id) ?? 0;
    const column = byDepth.get(depth);
    if (column) column.push(id);
    else byDepth.set(depth, [id]);
  }
  return [...byDepth.entries()].sort(([a], [b]) => a - b).map(([, column]) => column);
}

/** Places a column's machines on either side of `centreY`. */
function placeColumn(
  positions: Record<string, XY>,
  ids: readonly string[],
  x: number,
  centreY: number,
  rowGap: number,
): void {
  ids.forEach((id, row) => {
    positions[id] = { x, y: centreY + (row - (ids.length - 1) / 2) * rowGap };
  });
}

/**
 * Breadth-first columns, one per hop from the nearest client -- grouped into zones when
 * the topology has them.
 *
 * Returns a position (a node's centre) for every node in `topology.nodes` — including
 * isolated ones, which simply seed their own column 0 and stack below whatever is
 * already there.
 */
export function layoutTopology(
  topology: Topology,
  options: LayoutOptions = {},
): Record<string, XY> {
  const settings = { ...DEFAULTS, ...options };
  const { columnGap, rowGap } = settings;
  const { depths, visited } = hops(topology);
  const positions: Record<string, XY> = {};

  if (!topology.zones?.length) {
    // Centred on y = 0 so every column shares a horizontal axis regardless of how many
    // machines are in it.
    for (const ids of columnsOf(visited, depths)) {
      placeColumn(positions, ids, (depths.get(ids[0]) ?? 0) * columnGap, 0, rowGap);
    }
    return positions;
  }

  let left = 0;
  for (const members of zoneGroups(topology, visited)) {
    left = placeZone(positions, columnsOf(members, depths), left, settings);
  }
  return positions;
}

/** Visited ids per zone, in zone order, with the unzoned (if any) as a last group. */
function zoneGroups(topology: Topology, visited: readonly string[]): string[][] {
  const zoneOf = new Map(topology.nodes.map((node) => [node.id, node.zone]));
  const declared = new Set((topology.zones ?? []).map((zone) => zone.id));
  const groups = (topology.zones ?? []).map((zone) =>
    visited.filter((id) => zoneOf.get(id) === zone.id),
  );
  const unzoned = visited.filter((id) => {
    const zone = zoneOf.get(id);
    return zone === undefined || !declared.has(zone);
  });
  return [...groups, unzoned].filter((group) => group.length > 0);
}

/**
 * Lays one zone's columns out from `left`, wrapping onto a second row when it has too
 * many, and returns where the next zone starts. The block is centred on y = 0.
 */
function placeZone(
  positions: Record<string, XY>,
  columns: readonly string[][],
  left: number,
  { columnGap, rowGap, zoneGap, zoneRowGap, maxZoneColumns }: Required<LayoutOptions>,
): number {
  const wraps = columns.length > maxZoneColumns;
  const perRow = wraps ? Math.ceil(columns.length / 2) : columns.length;
  const rows = wraps ? [columns.slice(0, perRow), columns.slice(perRow)] : [columns];

  // A row is as tall as its tallest column; two rows stack with clear space between.
  const heights = rows.map(
    (row) => (Math.max(...row.map((column) => column.length)) - 1) * rowGap + NODE_HEIGHT,
  );
  const total =
    heights.reduce((sum, height) => sum + height, 0) + zoneRowGap * (rows.length - 1);

  let top = -total / 2;
  rows.forEach((row, index) => {
    const centreY = top + heights[index] / 2;
    row.forEach((ids, column) => {
      placeColumn(positions, ids, left + column * columnGap, centreY, rowGap);
    });
    top += heights[index] + zoneRowGap;
  });

  return left + perRow * columnGap + zoneGap;
}

// ---------------------------------------------------------------------------
// Zone backdrops
// ---------------------------------------------------------------------------

/**
 * How far a zone's backdrop reaches past its machines, in flow units. The top is deeper
 * because the zone's name and icon sit there, above the first row of machines.
 */
export const ZONE_PADDING = { x: 36, top: 76, bottom: 32 } as const;

export interface ZoneRect extends Rect {
  zone: TopologyZone;
}

/**
 * The backdrop for every zone that has at least one machine with a known box.
 *
 * `boxes` are node boxes by id (top-left corner and measured size), which is what React
 * Flow knows after it has measured the cards -- so a backdrop fits the cards as drawn,
 * whatever the detail level made them.
 */
export function zoneRects(
  topology: Topology,
  boxes: ReadonlyMap<string, Rect>,
): ZoneRect[] {
  const rects: ZoneRect[] = [];
  for (const zone of topology.zones ?? []) {
    const members = topology.nodes
      .filter((node) => node.zone === zone.id)
      .map((node) => boxes.get(node.id))
      .filter((box): box is Rect => box !== undefined);
    const bounds = boundsOf(members);
    if (!bounds) continue;
    rects.push({
      zone,
      x: bounds.x - ZONE_PADDING.x,
      y: bounds.y - ZONE_PADDING.top,
      width: bounds.width + ZONE_PADDING.x * 2,
      height: bounds.height + ZONE_PADDING.top + ZONE_PADDING.bottom,
    });
  }
  return rects;
}

/** The smallest box around every rect, or `null` for none. */
export function boundsOf(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// ---------------------------------------------------------------------------
// Framing
// ---------------------------------------------------------------------------

/** The smallest a node's name may render, in CSS pixels (uiux-spec.md §10). */
export const READABLE_LABEL_PX = 12;

/**
 * The lowest zoom at which a label drawn at `labelPx` still renders at
 * {@link READABLE_LABEL_PX} or more. A hair above the exact ratio, so rounding in the
 * zoom transition can never land a label at 11.99px.
 */
export function readableZoom(labelPx: number): number {
  return (READABLE_LABEL_PX / labelPx) * 1.005;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface FrameOptions {
  minZoom: number;
  maxZoom: number;
  /** Clear space kept around the framed box, in screen pixels. */
  padding: number;
}

/** The zoom at which `rect` exactly fills a `width` x `height` screen, less padding. */
export function fitZoom(
  rect: Rect,
  width: number,
  height: number,
  padding: number,
): number {
  const w = Math.max(width - padding * 2, 1);
  const h = Math.max(height - padding * 2, 1);
  return Math.min(w / Math.max(rect.width, 1), h / Math.max(rect.height, 1));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * The viewport that centres `rect` on screen, as large as fits between `minZoom` and
 * `maxZoom`. When even `minZoom` is too close for the whole box, the centre of the box
 * is on screen and its edges are not -- which is the trade this product makes: a
 * readable part over an unreadable whole.
 */
export function frameRect(
  rect: Rect,
  width: number,
  height: number,
  { minZoom, maxZoom, padding }: FrameOptions,
): Viewport {
  const zoom = clamp(fitZoom(rect, width, height, padding), minZoom, maxZoom);
  return {
    x: width / 2 - (rect.x + rect.width / 2) * zoom,
    y: height / 2 - (rect.y + rect.height / 2) * zoom,
    zoom,
  };
}

/**
 * Like {@link frameRect}, but when the box is too wide to fit readably its *left* edge
 * is kept on screen rather than its centre: the start of a diagram is where a packet's
 * story starts, so that is the part worth showing.
 */
export function frameStart(
  rect: Rect,
  width: number,
  height: number,
  options: FrameOptions,
): Viewport {
  const framed = frameRect(rect, width, height, options);
  if (rect.width * framed.zoom <= width - options.padding * 2) return framed;
  return { ...framed, x: options.padding - rect.x * framed.zoom };
}

/** Whether `rect` is wholly on a screen showing `viewport`, with `padding` to spare. */
export function isInView(
  rect: Rect,
  viewport: Viewport,
  width: number,
  height: number,
  padding: number,
): boolean {
  const left = rect.x * viewport.zoom + viewport.x;
  const top = rect.y * viewport.zoom + viewport.y;
  const right = left + rect.width * viewport.zoom;
  const bottom = top + rect.height * viewport.zoom;
  return (
    left >= padding &&
    top >= padding &&
    right <= width - padding &&
    bottom <= height - padding
  );
}
