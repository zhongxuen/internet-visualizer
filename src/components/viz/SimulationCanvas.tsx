'use client';

import '@xyflow/react/dist/style.css';

import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  ReactFlow,
  useReactFlow,
  type EdgeChange,
  type NodeChange,
  type NodeOrigin,
} from '@xyflow/react';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

import { useReducedMotionSafe } from '@/components/motion';

import type { InFlightPacket } from '@/core/sim/project';

import type { NodeState } from '@/core/types/events';

import type { PDU } from '@/core/types/pdu';

import type { Topology } from '@/core/types/topology';

import { cn } from '@/lib/cn';

import { edgeTypes } from './edges';

import { toFlowEdges, toFlowNodes } from './graph';

import { layoutTopology, type XY } from './layout';

import { nodeTypes } from './nodes';

import { PacketSelectionContext } from './packetSelection';

import { isSameSelection, type CanvasSelection } from './types';

/**

 * The diagram surface: a `Topology` drawn as machines and links you can pan, zoom, click,

 * and tab through.

 *

 * This component renders a network; it does not run one. It takes a topology and an

 * optional map of node states and draws that instant -- no clock, no timers, no

 * animation. Phase 04's playback drives it by feeding `nodeStates` from `projectAt`,

 * which is why "what is on screen" stays a pure function of virtual time and scrubbing

 * backwards costs nothing.

 *

 * ## Colour

 *

 * Every colour on the canvas resolves to a token in `src/styles/tokens.css`, including

 * React Flow's own: the `--xy-*` custom properties it styles itself with are rebound

 * below rather than left at the library's greys. Nothing here contains a literal colour.

 *

 * ## Keyboard and pointer

 *

 * Nodes and edges are React Flow's own tab stops: `Tab` moves between them, `Enter` or

 * `Space` selects, `Escape` clears. Selection is reported through `onSelect` whichever

 * way it happened, so a caller never has to care whether the user clicked or typed.

 * Dragging is off -- a topology is a fact about a network, not a canvas to rearrange --

 * so a drag pans the view instead.

 */

/** Read as CSS variables by the library's `--xy-*`-styled internals; see the note above. */

const CANVAS_TOKENS = {
  '--xy-background-color': 'var(--bg-base)',

  '--xy-edge-stroke': 'var(--border-strong)',

  '--xy-edge-stroke-selected': 'var(--accent)',

  '--xy-handle-background-color': 'transparent',

  '--xy-handle-border-color': 'transparent',

  '--xy-controls-button-background-color': 'var(--bg-raised)',

  '--xy-controls-button-background-color-hover': 'var(--bg-overlay)',

  '--xy-controls-button-color': 'var(--text-secondary)',

  '--xy-controls-button-color-hover': 'var(--text-primary)',

  '--xy-controls-button-border-color': 'var(--border)',

  '--xy-controls-box-shadow': 'none',

  '--xy-attribution-background-color': 'transparent',

  '--xy-selection-background-color':
    'color-mix(in oklab, var(--accent) 12%, transparent)',

  '--xy-selection-border': '1px dotted var(--accent)',
} as CSSProperties;

/** Positions from `layout.ts` are node centres, which is what edges want to aim at. */

const NODE_ORIGIN: NodeOrigin = [0.5, 0.5];

/** Generous padding: the diagram should never touch the panel edge at any zoom. */

const FIT_VIEW_OPTIONS = { padding: 0.18, maxZoom: 1.2 } as const;

type SelectChange = { type: 'select'; id: string; selected: boolean };

function isSelectChange(change: { type: string }): change is SelectChange {
  return change.type === 'select';
}

/**

 * Fold a batch of React Flow changes into our single selection.

 *

 * React Flow reports a click as "select this, unselect those" in one batch, so a

 * selection anywhere in the batch wins and an unselect only clears if it names the thing

 * that is currently selected -- otherwise a stale unselect for the previous element would

 * wipe out the new one.

 */

function selectionFromChanges(
  changes: readonly { type: string }[],

  kind: CanvasSelection['type'],

  current: CanvasSelection | null,
): CanvasSelection | null {
  let cleared = false;

  for (const change of changes) {
    if (!isSelectChange(change)) continue;

    if (change.selected) return { type: kind, id: change.id };

    if (current?.type === kind && current.id === change.id) cleared = true;
  }

  return cleared ? null : current;
}

/** Joins ids into one dependency string. A `SimNode.id` never contains a comma. */
const SEPARATOR = ',';

/** Padding used when the view is asked to close in on a handful of machines. */

const FOCUS_VIEW_OPTIONS = { padding: 0.4, maxZoom: 1.35 } as const;

/**

 * Moves the viewport onto a named set of machines.

 *

 * Rendered inside `<ReactFlow>` because `useReactFlow` only exists there, and it draws

 * nothing: it is the one place the canvas is imperative, because "where the camera is

 * pointing" is genuinely not derivable from virtual time -- a guided tour decides it.

 *

 * The dependency is the joined id list rather than the array, so a caller passing a fresh

 * array of the same ids on every render does not re-aim the camera on every render. An

 * empty list means "no opinion": the view is left exactly where the user put it, except

 * on the transition back from a non-empty list, which returns to the whole diagram.

 */

function ViewportFocus({ nodeIds }: { nodeIds?: readonly string[] }) {
  const { fitView } = useReactFlow();

  const { scale } = useReducedMotionSafe();

  const key = nodeIds?.join(SEPARATOR) ?? '';

  const hadFocus = useRef(false);

  useEffect(() => {
    if (!key) {
      // Nothing to aim at. Only refit if we were aimed at something a moment ago --

      // otherwise this would fight React Flow's own `fitView` on mount.

      if (!hadFocus.current) return;

      hadFocus.current = false;

      void fitView({ ...FIT_VIEW_OPTIONS, duration: scale(400) });

      return;
    }

    hadFocus.current = true;

    void fitView({
      ...FOCUS_VIEW_OPTIONS,

      nodes: key.split(SEPARATOR).map((id) => ({ id })),

      // `scale` returns 0 under reduced motion, which React Flow reads as "jump there".

      duration: scale(500),
    });
  }, [fitView, key, scale]);

  return null;
}

export interface SimulationCanvasProps {
  topology: Topology;

  /**

   * Highlight state per `SimNode.id`; anything absent is `'idle'`. Memoize it -- a fresh

   * object every render makes React Flow re-adopt every node.

   */

  nodeStates?: Readonly<Record<string, NodeState>>;

  /**

   * Packets on the wire at the instant being rendered, straight from

   * `VisualState.inFlight`. Each one is drawn on its link at its own `progress`; the

   * canvas still owns no clock, so a new instant is a new prop.

   */

  inFlight?: readonly InFlightPacket[];

  /** Every PDU the run created, keyed by id — `SimResult.pdus`. Needed to draw packets. */

  pdus?: Readonly<Record<string, PDU>>;

  /**

   * Explicit node centres, keyed by `SimNode.id`. Omit to use the breadth-first layout

   * in `./layout.ts`, which places one column per hop from the client.

   */

  positions?: Readonly<Record<string, XY>>;

  /** Controlled selection. Omit to let the canvas own it and just listen to `onSelect`. */

  selection?: CanvasSelection | null;

  /** Starting selection when the canvas owns it. */

  defaultSelection?: CanvasSelection | null;

  /** Fired on every selection change, however it was made. `null` when cleared. */

  onSelect?: (selection: CanvasSelection | null) => void;

  /**

   * Machines to bring into view. Changing the set pans and zooms onto them; emptying it

   * returns to the whole diagram. Omit unless something is driving the camera -- a guided

   * tour, a "show me this hop" link -- because the default fit-to-view is already right.

   */

  focusNodeIds?: readonly string[];

  /** Accessible name of the diagram region. */

  label?: string;

  className?: string;
}

export function SimulationCanvas({
  topology,

  nodeStates,

  inFlight,

  pdus,

  positions: positionsProp,

  selection: selectionProp,

  defaultSelection = null,

  onSelect,

  focusNodeIds,

  label = 'Network topology',

  className,
}: SimulationCanvasProps) {
  const [ownSelection, setOwnSelection] = useState<CanvasSelection | null>(
    defaultSelection,
  );

  const controlled = selectionProp !== undefined;

  const selection = controlled ? selectionProp : ownSelection;

  /**

   * The live selection, readable from a change handler.

   *

   * A single click produces two synchronous React Flow batches -- "select node A", then

   * "unselect edge E" -- with no render in between. Reading `selection` from the closure

   * would make the second batch clear what the first just chose, so `applySelection`

   * writes here as it goes and the effect only resyncs when the value arrives from

   * outside (a controlled `selection` prop changing under us).

   */

  const selectionRef = useRef(selection);

  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  const applySelection = useCallback(
    (next: CanvasSelection | null) => {
      if (isSameSelection(selectionRef.current, next)) return;

      selectionRef.current = next;

      if (!controlled) setOwnSelection(next);

      onSelect?.(next);
    },

    [controlled, onSelect],
  );

  const positions = useMemo(
    () => positionsProp ?? layoutTopology(topology),

    [positionsProp, topology],
  );

  const selectedNodeId = selection?.type === 'node' ? selection.id : null;

  const selectedLinkId = selection?.type === 'link' ? selection.id : null;

  const selectedPduId = selection?.type === 'pdu' ? selection.id : null;

  const nodes = useMemo(
    () => toFlowNodes(topology, positions, { nodeStates, selectedNodeId }),

    [topology, positions, nodeStates, selectedNodeId],
  );

  const edges = useMemo(
    () =>
      toFlowEdges(topology, positions, { selectedLinkId, inFlight, pdus, selectedPduId }),

    [topology, positions, selectedLinkId, inFlight, pdus, selectedPduId],
  );

  // Selecting a packet clears whatever node or link was selected before it: the inspector

  // shows one thing at a time, and `selected` flows back into the nodes and edges above.

  const selectPacket = useCallback(
    (pduId: string) => applySelection({ type: 'pdu', id: pduId }),

    [applySelection],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      applySelection(selectionFromChanges(changes, 'node', selectionRef.current));
    },

    [applySelection],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      applySelection(selectionFromChanges(changes, 'link', selectionRef.current));
    },

    [applySelection],
  );

  const clearSelection = useCallback(() => applySelection(null), [applySelection]);

  return (
    <div
      role="region"

      aria-label={label}

      style={CANVAS_TOKENS}

      className={cn(
        'bg-surface border-border relative h-full min-h-0 w-full overflow-hidden rounded-xl border',

        className,
      )}
    >
      <PacketSelectionContext value={selectPacket}>
        <ReactFlow
          nodes={nodes}

          edges={edges}

          nodeTypes={nodeTypes}

          edgeTypes={edgeTypes}

          onNodesChange={handleNodesChange}

          onEdgesChange={handleEdgesChange}

          onPaneClick={clearSelection}

          nodeOrigin={NODE_ORIGIN}

          // The product is dark unconditionally (globals.css), so React Flow must not

          // pick its own light defaults for the few things the tokens above do not cover.

          colorMode="dark"

          // Handles are anchors on all four sides; loose mode lets a link attach to

          // whichever one faces the far end without caring about source/target roles.

          connectionMode={ConnectionMode.Loose}

          nodesDraggable={false}

          nodesConnectable={false}

          nodesFocusable

          edgesFocusable

          edgesReconnectable={false}

          elementsSelectable

          selectionOnDrag={false}

          panOnDrag

          // Two-finger scroll pans and pinch (or ctrl + wheel) zooms -- the gesture set a

          // trackpad user expects from a map, and it leaves a plain wheel alone.

          panOnScroll

          zoomOnScroll={false}

          zoomOnDoubleClick={false}

          minZoom={0.25}

          maxZoom={2}

          fitView

          fitViewOptions={FIT_VIEW_OPTIONS}

          attributionPosition="bottom-left"
        >
          <ViewportFocus nodeIds={focusNodeIds} />

          <Background variant={BackgroundVariant.Dots} gap={26} size={1} />

          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
      </PacketSelectionContext>
    </div>
  );
}
