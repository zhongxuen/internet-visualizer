/**
 * How each `LinkMedium` is drawn.
 *
 * A link's medium is carried by its **dash pattern and its icon**, not by colour: edges
 * keep one neutral stroke so that colour on the canvas stays reserved for node state and
 * for the OSI layer of whatever is travelling. Copper, radio, glass, and cellular are
 * then still distinguishable in greyscale and at any zoom where the label is unreadable.
 *
 * A link with no declared medium is drawn solid and unlabelled — the scenario did not
 * say, so neither do we.
 */

import { Antenna, Cable, Spline, Wifi, type LucideIcon } from 'lucide-react';

import type { LinkMedium } from '@/core/types/topology';

export interface LinkMediumToken {
  medium: LinkMedium;
  label: string;
  description: string;
  icon: LucideIcon;
  /** SVG `stroke-dasharray`; `undefined` means a solid stroke. */
  dash?: string;
  /** Stroke width in canvas units. Fiber is heavier because it carries more. */
  width: number;
}

export const LINK_MEDIA: Record<LinkMedium, LinkMediumToken> = {
  ethernet: {
    medium: 'ethernet',
    label: 'Ethernet',
    description: 'Copper, switched, and wired — the default inside a building.',
    icon: Cable,
    width: 2,
  },
  wifi: {
    medium: 'wifi',
    label: 'Wi-Fi',
    description: 'Radio over a shared medium: variable latency, collisions possible.',
    icon: Wifi,
    dash: '2 4',
    width: 2,
  },
  fiber: {
    medium: 'fiber',
    label: 'Fiber',
    description: 'Long-haul glass — the links between networks and across oceans.',
    icon: Spline,
    dash: '10 3',
    width: 3,
  },
  cellular: {
    medium: 'cellular',
    label: 'Cellular',
    description: 'Mobile radio to a base station, then into the operator core.',
    icon: Antenna,
    dash: '6 3',
    width: 2,
  },
};

export const LINK_MEDIUM_LIST: readonly LinkMediumToken[] = Object.values(LINK_MEDIA);

export function linkMediumToken(medium: LinkMedium | undefined): LinkMediumToken | null {
  return medium ? LINK_MEDIA[medium] : null;
}

/** Stroke width for a link, including the "medium not stated" case. */
export const DEFAULT_LINK_WIDTH = 2;
