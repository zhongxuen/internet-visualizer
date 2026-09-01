import type { SimNode } from '@/core/types/topology';

/**
 * One fact from `SimNode.detail`, printed on the node.
 *
 * `detail` is free-form and its full contents belong in the inspector — but a couple of
 * keys change what a box *is* rather than merely describing it (the policy a firewall
 * enforces, the service an origin runs), and those are worth the two lines of space.
 *
 * The first key present wins, so a scenario chooses the emphasis by which key it sets;
 * nothing is rendered when none of them is there.
 */
export interface DetailNoteProps {
  node: SimNode;
  /** Candidate keys, most specific first. */
  keys: readonly string[];
}

export function DetailNote({ node, keys }: DetailNoteProps) {
  const key = keys.find((candidate) => node.detail?.[candidate]);
  if (!key) return null;

  return (
    <p className="text-fg-muted truncate text-[0.6875rem]" title={node.detail?.[key]}>
      <span className="tracking-wider uppercase">{key}</span>{' '}
      <span className="text-fg-secondary">{node.detail?.[key]}</span>
    </p>
  );
}
