/**
 * What each of the eight page loads has to actually demonstrate.
 *
 * A scenario is data, so the risk is not that it crashes -- it is that it quietly stops
 * teaching the thing it was written for. A stored copy that turns out to be fresh instead
 * of stale still produces a plausible-looking run, and the 304 lesson is simply gone. So
 * these tests assert the *outcome* of each run rather than its shape: which cache verdict,
 * which source, which stages were skipped, and by how much the repeat visit beat the first.
 */

import { describe, expect, it } from 'vitest';

import { runPageLoad, stageOf } from '../sim/pipeline';
import { NETWORK_PROFILES, STAGE_IDS } from '../sim/stage';
import { parseUrl } from '../sim/stages/url-parse';

import {
  CDN_HIT,
  CDN_MISS_ORIGIN_FETCH,
  DEFAULT_SIMULATOR_SCENARIO_ID,
  FAILURE_DNS,
  FAILURE_TIMEOUT,
  FAILURE_TLS,
  FIRST_VISIT_HTTPS,
  getSimulatorScenario,
  REPEAT_VISIT_CACHED,
  SIMULATOR_SCENARIOS,
  SLOW_NETWORK,
} from './index';

describe('the catalogue', () => {
  it('is the eight runs the phase doc names, with unique ids', () => {
    expect(SIMULATOR_SCENARIOS).toHaveLength(8);
    const ids = SIMULATOR_SCENARIOS.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'first-visit-https',
      'repeat-visit-cached',
      'cdn-hit',
      'cdn-miss-origin-fetch',
      'slow-network',
      'failure-dns',
      'failure-tls',
      'failure-timeout',
    ]);
  });

  it('opens on a scenario it actually has', () => {
    expect(getSimulatorScenario(DEFAULT_SIMULATOR_SCENARIO_ID)).toBeDefined();
    expect(getSimulatorScenario('not-a-scenario')).toBeUndefined();
  });

  it('gives every run a title, a summary, and something it teaches', () => {
    for (const scenario of SIMULATOR_SCENARIOS) {
      expect(scenario.title.length).toBeGreaterThan(0);
      expect(scenario.summary.length).toBeGreaterThan(20);
      expect(scenario.teaches.length).toBeGreaterThan(0);
    }
  });

  it('names only hosts and addresses that are reserved for documentation', () => {
    // RFC 2606 reserves example.com / example.net; RFC 5737 reserves the three address
    // ranges. Nothing in this module can reach a network, and this test is the standing
    // proof that nothing in it even *names* something that could be mistaken for one.
    for (const scenario of SIMULATOR_SCENARIOS) {
      const url = parseUrl(scenario.url);
      expect(url.ok, scenario.id).toBe(true);
      if (url.ok) expect(url.value.host).toMatch(/\.example\.(com|net|org)$/);

      const addresses = [
        scenario.origin.address,
        ...(scenario.cdn ? [scenario.cdn.address] : []),
      ];
      for (const address of addresses) {
        expect(address, `${scenario.id}: ${address}`).toMatch(
          /^(192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)/,
        );
      }
    }
  });

  it('runs every scenario on every profile without throwing', () => {
    for (const scenario of SIMULATOR_SCENARIOS) {
      for (const profile of NETWORK_PROFILES) {
        const run = runPageLoad(scenario, { profile: profile.id });
        expect(run.result.events.length, `${scenario.id}/${profile.id}`).toBeGreaterThan(
          0,
        );
        expect(run.stages.map((stage) => stage.id)).toEqual(STAGE_IDS);
      }
    }
  });
});

describe('first-visit-https: cold everything', () => {
  const run = runPageLoad(FIRST_VISIT_HTTPS);

  it('walks DNS from the root, opens a connection, and does a full handshake', () => {
    expect(run.state.dns?.servedFromCache).toBe(false);
    expect(run.state.dns?.queryCount ?? 0).toBeGreaterThan(1);
    expect(run.state.tcp?.established).toBe(true);
    expect(run.state.tls?.handshake13?.mode).toBe('full-1rtt');
    expect(run.state.tls?.validation.trusted).toBe(true);
  });

  it('spends most of the time before the request is even sent', () => {
    const beforeRequest = (['dns', 'tcp', 'tls'] as const).reduce(
      (total, id) => total + (stageOf(run, id)?.durationMs ?? 0),
      0,
    );
    expect(beforeRequest).toBeGreaterThan(stageOf(run, 'http')!.durationMs);
    expect(run.metrics.ttfbMs).toBeGreaterThan(beforeRequest);
  });

  it('fetches every subresource over the network and marks the paints', () => {
    expect(run.state.render?.fetches).toHaveLength(5);
    expect(run.state.render?.fetches.every((fetch) => fetch.source === 'network')).toBe(
      true,
    );
    expect(run.metrics.firstPaintMs).toBeDefined();
    expect(run.metrics.largestContentfulPaintMs).toBeGreaterThanOrEqual(
      run.metrics.firstPaintMs!,
    );
  });

  it('blocks the first paint on the stylesheet, and says so', () => {
    expect(run.state.render?.blockedFirstPaintBy).toContain('app.css');
  });
});

describe('repeat-visit-cached: measurably faster, and for four separate reasons', () => {
  const cold = runPageLoad(FIRST_VISIT_HTTPS);
  const warm = runPageLoad(REPEAT_VISIT_CACHED);

  it('loads dramatically faster than the first visit on the same link', () => {
    expect(warm.profile.id).toBe(cold.profile.id);
    expect(warm.result.durationMs).toBeLessThan(cold.result.durationMs * 0.6);
    expect(warm.metrics.largestContentfulPaintMs!).toBeLessThan(
      cold.metrics.largestContentfulPaintMs! * 0.5,
    );
  });

  it('saves the DNS walk: the resolver answers from memory', () => {
    expect(warm.state.dns?.servedFromCache).toBe(true);
    expect(warm.state.dns?.queryCount).toBe(0);
    expect(stageOf(warm, 'dns')!.durationMs).toBeLessThan(
      stageOf(cold, 'dns')!.durationMs,
    );
  });

  it('saves the handshake: resumption sends no certificate and waits for nothing', () => {
    expect(warm.state.tls?.handshake13?.mode).toBe('psk-0rtt');
    expect(warm.state.tls?.roundTrips).toBe(0);
    expect(stageOf(warm, 'tls')!.durationMs).toBe(0);
    expect(stageOf(cold, 'tls')!.durationMs).toBeGreaterThan(0);
  });

  it('saves the body: the document is stale, revalidates, and comes back as a 304', () => {
    expect(warm.state.cache?.outcome).toBe('revalidate');
    expect(warm.state.cache?.validators.length).toBeGreaterThan(0);
    expect(warm.state.http?.conditional).toBe(true);
    expect(warm.state.cdn?.outcome).toBe('REVALIDATED');
    expect(warm.state.cdn?.bodyBytes).toBe(0);
    expect(warm.state.cdn?.transferredBytes ?? 0).toBeLessThan(
      cold.state.cdn!.transferredBytes,
    );
  });

  it('saves the subresources entirely: four of five are never requested', () => {
    const fromCache = warm.state.render!.fetches.filter(
      (fetch) => fetch.source === 'browser-cache',
    );
    const overTheWire = warm.state.render!.fetches.filter(
      (fetch) => fetch.source === 'network',
    );
    expect(fromCache).toHaveLength(4);
    // `/api/session` is `no-store`, so it is fetched every time -- which is the point of
    // the directive and the reason it is in the page.
    expect(overTheWire.map((fetch) => fetch.resource.label)).toEqual(['session.json']);
    expect(warm.metrics.transferredBytes).toBeLessThan(cold.metrics.transferredBytes / 4);
  });

  it('is faster on every one of the five links, not just the authored one', () => {
    for (const profile of NETWORK_PROFILES) {
      const a = runPageLoad(FIRST_VISIT_HTTPS, { profile: profile.id });
      const b = runPageLoad(REPEAT_VISIT_CACHED, { profile: profile.id });
      expect(b.result.durationMs, profile.id).toBeLessThan(a.result.durationMs);
    }
  });
});

describe('the CDN pair: the same page, one thing changed', () => {
  const hit = runPageLoad(CDN_HIT);
  const miss = runPageLoad(CDN_MISS_ORIGIN_FETCH);

  it('serves the hit from the edge without contacting the origin', () => {
    expect(hit.state.cdn?.source).toBe('edge-cache');
    expect(hit.state.cdn?.originFetched).toBe(false);
    expect(hit.state.cdn?.edgeLookup?.kind).toBe('hit');
    expect(hit.topology.nodes.map((node) => node.id)).toContain('edge');
  });

  it('forwards the miss to the origin, and the user waits for it', () => {
    expect(miss.state.cdn?.source).toBe('origin-via-edge');
    expect(miss.state.cdn?.originFetched).toBe(true);
    expect(miss.state.cdn?.edgeLookup?.kind).toBe('miss');
    expect(miss.topology.nodes.map((node) => node.id)).toContain('origin');
  });

  it('costs the miss roughly the origin round trip more, and nothing else differs', () => {
    const hitStage = stageOf(hit, 'cdn')!;
    const missStage = stageOf(miss, 'cdn')!;
    const originRtt = CDN_HIT.cdn!.originRttMs;

    expect(missStage.durationMs - hitStage.durationMs).toBeGreaterThan(originRtt);
    expect(miss.metrics.ttfbMs!).toBeGreaterThan(hit.metrics.ttfbMs!);

    // Everything up to the CDN stage is the same work; only the edge's answer changed.
    for (const id of ['url-parse', 'cache-check', 'tcp', 'tls', 'http'] as const) {
      expect(stageOf(miss, id)!.durationMs).toBeCloseTo(stageOf(hit, id)!.durationMs, 1);
    }
  });

  it('stores what it fetched, so the next visitor would get the hit', () => {
    expect(miss.state.cdn?.edgeCache?.entries.length).toBe(1);
  });
});

describe('slow-network: the same load, and now it is all round trips', () => {
  const fast = runPageLoad(FIRST_VISIT_HTTPS);
  const slow = runPageLoad(SLOW_NETWORK);

  it('runs the identical page over a much slower link', () => {
    expect(slow.profile.id).toBe('3g');
    expect(slow.page.totalBytes).toBe(fast.page.totalBytes);
    expect(slow.result.durationMs).toBeGreaterThan(fast.result.durationMs * 3);
  });

  it('makes the handshakes cost many times more in absolute terms', () => {
    const setupMs = (run: typeof fast): number =>
      (['dns', 'tcp', 'tls'] as const).reduce(
        (total, id) => total + (stageOf(run, id)?.durationMs ?? 0),
        0,
      );
    expect(setupMs(slow)).toBeGreaterThan(setupMs(fast) * 5);
  });

  it('is squeezed from both ends, unlike satellite -- which is the sharper lesson', () => {
    // 3G is slow twice over: 200 ms of latency *and* 1.6 Mbit/s of capacity. So the
    // handshakes grow enormously and the transfers grow more, and the setup's *share* of
    // the load actually falls. Satellite is the controlled version of the experiment --
    // more bandwidth than 3G and three times the latency -- and there the share rises,
    // which is what isolates round trips as the thing a page load is really made of.
    const share = (run: typeof fast): number =>
      (['dns', 'tcp', 'tls'] as const).reduce(
        (total, id) => total + (stageOf(run, id)?.share ?? 0),
        0,
      );
    const satellite = runPageLoad(SLOW_NETWORK, { profile: 'satellite' });

    expect(share(slow)).toBeLessThan(share(fast));
    expect(share(satellite)).toBeGreaterThan(share(fast));
    expect(satellite.profile.bandwidthKbps).toBeGreaterThan(slow.profile.bandwidthKbps);
    expect(satellite.result.durationMs).toBeGreaterThan(slow.result.durationMs);
  });
});

describe('the three failures end where they should, in the error a user would see', () => {
  it('DNS: a definite negative answer, and nothing was ever connected to', () => {
    const run = runPageLoad(FAILURE_DNS);
    expect(run.failure?.stage).toBe('dns');
    expect(run.failure?.code).toBe('DNS_PROBE_FINISHED_NXDOMAIN');
    expect(run.state.dns?.resolution.rcode).toBe('NXDOMAIN');
    expect(run.state.tcp).toBeUndefined();
    expect(run.failure?.explanation).toContain('does not exist');
  });

  it('TLS: everything worked, and the browser refused anyway', () => {
    const run = runPageLoad(FAILURE_TLS);
    expect(run.failure?.stage).toBe('tls');
    expect(run.failure?.code).toBe('NET::ERR_CERT_DATE_INVALID');
    expect(run.state.tcp?.established).toBe(true);
    expect(run.state.tls?.validation.trusted).toBe(false);

    // Exactly one of the five checks failed; the interstitial names that one.
    expect(run.state.tls?.validation.failures).toHaveLength(1);
    expect(run.state.tls?.validation.failures[0]?.id).toBe('validity-period');
    expect(run.state.http).toBeUndefined();
  });

  it('timeout: the address was fine, and nothing answered it', () => {
    const run = runPageLoad(FAILURE_TIMEOUT);
    expect(run.failure?.stage).toBe('tcp');
    expect(run.failure?.code).toBe('ERR_CONNECTION_TIMED_OUT');
    expect(run.state.dns?.addresses.length).toBeGreaterThan(0);
    expect(run.state.tcp?.established).toBe(false);
    expect(run.state.tcp?.connection.client.state).toBe('SYN_SENT');

    // One SYN and three retransmissions, every one of them dropped.
    expect(run.state.tcp?.steps).toHaveLength(4);
    expect(run.state.tcp?.steps.every((step) => step.lost)).toBe(true);

    // The doubling timer, and the reason this failure takes seconds rather than milliseconds.
    const gaps = (run.state.tcp?.steps ?? [])
      .slice(1)
      .map((step, index) => step.at - (run.state.tcp?.steps[index].at ?? 0));
    expect(gaps).toEqual([1000, 2000, 4000]);
    expect(stageOf(run, 'tcp')!.durationMs).toBe(15_000);
  });

  it('fails faster on NXDOMAIN than on a silent host, by orders of magnitude', () => {
    expect(runPageLoad(FAILURE_DNS).result.durationMs).toBeLessThan(
      runPageLoad(FAILURE_TIMEOUT).result.durationMs / 10,
    );
  });
});
