'use client';

import { createContext, useContext } from 'react';

/**
 * Display preferences that have to cross the canvas.
 *
 * A module composes `SimulationView`, which owns the canvas, which owns the React Flow
 * tree that renders every node and edge. There is no prop channel from a module down to
 * an individual node card — and adding one would mean threading a display preference
 * through `toFlowNodes`, into `data`, and out again in five node components, changing the
 * identity of every node's data whenever a checkbox is ticked.
 *
 * These are contexts for the same reason `packetSelection.ts` is: they carry a *view*
 * decision, not domain data. Nothing here changes what the scenario says — a hidden
 * address is still in the `SimNode`, and a dimmed machine is still on the diagram, still
 * clickable, and still in the tab order.
 *
 * Both default to "show everything", so a view that sets neither behaves exactly as it
 * did before they existed.
 */

/**
 * Whether address rows are drawn on the node cards.
 *
 * The canvas is where a scenario overloads a newcomer: thirteen cards, each with three
 * monospace rows of numbers, before they know what any of it means. Turning this off
 * empties the diagram of addressing without removing it from the product — the inspector
 * renders its `AddressList` with `always`, so clicking a machine still answers "what is
 * this thing's address?" on demand.
 */
export const AddressVisibilityContext = createContext(true);

export function useAddressVisibility(): boolean {
  return useContext(AddressVisibilityContext);
}

/** Node ids to draw de-emphasised. Empty means nothing is dimmed. */
const NO_DIMMED: ReadonlySet<string> = new Set();

/**
 * Machines the viewer has pushed into the background — the Network Map's layer filter,
 * and anything later that wants to say "look at these, not those".
 *
 * Dimming is opacity and nothing else: a dimmed node keeps its focus ring, its click
 * target, and its place in the tab order, because a filter is a way of reading a diagram,
 * not a way of editing one. A selected node is never dimmed, so clicking into the
 * background brings that one machine back.
 */
export const DimmedNodesContext = createContext<ReadonlySet<string>>(NO_DIMMED);

export function useDimmedNodes(): ReadonlySet<string> {
  return useContext(DimmedNodesContext);
}
