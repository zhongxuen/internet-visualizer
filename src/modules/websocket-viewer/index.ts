/**
 * WebSocket Viewer's public surface.
 *
 * The route imports the composition root from here; the scenarios, the frame model, and the
 * close-code table are re-exported so the Learning Center can name the same seven runs and
 * cite the same sentences. Note that another *module* may not import any of this
 * (`eslint.config.mjs`); shared code belongs in `@/core` or `@/components`.
 *
 * Nothing exported here can reach a network. `runWebSocketScenario` reads bundled fixtures and
 * nothing else; there is no `WebSocket` constructor and no `fetch` anywhere in this module,
 * and no function in it takes a host it could be pointed at. That is the property the whole
 * module rests on.
 */

export { WebSocketViewerModule } from './WebSocketViewerModule';
export { WEBSOCKET_VIEWER_ID, webSocketViewerMeta } from './meta';

export {
  base64Overhead,
  CLIENT_SUBPROTOCOLS,
  DEFAULT_WEBSOCKET_SCENARIO_ID,
  getWebSocketScenario,
  PAGE_ORIGIN,
  RFC_EXAMPLE_ACCEPT,
  RFC_EXAMPLE_KEY,
  sampleBytes,
  SERVER_SUBPROTOCOLS,
  WEBSOCKET_SCENARIOS,
  WS_HOST,
  type WebSocketScenarioId,
} from './scenarios';

export {
  directionOf,
  framePreview,
  frameSummary,
  runWebSocketScenario,
  CLIENT_NODE,
  PROXY_NODE,
  SERVER_NODE,
  type Endpoint,
  type FrameRecord,
  type HandshakeRecord,
  type SessionStep,
  type WebSocketDetail,
  type WebSocketPlan,
  type WebSocketPlanKind,
  type WebSocketRun,
  type WebSocketScenario,
} from './sim/exchange';

export {
  applyMask,
  describeOpcode,
  explainMasking,
  frameLayout,
  isControlOpcode,
  LENGTH_ENCODINGS,
  lengthEncodingFor,
  MAX_7_BIT_LENGTH,
  MAX_CONTROL_PAYLOAD,
  OPCODE_VALUES,
  type Direction,
  type FrameField,
  type FrameLayout,
  type LengthEncoding,
  type Opcode,
  type WebSocketFrame,
} from './sim/frames';

export {
  backoffSchedule,
  closeCodeRange,
  describeCloseCode,
  describeCloseCodeRange,
  describeReadyState,
  explainBackoff,
  isSendableCloseCode,
  simulateKeepalive,
  CLOSE_CODES,
  MAX_CLOSE_REASON_BYTES,
  type CloseCodeInfo,
  type CloseInfo,
  type ConnectionState,
  type KeepaliveRun,
  type ReadyState,
} from './sim/lifecycle';

export {
  deriveAccept,
  explainKeyPurpose,
  explainOriginCheck,
  handshakeCost,
  verifyAccept,
  WEBSOCKET_GUID,
  WEBSOCKET_VERSION,
  type AcceptDerivation,
  type HandshakeCheck,
  type HandshakeOutcome,
  type Requirement,
  type ServerPolicy,
} from './sim/upgrade';

export {
  compareTransports,
  counters,
  TRANSPORT_LABELS,
  TRANSPORT_SUMMARIES,
  TRANSPORTS,
  type Transport,
  type TransportComparison,
  type TransportCounters,
  type TransportRun,
} from './sim/comparison';

export { explainSha1Choice, sha1, base64Encode } from './sim/digest';
