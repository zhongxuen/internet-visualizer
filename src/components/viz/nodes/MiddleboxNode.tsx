import type { NodeProps } from '@xyflow/react';

import type { TopologyFlowNode } from '../types';

import { AddressList } from './AddressList';
import { DetailNote } from './DetailNote';
import { LayerNote } from './LayerNote';
import { NodeShell } from './NodeShell';

/** What the box decides with, in order of usefulness. */
const POLICY_KEYS = ['policy', 'algorithm', 'mode', 'rule'] as const;

/**
 * Boxes that sit in the path and change what happens to a flow: `firewall`,
 * `load-balancer`, `proxy`.
 *
 * The whole point of a middlebox is its rule — which backend, which policy, whether the
 * packet survives — so the policy line is drawn before the addresses. Their family
 * silhouette carries a thick left edge, the visual "traffic hits a wall here".
 */
export function MiddleboxNode({ data, selected }: NodeProps<TopologyFlowNode>) {
  return (
    <NodeShell node={data.node} state={data.state} selected={selected}>
      <LayerNote kind={data.node.kind} />
      <DetailNote node={data.node} keys={POLICY_KEYS} />
      <AddressList node={data.node} />
    </NodeShell>
  );
}
