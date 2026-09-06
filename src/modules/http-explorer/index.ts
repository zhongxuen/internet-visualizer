/**
 * HTTP Explorer's public surface.
 *
 * The route imports the composition root from here; the scenarios and the header
 * catalogue are re-exported so the Learning Center can name the same seven runs and cite
 * the same sentences. Note that another *module* may not import any of this
 * (`eslint.config.mjs`); shared code belongs in `@/core` or `@/components`.
 *
 * The message model is not here and is not re-exported through here. It is
 * `@/core/protocols/http`, which anything may import: HTTPS, the API Visualizer, the
 * WebSocket Viewer and the Internet Simulator are all HTTP with something added, and they
 * build on that layer directly rather than on this module.
 *
 * Nothing exported here can reach a network. `runHttpScenario` reads the bundled origin
 * fixtures and nothing else, and `builderScenario` has no host parameter to be given one.
 * That is the property the whole module rests on.
 */

export { HttpExplorerModule } from './HttpExplorerModule';
export { HTTP_EXPLORER_ID, httpExplorerMeta } from './meta';

export {
  builderScenario,
  BUILDER_SCENARIO_ID,
  coverageFor,
  DEFAULT_REQUEST_DRAFT,
  parseHeaderBlock,
  parseRequestDraft,
  REPEAT_GAP_MS,
  requestSchema,
  sandboxRouteFor,
  SANDBOX_HOST,
  SANDBOX_ORIGIN,
  SANDBOX_PAGE_ORIGIN,
  SANDBOX_ROUTES,
  type BuiltRequest,
  type RequestCoverage,
  type RequestDraft,
  type SandboxRoute,
} from './builder';

export {
  DIRECTION_LABELS,
  explainHeader,
  formatSpec,
  HEADER_EXPLANATIONS,
  type HeaderDirection,
  type HeaderExplanation,
  type SpecRef,
} from './headers';

export {
  REACHABLE_STATUS_CODES,
  sourceForStatus,
  STATUS_SOURCES,
  type StatusSource,
} from './statuses';

export {
  requestWire,
  responseWire,
  wireMessages,
  wireResponse,
  type WireMessage,
} from './wire';

export {
  DEFAULT_HTTP_SCENARIO_ID,
  getHttpScenario,
  HTTP_SCENARIOS,
  type HttpScenarioId,
} from './scenarios';

export {
  runHttpScenario,
  type HttpExchange,
  type HttpRun,
  type HttpScenario,
  type OriginFixture,
  type OriginRoute,
} from './sim/exchange';
