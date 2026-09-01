import { describe, expect, it } from 'vitest';

import type { SimLink, SimNode, Topology } from '@/core/types/topology';

import { layoutTopology } from './layout';

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
