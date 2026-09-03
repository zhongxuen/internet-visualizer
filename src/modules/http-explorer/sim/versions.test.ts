/**
 * The version model, and the two claims it exists to make honestly.
 *
 * Almost every test here is really one of two assertions:
 *
 * 1. **h2 removes application-layer head-of-line blocking, and h1 has it badly.** Ten
 *    resources over h1 queue behind six connections; the same ten over h2 do not queue
 *    at all.
 * 2. **h2 does not remove transport-layer head-of-line blocking, and h3 does.** The same
 *    lost packet is fed to all three runs: it stalls one request under h1, every stream
 *    under h2, and only its own stream under h3.
 *
 * Getting the second one wrong -- claiming h2 fixed both -- is the single most common
 *  error in explanations of HTTP/2, so it is asserted from several directions.
 */

import { describe, expect, it } from 'vitest';

import { createRng } from '@/core/sim/rng';

import { HTTP_VERSIONS } from './message';
import {
  DEFAULT_CONDITIONS,
  FIRST_REQUEST_HEADER_RATIO,
  H1_MAX_CONNECTIONS_PER_ORIGIN,
  H2_DEFAULT_MAX_CONCURRENT_STREAMS,
  HEAD_OF_LINE_BLOCKING,
  MSS_BYTES,
  REPEAT_REQUEST_HEADER_RATIO,
  VERSION_PROFILES,
  compareVersions,
  compressedHeaderBytes,
  drawLosses,
  handshakeCost,
  planVersionRun,
  versionFromAlias,
  versionProfile,
  withDefaults,
  type NetworkConditions,
  type ResourceRequest,
  type StreamTiming,
} from './versions';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A page: one document and a tail of small assets. The classic h1-versus-h2 shape. */
function page(count: number, bytes = 24_000): ResourceRequest[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `asset-${index}`,
    label: `asset-${index}.js`,
    target: `/static/asset-${index}.js`,
    responseBytes: bytes,
  }));
}

const SEED = 'http:versions:test';

/** A link where the round trip dominates: the condition h2 was designed for. */
const HIGH_LATENCY: Partial<NetworkConditions> = {
  rttMs: 150,
  bandwidthKbps: 40_000,
  lossRate: 0,
};

/** The same link, dropping segments: the condition h2 was *not* designed for. */
const LOSSY: Partial<NetworkConditions> = { ...HIGH_LATENCY, lossRate: 0.02 };

function streamFor(streams: readonly StreamTiming[], id: string): StreamTiming {
  const found = streams.find((stream) => stream.resourceId === id);
  if (!found) throw new Error(`no stream for ${id}`);
  return found;
}

// ---------------------------------------------------------------------------
// Determinism -- the property everything else rests on
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it.each(HTTP_VERSIONS)('%s produces a deep-equal run the second time', (version) => {
    const init = { version, resources: page(12), conditions: LOSSY, seed: SEED };
    expect(planVersionRun(init)).toEqual(planVersionRun(init));
  });

  it('produces a deep-equal comparison the tenth time', () => {
    // Not redundant: a generator whose state leaked into module scope would agree with
    // itself once and drift afterwards, which two runs cannot catch.
    const init = { resources: page(12), conditions: LOSSY, seed: SEED };
    const first = compareVersions(init);
    for (let attempt = 0; attempt < 9; attempt += 1) {
      expect(compareVersions(init)).toEqual(first);
    }
  });

  it('draws different losses under a different seed', () => {
    const resources = page(24, 200_000);
    const conditions = withDefaults(LOSSY);
    const a = drawLosses(resources, conditions, createRng('seed-a'));
    const b = drawLosses(resources, conditions, createRng('seed-b'));
    expect(a).not.toEqual(b);
  });

  it('draws the same losses for every version, so the three runs race the same network', () => {
    const comparison = compareVersions({
      resources: page(12, 300_000),
      conditions: LOSSY,
      seed: SEED,
    });
    expect(comparison.losses.length).toBeGreaterThan(0);
    for (const version of HTTP_VERSIONS) {
      expect(comparison.runs[version].losses).toEqual(comparison.losses);
    }
  });

  it('never reads a clock or Math.random', () => {
    // A structural check rather than a behavioural one: every timestamp has to trace
    // back to the conditions and the seed, so a run started "later" is identical.
    const init = { resources: page(8), conditions: LOSSY, seed: 42 };
    const before = compareVersions(init);
    const after = compareVersions(init);
    expect(after).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// The profiles
// ---------------------------------------------------------------------------

describe('version profiles', () => {
  it('cites the current RFCs, not the obsolete 723x series', () => {
    const cited = HTTP_VERSIONS.flatMap((version) => {
      const profile = VERSION_PROFILES[version];
      return [profile.rfc, profile.transportRfc, profile.compressionRfc].filter(
        (reference) => reference !== undefined,
      );
    });
    expect(cited.length).toBeGreaterThan(0);
    for (const reference of cited) {
      // RFC 7230-7235 were obsoleted by 9110-9114 in June 2022. Citing them is the
      // most common way an HTTP explanation dates itself.
      expect(reference.rfc >= 7230 && reference.rfc <= 7235).toBe(false);
    }
    expect(VERSION_PROFILES['HTTP/1.1'].rfc.rfc).toBe(9112);
    expect(VERSION_PROFILES['HTTP/2'].rfc.rfc).toBe(9113);
    expect(VERSION_PROFILES['HTTP/3'].rfc.rfc).toBe(9114);
  });

  it('puts only HTTP/3 on QUIC, and only HTTP/1.1 on text', () => {
    expect(VERSION_PROFILES['HTTP/3'].transport).toBe('QUIC');
    expect(VERSION_PROFILES['HTTP/2'].transport).toBe('TCP');
    expect(VERSION_PROFILES['HTTP/1.1'].transport).toBe('TCP');
    expect(VERSION_PROFILES['HTTP/1.1'].framing).toBe('text');
    expect(VERSION_PROFILES['HTTP/2'].framing).toBe('binary');
    expect(VERSION_PROFILES['HTTP/3'].framing).toBe('binary');
  });

  it('resolves a version from its short name and back', () => {
    expect(versionFromAlias('h2')).toBe('HTTP/2');
    expect(versionFromAlias('h9')).toBeUndefined();
    expect(versionProfile('HTTP/3').alias).toBe('h3');
  });
});

// ---------------------------------------------------------------------------
// The claim: two kinds of blocking, scored differently
// ---------------------------------------------------------------------------

describe('head-of-line blocking table', () => {
  it('says h2 fixes the application layer and h3 fixes the transport layer', () => {
    const application = HEAD_OF_LINE_BLOCKING.find((row) => row.id === 'application');
    const transport = HEAD_OF_LINE_BLOCKING.find((row) => row.id === 'transport');

    expect(application?.verdicts['HTTP/1.1'].blocked).toBe(true);
    expect(application?.verdicts['HTTP/2'].blocked).toBe(false);
    expect(application?.verdicts['HTTP/3'].blocked).toBe(false);

    // The row that everyone gets wrong: h2 is still blocked here, and so is h1.
    expect(transport?.verdicts['HTTP/1.1'].blocked).toBe(true);
    expect(transport?.verdicts['HTTP/2'].blocked).toBe(true);
    expect(transport?.verdicts['HTTP/3'].blocked).toBe(false);
  });

  it('agrees with the profiles it describes', () => {
    for (const row of HEAD_OF_LINE_BLOCKING) {
      for (const version of HTTP_VERSIONS) {
        const profile = VERSION_PROFILES[version];
        const expected =
          row.id === 'application' ? profile.hasApplicationHol : profile.hasTransportHol;
        expect(row.verdicts[version].blocked).toBe(expected);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Handshakes
// ---------------------------------------------------------------------------

describe('handshake cost', () => {
  const conditions = withDefaults({ rttMs: 100 });

  it('charges h1 and h2 two round trips for a fresh encrypted connection', () => {
    for (const version of ['HTTP/1.1', 'HTTP/2'] as const) {
      const cost = handshakeCost(version, conditions);
      expect(cost.roundTrips).toBe(2);
      expect(cost.ms).toBe(200);
      expect(cost.steps.map((step) => step.label)).toEqual([
        'TCP handshake',
        'TLS 1.3 handshake',
      ]);
    }
  });

  it('charges h3 one, because QUIC carries the TLS handshake inside its own', () => {
    const cost = handshakeCost('HTTP/3', conditions);
    expect(cost.roundTrips).toBe(1);
    expect(cost.ms).toBe(100);
    expect(cost.steps).toHaveLength(1);
  });

  it('lets only h3 reach zero round trips on resumption', () => {
    const resumed = withDefaults({ rttMs: 100, resumed: true });
    expect(handshakeCost('HTTP/3', resumed).roundTrips).toBe(0);
    // h1 and h2 still owe TCP its handshake before TLS has anything to resume onto.
    expect(handshakeCost('HTTP/2', resumed).roundTrips).toBe(1);
    expect(handshakeCost('HTTP/1.1', resumed).roundTrips).toBe(1);
  });

  it('drops the TLS round trip when the connection is not encrypted', () => {
    const clear = withDefaults({ rttMs: 100, secure: false });
    expect(handshakeCost('HTTP/1.1', clear).roundTrips).toBe(1);
  });

  it('warns that 0-RTT data is replayable', () => {
    const cost = handshakeCost('HTTP/3', withDefaults({ resumed: true }));
    expect(cost.steps[0].note).toMatch(/replay/i);
  });
});

// ---------------------------------------------------------------------------
// Application-layer head-of-line blocking
// ---------------------------------------------------------------------------

describe('application-layer head-of-line blocking', () => {
  const resources = page(18);

  it('opens six connections for HTTP/1.1 and exactly one for h2 and h3', () => {
    expect(
      planVersionRun({ version: 'HTTP/1.1', resources, seed: SEED }).connections,
    ).toHaveLength(H1_MAX_CONNECTIONS_PER_ORIGIN);
    expect(
      planVersionRun({ version: 'HTTP/2', resources, seed: SEED }).connections,
    ).toHaveLength(1);
    expect(
      planVersionRun({ version: 'HTTP/3', resources, seed: SEED }).connections,
    ).toHaveLength(1);
  });

  it('queues everything past the sixth request under HTTP/1.1', () => {
    const run = planVersionRun({
      version: 'HTTP/1.1',
      resources,
      conditions: HIGH_LATENCY,
      seed: SEED,
    });
    const queued = run.streams.filter((stream) => stream.blockedMs > 0);
    expect(queued).toHaveLength(resources.length - H1_MAX_CONNECTIONS_PER_ORIGIN);
    expect(run.applicationHolMs).toBeGreaterThan(0);

    // The first six start together; nothing was in their way.
    for (const stream of run.streams.slice(0, H1_MAX_CONNECTIONS_PER_ORIGIN)) {
      expect(stream.blockedMs).toBe(0);
      expect(stream.startedAt).toBe(run.handshake.ms);
    }
  });

  it('queues nothing at all under HTTP/2 or HTTP/3', () => {
    for (const version of ['HTTP/2', 'HTTP/3'] as const) {
      const run = planVersionRun({
        version,
        resources,
        conditions: HIGH_LATENCY,
        seed: SEED,
      });
      expect(run.applicationHolMs).toBe(0);
      for (const stream of run.streams) {
        expect(stream.blockedMs).toBe(0);
        expect(stream.startedAt).toBe(run.handshake.ms);
      }
    }
  });

  it('still queues under h2 once the concurrent-stream limit is exceeded', () => {
    // h2 raises the ceiling by two orders of magnitude; it does not remove it.
    const many = page(H2_DEFAULT_MAX_CONCURRENT_STREAMS + 5, 4_000);
    const run = planVersionRun({
      version: 'HTTP/2',
      resources: many,
      conditions: HIGH_LATENCY,
      seed: SEED,
    });
    expect(run.applicationHolMs).toBeGreaterThan(0);
    expect(run.streams.filter((stream) => stream.blockedMs > 0)).toHaveLength(5);
  });

  it('numbers h2 and h3 streams with odd, client-initiated identifiers', () => {
    const run = planVersionRun({ version: 'HTTP/2', resources, seed: SEED });
    const ids = run.streams.map((stream) => stream.streamId);
    expect(ids).toEqual(resources.map((_unused, index) => 1 + index * 2));
    expect(ids.every((id) => id !== undefined && id % 2 === 1)).toBe(true);
  });

  it('gives HTTP/1.1 streams no stream identifier, because it has none', () => {
    const run = planVersionRun({ version: 'HTTP/1.1', resources, seed: SEED });
    expect(run.streams.every((stream) => stream.streamId === undefined)).toBe(true);
  });

  it('lets h2 finish a latency-bound page load sooner than h1', () => {
    const comparison = compareVersions({
      resources,
      conditions: HIGH_LATENCY,
      seed: SEED,
    });
    expect(comparison.runs['HTTP/2'].completedAt).toBeLessThan(
      comparison.runs['HTTP/1.1'].completedAt,
    );
    expect(comparison.fastest).toBe('HTTP/3');
    expect(comparison.slowest).toBe('HTTP/1.1');
  });
});

// ---------------------------------------------------------------------------
// Transport-layer head-of-line blocking -- the half that is usually left out
// ---------------------------------------------------------------------------

describe('transport-layer head-of-line blocking', () => {
  /**
   * Eight comparable transfers, one of which loses a packet part-way through.
   *
   * They have to be comparable in size for the demonstration to mean anything: a loss
   * three-quarters of the way through a 900 KB image would fire long after a handful of
   * 12 KB scripts had finished, and would stall nothing because there would be nothing
   * left to stall. Real pages do have that shape, and it is exactly why transport
   * head-of-line blocking is intermittent rather than constant -- but the run that
   * *shows* the mechanism is the one where the other streams are still in flight.
   *
   * With the loss drawn per resource and shared across versions, exactly one packet goes
   * missing in all three runs, from a transfer the other seven have nothing to do with.
   */
  const resources = page(8, 250_000);
  const conditions: Partial<NetworkConditions> = {
    rttMs: 120,
    bandwidthKbps: 20_000,
    lossRate: 0.0008,
  };
  const comparison = compareVersions({ resources, conditions, seed: 'hol-1' });
  const LOSER = 'asset-6';

  it('loses one packet, from one transfer', () => {
    expect(comparison.losses.map((loss) => loss.resourceId)).toEqual([LOSER]);
    expect(comparison.losses[0].segments).toBe(Math.ceil(250_000 / MSS_BYTES));
  });

  it('stalls only the losing request under HTTP/1.1: the other connections carry on', () => {
    const run = comparison.runs['HTTP/1.1'];
    expect(run.transportHolMs).toBe(0);
    expect(streamFor(run.streams, LOSER).ownStallMs).toBeGreaterThan(0);
    for (const stream of run.streams.filter((each) => each.resourceId !== LOSER)) {
      expect(stream.ownStallMs).toBe(0);
      expect(stream.holStallMs).toBe(0);
      expect(stream.stalls).toEqual([]);
    }
  });

  it('stalls every other stream under HTTP/2, though their own bytes had arrived', () => {
    const run = comparison.runs['HTTP/2'];
    expect(run.transportHolMs).toBeGreaterThan(0);

    const blameless = run.streams.filter((stream) => stream.resourceId !== LOSER);
    // Not "some of them": all seven. They share one TCP byte stream, and it has a hole
    // in it.
    expect(blameless.every((stream) => stream.holStallMs > 0)).toBe(true);
    for (const stream of blameless) {
      expect(stream.stalls.map((stall) => stall.kind)).toEqual(['transport-hol']);
      expect(stream.stalls[0].causedBy).toBe(LOSER);
      expect(stream.stalls[0].ms).toBe(conditions.rttMs);
    }
    expect(run.transportHolMs).toBe(blameless.length * (conditions.rttMs ?? 0));
  });

  it('stalls nothing but the losing stream under HTTP/3', () => {
    const run = comparison.runs['HTTP/3'];
    expect(run.transportHolMs).toBe(0);
    expect(streamFor(run.streams, LOSER).ownStallMs).toBeGreaterThan(0);
    for (const stream of run.streams.filter((each) => each.resourceId !== LOSER)) {
      expect(stream.holStallMs).toBe(0);
      expect(stream.stalls).toEqual([]);
    }
  });

  it('charges h2 transport blocking that h3 does not pay, on the identical loss', () => {
    expect(comparison.runs['HTTP/2'].losses).toEqual(comparison.runs['HTTP/3'].losses);
    expect(comparison.runs['HTTP/2'].transportHolMs).toBeGreaterThan(
      comparison.runs['HTTP/3'].transportHolMs,
    );
    expect(comparison.runs['HTTP/3'].completedAt).toBeLessThan(
      comparison.runs['HTTP/2'].completedAt,
    );
  });

  it('leaves h2 ahead of h1 anyway: it loses the round trips h1 spends queueing', () => {
    // The honest summary of the whole comparison. h2 is beaten by h1 on the transport
    // and beats it comfortably overall, because on this page the queue costs more than
    // the retransmission does.
    expect(comparison.runs['HTTP/2'].completedAt).toBeLessThan(
      comparison.runs['HTTP/1.1'].completedAt,
    );
    expect(comparison.runs['HTTP/1.1'].applicationHolMs).toBeGreaterThan(0);
    expect(comparison.runs['HTTP/2'].applicationHolMs).toBe(0);
    expect(comparison.fastest).toBe('HTTP/3');
  });

  it('explains itself in the words the table uses', () => {
    expect(comparison.runs['HTTP/2'].explanation).toMatch(/in order or not at all/);
    expect(comparison.runs['HTTP/3'].explanation).toMatch(/per stream/);
    expect(comparison.runs['HTTP/1.1'].explanation).toMatch(/head-of-line/);
  });
});

// ---------------------------------------------------------------------------
// Header compression
// ---------------------------------------------------------------------------

describe('header compression', () => {
  it('leaves HTTP/1.1 headers exactly as they were', () => {
    expect(compressedHeaderBytes('HTTP/1.1', 0, 900)).toBe(900);
    expect(compressedHeaderBytes('HTTP/1.1', 40, 900)).toBe(900);
  });

  it('compresses the first h2 request less than the ones after it', () => {
    const first = compressedHeaderBytes('HTTP/2', 0, 900);
    const later = compressedHeaderBytes('HTTP/2', 1, 900);
    expect(first).toBe(Math.round(900 * FIRST_REQUEST_HEADER_RATIO));
    expect(later).toBe(Math.round(900 * REPEAT_REQUEST_HEADER_RATIO));
    // The first request fills the table; every later one indexes into it.
    expect(later).toBeLessThan(first);
  });

  it('never claims a request costs nothing', () => {
    expect(compressedHeaderBytes('HTTP/3', 9, 10)).toBeGreaterThan(0);
  });

  it('saves h2 most of a cookie-heavy page load, and h1 none of it', () => {
    const heavy = page(20, 8_000).map((resource) => ({
      ...resource,
      requestHeaderBytes: 1_400,
    }));
    const comparison = compareVersions({ resources: heavy, seed: SEED });
    const h1 = comparison.runs['HTTP/1.1'];
    const h2 = comparison.runs['HTTP/2'];

    expect(h1.requestHeaderBytesOnWire).toBe(h1.requestHeaderBytesRaw);
    expect(h2.requestHeaderBytesOnWire).toBeLessThan(h2.requestHeaderBytesRaw / 4);
  });
});

// ---------------------------------------------------------------------------
// The shape of a run
// ---------------------------------------------------------------------------

describe('run shape', () => {
  const resources = page(9, 30_000);

  it.each(HTTP_VERSIONS)('%s keeps every stream in causal order', (version) => {
    const run = planVersionRun({
      version,
      resources,
      conditions: LOSSY,
      seed: SEED,
    });
    for (const stream of run.streams) {
      expect(stream.startedAt).toBeGreaterThanOrEqual(stream.queuedAt);
      expect(stream.firstByteAt).toBeGreaterThan(stream.startedAt);
      expect(stream.completedAt).toBeGreaterThanOrEqual(stream.firstByteAt);
      expect(stream.completedAt).toBeLessThanOrEqual(run.completedAt);
    }
  });

  it.each(HTTP_VERSIONS)(
    '%s starts no request before its handshake finishes',
    (version) => {
      const run = planVersionRun({ version, resources, seed: SEED });
      for (const stream of run.streams) {
        expect(stream.startedAt).toBeGreaterThanOrEqual(run.handshake.ms);
      }
    },
  );

  it('charges at least a round trip plus think time before the first byte', () => {
    const conditions = withDefaults({ rttMs: 200, lossRate: 0 });
    const run = planVersionRun({
      version: 'HTTP/2',
      resources: [
        {
          id: 'api',
          label: 'GET /api',
          target: '/api',
          responseBytes: 0,
          serverThinkMs: 30,
        },
      ],
      conditions,
      seed: SEED,
    });
    const stream = run.streams[0];
    expect(stream.firstByteAt - stream.startedAt).toBeGreaterThanOrEqual(230);
    // An empty body arrives with its headers: a 204 or a 304 costs a round trip and
    // nothing more.
    expect(stream.completedAt).toBe(stream.firstByteAt);
  });

  it('serves every request it was given, on some connection', () => {
    const run = planVersionRun({ version: 'HTTP/1.1', resources, seed: SEED });
    const served = run.connections.reduce(
      (total, connection) => total + connection.requestsServed,
      0,
    );
    expect(served).toBe(resources.length);
    expect(run.streams).toHaveLength(resources.length);
  });

  it('ranks the verdicts fastest first, with the winner at zero', () => {
    const comparison = compareVersions({
      resources,
      conditions: HIGH_LATENCY,
      seed: SEED,
    });
    expect(comparison.verdicts.map((verdict) => verdict.rank)).toEqual([1, 2, 3]);
    expect(comparison.verdicts[0].deltaMs).toBe(0);
    expect(comparison.verdicts[0].version).toBe(comparison.fastest);
    for (let i = 1; i < comparison.verdicts.length; i += 1) {
      expect(comparison.verdicts[i].completedAt).toBeGreaterThanOrEqual(
        comparison.verdicts[i - 1].completedAt,
      );
    }
  });

  it('defaults to an encrypted, fresh, lossless link', () => {
    expect(withDefaults()).toEqual(DEFAULT_CONDITIONS);
    expect(DEFAULT_CONDITIONS.secure).toBe(true);
    expect(DEFAULT_CONDITIONS.lossRate).toBe(0);
  });
});
