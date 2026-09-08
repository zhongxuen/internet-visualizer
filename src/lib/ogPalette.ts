/**
 * The one place in the product outside `tokens.css` that names a colour by value, and
 * why it has to exist.
 *
 * `tokens.css` rule 1 is "no raw hex outside this file", and everything that renders in
 * a browser obeys it -- a component reaches for `var(--accent)` and the value is
 * resolved by CSS. The Open Graph image is not rendered by a browser. `next/og` lays it
 * out with Satori, which implements a subset of CSS that has no custom properties and
 * no cascade: `var(--accent)` reaching Satori is not a colour, it is an unparseable
 * string, and the shape it was meant to paint comes out transparent.
 *
 * So the values are duplicated here, and `tests/og-palette.test.ts` asserts every one
 * of them still equals the token it was copied from. That keeps the property the rule
 * is actually protecting -- a colour can only change in one place -- while admitting
 * that this particular renderer cannot read that place. If a token changes and this
 * does not, the test fails and names the token.
 *
 * Only the handful of tokens the card actually draws are listed. Adding a colour to the
 * card means adding its token here and a row to the test, in that order.
 */

/** `--token-name` -> the literal value in `src/styles/tokens.css`. */
export const OG_PALETTE = {
  '--bg-base': '#07090d',
  '--bg-raised': '#0e131c',
  '--border': '#616e85',
  '--text-primary': '#e8eff8',
  '--text-secondary': '#b6c4d6',
  '--text-muted': '#8a99ae',
  '--accent': '#4cc2f1',
  '--layer-link': '#f0a44a',
  '--layer-network': '#6fdc8c',
  '--layer-transport': '#55d6e0',
  '--layer-session': '#a78bfa',
  '--layer-application': '#f58bc0',
} as const satisfies Record<string, string>;

export type OgPaletteToken = keyof typeof OG_PALETTE;

/**
 * The five layer colours in OSI order, which is the order the card draws them in.
 *
 * Same sequence as `LAYER_KEYS` in `src/lib/theme.ts`, and the card labels each dot
 * `L2`..`L7` for the same reason every layer-coloured thing in the product does: colour
 * is never the only signal, and an Open Graph card is seen by more people in greyscale
 * previews than most of the UI ever is.
 */
export const OG_LAYER_STRIP: readonly { readonly short: string; readonly hex: string }[] =
  [
    { short: 'L2', hex: OG_PALETTE['--layer-link'] },
    { short: 'L3', hex: OG_PALETTE['--layer-network'] },
    { short: 'L4', hex: OG_PALETTE['--layer-transport'] },
    { short: 'L5', hex: OG_PALETTE['--layer-session'] },
    { short: 'L7', hex: OG_PALETTE['--layer-application'] },
  ];
