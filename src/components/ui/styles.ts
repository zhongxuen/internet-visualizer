/**
 * Class fragments shared by more than one primitive.
 *
 * The focus ring is here rather than repeated per component so the phase 02 rule
 * "visible focus ring on every interactive element, tokenized" has exactly one
 * definition to change.
 */

export const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
