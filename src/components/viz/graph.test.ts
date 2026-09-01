import { describe, expect, it } from 'vitest';

import type { NodeKind, Topology } from '@/core/types/topology';

import {
  departureSide,
  describeLink,
  describeNode,
  toFlowEdges,
  toFlowNodes,
} from './graph';
import { nodeTypes } from './nodes';
import { NODE_KINDS } from './nodes/kinds';

const TOPOLOGY: Topology = {
  nodes: [
    {
      id: 'client',
      kind: 'client',
      label: 'Laptop',
      ipv4: '192.0.2.10',
      mac: '02:00:5e:10:00:01',
    },
    { id: 'gw', kind: 'router', label: 'Home router', ipv4: '192.0.2.1' },
  ],
  links: [{ id: 'lan', from: 'client', to: 'gw', latencyMs: 2, medium: 'wifi' }],
};

const POSITIONS = { client: { x: 0, y: 0 }, gw: { x: 300, y: 0 } };

describe('departureSide', () => {
  it('leaves by the side that faces the far end', () => {
    expect(departureSide({ x: 0, y: 0 }, { x: 100, y: 0 })).toBe('right');
    expect(departureSide({ x: 0, y: 0 }, { x: -100, y: 0 })).toBe('left');
    expect(departureSide({ x: 0, y: 0 }, { x: 0, y: 100 })).toBe('bottom');
    expect(departureSide({ x: 0, y: 0 }, { x: 0, y: -100 })).toBe('top');
  });

  it('prefers the horizontal side on a diagonal, matching the column layout', () => {
    expect(departureSide({ x: 0, y: 0 }, { x: 100, y: 100 })).toBe('right');
    expect(departureSide({ x: 0, y: 0 }, { x: 100, y: -60 })).toBe('right');
  });
});

describe('toFlowNodes', () => {
  it('uses the NodeKind as the React Flow type so nodeTypes picks the renderer', () => {
    const [client, gw] = toFlowNodes(TOPOLOGY, POSITIONS);

    expect(client.type).toBe('client');
    expect(gw.type).toBe('router');
  });

  it('carries the SimNode by value rather than a flattened copy', () => {
    const [client] = toFlowNodes(TOPOLOGY, POSITIONS);
    expect(client.data.node).toBe(TOPOLOGY.nodes[0]);
  });

  it('defaults a node the simulation has said nothing about to idle', () => {
    const [client, gw] = toFlowNodes(TOPOLOGY, POSITIONS, {
      nodeStates: { client: 'active' },
    });

    expect(client.data.state).toBe('active');
    expect(gw.data.state).toBe('idle');
  });

  it('marks only the selected node, and never makes a topology draggable', () => {
    const [client, gw] = toFlowNodes(TOPOLOGY, POSITIONS, { selectedNodeId: 'gw' });

    expect(client.selected).toBe(false);
    expect(gw.selected).toBe(true);
    expect(gw.draggable).toBe(false);
    expect(gw.focusable).toBe(true);
  });

  it('falls back to the origin for a node with no position', () => {
    const [client] = toFlowNodes(TOPOLOGY, {});
    expect(client.position).toEqual({ x: 0, y: 0 });
  });
});

describe('toFlowEdges', () => {
  it('attaches to the handles facing each other', () => {
    const [lan] = toFlowEdges(TOPOLOGY, POSITIONS);

    expect(lan.sourceHandle).toBe('source-right');
    expect(lan.targetHandle).toBe('target-left');
  });

  it('flips both handles when the far end is to the left', () => {
    const [lan] = toFlowEdges(TOPOLOGY, { client: { x: 300, y: 0 }, gw: { x: 0, y: 0 } });

    expect(lan.sourceHandle).toBe('source-left');
    expect(lan.targetHandle).toBe('target-right');
  });

  it('resolves both endpoint labels once, for the edge to read', () => {
    const [lan] = toFlowEdges(TOPOLOGY, POSITIONS);

    expect(lan.data).toMatchObject({ fromLabel: 'Laptop', toLabel: 'Home router' });
    expect(lan.data?.link).toBe(TOPOLOGY.links[0]);
  });
});

describe('accessible descriptions', () => {
  it('says what a machine is, what it is doing, and what it answers to', () => {
    expect(describeNode(TOPOLOGY.nodes[0], 'processing')).toBe(
      'Client: Laptop. Working. IPv4 192.0.2.10. MAC 02:00:5e:10:00:01',
    );
  });

  it('omits addresses the scenario did not set', () => {
    expect(describeNode(TOPOLOGY.nodes[1], 'idle')).toBe(
      'Router: Home router. Idle. IPv4 192.0.2.1',
    );
  });

  it('names both ends of a link and the cost of the hop', () => {
    expect(describeLink(TOPOLOGY.links[0], 'Laptop', 'Home router')).toBe(
      'Link from Laptop to Home router. Wi-Fi. 2 ms one-way latency',
    );
  });

  it('adds bandwidth only when the scenario states it', () => {
    expect(
      describeLink({ ...TOPOLOGY.links[0], bandwidthMbps: 100 }, 'a', 'b'),
    ).toContain('100 megabits per second');
  });
});

describe('NodeKind coverage', () => {
  const kinds = Object.keys(NODE_KINDS) as NodeKind[];

  it('gives every kind a renderer', () => {
    for (const kind of kinds) {
      expect(nodeTypes[kind], `no node component for "${kind}"`).toBeTypeOf('function');
    }
  });

  it('gives every kind an icon, a role word, and a layer', () => {
    for (const kind of kinds) {
      const token = NODE_KINDS[kind];
      expect(token.icon, kind).toBeTruthy();
      expect(token.roleLabel, kind).toBeTruthy();
      expect(token.layer, kind).toBeTruthy();
    }
  });
});
