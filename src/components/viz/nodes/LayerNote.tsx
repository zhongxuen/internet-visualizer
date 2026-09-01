import { Badge } from '@/components/ui';

import { nodeKindToken } from './kinds';
import type { NodeKindToken } from './kinds';

/**
 * "What this machine does, and at which layer" — the one line of teaching every node
 * carries.
 *
 * A switch forwarding frames at L2 and a router forwarding packets at L3 look almost
 * identical on a diagram; the layer badge is what makes the difference visible before
 * anyone opens the inspector. Colour comes from `Badge`'s layer palette, which always
 * prints the `L2`..`L7` short label beside it, so the distinction survives without it.
 */
export interface LayerNoteProps {
  kind: NodeKindToken['kind'];
}

export function LayerNote({ kind }: LayerNoteProps) {
  const token = nodeKindToken(kind);

  return (
    <Badge layer={token.layer} className="w-fit px-1.5 py-0 text-[0.625rem]">
      {token.layerAction}
    </Badge>
  );
}
