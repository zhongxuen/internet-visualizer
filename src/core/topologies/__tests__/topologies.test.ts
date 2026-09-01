/**
 * The accuracy rules from `docs/implementation/05-module-network-map.md`, enforced.
 *
 * These scenarios are read by every module that draws or animates a network, and a wrong
 * address or an implausible latency is a teaching bug no type can catch. So the things a
 * reviewer would otherwise have to check by hand -- reserved ranges used only where they
 * belong, links naming real nodes, latencies inside their bands, every machine explained
 * -- are checked here instead.
 *
 * Addresses are classified with `../../net/address`, the same table the phase-12
 * diagnostics guard will use. That is deliberate: if a scenario ever contains an address
 * that classifier calls `public`, it is an address that belongs to somebody.
 */

import { describe, expect, it } from 'vitest';

import { cidr, cidrContains, classifyIp, ip, parseMac } from '../../net/address';
import { DATACENTER } from '../datacenter';
import { HOME_LAN } from '../homeLan';
import { getScenarioTopology, SCENARIO_TOPOLOGIES } from '../index';
import { ISP_PATH } from '../ispPath';
import { SMALL_OFFICE } from '../smallOffice';
import { formatStandardRef, noteFor, rfc, type ScenarioTopology } from '../types';

const SCENARIOS: readonly ScenarioTopology[] = [
  HOME_LAN,
  SMALL_OFFICE,
  ISP_PATH,
  DATACENTER,
];

/** Every scenario address must be private (RFC 1918/4193) or documentation (5737/3849). */
const ALLOWED_SCOPES = ['private', 'documentation'] as const;

function scopeOf(text: string): string {
  return classifyIp(ip(text));
}

function latencyOf(scenario: ScenarioTopology, linkId: string): number {
  const link = scenario.topology.links.find((entry) => entry.id === linkId);
  expect(link, `${scenario.id} has no link "${linkId}"`).toBeDefined();
  return link!.latencyMs;
}

describe.each(SCENARIOS.map((scenario) => [scenario.id, scenario] as const))(
  '%s',
  (_id, scenario) => {
    const { topology } = scenario;

    it('gives every node and link a unique id', () => {
      const nodeIds = topology.nodes.map((node) => node.id);
      const linkIds = topology.links.map((link) => link.id);

      expect(new Set(nodeIds).size).toBe(nodeIds.length);
      expect(new Set(linkIds).size).toBe(linkIds.length);
    });

    it('only links nodes the topology declares', () => {
      const known = new Set(topology.nodes.map((node) => node.id));

      for (const link of topology.links) {
        expect(known, `${link.id}.from`).toContain(link.from);
        expect(known, `${link.id}.to`).toContain(link.to);
        expect(link.from).not.toBe(link.to);
      }
    });

    it('connects every node to something', () => {
      const linked = new Set(topology.links.flatMap((link) => [link.from, link.to]));

      for (const node of topology.nodes) {
        expect(linked, `${node.id} is stranded`).toContain(node.id);
      }
    });

    it('uses no address that could belong to somebody', () => {
      for (const node of topology.nodes) {
        if (node.ipv4) {
          expect(ALLOWED_SCOPES, `${node.id} has ${node.ipv4}`).toContain(
            scopeOf(node.ipv4),
          );
        }

        // RFC 3849 reserves 2001:db8::/32; the classifier calls that 'documentation'.
        if (node.ipv6) {
          expect(scopeOf(node.ipv6), `${node.id} has ${node.ipv6}`).toBe('documentation');
        }

        // RFC 7042 section 2.1.2 reserves 00-00-5E-00-53-00 .. -FF for documentation.
        if (node.mac) {
          expect(parseMac(node.mac).ok, `${node.id} has an invalid MAC`).toBe(true);
          expect(node.mac.toLowerCase().startsWith('00:00:5e:00:53:')).toBe(true);
        }
      }
    });

    it('keeps every latency plausible for the medium', () => {
      for (const link of topology.links) {
        expect(link.latencyMs, `${link.id}`).toBeGreaterThan(0);

        // Nothing here is slower one way than an antipodal round trip; past that it is a
        // typo rather than a teaching choice.
        expect(link.latencyMs, `${link.id}`).toBeLessThanOrEqual(160);

        if (link.medium === 'ethernet' || link.medium === 'wifi') {
          expect(link.latencyMs, `${link.id} is a LAN hop`).toBeLessThan(1);
        }

        if (link.bandwidthMbps !== undefined) {
          expect(link.bandwidthMbps, `${link.id}`).toBeGreaterThan(0);
        }
      }
    });

    it('explains every machine in two to four sentences', () => {
      for (const node of topology.nodes) {
        const note = noteFor(scenario, node.id);
        expect(note, `${node.id} has no teaching note`).toBeDefined();

        const sentences = note!.text.split(/(?<=[.?!])\s+/).filter(Boolean);
        expect(sentences.length, `${node.id}`).toBeGreaterThanOrEqual(2);
        expect(sentences.length, `${node.id}`).toBeLessThanOrEqual(4);
      }
    });

    it('points every note at something on the diagram', () => {
      const targets = new Set([
        ...topology.nodes.map((node) => node.id),
        ...topology.links.map((link) => link.id),
      ]);

      for (const note of scenario.notes) {
        expect(targets, `note targets unknown id "${note.targetId}"`).toContain(
          note.targetId,
        );
      }
    });

    it('writes every citation so a reader could follow it', () => {
      for (const note of scenario.notes) {
        if (!note.reference) continue;

        expect(note.reference.id).not.toBe('');
        expect(note.reference.title).not.toBe('');

        if (note.reference.body === 'RFC') {
          expect(Number(note.reference.id)).toBeGreaterThan(0);
          expect(note.reference.url).toContain(`rfc${note.reference.id}`);
        }
      }
    });

    it('says what it teaches', () => {
      expect(scenario.title).not.toBe('');
      expect(scenario.summary.length).toBeGreaterThan(20);
      expect(scenario.teaches.length).toBeGreaterThanOrEqual(3);
    });
  },
);

describe('registry', () => {
  it('lists every scenario exactly once, smallest network first', () => {
    expect(SCENARIO_TOPOLOGIES.map((scenario) => scenario.id)).toEqual([
      'home-lan',
      'small-office',
      'isp-path',
      'datacenter',
    ]);
  });

  it('looks a scenario up by id', () => {
    expect(getScenarioTopology('isp-path')).toBe(ISP_PATH);
    expect(getScenarioTopology('nope')).toBeUndefined();
  });
});

describe('the accuracy rules these scenarios exist to demonstrate', () => {
  it('never uses a switch as a gateway', () => {
    // A switch may hold a management address, but nothing ever routes through it.
    const gateways = SCENARIOS.flatMap((scenario) =>
      scenario.topology.nodes.flatMap((node) =>
        Object.entries(node.detail ?? {})
          .filter(([label]) => label.toLowerCase().includes('gateway'))
          .map(([, value]) => value),
      ),
    );

    const switchAddresses = SCENARIOS.flatMap((scenario) =>
      scenario.topology.nodes
        .filter((node) => node.kind === 'switch')
        .map((node) => node.ipv4)
        .filter((address): address is string => Boolean(address)),
    );

    expect(gateways.length).toBeGreaterThan(0);
    expect(switchAddresses.length).toBeGreaterThan(0);

    for (const address of switchAddresses) {
      for (const gateway of gateways) {
        expect(gateway, 'a switch is being used as a default gateway').not.toContain(
          address,
        );
      }
    }
  });

  it('labels the home router as doing NAPT, not plain NAT', () => {
    const router = HOME_LAN.topology.nodes.find((node) => node.id === 'router');
    expect(router?.kind).toBe('router');
    expect(router?.label).toContain('NAPT');
    expect(router?.detail?.Translation).toContain('NAPT');

    const note = noteFor(HOME_LAN, 'router');
    expect(note?.text).toContain('NAPT');
    // RFC 3022 section 2.2 is the section that defines NAPT specifically.
    expect(note?.reference).toEqual(
      rfc(3022, 'Traditional IP Network Address Translator (Traditional NAT)', '2.2'),
    );
  });

  it('keeps the home LAN on one private /24 behind a single public address', () => {
    const lan = cidr('192.168.1.0/24');

    for (const node of HOME_LAN.topology.nodes) {
      if (!node.ipv4) continue;

      if (node.id === 'isp-gateway') {
        expect(scopeOf(node.ipv4)).toBe('documentation');
      } else {
        expect(cidrContains(lan, ip(node.ipv4)), `${node.id}`).toBe(true);
      }
    }

    expect(HOME_LAN.topology.nodes.find((node) => node.id === 'router')?.detail).toEqual(
      expect.objectContaining({
        'WAN interface': expect.stringContaining('203.0.113.7'),
      }),
    );
  });

  it('subnets the small office inside 10.0.0.0/8, one /24 per VLAN', () => {
    const vlans = ['10.20.10.0/24', '10.20.20.0/24', '10.20.30.0/24'].map(cidr);
    const ten = cidr('10.0.0.0/8');

    const internal = SMALL_OFFICE.topology.nodes.filter(
      (node) => node.ipv4 && node.id !== 'isp-router',
    );

    for (const node of internal) {
      const address = ip(node.ipv4!);
      expect(cidrContains(ten, address), `${node.id} is outside 10.0.0.0/8`).toBe(true);
      expect(
        vlans.filter((vlan) => cidrContains(vlan, address)).length,
        `${node.id} is in no VLAN`,
      ).toBe(1);
    }

    // Every VLAN is actually used; three subnets with one occupant would be theatre.
    for (const vlan of vlans) {
      expect(
        internal.some((node) => cidrContains(vlan, ip(node.ipv4!))),
        `nothing is in ${vlan.text}`,
      ).toBe(true);
    }
  });

  it('draws the Internet exchange as the layer-2 fabric it is', () => {
    const ixp = ISP_PATH.topology.nodes.find((node) => node.id === 'ixp');

    expect(ixp?.kind).toBe('switch');
    // An exchange forwards frames between members; it holds no address of its own.
    expect(ixp?.ipv4).toBeUndefined();
  });

  it('makes peering measurably shorter than transit', () => {
    const viaPeering = ['access', 'backhaul', 'peering-port', 'peering-cdn'].reduce(
      (total, id) => total + latencyOf(ISP_PATH, id),
      0,
    );
    const viaTransit = [
      'access',
      'backhaul',
      'transit-up',
      'backbone',
      'handoff',
      'rack',
    ].reduce((total, id) => total + latencyOf(ISP_PATH, id), 0);

    expect(viaPeering).toBeLessThan(15);
    expect(viaTransit).toBeGreaterThan(80);
  });

  it('puts every intercontinental hop in the 80-160 ms band', () => {
    expect(latencyOf(ISP_PATH, 'backbone')).toBeGreaterThanOrEqual(80);
    expect(latencyOf(ISP_PATH, 'backbone')).toBeLessThanOrEqual(160);
    expect(latencyOf(DATACENTER, 'edge-origin')).toBeGreaterThanOrEqual(80);
    expect(latencyOf(DATACENTER, 'edge-origin')).toBeLessThanOrEqual(160);
  });

  it('puts every ISP access hop in the 5-20 ms band', () => {
    const access: ReadonlyArray<readonly [ScenarioTopology, string]> = [
      [HOME_LAN, 'access-uplink'],
      [SMALL_OFFICE, 'wan-uplink'],
      [ISP_PATH, 'access'],
      [DATACENTER, 'visitor-edge'],
    ];

    for (const [scenario, linkId] of access) {
      const latency = latencyOf(scenario, linkId);
      expect(latency, `${scenario.id}/${linkId}`).toBeGreaterThanOrEqual(5);
      expect(latency, `${scenario.id}/${linkId}`).toBeLessThanOrEqual(20);
    }
  });

  it('separates the datacenter into one private /24 per tier', () => {
    const tiers = {
      edge: cidr('10.40.1.0/24'),
      app: cidr('10.40.2.0/24'),
      data: cidr('10.40.3.0/24'),
    };

    const internal = DATACENTER.topology.nodes.filter(
      (node) => node.ipv4 && classifyIp(ip(node.ipv4)) === 'private',
    );

    for (const node of internal) {
      const matches = Object.values(tiers).filter((tier) =>
        cidrContains(tier, ip(node.ipv4!)),
      );
      expect(matches.length, `${node.id} is in no tier`).toBe(1);
    }

    expect(internal.map((node) => node.id)).toEqual([
      'proxy-a',
      'proxy-b',
      'app-1',
      'app-2',
      'app-3',
      'cache',
      'db-primary',
      'db-replica',
    ]);
  });
});

describe('formatStandardRef', () => {
  it('prints a citation the way a reader would write it', () => {
    expect(formatStandardRef(rfc(1918, 'Address Allocation for Private Internets'))).toBe(
      'RFC 1918',
    );
    expect(formatStandardRef(rfc(3022, 'Traditional NAT', '2.2'))).toBe('RFC 3022 §2.2');
  });
});
