/**
 * The four scenarios, and the properties they must all hold.
 *
 * The determinism test is the one that matters most. A simulation that produces a
 * slightly different run each time cannot be linked to, screenshotted, diffed, or
 * described in a sentence a second reader will recognise -- and the lossy scenario, the
 * one place a probability is involved, is exactly where that would go wrong quietly. So
 * every scenario is run twice and compared whole, `SimResult` against `SimResult`.
 *
 * The rest is the scenario data itself: paths that exist in the topology, addresses from
 * ranges reserved for documentation, and ids that a route can be narrowed to.
 */

import { describe, expect, it } from 'vitest';

import { classifyIp, ip } from '@/core/net/address';
import type { SimEvent } from '@/core/types/events';

import { runJourney, type JourneyScenario } from '../sim/journey';

import {
  DEFAULT_JOURNEY_ID,
  FRAGMENTED_PACKET,
  getJourneyScenario,
  LOSSY_LINK,
  PACKET_JOURNEY_SCENARIOS,
  TCP_WEB_REQUEST,
  UDP_DNS_QUERY,
} from './index';
import { JOURNEY_TOPOLOGY } from './topology';

const CASES = PACKET_JOURNEY_SCENARIOS.map(
  (scenario) => [scenario.id, scenario] as const,
);

// ---------------------------------------------------------------------------
// Determinism -- the property everything else depends on
// ---------------------------------------------------------------------------

describe.each(CASES)('%s is deterministic', (_id, scenario: JourneyScenario) => {
  it('produces a deep-equal result on a second run', () => {
    expect(runJourney(scenario)).toEqual(runJourney(scenario));
  });

  it('produces a deep-equal result on a tenth run', () => {
    // Not redundant: a generator whose state leaked into module scope would agree with
    // itself once and drift after that, which two runs cannot catch.
    const first = runJourney(scenario);
    for (let attempt = 0; attempt < 9; attempt += 1) {
      expect(runJourney(scenario)).toEqual(first);
    }
  });
});

describe('the lossy scenario', () => {
  it('loses the same packet on every run', () => {
    const drops = () =>
      runJourney(LOSSY_LINK)
        .events.filter(
          (event): event is Extract<SimEvent, { kind: 'drop' }> => event.kind === 'drop',
        )
        .map((event) => `${event.at}@${event.atNode}:${event.pduId}`);

    expect(drops()).toEqual(drops());
    // And it is a real drop, not an empty list agreeing with itself.
    expect(drops()).toHaveLength(1);
  });

  it('loses a different packet under a different seed', () => {
    // The determinism is in the seed, not in the loss being fixed. A scenario whose
    // output ignored the seed would pass every test above and teach nothing.
    const seeded = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((seed) =>
        runJourney(LOSSY_LINK, { seed })
          .events.filter((event) => event.kind === 'drop')
          .map((event) => event.at)
          .join(','),
      ),
    );
    expect(seeded.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

describe('the catalogue', () => {
  it('offers exactly the four scenarios the phase doc names', () => {
    expect(PACKET_JOURNEY_SCENARIOS.map((scenario) => scenario.id)).toEqual([
      'tcp-web-request',
      'udp-dns-query',
      'fragmented-packet',
      'lossy-link',
    ]);
  });

  it('opens on one of them', () => {
    expect(getJourneyScenario(DEFAULT_JOURNEY_ID)).toBeDefined();
  });

  it('returns undefined for an id it does not offer', () => {
    expect(getJourneyScenario('dns-explorer')).toBeUndefined();
  });

  it('gives every scenario a unique id, a summary, and something it teaches', () => {
    const ids = PACKET_JOURNEY_SCENARIOS.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const scenario of PACKET_JOURNEY_SCENARIOS) {
      expect(scenario.title.length).toBeGreaterThan(0);
      expect(scenario.summary.length).toBeGreaterThan(20);
      expect(scenario.teaches.length).toBeGreaterThan(0);
      expect(scenario.writes.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// The data each scenario declares
// ---------------------------------------------------------------------------

describe.each(CASES)('%s', (_id, scenario: JourneyScenario) => {
  const nodes = new Set(scenario.topology.nodes.map((node) => node.id));

  it('names only machines the topology has', () => {
    for (const nodeId of scenario.path) {
      expect(nodes.has(nodeId), `path names "${nodeId}"`).toBe(true);
    }
    if (scenario.nat) {
      expect(nodes.has(scenario.nat.nodeId)).toBe(true);
      expect(scenario.path).toContain(scenario.nat.nodeId);
    }
  });

  it('names only links the topology has, if it makes one lossy', () => {
    if (!scenario.loss) return;
    const links = new Set(scenario.topology.links.map((link) => link.id));
    expect(links.has(scenario.loss.linkId)).toBe(true);
    expect(scenario.loss.rate).toBeGreaterThan(0);
    expect(scenario.loss.rate).toBeLessThan(1);
  });

  it('overrides the MTU only for links that exist', () => {
    const links = new Set(scenario.topology.links.map((link) => link.id));
    for (const linkId of Object.keys(scenario.linkMtu ?? {})) {
      expect(links.has(linkId)).toBe(true);
    }
  });

  it('uses a source port from the ephemeral range', () => {
    // Where a real client's source port comes from, and the reason it looks random.
    expect(scenario.clientPort).toBeGreaterThanOrEqual(49152);
    expect(scenario.clientPort).toBeLessThanOrEqual(65535);
  });

  it('contacts nothing that could be a real host', () => {
    // Every address in the run has to come from a range reserved for documentation or
    // for private use. If the classifier ever calls one `public`, it belongs to somebody.
    const addresses = scenario.topology.nodes
      .filter((node) => scenario.path.includes(node.id))
      .flatMap((node) => (node.ipv4 ? [node.ipv4] : []));

    expect(addresses.length).toBeGreaterThan(0);
    for (const address of addresses) {
      expect(['private', 'documentation'], address).toContain(classifyIp(ip(address)));
    }
    if (scenario.nat) {
      expect(classifyIp(ip(scenario.nat.publicIp))).toBe('documentation');
    }
  });

  it('produces a run with phases, events, and a timeline longer than both', () => {
    const result = runJourney(scenario);

    expect(result.events.length).toBeGreaterThan(0);
    expect(result.phases.length).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.phases[0].startMs).toBe(0);
    expect(result.phases.at(-1)!.endMs).toBe(result.durationMs);
  });
});

// ---------------------------------------------------------------------------
// What makes each one different from the others
// ---------------------------------------------------------------------------

describe('the four are four different lessons', () => {
  it('runs TCP and UDP over the same network', () => {
    expect(TCP_WEB_REQUEST.topology).toBe(JOURNEY_TOPOLOGY);
    expect(UDP_DNS_QUERY.topology).toBe(JOURNEY_TOPOLOGY);
    expect(TCP_WEB_REQUEST.transport).toBe('tcp');
    expect(UDP_DNS_QUERY.transport).toBe('udp');
  });

  it('costs a handshake in one and nothing in the other', () => {
    const tcp = runJourney(TCP_WEB_REQUEST).phases.map((phase) => phase.id);
    const udp = runJourney(UDP_DNS_QUERY).phases.map((phase) => phase.id);

    expect(tcp).toEqual(['handshake', 'request', 'response', 'teardown']);
    expect(udp).toEqual(['query', 'answer']);
  });

  it('fragments only where a link is too narrow for the payload', () => {
    const fragmented = runJourney(FRAGMENTED_PACKET);
    const plain = runJourney(UDP_DNS_QUERY);

    const splits = (result: ReturnType<typeof runJourney>) =>
      result.events.filter(
        (event) => event.kind === 'log' && event.text.includes('split into'),
      ).length;

    expect(splits(fragmented)).toBe(2);
    expect(splits(plain)).toBe(0);
  });

  it('costs time only where the link loses packets', () => {
    const lossy = runJourney(LOSSY_LINK);
    const clean = runJourney(LOSSY_LINK, {
      loss: { linkId: 'backbone', rate: 0, maxRetransmissions: 4 },
    });

    // The same conversation, one retransmission timeout longer.
    expect(lossy.durationMs).toBeGreaterThan(clean.durationMs);
    expect(lossy.phases.map((phase) => phase.id)).toEqual(
      clean.phases.map((phase) => phase.id),
    );
  });
});
