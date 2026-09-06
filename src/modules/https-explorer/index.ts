/**
 * HTTPS Explorer's public surface.
 *
 * The route imports the composition root from here; the scenarios and the five views are
 * re-exported so the Learning Center can name the same seven runs and reuse the same
 * diagrams. Note that another *module* may not import any of this
 * (`eslint.config.mjs`); shared code belongs in `@/core` or `@/components`.
 *
 * TLS itself is not here and is not re-exported through here. It is
 * `@/core/protocols/tls`, which anything may import: the Internet Simulator composes a
 * TLS connection into a whole page load out of that layer rather than restating one, and
 * never touches this module to do it.
 *
 * Nothing exported here can reach a network, and nothing exported here is cryptography.
 * `runTlsScenario` reads bundled fixtures and nothing else, every key and signature is a
 * labelled placeholder from `@/core/protocols/tls/placeholder.ts`, and there is no code
 * path from any of it to a socket. That is the property the whole module rests on.
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
