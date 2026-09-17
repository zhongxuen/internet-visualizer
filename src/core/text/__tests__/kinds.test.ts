import { describe, expect, it } from 'vitest';

import type { NodeKind } from '../../types/topology';
import { PLAIN_KINDS, plainRoleOf } from '../kinds';
import { checkPlainStory } from '../plain';

/**
 * The §5.1.1 analogy table (docs/implementation/uiux.md), for the concepts that are a
 * kind of machine. These are the only analogies the product may use, so a kind's
 * analogy is asserted against the table's wording rather than merely required to exist.
 */
const TABLE: Partial<Record<NodeKind, string>> = {
  router: 'a sorting office passing parcels on',
  switch: "a building's internal mail room",
  'dns-resolver': 'a helper who looks up numbers for you',
  'cdn-edge': 'a nearby warehouse holding copies',
  'load-balancer': 'a receptionist sending you to a free desk',
  firewall: 'a guard at the door with a list of who may pass',
  nat: 'one street address for a whole building, with a front desk that remembers who ordered what',
};

const KINDS = Object.keys(PLAIN_KINDS) as NodeKind[];

describe('PLAIN_KINDS', () => {
  it('covers all thirteen kinds', () => {
    // `Record<NodeKind, …>` already refuses a missing kind at compile time; this pins the
    // count so a kind removed from the union is noticed here too.
    expect(KINDS).toHaveLength(13);
  });

  it('uses the shared analogy table and nothing else', () => {
    for (const kind of KINDS) {
      expect(PLAIN_KINDS[kind].analogy, kind).toBe(TABLE[kind]);
    }
  });

  it('writes every role and analogy as plain language', () => {
    for (const kind of KINDS) {
      const { plainRole, analogy } = PLAIN_KINDS[kind];
      expect(checkPlainStory(plainRole, { maxWords: 15 }), `${kind}: role`).toEqual([]);
      if (analogy) {
        expect(checkPlainStory(analogy, { maxWords: 20 }), `${kind}: analogy`).toEqual(
          [],
        );
      }
    }
  });

  it("prefers a node's own plain role over its kind's", () => {
    expect(plainRoleOf({ kind: 'router' })).toBe(PLAIN_KINDS.router.plainRole);
    expect(plainRoleOf({ kind: 'router', plainRole: 'Your home router' })).toBe(
      'Your home router',
    );
  });
});
