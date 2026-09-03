/**
 * DNS Explorer's public surface.
 *
 * The route imports the composition root from here; the scenarios and the resolver are
 * re-exported so the Learning Center can name the same six runs, and so a later module
 * that needs a name resolved can ask for one without reaching into the folder. Note that
 * another *module* may not import any of this (`eslint.config.mjs`) -- shared code
 * belongs in `@/core` or `@/components`.
 *
 * Nothing exported here can reach a network. `resolve` reads the bundled zone fixtures
 * and nothing else, which is the property the whole module rests on.
 */

export { DnsExplorerModule } from './DnsExplorerModule';
export { DNS_EXPLORER_ID, dnsExplorerMeta } from './meta';
export {
  DEFAULT_DNS_SCENARIO_ID,
  DNS_SCENARIOS,
  getDnsScenario,
  runDnsScenario,
  type DnsRun,
  type DnsScenario,
  type DnsScenarioId,
} from './scenarios';
export {
  buildLadder,
  currentRungIndex,
  ladderSummary,
  rungAt,
  type Ladder,
  type LadderColumn,
  type LadderRung,
  type RungKind,
  type RungTone,
} from './ladder';
export {
  coverageFor,
  CUSTOM_LOOKUP_ID,
  DEFAULT_DRAFT,
  hostnameFromInput,
  lookupScenario,
  lookupSchema,
  parseLookup,
  reversePtrName,
  simulatedZoneFor,
  TRANSPORT_LABELS,
  type CacheState,
  type Lookup,
  type LookupCoverage,
  type LookupDraft,
} from './lookup';
export { resolve, type DnsResolution, type ResolutionStep } from './sim/resolver';
export { SIMULATED_INTERNET, type RrType } from './sim/records';
