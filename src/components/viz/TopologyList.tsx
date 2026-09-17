'use client';

import { memo } from 'react';

import { useDetail } from '@/components/prefs';
import { Badge, Disclosure } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { describeDuration } from '@/core/text/humanScale';
import { plainRoleOf } from '@/core/text/kinds';
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
 * ## Why a `Disclosure`
 *
 * Closed by default, because the product's answer to "what does this network look like"
 * is the diagram, and two full copies of it stacked on every module route would be worse
 * for everyone, including the people this is for. A `<summary>` is a real tab stop with a
 * real accessible name, so the list is one `Enter` away on any keyboard, and the count in
 * the summary says what is inside before you open it. `lazy`, like the event log: the
 * rows are mounted only while the list is open, because the size of the document is what
 * costs frames during playback (CLAUDE.md, "Performance").
 *
 * ## Two voices
 *
 * In Simple detail a machine row says what the machine is for (`plainRoleOf`) and which
 * place it sits in (its zone), and a link row gives the delay a human scale. Full detail
 * adds the role badge and every address, as the list has always shown.
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
  zone,
  full,
  selected,
  onSelect,
}: {
  node: SimNode;
  state: NodeState;
  /** The label of the place the machine sits in, when the topology has zones. */
  zone?: string;
  full: boolean;
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
          <span className="text-fg text-small font-medium">{node.label}</span>
          {full ? (
            <Badge layer={kind.layer} className="text-caption px-1.5 py-0">
              {kind.roleLabel}
            </Badge>
          ) : null}
          {/*
            The state as a word, not as a colour and not as an outline: this is the view
            that has room to simply say it.
          */}
          <span className="text-fg-muted text-caption tracking-wider uppercase">
            {status.label}
          </span>
        </span>

        <span className="text-fg-secondary text-small leading-snug">
          {plainRoleOf(node)}
          {zone ? <span className="text-fg-muted">. In: {zone}</span> : null}
        </span>

        {full ? <AddressList node={node} always /> : null}
      </button>
    </li>
  );
}

function LinkRow({
  link,
  label,
  full,
  selected,
  onSelect,
}: {
  link: SimLink;
  label: (id: string) => string;
  full: boolean;
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
        <span className="text-fg text-small min-w-0 flex-1">
          {label(link.from)} <span className="text-fg-muted">to</span> {label(link.to)}
        </span>
        {medium ? (
          <span className="text-fg-muted text-caption tracking-wider uppercase">
            {medium.label}
          </span>
        ) : null}
        <span className="text-fg-secondary text-caption font-mono tabular-nums">
          {link.latencyMs} ms
          {full
            ? link.bandwidthMbps === undefined
              ? ''
              : ` · ${link.bandwidthMbps} Mbps`
            : ` (${describeDuration(link.latencyMs)})`}
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
  const full = useDetail() === 'full';
  const labelOf = (id: string) =>
    topology.nodes.find((node) => node.id === id)?.label ?? id;
  const zoneOf = (node: SimNode) =>
    node.zone ? topology.zones?.find((zone) => zone.id === node.zone)?.label : undefined;

  return (
    <Disclosure
      summary={
        <span className="flex flex-wrap items-baseline gap-x-2">
          <h2 className="text-base font-medium">The map as a list</h2>
          <span className="text-fg-muted text-small font-normal">
            {topology.nodes.length} {topology.nodes.length === 1 ? 'machine' : 'machines'}
            , {topology.links.length} {topology.links.length === 1 ? 'link' : 'links'}
          </span>
        </span>
      }
      lazy
      className={cn('bg-surface-raised rounded-xl', className)}
      summaryClassName="rounded-xl px-4"
      contentClassName="border-border grid gap-x-6 gap-y-4 border-t px-4 py-3 lg:grid-cols-2"
    >
      <section className="flex min-w-0 flex-col gap-2">
        <h3 className="text-fg-muted text-caption font-medium tracking-widest uppercase">
          Machines
        </h3>
        <ul className="flex flex-col gap-1.5">
          {topology.nodes.map((node) => (
            <NodeRow
              key={node.id}
              node={node}
              state={nodeStates?.[node.id] ?? 'idle'}
              zone={zoneOf(node)}
              full={full}
              selected={selection?.type === 'node' && selection.id === node.id}
              onSelect={() =>
                onSelect?.(toggle(selection, { type: 'node', id: node.id }))
              }
            />
          ))}
        </ul>
      </section>

      <section className="flex min-w-0 flex-col gap-2">
        <h3 className="text-fg-muted text-caption font-medium tracking-widest uppercase">
          Links
        </h3>
        {topology.links.length === 0 ? (
          <p className="text-fg-muted text-small">
            This scenario has no links: every machine stands alone.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {topology.links.map((link) => (
              <LinkRow
                key={link.id}
                link={link}
                label={labelOf}
                full={full}
                selected={selection?.type === 'link' && selection.id === link.id}
                onSelect={() =>
                  onSelect?.(toggle(selection, { type: 'link', id: link.id }))
                }
              />
            ))}
          </ul>
        )}
      </section>
    </Disclosure>
  );
});
