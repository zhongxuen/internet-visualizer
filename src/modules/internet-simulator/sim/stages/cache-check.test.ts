import { describe, expect, it } from 'vitest';

import { createRng } from '@/core/sim/rng';
import type { SimEvent } from '@/core/types/events';

import { REPEAT_VISIT_CACHED } from '../../scenarios/repeat-visit-cached';
import { SITE_HOST, SITE_ORIGIN, WARM_STORE } from '../../scenarios/common';
import { buildPage, retarget, warmCache } from '../page';
import {
  SIM_CLOCK,
  networkProfile,
  type SimulatorScenario,
  type StageContext,
} from '../stage';
import { buildTopology } from '../topology';
import { cacheCheckStage, SERVICE_WORKER_STARTUP_MS } from './cache-check';
import { parseUrl } from './url-parse';

/**
 * The three local checks a browser runs before it will open a socket -- driven directly,
 * one branch at a time.
 *
 * `pipeline.test.ts` runs whole scenarios end to end, which is the right test of
 * composition and the wrong one for this stage: the shipped scenarios exercise a cold
 * miss and a stale document, and nothing else. HSTS upgrading an `http://` URL inside the
 * browser, a cache-first service worker answering while the network is untouched, and a
 * `no-store` response bypassing the cache entirely are each a different reason the rest
 * of the pipeline does or does not run, and each is invisible in a waterfall precisely
 * because it avoided the network. Reaching the stage directly is the only way to ask
 * about them one at a time.
 *
 * The stage is a pure function of its `StageContext`, so "reaching it directly" is just
 * building one -- no mocking, and no second copy of the scenario data.
 */

const PROFILE = networkProfile('cable');

/** Build the context the pipeline would have handed this stage, for any scenario. */
function contextFor(scenario: SimulatorScenario): StageContext {
  const url = parseUrl(scenario.url);
  if (!url.ok) throw new Error(`test scenario has an unparseable URL: ${scenario.url}`);

  const page = retarget(buildPage(scenario, url.value.host), url.value.target);
  const version = scenario.tls?.alpn === 'http/1.1' ? 'HTTP/1.1' : 'HTTP/2';

  return {
    stage: 'cache-check',
    scenario,
    profile: PROFILE,
    clock: SIM_CLOCK,
    topology: buildTopology(scenario, PROFILE),
    // The stage draws nothing: the three checks are decisions, not samples.
    rng: createRng('cache-check draws nothing'),
    state: {
      url: url.value,
      page,
      browserCache: warmCache(
        'browser',
        page,
        scenario.stored ?? [],
        version,
        PROFILE.rttMs,
      ),
    },
  };
}

/** A scenario built from the shared site, varied only in what this stage looks at. */
function scenarioWith(overrides: Partial<SimulatorScenario>): SimulatorScenario {
  return {
    id: 'cache-check-fixture',
    title: 'Cache check fixture',
    summary: 'Exists to drive one branch of the pre-flight checks.',
    teaches: [],
    url: `https://${SITE_HOST}/`,
    origin: SITE_ORIGIN,
    ...overrides,
  };
}

function logs(events: readonly SimEvent[]): string[] {
  return events.filter((event) => event.kind === 'log').map((event) => event.text);
}

function annotations(events: readonly SimEvent[]): string[] {
  return events.filter((event) => event.kind === 'annotate').map((event) => event.text);
}

describe('1. HSTS', () => {
  /**
   * The redirect that is not a redirect. On the preload list, `http://` becomes
   * `https://` inside the browser before a packet exists -- so the cleartext request an
   * attacker on the path used to intercept never happens, and neither does the round trip
   * it cost.
   */
  it('upgrades an http URL locally, and says it was not a network redirect', () => {
    const output = cacheCheckStage(
      contextFor(scenarioWith({ url: `http://${SITE_HOST}/`, hstsPreloaded: true })),
    );

    expect(output.state?.cache?.hstsUpgraded).toBe(true);
    expect(logs(output.events).join(' ')).toMatch(/http:\/\/ became https:\/\//);
    expect(annotations(output.events).join(' ')).toMatch(/internal 307, not a network/i);
  });

  /** On the list but already https: there is nothing to upgrade, and it says so. */
  it('notes the list without claiming an upgrade when the URL is already https', () => {
    const output = cacheCheckStage(contextFor(scenarioWith({ hstsPreloaded: true })));

    expect(output.state?.cache?.hstsUpgraded).toBe(false);
    expect(logs(output.events).join(' ')).toMatch(/already https/);
    expect(annotations(output.events).join(' ')).not.toMatch(/internal 307/i);
  });

  /** Not on the list: the check happened, and there is nothing to report about it. */
  it('says nothing at all for a host that is not preloaded', () => {
    const output = cacheCheckStage(contextFor(scenarioWith({})));

    expect(output.state?.cache?.hstsUpgraded).toBe(false);
    expect(logs(output.events).join(' ')).not.toMatch(/HSTS/);
  });
});

describe('2. the service worker', () => {
  /**
   * The offline lesson. A cache-first worker answers from its own storage, which is not
   * the HTTP cache and obeys none of its rules -- so this outcome is reached whatever the
   * document's `Cache-Control` says, and nothing after it needs to run.
   */
  it('lets a cache-first worker answer, skipping the network entirely', () => {
    const output = cacheCheckStage(
      contextFor(
        scenarioWith({
          serviceWorker: {
            scriptTarget: '/sw.js',
            strategy: 'cache-first',
            holdsDocument: true,
          },
        }),
      ),
    );
    const check = output.state?.cache;

    expect(check?.outcome).toBe('service-worker');
    expect(check?.serviceWorkerRan).toBe(true);
    expect(check?.skipsNetwork).toBe(true);
    expect(check?.served).toBeDefined();
    expect(output.summary).toBe('Answered by the service worker');
    // Five stages become unnecessary, each with its own sentence.
    expect(Object.keys(output.skipAhead ?? {}).sort()).toEqual([
      'cdn',
      'dns',
      'http',
      'tcp',
      'tls',
    ]);
  });

  it('charges the startup cost of waking a dormant worker', () => {
    const output = cacheCheckStage(
      contextFor(
        scenarioWith({
          serviceWorker: {
            scriptTarget: '/sw.js',
            strategy: 'cache-first',
            holdsDocument: true,
          },
        }),
      ),
    );

    expect(output.durationMs).toBeGreaterThanOrEqual(SERVICE_WORKER_STARTUP_MS);
    expect(logs(output.events).join(' ')).toContain('/sw.js');
  });

  it('passes the request through when the worker is network-first', () => {
    const output = cacheCheckStage(
      contextFor(
        scenarioWith({
          serviceWorker: {
            scriptTarget: '/sw.js',
            strategy: 'network-first',
            holdsDocument: true,
          },
        }),
      ),
    );

    expect(output.state?.cache?.outcome).toBe('miss');
    expect(output.state?.cache?.serviceWorkerRan).toBe(true);
    expect(logs(output.events).join(' ')).toMatch(/network-first/);
  });

  it('passes the request through when a cache-first worker holds nothing', () => {
    const output = cacheCheckStage(
      contextFor(
        scenarioWith({
          serviceWorker: {
            scriptTarget: '/sw.js',
            strategy: 'cache-first',
            holdsDocument: false,
          },
        }),
      ),
    );

    expect(output.state?.cache?.outcome).toBe('miss');
    expect(logs(output.events).join(' ')).toMatch(/nothing stored for this URL/);
  });
});

describe('3. the private cache', () => {
  it('reports a cold miss when nothing is stored', () => {
    const output = cacheCheckStage(contextFor(scenarioWith({})));
    const check = output.state?.cache;

    expect(check?.outcome).toBe('miss');
    expect(check?.skipsNetwork).toBe(false);
    expect(check?.validators).toEqual([]);
    expect(output.summary).toBe('Nothing stored');
    expect(output.skipAhead).toBeUndefined();
  });

  /**
   * The whole repeat-visit lesson in one assertion: stale is not gone. The stored copy
   * stays, the request goes out carrying validators, and the answer can be a bodiless
   * 304 -- which saves the bytes without saving the round trip.
   */
  it('attaches validators to a stale document rather than discarding it', () => {
    const output = cacheCheckStage(contextFor(REPEAT_VISIT_CACHED));
    const check = output.state?.cache;

    expect(check?.outcome).toBe('revalidate');
    expect(check?.skipsNetwork).toBe(false);
    expect(check?.validators.map((field) => field.name).sort()).toEqual([
      'If-Modified-Since',
      'If-None-Match',
    ]);
    // The validators are on the request that will actually go out, not just recorded.
    expect(check?.request.headers).toEqual(
      expect.arrayContaining([...(check?.validators ?? [])]),
    );
    expect(output.summary).toBe('Stale -- will revalidate');
    expect(annotations(output.events).join(' ')).toMatch(/304 with no body/);
  });

  /**
   * A fresh hit is the only outcome that makes the entire rest of the pipeline
   * unnecessary. `max-age=60` and a copy stored ten seconds ago is the case the shipped
   * scenarios do not have -- their document is deliberately stale.
   */
  it('serves a fresh copy and skips five stages', () => {
    const output = cacheCheckStage(
      contextFor(scenarioWith({ stored: [{ target: '/', storedSecondsAgo: 10 }] })),
    );
    const check = output.state?.cache;

    expect(check?.outcome).toBe('fresh');
    expect(check?.skipsNetwork).toBe(true);
    expect(check?.served).toBeDefined();
    expect(check?.validators).toEqual([]);
    expect(output.summary).toBe('Fresh hit -- nothing sent');
    expect(Object.keys(output.skipAhead ?? {})).toHaveLength(5);
    expect(annotations(output.events).join(' ')).toMatch(/nothing is sent/i);
  });

  /**
   * A `no-store` *response* is still a lookup miss on the way out -- there was nothing
   * stored to find -- and the interesting half is what it means on the way back: the
   * answer will not be written either, so the next visit repeats this exactly.
   *
   * Worth being precise about, because the stage also has a `bypass` outcome and this is
   * not it. `lookupCache` returns `bypass` for a *request*-side `no-store` or an
   * uncacheable method, and this module builds every request itself, as a `GET` with no
   * `Cache-Control` -- so `bypass` is defensive here rather than reachable from a
   * scenario. Asserting it would mean asserting a branch no page load can take.
   */
  it('warns that a no-store response will not be written on the way back', () => {
    const noStore = scenarioWith({
      origin: {
        ...SITE_ORIGIN,
        document: { ...SITE_ORIGIN.document, cacheControl: 'no-store' },
      },
    });
    const output = cacheCheckStage(contextFor(noStore));

    expect(output.state?.cache?.outcome).toBe('miss');
    expect(logs(output.events).join(' ')).toMatch(/nothing about it will be written/);
    expect(
      output.events.some((event) => event.kind === 'log' && event.level === 'warn'),
    ).toBe(true);
  });

  it('hands the cache forward so later stages write into the same one', () => {
    const context = contextFor(scenarioWith({ stored: [...WARM_STORE] }));
    const output = cacheCheckStage(context);

    expect(output.state?.browserCache).toBe(context.state.browserCache);
    expect(output.state?.cache?.browserCache).toBe(context.state.browserCache);
  });

  /** No cache handed in at all: the stage makes one rather than throwing. */
  it('starts an empty cache when no earlier stage supplied one', () => {
    const context = contextFor(scenarioWith({}));
    const output = cacheCheckStage({
      ...context,
      state: { url: context.state.url, page: context.state.page },
    });

    expect(output.state?.browserCache).toBeDefined();
    expect(output.state?.cache?.outcome).toBe('miss');
  });
});

describe('the stage contract', () => {
  it('opens with its phase at local time zero', () => {
    const events = cacheCheckStage(contextFor(scenarioWith({}))).events;

    expect(events[0]).toMatchObject({ kind: 'phase', at: 0, id: 'cache-check' });
  });

  it('is deterministic', () => {
    expect(cacheCheckStage(contextFor(REPEAT_VISIT_CACHED))).toStrictEqual(
      cacheCheckStage(contextFor(REPEAT_VISIT_CACHED)),
    );
  });

  /** Every stage needs the URL and the page model; asking without them is a wiring bug. */
  it('names itself when the state it needs did not arrive', () => {
    const context = contextFor(scenarioWith({}));

    expect(() => cacheCheckStage({ ...context, state: {} })).toThrow(/cache-check/);
  });
});
