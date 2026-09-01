import type { NodeProps } from '@xyflow/react';

import type { NodeKind } from '@/core/types/topology';
import { cn } from '@/lib/cn';

import type { TopologyFlowNode } from '../types';

import { AddressList } from './AddressList';
import { NodeShell } from './NodeShell';

/**
 * The delegation chain, drawn on every DNS server.
 *
 * A DNS diagram is confusing until you can see *where in the hierarchy* each server
 * sits, and that is the one fact an icon cannot carry: root, TLD, and authoritative
 * servers all do the same job at different heights. The rail shows all three rungs on
 * every one of them with the current rung marked, so the referral chain reads off the
 * canvas without playback.
 *
 * A recursive resolver is not on the chain at all — it is the client's agent that walks
 * it — so it gets no rail, which is itself the teaching point.
 */
const CHAIN: readonly { kind: NodeKind; label: string }[] = [
  { kind: 'dns-root', label: 'Root' },
  { kind: 'dns-tld', label: 'TLD' },
  { kind: 'dns-authoritative', label: 'Zone' },
];

function TierRail({ kind }: { kind: NodeKind }) {
  const index = CHAIN.findIndex((rung) => rung.kind === kind);
  if (index < 0) return null;

  return (
    <ol
      aria-label={`DNS hierarchy: ${CHAIN[index].label}`}
      className="flex items-center gap-1"
    >
      {CHAIN.map((rung, position) => {
        const here = position === index;
        return (
          <li
            key={rung.kind}
            aria-current={here ? 'step' : undefined}
            className={cn(
              'flex flex-1 items-center gap-1 rounded-sm border px-1 py-px text-[0.5625rem] tracking-wide uppercase',
              here
                ? 'border-accent/60 text-accent font-semibold'
                : 'border-border/60 text-fg-muted',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                here ? 'bg-accent' : 'border-border border',
              )}
            />
            {rung.label}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The four DNS roles: `dns-resolver`, `dns-root`, `dns-tld`, `dns-authoritative`.
 *
 * Instead of the layer badge every other family carries — every one of these is L7, so
 * the badge would say nothing — a DNS server shows its rung in the delegation chain.
 */
export function DnsNode({ data, selected }: NodeProps<TopologyFlowNode>) {
  return (
    <NodeShell node={data.node} state={data.state} selected={selected}>
      <TierRail kind={data.node.kind} />
      <AddressList node={data.node} />
    </NodeShell>
  );
}
