'use client';

import { useLayoutEffect, useRef } from 'react';

import { ArrowRight } from 'lucide-react';

import type { PDU } from '@/core/types/pdu';
import { useReducedMotionSafe } from '@/components/motion';
import { cn } from '@/lib/cn';
import { getLayer, isLayerKey } from '@/lib/theme';

import { useFrameClock } from './frameClock';
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
 *
 * ## How it moves without re-rendering
 *
 * Sixty renders a second of the whole diagram is what the phase-14 profile found the
 * frame time going on, so during playback this component does not re-render at all. It
 * subscribes to the `FrameClock`, recomputes its own point on the curve, and writes the
 * `transform` straight to the two elements below. React renders the chip once, when the
 * packet appears on the wire, and again when it leaves.
 *
 * That is a change of plumbing, not of architecture. The position is still
 * `progress = (t - startMs) / durationMs` -- the same arithmetic `projectAt` does, on
 * the same numbers, with the same reduced-motion snap -- so pausing mid-hop and
 * scrubbing backwards are still exact, and a sprite with no clock (a still frame, a
 * test) still just draws the `progress` it was handed.
 */

export interface PacketSpriteProps {
  /** The PDU on the wire. Its outermost layer decides the colour and the short label. */
  pdu: PDU;
  /** How far along the link, `0`..`1`. Clamped; anything non-finite parks it at the start. */
  progress: number;
  /**
   * The hop's window in virtual time -- the `transmit` event's `at` and `durationMs`.
   *
   * Present, and with a `FrameClock` in context, the sprite follows the playhead itself
   * and `progress` is only its starting position. Absent, `progress` is the whole story
   * and the chip stays where it is put.
   */
  startMs?: number;
  durationMs?: number;
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

/**
 * `progress`, with the reduced-motion snap applied.
 *
 * The same rule `snapToEndpoints` applies to a projected frame, kept here as well
 * because a self-positioning sprite never goes through that function.
 */
function travelledAt(progress: number, reduced: boolean): number {
  const clamped = clampProgress(progress);
  if (!reduced) return clamped;
  return clamped < SNAP_POINT ? 0 : 1;
}

/** How far along at virtual time `t`, for a hop that left at `startMs`. */
function progressAt(virtualTime: number, startMs: number, durationMs: number): number {
  if (durationMs <= 0) return 1;
  return (virtualTime - startMs) / durationMs;
}

/** The CSS `transform` that puts the chip at `point`. */
function chipTransform(point: XY): string {
  return `translate(${point.x}px, ${point.y}px) translate(-50%, -50%)`;
}

export function PacketSprite({
  pdu,
  progress,
  startMs,
  durationMs,
  path,
  from,
  to,
  reversed = false,
  selected = false,
  onSelect,
}: PacketSpriteProps) {
  const { reduced } = useReducedMotionSafe();
  const clock = useFrameClock();

  const chipRef = useRef<HTMLButtonElement | null>(null);
  const arrowRef = useRef<SVGSVGElement | null>(null);

  const travelled = travelledAt(progress, reduced);

  // The path is drawn from the edge's source to its target. A packet going the other way
  // is at `1 - t` along that same curve, so both directions share one geometry.
  const t = reversed ? 1 - travelled : travelled;
  const { point, angle } = placeAlongPath(path, from, to, t);
  // The tangent always points the way the curve was drawn; a packet going the other way
  // is heading exactly opposite it.
  const heading = roundAngle(reversed ? angle + 180 : angle);

  /*
    Follow the playhead without re-rendering. Everything this needs -- the curve, the
    endpoints, the hop's window -- is already fixed for as long as the packet is on the
    wire, so a frame is two arithmetic passes and two style writes, and no React work at
    all. A layout effect rather than an effect so the first position is applied before
    the browser paints: the chip is rendered at the `progress` it was handed, which is
    the position at the frame it appeared, and the clock may already have moved on.
  */
  const travelling = clock !== null && startMs !== undefined && durationMs !== undefined;

  useLayoutEffect(() => {
    if (!travelling) return;

    const place = (virtualTime: number) => {
      const chip = chipRef.current;
      if (!chip) return;

      const moved = travelledAt(progressAt(virtualTime, startMs, durationMs), reduced);
      const at = reversed ? 1 - moved : moved;
      const placement = placeAlongPath(path, from, to, at);

      chip.style.transform = chipTransform(placement.point);
      if (arrowRef.current) {
        const degrees = roundAngle(reversed ? placement.angle + 180 : placement.angle);
        arrowRef.current.style.transform = `rotate(${degrees}deg)`;
      }
    };

    place(clock.now());
    return clock.subscribe(place);
  }, [travelling, clock, startMs, durationMs, reduced, reversed, path, from, to]);

  const outermost = pdu.layers[0];
  const layer = getLayer(isLayerKey(outermost?.layer) ? outermost.layer : 'network');
  const protocol = outermost?.protocol ?? 'Packet';

  return (
    <button
      ref={chipRef}
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
        // Transform rather than `left`/`top`: it stays off the layout path, which is
        // what makes the per-frame write above a compositor job rather than a reflow.
        transform: chipTransform(point),
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
        ref={arrowRef}
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
