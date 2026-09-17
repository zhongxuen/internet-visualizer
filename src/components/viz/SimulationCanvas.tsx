'use client';

import '@xyflow/react/dist/style.css';

import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  Panel,
  ReactFlow,
  useReactFlow,
  useStore,
  useStoreApi,
  type EdgeChange,
  type NodeChange,
  type NodeOrigin,
  type ReactFlowState,
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

import { useDetail, type DetailLevel } from '@/components/prefs';

import type { InFlightPacket } from '@/core/sim/project';

import type { NodeState } from '@/core/types/events';

import type { PDU } from '@/core/types/pdu';

import type { Topology } from '@/core/types/topology';

import { cn } from '@/lib/cn';

import { CameraToggle, type CameraMode } from './CameraToggle';

import { CanvasLegend } from './CanvasLegend';

import { DetailContext } from './display';

import { edgeTypes } from './edges';

import { toFlowEdges, toFlowNodes } from './graph';

import {
  boundsOf,
  fitZoom,
  frameRect,
  frameStart,
  isInView,
  layoutTopology,
  readableZoom,
  zoneRects,
  type Rect,
  type Viewport,
  type XY,
} from './layout';

import { nodeTypes } from './nodes';

import { measuredBoxes, ZoneLayer } from './nodes/zones';

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
 * ## Detail level
 *
 * The viewer's Simple / Full detail preference is read here, once, and handed to every
 * node and link through `DetailContext` (`./display.ts`). The canvas only ever renders
 * on the client (`LazyCanvas`), so reading the preference cannot mismatch a server
 * render.
 *
 * ## The camera
 *
 * The camera never zooms out, on its own, past the point where a machine's name renders
 * under 12px (uiux-spec.md §10). When the whole map fits at that zoom it shows the whole
 * map. When it does not -- every long path in the product -- it **follows the action**:
 * it frames the machines that are working and the link a packet is on, and leaves the
 * view alone while those are already comfortably on screen. `CameraToggle`, in the
 * corner, swaps to the overview ("Show whole map") and back. The overview is the one
 * framing allowed below the readable zoom, because the viewer asked for it.
 *
 * The camera moves only when what it frames changes: the node states (whose identity
 * changes only when `projectionKey` does) or the set of packets on the wire (held still
 * by `useSteadyPackets`). Never per frame -- a packet crossing a link moves itself
 * (`PacketSprite`), and the camera does not chase it. Under reduced motion every move is
 * a jump.
 *
 * A module can still aim the camera itself with `focusNodeIds` (a guided tour, a lesson's
 * `focus`), which wins over both modes while it is set.
 *
 * ## Keyboard and pointer
 *
 * Nodes and edges are React Flow's own tab stops: `Tab` moves between them, `Enter` or
 * `Space` selects, `Escape` clears. Selection is reported through `onSelect` whichever
 * way it happened, so a caller never has to care whether the user clicked or typed.
 * Dragging is off -- a topology is a fact about a network, not a canvas to rearrange --
 * so a drag pans the view instead. Zone backdrops take no focus and no pointer.
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

/** Clear space, in screen pixels, the camera keeps between what it frames and the edge. */
const CAMERA_PADDING = 28;

/** The furthest out a pinch or the zoom buttons can go. The camera itself never does. */
const MIN_ZOOM = 0.25;

/** How close each framing is allowed to come: whole map, following, a module's focus. */
const MAX_ZOOM = { whole: 1.2, follow: 1, focus: 1.35 } as const;

/** How long a camera move takes, before reduced motion turns it into a jump. */
const CAMERA_MS = 500;

/**
 * The name on a node card, in rem: `text-body` in Simple, `text-sm` in Full detail
 * (`nodes/NodeShell.tsx`). Change one there, change it here.
 */
const LABEL_REM: Record<DetailLevel, number> = { simple: 1, full: 0.875 };

/** The rendered size of a node's name, including the "Large text" preference. */
function labelPx(detail: DetailLevel): number {
  const root =
    typeof document === 'undefined'
      ? 16
      : parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return LABEL_REM[detail] * root;
}

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

/**
 * The machines the story is about right now: every node that is working, active or in
 * trouble, and both ends of every link a packet is on. Sorted and joined, so the same set
 * reached by a different route is the same string -- and an unchanged string is no move.
 */
export function actionKeyOf(
  topology: Topology,
  nodeStates: Readonly<Record<string, NodeState>> | undefined,
  inFlight: readonly InFlightPacket[] | undefined,
): string {
  const ids = new Set<string>();
  for (const node of topology.nodes) {
    const state = nodeStates?.[node.id];
    if (state !== undefined && state !== 'idle') ids.add(node.id);
  }
  for (const packet of inFlight ?? []) {
    ids.add(packet.from);
    ids.add(packet.to);
  }
  return [...ids].sort().join(SEPARATOR);
}

interface CameraProps {
  topology: Topology;
  /** `auto` resolves to `whole` when the map fits readably and `follow` when it does not. */
  mode: CameraMode | 'auto';
  /** A module's `focusNodeIds`, joined. Wins while it is non-empty. */
  focusKey: string;
  /** {@link actionKeyOf}. */
  actionKey: string;
  detail: DetailLevel;
  /** Told which mode `auto` became, so the toggle can offer the other one. */
  onResolve: (mode: CameraMode) => void;
}

/**
 * Whether React Flow has measured every node it holds.
 *
 * Not `useNodesInitialized()`: that reads a flag React Flow only sets when measured sizes
 * are written back into the `nodes` prop, and this canvas never does -- its nodes are a
 * pure function of the topology and the instant. The measurement itself lands in the
 * store's internals either way, and that is what this reads.
 */
function allMeasured(state: ReactFlowState): boolean {
  if (state.nodeLookup.size === 0) return false;
  for (const node of state.nodeLookup.values()) {
    if (node.internals.handleBounds === undefined || node.measured.width === undefined) {
      return false;
    }
  }
  return true;
}

function boxesFor(ids: readonly string[], boxes: ReadonlyMap<string, Rect>): Rect[] {
  return ids.map((id) => boxes.get(id)).filter((box): box is Rect => box !== undefined);
}

/**
 * Moves the viewport. Rendered inside `<ReactFlow>` because the store only exists there,
 * and it draws nothing: it is the one place the canvas is imperative, because "where the
 * camera is pointing" is not a function of virtual time. See "The camera" above.
 *
 * Every decision is made from React Flow's *measured* boxes, so a framing fits the cards
 * as drawn. `aimed` remembers what the last move was aimed at; an effect that re-runs
 * with the same target -- a resize to the same size, the action set going quiet at the
 * end of a run -- moves nothing.
 */
function Camera({ topology, mode, focusKey, actionKey, detail, onResolve }: CameraProps) {
  const store = useStoreApi();
  const { setViewport, getViewport } = useReactFlow();
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  const initialized = useStore(allMeasured);
  const { scale } = useReducedMotionSafe();

  /** The last non-empty action set, so a quiet moment keeps the camera where it was. */
  const lastAction = useRef('');
  const aimed = useRef<string | null>(null);

  useEffect(() => {
    // A new topology is a new picture: forget the old one's framing.
    lastAction.current = '';
    aimed.current = null;
  }, [topology]);

  useEffect(() => {
    if (!initialized || width <= 0 || height <= 0) {
      aimed.current = null;
      return;
    }

    const boxes = measuredBoxes(store.getState());
    // Nodes from the previous topology can still be in the store for a render.
    if (topology.nodes.some((node) => !boxes.has(node.id))) return;

    const zones = zoneRects(topology, boxes);
    const whole = boundsOf([...boxes.values(), ...zones]);
    if (!whole) return;

    const minZoom = readableZoom(labelPx(detail));
    const fits = fitZoom(whole, width, height, CAMERA_PADDING) >= minZoom;
    const resolved: CameraMode = mode === 'auto' ? (fits ? 'whole' : 'follow') : mode;
    onResolve(resolved);

    if (actionKey) lastAction.current = actionKey;
    const target = focusKey
      ? `focus:${focusKey}`
      : resolved === 'whole'
        ? 'whole'
        : `follow:${lastAction.current || 'start'}`;
    const key = `${target}|${width}x${height}|${detail}`;
    if (aimed.current === key) return;

    const first = aimed.current === null;
    aimed.current = key;

    let viewport: Viewport | null = null;
    if (focusKey) {
      const rect = boundsOf(boxesFor(focusKey.split(SEPARATOR), boxes));
      if (rect) {
        viewport = frameRect(rect, width, height, {
          minZoom,
          maxZoom: MAX_ZOOM.focus,
          padding: CAMERA_PADDING * 2,
        });
      }
    } else if (resolved === 'whole') {
      viewport = frameRect(whole, width, height, {
        // Only an overview the viewer asked for may go below the readable zoom.
        minZoom: fits ? minZoom : MIN_ZOOM,
        maxZoom: MAX_ZOOM.whole,
        padding: CAMERA_PADDING,
      });
    } else if (lastAction.current) {
      const rect = boundsOf(boxesFor(lastAction.current.split(SEPARATOR), boxes));
      const current = getViewport();
      const settled =
        !first &&
        rect !== null &&
        current.zoom >= minZoom &&
        isInView(rect, current, width, height, CAMERA_PADDING);
      if (rect && !settled) {
        viewport = frameRect(rect, width, height, {
          minZoom,
          maxZoom: MAX_ZOOM.follow,
          padding: CAMERA_PADDING * 2,
        });
      }
    } else {
      // Nothing has happened yet: show where the story starts -- the first place on the
      // map, or the start of a map that has no places.
      const firstZone = topology.zones?.[0]?.id;
      const opening = firstZone
        ? topology.nodes.filter((node) => node.zone === firstZone).map((node) => node.id)
        : [];
      const rect = boundsOf(
        opening.length
          ? [...boxesFor(opening, boxes), ...zones.filter((z) => z.zone.id === firstZone)]
          : [...boxes.values()],
      );
      if (rect) {
        viewport = frameStart(rect, width, height, {
          minZoom,
          maxZoom: MAX_ZOOM.whole,
          padding: CAMERA_PADDING,
        });
      }
    }

    if (viewport) {
      // `scale` returns 0 under reduced motion, which React Flow reads as "jump there".
      void setViewport(viewport, { duration: first ? 0 : scale(CAMERA_MS) });
    }
  }, [
    initialized,
    width,
    height,
    topology,
    mode,
    focusKey,
    actionKey,
    detail,
    store,
    setViewport,
    getViewport,
    scale,
    onResolve,
  ]);

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
   * Explicit node centres, keyed by `SimNode.id`. Omit to use the layout in
   * `./layout.ts`: by zone, then one column per hop from the client.
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
   * hands the camera back to its own mode. Omit unless something is driving the camera --
   * a guided tour, a "show me this hop" link.
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
  const detail = useDetail();

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

  /*
    The camera's inputs, as strings: identical sets make identical strings, so the camera
    effect re-runs only when what it would frame has actually changed. `nodeStates` and
    `inFlight` already hold their identity between events; this makes the rest of the
    comparison by value.
  */
  const actionKey = useMemo(
    () => actionKeyOf(topology, nodeStates, inFlight),
    [topology, nodeStates, inFlight],
  );

  const focusKey = focusNodeIds?.join(SEPARATOR) ?? '';

  const [cameraMode, setCameraMode] = useState<CameraMode | 'auto'>('auto');

  const [resolvedMode, setResolvedMode] = useState<CameraMode>('whole');

  // What `auto` became once measured; an explicit choice is shown as soon as it is made.
  const shownMode = cameraMode === 'auto' ? resolvedMode : cameraMode;

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
      <DetailContext value={detail}>
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
            minZoom={MIN_ZOOM}
            maxZoom={2}
            // No `fitView`: the camera below decides the first framing too, so the
            // diagram never opens at an unreadable zoom and then jumps.
            attributionPosition="bottom-left"
          >
            <Camera
              topology={topology}
              mode={cameraMode}
              focusKey={focusKey}
              actionKey={actionKey}
              detail={detail}
              onResolve={setResolvedMode}
            />

            <ZoneLayer topology={topology} />

            <Background variant={BackgroundVariant.Dots} gap={26} size={1} />

            <Panel position="top-right" className="flex items-center gap-2">
              <CanvasLegend topology={topology} detail={detail} />

              <CameraToggle mode={shownMode} onChange={setCameraMode} />
            </Panel>

            <Controls showInteractive={false} position="bottom-right" />
          </ReactFlow>
        </PacketSelectionContext>
      </DetailContext>
    </div>
  );
}
