/**
 * HTTP Explorer's public surface.
 *
 * The route imports the composition root from here; the scenarios, the message model, and
 * the header catalogue are re-exported so the Learning Center can name the same seven runs
 * and cite the same sentences, and so phases 09 and 10 -- HTTPS, and the API and WebSocket
 * modules, all of which are HTTP with something added -- can build on the request and
 * response primitives rather than restating them. Note that another *module* may not
 * import any of this (`eslint.config.mjs`); shared code belongs in `@/core` or
 * `@/components`.
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

export {
  CRLF,
  header,
  HTTP_METHODS,
  HTTP_VERSIONS,
  serializeMessage,
  showLineEndings,
  wireSegments,
  type CrlfDisplay,
  type HeaderList,
  type HttpMethod,
  type HttpRequest,
  type HttpResponse,
  type HttpVersion,
  type WireSegment,
} from './sim/message';

export {
  isCacheableByDefault,
  isIdempotent,
  isSafe,
  METHOD_SEMANTICS,
  methodSemantics,
  STATUS_CLASSES,
  STATUS_SEMANTICS,
  statusSemantics,
  type MethodSemantics,
  type StatusSemantics,
} from './sim/semantics';

export {
  CACHE_TIER_LABELS,
  NO_CACHE_VS_NO_STORE,
  type CacheOutcome,
  type CacheTier,
} from './sim/caching';

export {
  COOKIE_DEFENCES,
  type Cookie,
  type CookieJar,
  type SameSite,
} from './sim/cookies';

export {
  HEAD_OF_LINE_BLOCKING,
  VERSION_PROFILES,
  type VersionComparison,
  type VersionProfile,
} from './sim/versions';
