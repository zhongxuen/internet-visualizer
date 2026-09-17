/**
 * What each kind of machine does, in plain words.
 *
 * `NodeKind` is behavioural -- it tells a simulation what a node does with a packet.
 * This is the same fact told to a beginner: one line of role, and for the kinds §5.1.1
 * of docs/implementation/uiux.md gives one, the product's single agreed analogy.
 *
 * The analogy is only ever a comparison ("passes messages on, like a sorting office"),
 * never a name for the machine, and it is copied from that table rather than invented:
 * ten module passes running in parallel must all teach the same picture. A kind with no
 * row in the table has no analogy here.
 *
 * A node's own `plainRole` overrides its kind's; see `plainRoleOf`.
 */

import type { NodeKind, SimNode } from '../types/topology';

export interface PlainKind {
  /** One line: what a machine of this kind does. */
  plainRole: string;
  /** What it is like, from §5.1.1, written to follow "like". */
  analogy?: string;
}

export const PLAIN_KINDS: Readonly<Record<NodeKind, PlainKind>> = {
  client: {
    plainRole: 'The device you are using, where every request starts',
  },
  router: {
    plainRole: 'Passes messages from one network to the next',
    analogy: 'a sorting office passing parcels on',
  },
  switch: {
    plainRole: 'Connects the machines inside one network to each other',
    analogy: "a building's internal mail room",
  },
  server: {
    plainRole: 'A computer that holds a website or service and answers requests',
  },
  'dns-resolver': {
    plainRole: "Finds the number (IP address) for a website's name, on your behalf",
    analogy: 'a helper who looks up numbers for you',
  },
  'dns-root': {
    plainRole: 'The top of the naming system, which knows who looks after each ending',
  },
  'dns-tld': {
    plainRole: 'Looks after every name with one ending, such as .com',
  },
  'dns-authoritative': {
    plainRole: "Holds the real answer for one website's name",
  },
  'cdn-edge': {
    plainRole: 'Keeps copies of a website close to you, so pages arrive sooner',
    analogy: 'a nearby warehouse holding copies',
  },
  'load-balancer': {
    plainRole: 'Spreads visitors across several servers, so none is overloaded',
    analogy: 'a receptionist sending you to a free desk',
  },
  proxy: {
    plainRole: "Takes requests on a website's behalf and passes them to the real server",
  },
  firewall: {
    plainRole: 'Checks what crosses into a network and blocks what is not allowed',
    analogy: 'a guard at the door with a list of who may pass',
  },
  nat: {
    plainRole:
      'Lets many devices share one public address, and remembers whose reply is whose',
    analogy:
      'one street address for a whole building, with a front desk that remembers who ordered what',
  },
};

/** The node's own plain role if its scenario wrote one, otherwise its kind's. */
export function plainRoleOf(node: Pick<SimNode, 'kind' | 'plainRole'>): string {
  return node.plainRole ?? PLAIN_KINDS[node.kind].plainRole;
}
