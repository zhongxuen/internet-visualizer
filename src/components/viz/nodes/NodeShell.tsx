import { Handle, Position } from '@xyflow/react';
import type { ReactNode } from 'react';

import type { NodeState } from '@/core/types/events';
import type { SimNode } from '@/core/types/topology';
import { cn } from '@/lib/cn';

import { useDimmedNodes } from '../display';

import { HANDLE_SIDES, sourceHandleId, targetHandleId, type HandleSide } from './handles';
import { FAMILY_SHAPE, nodeKindToken } from './kinds';
import { nodeStateToken } from './state';

/**
 * The frame every node on the canvas shares.
 *
 * Family components (`DeviceNode`, `RouterNode`, ...) supply only the body: the frame,
 * the kind icon, the label, the state chip, and the connection anchors are decided once,
 * here, so thirteen `NodeKind`s cannot end up with thirteen slightly different cards.
 *
 * Three signals are layered deliberately, and none of them is colour on its own:
 *
 *   - **which machine this is** — icon + printed role word (`./kinds.ts`)
 *   - **what it is doing** — state colour + state icon + state word + outline shape
 *     (`./state.ts`)
 *   - **where it works** — the `L2`..`L7` layer badge, drawn by the family component
 *
 * The wrapper React Flow puts around this owns focus (`tabIndex`), the accessible name,
 * and click handling; nothing in here may be focusable, or a keyboard user would have to
 * tab through the insides of every machine to cross the diagram.
 *
 * A view can push machines into the background (`DimmedNodesContext` -- the Network Map's
 * layer filter). That is opacity and nothing else: the card keeps its focus ring, its
 * click target, and its accessible name, and a dimmed machine that gets selected comes
 * straight back to full strength, so the filter can never hide something the user is
 * looking at.
 */

const SIDE_POSITION: Record<HandleSide, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

/**
 * Anchors, not controls: invisible, unconnectable, and one pixel so they never widen a
 * node. Inline styles rather than classes because React Flow's own stylesheet is
 * unlayered and would otherwise win against a Tailwind utility.
 */
const HANDLE_STYLE = {
  width: 1,
  height: 1,
  minWidth: 1,
  minHeight: 1,
  border: 'none',
  background: 'transparent',
  opacity: 0,
} as const;

export interface NodeShellProps {
  node: SimNode;
  state: NodeState;
  selected: boolean;
  /** The family-specific body: layer badge, addresses, whatever else the kind needs. */
  children?: ReactNode;
}

export function NodeShell({ node, state, selected, children }: NodeShellProps) {
  const dimmed = useDimmedNodes().has(node.id) && !selected;
  const kind = nodeKindToken(node.kind);
  const status = nodeStateToken(state);
  const KindIcon = kind.icon;
  const StatusIcon = status.icon;

  return (
    <div
      data-state={state}
      data-kind={node.kind}
      data-dimmed={dimmed || undefined}
      className={cn(
        'bg-surface-raised border-border relative flex w-full flex-col gap-2 border px-3 py-2.5',
        dimmed && 'opacity-25',
        FAMILY_SHAPE[kind.family],
        status.outline,
        // Selection is a ring rather than another outline, so it can show at the same
        // time as the state outline instead of overriding it.
        selected && 'ring-accent-strong ring-2',
      )}
    >
      {HANDLE_SIDES.map((side) => (
        <div key={side}>
          <Handle
            type="target"
            id={targetHandleId(side)}
            position={SIDE_POSITION[side]}
            isConnectable={false}
            style={HANDLE_STYLE}
          />
          <Handle
            type="source"
            id={sourceHandleId(side)}
            position={SIDE_POSITION[side]}
            isConnectable={false}
            style={HANDLE_STYLE}
          />
        </div>
      ))}

      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className="bg-surface-overlay text-fg-secondary border-border flex size-7 shrink-0 items-center justify-center rounded-md border"
        >
          <KindIcon className="size-4" strokeWidth={1.75} />
        </span>

        <span className="min-w-0 flex-1">
          {/*
            Wrapped to two lines rather than truncated: a fully-qualified name like
            `a.root-servers.net` is the teaching content of a DNS diagram, and clipping
            it to `a.root-serv...` throws away the part that says which server this is.
          */}
          <span
            className="text-fg line-clamp-2 block text-sm leading-tight font-medium break-words"
            title={node.label}
          >
            {node.label}
          </span>
          <span className="text-fg-muted block text-[0.625rem] tracking-wider uppercase">
            {kind.roleLabel}
          </span>
        </span>

        <span
          className={cn(
            'flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[0.625rem] font-medium',
            status.chip,
          )}
        >
          <StatusIcon aria-hidden="true" className="size-2.5" strokeWidth={2.25} />
          {status.label}
        </span>
      </div>

      {children}
    </div>
  );
}
