/**
 * Running an API scenario -- turning a declared plan into something that can be drawn.
 *
 * The seven other files in `sim/` each answer one question and answer it as data. `rest.ts`
 * says which status a verb earns, `auth.ts` who a credential names, `ratelimit.ts` when a
 * bucket is empty, `pagination.ts` where a page starts, `graphql.ts` what a query costs,
 * `webhook.ts` whether a signature holds. None of them knows that anything will ever be
 * *shown*. This file is the one-way bridge from all of them to the `SimResult` the
 * visualization layer consumes -- one-way on purpose, because the rule the project is
 * arranged around is that networking logic never learns about rendering.
 *
 * So the split is:
 *
 * - **the other `sim/*.ts`** decide what an API does.
 * - **this file** decides what a learner sees while it happens: which machine holds the
 *   request at each instant, which chapter of the story they are in, and what the note
 *   pinned to that chapter says.
 * - **the seven scenario files** decide only *what happens* -- a screenful of declared data
 *   each, and no control flow at all.
 *
 * ## Three machines, and the middle one is where most of this module lives
 *
 * Every request/response scenario draws `client -- gateway -- api`, and the gateway is not
 * decoration. Authentication and rate limiting are edge concerns: in a real deployment the
 * `401` and the `429` are produced by a proxy that never troubled the application, which is
 * why a refused request is cheap and why "my handler was never called" is the correct mental
 * model. Modelling the gateway as a real node on a real link makes that *visible* -- a
 * refusal turns round at the middle box and the third machine stays dark -- rather than
 * being a sentence somebody has to believe.
 *
 * Two plans redraw the picture, and both do so because the picture is the lesson:
 *
 * - **OAuth** replaces it with the four parties of RFC 6749: user, client, authorization
 *   server, resource server. The gateway is gone because the flow's shape is the point, and
 *   that shape is entirely about who is allowed to talk to whom.
 * - **Webhooks** reverse it. The API is the client and the subscriber is the server, which
 *   is the whole difference between a webhook and everything else in this module.
 *
 * ## Nothing here can reach a network
 *
 * There is no `fetch`, no `Request`, no host that resolves off this machine. Every address is
 * from `203.0.113.0/24`, one of the ranges RFC 5737 reserves for documentation, and every
 * host name is under `.example`, which RFC 2606 reserves so it can never be registered. A
 * "response" is the return value of a pure function in the file next to this one.
 *
 * ## No clock, no randomness
 *
 * Every timestamp is a virtual millisecond computed from the scenario's declared latencies,
 * and every epoch second is declared by the scenario. `Date.now()` and `Math.random()` appear
 * nowhere in this module. Two runs of one scenario are deep-equal, which `scenarios.test.ts`
 * asserts by running each of them twice.
 */

import { summarizePhases, type SimResult } from '@/core/sim/result';
import type { RfcRef, SimEvent } from '@/core/types/events';
import type { HeaderField, PDU, ProtocolLayer } from '@/core/types/pdu';
import type { SimLink, SimNode, Topology } from '@/core/types/topology';

import {
  applyApiKey,
  decodeJwt,
  interceptAuthorizationCode,
  runAuthorizationCodeFlow,
  verifyApiKey,
  verifyJwt,
  type ApiKeyPlacement,
  type ApiKeyRecord,
  type AuthorizationCodeConfig,
  type AuthorizationCodeFlow,
  type AuthVerdict,
  type DecodedJwt,
  type InterceptionOutcome,
  type JwtVerification,
  type JwtVerifyOptions,
  type OAuthActor,
} from './auth';
import {
  compareTransports,
  executeGraphQL,
  parseGraphQL,
  type GraphQLResult,
  type GraphQLSchema,
  type RestCall,
  type TransportComparison,
} from './graphql';
import {
  approximateWireBytes,
  byteLength,
  header,
  headerValue,
  jsonText,
  request as buildRequest,
  response as buildResponse,
  setHeader,
  withJsonBody,
  type HeaderList,
  type HttpMessage,
  type HttpMethod,
  type HttpRequest,
  type HttpResponse,
  type JsonObject,
  type JsonValue,
} from './message';
import {
  encodeCursor,
  formatLinkHeader,
  paginateWithDrift,
  type CollectionChange,
  type DriftRun,
  type PageLink,
  type PaginationStrategy,
} from './pagination';
import {
  consume,
  runRateLimitedClient,
  type BackoffOptions,
  type ClientRun,
  type RateLimitHeaderStyle,
  type TokenBucket,
} from './ratelimit';
import {
  handleRest,
  jsonRequest,
  problem,
  reasonPhrase,
  type RestDecision,
  type RestOptions,
  type RestStore,
} from './rest';
import {
  createIdempotencyStore,
  deliverWebhook,
  receiveEvent,
  signWebhook,
  verifyWebhookSignature,
  webhookRequest,
  SIGNATURE_HEADER,
  type ReceiveOutcome,
  type ReceiverReply,
  type SignatureVerdict,
  type WebhookDelivery,
  type WebhookEvent,
} from './webhook';

// ---------------------------------------------------------------------------
// The machines
// ---------------------------------------------------------------------------

/** The application making the calls. */
export const CLIENT_NODE = 'client';
/** The edge: where authentication and the rate limiter live. */
export const GATEWAY_NODE = 'gateway';
/** The application server behind it -- the resource server, in OAuth's vocabulary. */
export const API_NODE = 'api';
/** OAuth's authorization server. The only party that ever sees a password. */
export const AUTH_SERVER_NODE = 'authorization-server';
/** OAuth's resource owner: a person at a browser, not a program. */
export const USER_NODE = 'user';
/** A webhook subscriber's endpoint. In that scenario, this is the server. */
export const RECEIVER_NODE = 'receiver';

/**
 * Addresses, all from `203.0.113.0/24`.
 *
 * RFC 5737 reserves three ranges for documentation precisely so an example address cannot be
 * mistaken for -- or routed to -- a real host. Nothing in this module opens a socket, and
 * these are chosen so that would still be true if something one day did.
 */
export const NODE_ADDRESSES: Readonly<Record<string, string>> = {
  [CLIENT_NODE]: '203.0.113.30',
  [USER_NODE]: '203.0.113.31',
  [GATEWAY_NODE]: '203.0.113.40',
  [API_NODE]: '203.0.113.41',
  [AUTH_SERVER_NODE]: '203.0.113.50',
  [RECEIVER_NODE]: '203.0.113.60',
};

/** Virtual milliseconds of quiet after the last byte, so the timeline has an end. */
export const API_TAIL_MS = 60;

/** Round-trip time between the client and the edge, when a scenario does not say. */
export const DEFAULT_RTT_MS = 80;

/** Link capacity, when a scenario does not say. */
export const DEFAULT_BANDWIDTH_KBPS = 20_000;

/** What the gateway spends checking a credential and a bucket. */
export const DEFAULT_GATEWAY_MS = 2;

/** What the application spends producing an answer. */
export const DEFAULT_THINK_MS = 12;

/**
 * The share of the round trip that is client-to-edge rather than edge-to-origin.
 *
 * Nearly all of it. A gateway sits in the same datacentre as the service it fronts, so the
 * expensive half of a request is the part that crosses the Internet -- which is why refusing
 * a request at the edge saves so little *latency* and so much *work*.
 */
export const EDGE_RTT_SHARE = 0.9;

/** The host the mock API answers on. `.example` is reserved by RFC 2606 s 2. */
export const DEFAULT_API_HOST = 'api.example';

/** The link everything is carried over. */
export interface NetworkConditions {
  readonly rttMs: number;
  readonly bandwidthKbps: number;
}

// ---------------------------------------------------------------------------
// What a scenario declares
// ---------------------------------------------------------------------------

/** One request a REST scenario makes. */
export interface RestStep {
  /** Stable id. Becomes the phase id, so a scenario note can pin to it. */
  readonly id: string;
  readonly title: string;
  /** One sentence naming why this request is made. Becomes the chapter's text. */
  readonly intent: string;
  readonly method: HttpMethod;
  readonly target: string;
  readonly body?: JsonValue;
  /**
   * The media type of the body. Defaults to `application/json`.
   *
   * Its own field rather than a header, because there may be exactly one `Content-Type` on a
   * message: a second field line does not override the first, it is *appended* to it, and a
   * server reading `application/merge-patch+json, application/json` correctly answers `415`.
   */
  readonly contentType?: string;
  readonly headers?: HeaderList;
  /** Virtual milliseconds of idling before it is sent. */
  readonly afterMs?: number;
  /**
   * Send the byte-identical request this many times.
   *
   * The whole demonstration of idempotency: two identical `POST`s make two articles and two
   * identical `PUT`s make one, and no amount of prose about "the same effect on the server as
   * a single request" lands the way the store's contents do.
   */
  readonly times?: number;
}

/** Resources, and a list of requests against them. */
export interface RestPlan {
  readonly kind: 'rest';
  readonly store: RestStore;
  readonly options?: RestOptions;
  readonly steps: readonly RestStep[];
}

/** What a request carries to say who is making it. */
export type Credential =
  /** Nothing at all. The `401` this earns is the baseline the others are measured against. */
  | { readonly kind: 'none' }
  | {
      readonly kind: 'api-key';
      readonly value: string;
      readonly placement: ApiKeyPlacement;
      readonly name?: string;
    }
  /** A compact JWS. Supplied as a literal so the run replays exactly; see `encodeJwt`. */
  | { readonly kind: 'bearer'; readonly token: string; readonly label?: string };

/** One request an auth scenario makes. */
export interface AuthStep {
  readonly id: string;
  readonly title: string;
  readonly intent: string;
  readonly method: HttpMethod;
  readonly target: string;
  readonly body?: JsonValue;
  readonly credential: Credential;
  /** The scope this target demands, if any. Missing it is the `403`. */
  readonly requiredScope?: string;
  readonly afterMs?: number;
}

/** Credentials, and what the gateway does with them. */
export interface AuthPlan {
  readonly kind: 'auth';
  readonly store: RestStore;
  readonly keys: readonly ApiKeyRecord[];
  /**
   * What the verifier accepts, decided **before** any token is looked at.
   *
   * That ordering is the whole of `JWT_ALG_NONE_WARNING`: a verifier that reads `alg` out of
   * the token and obeys it will accept an unsigned token the attacker wrote.
   */
  readonly verify: JwtVerifyOptions;
  readonly steps: readonly AuthStep[];
}

/** The authorization-code ladder, and the theft it is built to survive. */
export interface OAuthPlan {
  readonly kind: 'oauth';
  readonly config: AuthorizationCodeConfig;
  /** Also run the interception, so PKCE is seen refusing a stolen code rather than claimed. */
  readonly intercept?: boolean;
  /** A verifier the attacker guesses, to show why the 43-character minimum exists. */
  readonly guessedVerifier?: string;
}

/** A bucket, and a client pressing against it. */
export interface RateLimitPlan {
  readonly kind: 'rate-limit';
  readonly bucket: TokenBucket;
  readonly method?: HttpMethod;
  readonly target: string;
  /** How many requests the client wants to make. */
  readonly requests: number;
  /** Gap between successive *successful* requests. */
  readonly spacingMs?: number;
  readonly backoff: BackoffOptions;
  readonly maxAttempts?: number;
  readonly headerStyle?: RateLimitHeaderStyle;
  /**
   * Also run the same client with `obeyRetryAfter: false`, for the contrast.
   *
   * The server's `Retry-After` is a fact and the client's exponential curve is a guess, and
   * preferring the guess is how a well-meaning retry library gets refused three times running.
   */
  readonly compareIgnoringRetryAfter?: boolean;
}

/** One row of the collection a pagination scenario pages through. */
export interface CollectionItem {
  readonly id: string;
  readonly title: string;
  /** What the collection is ordered by. A newest-first feed orders on this, descending. */
  readonly postedAt: number;
}

/** The same collection paged twice, with the same edit landing mid-run. */
export interface PaginationPlan {
  readonly kind: 'pagination';
  /** The collection path, e.g. `/articles`. Links are built relative to it. */
  readonly basePath: string;
  readonly items: readonly CollectionItem[];
  readonly pageSize: number;
  /** What happens to the collection between pages. */
  readonly changes: readonly CollectionChange<CollectionItem>[];
  /** Newest-first, which is the ordering under which a new row lands on page one. */
  readonly descending?: boolean;
  /** Virtual milliseconds a client spends rendering a page before asking for the next. */
  readonly betweenPagesMs?: number;
}

/** One REST call the same screen needs, with the document it comes back with. */
export interface ScreenRestCall {
  readonly id: string;
  readonly title: string;
  readonly intent: string;
  readonly method?: HttpMethod;
  readonly target: string;
  /** The response document in full -- including the fields the screen will not read. */
  readonly body: JsonValue;
  /** Bytes of that document the screen actually uses. The over-fetching measurement. */
  readonly usedBytes: number;
  /** True when this call cannot start until an earlier one has returned. */
  readonly dependsOnPrevious?: boolean;
}

/** One screen's data, fetched both ways. */
export interface GraphQLPlan {
  readonly kind: 'graphql';
  readonly schema: GraphQLSchema;
  readonly query: string;
  readonly endpoint?: string;
  readonly restCalls: readonly ScreenRestCall[];
  /** Bytes of the GraphQL response the screen used. Defaults to all of it. */
  readonly graphqlUsedBytes?: number;
  /** Per-request header overhead, applied to both sides equally. */
  readonly headerBytes?: number;
}

/** An event pushed the other way, and a receiver that may or may not be ready. */
export interface WebhookPlan {
  readonly kind: 'webhook';
  readonly event: WebhookEvent;
  readonly endpoint: string;
  readonly secret: string;
  /** What the receiver does on each attempt, in order. */
  readonly replies: readonly ReceiverReply[];
  readonly backoff: BackoffOptions;
  readonly maxAttempts?: number;
  /** Virtual seconds since the epoch at virtual millisecond zero. */
  readonly startSeconds: number;
  /** Every secret the receiver currently accepts. More than one during a rotation. */
  readonly receiverSecrets: readonly string[];
  /** How far from the receiver's clock a timestamp may be. Five minutes is conventional. */
  readonly toleranceSeconds?: number;
  /** A forged delivery, so the signature check is seen refusing one. */
  readonly forgery?: {
    readonly body: string;
    readonly secret: string;
    readonly title: string;
    readonly intent: string;
  };
}

/** Everything a scenario can ask this module to do. */
export type ApiPlan =
  | RestPlan
  | AuthPlan
  | OAuthPlan
  | RateLimitPlan
  | PaginationPlan
  | GraphQLPlan
  | WebhookPlan;

/** The `kind` discriminator of any plan, which is also what the UI switches on. */
export type ApiPlanKind = ApiPlan['kind'];

/**
 * A teaching note a scenario pins to one of its own phases.
 *
 * Pinned by phase id rather than by timestamp, because an author knows which chapter a point
 * belongs to and does not -- and should not have to -- know what millisecond that chapter
 * begins at. An id the run does not have is a bug in the scenario and throws, so the
 * catalogue test surfaces a typo on the first `npm test` after it is made.
 */
export interface ScenarioNote {
  readonly phase: string;
  /** What it explains: a node id. Defaults to whichever machine originates the traffic. */
  readonly target?: string;
  readonly text: string;
  readonly reference?: RfcRef;
}

/** One run of the API Visualizer. */
export interface ApiScenario {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  /** What a learner should be able to say afterwards. */
  readonly teaches: readonly string[];
  readonly plan: ApiPlan;
  readonly conditions?: Partial<NetworkConditions>;
  /** What the gateway spends checking a credential and a bucket. */
  readonly gatewayMs?: number;
  /** What the application spends producing an answer. */
  readonly thinkMs?: number;
  /** The API's host name. Under `.example`, which can never be registered. */
  readonly apiHost?: string;
  readonly notes?: readonly ScenarioNote[];
}

// ---------------------------------------------------------------------------
// What comes out
// ---------------------------------------------------------------------------

/** A credential check, and everything a panel needs to explain it. */
export interface ExchangeAuth {
  /** How the request said who it was. */
  readonly credential: Credential;
  readonly verdict: AuthVerdict;
  /** Present for a bearer token, whether or not it verified. Decoding needs no secret. */
  readonly decoded?: DecodedJwt;
  /** Present when a bearer token decoded; absent when it was not even a JWT. */
  readonly verification?: JwtVerification;
  /** Why decoding failed, when it did. */
  readonly decodeError?: string;
}

/** The limiter's state around one attempt. */
export interface ExchangeLimit {
  /** The bucket **after** this attempt, so a meter can refill forward from it. */
  readonly bucket: TokenBucket;
  readonly allowed: boolean;
  /** Whole tokens the server said were left. */
  readonly remaining: number;
  /** Seconds the server told the client to wait. Zero when it was not refused. */
  readonly retryAfterSeconds: number;
  /** How long the client actually waited afterwards. */
  readonly waitMs: number;
  readonly waitSource: 'retry-after' | 'backoff' | 'none';
  /** Which of the client's requests this attempt belongs to, counting from one. */
  readonly requestIndex: number;
}

/** One page as the client received it. */
export interface ExchangePage {
  readonly strategy: PaginationStrategy;
  /** Counting from one. */
  readonly index: number;
  readonly ids: readonly string[];
  /** The size of the collection when this page was served. */
  readonly collectionSize: number;
  /** Ids on this page the client had already been given. */
  readonly repeated: readonly string[];
  /** What happened to the collection immediately after it was served. */
  readonly changedAfter?: string;
}

/** What one call cost, for the transport comparison. */
export interface ExchangeCost {
  readonly requestBytes: number;
  readonly responseBytes: number;
  /** Bytes of the response the screen actually read. */
  readonly usedBytes: number;
}

/** One request, its answer, and everything the panels need to explain the pair. */
export interface ApiExchange {
  readonly id: string;
  /** The phase it belongs to. */
  readonly stepId: string;
  /** `0` for a step's own request; `1` and up for retries and repeats. */
  readonly hop: number;
  readonly title: string;
  /** Node ids: where the request started, and the machine that answered it. */
  readonly from: string;
  readonly handledBy: string;
  readonly request: HttpRequest;
  readonly response: HttpResponse;
  readonly status: number;
  readonly sentAt: number;
  readonly receivedAt: number;
  /** One sentence: why this status and not the neighbouring one. */
  readonly why: string;
  readonly notes: readonly string[];
  /** Present when the mock API routed the request. */
  readonly decision?: RestDecision;
  /** Present when a credential was checked. */
  readonly auth?: ExchangeAuth;
  /** Present when the limiter saw it. */
  readonly limit?: ExchangeLimit;
  /** Present when it returned a page. */
  readonly page?: ExchangePage;
  /** Present when it was a webhook delivery. */
  readonly signature?: SignatureVerdict;
  /** Present in the transport comparison. */
  readonly cost?: ExchangeCost;
}

/** The whole-run artefacts a plan produces beyond its exchanges. */
export type ApiDetail =
  | { readonly kind: 'rest'; readonly store: RestStore }
  | { readonly kind: 'auth'; readonly store: RestStore }
  | {
      readonly kind: 'oauth';
      readonly flow: AuthorizationCodeFlow;
      readonly interception?: InterceptionOutcome;
      readonly guessedInterception?: InterceptionOutcome;
    }
  | {
      readonly kind: 'rate-limit';
      readonly run: ClientRun;
      readonly initialBucket: TokenBucket;
      /** The same client, ignoring the server's instruction. Present when asked for. */
      readonly ignoringRetryAfter?: ClientRun;
    }
  | {
      readonly kind: 'pagination';
      readonly offset: DriftRun<CollectionItem>;
      readonly cursor: DriftRun<CollectionItem>;
      readonly items: readonly CollectionItem[];
      readonly pageSize: number;
    }
  | {
      readonly kind: 'graphql';
      readonly comparison: TransportComparison;
      /** The query executed as a naive server would: one data-source call per field. */
      readonly unbatched: GraphQLResult;
      /** The same query with per-field batching, as DataLoader does it. */
      readonly batched: GraphQLResult;
      readonly query: string;
    }
  | {
      readonly kind: 'webhook';
      readonly delivery: WebhookDelivery;
      /** The receiver handling the same event twice. */
      readonly firstReceipt: ReceiveOutcome;
      readonly secondReceipt: ReceiveOutcome;
      readonly forgery?: SignatureVerdict;
    };

/** A finished run. */
export interface ApiRun {
  readonly scenario: ApiScenario;
  readonly topology: Topology;
  readonly result: SimResult;
  /** Every request/response pair, in order. */
  readonly exchanges: readonly ApiExchange[];
  readonly detail: ApiDetail;
}

// ---------------------------------------------------------------------------
// The topology
// ---------------------------------------------------------------------------

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** One-way latencies, derived from the declared round trip. */
interface Distances {
  /** Client to anything across the Internet. */
  readonly edgeMs: number;
  /** Gateway to the service behind it, inside one datacentre. */
  readonly coreMs: number;
}

function distances(conditions: NetworkConditions): Distances {
  return {
    edgeMs: round2((conditions.rttMs * EDGE_RTT_SHARE) / 2),
    coreMs: round2((conditions.rttMs * (1 - EDGE_RTT_SHARE)) / 2),
  };
}

function node(
  id: string,
  kind: SimNode['kind'],
  label: string,
  detail: Record<string, string>,
): SimNode {
  const ipv4 = NODE_ADDRESSES[id];
  return { id, kind, label, ...(ipv4 ? { ipv4 } : {}), detail };
}

function link(
  from: string,
  to: string,
  latencyMs: number,
  bandwidthKbps: number,
): SimLink {
  return {
    id: `${from}-${to}`,
    from,
    to,
    latencyMs,
    bandwidthMbps: bandwidthKbps / 1000,
    medium: 'fiber',
  };
}

/**
 * The machines a plan needs, and the wires between them.
 *
 * Three shapes, and which one a plan gets is itself part of what it teaches. The
 * request/response plans share `client -- gateway -- api`; OAuth swaps in the four parties of
 * RFC 6749 because the flow is about who may speak to whom; the webhook plan has two machines
 * and the arrow points the other way.
 */
function buildTopology(
  plan: ApiPlan,
  gap: Distances,
  conditions: NetworkConditions,
  apiHost: string,
  extra: { readonly issuer?: string; readonly endpoint?: string },
): Topology {
  const kbps = conditions.bandwidthKbps;

  const client = node(CLIENT_NODE, 'client', 'Client app', {
    role: 'the program making the calls',
    'holds the credential':
      'yes -- and in a browser or a mobile app it cannot keep a secret',
  });

  const gateway = node(GATEWAY_NODE, 'proxy', 'API gateway', {
    role: 'authentication and rate limiting, before the application is troubled',
    'produces on its own': '401, 403, 429',
    why: 'a refusal here never reaches your handler, which is why it is cheap',
  });

  const api = node(API_NODE, 'server', apiHost, {
    role: 'the application: routes the resource, decides the status',
    'sees a request': 'only after the gateway has let it through',
  });

  if (plan.kind === 'oauth') {
    return {
      nodes: [
        node(USER_NODE, 'client', 'User (browser)', {
          role: 'the resource owner -- a person, not a program',
          'types the password into': 'the authorization server, and nowhere else',
        }),
        client,
        node(AUTH_SERVER_NODE, 'server', extra.issuer ?? 'auth.example', {
          role: 'authenticates the user, asks consent, mints tokens',
          'sees the password': 'yes -- it is the only party that ever does',
        }),
        node(API_NODE, 'server', apiHost, {
          role: 'the resource server: holds the data',
          'sees the password':
            'never. It sees a token and verifies it without a round trip',
        }),
      ],
      links: [
        link(USER_NODE, CLIENT_NODE, 1, kbps),
        link(USER_NODE, AUTH_SERVER_NODE, gap.edgeMs, kbps),
        link(CLIENT_NODE, AUTH_SERVER_NODE, gap.edgeMs, kbps),
        link(CLIENT_NODE, API_NODE, gap.edgeMs, kbps),
      ],
    };
  }

  if (plan.kind === 'webhook') {
    return {
      nodes: [
        node(API_NODE, 'server', apiHost, {
          role: 'here, the *client*: it makes the request',
          'holds the signing secret': 'yes -- the same one the receiver holds',
        }),
        node(RECEIVER_NODE, 'server', extra.endpoint ?? 'your endpoint', {
          role: 'here, the *server*: a public URL the sender can reach',
          'must be': 'reachable, fast, and idempotent -- in that order of surprise',
        }),
      ],
      links: [link(API_NODE, RECEIVER_NODE, gap.edgeMs, kbps)],
    };
  }

  return {
    nodes: [client, gateway, api],
    links: [
      link(CLIENT_NODE, GATEWAY_NODE, gap.edgeMs, kbps),
      link(GATEWAY_NODE, API_NODE, gap.coreMs, kbps),
    ],
  };
}

// ---------------------------------------------------------------------------
// PDUs
// ---------------------------------------------------------------------------

/** An ephemeral source port, so the transport layer of the inspector says something true. */
const CLIENT_PORT = 49_152;

/** Every API in this module is served over TLS, as every API on the Internet should be. */
const SERVER_PORT = 443;

function isRequestMessage(message: HttpMessage): message is HttpRequest {
  return 'method' in message;
}

/** The first line, which is what a packet analyser shows as the summary. */
function startLine(message: HttpMessage): string {
  return isRequestMessage(message)
    ? `${message.method} ${message.target} HTTP/1.1`
    : `HTTP/1.1 ${message.status} ${message.reason}`;
}

/** Header fields as the inspector lists them: in wire order, values verbatim. */
function fieldsOf(headers: HeaderList): HeaderField[] {
  return headers.map((field) => ({ name: field.name, value: field.value }));
}

/**
 * One HTTP message, as an encapsulated PDU.
 *
 * The TLS layer is present and deliberately thin. Every API worth calling is served over
 * HTTPS, so a stack that left it out would be drawing something that does not exist -- but
 * what the record layer *does* is phase 09's subject, not this module's, and the note says
 * so rather than restating it badly.
 */
function apiPdu(
  id: string,
  message: HttpMessage,
  context: { readonly from: string; readonly to: string },
): PDU {
  const outbound = isRequestMessage(message);
  const bytes = approximateWireBytes(message);

  const network: ProtocolLayer = {
    layer: 'network',
    protocol: 'IPv4',
    fields: [
      { name: 'Source', value: NODE_ADDRESSES[context.from] ?? '203.0.113.0', bits: 32 },
      {
        name: 'Destination',
        value: NODE_ADDRESSES[context.to] ?? '203.0.113.0',
        bits: 32,
      },
    ],
  };

  const transport: ProtocolLayer = {
    layer: 'transport',
    protocol: 'TCP',
    fields: [
      {
        name: 'Source Port',
        value: `${outbound ? CLIENT_PORT : SERVER_PORT}`,
        bits: 16,
      },
      {
        name: 'Destination Port',
        value: `${outbound ? SERVER_PORT : CLIENT_PORT}`,
        bits: 16,
      },
    ],
  };

  const session: ProtocolLayer = {
    layer: 'session',
    protocol: 'TLS 1.3',
    fields: [
      {
        name: 'Application Data',
        value: `${bytes} bytes of plaintext`,
        note: 'Everything above this line is encrypted on the wire. What is listed below is what the two endpoints hold, not what an observer sees -- the HTTPS Explorer is the module that takes that apart.',
      },
    ],
  };

  const application: ProtocolLayer = {
    layer: 'application',
    protocol: 'HTTP/1.1',
    fields: fieldsOf(message.headers),
    payloadPreview: startLine(message),
  };

  return {
    id,
    layers: [network, transport, session, application],
    sizeBytes: bytes,
    summary: startLine(message),
  };
}

// ---------------------------------------------------------------------------
// The build
// ---------------------------------------------------------------------------

/** A phase held until the run knows where every boundary falls. */
interface PhaseDraft {
  readonly at: number;
  readonly id: string;
  readonly title: string;
  readonly description: string;
}

interface Build {
  readonly events: SimEvent[];
  readonly pdus: Record<string, PDU>;
  readonly topology: Topology;
  readonly conditions: NetworkConditions;
  readonly phases: PhaseDraft[];
  readonly exchanges: ApiExchange[];
  readonly apiHost: string;
  readonly gatewayMs: number;
  readonly thinkMs: number;
}

function linkBetween(build: Build, a: string, b: string): SimLink {
  const found = build.topology.links.find(
    (candidate) =>
      (candidate.from === a && candidate.to === b) ||
      (candidate.from === b && candidate.to === a),
  );
  if (!found) {
    throw new Error(`no link between "${a}" and "${b}" in this scenario's topology`);
  }
  return found;
}

/** Virtual milliseconds to clock a message onto the wire at the scenario's bandwidth. */
function serializationMs(build: Build, message: HttpMessage): number {
  // kbps is bits per millisecond, so this is bytes -> bits -> milliseconds.
  return round2((approximateWireBytes(message) * 8) / build.conditions.bandwidthKbps);
}

function startPhase(build: Build, draft: PhaseDraft): void {
  build.phases.push(draft);
}

/** The fields a well-behaved client puts on every request. */
function clientHeaders(build: Build, extra: HeaderList = []): HeaderList {
  return [
    header('Host', build.apiHost),
    header('Accept', 'application/json'),
    header('User-Agent', 'api-visualizer/1.0 (simulated)'),
    ...extra,
  ];
}

/** Introduce a message at the machine that produced it. */
function pushMessage(
  build: Build,
  pduId: string,
  message: HttpMessage,
  atNode: string,
  nextNode: string,
  at: number,
): void {
  const pdu = apiPdu(pduId, message, { from: atNode, to: nextNode });
  build.pdus[pduId] = pdu;
  build.events.push({ kind: 'pdu-created', at, pdu, atNode });
  build.events.push({ kind: 'node-state', at, nodeId: atNode, state: 'active' });
}

/**
 * Fly one message along a path of machines, and report when it lands.
 *
 * The same PDU id crosses every hop, because it is the same message: a gateway forwarding a
 * request has not made a new one. Each intermediary pauses for `relayMs` on the way through,
 * which is the whole visible cost of putting a box in the middle.
 */
function pushFlight(
  build: Build,
  options: {
    readonly pduId: string;
    readonly message: HttpMessage;
    readonly path: readonly string[];
    readonly at: number;
    readonly relayMs: number;
    readonly arriveNote?: string;
  },
): number {
  const serialization = serializationMs(build, options.message);
  let at = options.at;

  for (let index = 0; index < options.path.length - 1; index += 1) {
    const from = options.path[index] as string;
    const to = options.path[index + 1] as string;
    const wire = linkBetween(build, from, to);
    const durationMs = round2(wire.latencyMs + serialization);

    build.events.push({
      kind: 'transmit',
      at,
      pduId: options.pduId,
      from,
      to,
      durationMs,
      linkId: wire.id,
    });
    at = round2(at + durationMs);

    const isDestination = index + 2 === options.path.length;
    build.events.push({
      kind: 'node-state',
      at,
      nodeId: to,
      state: 'processing',
      ...(isDestination && options.arriveNote ? { note: options.arriveNote } : {}),
      ...(isDestination ? {} : { note: 'forwarding' }),
    });
    if (!isDestination) at = round2(at + options.relayMs);
  }

  return at;
}

/** Everything one request/response pair needs the runner to say. */
interface DeliveryPlan {
  readonly id: string;
  readonly stepId: string;
  readonly hop: number;
  readonly title: string;
  /** Origin first, responder last. */
  readonly path: readonly string[];
  readonly request: HttpRequest;
  readonly response: HttpResponse;
  /** Virtual milliseconds the responder spends before answering. */
  readonly processingMs?: number;
  /** Virtual milliseconds each machine in the middle spends on the way through. */
  readonly relayMs?: number;
  readonly why: string;
  readonly notes?: readonly string[];
  /** What the responder is doing, shown on its node while it does it. */
  readonly stateNote?: string;
  readonly decision?: RestDecision;
  readonly auth?: ExchangeAuth;
  readonly limit?: ExchangeLimit;
  readonly page?: ExchangePage;
  readonly signature?: SignatureVerdict;
  readonly cost?: ExchangeCost;
}

/**
 * Send a request along a path, have the far end answer, and bring the answer back.
 *
 * The responder is the last machine on the path, which is how a refusal at the gateway and a
 * `200` from the application are the same code with a different path: `[client, gateway]`
 * against `[client, gateway, api]`. The third machine stays idle in the first case, and that
 * silence is the point being made.
 */
function emitDelivery(build: Build, plan: DeliveryPlan, at: number): ApiExchange {
  const path = plan.path;
  const origin = path[0] as string;
  const responder = path[path.length - 1] as string;
  const relayMs = plan.relayMs ?? 0;
  const requestPduId = `${plan.id}-request`;
  const responsePduId = `${plan.id}-response`;

  pushMessage(build, requestPduId, plan.request, origin, path[1] as string, at);
  let now = pushFlight(build, {
    pduId: requestPduId,
    message: plan.request,
    path,
    at,
    relayMs,
    ...(plan.stateNote ? { arriveNote: plan.stateNote } : {}),
  });

  now = round2(now + (plan.processingMs ?? 0));

  const back = [...path].reverse();
  pushMessage(build, responsePduId, plan.response, responder, back[1] as string, now);
  build.events.push({
    kind: 'node-state',
    at: now,
    nodeId: responder,
    state: plan.response.status >= 400 ? 'error' : 'active',
    note: `${plan.response.status} ${plan.response.reason}`.trim(),
  });

  const receivedAt = pushFlight(build, {
    pduId: responsePduId,
    message: plan.response,
    path: back,
    at: now,
    relayMs,
    arriveNote: `${plan.response.status} ${plan.response.reason}`.trim(),
  });

  for (const machine of path) {
    build.events.push({
      kind: 'node-state',
      at: receivedAt,
      nodeId: machine,
      state: 'idle',
    });
  }

  build.events.push({
    kind: 'log',
    at: receivedAt,
    level:
      plan.response.status >= 500
        ? 'error'
        : plan.response.status >= 400
          ? 'warn'
          : 'info',
    text: `${plan.request.method} ${plan.request.target} -> ${plan.response.status} ${plan.response.reason}`.trim(),
  });

  return {
    id: plan.id,
    stepId: plan.stepId,
    hop: plan.hop,
    title: plan.title,
    from: origin,
    handledBy: responder,
    request: plan.request,
    response: plan.response,
    status: plan.response.status,
    sentAt: at,
    receivedAt,
    why: plan.why,
    notes: plan.notes ?? [],
    ...(plan.decision ? { decision: plan.decision } : {}),
    ...(plan.auth ? { auth: plan.auth } : {}),
    ...(plan.limit ? { limit: plan.limit } : {}),
    ...(plan.page ? { page: plan.page } : {}),
    ...(plan.signature ? { signature: plan.signature } : {}),
    ...(plan.cost ? { cost: plan.cost } : {}),
  };
}

/** What a runner hands back. */
interface PlanRun {
  readonly detail: ApiDetail;
  readonly endsAt: number;
}

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'] as const;

function ordinal(n: number): string {
  return ORDINALS[n - 1] ?? `${n}th`;
}

// ---------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------

function runRestPlan(build: Build, plan: RestPlan): PlanRun {
  let store = plan.store;
  let at = 0;

  for (const step of plan.steps) {
    at = round2(at + (step.afterMs ?? 0));
    const times = Math.max(1, step.times ?? 1);
    startPhase(build, { at, id: step.id, title: step.title, description: step.intent });

    for (let attempt = 0; attempt < times; attempt += 1) {
      const headers = clientHeaders(build, step.headers ?? []);
      const outgoing =
        step.body === undefined
          ? buildRequest({ method: step.method, target: step.target, headers })
          : jsonRequest({
              method: step.method,
              target: step.target,
              body: step.body,
              headers,
              ...(step.contentType === undefined
                ? {}
                : { contentType: step.contentType }),
            });

      const outcome = handleRest(store, outgoing, plan.options ?? {});
      store = outcome.store;

      const exchange = emitDelivery(
        build,
        {
          id: `${step.id}-${attempt}`,
          stepId: step.id,
          hop: attempt,
          title: times > 1 ? `${step.title} -- ${ordinal(attempt + 1)} time` : step.title,
          path: [CLIENT_NODE, GATEWAY_NODE, API_NODE],
          request: outcome.request,
          response: outcome.response,
          processingMs: build.thinkMs,
          relayMs: build.gatewayMs,
          why: outcome.decision.why,
          notes: outcome.decision.notes,
          decision: outcome.decision,
          stateNote: `${outcome.decision.method} on a ${outcome.decision.target.kind}`,
        },
        at,
      );

      build.exchanges.push(exchange);
      at = exchange.receivedAt;
    }
  }

  return { detail: { kind: 'rest', store }, endsAt: at };
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

/** The `WWW-Authenticate` challenge a bearer-token API owes a `401` (RFC 6750 s 3). */
function bearerChallenge(response: HttpResponse, error?: string, description?: string) {
  const parameters = [
    'realm="api"',
    ...(error ? [`error="${error}"`] : []),
    ...(description ? [`error_description="${description}"`] : []),
  ];
  return {
    ...response,
    headers: setHeader(
      response.headers,
      'WWW-Authenticate',
      `Bearer ${parameters.join(', ')}`,
    ),
  };
}

/** The `scope` claim as a list. Space-delimited, per RFC 8693 s 4.2 and OAuth convention. */
function scopesOf(claims: Record<string, unknown>): readonly string[] {
  const scope = claims['scope'];
  return typeof scope === 'string' ? scope.split(' ').filter((part) => part !== '') : [];
}

/**
 * Put a credential on a request and decide what the gateway makes of it.
 *
 * The two failure statuses are the useful part and are constantly got wrong. `401` means
 * *I do not know who you are* -- present a credential and you may succeed. `403` means
 * *I know exactly who you are and the answer is still no*. A gateway that answers `403` to a
 * missing token sends clients into a pointless retry loop; one that answers `401` to a
 * permission failure sends them to re-authenticate for nothing.
 */
function applyCredential(
  base: HttpRequest,
  step: AuthStep,
  plan: AuthPlan,
): { readonly request: HttpRequest; readonly auth: ExchangeAuth } {
  const credential = step.credential;

  if (credential.kind === 'none') {
    return {
      request: base,
      auth: {
        credential,
        verdict: {
          authenticated: false,
          response: bearerChallenge(
            problem(401, 'This endpoint requires a credential and none was presented.'),
          ),
          why: '401: no credential arrived, so the gateway cannot know who is calling. Retrying with one may work. The WWW-Authenticate field is what makes the 401 actionable -- it names the scheme to use.',
        },
      },
    };
  }

  if (credential.kind === 'api-key') {
    const request = applyApiKey(
      base,
      credential.value,
      credential.placement,
      credential.name,
    );
    const verdict = verifyApiKey(request, {
      keys: plan.keys,
      placement: credential.placement,
      ...(credential.name ? { name: credential.name } : {}),
      ...(step.requiredScope ? { requiredScope: step.requiredScope } : {}),
    });
    return { request, auth: { credential, verdict } };
  }

  const request = {
    ...base,
    headers: setHeader(base.headers, 'Authorization', `Bearer ${credential.token}`),
  };

  const decoded = decodeJwt(credential.token);
  if (!decoded.ok) {
    return {
      request,
      auth: {
        credential,
        decodeError: decoded.error,
        verdict: {
          authenticated: false,
          response: bearerChallenge(
            problem(401, `That token could not be read: ${decoded.error}.`),
            'invalid_token',
            'malformed token',
          ),
          why: '401: the credential is unreadable, so it names nobody. Note that this failed at decoding, before any secret was consulted -- a malformed token never reaches the signature check.',
        },
      },
    };
  }

  const verification = verifyJwt(decoded.value, plan.verify);
  if (!verification.valid) {
    const broken = verification.checks.find((check) => !check.passed);
    return {
      request,
      auth: {
        credential,
        decoded: decoded.value,
        verification,
        verdict: {
          authenticated: false,
          response: bearerChallenge(
            problem(
              401,
              `Token rejected: the ${broken?.name ?? 'signature'} check failed.`,
            ),
            'invalid_token',
            broken?.what ?? 'the token did not verify',
          ),
          why: `401: the token failed the "${broken?.name ?? 'signature'}" check -- ${broken?.what ?? 'it did not verify'} Every check runs and every one is reported, because "invalid token" tells a client nothing it can act on.`,
        },
      },
    };
  }

  const subject =
    typeof decoded.value.claims['sub'] === 'string'
      ? decoded.value.claims['sub']
      : undefined;
  const scopes = scopesOf(decoded.value.claims);

  if (step.requiredScope && !scopes.includes(step.requiredScope)) {
    return {
      request,
      auth: {
        credential,
        decoded: decoded.value,
        verification,
        verdict: {
          authenticated: false,
          ...(subject ? { subject } : {}),
          response: bearerChallenge(
            problem(403, `This token is missing the "${step.requiredScope}" scope.`),
            'insufficient_scope',
            step.requiredScope,
          ),
          why: `403 and not 401: the token is valid and names ${subject ?? 'a known subject'}. The caller is known and is not permitted, so presenting the same token again will never succeed.`,
        },
      },
    };
  }

  return {
    request,
    auth: {
      credential,
      decoded: decoded.value,
      verification,
      verdict: {
        authenticated: true,
        ...(subject ? { subject } : {}),
        why: `The signature verified against a secret decided in advance, and every temporal and identity claim held. The gateway learned who this is without asking any other service -- which is what makes a JWT fast, and what makes revoking one hard.`,
      },
    },
  };
}

function runAuthPlan(build: Build, plan: AuthPlan): PlanRun {
  let store = plan.store;
  let at = 0;

  for (const step of plan.steps) {
    at = round2(at + (step.afterMs ?? 0));
    startPhase(build, { at, id: step.id, title: step.title, description: step.intent });

    const headers = clientHeaders(build);
    const base =
      step.body === undefined
        ? buildRequest({ method: step.method, target: step.target, headers })
        : jsonRequest({
            method: step.method,
            target: step.target,
            body: step.body,
            headers,
          });

    const { request, auth } = applyCredential(base, step, plan);

    if (!auth.verdict.authenticated && auth.verdict.response) {
      // Refused at the edge. The application node stays dark for the whole exchange, which
      // is the honest picture: this request never became anybody's problem downstream.
      const exchange = emitDelivery(
        build,
        {
          id: step.id,
          stepId: step.id,
          hop: 0,
          title: step.title,
          path: [CLIENT_NODE, GATEWAY_NODE],
          request,
          response: auth.verdict.response,
          processingMs: build.gatewayMs,
          why: auth.verdict.why,
          notes: [
            'The application server was never called. Authentication is an edge concern, and this is what that means in practice.',
          ],
          stateNote: 'checking the credential',
          auth,
        },
        at,
      );
      build.exchanges.push(exchange);
      at = exchange.receivedAt;
      continue;
    }

    const outcome = handleRest(store, request);
    store = outcome.store;

    const exchange = emitDelivery(
      build,
      {
        id: step.id,
        stepId: step.id,
        hop: 0,
        title: step.title,
        path: [CLIENT_NODE, GATEWAY_NODE, API_NODE],
        request: outcome.request,
        response: outcome.response,
        processingMs: build.thinkMs,
        relayMs: build.gatewayMs,
        why: outcome.decision.why,
        notes: [auth.verdict.why, ...outcome.decision.notes],
        decision: outcome.decision,
        stateNote: `${outcome.decision.method} on a ${outcome.decision.target.kind}`,
        auth,
      },
      at,
    );
    build.exchanges.push(exchange);
    at = exchange.receivedAt;
  }

  return { detail: { kind: 'auth', store }, endsAt: at };
}

// ---------------------------------------------------------------------------
// OAuth 2.0 authorization code + PKCE
// ---------------------------------------------------------------------------

/** Which machine each party of RFC 6749 is drawn as. */
const ACTOR_NODES: Readonly<Record<OAuthActor, string>> = {
  user: USER_NODE,
  client: CLIENT_NODE,
  'authorization-server': AUTH_SERVER_NODE,
  'resource-server': API_NODE,
};

/** What a rung with no message on it costs: a person reading a consent screen, or a hash. */
const OAUTH_LOCAL_STEP_MS = 40;

/**
 * Walk the ladder, emitting each rung.
 *
 * Two rungs are pure computation -- deriving the challenge, recomputing it at the token
 * endpoint -- and one is a person typing a password. None of them is a message, and drawing
 * them as one would misrepresent the flow's central property: the client's secret never
 * travels, and the user's password travels exactly once, to exactly one party.
 *
 * Request and response are paired by the obvious rule -- a rung carrying a request pairs with
 * the next rung carrying a response -- rather than by index, so the pairing survives a change
 * to the ladder.
 */
function runOAuthPlan(build: Build, plan: OAuthPlan): PlanRun {
  const flow = runAuthorizationCodeFlow(plan.config);
  let at = 0;
  let pending: {
    readonly step: (typeof flow.steps)[number];
    readonly sentAt: number;
  } | null = null;

  for (const step of flow.steps) {
    const phaseId = `oauth-${step.index}`;
    startPhase(build, {
      at,
      id: phaseId,
      title: `${step.index + 1}. ${step.title}`,
      description: step.what,
    });

    if (step.defends) {
      build.events.push({
        kind: 'annotate',
        at,
        targetId: ACTOR_NODES[step.from],
        text: step.defends,
        reference: step.reference,
      });
    }

    if (step.request) {
      const pduId = `${phaseId}-request`;
      const path = [ACTOR_NODES[step.from], ACTOR_NODES[step.to]];
      pushMessage(build, pduId, step.request, path[0] as string, path[1] as string, at);
      const arrived = pushFlight(build, {
        pduId,
        message: step.request,
        path,
        at,
        relayMs: 0,
        arriveNote: step.title,
      });
      pending = { step, sentAt: at };
      at = round2(arrived + OAUTH_LOCAL_STEP_MS);
      continue;
    }

    if (step.response) {
      const pduId = `${phaseId}-response`;
      const path = [ACTOR_NODES[step.from], ACTOR_NODES[step.to]];
      pushMessage(build, pduId, step.response, path[0] as string, path[1] as string, at);
      build.events.push({
        kind: 'node-state',
        at,
        nodeId: path[0] as string,
        state: step.response.status >= 400 ? 'error' : 'active',
        note: `${step.response.status} ${step.response.reason}`.trim(),
      });
      const arrived = pushFlight(build, {
        pduId,
        message: step.response,
        path,
        at,
        relayMs: 0,
        arriveNote: step.title,
      });

      if (pending?.step.request) {
        build.exchanges.push({
          id: `oauth-${pending.step.index}-${step.index}`,
          stepId: `oauth-${pending.step.index}`,
          hop: 0,
          title: pending.step.title,
          from: ACTOR_NODES[pending.step.from],
          handledBy: ACTOR_NODES[pending.step.to],
          request: pending.step.request,
          response: step.response,
          status: step.response.status,
          sentAt: pending.sentAt,
          receivedAt: arrived,
          why: step.what,
          notes: step.defends ? [step.defends] : [],
        });
        pending = null;
      }

      build.events.push({
        kind: 'node-state',
        at: arrived,
        nodeId: path[0] as string,
        state: 'idle',
      });
      at = round2(arrived + OAUTH_LOCAL_STEP_MS);
      continue;
    }

    // A rung with no message: a hash computed locally, or a person at a consent screen.
    const where = ACTOR_NODES[step.to];
    build.events.push({
      kind: 'node-state',
      at,
      nodeId: where,
      state: 'processing',
      note: step.title,
    });
    build.events.push({ kind: 'log', at, level: 'info', text: step.title });
    at = round2(at + OAUTH_LOCAL_STEP_MS);
    build.events.push({ kind: 'node-state', at, nodeId: where, state: 'idle' });
  }

  if (!plan.intercept) {
    return { detail: { kind: 'oauth', flow }, endsAt: at };
  }

  const interception = interceptAuthorizationCode(flow);
  const guessed =
    plan.guessedVerifier === undefined
      ? undefined
      : interceptAuthorizationCode(flow, { guessedVerifier: plan.guessedVerifier });

  at = round2(at + 200);
  startPhase(build, {
    at,
    id: 'oauth-interception',
    title: 'An attacker spends the stolen code',
    description:
      'Assume the code was captured -- from a URL in history, a referrer, a log, or a rival app registered on the same custom scheme. That is the design assumption, not a worst case. Without PKCE the code alone is enough.',
  });

  const attackExchange = emitDelivery(
    build,
    {
      id: 'oauth-interception',
      stepId: 'oauth-interception',
      hop: 0,
      title: 'Stolen code presented at the token endpoint',
      path: [CLIENT_NODE, AUTH_SERVER_NODE],
      request: interception.request,
      response: interception.response,
      processingMs: 20,
      why: interception.why,
      notes: interception.attackerHeld,
      stateNote: 'recomputing the challenge from the presented verifier',
    },
    at,
  );
  build.exchanges.push(attackExchange);
  at = attackExchange.receivedAt;

  if (guessed) {
    at = round2(at + 120);
    startPhase(build, {
      at,
      id: 'oauth-interception-guess',
      title: 'The attacker guesses a verifier',
      description:
        'The token endpoint asks for a value that never travelled. Guessing it is the only avenue left, and the 43-character minimum of RFC 7636 s 4.1 is what closes it.',
    });
    const guessExchange = emitDelivery(
      build,
      {
        id: 'oauth-interception-guess',
        stepId: 'oauth-interception-guess',
        hop: 0,
        title: 'A guessed verifier presented at the token endpoint',
        path: [CLIENT_NODE, AUTH_SERVER_NODE],
        request: guessed.request,
        response: guessed.response,
        processingMs: 20,
        why: guessed.why,
        notes: guessed.attackerHeld,
        stateNote: 'comparing the derived challenge with the stored one',
      },
      at,
    );
    build.exchanges.push(guessExchange);
    at = guessExchange.receivedAt;
  }

  return {
    detail: {
      kind: 'oauth',
      flow,
      interception,
      ...(guessed ? { guessedInterception: guessed } : {}),
    },
    endsAt: at,
  };
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

function runRateLimitPlan(build: Build, plan: RateLimitPlan): PlanRun {
  const options = {
    bucket: plan.bucket,
    requests: plan.requests,
    backoff: plan.backoff,
    ...(plan.spacingMs === undefined ? {} : { spacingMs: plan.spacingMs }),
    ...(plan.maxAttempts === undefined ? {} : { maxAttempts: plan.maxAttempts }),
    ...(plan.headerStyle === undefined ? {} : { headerStyle: plan.headerStyle }),
  };

  const run = runRateLimitedClient({ ...options, obeyRetryAfter: true });
  const ignoring = plan.compareIgnoringRetryAfter
    ? runRateLimitedClient({ ...options, obeyRetryAfter: false })
    : undefined;

  // The bucket is re-derived here rather than threaded out of `runRateLimitedClient`, whose
  // job is the client's behaviour and not the meter's needs. The two walks consume in the
  // same order at the same instants, so they agree by construction -- and `scenarios.test.ts`
  // asserts they do, comparing each attempt's floored token count with the run's `remaining`.
  let bucket = plan.bucket;
  let requestIndex = 0;
  let at = 0;
  const method = plan.method ?? 'GET';

  for (const attempt of run.attempts) {
    if (attempt.attempt === 0) {
      requestIndex += 1;
      startPhase(build, {
        at: attempt.atMs,
        id: `request-${requestIndex}`,
        title: `Request ${requestIndex} of ${plan.requests}`,
        description:
          requestIndex === 1
            ? 'The bucket starts full, so the first requests are free. A limit nobody has reached is invisible, which is why clients discover it in production.'
            : 'Every attempt consults the bucket. A refusal costs no token -- a limiter that charged for saying no would let a client hold its own bucket empty forever.',
      });
    }

    const consumed = consume(bucket, attempt.atMs);
    bucket = consumed.bucket;

    const request = buildRequest({
      method,
      target: plan.target,
      headers: clientHeaders(build, [header('X-Attempt', `${attempt.attempt + 1}`)]),
    });

    const response = attempt.allowed
      ? withJsonBody(attempt.response, {
          data: { request: requestIndex, ok: true },
        })
      : attempt.response;

    const limit: ExchangeLimit = {
      bucket: consumed.bucket,
      allowed: attempt.allowed,
      remaining: attempt.remaining,
      retryAfterSeconds: consumed.retryAfterSeconds,
      waitMs: attempt.waitMs,
      waitSource: attempt.waitSource,
      requestIndex,
    };

    const exchange = emitDelivery(
      build,
      {
        id: `request-${requestIndex}-attempt-${attempt.attempt + 1}`,
        stepId: `request-${requestIndex}`,
        hop: attempt.attempt,
        title:
          attempt.attempt === 0
            ? `Request ${requestIndex}`
            : `Request ${requestIndex}, retry ${attempt.attempt}`,
        // A 429 is produced by the gateway; the application is never called. That is why
        // rate limiting is cheap to enforce and expensive to be on the wrong side of.
        path: attempt.allowed
          ? [CLIENT_NODE, GATEWAY_NODE, API_NODE]
          : [CLIENT_NODE, GATEWAY_NODE],
        request,
        response,
        processingMs: attempt.allowed ? build.thinkMs : build.gatewayMs,
        relayMs: build.gatewayMs,
        why: attempt.allowed
          ? `The bucket held a token, so this passed. ${attempt.remaining} whole tokens remain, and the RateLimit-* fields say so on the way out -- a client that only learns its quota when refused has learned it too late.`
          : `The bucket was empty, so this is 429 with Retry-After: ${consumed.retryAfterSeconds}s. Retry-After turns a refusal into an instruction, and it is a delta in seconds rather than a date so a client with a skewed clock cannot compute a negative wait.`,
        notes: attempt.allowed
          ? []
          : [
              attempt.waitSource === 'retry-after'
                ? 'The client obeys Retry-After rather than its own backoff curve. The server knows exactly when a token appears; the curve is a guess made without that information.'
                : attempt.waitSource === 'backoff'
                  ? 'This client ignores Retry-After and uses its own curve, which is the failure being demonstrated: it either waits far longer than needed or retries too early and is refused again.'
                  : 'No attempts remain. The request is abandoned rather than retried forever.',
            ],
        stateNote: attempt.allowed ? 'token spent' : 'bucket empty',
        limit,
      },
      attempt.atMs,
    );

    build.exchanges.push(exchange);
    at = Math.max(at, exchange.receivedAt);
  }

  return {
    detail: {
      kind: 'rate-limit',
      run,
      initialBucket: plan.bucket,
      ...(ignoring ? { ignoringRetryAfter: ignoring } : {}),
    },
    endsAt: round2(Math.max(at, run.endedAtMs)),
  };
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

function describeChange(change: CollectionChange<CollectionItem>): string {
  return change.kind === 'insert'
    ? `A new item ("${change.item.title}") is posted, and in a newest-first feed it lands at the front.`
    : `Item ${change.id} is deleted, and everything below it shifts up by one.`;
}

/**
 * The `Link` fields for an offset page.
 *
 * The shape mirrors `offsetPage` in `pagination.ts`, which is the function that owns the
 * arithmetic; this only renders navigation for a page the drift run has already computed.
 * Nothing here is asserting that offset pagination is correct -- `paginateWithDrift` is
 * about to demonstrate that it is not.
 */
function offsetLinks(
  basePath: string,
  offset: number,
  limit: number,
  total: number,
): PageLink[] {
  const query = (start: number) => `${basePath}?offset=${start}&limit=${limit}`;
  const links: PageLink[] = [{ rel: 'first', target: query(0) }];
  if (offset > 0) links.push({ rel: 'prev', target: query(Math.max(0, offset - limit)) });
  if (offset + limit < total) links.push({ rel: 'next', target: query(offset + limit) });
  links.push({
    rel: 'last',
    target: query(Math.max(0, (Math.ceil(total / limit) - 1) * limit)),
  });
  return links;
}

function runPaginationPlan(build: Build, plan: PaginationPlan): PlanRun {
  const shared = {
    items: plan.items,
    pageSize: plan.pageSize,
    changes: plan.changes,
    identify: (item: CollectionItem) => item.id,
    sortValue: (item: CollectionItem) => item.postedAt,
    descending: plan.descending ?? true,
  };

  const offset = paginateWithDrift({ ...shared, strategy: 'offset' as const });
  const cursor = paginateWithDrift({ ...shared, strategy: 'cursor' as const });
  const gap = plan.betweenPagesMs ?? 400;
  const limit = plan.pageSize;
  let at = 0;

  for (const strategy of ['offset', 'cursor'] as const) {
    const drift = strategy === 'offset' ? offset : cursor;
    const seen = new Set<string>();
    let nextCursor: string | undefined;

    for (const page of drift.pages) {
      const index = page.index + 1;
      const phaseId = `${strategy}-page-${index}`;
      startPhase(build, {
        at,
        id: phaseId,
        title: `${strategy === 'offset' ? 'Offset' : 'Cursor'}: page ${index}`,
        description:
          strategy === 'offset'
            ? `?offset=${page.index * limit}&limit=${limit} -- the server counts rows from the top of whatever the collection is right now.`
            : `${index === 1 ? `?limit=${limit}` : `?after=<cursor>&limit=${limit}`} -- the server resumes from a position in the ordering, not from a row number.`,
      });

      const start = page.index * limit;
      const target =
        strategy === 'offset'
          ? `${plan.basePath}?offset=${start}&limit=${limit}`
          : nextCursor === undefined
            ? `${plan.basePath}?limit=${limit}`
            : `${plan.basePath}?after=${nextCursor}&limit=${limit}`;

      const last = page.items[page.items.length - 1];
      const links =
        strategy === 'offset'
          ? offsetLinks(plan.basePath, start, limit, page.collectionSize)
          : last === undefined
            ? []
            : [
                { rel: 'first' as const, target: `${plan.basePath}?limit=${limit}` },
                {
                  rel: 'next' as const,
                  target: `${plan.basePath}?after=${encodeCursor({ sortValue: last.postedAt, id: last.id })}&limit=${limit}`,
                },
              ];

      const document: JsonObject =
        strategy === 'offset'
          ? {
              data: page.items.map((item) => ({ ...item })),
              // Cheap here and expensive in a real database, which is why so many APIs stop
              // reporting it. It is also the number that makes the drift visible.
              total: page.collectionSize,
              offset: start,
              limit,
            }
          : {
              data: page.items.map((item) => ({ ...item })),
              next_cursor:
                last === undefined
                  ? null
                  : encodeCursor({ sortValue: last.postedAt, id: last.id }),
              limit,
            };

      const response = withJsonBody(
        buildResponse({
          status: 200,
          reason: reasonPhrase(200),
          headers: links.length > 0 ? [header('Link', formatLinkHeader(links))] : [],
        }),
        document,
      );

      const repeated = page.ids.filter((id) => seen.has(id));
      for (const id of page.ids) seen.add(id);

      const exchange = emitDelivery(
        build,
        {
          id: phaseId,
          stepId: phaseId,
          hop: 0,
          title: `Page ${index}`,
          path: [CLIENT_NODE, GATEWAY_NODE, API_NODE],
          request: buildRequest({ method: 'GET', target, headers: clientHeaders(build) }),
          response,
          processingMs: build.thinkMs,
          relayMs: build.gatewayMs,
          why:
            repeated.length > 0
              ? `This page repeats ${repeated.join(', ')}. Nothing went wrong in the server: the arithmetic is correct and the collection is simply not the collection it was a moment ago.`
              : strategy === 'offset'
                ? 'A correct page, computed by counting rows from the top.'
                : 'A page resumed from a position in the ordering. An insert or a delete anywhere else changes which items exist and changes nothing about where this page starts.',
          notes: page.changeAfter ? [describeChange(page.changeAfter)] : [],
          stateNote: `serving ${page.items.length} of ${page.collectionSize}`,
          page: {
            strategy,
            index,
            ids: page.ids,
            collectionSize: page.collectionSize,
            repeated,
            ...(page.changeAfter
              ? { changedAfter: describeChange(page.changeAfter) }
              : {}),
          },
        },
        at,
      );

      build.exchanges.push(exchange);
      at = round2(exchange.receivedAt + gap);

      if (page.changeAfter) {
        build.events.push({
          kind: 'log',
          at: round2(exchange.receivedAt + gap / 2),
          level: 'warn',
          text: describeChange(page.changeAfter),
        });
      }

      nextCursor =
        last === undefined
          ? undefined
          : encodeCursor({ sortValue: last.postedAt, id: last.id });
    }
  }

  return {
    detail: {
      kind: 'pagination',
      offset,
      cursor,
      items: plan.items,
      pageSize: plan.pageSize,
    },
    endsAt: at,
  };
}

// ---------------------------------------------------------------------------
// REST against GraphQL
// ---------------------------------------------------------------------------

function runGraphQLPlan(build: Build, plan: GraphQLPlan): PlanRun {
  const endpoint = plan.endpoint ?? '/graphql';
  const calls: RestCall[] = [];
  let at = 0;

  for (const call of plan.restCalls) {
    startPhase(build, {
      at,
      id: `rest-${call.id}`,
      title: call.title,
      description: call.intent,
    });

    const method = call.method ?? 'GET';
    const document = jsonText(call.body);
    const response = withJsonBody(
      buildResponse({ status: 200, reason: reasonPhrase(200) }),
      call.body,
    );
    const request = buildRequest({
      method,
      target: call.target,
      headers: clientHeaders(build),
    });
    const responseBytes = byteLength(document);

    calls.push({
      method,
      target: call.target,
      responseBytes,
      usedBytes: call.usedBytes,
      ...(call.dependsOnPrevious ? { dependsOnPrevious: true } : {}),
    });

    const exchange = emitDelivery(
      build,
      {
        id: `rest-${call.id}`,
        stepId: `rest-${call.id}`,
        hop: 0,
        title: call.title,
        path: [CLIENT_NODE, GATEWAY_NODE, API_NODE],
        request,
        response,
        processingMs: build.thinkMs,
        relayMs: build.gatewayMs,
        why: call.dependsOnPrevious
          ? 'This call could not be issued until the previous one returned, because it needs an id out of that response. Sequential round trips are latency, and latency does not improve with bandwidth.'
          : 'A fixed representation: the endpoint returns what it returns, and the screen takes the fields it wants.',
        notes: [
          `${responseBytes} bytes came back; the screen reads ${call.usedBytes} of them and discards ${responseBytes - call.usedBytes}.`,
          'This response is cacheable by URL in any shared cache along the path -- a browser cache, a CDN, a reverse proxy. That is a real advantage and it belongs on REST’s side of the ledger.',
        ],
        stateNote: 'serving a fixed representation',
        cost: {
          requestBytes: approximateWireBytes(request),
          responseBytes,
          usedBytes: call.usedBytes,
        },
      },
      at,
    );

    build.exchanges.push(exchange);
    at = round2(exchange.receivedAt + 40);
  }

  const parsed = parseGraphQL(plan.query);
  if (!parsed.ok) {
    throw new Error(
      `scenario declares a GraphQL query that does not parse: ${parsed.error}`,
    );
  }

  const unbatched = executeGraphQL(plan.schema, parsed.value);
  const batched = executeGraphQL(plan.schema, parsed.value, {
    batchDataSourceCalls: true,
  });

  at = round2(at + 200);
  startPhase(build, {
    at,
    id: 'graphql-query',
    title: 'The same screen, in one query',
    description:
      'One POST to one endpoint, carrying the shape the screen wants. The response has exactly those fields and nothing else.',
  });

  const graphqlRequest = withJsonBody(
    buildRequest({
      method: 'POST',
      target: endpoint,
      headers: clientHeaders(build),
    }),
    { query: plan.query },
  );

  const graphqlResponse = buildResponse({
    status: 200,
    reason: reasonPhrase(200),
    headers: [
      header('Content-Type', 'application/json'),
      header('Content-Length', `${unbatched.responseBytes}`),
      // Not a nicety. A single POST is not cacheable by URL, so every shared cache in the
      // path is out of the picture and the client has to rebuild caching for itself.
      header('Cache-Control', 'no-store'),
    ],
    body: unbatched.body,
  });

  const comparison = compareTransports({
    restCalls: calls,
    graphqlQuery: plan.query,
    graphqlResult: unbatched,
    ...(plan.graphqlUsedBytes === undefined
      ? {}
      : { graphqlUsedBytes: plan.graphqlUsedBytes }),
    ...(plan.headerBytes === undefined ? {} : { headerBytes: plan.headerBytes }),
  });

  const exchange = emitDelivery(
    build,
    {
      id: 'graphql-query',
      stepId: 'graphql-query',
      hop: 0,
      title: 'POST /graphql',
      path: [CLIENT_NODE, GATEWAY_NODE, API_NODE],
      request: graphqlRequest,
      response: graphqlResponse,
      // One round trip on the wire, and more work on the server than any single REST call:
      // the resolvers still have to be run, and there are more of them.
      processingMs: round2(build.thinkMs + unbatched.stats.dataSourceCalls * 3),
      relayMs: build.gatewayMs,
      why: 'One round trip, and the response carries the requested shape with nothing over-fetched. The transport status is 200 whatever the errors array says, which is the trade-off: HTTP status codes stop being the error channel.',
      notes: [
        `Serving this one query cost ${unbatched.stats.dataSourceCalls} data-source calls on the server -- the N+1 problem, which is the default rather than a mistake. With per-field batching (DataLoader), the same query costs ${batched.stats.dataSourceCalls}.`,
        'The request is larger than any REST request, because the query travels in the body. On a small response that is a meaningful fraction of the total.',
        'A single POST to one URL is not cacheable by any shared cache, so caching has to be rebuilt on the client. That is the cost of the flexibility above it.',
      ],
      stateNote: `resolving ${unbatched.stats.fieldsResolved} fields`,
      cost: {
        requestBytes: approximateWireBytes(graphqlRequest),
        responseBytes: unbatched.responseBytes,
        usedBytes: plan.graphqlUsedBytes ?? unbatched.responseBytes,
      },
    },
    at,
  );

  build.exchanges.push(exchange);

  return {
    detail: { kind: 'graphql', comparison, unbatched, batched, query: plan.query },
    endsAt: exchange.receivedAt,
  };
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

/**
 * The status `0` is not a status.
 *
 * A timeout produces no response at all, and inventing one would teach the wrong thing. What
 * is modelled instead is the sender's actual epistemic position: it knows it sent bytes and
 * it knows nothing else. A lost reply and a receiver that never ran are indistinguishable
 * from here, and that ambiguity is exactly why the receiver has to be idempotent.
 */
const NO_REPLY: HttpResponse = {
  status: 0,
  reason: 'no reply -- the sender timed out',
  headers: [],
};

function replyResponse(reply: ReceiverReply): HttpResponse {
  if (reply.kind === 'timeout') return NO_REPLY;

  const retryAfter =
    reply.retryAfterSeconds === undefined
      ? []
      : [header('Retry-After', `${reply.retryAfterSeconds}`)];

  if (reply.status >= 400) {
    const document = problem(
      reply.status,
      reply.status === 429
        ? 'The receiver is over its own capacity and is asking the sender to slow down.'
        : reply.status === 410
          ? 'This endpoint no longer exists. Stop sending and disable it.'
          : reply.status >= 500
            ? 'The receiver failed while handling the event. It may work next time.'
            : 'The receiver read the payload and rejected it.',
    );
    return { ...document, headers: [...document.headers, ...retryAfter] };
  }

  return withJsonBody(
    buildResponse({
      status: reply.status,
      reason: reasonPhrase(reply.status),
      headers: retryAfter,
    }),
    { received: true },
  );
}

/** What the receiver's handler does with an event. Pure, and recorded against the event id. */
function applyEvent(event: WebhookEvent): JsonObject {
  return { event: event.id, action: `handled ${event.type}`, ranAt: event.createdAt };
}

function runWebhookPlan(build: Build, plan: WebhookPlan): PlanRun {
  const delivery = deliverWebhook({
    event: plan.event,
    endpoint: plan.endpoint,
    secret: plan.secret,
    replies: plan.replies,
    backoff: plan.backoff,
    startMs: 0,
    startSeconds: plan.startSeconds,
    ...(plan.maxAttempts === undefined ? {} : { maxAttempts: plan.maxAttempts }),
  });

  let at = 0;

  for (const attempt of delivery.attempts) {
    const phaseId = `attempt-${attempt.attempt}`;
    startPhase(build, {
      at: attempt.atMs,
      id: phaseId,
      title: `Attempt ${attempt.attempt}`,
      description:
        attempt.attempt === 1
          ? 'The API is the client here. It signs the body with a shared secret and POSTs it to a URL the subscriber gave it.'
          : 'Re-signed with this attempt’s timestamp, and carrying the same event id. The signature must differ; the identity must not.',
    });

    const signature = verifyWebhookSignature({
      body: attempt.request.body ?? '',
      headerValue: headerValue(attempt.request.headers, SIGNATURE_HEADER) ?? '',
      secrets: plan.receiverSecrets,
      nowSeconds: plan.startSeconds + Math.floor(attempt.atMs / 1000),
      ...(plan.toleranceSeconds === undefined
        ? {}
        : { toleranceSeconds: plan.toleranceSeconds }),
    });

    const response = replyResponse(attempt.reply);

    if (attempt.reply.kind === 'timeout') {
      // No response, so no return leg. The request flies, the receiver goes dark, and the
      // sender is left holding a question it cannot answer.
      const pduId = `${phaseId}-request`;
      pushMessage(build, pduId, attempt.request, API_NODE, RECEIVER_NODE, attempt.atMs);
      const arrived = pushFlight(build, {
        pduId,
        message: attempt.request,
        path: [API_NODE, RECEIVER_NODE],
        at: attempt.atMs,
        relayMs: 0,
        arriveNote: 'no reply within the timeout',
      });
      build.events.push({
        kind: 'node-state',
        at: arrived,
        nodeId: RECEIVER_NODE,
        state: 'error',
      });
      build.events.push({
        kind: 'log',
        at: arrived,
        level: 'warn',
        text: `Attempt ${attempt.attempt}: no reply. The sender cannot tell a lost response from a receiver that never ran.`,
      });

      build.exchanges.push({
        id: phaseId,
        stepId: phaseId,
        hop: attempt.attempt - 1,
        title: `Attempt ${attempt.attempt}`,
        from: API_NODE,
        handledBy: RECEIVER_NODE,
        request: attempt.request,
        response,
        status: 0,
        sentAt: attempt.atMs,
        receivedAt: arrived,
        why: attempt.why,
        notes: [
          'Nothing came back. The event may have been handled, or may not -- which is precisely the situation at-least-once delivery leaves a receiver in, and why the receiver below deduplicates on the event id rather than on anything it computes itself.',
        ],
        signature,
      });

      at = Math.max(at, round2(arrived + attempt.waitMs));
      continue;
    }

    const exchange = emitDelivery(
      build,
      {
        id: phaseId,
        stepId: phaseId,
        hop: attempt.attempt - 1,
        title: `Attempt ${attempt.attempt}`,
        path: [API_NODE, RECEIVER_NODE],
        request: attempt.request,
        response,
        processingMs: 18,
        why: attempt.why,
        notes: [
          signature.valid
            ? 'The signature verified: the timestamp is inside the tolerance window and the HMAC over "<timestamp>.<raw body>" matches. Both halves matter -- a signature over the body alone can be replayed with any timestamp.'
            : 'The signature did not verify, so the receiver must refuse the delivery before doing any work with the payload.',
          attempt.waitSource === 'retry-after'
            ? 'The receiver sent Retry-After, so the sender uses it rather than its own curve.'
            : attempt.waitSource === 'backoff'
              ? `The receiver gave no instruction, so the sender falls back to its own exponential curve and waits ${attempt.waitMs} ms.`
              : 'No further attempt follows this one.',
        ],
        stateNote: signature.valid ? 'signature verified' : 'signature rejected',
        signature,
      },
      attempt.atMs,
    );

    build.exchanges.push(exchange);
    at = Math.max(at, round2(exchange.receivedAt + attempt.waitMs));
  }

  // The same event handled twice, which is what at-least-once delivery guarantees will
  // eventually happen. No network leg: this is the receiver's own bookkeeping.
  const empty = createIdempotencyStore();
  const firstReceipt = receiveEvent(empty, plan.event, applyEvent);
  const secondReceipt = receiveEvent(firstReceipt.store, plan.event, applyEvent);

  at = round2(at + 200);
  startPhase(build, {
    at,
    id: 'idempotent-receipt',
    title: 'The same event, delivered twice',
    description:
      'At-least-once delivery is a promise about the floor, not the ceiling. The receiver looks the event id up, does the work only if it is new, and returns the recorded result either way -- so the sender cannot tell which delivery did it.',
  });
  build.events.push({
    kind: 'annotate',
    at,
    targetId: RECEIVER_NODE,
    text: secondReceipt.why,
  });
  build.events.push({ kind: 'log', at, level: 'info', text: firstReceipt.why });
  build.events.push({
    kind: 'log',
    at: round2(at + 40),
    level: 'info',
    text: secondReceipt.why,
  });
  at = round2(at + 80);

  let forgery: SignatureVerdict | undefined;
  if (plan.forgery) {
    const timestampSeconds = plan.startSeconds + Math.floor(at / 1000);
    const forged: HttpRequest = {
      ...webhookRequest({
        endpoint: plan.endpoint,
        event: plan.event,
        secret: plan.forgery.secret,
        timestampSeconds,
      }),
      body: plan.forgery.body,
    };
    const forgedSignature = signWebhook({
      secret: plan.forgery.secret,
      body: plan.forgery.body,
      timestampSeconds,
    });
    const request: HttpRequest = {
      ...forged,
      headers: setHeader(forged.headers, SIGNATURE_HEADER, forgedSignature),
    };

    forgery = verifyWebhookSignature({
      body: plan.forgery.body,
      headerValue: forgedSignature,
      secrets: plan.receiverSecrets,
      nowSeconds: timestampSeconds,
      ...(plan.toleranceSeconds === undefined
        ? {}
        : { toleranceSeconds: plan.toleranceSeconds }),
    });

    at = round2(at + 120);
    startPhase(build, {
      at,
      id: 'forged-delivery',
      title: plan.forgery.title,
      description: plan.forgery.intent,
    });

    const exchange = emitDelivery(
      build,
      {
        id: 'forged-delivery',
        stepId: 'forged-delivery',
        hop: 0,
        title: plan.forgery.title,
        path: [API_NODE, RECEIVER_NODE],
        request,
        response: problem(
          401,
          'The signature does not verify against any secret this endpoint accepts.',
        ),
        processingMs: 18,
        why: 'A webhook endpoint is a public URL: anybody can POST to it. The signature is the only thing separating an event from the API and an event from whoever found the URL, which is why verification must happen before the payload is parsed, let alone acted on.',
        notes: [
          'The comparison is constant-time. This is the comparison where that matters most -- a receiver is an endpoint an attacker can call as often as they like, which is exactly the condition a timing attack needs.',
        ],
        stateNote: 'signature rejected',
        signature: forgery,
      },
      at,
    );
    build.exchanges.push(exchange);
    at = exchange.receivedAt;
  }

  return {
    detail: {
      kind: 'webhook',
      delivery,
      firstReceipt,
      secondReceipt,
      ...(forgery ? { forgery } : {}),
    },
    endsAt: at,
  };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * Sort by time, keeping emission order within one instant.
 *
 * The tie-break matters: a `pdu-created` and the `transmit` referencing it happen at the same
 * virtual millisecond, and the log reads as nonsense the other way round.
 * `Array.prototype.sort` has been required to be stable since ES2019.
 */
function sortEvents(events: readonly SimEvent[]): SimEvent[] {
  return [...events].sort((a, b) => a.at - b.at);
}

/** Which machine a scenario note pins to when it does not say. */
function defaultNoteTarget(plan: ApiPlan): string {
  return plan.kind === 'webhook' ? API_NODE : CLIENT_NODE;
}

/**
 * Run one scenario end to end.
 *
 * Pure and total: the same scenario produces a deep-equal `ApiRun` every time, because every
 * timestamp is arithmetic on declared latencies and every credential, code, and cursor is a
 * literal the scenario supplied. There is no clock read and no socket to open.
 */
export function runApiScenario(scenario: ApiScenario): ApiRun {
  const conditions: NetworkConditions = {
    rttMs: scenario.conditions?.rttMs ?? DEFAULT_RTT_MS,
    bandwidthKbps: scenario.conditions?.bandwidthKbps ?? DEFAULT_BANDWIDTH_KBPS,
  };
  const apiHost = scenario.apiHost ?? DEFAULT_API_HOST;
  const plan = scenario.plan;

  const build: Build = {
    events: [],
    pdus: {},
    topology: buildTopology(plan, distances(conditions), conditions, apiHost, {
      ...(plan.kind === 'oauth' ? { issuer: plan.config.issuer } : {}),
      ...(plan.kind === 'webhook' ? { endpoint: plan.endpoint } : {}),
    }),
    conditions,
    phases: [],
    exchanges: [],
    apiHost,
    gatewayMs: scenario.gatewayMs ?? DEFAULT_GATEWAY_MS,
    thinkMs: scenario.thinkMs ?? DEFAULT_THINK_MS,
  };

  const run =
    plan.kind === 'rest'
      ? runRestPlan(build, plan)
      : plan.kind === 'auth'
        ? runAuthPlan(build, plan)
        : plan.kind === 'oauth'
          ? runOAuthPlan(build, plan)
          : plan.kind === 'rate-limit'
            ? runRateLimitPlan(build, plan)
            : plan.kind === 'pagination'
              ? runPaginationPlan(build, plan)
              : plan.kind === 'graphql'
                ? runGraphQLPlan(build, plan)
                : runWebhookPlan(build, plan);

  const durationMs = round2(run.endsAt + API_TAIL_MS);

  for (const phase of build.phases) {
    build.events.push({
      kind: 'phase',
      at: phase.at,
      id: phase.id,
      title: phase.title,
      description: phase.description,
    });
  }

  // Notes are pinned by phase id, so the phases have to exist before the notes can be
  // placed -- one pass to find the boundaries, a second to fold the notes in.
  const provisional = summarizePhases(sortEvents(build.events), durationMs);
  for (const note of scenario.notes ?? []) {
    const phase = provisional.find((candidate) => candidate.id === note.phase);
    if (!phase) {
      throw new Error(
        `scenario "${scenario.id}" pins a note to phase "${note.phase}", which this run does not have. It has: ${provisional.map((each) => each.id).join(', ')}`,
      );
    }
    build.events.push({
      kind: 'annotate',
      at: phase.startMs,
      targetId: note.target ?? defaultNoteTarget(plan),
      text: note.text,
      ...(note.reference ? { reference: note.reference } : {}),
    });
  }

  const events = sortEvents(build.events);

  return {
    scenario,
    topology: build.topology,
    result: {
      events,
      phases: summarizePhases(events, durationMs),
      durationMs,
      pdus: build.pdus,
    },
    exchanges: build.exchanges,
    detail: run.detail,
  };
}
