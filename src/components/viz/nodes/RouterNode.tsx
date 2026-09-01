import type { NodeProps } from '@xyflow/react';

import type { TopologyFlowNode } from '../types';

import { AddressList } from './AddressList';
import { LayerNote } from './LayerNote';
import { NodeShell } from './NodeShell';

/**
 * Forwarding boxes: `router`, `switch`, `nat`.
 *
 * These are the machines whose behaviour depends most on which layer they work at, so
 * the layer badge leads — `L2 Forwards frames` for a switch, `L3 Routes packets` for a
 * router. A switch drawn with only a MAC and no IP is not a missing address: it is the
 * scenario saying the box is transparent at layer 3, and `AddressList` renders exactly
 * what the `SimNode` carries.
 */
export function RouterNode({ data, selected }: NodeProps<TopologyFlowNode>) {
  return (
    <NodeShell node={data.node} state={data.state} selected={selected}>
      <LayerNote kind={data.node.kind} />
      <AddressList node={data.node} />
    </NodeShell>
  );
}
