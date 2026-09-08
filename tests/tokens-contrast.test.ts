import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { LAYER_KEYS, LAYERS } from '@/lib/theme';

/**
 * Phase 02 step 1 requires body text at >= 4.5:1 and large text / UI borders at >= 3:1
 * against the surface behind them. Asserting it here rather than in a one-off audit
 * means a future token tweak that quietly breaks contrast fails the build instead.
 */

const TOKENS_CSS = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');

/** Every `--name: #hex;` declaration inside one block of CSS. */
function parse(css: string): Record<string, string> {
  return Object.fromEntries(
    [...css.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map(([, name, value]) => [
      name,
      value.toLowerCase(),
    ]),
  );
}

/**
 * The first block only, deliberately.
 *
 * `tokens.css` has two rules that set colour custom properties: the base `:root` and the
 * `prefers-contrast: more` override beneath it. A regex over the whole file would let the
 * later block win on every duplicated name -- `Object.fromEntries` keeps the last -- and
 * the palette everyone actually sees would quietly stop being the palette under test.
 */
const [BASE_BLOCK = '', CONTRAST_BLOCK = ''] = TOKENS_CSS.split('@media').map((block) =>
  block.slice(0, block.indexOf('@theme') === -1 ? undefined : block.indexOf('@theme')),
);

const tokens = parse(BASE_BLOCK);
const contrastTokens = parse(CONTRAST_BLOCK);

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

const SURFACES = ['--bg-base', '--bg-raised', '--bg-overlay'] as const;

function worstCase(token: string): number {
  const value = tokens[token];
  expect(value, `${token} is missing from tokens.css`).toBeDefined();
  return Math.min(...SURFACES.map((s) => contrast(value, tokens[s])));
}

describe('token contrast against the dark surfaces', () => {
  const textTokens = [
    '--text-primary',
    '--text-secondary',
    '--text-muted',
    '--text-dim',
    '--accent',
    '--accent-strong',
    '--state-ok',
    '--state-warn',
    '--state-error',
    '--state-pending',
    ...LAYER_KEYS.map((key) => LAYERS[key].cssVar),
  ];

  it.each(textTokens)('%s reaches 4.5:1 on every surface', (token) => {
    expect(worstCase(token)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['--border', '--border-strong', '--focus-ring'])(
    '%s reaches 3:1 on every surface',
    (token) => {
      expect(worstCase(token)).toBeGreaterThanOrEqual(3);
    },
  );

  it('accent ink is readable on every filled accent or state surface', () => {
    for (const fill of ['--accent', '--accent-strong', '--state-error', '--state-ok']) {
      expect(contrast(tokens['--accent-ink'], tokens[fill])).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('the prefers-contrast override', () => {
  it('only moves tokens that already exist', () => {
    // Non-empty first: every assertion in this block is vacuous if the split above stops
    // finding the media query, and a silently empty guard is worse than none.
    expect(Object.keys(contrastTokens).length).toBeGreaterThan(0);

    for (const name of Object.keys(contrastTokens)) {
      expect(tokens[name], `${name} is not a base token`).toBeDefined();
    }
  });

  it('raises contrast on every token it touches, never lowers it', () => {
    // The point of the block. A "more contrast" preference that hands back a value
    // closer to the surface than the default would be worse than not honouring it.
    for (const [name, value] of Object.entries(contrastTokens)) {
      for (const surface of SURFACES) {
        expect(
          contrast(value, tokens[surface]),
          `${name} against ${surface}`,
        ).toBeGreaterThan(contrast(tokens[name], tokens[surface]));
      }
    }
  });

  it('leaves every colour that carries meaning exactly where it is', () => {
    // Layer hues and state colours are fixed for the life of the product; a user asking
    // for more contrast is not asking for "transport" to change colour.
    for (const name of [
      ...LAYER_KEYS.map((key) => LAYERS[key].cssVar),
      '--state-ok',
      '--state-warn',
      '--state-error',
      '--accent',
    ]) {
      expect(contrastTokens[name], `${name} must not be overridden`).toBeUndefined();
    }
  });
});

describe('theme.ts stays in sync with tokens.css', () => {
  it.each(LAYER_KEYS)('%s maps to a custom property that exists', (key) => {
    const layer = LAYERS[key];
    expect(tokens[layer.cssVar]).toBeDefined();
    expect(layer.color).toBe(`var(${layer.cssVar})`);
  });

  it('gives every layer a distinct colour and a distinct short label', () => {
    const colors = new Set(LAYER_KEYS.map((k) => tokens[LAYERS[k].cssVar]));
    const shorts = new Set(LAYER_KEYS.map((k) => LAYERS[k].short));
    expect(colors.size).toBe(LAYER_KEYS.length);
    expect(shorts.size).toBe(LAYER_KEYS.length);
  });
});
