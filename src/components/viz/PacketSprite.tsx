'use client';

import { ArrowRight } from 'lucide-react';

import type { PDU } from '@/core/types/pdu';
import { useReducedMotionSafe } from '@/components/motion';
import { cn } from '@/lib/cn';
import { getLayer, isLayerKey } from '@/lib/theme';

import type { XY } from './layout';
import { clampProgress, placeAlongPath } from './packetPath';

/**
 * A PDU travelling along a link.
 *
 * **It owns no timer, and it never will.** Position comes in as `progress`, which is a
 * pure function of virtual time (`projectAt`); the sprite turns that number into a point
 * on the curve its `LinkEdge` was drawn with and stops. Pausing mid-hop, scrubbing
 * backwards, and stepping one event at a time are all exact for the same reason: there
 * is no animation in flight that would have to be unwound. A CSS keyframe or a
 * self-driven tween would break all three.
 *
 * Colour is the **outermost** layer, because that is what the PDU is on this wire: a
 * frame carrying an IP packet carrying a DNS query is, right here, a frame. The layer's
 * `L2`..`L7` short label is printed beside the colour, so the layer never depends on
 * colour alone, and the arrow points the way the packet is actually going -- which is
 * the only signal distinguishing a request from the reply crossing the same wire.
 *
 * Under reduced motion the chip sits at whichever end of the link it is nearer to.
 * Nothing is hidden: the packet still appears, still belongs to a link, still comes and
 * goes at the right instants. It simply stops sliding, which is the phase-02 policy
 * ("remove tweening, never content") applied to the one thing on the canvas that moves.
 */

export interface PacketSpriteProps {
  /** The PDU on the wire. Its outermost layer decides the colour and the short label. */
  pdu: PDU;
  /** How far along the link, `0`..`1`. Clamped; anything non-finite parks it at the start. */
  progress: number;
  /**
   * The `d` of the path the link was drawn with, so the packet rides the wire rather
   * than the chord. Omit and it falls back to the straight line `from` -> `to`.
   */
  path?: string;
  /** Endpoints of the link in flow space, in the direction the *edge* is drawn. */
  from: XY;
  to: XY;
  /**
   * The packet is travelling against the direction the edge is drawn in, so it walks the
   * path backwards and its arrow points the other way.
   */
  reversed?: boolean;
  selected?: boolean;
  /** Called with the `PDU.id` when the chip is clicked or activated from the keyboard. */
  onSelect?: (pduId: string) => void;
}

/** Half a wire's length: the point a reduced-motion packet is closer to the far end. */
const SNAP_POINT = 0.5;

/** Degrees, rounded, so a straight wire reports `0` rather than `1.2246e-14`. */
function roundAngle(angle: number): number {
  return Math.round(angle * 100) / 100;
}

export function PacketSprite({
  pdu,
  progress,
  path,
  from,
  to,
  reversed = false,
  selected = false,
  onSelect,
}: PacketSpriteProps) {
  const { reduced } = useReducedMotionSafe();

  const travelled = reduced
    ? clampProgress(progress) < SNAP_POINT
      ? 0
      : 1
    : clampProgress(progress);

  // The path is drawn from the edge's source to its target. A packet going the other way
  // is at `1 - t` along that same curve, so both directions share one geometry.
  const t = reversed ? 1 - travelled : travelled;
  const { point, angle } = placeAlongPath(path, from, to, t);
  // The tangent always points the way the curve was drawn; a packet going the other way
  // is heading exactly opposite it.
  const heading = roundAngle(reversed ? angle + 180 : angle);

  const outermost = pdu.layers[0];
  const layer = getLayer(isLayerKey(outermost?.layer) ? outermost.layer : 'network');
  const protocol = outermost?.protocol ?? 'Packet';

  return (
    <button
      type="button"
      // `nodrag nopan`: without them React Flow treats a press on the chip as the start
      // of a pan and the click never lands. `pointer-events-auto` because the label
      // layer this renders into disables them for everything by default.
      className={cn(
        'nodrag nopan pointer-events-auto absolute top-0 left-0 z-10',
        'flex items-center gap-1.5 rounded-full border px-2 py-0.5',
        'text-fg text-[0.625rem] whitespace-nowrap shadow-lg',
        'focus-visible:outline-focus focus-visible:outline-2 focus-visible:outline-offset-2',
        selected && 'ring-accent ring-2 ring-offset-1 ring-offset-transparent',
      )}
      style={{
        // Transform rather than `left`/`top`: it stays off the layout path, which matters
        // when this is recomputed on every animation frame.
        transform: `translate(${point.x}px, ${point.y}px) translate(-50%, -50%)`,
        borderColor: layer.color,
        backgroundColor: `color-mix(in oklab, ${layer.color} 22%, var(--bg-overlay))`,
      }}
      aria-pressed={selected}
      aria-label={`${pdu.summary}. ${layer.label} layer, ${protocol}. ${pdu.sizeBytes} bytes`}
      // `stopPropagation` is load-bearing, not defensive. The chip is rendered through
      // `EdgeLabelRenderer`, so a click that keeps bubbling reaches React Flow as a click
      // on the edge underneath: the canvas would select the PDU and then immediately
      // replace it with the link, and the inspector would show the wire instead of the
      // packet the user actually clicked.
      onClick={(event) => {
        event.stopPropagation();
        onSelect?.(pdu.id);
      }}
    >
      <ArrowRight
        aria-hidden="true"
        className="size-3 shrink-0"
        style={{ color: layer.color, transform: `rotate(${heading}deg)` }}
      />
      <span
        aria-hidden="true"
        style={{ color: layer.color }}
        className="font-mono font-semibold"
      >
        {layer.short}
      </span>
      <span aria-hidden="true" className="font-medium">
        {protocol}
      </span>
    </button>
  );
}
