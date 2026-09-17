import { Handle, Position } from '@xyflow/react';
import type { ReactNode } from 'react';

import { plainRoleOf } from '@/core/text/kinds';
import type { NodeState } from '@/core/types/events';
import type { SimNode } from '@/core/types/topology';
import { cn } from '@/lib/cn';

import { useCanvasDetail, useDimmedNodes } from '../display';
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
 *   - **which machine this is** — icon + printed role (`./kinds.ts`)
 *   - **what it is doing** — state colour + state icon + state word + outline shape
 *     (`./state.ts`)
 *   - **where it works** — the `L2`..`L7` layer badge, drawn by the family component
 *
 * ## Two detail levels
 *
 * **Full detail** is the card as it has always been: role word, state chip, and the
 * family's body -- layer note, addresses, the rule a middlebox decides with.
 *
 * **Simple** (the default, uiux-spec.md §5.2) is a 32px icon, the name, and the plain
 * role on one line. The family body is not rendered at all -- not hidden, *unmounted* --
 * so a Packet Journey diagram of seventeen machines stops carrying fifty rows of
 * addresses nobody asked for. State is the outline and, only when the machine is doing
 * something, a chip in words ("Working", "Active", "Problem") pinned to the card's top
 * edge. Pinned rather than in the flow so a card never changes height when its state
 * does: the zone backdrop around it would otherwise breathe with every event.
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

/**
 * The glow on a machine that is doing something (uiux-spec.md §5.4, "What is happening
 * now"). A soft halo in the state's own token, on top of the outline that already carries
 * the state without colour, so it only ever adds emphasis.
 */
const GLOW: Record<NodeState, string | undefined> = {
  idle: undefined,
  processing: 'shadow-[0_0_28px_color-mix(in_oklab,var(--state-warn)_30%,transparent)]',
  active: 'shadow-[0_0_28px_color-mix(in_oklab,var(--accent)_35%,transparent)]',
  error: 'shadow-[0_0_28px_color-mix(in_oklab,var(--state-error)_35%,transparent)]',
};

export interface NodeShellProps {
  node: SimNode;
  state: NodeState;
  selected: boolean;
  /**
   * The family-specific body: layer badge, addresses, whatever else the kind needs.
   * Full detail only.
   */
  children?: ReactNode;
}

function Handles() {
  return HANDLE_SIDES.map((side) => (
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
  ));
}

export function NodeShell({ node, state, selected, children }: NodeShellProps) {
  const detail = useCanvasDetail();
  const dimmed = useDimmedNodes().has(node.id) && !selected;
  const kind = nodeKindToken(node.kind);
  const status = nodeStateToken(state);
  const KindIcon = kind.icon;
  const StatusIcon = status.icon;
  const simple = detail === 'simple';

  const frame = cn(
    'bg-surface-raised border-border relative flex w-full flex-col border',
    dimmed && 'opacity-25',
    FAMILY_SHAPE[kind.family],
    status.outline,
    // Selection is a ring rather than another outline, so it can show at the same
    // time as the state outline instead of overriding it.
    selected && 'ring-accent-strong ring-2',
  );

  if (simple) {
    const plainRole = plainRoleOf(node);
    return (
      <div
        data-state={state}
        data-kind={node.kind}
        data-detail="simple"
        data-dimmed={dimmed || undefined}
        className={cn(frame, 'justify-center px-3 py-3', GLOW[state])}
      >
        <Handles />
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="bg-surface-overlay text-fg border-border flex size-8 shrink-0 items-center justify-center rounded-lg border"
          >
            <KindIcon className="size-5" strokeWidth={1.75} />
          </span>
          <span className="min-w-0 flex-1">
            <span
              className="text-fg text-body line-clamp-2 block leading-tight font-semibold break-words"
              title={node.label}
            >
              {node.label}
            </span>
            <span className="text-fg-muted text-small block truncate" title={plainRole}>
              {plainRole}
            </span>
          </span>
        </div>
        {state === 'idle' ? null : (
          <span
            className={cn(
              'bg-surface-overlay text-caption absolute -top-3 right-3 flex items-center gap-1 rounded-full border px-2 py-px font-semibold',
              status.chip,
            )}
          >
            <StatusIcon aria-hidden="true" className="size-3" strokeWidth={2.25} />
            {status.plainLabel}
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      data-state={state}
      data-kind={node.kind}
      data-detail="full"
      data-dimmed={dimmed || undefined}
      className={cn(frame, 'gap-2 px-3 py-2.5')}
    >
      <Handles />
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
          <span className="text-fg-muted text-caption block tracking-wider uppercase">
            {kind.roleLabel}
          </span>
        </span>
        <span
          className={cn(
            'text-caption flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px font-medium',
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
