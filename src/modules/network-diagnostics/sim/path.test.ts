import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CONDITIONS,
  ICMP_POLICY_LABELS,
  buildTopology,
  conditionsOf,
  hopCount,
  linkIdAt,
  machineAt,
  nodeChain,
  oneWayMs,
  type DiagnosticPath,
} from './path';
import { DIAGNOSTIC_PATHS, LOCAL_CDN, LONG_HAUL, getPath } from './paths';

/**
 * The geometry both probe tools measure against.
 *
 * `ping.test.ts` and `traceroute.test.ts` test what the tools *print*; this file tests
 * the description of the wire underneath them, which is the thing that makes their two
 * sets of numbers agree. Getting `oneWayMs` or `linkIdAt` wrong would move every hop time
 * and every packet animation together and consistently -- the kind of error that looks
 * plausible on screen and is only visible against the arithmetic.
 *
 * The load-balanced hop gets the most attention here. It is the one place where a path is
 * not a line, and the diamond it puts in the topology is the reason a real traceroute row
 * sometimes shows two addresses.
 */

/** The two-router hop, built out rather than borrowed, so the wiring is explicit. */
const PARALLEL_PATH: DiagnosticPath = {
  id: 'test-parallel',
  title: 'A load-balanced middle hop',
  summary: 'Two routers share position 2, so probes are spread across the pair.',
  teaches: [],
  source: {
    id: 'laptop',
    label: 'Laptop',
    address: '192.168.1.20',
    initialTtl: 64,
  },
  hops: [
    {
      id: 'edge',
      label: 'Edge router',
      address: '192.168.1.1',
      linkMs: 1,
      respondsToTtl: true,
      medium: 'ethernet',
    },
    {
      id: 'core-a',
      label: 'Core A',
      address: '198.51.100.1',
      linkMs: 8,
      respondsToTtl: true,
      returnSkewMs: 12,
      note: 'The asymmetric one.',
      parallel: { id: 'core-b', label: 'Core B', address: '198.51.100.2' },
    },
    {
      id: 'quiet',
      label: 'Silent router',
      address: '198.51.100.9',
      linkMs: 4,
      respondsToTtl: false,
    },
  ],
  destination: {
    id: 'target',
    label: 'Target',
    hostname: 'target.example',
    address: '203.0.113.10',
    linkMs: 6,
    icmp: 'filtered-silent',
    replyTtl: 64,
    tcpOpen: true,
    note: 'Silent, and up.',
  },
};

describe('conditionsOf', () => {
  it('fills in the quiet wired defaults for a path that names none', () => {
    expect(conditionsOf(PARALLEL_PATH)).toEqual(DEFAULT_CONDITIONS);
  });

  it('overrides only what a path declares', () => {
    const lossy = {
      ...PARALLEL_PATH,
      conditions: { ...DEFAULT_CONDITIONS, lossRate: 0.2 },
    };

    expect(conditionsOf(lossy)).toEqual({ ...DEFAULT_CONDITIONS, lossRate: 0.2 });
  });
});

describe('hopCount', () => {
  /** Every router, plus the destination: the destination is a TTL step of its own. */
  it('counts the destination as the last step', () => {
    expect(hopCount(PARALLEL_PATH)).toBe(PARALLEL_PATH.hops.length + 1);

    for (const path of DIAGNOSTIC_PATHS) {
      expect(hopCount(path)).toBe(path.hops.length + 1);
    }
  });
});

describe('oneWayMs', () => {
  /**
   * TTL is 1-based and names the machine the packet dies at, so `oneWayMs(path, 1)` is
   * the first link on its own. Off by one here would shift every traceroute time.
   */
  it('accumulates the links up to and including the machine at that TTL', () => {
    expect(oneWayMs(PARALLEL_PATH, 1)).toBe(1);
    expect(oneWayMs(PARALLEL_PATH, 2)).toBe(9);
    expect(oneWayMs(PARALLEL_PATH, 3)).toBe(13);
    expect(oneWayMs(PARALLEL_PATH, 4)).toBe(19);
  });

  it('is zero before the first link and stops growing past the destination', () => {
    expect(oneWayMs(PARALLEL_PATH, 0)).toBe(0);
    // Past the end every remaining step is charged the last link, which is what the
    // `?? destination.linkMs` fallback means -- a probe with a TTL nothing consumes.
    expect(oneWayMs(PARALLEL_PATH, 5)).toBe(25);
  });

  it('rounds to two places, as every duration in this module does', () => {
    const fractional: DiagnosticPath = {
      ...PARALLEL_PATH,
      hops: [{ ...PARALLEL_PATH.hops[0]!, linkMs: 0.005 }],
    };

    expect(oneWayMs(fractional, 1)).toBe(0.01);
  });
});

describe('machineAt', () => {
  it('names the router a packet with that TTL dies at', () => {
    expect(machineAt(PARALLEL_PATH, 1)?.id).toBe('edge');
    expect(machineAt(PARALLEL_PATH, 2)?.id).toBe('core-a');
    expect(machineAt(PARALLEL_PATH, 3)?.id).toBe('quiet');
  });

  it('names the destination at the last step', () => {
    expect(machineAt(PARALLEL_PATH, hopCount(PARALLEL_PATH))).toMatchObject({
      id: 'target',
      address: '203.0.113.10',
    });
  });

  it('has nothing to name below 1 or past the destination', () => {
    expect(machineAt(PARALLEL_PATH, 0)).toBeUndefined();
    expect(machineAt(PARALLEL_PATH, -1)).toBeUndefined();
    expect(machineAt(PARALLEL_PATH, hopCount(PARALLEL_PATH) + 1)).toBeUndefined();
  });
});

describe('nodeChain and linkIdAt', () => {
  it('runs source, every hop, destination -- one entry per TTL step plus the source', () => {
    expect(nodeChain(PARALLEL_PATH)).toEqual([
      'laptop',
      'edge',
      'core-a',
      'quiet',
      'target',
    ]);
  });

  it('names the link crossed to reach the machine at that TTL', () => {
    expect(linkIdAt(PARALLEL_PATH, 1)).toBe('laptop-edge');
    expect(linkIdAt(PARALLEL_PATH, 2)).toBe('edge-core-a');
    expect(linkIdAt(PARALLEL_PATH, 4)).toBe('quiet-target');
  });

  it('clamps rather than producing an undefined endpoint', () => {
    expect(linkIdAt(PARALLEL_PATH, 0)).toBe('laptop-laptop');
    expect(linkIdAt(PARALLEL_PATH, 99)).toBe('laptop-target');
  });

  /** Every link `linkIdAt` names has to exist on the drawn topology, or nothing lights up. */
  it('names links the topology actually contains', () => {
    for (const path of DIAGNOSTIC_PATHS) {
      const ids = new Set(buildTopology(path).links.map((link) => link.id));
      for (let ttl = 1; ttl <= hopCount(path); ttl += 1) {
        expect(ids, `${path.id} at TTL ${ttl}`).toContain(linkIdAt(path, ttl));
      }
    }
  });
});

describe('buildTopology', () => {
  it('draws the source, every hop, and the destination', () => {
    const topology = buildTopology(PARALLEL_PATH);

    expect(topology.nodes.map((node) => node.id)).toEqual([
      'laptop',
      'edge',
      'core-a',
      'core-b',
      'quiet',
      'target',
    ]);
    expect(topology.nodes[0]!.kind).toBe('client');
    expect(topology.nodes[1]!.kind).toBe('router');
  });

  /**
   * The diamond. A load-balanced hop is two routers wired in parallel between the same
   * neighbours -- so the hop before it links to both, and both link to the hop after.
   * That is what it physically is, and it is why one traceroute row shows two addresses.
   */
  it('wires a parallel hop into a diamond, not a fork', () => {
    const links = buildTopology(PARALLEL_PATH).links.map((link) => link.id);

    expect(links).toEqual([
      'laptop-edge',
      'edge-core-a',
      'edge-core-b',
      'core-a-quiet',
      'core-b-quiet',
      'quiet-target',
    ]);
  });

  it('labels the sibling as the other half of the pair, at the same TTL', () => {
    const sibling = buildTopology(PARALLEL_PATH).nodes.find(
      (node) => node.id === 'core-b',
    );

    expect(sibling?.detail).toMatchObject({
      'Hop (TTL)': '2',
      Role: 'The other half of a load-balanced pair',
    });
  });

  /** `* * *` is a decision the router made, so the diagram says so rather than hiding it. */
  it('says on the node itself which routers will print as a star', () => {
    const nodes = buildTopology(PARALLEL_PATH).nodes;

    expect(nodes.find((node) => node.id === 'edge')?.detail).toMatchObject({
      'Answers TTL expiry': 'yes',
    });
    expect(nodes.find((node) => node.id === 'quiet')?.detail).toMatchObject({
      'Answers TTL expiry': 'no -- prints as *',
    });
  });

  it('shows a hop’s asymmetric return path, and omits the row when there is none', () => {
    const nodes = buildTopology(PARALLEL_PATH).nodes;

    expect(nodes.find((node) => node.id === 'core-a')?.detail).toMatchObject({
      'Return path': '12 ms longer than the way out',
      Note: 'The asymmetric one.',
    });
    expect(nodes.find((node) => node.id === 'edge')?.detail).not.toHaveProperty(
      'Return path',
    );
    expect(nodes.find((node) => node.id === 'edge')?.detail).not.toHaveProperty('Note');
  });

  /**
   * A destination that answers echo is drawn as a server; anything else is drawn as a
   * firewall. Colour is never the only signal -- the ICMP policy is spelled out beside it
   * -- but the shape is the first thing read, and "silent" is a filter far more often
   * than it is a dead machine.
   */
  it('draws a filtering destination as a firewall and an answering one as a server', () => {
    const filtered = buildTopology(PARALLEL_PATH).nodes.at(-1);
    const answering = buildTopology(LOCAL_CDN).nodes.at(-1);

    expect(filtered?.kind).toBe('firewall');
    expect(filtered?.detail).toMatchObject({
      ICMP: ICMP_POLICY_LABELS['filtered-silent'],
      'TCP 443': 'accepts connections',
      'Reply TTL': '64',
      Note: 'Silent, and up.',
    });
    expect(answering?.kind).toBe('server');
  });

  it('carries each link’s medium and one-way latency onto the drawn link', () => {
    const links = buildTopology(PARALLEL_PATH).links;
    const first = links.find((link) => link.id === 'laptop-edge');

    expect(first).toMatchObject({ latencyMs: 1, medium: 'ethernet' });
    // No medium declared, so none is invented.
    expect(links.find((link) => link.id === 'quiet-target')).not.toHaveProperty('medium');
  });

  it('draws every shipped path without a dangling link', () => {
    for (const path of DIAGNOSTIC_PATHS) {
      const topology = buildTopology(path);
      const ids = new Set(topology.nodes.map((node) => node.id));

      expect(topology.nodes.length, path.id).toBeGreaterThan(1);
      for (const link of topology.links) {
        expect(ids, `${path.id}: ${link.id}`).toContain(link.from);
        expect(ids, `${path.id}: ${link.id}`).toContain(link.to);
      }
    }
  });
});

describe('getPath', () => {
  it('finds a shipped path by id, and nothing else', () => {
    expect(getPath(LONG_HAUL.id)).toBe(LONG_HAUL);
    expect(getPath('no-such-path')).toBeUndefined();
  });
});
