/**
 * The DNS Explorer scenario catalogue.
 *
 * Six runs over one simulated Internet, ordered so that each is the previous picture
 * with one thing changed:
 *
 * 1. `cold-cache` -- the whole walk, from a resolver that knows nothing. Everything else
 *    is a variation on this ladder, so it goes first.
 * 2. `warm-cache` -- the same question asked twice. Change: the resolver remembers.
 * 3. `cname-chain` -- the name is an alias. Change: the answer is a redirection.
 * 4. `cdn-lookup` -- the alias points out of the zone. Change: the walk restarts, and
 *    somebody else decides the answer.
 * 5. `nxdomain` -- the name is not there. Change: the answer is a negative one, and it
 *    is cached like any other.
 * 6. `dnssec-validated` -- the answer has to be provable. Change: everything, and it
 *    costs eleven queries.
 *
 * The scenario picker, the route, and the tests all read this list; nothing else
 * hardcodes a scenario id.
 */

import type { DnsScenario } from './run';

import { CDN_LOOKUP } from './cdn-lookup';
import { CNAME_CHAIN } from './cname-chain';
import { COLD_CACHE } from './cold-cache';
import { DNSSEC_VALIDATED } from './dnssec-validated';
import { NXDOMAIN } from './nxdomain';
import { WARM_CACHE } from './warm-cache';

export { COLD_CACHE, WARM_CACHE, CNAME_CHAIN, CDN_LOOKUP, NXDOMAIN, DNSSEC_VALIDATED };
export { CDN_VANTAGES } from './cdn-lookup';
export {
  DNS_TAIL_MS,
  RESOLVER_NODE,
  STUB_NODE,
  runDnsScenario,
  type DnsLookup,
  type DnsRun,
  type DnsScenario,
  type DnsScenarioOverrides,
  type ScenarioNote,
} from './run';

/** The ids this module offers, so a route param can be narrowed to one of them. */
export type DnsScenarioId =
  | 'cold-cache'
  | 'warm-cache'
  | 'cname-chain'
  | 'cdn-lookup'
  | 'nxdomain'
  | 'dnssec-validated';

/** Every scenario, in teaching order. */
export const DNS_SCENARIOS: readonly DnsScenario[] = [
  COLD_CACHE,
  WARM_CACHE,
  CNAME_CHAIN,
  CDN_LOOKUP,
  NXDOMAIN,
  DNSSEC_VALIDATED,
];

/** The scenario the module opens on. */
export const DEFAULT_DNS_SCENARIO_ID: DnsScenarioId = 'cold-cache';

/** Look up a scenario by id; `undefined` for anything this module does not offer. */
export function getDnsScenario(id: string): DnsScenario | undefined {
  return DNS_SCENARIOS.find((scenario) => scenario.id === id);
}
