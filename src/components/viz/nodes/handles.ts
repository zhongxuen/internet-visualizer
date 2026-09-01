/**
 * Connection anchors.
 *
 * Every node carries a source and a target handle on all four sides; `graph.ts` picks
 * which pair a given link uses from the relative position of its endpoints, so an edge
 * leaves the side it is actually heading towards instead of always leaving to the right.
 *
 * Handles are anchors only — the canvas sets `nodesConnectable={false}`. Nothing in this
 * product lets a user rewire a topology by dragging.
 */

export const HANDLE_SIDES = ['top', 'right', 'bottom', 'left'] as const;

export type HandleSide = (typeof HANDLE_SIDES)[number];

export function sourceHandleId(side: HandleSide): string {
  return `source-${side}`;
}

export function targetHandleId(side: HandleSide): string {
  return `target-${side}`;
}

/** The side directly across from `side`, used to aim the far end of a link. */
export const OPPOSITE_SIDE: Record<HandleSide, HandleSide> = {
  top: 'bottom',
  right: 'left',
  bottom: 'top',
  left: 'right',
};
