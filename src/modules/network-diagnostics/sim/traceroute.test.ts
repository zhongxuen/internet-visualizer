import { describe, expect, it } from 'vitest';

import { DEFAULT_TTL, ipv4Checksum, ipv4Header } from '@/core/protocols/ipv4/ipv4';

import { hopCount } from './path';
import {
  DEAD_HOST,
  DIAGNOSTIC_PATHS,
  FILTERED_HOST,
  LOCAL_CDN,
  LONG_HAUL,
  PROHIBITED_HOST,
} from './paths';
import {
  bestTime,
  caveatsFor,
  runTraceroute,
  walkTtl,
  PROBES_PER_HOP,
  TRACEROUTE_CAVEATS,
  UDP_BASE_PORT,
} from './traceroute';

describe('the TTL walk', () => {
  /**
   * The mechanism, asserted directly. A probe with TTL n is decremented by n routers and
   * the nth one takes it to zero -- which is the discard that produces the report.
   */
  it('expires at the router whose position matches the TTL', () => {
    for (let ttl = 1; ttl <= LONG_HAUL.hops.length; ttl += 1) {
      const walk = walkTtl(LONG_HAUL, ttl);
      expect(walk).toHaveLength(ttl);
      expect(walk[ttl - 1]?.nodeId).toBe(LONG_HAUL.hops[ttl - 1]?.id);
      expect(walk[ttl - 1]?.expired).toBe(true);
      expect(walk[ttl - 1]?.ttlOut).toBe(0);
    }
  });

  it('decrements by exactly one per router and by nothing else', () => {
    const walk = walkTtl(LONG_HAUL, 5);
    expect(walk.map((step) => step.ttlIn)).toEqual([5, 4, 3, 2, 1]);
    expect(walk.map((step) => step.ttlOut)).toEqual([4, 3, 2, 1, 0]);
  });

  /**
   * The checksum covers the header, and the TTL is in the header. A hop that changed the
   * TTL and left the checksum alone would be emitting a corrupt packet.
   */
  it('recomputes the header checksum at every hop, and the value really changes', () => {
    const walk = walkTtl(LONG_HAUL, 3);
    for (const step of walk) {
      expect(step.checksumIn).not.toBe(step.checksumOut);
    }
    // And the recomputed value is the real one for the header that leaves.
    const leaving = ipv4Header({
      sourceIp: LONG_HAUL.source.address,
      destinationIp: LONG_HAUL.destination.address,
      ttl: 2,
      protocol: 17,
      payloadBytes: 40,
      identification: 0x4444,
    });
    expect(walk[0]?.checksumOut).toBe(ipv4Checksum(leaving));
  });

  it('reaches the destination without expiring once the TTL is large enough', () => {
    const walk = walkTtl(LONG_HAUL, hopCount(LONG_HAUL));
    const last = walk[walk.length - 1];
    expect(last?.nodeId).toBe(LONG_HAUL.destination.id);
    expect(last?.expired).toBe(false);
    // Every router took one, so what arrives is what a host receives, not zero.
    expect(last?.ttlIn).toBe(1);
  });

  it('is the same arithmetic Packet Journey uses, starting from the same default TTL', () => {
    expect(DEFAULT_TTL).toBe(LOCAL_CDN.source.initialTtl);
  });
});

describe('running a trace', () => {
  it('is deterministic: the same path, method and seed replay exactly', () => {
    expect(runTraceroute(LOCAL_CDN)).toEqual(runTraceroute(LOCAL_CDN));
  });

  it('sends three probes per hop and one row per TTL', () => {
    const run = runTraceroute(LOCAL_CDN);
    expect(run.hops).toHaveLength(hopCount(LOCAL_CDN));
    expect(run.hops.every((hop) => hop.probes.length === PROBES_PER_HOP)).toBe(true);
    expect(run.hops.map((hop) => hop.ttl)).toEqual([1, 2, 3, 4, 5]);
  });

  it('increments the UDP destination port per probe, which is how replies are matched', () => {
    const run = runTraceroute(LOCAL_CDN, { method: 'udp' });
    const ports = run.hops.flatMap((hop) => hop.probes.map((probe) => probe.port));
    expect(ports.slice(0, 4)).toEqual([
      UDP_BASE_PORT,
      UDP_BASE_PORT + 1,
      UDP_BASE_PORT + 2,
      UDP_BASE_PORT + 3,
    ]);
    expect(new Set(ports).size).toBe(ports.length);
  });

  it('finds each router at its own position, in order', () => {
    const run = runTraceroute(LOCAL_CDN);
    expect(run.hops.slice(0, 4).map((hop) => hop.responders[0])).toEqual(
      LOCAL_CDN.hops.map((hop) => hop.address),
    );
  });

  it('stops at the destination and says it arrived', () => {
    const run = runTraceroute(LOCAL_CDN);
    expect(run.reachedDestination).toBe(true);
    expect(run.hops[run.hops.length - 1]?.responders).toEqual([
      LOCAL_CDN.destination.address,
    ]);
  });

  it('emits a drop event wherever a probe expired', () => {
    const run = runTraceroute(LOCAL_CDN);
    const drops = run.result.events.filter((event) => event.kind === 'drop');
    // One per animated probe, except the one that reached the destination.
    expect(drops).toHaveLength(LOCAL_CDN.hops.length);
    expect(drops.every((event) => event.reason.includes('TTL reached 0'))).toBe(true);
  });

  it('shows the TTL decrement as a header transform at each router', () => {
    const run = runTraceroute(LOCAL_CDN);
    const transforms = run.result.events.filter(
      (event) => event.kind === 'pdu-transform',
    );
    expect(transforms.length).toBeGreaterThan(0);
    expect(transforms.every((event) => event.reason.startsWith('TTL '))).toBe(true);
    expect(transforms.some((event) => event.reason.includes('checksum'))).toBe(true);
  });
});

describe('a hop that does not answer', () => {
  const run = runTraceroute(LONG_HAUL);
  const silent = run.hops.find(
    (hop) => hop.ttl === LONG_HAUL.hops.findIndex((entry) => !entry.respondsToTtl) + 1,
  );

  it('prints three stars', () => {
    expect(silent?.silent).toBe(true);
    expect(silent?.responders).toEqual([]);
    expect(silent?.line).toContain('*  *  *');
  });

  /**
   * The correction the whole caveat exists for: a silent hop is a hop that forwarded the
   * probe correctly. The rows after it are the proof.
   */
  it('still forwarded the probe -- every later hop answered', () => {
    const after = run.hops.filter((hop) => hop.ttl > (silent?.ttl ?? 0));
    expect(after.length).toBeGreaterThan(0);
    expect(after.some((hop) => !hop.silent)).toBe(true);
  });

  it('shows the TTL reaching zero there anyway, because it did', () => {
    const expired = silent?.walk.find((step) => step.expired);
    expect(expired?.ttlOut).toBe(0);
    expect(expired?.nodeId).toBe(
      LONG_HAUL.hops.find((entry) => !entry.respondsToTtl)?.id,
    );
  });
});

describe('load balancing', () => {
  const run = runTraceroute(LONG_HAUL);
  const balanced = run.hops.find((hop) => hop.responders.length > 1);

  it('puts two addresses on one row', () => {
    const pair = LONG_HAUL.hops.find((hop) => hop.parallel);
    expect(balanced).toBeDefined();
    expect(new Set(balanced?.responders)).toEqual(
      new Set([pair!.address, pair!.parallel!.address]),
    );
  });

  it('prints an address only when it changes, the way the real tool does', () => {
    // Three probes, two distinct responders: fewer than three address tokens in the row.
    const addresses = (balanced?.line.match(/\d+\.\d+\.\d+\.\d+/g) ?? []).length;
    expect(addresses).toBeGreaterThan(1);
    expect(addresses).toBeLessThanOrEqual(PROBES_PER_HOP);
  });
});

describe('the asymmetric return path', () => {
  const run = runTraceroute(LONG_HAUL);

  /**
   * The classic confusing output. The skewed hop reports a higher time than the hop after
   * it, and nothing on the forward path explains it -- because the extra milliseconds are
   * on the way back.
   */
  it('produces a hop that reads slower than the hop after it', () => {
    // The hop whose replies take the longest way home, followed by one whose do not.
    const index = LONG_HAUL.hops.findIndex(
      (hop, position) =>
        (hop.returnSkewMs ?? 0) > 0 &&
        (LONG_HAUL.hops[position + 1]?.returnSkewMs ?? 0) === 0,
    );
    expect(index).toBeGreaterThan(-1);
    expect(bestTime(run.hops[index]!)).toBeGreaterThan(bestTime(run.hops[index + 1]!)!);
  });

  it('does not accumulate one hop’s skew into the hops beyond it', () => {
    const last = run.hops[run.hops.length - 1];
    const backbone = run.hops.find(
      (hop) => hop.responders[0] === LONG_HAUL.hops[4]?.address,
    );
    // The destination is further away yet answers faster than the skewed backbone hop.
    expect(bestTime(last!)).toBeLessThan(bestTime(backbone!)!);
  });
});

describe('flags on the last row', () => {
  it('marks an administrative refusal !X and names the router that made it', () => {
    const run = runTraceroute(PROHIBITED_HOST);
    const last = run.hops[run.hops.length - 1];
    expect(last?.flag).toBe('!X');
    expect(last?.responders[0]).toBe(
      PROHIBITED_HOST.hops[PROHIBITED_HOST.hops.length - 1]?.address,
    );
    expect(run.reachedDestination).toBe(false);
  });

  it('marks an empty address !H', () => {
    const run = runTraceroute(DEAD_HOST);
    expect(run.hops[run.hops.length - 1]?.flag).toBe('!H');
  });

  it('says plainly when the trace never arrived', () => {
    const run = runTraceroute(FILTERED_HOST);
    expect(run.reachedDestination).toBe(false);
    expect(run.output.join('\n')).toContain('The destination never answered');
    expect(run.hops[run.hops.length - 1]?.silent).toBe(true);
  });
});

describe('the caveats', () => {
  it('always includes the two that apply to every trace', () => {
    const ids = caveatsFor(LOCAL_CDN, runTraceroute(LOCAL_CDN).hops).map(
      (caveat) => caveat.id,
    );
    expect(ids).toContain('round-trip');
    expect(ids).toContain('icmp-priority');
  });

  it('marks stars, load balancing and asymmetry only where the trace shows them', () => {
    const long = runTraceroute(LONG_HAUL).caveats.map((caveat) => caveat.id);
    expect(long).toEqual(
      expect.arrayContaining(['stars', 'load-balancing', 'asymmetry']),
    );

    const clean = runTraceroute(LOCAL_CDN).caveats.map((caveat) => caveat.id);
    expect(clean).not.toContain('stars');
    expect(clean).not.toContain('load-balancing');
  });

  /**
   * Jitter produces time inversions too, and calling those asymmetry would teach the
   * wrong inference from a real observation.
   */
  it('does not claim asymmetry on a noisy path that has none', () => {
    const flaky = runTraceroute(
      DIAGNOSTIC_PATHS.find((path) => path.id === 'flaky-wifi')!,
    );
    expect(flaky.caveats.map((caveat) => caveat.id)).not.toContain('asymmetry');
  });

  it('offers five standing caveats regardless of the run', () => {
    expect(TRACEROUTE_CAVEATS).toHaveLength(5);
  });
});

describe('the probe method', () => {
  it('changes what the destination answers with, not how routers behave', () => {
    const udp = runTraceroute(LOCAL_CDN, { method: 'udp' });
    const icmp = runTraceroute(LOCAL_CDN, { method: 'icmp' });
    expect(udp.hops.map((hop) => hop.responders)).toEqual(
      icmp.hops.map((hop) => hop.responders),
    );
    const udpReply = udp.result.pdus[`reply-ttl-${hopCount(LOCAL_CDN)}`];
    const icmpReply = icmp.result.pdus[`reply-ttl-${hopCount(LOCAL_CDN)}`];
    expect(udpReply?.layers[1]?.fields[1]?.value).toContain('Port Unreachable');
    expect(icmpReply?.layers[1]?.fields[0]?.value).toContain('Echo Reply');
  });
});

describe('every path', () => {
  it('produces sorted events that only name declared nodes and links', () => {
    for (const path of DIAGNOSTIC_PATHS) {
      for (const method of ['udp', 'icmp'] as const) {
        const run = runTraceroute(path, { method });
        const ids = new Set(run.topology.nodes.map((node) => node.id));
        const links = new Set(run.topology.links.map((link) => link.id));
        const times = run.result.events.map((event) => event.at);

        expect(times).toEqual([...times].sort((a, b) => a - b));
        for (const event of run.result.events) {
          if (event.kind === 'transmit') {
            expect(ids.has(event.from)).toBe(true);
            expect(ids.has(event.to)).toBe(true);
            expect(links.has(event.linkId)).toBe(true);
          }
          if (event.kind === 'drop' || event.kind === 'pdu-created') {
            expect(ids.has(event.atNode)).toBe(true);
          }
        }
      }
    }
  });
});
