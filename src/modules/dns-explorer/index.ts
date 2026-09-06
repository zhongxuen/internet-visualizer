/**
 * DNS Explorer's public surface.
 *
 * The route imports the composition root from here; the scenarios are re-exported so the
 * Learning Center can name the same six runs. Note that another *module* may not import
 * any of this (`eslint.config.mjs`) -- shared code belongs in `@/core` or
 * `@/components`.
 *
 * The resolver itself is not here and is not re-exported through here. It is
 * `@/core/protocols/dns`, which anything may import: a module that needs a name resolved
 * asks that layer directly rather than reaching through this folder for it.
 *
 * Nothing exported here can reach a network. A run reads the bundled zone fixtures and
 * nothing else, which is the property the whole module rests on.
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
