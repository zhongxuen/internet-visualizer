/**
 * The toy run -- one small, complete simulation to build the renderer against.
 *
 * A laptop pings an echo server two hops away: the packet is built, it crosses the LAN,
 * a router decrements its TTL and forwards it over the WAN, and a reply comes back the
 * same way. Three phases, two links, one PDU each direction. Small enough to reason
 * about by hand, complete enough to exercise every part of the visualization layer --
 * phase stepping, packets in flight on two different links, node states changing, a
 * header rewrite at a hop, annotations, and a log.
 *
 * ## Why this is written by hand
 *
 * Phase 03's kernel (`simulation.ts`, `builder.ts`) is not built yet; `result.ts` and
 * `project.ts` are the halves of the contract that exist. Rather than block phase 04 on
 * it, this file hand-authors the `SimResult` that a two-node ping scenario will produce,
 * so the renderer can be built and demonstrated against the real shape of the data.
 *
 * When the kernel lands, this becomes `Simulation.run(pingScenario)` and everything
 * downstream is unaffected -- nothing in the visualization layer knows or cares where a
 * `SimResult` came from. That is the whole point of the event contract.
 *
 * Deterministic by construction: fixed numbers, no clock, no RNG. `buildToyRun()`
 * returns a fresh object every call so a caller cannot mutate the shared one, and two
 * calls are deep-equal.
 */

import type { SimEvent } from '../types/events';
import type { PDU, ProtocolLayer } from '../types/pdu';
import type { Topology } from '../types/topology';

import { summarizePhases, type SimResult } from './result';

const LAPTOP_MAC = 'a4:83:e7:1c:9f:20';
const ROUTER_LAN_MAC = 'f0:9f:c2:11:04:aa';

/** The three machines, laid out by `layoutTopology` as one column per hop. */
export const TOY_TOPOLOGY: Topology = {
  nodes: [
    {
      id: 'laptop',
      kind: 'client',
      label: 'Laptop',
      ipv4: '192.168.1.24',
      mac: LAPTOP_MAC,
      detail: {
        Role: 'The machine the learner is sitting at',
        Gateway: '192.168.1.1',
      },
    },
    {
      id: 'router',
      kind: 'router',
      label: 'Home router',
      ipv4: '192.168.1.1',
      mac: ROUTER_LAN_MAC,
      detail: {
        'WAN address': '203.0.113.7',
        Job: 'Forwards packets between the home network and the Internet',
      },
    },
    {
      id: 'echo',
      kind: 'server',
      label: 'echo.example.net',
      ipv4: '198.51.100.42',
      detail: {
        Service: 'Replies to ICMP echo requests',
        Note: 'Simulated. No real host is contacted.',
      },
    },
  ],
  links: [
    {
      id: 'link-lan',
      from: 'laptop',
      to: 'router',
      latencyMs: 1,
      bandwidthMbps: 1000,
      medium: 'wifi',
    },
    {
      id: 'link-wan',
      from: 'router',
      to: 'echo',
      latencyMs: 24,
      bandwidthMbps: 200,
      medium: 'fiber',
    },
  ],
};

function ethernet(source: string, destination: string): ProtocolLayer {
  return {
    layer: 'link',
    protocol: 'Ethernet II',
    fields: [
      {
        name: 'Destination MAC',
        value: destination,
        bits: 48,
        note: 'The next hop on this wire -- rewritten at every hop.',
      },
      {
        name: 'Source MAC',
        value: source,
        bits: 48,
        note: 'The interface that put the frame on the wire.',
      },
      {
        name: 'EtherType',
        value: '0x0800 (IPv4)',
        bits: 16,
        note: 'Tells the receiver which protocol the payload is.',
      },
    ],
  };
}

function ipv4(source: string, destination: string, ttl: number): ProtocolLayer {
  return {
    layer: 'network',
    protocol: 'IPv4',
    fields: [
      { name: 'Version', value: '4', bits: 4 },
      {
        name: 'IHL',
        value: '5 (20 bytes)',
        bits: 4,
        note: 'Header length in 32-bit words.',
      },
      {
        name: 'Total Length',
        value: '84',
        bits: 16,
        note: 'Header plus payload, in bytes.',
      },
      {
        name: 'TTL',
        value: String(ttl),
        bits: 8,
        note: 'Every router subtracts one. At zero the packet is dropped, which is what stops routing loops.',
      },
      { name: 'Protocol', value: '1 (ICMP)', bits: 8 },
      {
        name: 'Header Checksum',
        value: ttl === 64 ? '0x4c1a' : '0x4d1a',
        bits: 16,
        note: 'Covers the header only, so it must be recomputed whenever a router changes the TTL.',
      },
      { name: 'Source', value: source, bits: 32 },
      { name: 'Destination', value: destination, bits: 32 },
    ],
  };
}

function icmp(type: 'request' | 'reply', sequence: number): ProtocolLayer {
  return {
    layer: 'network',
    protocol: 'ICMP',
    fields: [
      {
        name: 'Type',
        value: type === 'request' ? '8 (Echo request)' : '0 (Echo reply)',
        bits: 8,
      },
      { name: 'Code', value: '0', bits: 8 },
      { name: 'Checksum', value: type === 'request' ? '0x1e5b' : '0x265b', bits: 16 },
      {
        name: 'Identifier',
        value: '0x4a21',
        bits: 16,
        note: 'Lets the sender match a reply to the process that asked for it.',
      },
      {
        name: 'Sequence',
        value: String(sequence),
        bits: 16,
        note: 'Counts up per request, so a lost packet shows as a gap.',
      },
    ],
    payloadPreview: '56 bytes of timestamp and padding',
  };
}

/** The echo request as it leaves the laptop: full TTL, LAN framing. */
function echoRequest(ttl: number): PDU {
  return {
    id: 'echo-request',
    layers: [
      ethernet(LAPTOP_MAC, ROUTER_LAN_MAC),
      ipv4('192.168.1.24', '198.51.100.42', ttl),
      icmp('request', 1),
    ],
    sizeBytes: 98,
    summary: 'ICMP echo request 192.168.1.24 -> 198.51.100.42',
  };
}

function echoReply(ttl: number): PDU {
  return {
    id: 'echo-reply',
    layers: [
      ethernet(ROUTER_LAN_MAC, LAPTOP_MAC),
      ipv4('198.51.100.42', '192.168.1.24', ttl),
      icmp('reply', 1),
    ],
    sizeBytes: 98,
    summary: 'ICMP echo reply 198.51.100.42 -> 192.168.1.24',
  };
}

/** Far end of the timeline: a little past the last event, so the reply can be read. */
const DURATION_MS = 120;

function toyEvents(): SimEvent[] {
  return [
    // --- Phase 1: the laptop builds the packet -----------------------------------
    {
      kind: 'phase',
      at: 0,
      id: 'compose',
      title: 'Building the packet',
      description:
        'The laptop wraps an ICMP echo request in an IPv4 header, then in an Ethernet frame addressed to its gateway.',
    },
    {
      kind: 'node-state',
      at: 0,
      nodeId: 'laptop',
      state: 'processing',
      note: 'building headers',
    },
    { kind: 'pdu-created', at: 0, pdu: echoRequest(64), atNode: 'laptop' },
    {
      kind: 'annotate',
      at: 0,
      targetId: 'laptop',
      text: 'The destination MAC is the router, not the server: Ethernet only ever addresses the next hop.',
      reference: { rfc: 792, title: 'Internet Control Message Protocol' },
    },
    { kind: 'log', at: 0, level: 'info', text: 'ping echo.example.net (198.51.100.42)' },
    { kind: 'node-state', at: 8, nodeId: 'laptop', state: 'active' },

    // --- Phase 2: the request crosses two links ----------------------------------
    {
      kind: 'phase',
      at: 10,
      id: 'request',
      title: 'Echo request travels',
      description:
        'One hop over Wi-Fi to the router, which decrements the TTL and forwards it over fiber to the server.',
    },
    {
      kind: 'transmit',
      at: 10,
      pduId: 'echo-request',
      from: 'laptop',
      to: 'router',
      durationMs: 6,
      linkId: 'link-lan',
    },
    {
      kind: 'node-state',
      at: 16,
      nodeId: 'router',
      state: 'processing',
      note: 'routing decision',
    },
    {
      kind: 'pdu-transform',
      at: 16,
      pduId: 'echo-request',
      before: echoRequest(64),
      after: echoRequest(63),
      atNode: 'router',
      reason: 'TTL decremented and header checksum recomputed',
    },
    {
      kind: 'annotate',
      at: 16,
      targetId: 'router',
      text: 'The router rewrites the frame around the packet but leaves the IP addresses alone -- that is the difference between a hop and an endpoint.',
      reference: { rfc: 791, section: '3.2', title: 'Internet Protocol' },
    },
    {
      kind: 'log',
      at: 16,
      level: 'info',
      text: 'router: forwarding to 198.51.100.42, TTL 64 -> 63',
    },
    { kind: 'node-state', at: 24, nodeId: 'router', state: 'active' },
    {
      kind: 'transmit',
      at: 24,
      pduId: 'echo-request',
      from: 'router',
      to: 'echo',
      durationMs: 30,
      linkId: 'link-wan',
    },
    { kind: 'node-state', at: 54, nodeId: 'router', state: 'idle' },
    {
      kind: 'node-state',
      at: 54,
      nodeId: 'echo',
      state: 'processing',
      note: 'assembling reply',
    },
    { kind: 'log', at: 54, level: 'info', text: 'echo.example.net: request received' },

    // --- Phase 3: the reply comes back -------------------------------------------
    {
      kind: 'phase',
      at: 60,
      id: 'reply',
      title: 'Echo reply returns',
      description:
        'The server swaps source and destination and sends the same payload back along the same path.',
    },
    { kind: 'pdu-created', at: 60, pdu: echoReply(64), atNode: 'echo' },
    { kind: 'node-state', at: 60, nodeId: 'echo', state: 'active' },
    {
      kind: 'annotate',
      at: 60,
      targetId: 'echo',
      text: 'The reply reuses the identifier and sequence number from the request, which is how the laptop knows which ping it answers.',
      reference: { rfc: 792, title: 'Internet Control Message Protocol' },
    },
    {
      kind: 'transmit',
      at: 60,
      pduId: 'echo-reply',
      from: 'echo',
      to: 'router',
      durationMs: 30,
      linkId: 'link-wan',
    },
    {
      kind: 'node-state',
      at: 90,
      nodeId: 'router',
      state: 'processing',
      note: 'routing decision',
    },
    {
      kind: 'pdu-transform',
      at: 90,
      pduId: 'echo-reply',
      before: echoReply(64),
      after: echoReply(63),
      atNode: 'router',
      reason: 'TTL decremented and header checksum recomputed',
    },
    { kind: 'node-state', at: 96, nodeId: 'router', state: 'active' },
    {
      kind: 'transmit',
      at: 96,
      pduId: 'echo-reply',
      from: 'router',
      to: 'laptop',
      durationMs: 6,
      linkId: 'link-lan',
    },
    { kind: 'node-state', at: 102, nodeId: 'router', state: 'idle' },
    { kind: 'node-state', at: 102, nodeId: 'echo', state: 'idle' },
    { kind: 'node-state', at: 102, nodeId: 'laptop', state: 'active' },
    {
      kind: 'log',
      at: 102,
      level: 'info',
      text: '64 bytes from 198.51.100.42: icmp_seq=1 ttl=63 time=92 ms',
    },
    {
      kind: 'annotate',
      at: 102,
      targetId: 'laptop',
      text: 'The round trip is 92 ms of virtual time: two 1 ms Wi-Fi hops, two 24 ms fiber hops, and the time to clock 98 bytes onto each wire.',
    },
  ];
}

/**
 * Build the toy `SimResult`.
 *
 * A function rather than a constant so every caller gets its own object: a demo route, a
 * test, and a story can each hold one without being able to mutate the others.
 */
export function buildToyRun(): SimResult {
  const events = toyEvents();

  return {
    events,
    phases: summarizePhases(events, DURATION_MS),
    durationMs: DURATION_MS,
    // The PDUs as created. A `pdu-transform` carries its own before/after by value, so
    // the inspector can show what a hop changed without this map having to track it.
    pdus: {
      'echo-request': echoRequest(64),
      'echo-reply': echoReply(64),
    },
  };
}
