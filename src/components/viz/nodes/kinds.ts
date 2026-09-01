/**
 * What each `NodeKind` looks like on the canvas.
 *
 * One table, read by every node component, so a kind's icon and wording cannot drift
 * between the network map, packet journey, and the inspector. Nothing here is a colour:
 * the kind of a machine is carried by its **icon plus its printed role**, never by a
 * hue — the palette is spent on OSI layers (`@/lib/theme`) and on node state
 * (`./state.ts`), which are the two things that actually change while a simulation runs.
 *
 * `family` groups kinds that share a body layout and therefore a component
 * (`DeviceNode`, `RouterNode`, `ServerNode`, `DnsNode`, `MiddleboxNode`). Silhouette
 * follows family, so a learner can tell "some kind of DNS server" from "some kind of
 * middlebox" at a glance, before reading anything.
 */

import {
  ArrowRightLeft,
  BookMarked,
  Cloud,
  Crown,
  Monitor,
  Network,
  Repeat,
  Router,
  Scale,
  Search,
  Server,
  Shield,
  Tag,
  type LucideIcon,
} from 'lucide-react';

import type { NodeKind } from '@/core/types/topology';
import type { LayerKey } from '@/lib/theme';

/** Kinds that share a body layout, and therefore a node component. */
export type NodeFamily = 'device' | 'router' | 'server' | 'dns' | 'middlebox';

export interface NodeKindToken {
  kind: NodeKind;
  family: NodeFamily;
  /** Printed on the node under its label — the non-colour signal of what this is. */
  roleLabel: string;
  /** One line for the tooltip, the legend, and later the inspector. */
  description: string;
  icon: LucideIcon;
  /**
   * The OSI layer this machine does its work at, shown as a `L2`..`L7` badge.
   * A switch forwards frames (L2), a router forwards packets (L3), a proxy speaks the
   * application protocol (L7) — the distinction is most of the teaching value.
   */
  layer: LayerKey;
  /** What it does at that layer, e.g. `'Forwards frames'`. Two or three words. */
  layerAction: string;
}

export const NODE_KINDS: Record<NodeKind, NodeKindToken> = {
  client: {
    kind: 'client',
    family: 'device',
    roleLabel: 'Client',
    description: "An end user's machine — the browser or CLI that starts the request.",
    icon: Monitor,
    layer: 'application',
    layerAction: 'Sends requests',
  },
  router: {
    kind: 'router',
    family: 'router',
    roleLabel: 'Router',
    description: 'Forwards packets between networks by IP address and decrements TTL.',
    icon: Router,
    layer: 'network',
    layerAction: 'Routes packets',
  },
  switch: {
    kind: 'switch',
    family: 'router',
    roleLabel: 'Switch',
    description: 'Moves frames within one segment by MAC address; invisible at layer 3.',
    icon: Network,
    layer: 'link',
    layerAction: 'Forwards frames',
  },
  nat: {
    kind: 'nat',
    family: 'router',
    roleLabel: 'NAT',
    description: 'Rewrites private source addresses and ports to one public address.',
    icon: Repeat,
    layer: 'network',
    layerAction: 'Rewrites addresses',
  },
  server: {
    kind: 'server',
    family: 'server',
    roleLabel: 'Server',
    description: 'The origin that terminates the application protocol and answers.',
    icon: Server,
    layer: 'application',
    layerAction: 'Serves the origin',
  },
  'cdn-edge': {
    kind: 'cdn-edge',
    family: 'server',
    roleLabel: 'CDN edge',
    description: 'A point of presence serving cached content close to the client.',
    icon: Cloud,
    layer: 'application',
    layerAction: 'Serves from cache',
  },
  'dns-resolver': {
    kind: 'dns-resolver',
    family: 'dns',
    roleLabel: 'Resolver',
    description: 'The recursive, caching resolver a client is configured to ask.',
    icon: Search,
    layer: 'application',
    layerAction: 'Resolves names',
  },
  'dns-root': {
    kind: 'dns-root',
    family: 'dns',
    roleLabel: 'Root server',
    description: 'Top of the DNS hierarchy: answers with referrals to TLD servers.',
    icon: Crown,
    layer: 'application',
    layerAction: 'Refers to TLDs',
  },
  'dns-tld': {
    kind: 'dns-tld',
    family: 'dns',
    roleLabel: 'TLD server',
    description: 'Owns a top-level domain and refers down to the authoritative server.',
    icon: Tag,
    layer: 'application',
    layerAction: 'Refers to zones',
  },
  'dns-authoritative': {
    kind: 'dns-authoritative',
    family: 'dns',
    roleLabel: 'Authoritative',
    description: 'Holds the zone itself — the final, non-referral answer for a name.',
    icon: BookMarked,
    layer: 'application',
    layerAction: 'Answers for the zone',
  },
  'load-balancer': {
    kind: 'load-balancer',
    family: 'middlebox',
    roleLabel: 'Load balancer',
    description: 'Spreads connections across a pool of backends.',
    icon: Scale,
    layer: 'transport',
    layerAction: 'Spreads connections',
  },
  proxy: {
    kind: 'proxy',
    family: 'middlebox',
    roleLabel: 'Proxy',
    description: "Terminates the request and re-issues it on the client's behalf.",
    icon: ArrowRightLeft,
    layer: 'application',
    layerAction: 'Relays requests',
  },
  firewall: {
    kind: 'firewall',
    family: 'middlebox',
    roleLabel: 'Firewall',
    description: 'Applies a traffic policy: permit, drop, or reset the flow.',
    icon: Shield,
    layer: 'network',
    layerAction: 'Enforces policy',
  },
};

/** Every kind in a stable order, for legends and pickers. */
export const NODE_KIND_LIST: readonly NodeKindToken[] = Object.values(NODE_KINDS);

export function nodeKindToken(kind: NodeKind): NodeKindToken {
  return NODE_KINDS[kind];
}

/**
 * The silhouette of each family. Corner treatment only — it has to survive being
 * scaled down by the canvas zoom, which rules out anything finer.
 */
export const FAMILY_SHAPE: Record<NodeFamily, string> = {
  device: 'rounded-2xl',
  router: 'rounded-sm',
  server: 'rounded-md',
  dns: 'rounded-tl-3xl rounded-br-3xl rounded-tr-sm rounded-bl-sm',
  middlebox: 'rounded-md border-l-4',
};
