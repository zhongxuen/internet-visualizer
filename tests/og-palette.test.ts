import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { LAYERS } from '@/lib/theme';
import { OG_LAYER_STRIP, OG_PALETTE } from '@/lib/ogPalette';

/**
 * The pin that makes `src/lib/ogPalette.ts` legal.
 *
 * That file duplicates a dozen hex values out of `tokens.css` because Satori cannot
 * resolve a custom property (the file says so at length). A duplicate is only safe
 * while something notices it drifting, and this is that something: change a token and
 * forget the card, and the failure names the token and both values.
 *
 * Parsing is deliberately the same shape as `tests/tokens-contrast.test.ts` -- the base
 * `:root` block only, before the `prefers-contrast: more` override, because that is the
 * palette the card is drawn from.
 */

const TOKENS_CSS = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');
const [BASE_BLOCK = ''] = TOKENS_CSS.split('@media');

const tokens: Record<string, string> = Object.fromEntries(
  [...BASE_BLOCK.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map(
    ([, name, value]) => [name, value!.toLowerCase()],
  ),
);

describe('the Open Graph palette', () => {
  it.each(Object.entries(OG_PALETTE))('%s matches tokens.css', (name, value) => {
    expect(tokens[name], `${name} is not declared in tokens.css`).toBeDefined();
    expect(value.toLowerCase()).toBe(tokens[name]);
  });

  it('draws the five layers in OSI order, each with its short label', () => {
    // The card is the product's first impression and follows the product's own rule:
    // a layer colour never appears without the L2..L7 label that survives greyscale.
    expect(OG_LAYER_STRIP.map((entry) => entry.short)).toEqual([
      'L2',
      'L3',
      'L4',
      'L5',
      'L7',
    ]);

    const fromTheme = Object.values(LAYERS)
      .sort((a, b) => a.osi - b.osi)
      .map((layer) => layer.short);
    expect(OG_LAYER_STRIP.map((entry) => entry.short)).toEqual(fromTheme);
  });
});
