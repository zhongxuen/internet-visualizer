/**
 * Network Diagnostics' public surface.
 *
 * The route imports the composition root from here; the four simulations, their fixtures, and
 * the explanation constants are re-exported so the Learning Center can cite the same sentences
 * the module shows. Note that another *module* may not import any of this
 * (`eslint.config.mjs`); shared code belongs in `@/core` or `@/components`.
 *
 * **Everything under `sim/` is unable to reach a network.** Those entry points take a bundled
 * fixture -- a `DiagnosticPath`, a canned DNS question, a `RegistrationRecord` -- and none of
 * them accepts a host name, URL, or address from a caller and does anything with it but print
 * it. That is the property Learn mode rests on, and phase 12 did not weaken it.
 *
 * **Live mode is the exception, and it is one file.** `live/client.ts` performs the module's
 * only I/O: a single same-origin `GET` to this app's own Route Handlers, made when the user
 * presses Run, never retried. `live/operations.ts` describes those requests without making
 * any. Nothing else in this folder can cause one, and `LiveConsole` -- the only component that
 * calls the client -- is not rendered at all until the mode switch's acknowledgement gate has
 * been passed.
 */

export { NetworkDiagnosticsModule } from './NetworkDiagnosticsModule';
export { NETWORK_DIAGNOSTICS_ID, networkDiagnosticsMeta } from './meta';

export {
  ModeSwitch,
  type DiagnosticsMode,
  type ModeSwitchProps,
} from './components/ModeSwitch';
export { TargetInput, type TargetInputProps } from './components/TargetInput';
export { LiveDisclosure, type LiveDisclosureProps } from './components/LiveDisclosure';
export {
  RateLimitNotice,
  useRetryCountdown,
  type RateLimitNoticeProps,
} from './components/RateLimitNotice';
export { LiveConsole, type LiveConsoleProps } from './components/LiveConsole';
export {
  LiveFailureNotice,
  LiveResultView,
  type LiveResultData,
  type LiveResultViewProps,
} from './components/LiveResultView';

export {
  checkLiveTarget,
  getLiveOperation,
  liveOperationForTool,
  planLiveRequest,
  LIVE_OPERATIONS,
  LIVE_TRACEROUTE_NOTE,
  type CheckedTarget,
  type LearnTool,
  type LiveOperation,
  type LiveOperationId,
  type LivePlan,
  type PlannedRequest,
} from './live/operations';

export {
  runLiveRequest,
  type LiveFailure,
  type LiveOutcome,
  type LiveQuota,
} from './live/client';

export {
  buildTopology,
  conditionsOf,
  hopCount,
  linkIdAt,
  machineAt,
  nodeChain,
  oneWayMs,
  DEFAULT_CONDITIONS,
  ICMP_POLICY_LABELS,
  type DiagnosticPath,
  type IcmpPolicy,
  type ParallelRouter,
  type PathConditions,
  type PathDestination,
  type PathHop,
  type PathSource,
} from './sim/path';

export {
  getPath,
  DEAD_HOST,
  DEFAULT_PATH_ID,
  DIAGNOSTIC_PATHS,
  FILTERED_HOST,
  FLAKY_WIFI,
  LOCAL_CDN,
  LONG_HAUL,
  PROHIBITED_HOST,
} from './sim/paths';

export {
  buildIcmpEchoLayer,
  buildIcmpUnreachableLayer,
  echoPayloadPattern,
  explainOutcome,
  icmpEchoBytes,
  icmpEchoChecksum,
  icmpEchoSize,
  runPing,
  summarize,
  DEFAULT_PAYLOAD_BYTES,
  ICMP_CODE_ADMIN_PROHIBITED,
  ICMP_CODE_HOST_UNREACHABLE,
  ICMP_DESTINATION_UNREACHABLE,
  ICMP_ECHO_REPLY,
  ICMP_ECHO_REQUEST,
  ICMP_HEADER_BYTES,
  WHY_SILENCE_IS_NOT_DOWN,
  type IcmpEcho,
  type PingOptions,
  type PingProbe,
  type PingRun,
  type PingStats,
  type PingVerdict,
  type ProbeOutcome,
  type ReachabilityContrast,
} from './sim/ping';

export {
  bestTime,
  caveatsFor,
  runTraceroute,
  walkTtl,
  DEFAULT_MAX_TTL,
  DEFAULT_TIMEOUT_MS,
  METHOD_NOTES,
  PROBES_PER_HOP,
  TRACEROUTE_CAVEATS,
  UDP_BASE_PORT,
  UDP_SOURCE_PORT,
  type HopOutcome,
  type ProbeMethod,
  type TracerouteCaveat,
  type TracerouteHop,
  type TracerouteOptions,
  type TracerouteProbe,
  type TracerouteRun,
  type TtlStep,
} from './sim/traceroute';

export {
  runLookup,
  DEFAULT_LOOKUP,
  LOOKUP_CAVEATS,
  LOOKUP_EXAMPLES,
  type AnnotatedRecord,
  type LookupExample,
  type LookupOptions,
  type LookupRun,
  type WarmRun,
} from './sim/lookup';

export {
  describeStatus,
  formatRdap,
  formatWhois,
  getRecord,
  rdapBody,
  runRegistrationLookup,
  DEFAULT_RECORD_ID,
  DOC_NETWORK,
  EPP_STATUS_CODES,
  EXAMPLE_COM,
  EXAMPLE_NET,
  EXAMPLE_ORG,
  RDAP_FIELD_NOTES,
  REGISTRATION_RECORDS,
  UNREGISTERED,
  WHOIS_VS_RDAP,
  type EppStatus,
  type ProtocolContrast,
  type RegistrationEntity,
  type RegistrationEvent,
  type RegistrationKind,
  type RegistrationNameserver,
  type RegistrationRecord,
  type RegistrationRun,
  type RegistrySource,
} from './sim/whois';
