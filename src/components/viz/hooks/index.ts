/**
 * The hooks that connect a `SimResult` to the screen.
 *
 * Three of them, in the order data flows: `useSimulation` produces the run,
 * `usePlayback` moves one number through it, `useVisibleState` turns that number into a
 * frame. Nothing else in the visualization layer holds mutable state.
 */

export {
  createPlaybackStore,
  usePlayback,
  usePlaybackContext,
  usePlaybackState,
  PlaybackContext,
  type PlaybackActions,
  type PlaybackStore,
  type PlaybackStoreState,
  type UsePlaybackOptions,
} from './usePlayback';
export { usePlaybackKeys } from './usePlaybackKeys';
export {
  useSimulation,
  type Simulation,
  type SimulationSource,
  type VisualizedRun,
} from './useSimulation';
export { snapToEndpoints, useVisibleState } from './useVisibleState';
