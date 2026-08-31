/**
 * Typed accessors for the design tokens that carry meaning.
 *
 * Layer colours are the one palette every module shares: a "transport layer" thing is
 * the same colour in Packet Journey, the Internet Simulator, and the Learning Center.
 * Modules must never write `--layer-transport` (or worse, a hex) by hand — they go
 * through `layerColor()` so the mapping can only ever change in one place.
 *
 * Colour is never the only signal: every accessor here ships a `short` label
 * (`L2`..`L7`) and a full `label`, and layer-coloured UI is required to render one of
 * them alongside the colour.
 *
 * Values live in `src/styles/tokens.css`; this file returns `var(--…)` references, so
 * it stays framework-free and works in any rendering context.
 */

export const LAYER_KEYS = [
  'link',
  'network',
  'transport',
  'session',
  'application',
] as const;

export type LayerKey = (typeof LAYER_KEYS)[number];

export interface LayerToken {
  key: LayerKey;
  /** OSI layer number. Layer 6 (presentation) is folded into 7 for teaching purposes. */
  osi: 2 | 3 | 4 | 5 | 7;
  /** Short label shown next to the colour, e.g. `L4`. */
  short: string;
  /** Human label, e.g. `Transport`. */
  label: string;
  /** One line explaining what the layer does, for tooltips and legends. */
  description: string;
  /** The custom property name, without `var()`, e.g. `--layer-transport`. */
  cssVar: `--layer-${LayerKey}`;
  /** Ready-to-use CSS colour value, e.g. `var(--layer-transport)`. */
  color: string;
}

export const LAYERS: Record<LayerKey, LayerToken> = {
  link: {
    key: 'link',
    osi: 2,
    short: 'L2',
    label: 'Link',
    description:
      'Frames moving between two directly connected devices (Ethernet, Wi-Fi, ARP).',
    cssVar: '--layer-link',
    color: 'var(--layer-link)',
  },
  network: {
    key: 'network',
    osi: 3,
    short: 'L3',
    label: 'Network',
    description: 'Addressing and routing packets across networks (IP, ICMP).',
    cssVar: '--layer-network',
    color: 'var(--layer-network)',
  },
  transport: {
    key: 'transport',
    osi: 4,
    short: 'L4',
    label: 'Transport',
    description: 'End-to-end delivery: ports, reliability, and flow control (TCP, UDP).',
    cssVar: '--layer-transport',
    color: 'var(--layer-transport)',
  },
  session: {
    key: 'session',
    osi: 5,
    short: 'L5',
    label: 'Session',
    description:
      'Establishing and securing a conversation (TLS handshake, WebSocket upgrade).',
    cssVar: '--layer-session',
    color: 'var(--layer-session)',
  },
  application: {
    key: 'application',
    osi: 7,
    short: 'L7',
    label: 'Application',
    description: 'What the user actually asked for (HTTP, DNS queries, APIs).',
    cssVar: '--layer-application',
    color: 'var(--layer-application)',
  },
};

/** Every layer token in OSI order, for legends and pickers. */
export const LAYER_LIST: readonly LayerToken[] = LAYER_KEYS.map((key) => LAYERS[key]);

/** Narrow an unknown value (a route param, a scenario file field) to a `LayerKey`. */
export function isLayerKey(value: unknown): value is LayerKey {
  return typeof value === 'string' && (LAYER_KEYS as readonly string[]).includes(value);
}

export function getLayer(key: LayerKey): LayerToken {
  return LAYERS[key];
}

/** `var(--layer-…)` — assign to `color`, `borderColor`, `fill`, `stroke`, … */
export function layerColor(key: LayerKey): string {
  return LAYERS[key].color;
}

/** `Transport` */
export function layerLabel(key: LayerKey): string {
  return LAYERS[key].label;
}

/** `L4` — the non-colour signal that must accompany any layer-coloured element. */
export function layerShortLabel(key: LayerKey): string {
  return LAYERS[key].short;
}

/**
 * A translucent wash of the layer colour, for chip and row backgrounds.
 * Kept here so no component hand-writes a `color-mix()` against a layer token.
 */
export function layerTint(key: LayerKey, percent = 14): string {
  return `color-mix(in oklab, ${layerColor(key)} ${percent}%, transparent)`;
}
