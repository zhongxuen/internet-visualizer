import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';
import { useEffect, useRef, useState, type RefObject } from 'react';

import { cn } from '@/lib/cn';

import { useCanvasDetail, useDimmedNodes } from '../display';
import { PacketSprite } from '../PacketSprite';
import { usePacketSelect } from '../packetSelection';
import type { LinkFlowEdge } from '../types';

import { DEFAULT_LINK_WIDTH, linkMediumToken } from './media';

/**
 * A `SimLink` on the canvas.
 *
 * Carries the two numbers that decide how long anything takes on this hop — one-way
 * latency and, when the scenario states it, bandwidth — plus the medium, so a wireless
 * hop is visibly not a fiber trunk.
 *
 * ## Two detail levels
 *
 * **Full detail** always shows the pill: medium icon, latency, bandwidth. Latency is the
 * "distance" of the link, and a packet on the canvas moves at a speed this label explains.
 *
 * **Simple** (the default, uiux-spec.md §5.2) shows only the medium's icon until the link
 * is hovered, focused or selected, and then the whole pill. "3 ms · 1 Gb/s" on every wire
 * of a seventeen-machine diagram is a wall of numbers before anyone has asked a question
 * of them; on request it is the answer. The pill is *unmounted* while hidden, not faded,
 * and the medium keeps both its non-colour signals throughout: the dash pattern on the
 * stroke and the icon at the midpoint.
 *
 * Hover and focus land on the `<g>` React Flow wraps this in, which this component does
 * not render, so they are read from it with listeners: one `useState` flip per pointer
 * entering or leaving a wire, and nothing at all during playback.
 *
 * The stroke stays neutral on purpose. Colour on this canvas means node state and OSI
 * layer; a link that recoloured itself would compete with the packet travelling along it.
 * Medium is a dash pattern and an icon instead (`./media.ts`).
 *
 * Selection and keyboard focus are React Flow's: the `<g>` it wraps this in is the tab
 * stop and the click target. The halo path below is drawn only for `:focus-visible`,
 * because React Flow's own stylesheet clears the browser outline on a focused edge and a
 * recoloured stroke alone would be colour-as-only-signal.
 *
 * A hop is dimmed only when **both** its ends are (`DimmedNodesContext`). A link with one
 * machine still in focus is the thing that says how that machine is reached, so the layer
 * filter leaves it alone and the diagram never comes apart into disconnected islands.
 *
 * Whatever is travelling on the link right now rides in the label layer beside the chip:
 * the edge owns the curve, so it is the only thing that can hand a `PacketSprite` the
 * exact path to sit on. It hands over the position and nothing else — no timing, no
 * animation state — because `progress` is already a pure function of virtual time.
 */

function formatBandwidth(mbps: number): string {
  return mbps >= 1000 ? `${mbps / 1000} Gb/s` : `${mbps} Mb/s`;
}

/**
 * Whether the pointer is over, or keyboard focus is on, the React Flow wrapper around
 * `anchor`. Only listens while `enabled`: Full detail shows the pill regardless.
 */
function useEdgeAttention(
  anchor: RefObject<SVGPathElement | null>,
  enabled: boolean,
): boolean {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const wrapper = anchor.current?.closest('.react-flow__edge');
    if (!enabled || !wrapper) return;

    const enter = () => setHovered(true);
    const leave = () => setHovered(false);
    const focus = () => setFocused(true);
    const blur = () => setFocused(false);

    wrapper.addEventListener('pointerenter', enter);
    wrapper.addEventListener('pointerleave', leave);
    wrapper.addEventListener('focus', focus);
    wrapper.addEventListener('blur', blur);
    return () => {
      wrapper.removeEventListener('pointerenter', enter);
      wrapper.removeEventListener('pointerleave', leave);
      wrapper.removeEventListener('focus', focus);
      wrapper.removeEventListener('blur', blur);
    };
  }, [anchor, enabled]);

  return hovered || focused;
}

export function LinkEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  interactionWidth = 24,
}: EdgeProps<LinkFlowEdge>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const onSelectPacket = usePacketSelect();
  const dimmedNodes = useDimmedNodes();
  const simple = useCanvasDetail() === 'simple';
  const haloRef = useRef<SVGPathElement | null>(null);
  const attended = useEdgeAttention(haloRef, simple);

  const link = data?.link;
  const dimmed =
    !selected &&
    link !== undefined &&
    dimmedNodes.has(link.from) &&
    dimmedNodes.has(link.to);

  const medium = linkMediumToken(link?.medium);
  const MediumIcon = medium?.icon;
  const width = medium?.width ?? DEFAULT_LINK_WIDTH;

  // Simple shows the numbers on request only; the medium's icon is always there.
  const showNumbers = !simple || selected || attended;
  const showChip = link !== undefined && (showNumbers || MediumIcon !== undefined);

  return (
    <>
      <path
        ref={haloRef}
        aria-hidden="true"
        d={path}
        fill="none"
        strokeWidth={width + 6}
        strokeLinecap="round"
        className="stroke-focus pointer-events-none opacity-0 group-focus-visible:opacity-100"
      />
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={interactionWidth}
        style={{
          strokeWidth: width,
          strokeDasharray: medium?.dash,
          opacity: dimmed ? 0.25 : undefined,
        }}
      />
      <EdgeLabelRenderer>
        {/*
          The chip has to fit in the gap between two columns, so the medium is the icon
          alone -- spelling out "Ethernet" doubles the width and pushes the label under a
          node, which is worse than no label at all. The word is still in the edge's
          accessible name, in the icon's tooltip, and in the inspector.
        */}
        {showChip && link ? (
          <div
            title={medium?.label}
            data-link-numbers={showNumbers || undefined}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            }}
            className={cn(
              'bg-surface-overlay/95 text-caption pointer-events-none absolute flex items-center gap-1.5 rounded-full border whitespace-nowrap',
              showNumbers ? 'px-2 py-0.5' : 'p-1',
              selected ? 'border-accent/60 text-fg' : 'border-border text-fg-secondary',
              // The chip is rendered in React Flow's label layer, outside the <g> the
              // stroke lives in, so it has to be dimmed on its own.
              dimmed && 'opacity-25',
            )}
          >
            {MediumIcon ? (
              <MediumIcon aria-hidden="true" className="size-3 shrink-0" />
            ) : null}
            {showNumbers ? (
              <>
                <span className="font-mono">{link.latencyMs} ms</span>
                {link.bandwidthMbps === undefined ? null : (
                  <>
                    <span aria-hidden="true" className="text-fg-muted">
                      &middot;
                    </span>
                    <span className="font-mono">
                      {formatBandwidth(link.bandwidthMbps)}
                    </span>
                  </>
                )}
              </>
            ) : null}
          </div>
        ) : null}
        {data?.packets?.map((packet, index) => (
          <PacketSprite
            key={`${packet.pdu.id}-${index}`}
            pdu={packet.pdu}
            progress={packet.progress}
            startMs={packet.startMs}
            durationMs={packet.durationMs}
            reversed={packet.reversed}
            selected={packet.selected}
            path={path}
            from={{ x: sourceX, y: sourceY }}
            to={{ x: targetX, y: targetY }}
            onSelect={onSelectPacket ?? undefined}
          />
        ))}
      </EdgeLabelRenderer>
    </>
  );
}
