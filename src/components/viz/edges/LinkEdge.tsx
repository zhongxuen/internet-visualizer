import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';

import { cn } from '@/lib/cn';

import { useDimmedNodes } from '../display';
import { PacketSprite } from '../PacketSprite';
import { usePacketSelect } from '../packetSelection';
import type { LinkFlowEdge } from '../types';

import { DEFAULT_LINK_WIDTH, linkMediumToken } from './media';

/**
 * A `SimLink` on the canvas.
 *
 * Carries the two numbers that decide how long anything takes on this hop — one-way
 * latency and, when the scenario states it, bandwidth — plus the medium, so a wireless
 * hop is visibly not a fiber trunk. Latency is always shown because it is the "distance"
 * of the link: a packet on the canvas moves at a speed this label explains.
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

  const link = data?.link;
  const dimmed =
    !selected &&
    link !== undefined &&
    dimmedNodes.has(link.from) &&
    dimmedNodes.has(link.to);
  const medium = linkMediumToken(link?.medium);
  const MediumIcon = medium?.icon;
  const width = medium?.width ?? DEFAULT_LINK_WIDTH;

  return (
    <>
      <path
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
        {link ? (
          <div
            title={medium?.label}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            }}
            className={cn(
              'bg-surface-overlay/95 pointer-events-none absolute flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.625rem] whitespace-nowrap',
              selected ? 'border-accent/60 text-fg' : 'border-border text-fg-secondary',
              // The chip is rendered in React Flow's label layer, outside the <g> the
              // stroke lives in, so it has to be dimmed on its own.
              dimmed && 'opacity-25',
            )}
          >
            {MediumIcon ? (
              <MediumIcon aria-hidden="true" className="size-3 shrink-0" />
            ) : null}
            <span className="font-mono">{link.latencyMs} ms</span>
            {link.bandwidthMbps === undefined ? null : (
              <>
                <span aria-hidden="true" className="text-fg-muted">
                  &middot;
                </span>
                <span className="font-mono">{formatBandwidth(link.bandwidthMbps)}</span>
              </>
            )}
          </div>
        ) : null}

        {data?.packets?.map((packet, index) => (
          <PacketSprite
            key={`${packet.pdu.id}-${index}`}
            pdu={packet.pdu}
            progress={packet.progress}
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
