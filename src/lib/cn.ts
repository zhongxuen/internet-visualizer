import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * The named steps of the type scale and the hit-target sizes in `src/styles/tokens.css`.
 *
 * tailwind-merge knows only Tailwind's stock theme, and it reads a `text-*` class it does
 * not recognise as a *colour*. Unregistered, `cn('text-fg-muted', 'text-caption')` would
 * decide the two conflict and silently drop the colour. `tests/type-scale.test.ts` reads
 * the scale out of tokens.css and fails if a step is missing here.
 */
export const TYPE_SCALE = [
  'caption',
  'small',
  'body',
  'lead',
  'story',
  'title',
  'display',
];
export const TARGET_SIZES = ['target', 'target-floor'];

const twMerge = extendTailwindMerge({
  extend: { theme: { text: TYPE_SCALE, spacing: TARGET_SIZES } },
});

/**
 * Merge Tailwind class names, resolving conflicts so the last class wins.
 * `cn('p-2', condition && 'p-4')` -> `'p-4'` rather than both.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
