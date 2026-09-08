'use client';

import { memo } from 'react';

import { ChevronRight } from 'lucide-react';

import { Badge } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import type { NodeState } from '@/core/types/events';
import type { SimLink, SimNode, Topology } from '@/core/types/topology';
import { cn } from '@/lib/cn';

import { linkMediumToken } from './edges/media';
import { AddressList } from './nodes/AddressList';
import { nodeKindToken } from './nodes/kinds';
import { nodeStateToken } from './nodes/state';
import { isSameSelection, type CanvasSelection } from './types';

/**
 * The same topology the canvas draws, as a list you can tab through.
 *
 * ## Why this exists
 *
 * `docs/implementation/14-quality-and-deployment.md`, section 2: *"React Flow canvases
 * are the hard part: provide a parallel, focusable list view of nodes and links so the
 * topology is reachable without pointer interaction."*
 *
 * React Flow does make its nodes and edges tab stops, and `SimulationCanvas` fights the
 * library's own `outline: none` to keep a visible ring on them -- but that only buys a
 * keyboard user the *order the library chose*, inside a viewport that has been panned and
 * zoomed to fit. A node scrolled outside the visible box is still a tab stop, and an edge
 * announces itself as a path. Neither is a way to *read* a network.
 *
 * So this is not a fallback for a broken canvas; it is the second representation of the
 * same data. It is always in the DOM, it is ordinary buttons in document order, and it
 * drives the same `onSelect` the canvas does -- pick a machine here and the inspector
 * fills with it exactly as if it had been clicked on the diagram.
 *
 * It also doubles as the text summary alternative the same checklist asks for: every
 * machine with its role, the layer it works at, what it is doing at the instant being
 * rendered, and every address the scenario gave it; every link with both endpoints, the
 * medium, and what the hop costs.
 *
 * ## Why a `<details>`
 *
 * Closed by default, because the product's answer to "what does this network look like"
 * is the diagram, and two full copies of it stacked on every module route would be worse
 * for everyone, including the people this is for. A `<summary>` is a real tab stop with a
 * real accessible name, so the list is one `Enter` away on any keyboard, and the count in
 * the summary says what is inside before you open it.
 *
 * The heading lives *inside* the summary so the sections below it can be `h3` without the
 * page stepping `h2` to `h4`; `TopologyLegend` does the same thing for the same reason.
 */

export interface TopologyListProps {
  topology: Topology;
  /** Highlight state per `SimNode.id`, from `projectAt`; anything absent is `'idle'`. */
  nodeStates?: Readonly<Record<string, NodeState>>;
  /** What the canvas has selected, so the two views agree on what is current. */
  selection?: CanvasSelection | null;
  /** Move the selection. Wired to the same setter the canvas uses. */
  onSelect?: (selection: CanvasSelection | null) => void;
  className?: string;
}

/** Selecting what is already selected clears it, the way clicking the pane does. */
function toggle(
  current: CanvasSelection | null | undefined,
  next: CanvasSelection,
): CanvasSelection | null {
  return isSameSelection(current ?? null, next) ? null : next;
}

function NodeRow({
  node,
  state,
  selected,
  onSelect,
}: {
  node: SimNode;
  state: NodeState;
  selected: boolean;
  onSelect: () => void;
}) {
  const kind = nodeKindToken(node.kind);
  const status = nodeStateToken(state);

  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={cn(
          'flex w-full flex-col gap-1 rounded-lg border px-2.5 py-2 text-left transition-colors',
          focusRing,
          selected
            ? 'border-accent/60 bg-accent/10'
            : 'border-border bg-surface hover:border-border-strong',
        )}
      >
        <span className="flex flex-wrap items-center gap-1.5">
          {/*
            The icon repeats what the words beside it already say, so it is decorative
            here. On the canvas it is load-bearing -- there is no room for a sentence on a
            node card.
          */}
          <status.icon aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="text-fg text-xs font-medium">{node.label}</span>
          <Badge layer={kind.layer} className="px-1.5 py-0 text-[0.625rem]">
            {kind.roleLabel}
          </Badge>
          {/*
            The state as a word, not as a colour and not as an outline: this is the view
            that has room to simply say it.
          */}
          <span className="text-fg-muted text-[0.625rem] tracking-wider uppercase">
            {status.label}
          </span>
        </span>

        <AddressList node={node} always />
      </button>
    </li>
  );
}

function LinkRow({
  link,
  label,
  selected,
  onSelect,
}: {
  link: SimLink;
  label: (id: string) => string;
  selected: boolean;
  onSelect: () => void;
}) {
  const medium = linkMediumToken(link.medium);

  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={cn(
          'flex w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors',
          focusRing,
          selected
            ? 'border-accent/60 bg-accent/10'
            : 'border-border bg-surface hover:border-border-strong',
        )}
      >
        <span className="text-fg min-w-0 flex-1 text-xs">
          {label(link.from)} <span className="text-fg-muted">to</span> {label(link.to)}
        </span>
        {medium ? (
          <span className="text-fg-muted text-[0.625rem] tracking-wider uppercase">
            {medium.label}
          </span>
        ) : null}
        <span className="text-fg-secondary font-mono text-[0.6875rem] tabular-nums">
          {link.latencyMs} ms
          {link.bandwidthMbps === undefined ? '' : ` · ${link.bandwidthMbps} Mbps`}
        </span>
      </button>
    </li>
  );
}

/*
 * Memoized because the view around it re-renders on every animation frame while the
 * playhead moves, and every prop reaching it is identity-stable between events -- see
 * `useVisibleState`, which is what makes that true. Without this, a frame that changes
 * nothing here still costs a full render of it.
 */
export const TopologyList = memo(function TopologyList({
  topology,
  nodeStates,
  selection,
  onSelect,
  className,
}: TopologyListProps) {
  const labelOf = (id: string) =>
    topology.nodes.find((node) => node.id === id)?.label ?? id;

  return (
    <details
      className={cn('border-border bg-surface-raised group rounded-xl border', className)}
    >
      <summary
        className={cn(
          'text-fg-secondary hover:text-fg flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-2.5 transition-colors',
          focusRing,
        )}
      >
        <ChevronRight
          aria-hidden="true"
          className="size-3.5 shrink-0 transition-transform group-open:rotate-90"
        />
        <h2 className="text-xs font-medium tracking-widest uppercase">
          Topology as a list
        </h2>
        <span className="text-fg-muted text-xs">
          {topology.nodes.length} {topology.nodes.length === 1 ? 'machine' : 'machines'},{' '}
          {topology.links.length} {topology.links.length === 1 ? 'link' : 'links'}
        </span>
      </summary>

      <div className="border-border grid gap-x-6 gap-y-4 border-t px-4 py-3 lg:grid-cols-2">
        <section className="flex min-w-0 flex-col gap-2">
          <h3 className="text-fg-muted text-[0.625rem] font-medium tracking-widest uppercase">
            Machines
          </h3>
          <ul className="flex flex-col gap-1.5">
            {topology.nodes.map((node) => (
              <NodeRow
                key={node.id}
                node={node}
                state={nodeStates?.[node.id] ?? 'idle'}
                selected={selection?.type === 'node' && selection.id === node.id}
                onSelect={() =>
                  onSelect?.(toggle(selection, { type: 'node', id: node.id }))
                }
              />
            ))}
          </ul>
        </section>

        <section className="flex min-w-0 flex-col gap-2">
          <h3 className="text-fg-muted text-[0.625rem] font-medium tracking-widest uppercase">
            Links
          </h3>
          {topology.links.length === 0 ? (
            <p className="text-fg-muted text-xs">
              This scenario has no links: every machine stands alone.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {topology.links.map((link) => (
                <LinkRow
                  key={link.id}
                  link={link}
                  label={labelOf}
                  selected={selection?.type === 'link' && selection.id === link.id}
                  onSelect={() =>
                    onSelect?.(toggle(selection, { type: 'link', id: link.id }))
                  }
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </details>
  );
});
