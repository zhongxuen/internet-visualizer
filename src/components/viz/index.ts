/**
 * The visualization layer's public surface.
 *
 * Modules import from here, never from a file inside. What is exported is the contract:
 * a canvas, the token tables that keep every module's diagram consistent, and the pure
 * mapping/layout functions behind them.
 */

export { SimulationCanvas, type SimulationCanvasProps } from './SimulationCanvas';
export { SimulationView, type SimulationViewProps } from './SimulationView';
export { EventLog, type EventLogProps } from './EventLog';
export { KeyboardLegend, type KeyboardLegendProps } from './KeyboardLegend';
export { PhaseStepper, type PhaseStepperProps } from './PhaseStepper';
export { PlaybackControls, type PlaybackControlsProps } from './PlaybackControls';
export { Timeline, type TimelineProps } from './Timeline';
export {
  createPlaybackStore,
  PlaybackContext,
  usePlayback,
  usePlaybackContext,
  usePlaybackKeys,
  usePlaybackState,
  useSimulation,
  useVisibleState,
  snapToEndpoints,
  type PlaybackActions,
  type PlaybackStore,
  type PlaybackStoreState,
  type Simulation,
  type SimulationSource,
  type UsePlaybackOptions,
  type VisualizedRun,
} from './hooks';
export {
  matchPlaybackKey,
  shouldIgnoreKey,
  PLAYBACK_SHORTCUTS,
  type KeyChord,
  type PlaybackCommand,
  type PlaybackShortcut,
} from './keymap';
export {
  describeEvent,
  labelsFor,
  type EventContext,
  type EventDescription,
  type EventTone,
} from './events';
export { formatDuration, formatTimecode, percentOf } from './time';
export { HeaderTable, type HeaderTableProps } from './HeaderTable';
export { Inspector, type InspectorProps } from './Inspector';
export { PacketLayerStack, type PacketLayerStackProps } from './PacketLayerStack';
export { PacketSprite, type PacketSpriteProps } from './PacketSprite';
export { PacketSelectionContext, usePacketSelect } from './packetSelection';
export {
  AddressVisibilityContext,
  DimmedNodesContext,
  useAddressVisibility,
  useDimmedNodes,
} from './display';
export {
  clampProgress,
  parseCubicPath,
  placeAlongPath,
  pointOnCubic,
  pointOnSegment,
  tangentAngleOnCubic,
  type CubicPath,
  type PathPlacement,
} from './packetPath';
export {
  describeLink,
  describeNode,
  departureSide,
  packetsByLink,
  toFlowEdges,
  toFlowNodes,
  type ToFlowOptions,
} from './graph';
export {
  layoutTopology,
  NODE_HEIGHT,
  NODE_WIDTH,
  type LayoutOptions,
  type XY,
} from './layout';
export {
  isSameSelection,
  type CanvasSelection,
  type EdgePacket,
  type LinkEdgeData,
  type LinkFlowEdge,
  type TopologyFlowNode,
  type TopologyNodeData,
} from './types';
export {
  edgeTypes,
  LinkEdge,
  LINK_MEDIA,
  LINK_MEDIUM_LIST,
  linkMediumToken,
  type LinkMediumToken,
} from './edges';
export {
  nodeTypes,
  NODE_KIND_LIST,
  NODE_KINDS,
  NODE_STATE_LIST,
  NODE_STATES,
  nodeKindToken,
  nodeStateToken,
  type NodeFamily,
  type NodeKindToken,
  type NodeStateToken,
} from './nodes';
