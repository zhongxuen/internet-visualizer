import { describe, expect, it } from 'vitest';

import { HOME_LAN, ISP_PATH, SCENARIO_TOPOLOGIES } from '@/core/topologies';
import type { SimLink, SimNode, Topology } from '@/core/types/topology';

import {
  boundsOf,
  fitZoom,
  frameRect,
  frameStart,
  isInView,
  layoutTopology,
  NODE_HEIGHT,
  NODE_WIDTH,
  READABLE_LABEL_PX,
  readableZoom,
  ZONE_PADDING,
  zoneRects,
  type Rect,
} from './layout';

function node(id: string, kind: SimNode['kind'] = 'router'): SimNode {
  return { id, kind, label: id };
}

function link(id: string, from: string, to: string): SimLink {
  return { id, from, to, latencyMs: 1 };
}

/** client -- router -- server, with a second server hanging off the same router. */
const CHAIN: Topology = {
  nodes: [
    node('client', 'client'),
    node('router'),
    node('server-a', 'server'),
    node('server-b', 'server'),
  ],
  links: [
    link('l1', 'client', 'router'),
    link('l2', 'router', 'server-a'),
    link('l3', 'router', 'server-b'),
  ],
};

describe('layoutTopology', () => {
  it('puts one column per hop from the client, in packet order', () => {
    const positions = layoutTopology(CHAIN, { columnGap: 100, rowGap: 50 });

    expect(positions.client.x).toBe(0);
    expect(positions.router.x).toBe(100);
    expect(positions['server-a'].x).toBe(200);
    expect(positions['server-b'].x).toBe(200);
  });

  it('starts from the client even when it is not declared first', () => {
    const reordered: Topology = { ...CHAIN, nodes: [...CHAIN.nodes].reverse() };
    const positions = layoutTopology(reordered, { columnGap: 100, rowGap: 50 });

    expect(positions.client.x).toBe(0);
    expect(positions['server-a'].x).toBe(200);
  });

  it('centres each column on the same horizontal axis', () => {
    const positions = layoutTopology(CHAIN, { columnGap: 100, rowGap: 50 });

    // One node in its column sits on the axis; two straddle it.
    expect(positions.client.y).toBe(0);
    expect(positions.router.y).toBe(0);
    expect(positions['server-a'].y).toBe(-25);
    expect(positions['server-b'].y).toBe(25);
  });

  it('places every node, including one nothing links to', () => {
    const withIsland: Topology = {
      nodes: [...CHAIN.nodes, node('island', 'firewall')],
      links: CHAIN.links,
    };
    const positions = layoutTopology(withIsland, { columnGap: 100, rowGap: 50 });

    expect(Object.keys(positions)).toHaveLength(5);
    // Its own component, so it seeds column 0 and stacks under the client.
    expect(positions.island.x).toBe(0);
    expect(positions.island.y).not.toBe(positions.client.y);
  });

  it('is deterministic -- the same topology always draws the same picture', () => {
    expect(layoutTopology(CHAIN)).toEqual(layoutTopology(CHAIN));
  });

  it('ignores a link naming a node that is not in the topology', () => {
    const dangling: Topology = {
      nodes: [node('client', 'client'), node('router')],
      links: [link('l1', 'client', 'router'), link('l2', 'router', 'ghost')],
    };

    expect(Object.keys(layoutTopology(dangling)).sort()).toEqual(['client', 'router']);
  });
});

/** Every node's box at its laid-out centre, sized as the placeholder card. */
function boxesOf(positions: Record<string, { x: number; y: number }>): Map<string, Rect> {
  return new Map(
    Object.entries(positions).map(([id, { x, y }]) => [
      id,
      {
        x: x - NODE_WIDTH / 2,
        y: y - NODE_HEIGHT / 2,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      },
    ]),
  );
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

function widthOf(positions: Record<string, { x: number }>): number {
  const xs = Object.values(positions).map((position) => position.x);
  return Math.max(...xs) - Math.min(...xs);
}

describe('layoutTopology with zones', () => {
  /** Two places: a house with a three-hop chain, then the provider. */
  const ZONED: Topology = {
    zones: [
      { id: 'home', label: 'Your home', kind: 'home' },
      { id: 'isp', label: 'Internet provider (ISP)', kind: 'isp' },
    ],
    nodes: [
      { ...node('client', 'client'), zone: 'home' },
      { ...node('ap', 'switch'), zone: 'home' },
      { ...node('router'), zone: 'home' },
      { ...node('gateway'), zone: 'isp' },
    ],
    links: [
      link('l1', 'client', 'ap'),
      link('l2', 'ap', 'router'),
      link('l3', 'router', 'gateway'),
    ],
  };

  it('lays zones out left to right in the order the topology declares them', () => {
    const positions = layoutTopology(ZONED, { columnGap: 100, zoneGap: 50 });
    expect(positions.client.x).toBe(0);
    expect(positions.ap.x).toBe(100);
    expect(positions.router.x).toBe(200);
    // The next zone starts a column and a gap past the last column of the first.
    expect(positions.gateway.x).toBe(350);
  });

  it('follows the declared zone order, not the order the hops reach them', () => {
    const reordered: Topology = { ...ZONED, zones: [...ZONED.zones!].reverse() };
    const positions = layoutTopology(reordered, { columnGap: 100, zoneGap: 50 });
    expect(positions.gateway.x).toBe(0);
    expect(positions.client.x).toBe(150);
  });

  it('wraps a zone with too many hop columns onto a second row', () => {
    const chain = ['a', 'b', 'c', 'd', 'e'];
    const long: Topology = {
      zones: [{ id: 'z', label: 'Somewhere', kind: 'internet' }],
      nodes: chain.map((id, index) => ({
        ...node(id, index === 0 ? 'client' : 'router'),
        zone: 'z',
      })),
      links: chain.slice(1).map((id, index) => link(`l${index}`, chain[index], id)),
    };
    const positions = layoutTopology(long, { columnGap: 100, maxZoneColumns: 3 });

    // Five columns become rows of three and two, read like lines of text.
    expect([positions.a.x, positions.b.x, positions.c.x]).toEqual([0, 100, 200]);
    expect([positions.d.x, positions.e.x]).toEqual([0, 100]);
    expect(positions.a.y).toBe(positions.c.y);
    expect(positions.d.y).toBeGreaterThan(positions.a.y);
    // The block stays centred on the shared axis.
    expect(positions.a.y + positions.d.y).toBe(0);
  });

  it('puts machines with no zone, or an unknown one, in a last block of their own', () => {
    const stray: Topology = {
      ...ZONED,
      nodes: [...ZONED.nodes, { ...node('lost', 'server'), zone: 'nowhere' }],
      links: [...ZONED.links, link('l4', 'gateway', 'lost')],
    };
    const positions = layoutTopology(stray, { columnGap: 100, zoneGap: 50 });
    expect(positions.lost.x).toBeGreaterThan(positions.gateway.x);
  });

  it('draws a topology without zones exactly as before', () => {
    const bare = { ...ZONED, zones: undefined };
    expect(layoutTopology(bare, { columnGap: 100 })).toEqual({
      client: { x: 0, y: 0 },
      ap: { x: 100, y: 0 },
      router: { x: 200, y: 0 },
      gateway: { x: 300, y: 0 },
    });
  });

  it.each(SCENARIO_TOPOLOGIES.map((scenario) => [scenario.id, scenario] as const))(
    '%s: no machine sits on another, and no two places overlap',
    (_id, scenario) => {
      const boxes = boxesOf(layoutTopology(scenario.topology));
      const cards = [...boxes.values()];
      for (let i = 0; i < cards.length; i += 1) {
        for (let j = i + 1; j < cards.length; j += 1) {
          expect(overlaps(cards[i], cards[j])).toBe(false);
        }
      }

      const zones = zoneRects(scenario.topology, boxes);
      expect(zones).toHaveLength(scenario.topology.zones!.length);
      for (let i = 0; i < zones.length; i += 1) {
        for (let j = i + 1; j < zones.length; j += 1) {
          expect(
            overlaps(zones[i], zones[j]),
            `${zones[i].zone.id} and ${zones[j].zone.id}`,
          ).toBe(false);
        }
      }
    },
  );

  it('makes a long house a shape rather than a line', () => {
    const wrapped = layoutTopology(HOME_LAN.topology);
    const flat = layoutTopology({ ...HOME_LAN.topology, zones: undefined });
    expect(widthOf(wrapped)).toBeLessThan(widthOf(flat));

    // Grouping by place costs at most the gaps between the places.
    const path = ISP_PATH.topology;
    expect(widthOf(layoutTopology(path))).toBeLessThanOrEqual(
      widthOf(layoutTopology({ ...path, zones: undefined })) + path.zones!.length * 120,
    );
  });
});

describe('zoneRects', () => {
  it('pads a zone around its machines, deeper at the top where its name sits', () => {
    const topology: Topology = {
      zones: [{ id: 'z', label: 'Your home', kind: 'home' }],
      nodes: [{ ...node('a', 'client'), zone: 'z' }],
      links: [],
    };
    const boxes = new Map([['a', { x: 0, y: 0, width: 100, height: 50 }]]);
    expect(zoneRects(topology, boxes)[0]).toMatchObject({
      x: -ZONE_PADDING.x,
      y: -ZONE_PADDING.top,
      width: 100 + 2 * ZONE_PADDING.x,
      height: 50 + ZONE_PADDING.top + ZONE_PADDING.bottom,
    });
  });

  it('skips a zone with no measured machine in it', () => {
    const topology: Topology = {
      zones: [{ id: 'z', label: 'Empty', kind: 'cloud' }],
      nodes: [],
      links: [],
    };
    expect(zoneRects(topology, new Map())).toEqual([]);
  });
});

describe('framing', () => {
  const BOX: Rect = { x: 0, y: 0, width: 1000, height: 200 };

  it('never lets a label render under 12px at the readable zoom', () => {
    for (const px of [14, 16, 18]) {
      expect(px * readableZoom(px)).toBeGreaterThanOrEqual(READABLE_LABEL_PX);
    }
  });

  it('fits a box that fits, centred', () => {
    const viewport = frameRect(BOX, 1200, 600, {
      minZoom: 0.5,
      maxZoom: 2,
      padding: 100,
    });
    expect(viewport).toEqual({ x: 100, y: 200, zoom: 1 });
  });

  it('holds the readable zoom rather than shrinking a box that does not fit', () => {
    const viewport = frameRect(BOX, 400, 600, { minZoom: 0.75, maxZoom: 2, padding: 0 });
    expect(viewport.zoom).toBe(0.75);
    // The centre of the box sits on the centre of the screen.
    expect(viewport.x + 500 * 0.75).toBe(200);
  });

  it('keeps the start of a too-wide box on screen, not its middle', () => {
    const viewport = frameStart(BOX, 400, 600, {
      minZoom: 0.75,
      maxZoom: 2,
      padding: 20,
    });
    expect(viewport.zoom).toBe(0.75);
    expect(viewport.x).toBe(20);
  });

  it('knows whether a box is already on screen', () => {
    const viewport = { x: 0, y: 0, zoom: 1 };
    const inside = { x: 10, y: 10, width: 50, height: 50 };
    const spilling = { x: 10, y: 10, width: 95, height: 50 };
    expect(isInView(inside, viewport, 100, 100, 5)).toBe(true);
    expect(isInView(spilling, viewport, 100, 100, 5)).toBe(false);
  });

  it('measures fit and bounds arithmetically', () => {
    expect(fitZoom(BOX, 520, 520, 10)).toBe(0.5);
    expect(boundsOf([])).toBeNull();
    expect(
      boundsOf([
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 20, y: -5, width: 10, height: 10 },
      ]),
    ).toEqual({ x: 0, y: -5, width: 30, height: 15 });
  });
});
