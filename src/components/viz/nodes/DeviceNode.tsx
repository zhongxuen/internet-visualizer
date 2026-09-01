import type { NodeProps } from '@xyflow/react';

import type { TopologyFlowNode } from '../types';

import { AddressList } from './AddressList';
import { LayerNote } from './LayerNote';
import { NodeShell } from './NodeShell';

/**
 * End-user machines (`client`).
 *
 * The only family that is an endpoint rather than an intermediary, so its identity leads:
 * the full address set comes first, because following a packet means watching the source
 * MAC change at every hop while these source addresses stay put.
 */
export function DeviceNode({ data, selected }: NodeProps<TopologyFlowNode>) {
  return (
    <NodeShell node={data.node} state={data.state} selected={selected}>
      <AddressList node={data.node} />
      <LayerNote kind={data.node.kind} />
    </NodeShell>
  );
}
