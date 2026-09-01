import type { NodeProps } from '@xyflow/react';

import type { TopologyFlowNode } from '../types';

import { AddressList } from './AddressList';
import { DetailNote } from './DetailNote';
import { LayerNote } from './LayerNote';
import { NodeShell } from './NodeShell';

/** Keys that say what this origin actually serves, in order of usefulness. */
const SERVICE_KEYS = ['service', 'software', 'port'] as const;

/**
 * Machines that answer requests: `server` and `cdn-edge`.
 *
 * Both terminate the application protocol, so the layer badge and the service line
 * ("what is running here") matter more than the address does — an origin is interesting
 * for what it serves, and a CDN edge for the fact that it answers instead of the origin.
 */
export function ServerNode({ data, selected }: NodeProps<TopologyFlowNode>) {
  return (
    <NodeShell node={data.node} state={data.state} selected={selected}>
      <LayerNote kind={data.node.kind} />
      <DetailNote node={data.node} keys={SERVICE_KEYS} />
      <AddressList node={data.node} />
    </NodeShell>
  );
}
