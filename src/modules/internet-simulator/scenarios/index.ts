/**
 * The eight page loads, in teaching order.
 *
 * Each one is the previous picture with a single thing added or a single assumption
 * removed, so a learner never has to hold two changes in their head at once:
 *
 * 1. `first-visit-https` -- the baseline. Nothing is cached anywhere, and every stage
 *    charges full price.
 * 2. `repeat-visit-cached` -- change: the browser has been here before. Four stages get
 *    dramatically cheaper, each for a different reason, and the UI names each one.
 * 3. `cdn-hit` -- change: the far end moves closer. Same page, same protocol, a fraction of
 *    the distance.
 * 4. `cdn-miss-origin-fetch` -- change: the near machine turns out not to have it. The
 *    controlled comparison against (3), and the reason cache-hit ratios are quoted.
 * 5. `slow-network` -- change: the link. Identical to (1) in every other respect, which is
 *    what makes it a measurement of latency rather than an anecdote about it.
 * 6. `failure-dns` -- change: the name does not exist. A definite answer, quickly.
 * 7. `failure-tls` -- change: the certificate is out of date. Everything worked and the
 *    browser refused anyway.
 * 8. `failure-timeout` -- change: nothing answers. The absence of an answer, slowly.
 *
 * The three failures are last and are ordered by *which stage* they end in, so the rail
 * shows the run getting further each time before it stops.
 *
 * Every scenario is a bundled fixture. There is no code path from any file in this folder
 * to a real network: no `fetch`, no socket, and no host outside the ranges RFC 2606 and
 * RFC 5737 reserve so an example can never be mistaken for a real one.
 */

import type { SimulatorScenario } from '../sim/stage';

import { CDN_HIT } from './cdn-hit';
import { CDN_MISS_ORIGIN_FETCH } from './cdn-miss-origin-fetch';
import { FAILURE_DNS } from './failure-dns';
import { FAILURE_TIMEOUT } from './failure-timeout';
import { FAILURE_TLS } from './failure-tls';
import { FIRST_VISIT_HTTPS } from './first-visit-https';
import { REPEAT_VISIT_CACHED } from './repeat-visit-cached';
import { SLOW_NETWORK } from './slow-network';

export {
  CDN_HIT,
  CDN_MISS_ORIGIN_FETCH,
  FAILURE_DNS,
  FAILURE_TIMEOUT,
  FAILURE_TLS,
  FIRST_VISIT_HTTPS,
  REPEAT_VISIT_CACHED,
  SLOW_NETWORK,
};

export * from './common';

/** The ids this module offers, so a route param can be narrowed to one of them. */
export type SimulatorScenarioId =
  | 'first-visit-https'
  | 'repeat-visit-cached'
  | 'cdn-hit'
  | 'cdn-miss-origin-fetch'
  | 'slow-network'
  | 'failure-dns'
  | 'failure-tls'
  | 'failure-timeout';

/** Every scenario, in teaching order. */
export const SIMULATOR_SCENARIOS: readonly SimulatorScenario[] = [
  FIRST_VISIT_HTTPS,
  REPEAT_VISIT_CACHED,
  CDN_HIT,
  CDN_MISS_ORIGIN_FETCH,
  SLOW_NETWORK,
  FAILURE_DNS,
  FAILURE_TLS,
  FAILURE_TIMEOUT,
];

/** The scenario the module opens on. */
export const DEFAULT_SIMULATOR_SCENARIO_ID: SimulatorScenarioId = 'first-visit-https';

/** Look a scenario up by id; `undefined` for anything this module does not offer. */
export function getSimulatorScenario(id: string): SimulatorScenario | undefined {
  return SIMULATOR_SCENARIOS.find((scenario) => scenario.id === id);
}
