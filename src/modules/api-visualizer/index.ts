/**
 * API Visualizer's public surface.
 *
 * The route imports the composition root from here; the scenarios, the mock API's resources,
 * and the field catalogue are re-exported so the Learning Center can name the same seven runs
 * and cite the same sentences. Note that another *module* may not import any of this
 * (`eslint.config.mjs`); shared code belongs in `@/core` or `@/components`.
 *
 * Nothing exported here can reach a network. `runApiScenario` reads bundled fixtures and
 * nothing else, and `runConsoleRequest` has no host parameter to be given one. That is the
 * property the whole module rests on.
 */

export { ApiVisualizerModule } from './ApiVisualizerModule';
export { API_VISUALIZER_ID, apiVisualizerMeta } from './meta';

export {
  buildConsoleRequest,
  consoleDraftSchema,
  consoleStore,
  coverageFor,
  CONSOLE_API_KEY,
  CONSOLE_CONTENT_TYPES,
  DEFAULT_CONSOLE_DRAFT,
  parseConsoleDraft,
  runConsoleRequest,
  type BuiltConsoleRequest,
  type ConsoleContentType,
  type ConsoleCredentialKind,
  type ConsoleDraft,
  type TargetCoverage,
} from './sandbox';

export {
  describeObject,
  explainField,
  originOf,
  FIELD_EXPLANATIONS,
  type FieldExplanation,
  type FieldOrigin,
  type ShapeField,
} from './shape';

export {
  API_HOST,
  API_SCENARIOS,
  AUDIENCE,
  DEFAULT_API_SCENARIO_ID,
  getApiScenario,
  ISSUER,
  RESOURCES,
  SCENARIO_EPOCH_SECONDS,
  seedStore,
  type ApiScenarioId,
} from './scenarios';

export {
  runApiScenario,
  API_NODE,
  AUTH_SERVER_NODE,
  CLIENT_NODE,
  GATEWAY_NODE,
  RECEIVER_NODE,
  USER_NODE,
  type ApiDetail,
  type ApiExchange,
  type ApiPlan,
  type ApiPlanKind,
  type ApiRun,
  type ApiScenario,
  type CollectionItem,
  type Credential,
  type ExchangeAuth,
  type ExchangeLimit,
  type ExchangePage,
} from './sim/exchange';

export {
  API_KEY_PLACEMENTS,
  decodeJwt,
  encodeJwt,
  explainClaim,
  JWT_ALG_NONE_WARNING,
  JWT_CLAIMS,
  JWT_PAYLOAD_NOT_ENCRYPTED,
  JWT_REVOCATION_NOTE,
  OAUTH_ACTORS,
  verifyJwt,
  type AuthorizationCodeFlow,
  type DecodedJwt,
  type JwtVerification,
  type OAuthActor,
  type OAuthStep,
} from './sim/auth';

export { REST_VS_GRAPHQL, type Tradeoff, type TransportComparison } from './sim/graphql';

export {
  PAGINATION_TRADEOFFS,
  type DriftRun,
  type PaginationStrategy,
  type PaginationTradeoff,
} from './sim/pagination';

export {
  bucketLevel,
  createBucket,
  LIMITER_ALGORITHMS,
  RATELIMIT_HEADER_STATUS,
  type ClientRun,
  type TokenBucket,
} from './sim/ratelimit';

export {
  allowedMethods,
  reasonPhrase,
  statusChoice,
  verbSemantics,
  STATUS_CHOICES,
  VERB_SEMANTICS,
  type FieldDefinition,
  type ResourceDefinition,
  type RestDecision,
  type RestOutcome,
  type RestStore,
} from './sim/rest';

export {
  AT_LEAST_ONCE_NOTE,
  RECEIVER_RULES,
  SIGNATURE_HEADER,
  type SignatureVerdict,
  type WebhookDelivery,
  type WebhookEvent,
} from './sim/webhook';

export {
  header,
  HTTP_METHODS,
  type HeaderList,
  type HttpMethod,
  type HttpRequest,
  type HttpResponse,
  type JsonObject,
  type JsonValue,
} from './sim/message';
