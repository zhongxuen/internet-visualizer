'use client';

import { useStore, ViewportPortal, type ReactFlowState } from '@xyflow/react';
import {
  Building2,
  Cloud,
  Globe,
  House,
  RadioTower,
  ServerCog,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useMemo } from 'react';

import type { Topology, ZoneKind } from '@/core/types/topology';

import { zoneRects, type Rect } from '../layout';

/**
 * Places on the map: the labelled backdrops machines sit inside (uiux-spec.md §5.4).
 *
 * The Internet cannot be seen, and a diagram of boxes gives the imagination nothing to
 * hold. A zone says *where* a machine is -- your home, your provider, a data centre on
 * another continent -- which is most of what a beginner needs before "what it does".
 *
 * ## Behind the nodes, and never a node
 *
 * The backdrops are drawn through React Flow's `ViewportPortal`, so they pan and zoom with
 * the diagram, at `z-index: -1` inside the viewport, so every link and machine paints on
 * top of them. They are deliberately *not* React Flow nodes: a zone is not something a
 * packet visits, it must never take focus or a click, and everything that counts
 * `.react-flow__node` -- the e2e check that the canvas drew exactly the machines the
 * topology list holds, the label-size metric that reads the first node -- would count a
 * place as a machine.
 *
 * Zones are `aria-hidden`: a screen reader hears each machine's zone in the machine's own
 * name ("Home router, in Your home", see `graph.ts`), which is where it is useful, rather
 * than as a string of disembodied place names.
 *
 * ## Sized from what React Flow measured
 *
 * A backdrop has to fit the cards as drawn, and a card's height depends on the detail
 * level and on what the scenario put in it. So the rectangles come from React Flow's own
 * store, through a selector that returns one string: the store changes on every frame of
 * a pan, but the string only changes when a card is measured differently, and that is
 * the only time this re-renders.
 */

export interface ZoneKindToken {
  kind: ZoneKind;
  icon: LucideIcon;
  /** What the icon is a picture of, for the key. */
  picture: string;
}

/** One icon per kind of place. Every zone also prints its own name, so none is icon-only. */
export const ZONE_KINDS: Record<ZoneKind, ZoneKindToken> = {
  home: { kind: 'home', icon: House, picture: 'a house' },
  office: { kind: 'office', icon: Building2, picture: 'an office building' },
  isp: { kind: 'isp', icon: RadioTower, picture: 'an antenna' },
  internet: { kind: 'internet', icon: Globe, picture: 'a globe' },
  cdn: { kind: 'cdn', icon: Warehouse, picture: 'a warehouse' },
  datacenter: { kind: 'datacenter', icon: ServerCog, picture: 'a server room' },
  cloud: { kind: 'cloud', icon: Cloud, picture: 'a cloud' },
};

export const ZONE_KIND_LIST: readonly ZoneKindToken[] = Object.values(ZONE_KINDS);

/** Integer flow units are plenty for a backdrop, and keep the key from churning. */
function round(value: number): number {
  return Math.round(value);
}

/** Node boxes by id, from React Flow's measured internals. */
export function measuredBoxes(
  state: Pick<ReactFlowState, 'nodeLookup'>,
): Map<string, Rect> {
  const boxes = new Map<string, Rect>();
  for (const [id, node] of state.nodeLookup) {
    const { x, y } = node.internals.positionAbsolute;
    boxes.set(id, {
      x,
      y,
      width: node.measured.width ?? node.width ?? node.initialWidth ?? 0,
      height: node.measured.height ?? node.height ?? node.initialHeight ?? 0,
    });
  }
  return boxes;
}

export interface ZoneLayerProps {
  topology: Topology;
}

export function ZoneLayer({ topology }: ZoneLayerProps) {
  const selectKey = useCallback(
    (state: ReactFlowState) =>
      zoneRects(topology, measuredBoxes(state))
        .map(
          ({ zone, x, y, width, height }) =>
            `${zone.id}:${round(x)},${round(y)},${round(width)},${round(height)}`,
        )
        .join('|'),
    [topology],
  );
  const key = useStore(selectKey);

  const zones = useMemo(() => {
    const byId = new Map((topology.zones ?? []).map((zone) => [zone.id, zone]));
    return key
      .split('|')
      .filter(Boolean)
      .map((entry) => {
        const [id, box] = entry.split(':');
        const [x, y, width, height] = box.split(',').map(Number);
        return { zone: byId.get(id)!, x, y, width, height };
      })
      .filter((rect) => rect.zone !== undefined);
  }, [key, topology]);

  if (zones.length === 0) return null;

  return (
    <ViewportPortal>
      <div aria-hidden="true" data-testid="canvas-zones" className="pointer-events-none">
        {zones.map(({ zone, x, y, width, height }) => {
          const Icon = ZONE_KINDS[zone.kind].icon;
          return (
            <div
              key={zone.id}
              data-zone={zone.id}
              data-zone-kind={zone.kind}
              className="border-border bg-surface-raised/45 absolute top-0 left-0 -z-10 rounded-[2rem] border-2 border-dashed"
              style={{
                width,
                height,
                transform: `translate(${x}px, ${y}px)`,
              }}
            >
              <div className="text-fg-secondary flex items-center gap-2.5 px-6 pt-5">
                <span className="bg-surface-overlay border-border flex size-9 shrink-0 items-center justify-center rounded-full border">
                  <Icon className="size-5" strokeWidth={1.75} />
                </span>
                <span className="text-lead truncate font-semibold">{zone.label}</span>
              </div>
            </div>
          );
        })}
      </div>
    </ViewportPortal>
  );
}
