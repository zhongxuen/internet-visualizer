import { describe, expect, it } from 'vitest';

import type { Topology } from '../../types/topology';
import { topologyProblems } from '../topology';

const SOUND: Topology = {
  zones: [
    { id: 'home', label: 'Your home', kind: 'home' },
    { id: 'site', label: "The website's data centre", kind: 'datacenter' },
  ],
  nodes: [
    { id: 'laptop', kind: 'client', label: 'Laptop', zone: 'home' },
    { id: 'router', kind: 'router', label: 'Home router', zone: 'home' },
    // A node with no zone is allowed; zones are optional per node as well as overall.
    { id: 'server', kind: 'server', label: 'example.com' },
  ],
  links: [
    { id: 'wifi', from: 'laptop', to: 'router', latencyMs: 0.5, medium: 'wifi' },
    { id: 'wan', from: 'router', to: 'server', latencyMs: 20 },
  ],
};

describe('topologyProblems', () => {
  it('finds nothing wrong with a sound topology, with or without zones', () => {
    expect(topologyProblems(SOUND)).toEqual([]);

    const bare: Topology = {
      nodes: SOUND.nodes.map(({ id, kind, label }) => ({ id, kind, label })),
      links: SOUND.links,
    };
    expect(topologyProblems(bare)).toEqual([]);
  });

  it('refuses a node placed in a zone the topology does not declare', () => {
    const stray: Topology = {
      ...SOUND,
      nodes: [
        ...SOUND.nodes,
        { id: 'phone', kind: 'client', label: 'Phone', zone: 'office' },
      ],
    };
    expect(topologyProblems(stray)).toEqual(['node "phone" is in unknown zone "office"']);
  });

  it('refuses a zone reference when the topology has no zones at all', () => {
    const zoneless: Topology = { nodes: SOUND.nodes, links: SOUND.links };
    expect(topologyProblems(zoneless)).toEqual([
      'node "laptop" is in unknown zone "home"',
      'node "router" is in unknown zone "home"',
    ]);
  });

  it('refuses a link to a node that is not there', () => {
    const dangling: Topology = {
      ...SOUND,
      links: [
        ...SOUND.links,
        { id: 'ghost', from: 'server', to: 'nobody', latencyMs: 1 },
      ],
    };
    expect(topologyProblems(dangling)).toEqual([
      'link "ghost" names unknown node "nobody"',
    ]);
  });

  it('refuses a repeated id in any of the three collections, once per id', () => {
    const repeated: Topology = {
      zones: [...SOUND.zones!, SOUND.zones![0], SOUND.zones![0]],
      nodes: [...SOUND.nodes, SOUND.nodes[0]],
      links: [...SOUND.links, SOUND.links[1]],
    };
    expect(topologyProblems(repeated)).toEqual([
      'node id "laptop" is used more than once',
      'link id "wan" is used more than once',
      'zone id "home" is used more than once',
    ]);
  });
});
