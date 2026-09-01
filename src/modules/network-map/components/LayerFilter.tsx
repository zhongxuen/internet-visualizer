'use client';

import { Layers } from 'lucide-react';

import { focusRing } from '@/components/ui/styles';
import type { Topology } from '@/core/types/topology';
import { cn } from '@/lib/cn';
import { getLayer, layerColor, layerTint, type LayerKey } from '@/lib/theme';

import { countAtLayer, layersInTopology } from '../layers';

/**
 * "Show me just layer 2."
 *
 * A network diagram is really several diagrams drawn on top of each other: the frames
 * moving between adjacent boxes, the packets crossing between networks, the conversation
 * the two ends are actually having. Being able to look at one of them at a time is most
 * of what makes a topology legible, and it is the fastest way to see that a switch and a
 * router are not the same kind of thing.
 *
 * Choosing a layer **dims** the rest; it never removes them. A machine pushed into the
 * background is still drawn, still clickable, still in the tab order, and selecting it
 * brings it back to full strength -- because the point is to read the diagram at one
 * layer, not to pretend the other layers are not there. The dimming itself is applied by
 * `DimmedNodesContext`; this component only decides which ids.
 *
 * Only layers this scenario has machines at are offered: a filter button that would dim
 * the entire diagram teaches nothing.
 */

export interface LayerFilterProps {
  topology: Topology;
  /** The layer in focus, or `null` for all of them. */
  layer: LayerKey | null;
  onChange: (layer: LayerKey | null) => void;
  className?: string;
}

export function LayerFilter({ topology, layer, onChange, className }: LayerFilterProps) {
  const available = layersInTopology(topology);

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <span className="text-fg-muted inline-flex items-center gap-1.5 text-xs font-medium">
        <Layers aria-hidden="true" className="size-3.5" />
        Layer
      </span>

      <div
        role="group"
        aria-label="Filter machines by OSI layer"
        className="flex flex-wrap gap-1"
      >
        <button
          type="button"
          aria-pressed={layer === null}
          onClick={() => onChange(null)}
          className={cn(
            'rounded-md border px-2 py-1 text-xs font-medium transition-colors',
            focusRing,
            layer === null
              ? 'border-border-strong bg-surface-overlay text-fg'
              : 'border-border text-fg-muted hover:text-fg hover:border-border-strong',
          )}
        >
          All
        </button>

        {available.map((key) => {
          const token = getLayer(key);
          const active = layer === key;

          return (
            <button
              key={key}
              type="button"
              aria-pressed={active}
              // The short label carries the layer on its own, so the colour below is
              // never the only thing saying which one this is.
              aria-label={`${token.short} ${token.label} \u2014 ${countAtLayer(topology, key)} machines`}
              onClick={() => onChange(active ? null : key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors',
                focusRing,
                active
                  ? 'text-fg'
                  : 'border-border text-fg-muted hover:text-fg hover:border-border-strong',
              )}
              style={
                active
                  ? { borderColor: layerTint(key, 60), backgroundColor: layerTint(key) }
                  : undefined
              }
            >
              <span
                className="font-mono text-[0.6875rem]"
                style={{ color: layerColor(key) }}
              >
                {token.short}
              </span>
              <span aria-hidden="true">{token.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
