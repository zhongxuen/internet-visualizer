/**
 * `Topology` -> React Flow.
 *
 * The one place the domain model is translated into the rendering library's shapes. Kept
 * out of `SimulationCanvas` so the mapping — which handle a link leaves from, what a
 * screen reader hears, which node type renders which kind — is a pure function that can
 * be tested without mounting a canvas.
 */

import type { InFlightPacket } from '@/core/sim/project';
import type { NodeState } from '@/core/types/events';
import type { PDU } from '@/core/types/pdu';
import type { SimLink, SimNode, Topology } from '@/core/types/topology';

import { NODE_HEIGHT, NODE_WIDTH, type XY } from './layout';
import { nodeKindToken } from './nodes/kinds';
import {
  OPPOSITE_SIDE,
  sourceHandleId,
  targetHandleId,
  type HandleSide,
} from './nodes/handles';
import { nodeStateToken } from './nodes/state';
import { linkMediumToken } from './edges/media';
import type { EdgePacket, LinkFlowEdge, TopologyFlowNode } from './types';

/**
 * The side a link should leave from, given where the far end is.
 *
 * Picking the facing side rather than always leaving to the right keeps edges from
 * crossing back over the node they came from, which is most of what makes an
 * auto-arranged diagram look hand-drawn or look wrong.
 */
export function departureSide(from: XY, to: XY): HandleSide {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

/**
 * What a screen reader hears for a machine.
 *
 * Everything the sighted user gets from the card, in the same order: what it is, what it
 * is called, what it is doing, and the addresses it answers to. State is spelled out
 * because it is the thing that changes during playback.
 */
export function describeNode(node: SimNode, state: NodeState): string {
  const kind = nodeKindToken(node.kind);
  const addresses = [
    node.ipv4 && `IPv4 ${node.ipv4}`,
    node.ipv6 && `IPv6 ${node.ipv6}`,
    node.mac && `MAC ${node.mac}`,
  ].filter(Boolean);

  return [
    `${kind.roleLabel}: ${node.label}`,
    nodeStateToken(state).label,
    ...addresses,
  ].join('. ');
}

/** What a screen reader hears for a link: both ends, then the hop's cost. */
export function describeLink(link: SimLink, fromLabel: string, toLabel: string): string {
  const medium = linkMediumToken(link.medium);

  return [
    `Link from ${fromLabel} to ${toLabel}`,
    medium?.label,
    `${link.latencyMs} ms one-way latency`,
    link.bandwidthMbps === undefined ? null : `${link.bandwidthMbps} megabits per second`,
  ]
    .filter(Boolean)
    .join('. ');
}

/**
 * Classes React Flow puts on the wrapper it owns, not on our components.
 *
 * `NODE_FOCUS_RING` is `!important` on purpose. React Flow ships
 * `.react-flow__node.selectable:focus-visible { outline: none }` *unlayered*, which beats
 * the project's base focus ring in `globals.css` no matter what -- an unlayered rule wins
 * over any `@layer`. Forcing the same three declarations back on restores the one
 * tokenised ring the rest of the product uses instead of inventing a second one just for
 * the canvas. Take the `!` off and nodes become invisible to keyboard users.
 */
const NODE_FOCUS_RING =
  'focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-focus!';

/**
 * `group` so `LinkEdge`'s focus halo can react to `:focus-visible` on the wrapper. An
 * edge needs the halo for the same reason -- React Flow clears its outline too, and a
 * recoloured stroke on its own would be colour as the only signal.
 */
const EDGE_GROUP = 'group';

export interface ToFlowOptions {
  /** Highlight state per node id; anything absent is `'idle'`. */
  nodeStates?: Readonly<Record<string, NodeState>>;
  /** The currently selected node id, if a node is selected. */
  selectedNodeId?: string | null;
  /** The currently selected link id, if a link is selected. */
  selectedLinkId?: string | null;
  /** Packets on the wire at this instant, straight from `VisualState.inFlight`. */
  inFlight?: readonly InFlightPacket[];
  /** Every PDU the run created, keyed by id — `SimResult.pdus`. */
  pdus?: Readonly<Record<string, PDU>>;
  /** The currently selected PDU id, if a packet is selected. */
  selectedPduId?: string | null;
}

/**
 * `VisualState.inFlight` -> the packets each edge has to draw.
 *
 * Two translations happen here rather than in a component. A packet is carried by id, so
 * the PDU is resolved once instead of once per render of every sprite; and `progress`
 * measures from the packet's own `from` node, while an edge's path is drawn from the
 * link's `from` node — when those disagree the packet is walking the path backwards, and
 * `reversed` records it. A packet naming a link (or a PDU) the topology does not have is
 * dropped: a sprite with nowhere to be is worse than no sprite.
 */
export function packetsByLink(
  links: readonly SimLink[],
  { inFlight, pdus, selectedPduId }: ToFlowOptions = {},
): Map<string, EdgePacket[]> {
  const byLink = new Map<string, EdgePacket[]>();
  if (!inFlight?.length) return byLink;

  const linkById = new Map(links.map((link) => [link.id, link]));

  for (const packet of inFlight) {
    const link = linkById.get(packet.linkId);
    const pdu = pdus?.[packet.pduId];
    if (!link || !pdu) continue;

    const entry: EdgePacket = {
      pdu,
      progress: packet.progress,
      reversed: packet.from === link.to && packet.to === link.from,
      selected: packet.pduId === selectedPduId,
    };

    const existing = byLink.get(link.id);
    if (existing) existing.push(entry);
    else byLink.set(link.id, [entry]);
  }

  return byLink;
}

export function toFlowNodes(
  topology: Topology,
  positions: Readonly<Record<string, XY>>,
  { nodeStates, selectedNodeId }: ToFlowOptions = {},
): TopologyFlowNode[] {
  return topology.nodes.map((node) => {
    const state = nodeStates?.[node.id] ?? 'idle';

    return {
      id: node.id,
      // The React Flow type *is* the kind, so `nodeTypes` picks the renderer.
      type: node.kind,
      position: positions[node.id] ?? { x: 0, y: 0 },
      data: { node, state },
      // Fixed width keeps the columns aligned; the height is a placeholder the browser
      // replaces once it has measured the card.
      width: NODE_WIDTH,
      initialHeight: NODE_HEIGHT,
      selected: node.id === selectedNodeId,
      selectable: true,
      focusable: true,
      // A topology is a fact about a network, not a canvas the user rearranges.
      draggable: false,
      connectable: false,
      deletable: false,
      className: NODE_FOCUS_RING,
      ariaLabel: describeNode(node, state),
    };
  });
}

export function toFlowEdges(
  topology: Topology,
  positions: Readonly<Record<string, XY>>,
  options: ToFlowOptions = {},
): LinkFlowEdge[] {
  const { selectedLinkId } = options;
  const labels = new Map(topology.nodes.map((node) => [node.id, node.label]));
  const packets = packetsByLink(topology.links, options);

  return topology.links.map((link) => {
    const from = positions[link.from] ?? { x: 0, y: 0 };
    const to = positions[link.to] ?? { x: 0, y: 0 };
    const side = departureSide(from, to);

    const fromLabel = labels.get(link.from) ?? link.from;
    const toLabel = labels.get(link.to) ?? link.to;

    return {
      id: link.id,
      type: 'link',
      source: link.from,
      target: link.to,
      sourceHandle: sourceHandleId(side),
      targetHandle: targetHandleId(OPPOSITE_SIDE[side]),
      data: { link, fromLabel, toLabel, packets: packets.get(link.id) },
      selected: link.id === selectedLinkId,
      selectable: true,
      focusable: true,
      reconnectable: false,
      deletable: false,
      className: EDGE_GROUP,
      ariaLabel: describeLink(link, fromLabel, toLabel),
    };
  });
}
