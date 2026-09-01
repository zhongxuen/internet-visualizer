/**
 * The React Flow edge type table.
 *
 * One type, `'link'`: a `SimLink` is a `SimLink` regardless of what it connects, and the
 * differences that matter (medium, latency, bandwidth) are data the one component reads.
 * Frozen at module scope for the same reason as `nodeTypes` — a fresh object identity
 * makes React Flow rebuild every edge.
 */

import type { EdgeTypes } from '@xyflow/react';

import { LinkEdge } from './LinkEdge';

export const edgeTypes = { link: LinkEdge } satisfies EdgeTypes;

export { LinkEdge } from './LinkEdge';
export {
  DEFAULT_LINK_WIDTH,
  LINK_MEDIA,
  LINK_MEDIUM_LIST,
  linkMediumToken,
  type LinkMediumToken,
} from './media';
