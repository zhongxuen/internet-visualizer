/**
 * Packet Journey's public surface.
 *
 * The route imports the composition root from here; the scenarios and the engine are
 * re-exported so the Learning Center can name the same four runs, and so a later module
 * that wants a packet walked across a path can ask for one without reaching into the
 * folder. Note that another *module* may not import any of this (`eslint.config.mjs`) --
 * shared code belongs in `@/core` or `@/components`.
 */

export { PacketJourneyModule } from './PacketJourneyModule';
export { PACKET_JOURNEY_ID, packetJourneyMeta } from './meta';
export {
  DEFAULT_JOURNEY_ID,
  getJourneyScenario,
  PACKET_JOURNEY_SCENARIOS,
  type PacketJourneyScenarioId,
} from './scenarios';
export {
  runJourney,
  runJourneyDetailed,
  type JourneyOverrides,
  type JourneyScenario,
} from './sim/journey';
export {
  buildLedger,
  currentRowIndex,
  focusAt,
  type HopChange,
  type HopRow,
  type PacketFocus,
  type PacketStatus,
} from './ledger';
export { AUTHORED_OPTIONS, journeyOverrides, type JourneyOptions } from './options';
