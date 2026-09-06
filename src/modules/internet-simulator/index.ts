/**
 * The Internet Simulator's public surface.
 *
 * The route imports the composition root from here; the scenarios, the pipeline, and the
 * waterfall model are re-exported so the Learning Center can name the same eight page loads
 * and quote the same numbers. Another *module* may not import any of this
 * (`eslint.config.mjs`); shared code belongs in `@/core` or `@/components`.
 *
 * Nothing exported here can reach a network. `runPageLoad` reads bundled zone fixtures and
 * the scenario's own declarations and nothing else; there is no `fetch` anywhere in this
 * module, and the one function that takes a host from a human -- `parseAddress` -- hands it
 * to a resolver that has no code path to a real name server. See `input.ts`.
 */

export { InternetSimulatorModule } from './InternetSimulatorModule';
export { INTERNET_SIMULATOR_ID, internetSimulatorMeta } from './meta';

export {
  addressSchema,
  coverageFor,
  handoffFor,
  parseAddress,
  SUGGESTED_URLS,
  type Address,
  type HostCoverage,
  type StageHandoff,
} from './input';

export { stageFacts, type StageFact } from './stageDetail';

export {
  buildWaterfall,
  SEGMENT_NOTES,
  WATERFALL_SEGMENTS,
  type Waterfall,
  type WaterfallRow,
  type WaterfallSegment,
  type WaterfallSegmentName,
} from './waterfall';

export {
  DEFAULT_SIMULATOR_SCENARIO_ID,
  getSimulatorScenario,
  SIMULATOR_SCENARIOS,
  type SimulatorScenarioId,
} from './scenarios';

export {
  eventsForStage,
  runPageLoad,
  stageOf,
  STAGES,
  type PageLoadRun,
  type PageMetrics,
  type RunOptions,
  type StageRun,
  type StageStatus,
} from './sim/pipeline';

export {
  DEFAULT_PROFILE_ID,
  NETWORK_PROFILES,
  networkProfile,
  STAGE_IDS,
  STAGE_MODULE_ROUTES,
  STAGE_TITLES,
  type BrowserFailure,
  type NetworkProfile,
  type NetworkProfileId,
  type SimulatorScenario,
  type StageId,
} from './sim/stage';

export { parseUrl, type ParsedUrl, type UrlPart } from './sim/stages/url-parse';
