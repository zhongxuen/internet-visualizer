/**
 * The React Flow shapes the canvas works in.
 *
 * The domain model (`Topology`, `SimNode`, `SimLink`) is carried **by value** inside
 * `data` rather than flattened into React Flow fields. Node and edge components then
 * read the same `SimNode` the simulation reads, so an address on screen cannot disagree
 * with the address in the scenario, and adding a field to `SimNode` needs no change
 * here.
 */

import type { Edge, Node } from '@xyflow/react';

import type { NodeState } from '@/core/types/events';
import type { PDU } from '@/core/types/pdu';
import type { NodeKind, SimLink, SimNode } from '@/core/types/topology';

export interface TopologyNodeData extends Record<string, unknown> {
  /** The machine itself, verbatim from the `Topology`. */
  node: SimNode;
  /**
   * Highlight state at the instant being rendered. `'idle'` for a static topology;
   * phase 04's playback feeds this from `VisualState.nodeStates`.
   */
  state: NodeState;
}

/** React Flow node type === `NodeKind`, so a module can override one kind's renderer. */
export type TopologyFlowNode = Node<TopologyNodeData, NodeKind>;

/**
 * A PDU riding a link at the instant being rendered.
 *
 * Resolved by `toFlowEdges` from `VisualState.inFlight` so the edge component never has
 * to look a PDU up or work out which way round the packet is going: `reversed` is already
 * decided against the direction the link is drawn in.
 */
export interface EdgePacket {
  pdu: PDU;
  /** How far across, `0` at departure to `1` at arrival. */
  progress: number;
  /** The packet left the link's `to` node, so it walks the drawn path backwards. */
  reversed: boolean;
  selected: boolean;
}

export interface LinkEdgeData extends Record<string, unknown> {
  /** The link itself, verbatim from the `Topology`. */
  link: SimLink;
  /** Endpoint labels, resolved once so the edge never has to look nodes up. */
  fromLabel: string;
  toLabel: string;
  /** Packets on this link right now, in the order the simulation emitted them. */
  packets?: EdgePacket[];
}

export type LinkFlowEdge = Edge<LinkEdgeData, 'link'>;

/**
 * What the canvas currently has selected.
 *
 * `id` is a `SimNode.id`, a `SimLink.id`, or a `PDU.id` -- one selection concept for all
 * three, because the inspector shows one thing at a time and clicking a packet has to
 * clear the node that was selected before it.
 */
export interface CanvasSelection {
  type: 'node' | 'link' | 'pdu';
  id: string;
}

export function isSameSelection(
  a: CanvasSelection | null,
  b: CanvasSelection | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.type === b.type && a.id === b.id;
}
