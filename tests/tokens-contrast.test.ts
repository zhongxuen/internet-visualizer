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

/** Every `--name: #hex;` declaration in tokens.css. */
const tokens: Record<string, string> = Object.fromEntries(
  [...TOKENS_CSS.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map(
    ([, name, value]) => [name, value.toLowerCase()],
  ),
);

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
