/**
 * The machines a page load is drawn on.
 *
 * Built once, before any stage runs, and then **pruned** once every stage has run: a node
 * survives only if some event in the finished run actually names it. That order matters.
 * A stage cannot be asked to declare its diagram in advance -- whether a root server is
 * involved is not knowable until the resolver has been asked -- but every stage does leave
 * a record of who it spoke to, so the diagram can be derived from the run instead of
 * asserted before it.
 *
 * The visible consequence is the one the phase doc wants: a cold run and a warm run of the
 * same URL draw differently, because the warm one genuinely did not speak to the root, and
 * a fresh cache hit draws a browser on its own, because it genuinely spoke to nobody.
 *
 * Every address here is from the ranges RFC 5737 reserves for documentation, so no example
 * address in this module can be mistaken for a real host. Nothing in this file, or any file
 * it is imported by, opens a socket.
 */

import type { SimEvent } from '@/core/types/events';
import type { SimLink, SimNode, Topology } from '@/core/types/topology';

import {
  BROWSER_NODE,
  DNS_AUTH_NODE,
  DNS_ROOT_NODE,
  DNS_TLD_NODE,
  EDGE_NODE,
  linkId,
  ORIGIN_NODE,
  RESOLVER_NODE,
  round2,
  type NetworkProfile,
  type SimulatorScenario,
} from './stage';

/** The client's own address, and the resolver it is configured to ask. */
export const BROWSER_ADDRESS = '198.51.100.10';
/** The recursive resolver -- one hop away, on the same network as the client. */
export const RESOLVER_ADDRESS = '198.51.100.53';

/** Virtual milliseconds to the local resolver. It is near, and that is the point. */
export const RESOLVER_LATENCY_MS = 0.5;

/** The node the browser's connection actually terminates at. */
export function firstHopNode(scenario: SimulatorScenario): string {
  return scenario.cdn ? EDGE_NODE : ORIGIN_NODE;
}

function node(init: SimNode): SimNode {
  return init;
}

function link(
  from: string,
  to: string,
  latencyMs: number,
  profile: NetworkProfile,
  medium: SimLink['medium'],
): SimLink {
  return {
    id: linkId(from, to),
    from,
    to,
    latencyMs: round2(latencyMs),
    bandwidthMbps: round2(profile.bandwidthKbps / 1000),
    medium,
  };
}

/** What the link is, physically, for the profile in use. */
function mediumFor(profile: NetworkProfile): SimLink['medium'] {
  if (profile.id === '4g' || profile.id === '3g') return 'cellular';
  return 'fiber';
}

/**
 * Every machine this scenario could possibly touch, and the links between them.
 *
 * A superset. {@link pruneTopology} cuts it down to what the run really did.
 */
export function buildTopology(
  scenario: SimulatorScenario,
  profile: NetworkProfile,
): Topology {
  const oneWay = round2(profile.rttMs / 2);
  const medium = mediumFor(profile);
  const peer = firstHopNode(scenario);

  const nodes: SimNode[] = [
    node({
      id: BROWSER_NODE,
      kind: 'client',
      label: 'Browser',
      ipv4: BROWSER_ADDRESS,
      detail: {
        role: 'parses the URL, asks the caches, then asks the network',
        link: `${profile.label} -- ${profile.rttMs} ms round trip, ${Math.round(profile.bandwidthKbps / 1000)} Mbit/s`,
      },
    }),
    node({
      id: RESOLVER_NODE,
      kind: 'dns-resolver',
      label: 'Recursive resolver',
      ipv4: RESOLVER_ADDRESS,
      detail: {
        role: 'does the walking so the client does not have to',
        recursion: 'one question in, however many queries it takes out',
      },
    }),
    node({
      id: DNS_ROOT_NODE,
      kind: 'dns-root',
      label: 'Root servers',
      detail: {
        knows: 'which servers are authoritative for each top-level domain',
        'does not know': 'any address you actually want',
      },
    }),
    node({
      id: DNS_TLD_NODE,
      kind: 'dns-tld',
      label: 'TLD servers',
      detail: { knows: 'which servers are authoritative for each zone under it' },
    }),
    node({
      id: DNS_AUTH_NODE,
      kind: 'dns-authoritative',
      label: 'Authoritative servers',
      detail: { knows: 'the records themselves -- this is where the answer comes from' },
    }),
  ];

  if (scenario.cdn) {
    nodes.push(
      node({
        id: EDGE_NODE,
        kind: 'cdn-edge',
        label: scenario.cdn.label ?? 'CDN edge',
        ipv4: scenario.cdn.address,
        detail: {
          role: 'terminates the connection close to the user and answers if it can',
          'to the origin': `${scenario.cdn.originRttMs} ms round trip`,
          cache: 'shared -- it holds everybody’s copy, not just this user’s',
        },
      }),
    );
  }

  nodes.push(
    node({
      id: ORIGIN_NODE,
      kind: 'server',
      label: scenario.origin.label ?? 'Origin server',
      ipv4: scenario.origin.address,
      detail: {
        role: 'holds the page itself',
        'think time': `${scenario.origin.document.serverThinkMs ?? 20} ms to produce the document`,
      },
    }),
  );

  const links: SimLink[] = [
    link(BROWSER_NODE, RESOLVER_NODE, RESOLVER_LATENCY_MS, profile, 'ethernet'),
    link(RESOLVER_NODE, DNS_ROOT_NODE, oneWay, profile, medium),
    link(RESOLVER_NODE, DNS_TLD_NODE, oneWay, profile, medium),
    link(RESOLVER_NODE, DNS_AUTH_NODE, oneWay, profile, medium),
    link(BROWSER_NODE, peer, oneWay, profile, medium),
  ];

  if (scenario.cdn) {
    links.push(
      link(EDGE_NODE, ORIGIN_NODE, scenario.cdn.originRttMs / 2, profile, 'fiber'),
    );
  }

  return { nodes, links };
}

/** Every node id any event in the run names. */
export function nodesUsedBy(events: readonly SimEvent[]): Set<string> {
  const used = new Set<string>([BROWSER_NODE]);
  for (const event of events) {
    switch (event.kind) {
      case 'transmit':
        used.add(event.from);
        used.add(event.to);
        break;
      case 'node-state':
        used.add(event.nodeId);
        break;
      case 'pdu-created':
      case 'pdu-transform':
        used.add(event.atNode);
        break;
      case 'drop':
        used.add(event.atNode);
        break;
      default:
        break;
    }
  }
  return used;
}

/**
 * Cut the topology down to the machines this run actually involved.
 *
 * A link survives only if both its ends did, so a diagram never draws a wire into empty
 * space. The order of `nodes` is preserved, because it is the order a learner should be
 * introduced to them in.
 */
export function pruneTopology(topology: Topology, used: ReadonlySet<string>): Topology {
  const nodes = topology.nodes.filter((candidate) => used.has(candidate.id));
  const kept = new Set(nodes.map((candidate) => candidate.id));
  const links = topology.links.filter(
    (candidate) => kept.has(candidate.from) && kept.has(candidate.to),
  );
  return { nodes, links };
}
