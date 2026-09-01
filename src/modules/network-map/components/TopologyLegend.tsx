'use client';

import { ChevronRight } from 'lucide-react';

import { linkMediumToken, nodeKindToken } from '@/components/viz';
import { Badge } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import type { LinkMedium, NodeKind, Topology } from '@/core/types/topology';
import { cn } from '@/lib/cn';

/**
 * What every shape on the diagram means -- for this scenario only.
 *
 * A legend listing all thirteen machine kinds would be a reference card; this lists the
 * five or six actually on screen, in the order they were declared, so it reads as a
 * caption for the picture in front of you. Everything in it comes from the same tables
 * the canvas draws from (`nodes/kinds.ts`, `edges/media.ts`), so the legend cannot
 * describe a silhouette the diagram does not use.
 *
 * It restates the product's colour rule out loud: a machine's identity is its icon and
 * its printed role, a hop's medium is its dash pattern and its icon, and colour is spent
 * on the OSI layer -- which is why the layer badge is the only coloured thing here.
 *
 * A native `<details>`, so it collapses, is keyboard-operable, and is announced correctly
 * without any JavaScript.
 */

export interface TopologyLegendProps {
  topology: Topology;
  defaultOpen?: boolean;
  className?: string;
}

/** Kinds in the order the scenario introduces them, without repeats. */
function kindsIn(topology: Topology): NodeKind[] {
  return [...new Set(topology.nodes.map((node) => node.kind))];
}

/** Media in link order, ignoring hops the scenario declined to describe. */
function mediaIn(topology: Topology): LinkMedium[] {
  return [
    ...new Set(
      topology.links
        .map((link) => link.medium)
        .filter((medium): medium is LinkMedium => medium !== undefined),
    ),
  ];
}

export function TopologyLegend({
  topology,
  defaultOpen = false,
  className,
}: TopologyLegendProps) {
  const kinds = kindsIn(topology);
  const media = mediaIn(topology);

  return (
    <details
      open={defaultOpen}
      className={cn('border-border bg-surface-raised group rounded-xl border', className)}
    >
      <summary
        className={cn(
          'text-fg-secondary hover:text-fg flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-medium tracking-widest uppercase transition-colors',
          focusRing,
        )}
      >
        <ChevronRight
          aria-hidden="true"
          className="size-3.5 transition-transform group-open:rotate-90"
        />
        Legend
        <span className="text-fg-muted tracking-normal normal-case">
          {kinds.length} kinds of machine, {media.length}{' '}
          {media.length === 1 ? 'medium' : 'media'}
        </span>
      </summary>

      <div className="border-border grid gap-x-6 gap-y-4 border-t px-4 py-3 sm:grid-cols-2">
        <section className="flex flex-col gap-2">
          <h3 className="text-fg-muted text-[0.625rem] font-medium tracking-widest uppercase">
            Machines
          </h3>
          <ul className="flex flex-col gap-2">
            {kinds.map((kind) => {
              const token = nodeKindToken(kind);
              const Icon = token.icon;

              return (
                <li key={kind} className="flex items-start gap-2.5">
                  <span
                    aria-hidden="true"
                    className="bg-surface-overlay text-fg-secondary border-border mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border"
                  >
                    <Icon className="size-3.5" strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-fg text-xs font-medium">
                        {token.roleLabel}
                      </span>
                      <Badge layer={token.layer} className="px-1.5 py-0 text-[0.625rem]">
                        {token.layerAction}
                      </Badge>
                    </span>
                    <span className="text-fg-muted mt-0.5 block text-xs leading-snug">
                      {token.description}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-fg-muted text-[0.625rem] font-medium tracking-widest uppercase">
            Hops
          </h3>
          <ul className="flex flex-col gap-2">
            {media.map((medium) => {
              const token = linkMediumToken(medium);
              if (!token) return null;
              const Icon = token.icon;

              return (
                <li key={medium} className="flex items-start gap-2.5">
                  <span
                    aria-hidden="true"
                    className="text-fg-secondary mt-1 flex shrink-0 items-center gap-1.5"
                  >
                    <Icon className="size-3.5" strokeWidth={1.75} />
                    {/* The same dash pattern and stroke width the canvas draws. */}
                    <svg
                      viewBox="0 0 32 6"
                      className="stroke-border-strong h-1.5 w-8"
                      fill="none"
                    >
                      <line
                        x1="0"
                        y1="3"
                        x2="32"
                        y2="3"
                        strokeWidth={token.width}
                        strokeDasharray={token.dash}
                      />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-fg block text-xs font-medium">
                      {token.label}
                    </span>
                    <span className="text-fg-muted mt-0.5 block text-xs leading-snug">
                      {token.description}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </details>
  );
}
