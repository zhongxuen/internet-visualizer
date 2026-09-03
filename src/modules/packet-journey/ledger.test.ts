import { describe, expect, it } from 'vitest';

import { FRAGMENTED_PACKET, LOSSY_LINK, TCP_WEB_REQUEST } from './scenarios';
import { buildLedger, currentRowIndex, focusAt, type HopRow } from './ledger';
import { runJourneyDetailed } from './sim/journey';

/**
 * The ledger is what the hop table prints, so these are the accuracy tests for the table
 * itself -- asserted against the derivation rather than against the DOM, because a claim
 * about TTL should not be able to break because a class name changed.
 *
 * `sim/journey.test.ts` already proves the engine gets the forwarding right. What is
 * tested here is that the derivation *reads it back correctly*: the columns come off the
 * real header fields, a hop ends at a router and not at a switch, and the diff between
 * two consecutive hops says the things that actually changed and nothing else.
 */

function ledgerFor(scenario: typeof TCP_WEB_REQUEST): HopRow[] {
  const run = runJourneyDetailed(scenario);
  return buildLedger(run.result, scenario.topology);
}

/** Every row belonging to one packet, in order. */
function forPacket(rows: readonly HopRow[], pduId: string): HopRow[] {
  return rows.filter((row) => row.pduId === pduId);
}

describe('buildLedger', () => {
  it('groups the links between two layer-3 machines into one hop', () => {
    const rows = ledgerFor(TCP_WEB_REQUEST);
    const first = forPacket(rows, 'c-01')[0];

    // laptop -> ap -> lan-switch -> router is three transmits and exactly one hop.
    expect(first.from).toBe('laptop');
    expect(first.to).toBe('router');
    expect(first.via).toEqual(['ap', 'lan-switch']);
  });

  it('never ends a hop at a layer-2 device', () => {
    const rows = ledgerFor(TCP_WEB_REQUEST);
    const transparent = new Set(
      TCP_WEB_REQUEST.topology.nodes
        .filter((node) => node.kind === 'switch')
        .map((node) => node.id),
    );

    for (const row of rows.filter((entry) => entry.kind === 'crossing')) {
      expect(transparent.has(row.to)).toBe(false);
      expect(transparent.has(row.from)).toBe(false);
    }
  });

  it('reads TTL, both MACs, and both endpoints off the packet that crossed', () => {
    const [first] = forPacket(ledgerFor(TCP_WEB_REQUEST), 'c-01');

    expect(first.addressing.ttl).toBe('64');
    expect(first.addressing.sourceMac).toMatch(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/);
    expect(first.addressing.destinationMac).toMatch(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/);
    expect(first.addressing.source).toBe('192.168.1.112:49152');
    expect(first.addressing.destination).toBe('192.0.2.80:80');
  });

  /** The four facts the phase doc says most explanations get wrong. */
  it('decrements TTL once per hop and never twice', () => {
    const hops = forPacket(ledgerFor(TCP_WEB_REQUEST), 'c-01');
    const ttls = hops.map((row) => Number(row.addressing.ttl));

    expect(ttls[0]).toBe(64);
    for (let i = 1; i < ttls.length; i += 1) {
      expect(ttls[i]).toBe(ttls[i - 1] - 1);
    }
  });

  it('rewrites both MAC addresses at every hop after the first', () => {
    const hops = forPacket(ledgerFor(TCP_WEB_REQUEST), 'c-01');

    for (let i = 1; i < hops.length; i += 1) {
      expect(hops[i].addressing.sourceMac).not.toBe(hops[i - 1].addressing.sourceMac);
      expect(hops[i].addressing.destinationMac).not.toBe(
        hops[i - 1].addressing.destinationMac,
      );
      expect(hops[i].changes.map((change) => change.kind)).toContain('mac');
    }
  });

  it('recomputes the checksum wherever the TTL changed, and only there', () => {
    const hops = forPacket(ledgerFor(TCP_WEB_REQUEST), 'c-01');

    for (const row of hops.slice(1)) {
      const kinds = row.changes.map((change) => change.kind);
      expect(kinds).toContain('ttl');
      expect(kinds).toContain('checksum');
    }
    expect(hops[0].changes).toEqual([]);
  });

  it('changes an IP address at the NAT and nowhere else', () => {
    const hops = forPacket(ledgerFor(TCP_WEB_REQUEST), 'c-01');
    const translated = hops.filter((row) =>
      row.changes.some((change) => change.kind === 'address'),
    );

    expect(translated).toHaveLength(1);
    // The hop the home router sends: it is the machine that did the translating.
    expect(translated[0].from).toBe('router');
    expect(translated[0].changes.find((change) => change.kind === 'address')?.text).toBe(
      'NAT: source 192.168.1.112:49152 → 203.0.113.7:60000',
    );

    const untouched = hops.filter((row) => row !== translated[0]).slice(1);
    for (const row of untouched) {
      expect(row.addressing.destinationIp).toBe('192.0.2.80');
    }
  });

  it('reverses the translation on the return path', () => {
    const reply = forPacket(ledgerFor(TCP_WEB_REQUEST), 's-02');
    const reversed = reply.filter((row) =>
      row.changes.some((change) => change.kind === 'address'),
    );

    expect(reversed).toHaveLength(1);
    expect(reversed[0].from).toBe('router');
    expect(reversed[0].changes.find((change) => change.kind === 'address')?.text).toBe(
      'NAT: destination 203.0.113.7:60000 → 192.168.1.112:49152',
    );
    // And the packet really is addressed to the laptop again after it.
    expect(reversed[0].addressing.destination).toBe('192.168.1.112:49152');
  });

  it('gives a dropped packet a row that says why, and no hop after it', () => {
    const rows = ledgerFor(LOSSY_LINK);
    const drops = rows.filter((row) => row.kind === 'drop');

    expect(drops).toHaveLength(1);
    expect(drops[0].reason).toMatch(/lost in transit/);

    const after = rows.filter(
      (row) => row.pduId === drops[0].pduId && row.at > drops[0].at,
    );
    expect(after).toEqual([]);
  });

  it('records a blocked oversized packet and the ICMP that answers it', () => {
    const rows = ledgerFor(FRAGMENTED_PACKET);
    const drop = rows.find((row) => row.kind === 'drop');

    expect(drop?.reason).toMatch(/Don't Fragment is set/);
    // The router that could not forward it sends a Fragmentation Needed back.
    expect(rows.some((row) => row.summary.includes('ICMP'))).toBe(true);
  });

  it('gives each fragment its own hops', () => {
    const rows = ledgerFor(FRAGMENTED_PACKET);
    const fragments = new Set(
      rows.map((row) => row.pduId).filter((id) => /-f\d+$/.test(id)),
    );

    expect(fragments.size).toBeGreaterThan(1);
    for (const id of fragments) {
      expect(forPacket(rows, id).length).toBeGreaterThan(0);
    }
  });

  it('numbers hops per packet, not per run', () => {
    const rows = ledgerFor(TCP_WEB_REQUEST);
    const request = forPacket(rows, 'c-01');
    const reply = forPacket(rows, 's-02');

    expect(request.map((row) => row.hop)).toEqual(request.map((_, index) => index + 1));
    expect(reply[0].hop).toBe(1);
  });
});

describe('currentRowIndex', () => {
  const rows = ledgerFor(TCP_WEB_REQUEST);

  it('is -1 before the first hop leaves', () => {
    expect(currentRowIndex(rows, -1)).toBe(-1);
    expect(currentRowIndex(rows, rows[0].at - 0.0001)).toBe(-1);
  });

  it('holds the last hop that has started', () => {
    expect(currentRowIndex(rows, rows[0].at)).toBe(0);
    // Between two hops -- the router is thinking -- the cursor stays put rather than
    // blanking out.
    expect(currentRowIndex(rows, (rows[0].arrivedAt + rows[1].at) / 2)).toBe(0);
    expect(currentRowIndex(rows, rows[1].at)).toBe(1);
  });

  it('settles on the last hop past the end of the run', () => {
    expect(currentRowIndex(rows, Number.MAX_SAFE_INTEGER)).toBe(rows.length - 1);
  });
});

describe('focusAt', () => {
  const run = runJourneyDetailed(TCP_WEB_REQUEST);

  it('has nothing to show before the first packet exists', () => {
    expect(focusAt({ ...run.result, events: [] }, 0)).toBeUndefined();
  });

  it('follows the build-up of the stack at the sender', () => {
    const focus = focusAt(run.result, 0);

    expect(focus?.status).toBe('encapsulated');
    expect(focus?.nodeId).toBe('laptop');
    // Outermost first: the frame, the packet, the segment.
    expect(focus?.pdu.layers.map((layer) => layer.protocol)).toEqual([
      'Ethernet II',
      'IPv4',
      'TCP',
    ]);
    expect(focus?.reason).toMatch(/Ethernet frame prepended/);
  });

  it('reports a packet on a wire as in flight, and at the far end once it lands', () => {
    // The hop into the home router: a machine that takes a moment to think, so there is
    // an instant where the packet has landed and nothing else has happened to it yet. A
    // switch forwards with no delay, and at its arrival instant the packet is already
    // back on the next wire -- which is correct, and not what this test is about.
    const transmit = run.result.events.find(
      (event) => event.kind === 'transmit' && event.to === 'router',
    );
    if (transmit?.kind !== 'transmit') throw new Error('the run sent nothing');

    const midway = focusAt(run.result, transmit.at + transmit.durationMs / 2);
    expect(midway?.status).toBe('in-flight');
    expect(midway?.linkId).toBe(transmit.linkId);
    expect(midway?.nodeId).toBeUndefined();

    const landed = focusAt(run.result, transmit.at + transmit.durationMs);
    expect(landed?.status).toBe('arrived');
    expect(landed?.nodeId).toBe(transmit.to);
  });

  it('ends on a stripped stack: the headers are gone and the payload is left', () => {
    const focus = focusAt(run.result, run.result.durationMs);

    expect(focus?.status).toBe('stripped');
    expect(focus?.pdu.layers.map((layer) => layer.layer)).not.toContain('link');
    expect(focus?.pdu.layers.map((layer) => layer.layer)).not.toContain('network');
  });

  it('is a pure function of the time, so scrubbing back is exact', () => {
    const early = focusAt(run.result, 90);
    focusAt(run.result, run.result.durationMs);

    expect(focusAt(run.result, 90)).toEqual(early);
  });

  it('reports a lost packet as dropped, with the reason', () => {
    const lossy = runJourneyDetailed(LOSSY_LINK);
    const drop = lossy.result.events.find((event) => event.kind === 'drop');
    if (drop?.kind !== 'drop') throw new Error('nothing was dropped');

    const focus = focusAt(lossy.result, drop.at);
    expect(focus?.status).toBe('dropped');
    expect(focus?.reason).toBe(drop.reason);
  });
});
