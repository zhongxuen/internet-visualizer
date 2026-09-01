/**
 * The React Flow node type table.
 *
 * The type string **is** the `NodeKind`, one entry per kind with no fallback: adding a
 * kind to `src/core/types/topology.ts` fails to compile here until it has been given a
 * renderer, which is the point. Kinds that share a body layout share a component
 * (`./kinds.ts` calls that grouping the *family*); the icon, role word, layer badge, and
 * silhouette still differ per kind, from the table in `./kinds.ts`.
 *
 * Frozen at module scope because React Flow re-creates every node when `nodeTypes`
 * changes identity — building this object inside a component would re-mount the whole
 * diagram on each render.
 */

import type { NodeTypes } from '@xyflow/react';

import type { NodeKind } from '@/core/types/topology';

import { DeviceNode } from './DeviceNode';
import { DnsNode } from './DnsNode';
import { MiddleboxNode } from './MiddleboxNode';
import { RouterNode } from './RouterNode';
import { ServerNode } from './ServerNode';

export const nodeTypes = {
  client: DeviceNode,
  router: RouterNode,
  switch: RouterNode,
  nat: RouterNode,
  server: ServerNode,
  'cdn-edge': ServerNode,
  'dns-resolver': DnsNode,
  'dns-root': DnsNode,
  'dns-tld': DnsNode,
  'dns-authoritative': DnsNode,
  'load-balancer': MiddleboxNode,
  proxy: MiddleboxNode,
  firewall: MiddleboxNode,
} satisfies Record<NodeKind, NodeTypes[string]>;

export { AddressList, type AddressListProps } from './AddressList';
export { DetailNote, type DetailNoteProps } from './DetailNote';
export { DeviceNode } from './DeviceNode';
export { DnsNode } from './DnsNode';
export { LayerNote, type LayerNoteProps } from './LayerNote';
export { MiddleboxNode } from './MiddleboxNode';
export { NodeShell, type NodeShellProps } from './NodeShell';
export { RouterNode } from './RouterNode';
export { ServerNode } from './ServerNode';
export {
  HANDLE_SIDES,
  OPPOSITE_SIDE,
  sourceHandleId,
  targetHandleId,
  type HandleSide,
} from './handles';
export {
  FAMILY_SHAPE,
  NODE_KIND_LIST,
  NODE_KINDS,
  nodeKindToken,
  type NodeFamily,
  type NodeKindToken,
} from './kinds';
export {
  NODE_STATE_LIST,
  NODE_STATES,
  nodeStateToken,
  type NodeStateToken,
} from './state';
