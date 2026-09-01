import { describe, expect, it } from 'vitest';

import { DATACENTER, HOME_LAN } from '@/core/topologies';

import { countAtLayer, dimmedForLayer, layerOf, layersInTopology } from './layers';

describe('layerOf', () => {
  /**
   * The distinction the whole filter exists to make visible, and the one the accuracy
   * notes in docs/implementation/05-module-network-map.md single out: a switch forwards
   * frames, a router forwards packets, and they are not the same kind of box.
   */
  it('reads the layer from the shared kind table', () => {
    expect(layerOf('switch')).toBe('link');
    expect(layerOf('router')).toBe('network');
    expect(layerOf('nat')).toBe('network');
    expect(layerOf('load-balancer')).toBe('transport');
    expect(layerOf('proxy')).toBe('application');
  });
});

describe('layersInTopology', () => {
  it('offers only layers this scenario has machines at, in OSI order', () => {
    expect(layersInTopology(HOME_LAN.topology)).toEqual([
      'link',
      'network',
      'application',
    ]);
  });

  it('picks up the transport layer once a load balancer is on the diagram', () => {
    expect(layersInTopology(DATACENTER.topology)).toContain('transport');
  });
});

describe('dimmedForLayer', () => {
  it('dims nothing when no layer is chosen', () => {
    expect(dimmedForLayer(HOME_LAN.topology, null).size).toBe(0);
  });

  it('dims every machine that does not work at the chosen layer', () => {
    const dimmed = dimmedForLayer(HOME_LAN.topology, 'network');

    // The routers stay lit; the switches, the access point, and the clients step back.
    expect(dimmed.has('router')).toBe(false);
    expect(dimmed.has('isp-gateway')).toBe(false);
    expect(dimmed.has('lan-switch')).toBe(true);
    expect(dimmed.has('ap')).toBe(true);
    expect(dimmed.has('laptop')).toBe(true);
  });

  it('never dims the whole diagram for a layer the scenario has', () => {
    for (const layer of layersInTopology(HOME_LAN.topology)) {
      const dimmed = dimmedForLayer(HOME_LAN.topology, layer);
      expect(dimmed.size).toBeLessThan(HOME_LAN.topology.nodes.length);
    }
  });
});

describe('countAtLayer', () => {
  it('counts the machines a layer button would leave lit', () => {
    const total = layersInTopology(HOME_LAN.topology).reduce(
      (sum, layer) => sum + countAtLayer(HOME_LAN.topology, layer),
      0,
    );

    expect(total).toBe(HOME_LAN.topology.nodes.length);
  });
});
