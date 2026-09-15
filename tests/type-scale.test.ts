import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import { cn, TARGET_SIZES, TYPE_SCALE } from '@/lib/cn';

/**
 * "Nothing on screen smaller than 12px", asserted rather than remembered.
 *
 * Before the UI/UX restructure (docs/implementation/uiux.md §3.5) about 530 font sizes in
 * `src` were arbitrary values between 8px and 11px, and there was no token to raise them
 * in one place. They now all say `text-caption`, the floor of the type scale in
 * `src/styles/tokens.css`, and this file keeps it that way: any font size written as a
 * literal under 0.75rem or 12px, in any `.ts`, `.tsx` or `.css` file under `src`, fails
 * with its file and line.
 *
 * There is no allowlist, on purpose. A size that has to be smaller than the floor is a
 * design question for the scale, not an exception for this test.
 *
 * What it cannot see: a size relative to its parent (`em`, `%`), a transform that scales
 * text down, and third-party stylesheets. The one `em` size in `src` is clamped with
 * `max(…, var(--text-caption))`, and React Flow's 10px attribution is overridden in
 * `globals.css`.
 */

const SRC = join(process.cwd(), 'src');
const FLOOR = { rem: 0.75, px: 12 } as const;

/**
 * Every way `src` writes a literal font size, each capturing the number and its unit.
 * A unitless `fontSize` is pixels, as React and SVG both read it.
 */
const PATTERNS: readonly RegExp[] = [
  // Tailwind arbitrary values: `text-[0.625rem]`, `text-[length:10px]`.
  /text-\[(?:length:)?(\d*\.?\d+)(rem|px)\]/g,
  // CSS declarations and the type scale's own tokens: `font-size: 10px`, `--text-x: 0.6rem`.
  /(?:font-size|--text-[a-z0-9]+)\s*:\s*(\d*\.?\d+)(rem|px)/g,
  // React style objects and SVG props: `fontSize: 10`, `fontSize={9}`, `fontSize: '0.6rem'`.
  /fontSize\s*[:=]\s*\{?\s*['"`]?(\d*\.?\d+)(rem|px)?/g,
];

interface Violation {
  readonly at: string;
  readonly size: string;
}

function tooSmall(value: string, unit: string | undefined): boolean {
  const n = Number(value);
  return unit === 'rem' ? n < FLOOR.rem : n < FLOOR.px;
}

/** Every literal size under the floor in one file's text, with its line. */
function scan(text: string, file: string): Violation[] {
  const found: Violation[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    for (const pattern of PATTERNS) {
      for (const [match, value, unit] of line.matchAll(pattern)) {
        if (tooSmall(value, unit))
          found.push({ at: `${file}:${index + 1}`, size: match });
      }
    }
  });
  return found;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(entry.name) ? [path] : [];
  });
}

describe('the 12px floor', () => {
  const files = sourceFiles(SRC);

  it('scans the whole of src', () => {
    // A guard against a vacuous pass: a wrong root or a broken glob finds nothing to fail.
    expect(files.length).toBeGreaterThan(300);
    expect(files.some((file) => file.endsWith('tokens.css'))).toBe(true);
  });

  it('has no font size under 0.75rem or 12px anywhere in src', () => {
    const violations = files.flatMap((file) =>
      scan(
        readFileSync(file, 'utf8'),
        relative(process.cwd(), file).replaceAll('\\', '/'),
      ),
    );

    expect(
      violations.map((v) => `${v.at}  ${v.size}`),
      'Use text-caption (the floor) or a larger step of the type scale in src/styles/tokens.css',
    ).toEqual([]);
  });

  it('catches every form it claims to, and passes the floor itself', () => {
    const fixture = [
      '<p className="text-[0.625rem]">',
      '<p className="md:text-[11px]">',
      '<p className="text-[length:0.7rem]">',
      '.x { font-size: 10px; }',
      '--text-tiny: 0.6rem;',
      '<text fontSize={9}>',
      "style={{ fontSize: '0.5rem' }}",
      // Not violations: the floor, larger sizes, relative sizes, line heights, colours.
      '<p className="text-[0.75rem] text-[12px] text-xs text-caption">',
      '<p className="text-[length:max(0.85em,var(--text-caption))]">',
      '--text-caption: 0.75rem;',
      '--text-caption--line-height: 1rem;',
      '--text-dim: #7b889d;',
      'fontSize: 26,',
    ].join('\n');

    expect(scan(fixture, 'fixture').map((v) => v.at)).toEqual([
      'fixture:1',
      'fixture:2',
      'fixture:3',
      'fixture:4',
      'fixture:5',
      'fixture:6',
      'fixture:7',
    ]);
  });
});

describe('the type scale', () => {
  const tokens = readFileSync(join(SRC, 'styles/tokens.css'), 'utf8');
  const steps = [...tokens.matchAll(/--text-([a-z]+):\s*(\d*\.?\d+)rem\s*;/g)].map(
    ([, name, size]) => ({ name, rem: Number(size) }),
  );

  it('starts at the floor and only goes up', () => {
    expect(steps[0]).toEqual({ name: 'caption', rem: FLOOR.rem });
    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i].rem, steps[i].name).toBeGreaterThan(steps[i - 1].rem);
    }
  });

  it('gives every step a line height', () => {
    for (const { name } of steps) {
      expect(tokens, name).toMatch(new RegExp(`--text-${name}--line-height:`));
    }
  });

  /*
   * tailwind-merge reads an unknown `text-*` class as a colour, so a step missing from
   * `cn` would make `cn('text-fg-muted', 'text-<step>')` drop the colour without a word.
   */
  it('is registered with cn, so a size never replaces a colour', () => {
    expect(steps.map((step) => step.name)).toEqual(TYPE_SCALE);
    for (const name of TYPE_SCALE) {
      expect(cn('text-fg-muted', `text-${name}`)).toBe(`text-fg-muted text-${name}`);
      expect(cn('text-sm', `text-${name}`)).toBe(`text-${name}`);
    }
  });

  it('names both hit targets, and cn knows them as sizes', () => {
    expect(tokens).toMatch(/--target-min:\s*2\.75rem;/);
    expect(tokens).toMatch(/--target-floor:\s*1\.5rem;/);
    for (const name of TARGET_SIZES) {
      expect(tokens).toMatch(new RegExp(`--spacing-${name}:`));
      expect(cn('min-h-10', `min-h-${name}`)).toBe(`min-h-${name}`);
    }
  });
});
