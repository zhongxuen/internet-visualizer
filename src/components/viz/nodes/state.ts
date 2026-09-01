/**
 * How a `NodeState` is drawn.
 *
 * The hard rule for this table (docs/implementation/04-visualization-layer.md, and the
 * "never encode meaning in colour alone" rule in `src/styles/tokens.css`) is that state
 * is carried **three** ways at once:
 *
 *   1. `colour`  — the state token, for the fast pre-attentive read.
 *   2. `icon`    — a distinct silhouette: hollow ring, gear, bolt, triangle.
 *   3. `label`   — the word, printed on the node.
 *
 * plus `outline`, which changes the *shape* of the node's edge (hairline, dashed,
 * doubled, haloed) so the state survives greyscale, a projector, and colour blindness
 * even at a zoom level where the chip text is unreadable.
 *
 * Outline rather than border: the frame keeps a constant border width, so a node does
 * not resize — and the diagram does not reflow — when its state changes.
 */

import { AlertTriangle, Circle, Cog, Zap, type LucideIcon } from 'lucide-react';

import type { NodeState } from '@/core/types/events';

export interface NodeStateToken {
  state: NodeState;
  /** The word printed in the state chip. */
  label: string;
  /** One line for the legend and the accessible node description. */
  description: string;
  icon: LucideIcon;
  /** Chip text/border classes — token utilities, never a literal colour. */
  chip: string;
  /**
   * The node frame's outline: the non-colour half of the signal. Width and style both
   * change, so the four states stay distinguishable in greyscale.
   *
   * Outline rather than border, and outline rather than a box-shadow ring: the ring is
   * spent on *selection* (`NodeShell`), and the two must be able to show at once --
   * an active node that the user has clicked has to look like both.
   */
  outline: string;
}

export const NODE_STATES: Record<NodeState, NodeStateToken> = {
  idle: {
    state: 'idle',
    label: 'Idle',
    description: 'Doing nothing right now.',
    icon: Circle,
    chip: 'border-state-pending/40 text-state-pending',
    outline: 'outline-1 outline-border',
  },
  processing: {
    state: 'processing',
    label: 'Working',
    description: 'Busy with something that takes time — a lookup, a check, a decision.',
    icon: Cog,
    chip: 'border-state-warn/50 text-state-warn',
    outline: 'outline-2 outline-dashed outline-state-warn',
  },
  active: {
    state: 'active',
    label: 'Active',
    description: 'The focus of the story — watch this one.',
    icon: Zap,
    chip: 'border-accent/50 text-accent',
    outline: 'outline-2 outline-accent',
  },
  error: {
    state: 'error',
    label: 'Error',
    description: 'Something failed here: a rejection, a timeout, a bad validation.',
    icon: AlertTriangle,
    chip: 'border-state-error/50 text-state-error',
    outline: 'outline-[3px] outline-double outline-state-error',
  },
};

/** Every state in escalating order, for the canvas legend. */
export const NODE_STATE_LIST: readonly NodeStateToken[] = [
  NODE_STATES.idle,
  NODE_STATES.processing,
  NODE_STATES.active,
  NODE_STATES.error,
];

export function nodeStateToken(state: NodeState): NodeStateToken {
  return NODE_STATES[state];
}
