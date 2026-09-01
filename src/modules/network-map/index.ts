/**
 * The Network Map's public surface.
 *
 * The route imports the composition root from here; the scenarios are re-exported so the
 * Learning Center can name the same four networks without reaching into the folder. Note
 * that another *module* may not import any of this (`eslint.config.mjs`) -- shared data
 * lives in `@/core/topologies`, which is where these scenarios actually come from.
 */

export { NetworkMapModule } from './NetworkMapModule';
export { NETWORK_MAP_ID, networkMapMeta } from './meta';
export {
  DEFAULT_SCENARIO_ID,
  getNetworkMapScenario,
  NETWORK_MAP_SCENARIOS,
  type NetworkMapScenarioId,
} from './scenarios';
export {
  buildTour,
  tourStepAt,
  tourStepFor,
  TOUR_STEP_MS,
  type GuidedTour,
  type TourStep,
} from './tour';
export { countAtLayer, dimmedForLayer, layerOf, layersInTopology } from './layers';
