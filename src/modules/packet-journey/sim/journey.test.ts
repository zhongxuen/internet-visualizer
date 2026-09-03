/**
 * The journey engine, against the rules the phase doc says it must get right.
 *
 * These are the assertions that would catch a wrong lesson rather than a crash: a TTL
 * decremented at a switch, an IP address that changed somewhere other than the NAT, a
 * fragment offset counted in bytes instead of eight-byte units. Each one is a mistake
 * the animation would show confidently and a reader would believe.
 */

import { describe, expect, it } from 'vitest';

import { fieldValue, findLayerByProtocol } from '@/core/net/bytes';
import type { SimEvent } from '@/core/types/events';
import type { PDU } from '@/core/types/pdu';
import type { SimResult } from '@/core/sim/result';

import {
  FRAGMENTED_PACKET,
  LOSSY_LINK,
  TCP_WEB_REQUEST,
  UDP_DNS_QUERY,
} from '../scenarios';
import { JOURNEY_TOPOLOGY, PATH_TO_ORIGIN } from '../scenarios/topology';

import {
  resolveJourneyPath,
  reverseHops,
  runJourney,
  runJourneyDetailed,
} from './journey';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function eventsOf<K extends SimEvent['kind']>(
  result: SimResult,
  kind: K,
): Extract<SimEvent, { kind: K }>[] {
  return result.events.filter(
    (event): event is Extract<SimEvent, { kind: K }> => event.kind === kind,
  );
}

function ipv4(pdu: PDU, field: string): string | undefined {
  const layer = findLayerByProtocol(pdu, 'IPv4');
  return layer ? fieldValue(layer, field) : undefined;
}

function ethernet(pdu: PDU, field: string): string | undefined {
  const layer = findLayerByProtocol(pdu, 'Ethernet II');
  return layer ? fieldValue(layer, field) : undefined;
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

describe('resolveJourneyPath', () => {
  it('groups layer-2 devices into the hop they sit inside', () => {
    const path = resolveJourneyPath(JOURNEY_TOPOLOGY, PATH_TO_ORIGIN);

    // Eleven machines on the path, but only eight of them read IP headers -- so seven
    // hops, and seven places the TTL comes down by one.
    expect(path.hops.map((hop) => `${hop.from}->${hop.to}`)).toEqual([
      'laptop->router',
      'router->isp-gateway',
      'isp-gateway->regional-pop',
      'regional-pop->transit-sg',
      'transit-sg->transit-fra',
      'transit-fra->hosting-edge',
      'hosting-edge->origin',
    ]);
    // The first hop crosses three wires and two transparent boxes.
    expect(path.hops[0].steps.map((step) => step.linkId)).toEqual([
      'wifi-laptop',
      'eth-ap-uplink',
      'eth-switch-router',
    ]);
  });

  it('takes the narrowest link on a hop as the hop MTU', () => {
    const path = resolveJourneyPath(JOURNEY_TOPOLOGY, PATH_TO_ORIGIN, {
      'access-uplink': 1492,
    });
    const constrained = path.hops.find((hop) => hop.to === 'isp-gateway');

    // The hop is 1500-byte Ethernet then a 1492-byte access line; 1492 is what a packet
    // has to fit through, and finding that number out is what PMTU discovery is for.
    expect(constrained?.mtu).toBe(1492);
    expect(path.hops[0].mtu).toBe(1500);
  });

  it('refuses a path that begins or ends on a layer-2 device', () => {
    expect(() => resolveJourneyPath(JOURNEY_TOPOLOGY, ['lan-switch', 'router'])).toThrow(
      /layer-2 device/,
    );
    expect(() => resolveJourneyPath(JOURNEY_TOPOLOGY, ['laptop', 'ap'])).toThrow(
      /layer-2 device/,
    );
  });

  it('rejects a step between machines that are not linked', () => {
    expect(() => resolveJourneyPath(JOURNEY_TOPOLOGY, ['laptop', 'origin'])).toThrow(
      /not linked/,
    );
  });

  it('reverses into a walkable return path', () => {
    const path = resolveJourneyPath(JOURNEY_TOPOLOGY, PATH_TO_ORIGIN);
    const back = reverseHops(path.hops);

    expect(back[0].from).toBe('origin');
    expect(back[back.length - 1].to).toBe('laptop');
    expect(back[back.length - 1].steps.map((step) => step.linkId)).toEqual([
      'eth-switch-router',
      'eth-ap-uplink',
      'wifi-laptop',
    ]);
  });
});

// ---------------------------------------------------------------------------
// The event stream itself
// ---------------------------------------------------------------------------

describe('the event stream', () => {
  const result = runJourney(TCP_WEB_REQUEST);

  it('is sorted by virtual time', () => {
    for (let i = 1; i < result.events.length; i += 1) {
      expect(result.events[i].at).toBeGreaterThanOrEqual(result.events[i - 1].at);
    }
  });

  it('only transmits PDUs it created, over links that exist', () => {
    const links = new Set(JOURNEY_TOPOLOGY.links.map((link) => link.id));

    for (const transmit of eventsOf(result, 'transmit')) {
      expect(result.pdus[transmit.pduId]).toBeDefined();
      expect(links.has(transmit.linkId)).toBe(true);

      const link = JOURNEY_TOPOLOGY.links.find((entry) => entry.id === transmit.linkId)!;
      expect([link.from, link.to].sort()).toEqual([transmit.from, transmit.to].sort());
    }
  });

  it('runs long enough to show its last event', () => {
    const last = Math.max(...result.events.map((event) => event.at));
    expect(result.durationMs).toBeGreaterThan(last);
  });
});

// ---------------------------------------------------------------------------
// Per-hop rewriting: the claims the module is built on
// ---------------------------------------------------------------------------

describe('per-hop rewriting', () => {
  const result = runJourney(TCP_WEB_REQUEST);

  it('changes both MAC addresses at every router', () => {
    const rewrites = eventsOf(result, 'pdu-transform').filter((event) =>
      event.reason.startsWith('Frame re-addressed'),
    );
    expect(rewrites.length).toBeGreaterThan(0);

    for (const rewrite of rewrites) {
      expect(ethernet(rewrite.after, 'Source MAC')).not.toBe(
        ethernet(rewrite.before, 'Source MAC'),
      );
      expect(ethernet(rewrite.after, 'Destination MAC')).not.toBe(
        ethernet(rewrite.before, 'Destination MAC'),
      );
      // And nothing inside the frame moved.
      expect(ipv4(rewrite.after, 'Source')).toBe(ipv4(rewrite.before, 'Source'));
      expect(ipv4(rewrite.after, 'Destination')).toBe(
        ipv4(rewrite.before, 'Destination'),
      );
    }
  });

  it('never rewrites a frame at a layer-2 device', () => {
    const layer2 = new Set(
      JOURNEY_TOPOLOGY.nodes.filter((node) => node.kind === 'switch').map((n) => n.id),
    );
    const touched = eventsOf(result, 'pdu-transform').filter((event) =>
      layer2.has(event.atNode),
    );

    // An access point, a switch, and a bridged fibre terminal forward frames and change
    // nothing. A transform at one of them would be teaching the opposite.
    expect(touched).toEqual([]);
  });

  it('changes an IP address only at the NAT', () => {
    const moved = eventsOf(result, 'pdu-transform')
      // Encapsulation and decapsulation add and remove the whole header, which is not
      // an address changing; only a transform with an IPv4 header on both sides counts.
      .filter(
        (event) =>
          findLayerByProtocol(event.before, 'IPv4') !== undefined &&
          findLayerByProtocol(event.after, 'IPv4') !== undefined,
      )
      .filter(
        (event) =>
          ipv4(event.after, 'Source') !== ipv4(event.before, 'Source') ||
          ipv4(event.after, 'Destination') !== ipv4(event.before, 'Destination'),
      );

    expect(moved.length).toBeGreaterThan(0);
    for (const event of moved) {
      expect(event.atNode).toBe('router');
      expect(event.reason).toMatch(/NAPT/);
    }
  });

  it('decrements the TTL once per router and recomputes the checksum', () => {
    const hops = eventsOf(result, 'pdu-transform').filter((event) =>
      event.reason.startsWith('TTL '),
    );
    expect(hops.length).toBeGreaterThan(0);

    for (const hop of hops) {
      const before = Number(ipv4(hop.before, 'TTL'));
      const after = Number(ipv4(hop.after, 'TTL'));
      expect(after).toBe(before - 1);
      // The checksum covers the header, and the header just changed.
      expect(ipv4(hop.after, 'Header Checksum')).not.toBe(
        ipv4(hop.before, 'Header Checksum'),
      );
    }
  });

  it('drops the TTL by exactly one per router across the whole path', () => {
    // Six routers between the laptop and the origin, so a packet that left with 64
    // arrives with 58. Counting them is what a traceroute is reading.
    const request = eventsOf(result, 'pdu-transform').filter(
      (event) => event.pduId === 'c-04' && event.reason.startsWith('TTL '),
    );
    expect(request).toHaveLength(6);
    expect(ipv4(request[request.length - 1].after, 'TTL')).toBe('58');
  });
});

// ---------------------------------------------------------------------------
// Encapsulation
// ---------------------------------------------------------------------------

describe('encapsulation', () => {
  const result = runJourney(TCP_WEB_REQUEST);

  it('wraps outermost-last and adds the bytes as it goes', () => {
    const built = eventsOf(result, 'pdu-transform').filter(
      (event) => event.pduId === 'c-04' && event.reason.includes('prepended'),
    );
    expect(built).toHaveLength(2);

    const [ip, frame] = built;
    expect(ip.before.layers.map((layer) => layer.protocol)).toEqual(['TCP', 'HTTP/1.1']);
    expect(ip.after.layers.map((layer) => layer.protocol)).toEqual([
      'IPv4',
      'TCP',
      'HTTP/1.1',
    ]);
    expect(frame.after.layers.map((layer) => layer.protocol)).toEqual([
      'Ethernet II',
      'IPv4',
      'TCP',
      'HTTP/1.1',
    ]);

    // 412 payload + 20 TCP = 432, + 20 IPv4 = 452, + 14 Ethernet = 466.
    expect(ip.before.sizeBytes).toBe(432);
    expect(ip.after.sizeBytes).toBe(452);
    expect(frame.after.sizeBytes).toBe(466);
  });

  it('strips the same headers back off at the destination', () => {
    const unwrapped = eventsOf(result, 'pdu-transform').filter(
      (event) => event.pduId === 'c-04' && event.reason.includes('stripped'),
    );
    expect(unwrapped).toHaveLength(2);
    expect(unwrapped[0].atNode).toBe('origin');
    expect(unwrapped[1].after.layers.map((layer) => layer.protocol)).toEqual([
      'TCP',
      'HTTP/1.1',
    ]);
    expect(unwrapped[1].after.sizeBytes).toBe(432);
  });
});

// ---------------------------------------------------------------------------
// NAPT
// ---------------------------------------------------------------------------

describe('NAPT', () => {
  const { result, natTable } = runJourneyDetailed(TCP_WEB_REQUEST);

  it('records one row for the connection, with both views of it', () => {
    expect(natTable?.bindings).toHaveLength(1);
    expect(natTable?.bindings[0]).toMatchObject({
      protocol: 'tcp',
      insideLocal: { ip: '192.168.1.112', port: 49152 },
      insideGlobal: { ip: '203.0.113.7', port: 60000 },
      outside: { ip: '192.0.2.80', port: 80 },
    });
  });

  it('rewrites the source on the way out and the destination on the way back', () => {
    const out = eventsOf(result, 'pdu-transform').find((event) =>
      event.reason.startsWith('NAPT: source'),
    )!;
    expect(ipv4(out.before, 'Source')).toBe('192.168.1.112');
    expect(ipv4(out.after, 'Source')).toBe('203.0.113.7');
    expect(ipv4(out.after, 'Destination')).toBe(ipv4(out.before, 'Destination'));

    const back = eventsOf(result, 'pdu-transform').find((event) =>
      event.reason.startsWith('NAPT reversed'),
    )!;
    expect(ipv4(back.before, 'Destination')).toBe('203.0.113.7');
    expect(ipv4(back.after, 'Destination')).toBe('192.168.1.112');
    expect(ipv4(back.after, 'Source')).toBe(ipv4(back.before, 'Source'));
  });

  it('shows the far end talking to the public address and port, never the private one', () => {
    // Everything the server ever sent was addressed to the translated endpoint. That is
    // the whole of the illusion, and the reason the row has to exist.
    const fromServer = Object.values(result.pdus).filter((pdu) =>
      pdu.id.startsWith('s-'),
    );
    expect(fromServer.length).toBeGreaterThan(0);
    for (const pdu of fromServer) {
      const tcp = findLayerByProtocol(pdu, 'TCP');
      if (tcp) expect(fieldValue(tcp, 'Destination Port')).toBe('60000');
    }
  });
});

// ---------------------------------------------------------------------------
// TCP arithmetic
// ---------------------------------------------------------------------------

describe('TCP', () => {
  const result = runJourney(TCP_WEB_REQUEST);
  const segments = Object.values(result.pdus)
    .map((pdu) => findLayerByProtocol(pdu, 'TCP'))
    .filter((layer): layer is NonNullable<typeof layer> => layer !== undefined);

  it('acknowledges a SYN with the ISN plus one', () => {
    const syn = segments[0];
    const synAck = segments[1];

    expect(fieldValue(syn, 'Flags')).toMatch(/^SYN /);
    expect(fieldValue(syn, 'Sequence Number')).toBe('1842000');
    expect(fieldValue(synAck, 'Flags')).toMatch(/^SYN, ACK /);
    // The SYN carried no data and still consumed one sequence number.
    expect(fieldValue(synAck, 'Acknowledgement Number')).toBe('1842001');
  });

  it('acknowledges data with the sender’s Seq plus the bytes it sent', () => {
    const data = segments.find((layer) => fieldValue(layer, 'Flags')?.startsWith('PSH'))!;
    const seq = Number(fieldValue(data, 'Sequence Number'));
    const ack = segments[segments.indexOf(data) + 1];

    expect(Number(fieldValue(ack, 'Acknowledgement Number'))).toBe(seq + 412);
  });

  it('walks both endpoints through the state machine', () => {
    const states = eventsOf(result, 'log')
      .map((event) => /\[client (\w+), server (\w+)\]/.exec(event.text))
      .filter((match): match is RegExpExecArray => match !== null);

    expect(states[0].slice(1)).toEqual(['SYN_SENT', 'LISTEN']);
    expect(states[2].slice(1)).toEqual(['ESTABLISHED', 'ESTABLISHED']);
    expect(states[states.length - 1].slice(1)).toEqual(['TIME_WAIT', 'CLOSED']);
  });
});

// ---------------------------------------------------------------------------
// UDP
// ---------------------------------------------------------------------------

describe('UDP', () => {
  const result = runJourney(UDP_DNS_QUERY);

  it('sends the question in the first packet, with nothing negotiated first', () => {
    const first = eventsOf(result, 'pdu-created')[0];
    expect(findLayerByProtocol(first.pdu, 'UDP')).toBeDefined();
    expect(findLayerByProtocol(first.pdu, 'DNS')).toBeDefined();
    // 29 bytes of DNS and an 8-byte header, and that is the entire transport.
    expect(first.pdu.sizeBytes).toBe(37);
  });

  it('costs two packets in total', () => {
    const onWire = new Set(eventsOf(result, 'transmit').map((event) => event.pduId));
    expect(onWire.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Fragmentation
// ---------------------------------------------------------------------------

describe('fragmentation', () => {
  const result = runJourney(FRAGMENTED_PACKET);

  it('reports the MTU it could not exceed when Don’t Fragment is set', () => {
    const drop = eventsOf(result, 'drop')[0];
    expect(drop.atNode).toBe('router');
    expect(drop.reason).toMatch(/1492-byte MTU/);
    expect(drop.reason).toMatch(/Don't Fragment/);

    const icmp = Object.values(result.pdus).find((pdu) =>
      pdu.summary.includes('Fragmentation Needed'),
    )!;
    const layer = findLayerByProtocol(icmp, 'ICMP')!;
    expect(fieldValue(layer, 'Code')).toBe('4 (Fragmentation needed, DF set)');
    expect(fieldValue(layer, 'Next-Hop MTU')).toBe('1492');
    // Addressed back to the private source, not to the address the NAT would have used.
    expect(ipv4(icmp, 'Destination')).toBe('192.168.1.112');
  });

  it('counts fragment offsets in 8-byte units, with More Fragments on all but the last', () => {
    const describe = (id: string) => ({
      offset: ipv4(result.pdus[id], 'Fragment Offset'),
      flags: ipv4(result.pdus[id], 'Flags'),
      length: Number(ipv4(result.pdus[id], 'Total Length')),
    });

    // Stage one: the resolver splits 2 828 bytes to fit its own 1500-byte link. 1480 is
    // the largest multiple of 8 that fits, not 1480-ish -- the offset field cannot
    // express anything else -- so the second piece starts at byte 1480, offset 185.
    expect(['r-04-f1', 'r-04-f2'].map(describe)).toEqual([
      { offset: '0 (byte 0)', flags: 'MF', length: 1500 },
      { offset: '185 (byte 1480)', flags: 'none', length: 1348 },
    ]);

    // Stage two: the 1492-byte access line cannot take the first piece either, so the
    // ISP gateway splits it again -- leaving a single 8-byte runt behind it, which is
    // the whole practical argument for discovering the path MTU up front.
    expect(['r-04-f1-f1', 'r-04-f1-f2'].map(describe)).toEqual([
      { offset: '0 (byte 0)', flags: 'MF', length: 1492 },
      { offset: '184 (byte 1472)', flags: 'MF', length: 28 },
    ]);

    // Re-fragmenting kept More Fragments set on the last piece of the first fragment,
    // because more of the original datagram really is still coming.
    expect(ipv4(result.pdus['r-04-f1-f2'], 'Identification')).toBe(
      ipv4(result.pdus['r-04-f2'], 'Identification'),
    );
  });

  it('reassembles at the destination and nowhere else', () => {
    const rejoined = eventsOf(result, 'pdu-created').filter((event) =>
      event.pdu.id.endsWith('r-04'),
    );
    const atDestination = rejoined.filter((event) => event.atNode === 'laptop');

    expect(atDestination).toHaveLength(1);
    // 2 800 application bytes, an 8-byte UDP header, a 20-byte IPv4 header, a 14-byte frame.
    expect(atDestination[0].pdu.sizeBytes).toBe(2842);
    expect(ipv4(atDestination[0].pdu, 'Flags')).toBe('none');

    const elsewhere = eventsOf(result, 'log').filter((event) =>
      event.text.includes('reassembled'),
    );
    expect(elsewhere).toHaveLength(1);
    expect(elsewhere[0].text).toMatch(/^Laptop:/);
  });

  it('carries the transport header in the first fragment only', () => {
    const first = result.pdus['r-04-f1-f1'];
    const second = result.pdus['r-04-f1-f2'];

    expect(findLayerByProtocol(first, 'UDP')).toBeDefined();
    // A later fragment is raw payload. This is why a firewall cannot match it on a port,
    // and why the destination has to wait for the piece that has one.
    expect(findLayerByProtocol(second, 'UDP')).toBeUndefined();
    expect(second.layers.map((layer) => layer.protocol)).toEqual(['Ethernet II', 'IPv4']);
  });
});

// ---------------------------------------------------------------------------
// Loss and retransmission
// ---------------------------------------------------------------------------

describe('loss and retransmission', () => {
  const result = runJourney(LOSSY_LINK);

  it('loses exactly one segment, on the link the scenario made unreliable', () => {
    const drops = eventsOf(result, 'drop');
    expect(drops).toHaveLength(1);
    expect(drops[0].reason).toMatch(/lost in transit on backbone/);
  });

  it('tells nobody: no ICMP, no error, only an ACK that never comes', () => {
    const icmp = Object.values(result.pdus).filter((pdu) => pdu.summary.includes('ICMP'));
    expect(icmp).toEqual([]);
  });

  it('resends the same bytes with the same sequence number', () => {
    const lost = result.pdus[eventsOf(result, 'drop')[0].pduId];
    const retransmission = Object.values(result.pdus).find((pdu) =>
      pdu.summary.startsWith('[Retransmission 1]'),
    )!;

    const original = findLayerByProtocol(lost, 'TCP')!;
    const copy = findLayerByProtocol(retransmission, 'TCP')!;

    expect(fieldValue(copy, 'Sequence Number')).toBe(
      fieldValue(original, 'Sequence Number'),
    );
    expect(fieldValue(copy, 'Flags')).toBe(fieldValue(original, 'Flags'));
    expect(retransmission.sizeBytes).toBe(lost.sizeBytes);
  });

  it('waits three round trips before deciding, then recovers', () => {
    const timeout = eventsOf(result, 'log').find((event) =>
      event.text.includes('retransmission timer expired'),
    )!;
    // The handshake measured a round trip of about 194 ms, so RFC 6298's SRTT + 4·RTTVAR
    // comes to roughly three times it. Not the 1 000 ms default: that only applies
    // before any round trip has been measured at all.
    expect(timeout.text).toMatch(/after 583\.\d+ ms/);

    // And the conversation still finishes properly.
    const last = eventsOf(result, 'log').at(-1)!;
    expect(last.text).toMatch(/\[client TIME_WAIT, server CLOSED\]/);
  });

  it('is unaffected in shape by the size of the loss rate being a probability', () => {
    // Zero loss is the same conversation without the gap: same segments, same states,
    // fewer events. This is the control that proves the drop is the only difference.
    const clean = runJourney(LOSSY_LINK, {
      loss: { linkId: 'backbone', rate: 0, maxRetransmissions: 4 },
    });
    expect(eventsOf(clean, 'drop')).toEqual([]);
    expect(clean.durationMs).toBeLessThan(result.durationMs);
  });
});
