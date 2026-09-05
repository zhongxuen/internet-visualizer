/**
 * HTTPS Explorer's public surface.
 *
 * The route imports the composition root from here; the scenarios, the certificate model,
 * the handshake models and the record layer are re-exported so the Learning Center can
 * name the same seven runs and cite the same sentences, and so phase 11's Internet
 * Simulator can compose a TLS connection into a whole page load rather than restating
 * one. Note that another *module* may not import any of this (`eslint.config.mjs`);
 * shared code belongs in `@/core` or `@/components`.
 *
 * Nothing exported here can reach a network, and nothing exported here is cryptography.
 * `runTlsScenario` reads bundled fixtures and nothing else, every key and signature is a
 * labelled placeholder from `sim/placeholder.ts`, and there is no code path from any of
 * it to a socket. That is the property the whole module rests on.
 */

export { HttpsExplorerModule } from './HttpsExplorerModule';
export { HTTPS_EXPLORER_ID, httpsExplorerMeta } from './meta';

export {
  CertificateChain as CertificateChainView,
  type CertificateChainProps,
} from './components/CertificateChain';
export {
  CipherSuiteBreakdown,
  segmentSuiteName,
  type CipherSuiteBreakdownProps,
  type NameSegment,
} from './components/CipherSuiteBreakdown';
export {
  EncryptionOverlay,
  type EncryptionOverlayProps,
  type OverlayView,
} from './components/EncryptionOverlay';
export { HandshakeLadder, type HandshakeLadderProps } from './components/HandshakeLadder';
export {
  KeyScheduleDiagram,
  type KeyScheduleDiagramProps,
} from './components/KeyScheduleDiagram';
export {
  VersionComparison,
  type VersionComparisonProps,
} from './components/VersionComparison';

export {
  CERTIFICATE_FAILURE_SCENARIOS,
  DEFAULT_TLS_SCENARIO_ID,
  getTlsScenario,
  TLS_SCENARIOS,
  type TlsScenarioId,
} from './scenarios';

export {
  encryptionBeginsAt,
  readableRecords,
  runTlsScenario,
  stillVisibleFacts,
  type ConnectionAbort,
  type TlsRun,
  type TlsScenario,
  type WireRecord,
} from './sim/connection';

export {
  formatDistinguishedName,
  formatInstant,
  matchHostname,
  primaryFailure,
  stepById,
  validateChain,
  VALIDATION_STEP_IDS,
  type Certificate,
  type CertificateChain,
  type ChainValidation,
  type TrustStore,
  type ValidationStep,
  type ValidationStepId,
} from './sim/certificates';

export {
  ALL_SUITES,
  decomposeSuite,
  getCipherSuite,
  namedComponentCount,
  suitesForVersion,
  TLS12_SUITES,
  TLS13_SUITES,
  type CipherSuite,
  type SuiteComponent,
  type TlsVersion,
} from './sim/cipher';

export {
  buildTls13Handshake,
  cleartextMessages,
  messageById,
  observableFields,
  type Flight,
  type HandshakeMessage,
  type HandshakeNote,
  type MessageEncryption,
  type MessageField,
  type Tls13Handshake,
} from './sim/handshake13';

export {
  buildTls12Handshake,
  tradeOffs,
  VERSION_COMPARISON,
  type Tls12Handshake,
  type VersionComparisonRow,
} from './sim/handshake12';

export {
  buildKeySchedule,
  knowledgeOf,
  observerLosesTrackAt,
  type DerivedSecret,
  type KeySchedule,
  type KeyScheduleStep,
  type NamedGroup,
  type Party,
  type TrafficKeys,
} from './sim/keyschedule';

export {
  observerFacts,
  observerView,
  stillVisible,
  type ObservedRecord,
  type ObserverFact,
  type TlsRecord,
} from './sim/records';

export { PLACEHOLDER_NOTICE, PLACEHOLDER_PREFIX } from './sim/placeholder';
