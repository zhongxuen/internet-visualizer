import { describe, expect, it } from 'vitest';

import { internetChecksum } from '@/core/protocols/ipv4/ipv4';

import {
  DIAGNOSTIC_PATHS,
  DEAD_HOST,
  FILTERED_HOST,
  FLAKY_WIFI,
  LOCAL_CDN,
  LONG_HAUL,
  PROHIBITED_HOST,
} from './paths';
import {
  echoPayloadPattern,
  explainOutcome,
  icmpEchoBytes,
  icmpEchoChecksum,
  icmpEchoSize,
  runPing,
  summarize,
  ICMP_ECHO_REPLY,
  ICMP_ECHO_REQUEST,
  ICMP_HEADER_BYTES,
  WHY_SILENCE_IS_NOT_DOWN,
  type IcmpEcho,
  type PingProbe,
} from './ping';

const ECHO: IcmpEcho = {
  type: ICMP_ECHO_REQUEST,
  code: 0,
  identifier: 0x1234,
  sequence: 1,
  payloadBytes: 56,
};

describe('the ICMP echo message', () => {
  it('is 64 bytes with the default payload, which is the "64 bytes from" in every output', () => {
    expect(icmpEchoSize(ECHO)).toBe(64);
    expect(ICMP_HEADER_BYTES).toBe(8);
  });

  it('serializes type, code, checksum, identifier and sequence in wire order', () => {
    const bytes = icmpEchoBytes(ECHO, 0xabcd);
    expect(bytes.slice(0, 8)).toEqual([8, 0, 0xab, 0xcd, 0x12, 0x34, 0x00, 0x01]);
    expect(bytes).toHaveLength(64);
  });

  it('returns the payload byte for byte, which is what makes a mismatch meaningful', () => {
    const pattern = echoPayloadPattern(4);
    expect(pattern).toEqual([0x10, 0x11, 0x12, 0x13]);
  });

  /**
   * The checksum is real, not a plausible constant: putting it back into the header and
   * summing again must give zero, which is the property RFC 1071 exists to provide.
   */
  it('computes a checksum that validates when folded back in', () => {
    const checksum = icmpEchoChecksum(ECHO);
    expect(internetChecksum(icmpEchoBytes(ECHO, checksum))).toBe(0);
  });

  it('differs between a request and a reply by exactly the type byte', () => {
    const reply: IcmpEcho = { ...ECHO, type: ICMP_ECHO_REPLY };
    // Type 8 -> 0 removes 0x0800 from the sum, so the one's-complement checksum gains it.
    expect(icmpEchoChecksum(reply) - icmpEchoChecksum(ECHO)).toBe(0x0800);
  });
});

describe('statistics', () => {
  const probe = (rttMs?: number): PingProbe => ({
    sequence: 1,
    sentAt: 0,
    settledAt: 1,
    outcome: rttMs === undefined ? 'timeout' : 'reply',
    ...(rttMs === undefined ? {} : { rttMs }),
    bytes: 64,
    line: '',
  });

  it('reports loss as a whole-number percent of probes sent', () => {
    const stats = summarize([probe(10), probe(), probe(20), probe()], 4000);
    expect(stats.sent).toBe(4);
    expect(stats.received).toBe(2);
    expect(stats.lossPercent).toBe(50);
  });

  it('omits every timing figure when nothing came back', () => {
    const stats = summarize([probe(), probe()], 2000);
    expect(stats.lossPercent).toBe(100);
    expect(stats.minMs).toBeUndefined();
    expect(stats.avgMs).toBeUndefined();
    expect(stats.mdevMs).toBeUndefined();
  });

  it('computes mdev as the population standard deviation, the way iputils does', () => {
    // 10 and 20: mean 15, variance 25, sd 5.
    const stats = summarize([probe(10), probe(20)], 2000);
    expect(stats.avgMs).toBe(15);
    expect(stats.mdevMs).toBe(5);
  });
});

describe('running a ping', () => {
  it('is deterministic: the same path and seed replay exactly', () => {
    expect(runPing(LOCAL_CDN)).toEqual(runPing(LOCAL_CDN));
  });

  it('answers every probe on the healthy path', () => {
    const run = runPing(LOCAL_CDN);
    expect(run.stats.lossPercent).toBe(0);
    expect(run.probes.every((probe) => probe.outcome === 'reply')).toBe(true);
  });

  /**
   * The reply TTL is the closest thing ping has to a hop count, and it is arithmetic
   * rather than a label: what the destination stamped, minus one per router on the way
   * back.
   */
  it('reports a reply TTL of the stamped value minus one per router', () => {
    const run = runPing(LONG_HAUL);
    const reply = run.probes.find((probe) => probe.outcome === 'reply');
    expect(reply?.replyTtl).toBe(LONG_HAUL.destination.replyTtl - LONG_HAUL.hops.length);
  });

  it('loses probes on a lossy first hop, and loses them at the first hop', () => {
    const run = runPing(FLAKY_WIFI);
    const lost = run.probes.filter((probe) => probe.outcome === 'timeout');
    expect(lost.length).toBeGreaterThan(0);
    expect(lost.every((probe) => probe.lostAt === FLAKY_WIFI.hops[0]?.id)).toBe(true);
  });

  it('records a drop event at the machine that discarded each lost probe', () => {
    const run = runPing(FLAKY_WIFI);
    const drops = run.result.events.filter((event) => event.kind === 'drop');
    expect(drops.length).toBe(
      run.probes.filter((probe) => probe.outcome === 'timeout').length,
    );
  });
});

describe('a filtered host', () => {
  const run = runPing(FILTERED_HOST);

  it('reports total loss', () => {
    expect(run.stats.lossPercent).toBe(100);
    expect(run.stats.received).toBe(0);
  });

  /** The whole point of the module: the host is up, and the tool cannot see it. */
  it('completes a TCP connection during the same run', () => {
    expect(run.contrast.connected).toBe(true);
    expect(run.contrast.connectMs).toBeGreaterThan(0);
  });

  it('says in the verdict that the host is up, not that it is down', () => {
    expect(run.verdict.headline).toContain('up the whole time');
    expect(run.verdict.doesNotProve).toContain('down');
    expect(run.verdict.nextStep).toContain('TCP');
  });
});

describe('the difference between filtered and down', () => {
  const filtered = runPing(FILTERED_HOST);
  const dead = runPing(DEAD_HOST);

  it('gives no responder at all when a filter drops silently', () => {
    expect(filtered.probes.every((probe) => probe.responder === undefined)).toBe(true);
  });

  /**
   * Down is not silence. The last-hop router answers on the host's behalf, and reading
   * *who* replied is the only way to tell the two apart.
   */
  it('names the last-hop router as the responder when the address is empty', () => {
    const responder = DEAD_HOST.hops[DEAD_HOST.hops.length - 1]?.address;
    expect(dead.probes.every((probe) => probe.responder === responder)).toBe(true);
    expect(dead.probes.every((probe) => probe.outcome === 'host-unreachable')).toBe(true);
    expect(responder).not.toBe(DEAD_HOST.destination.address);
  });

  it('never counts an ICMP error as a round-trip measurement', () => {
    expect(dead.probes.every((probe) => probe.rttMs === undefined)).toBe(true);
    expect(dead.stats.avgMs).toBeUndefined();
  });

  it('prints the two the way the real tool does', () => {
    expect(filtered.probes[0]?.line).toMatch(/^Request timeout for icmp_seq 1$/);
    expect(dead.probes[0]?.line).toContain('Destination Host Unreachable');
    expect(runPing(PROHIBITED_HOST).probes[0]?.line).toContain('Packet filtered');
  });
});

describe('the standing explanation', () => {
  it('states that ICMP is a different protocol from the traffic that matters', () => {
    expect(WHY_SILENCE_IS_NOT_DOWN[0]?.claim).toContain('different protocol');
    expect(WHY_SILENCE_IS_NOT_DOWN).toHaveLength(4);
  });

  it('also warns that a reply is not a health check', () => {
    const verdict = explainOutcome(
      LOCAL_CDN,
      runPing(LOCAL_CDN).stats,
      runPing(LOCAL_CDN).contrast,
    );
    expect(verdict.doesNotProve).toContain('service');
  });
});

describe('every path', () => {
  it('produces a run whose events are sorted and whose PDUs are all referenced', () => {
    for (const path of DIAGNOSTIC_PATHS) {
      const run = runPing(path);
      const times = run.result.events.map((event) => event.at);
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(run.result.durationMs).toBeGreaterThanOrEqual(times[times.length - 1] ?? 0);
      expect(run.result.phases.length).toBe(run.probes.length + 1);
    }
  });

  it('only ever names machines the topology declares', () => {
    for (const path of DIAGNOSTIC_PATHS) {
      const run = runPing(path);
      const ids = new Set(run.topology.nodes.map((node) => node.id));
      for (const event of run.result.events) {
        if (event.kind === 'transmit') {
          expect(ids.has(event.from)).toBe(true);
          expect(ids.has(event.to)).toBe(true);
        }
        if (event.kind === 'drop' || event.kind === 'pdu-created') {
          expect(ids.has(event.atNode)).toBe(true);
        }
      }
    }
  });

  it('only ever names links the topology declares', () => {
    for (const path of DIAGNOSTIC_PATHS) {
      const run = runPing(path);
      const links = new Set(run.topology.links.map((link) => link.id));
      for (const event of run.result.events) {
        if (event.kind === 'transmit') expect(links.has(event.linkId)).toBe(true);
      }
    }
  });
});
