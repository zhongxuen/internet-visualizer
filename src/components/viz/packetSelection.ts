'use client';

import { createContext, useContext } from 'react';

/**
 * How a packet chip tells the canvas it was clicked.
 *
 * `LinkEdge` renders the sprites, but React Flow hands an edge component only its `data`
 * — there is no prop channel from the canvas down to an edge. The alternative, putting a
 * callback inside the edge data, would make `toFlowEdges` impure and change the identity
 * of every edge's data whenever the handler is re-created. A context keeps the mapping
 * function a plain data transform and leaves the wiring where it belongs.
 *
 * `null` means nothing is listening: sprites still render and are still focusable, they
 * simply do not change a selection that no one owns.
 */
export const PacketSelectionContext = createContext<((pduId: string) => void) | null>(
  null,
);

export function usePacketSelect(): ((pduId: string) => void) | null {
  return useContext(PacketSelectionContext);
}
