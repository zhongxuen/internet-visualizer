import { describe, expect, it } from 'vitest';

import { LINK_MEDIUM_LIST } from '@/components/viz/edges/media';
import { NODE_KIND_LIST } from '@/components/viz/nodes/kinds';
import { NODE_STATE_LIST } from '@/components/viz/nodes/state';
import { LAYER_KEYS, LAYERS } from '@/lib/theme';

/**
 * "No meaning conveyed by colour alone", asserted rather than eyeballed.
 *
 * Section 2 of `docs/implementation/14-quality-and-deployment.md` asks for this to be
 * verified with a greyscale screenshot pass. That pass was run and is what found nothing
 * to fix -- but a screenshot proves the product was right on the day someone looked at it,
 * and this file proves it stays right. The three token tables below are the places the
 * product assigns a colour to a meaning, and each entry has to carry that meaning a second
 * way that survives greyscale:
 *
 *   - a **node state** carries it three more ways: a word, a distinct icon silhouette,
 *     and an outline whose *width and style* differ (hairline, dashed, solid, doubled),
 *     so the state is legible even where the chip text is too small to read.
 *   - a **node kind** prints its role in words on the card.
 *   - a **link medium** is drawn with its own dash pattern and stroke width.
 *   - an **OSI layer** always renders its `L2`..`L7` short label beside the colour.
 *
 * Distinctness is the property that matters, not presence: two states that both said
 * "Idle", or two media both drawn as a solid 2px line, would each pass a "has a label"
 * check and still be indistinguishable on a greyscale print.
 *
 * The layer check lives in `tokens-contrast.test.ts`, next to the colours it is about.
 */

/** By identity, so a table of icon *components* is compared the same way strings are. */
function duplicates(values: readonly unknown[]): number {
  return values.length - new Set(values).size;
}

describe('node state', () => {
  it('says which state it is in words', () => {
    expect(duplicates(NODE_STATE_LIST.map((token) => token.label))).toBe(0);
  });

  it('draws a different silhouette per state', () => {
    expect(duplicates(NODE_STATE_LIST.map((token) => token.icon))).toBe(0);
  });

  it('changes the shape of the node frame, not only its colour', () => {
    const outlines = NODE_STATE_LIST.map((token) => token.outline);
    expect(duplicates(outlines)).toBe(0);

    /*
     * Width or style, not just the colour utility inside the string. `outline-2
     * outline-state-warn` and `outline-2 outline-accent` differ only in hue and would be
     * one line to a greyscale reader, so the non-colour part of each outline has to be
     * unique on its own.
     */
    const shapes = outlines.map((outline) =>
      outline
        .split(' ')
        .filter((part) => !part.startsWith('outline-state-') && part !== 'outline-accent')
        .filter((part) => !part.startsWith('outline-border'))
        .sort()
        .join(' '),
    );
    expect(duplicates(shapes)).toBe(0);
  });
});

describe('node kind', () => {
  it('prints a distinct role label on every kind of machine', () => {
    expect(duplicates(NODE_KIND_LIST.map((token) => token.roleLabel))).toBe(0);
  });

  it('gives every kind its own icon', () => {
    expect(duplicates(NODE_KIND_LIST.map((token) => token.icon))).toBe(0);
  });
});

describe('link medium', () => {
  it('names every medium', () => {
    expect(duplicates(LINK_MEDIUM_LIST.map((token) => token.label))).toBe(0);
  });

  it('draws every medium with its own stroke, so the hop type survives greyscale', () => {
    // `dash` is `undefined` for a solid stroke, which is itself a distinct signature.
    const strokes = LINK_MEDIUM_LIST.map(
      (token) => `${token.dash ?? 'solid'}@${token.width}`,
    );
    expect(duplicates(strokes)).toBe(0);
  });
});

describe('OSI layer', () => {
  it('has a short label to print beside every layer colour', () => {
    for (const key of LAYER_KEYS) {
      expect(LAYERS[key].short, `${key} needs a printable short label`).toMatch(/^L\d$/);
    }
  });
});
