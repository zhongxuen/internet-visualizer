'use client';

import { Crosshair, Map as MapIcon } from 'lucide-react';

import { Button } from '@/components/ui';

/**
 * What the camera is doing (uiux-spec.md §5.4, "Where am I").
 *
 * - `whole` -- the whole map in view. The default whenever it fits at a zoom where every
 *   machine's name is still readable.
 * - `follow` -- the camera frames whatever is happening now: the machines that are
 *   working, and the link a packet is on. The default when the whole map would only fit
 *   with names too small to read, which is every long path in the product.
 */
export type CameraMode = 'whole' | 'follow';

export interface CameraToggleProps {
  /** The mode in force now. The button offers the other one. */
  mode: CameraMode;
  onChange: (mode: CameraMode) => void;
}

/**
 * The one control that swaps between the two, in the canvas corner.
 *
 * A labelled 44px button rather than an icon: "Show whole map" is the way back to the
 * overview for someone who has never used a map with a camera that moves on its own, and
 * a lone crosshair would not tell them that. The label names what pressing it will do.
 *
 * `nodrag nopan` because it sits inside React Flow's surface, where a press would
 * otherwise start a pan and the click would never land.
 */
export function CameraToggle({ mode, onChange }: CameraToggleProps) {
  const following = mode === 'follow';
  return (
    <Button
      variant="secondary"
      size="md"
      className="nodrag nopan shadow-lg"
      icon={
        following ? (
          <MapIcon className="size-4" strokeWidth={2} />
        ) : (
          <Crosshair className="size-4" strokeWidth={2} />
        )
      }
      onClick={() => onChange(following ? 'whole' : 'follow')}
    >
      {following ? 'Show whole map' : 'Follow the action'}
    </Button>
  );
}
