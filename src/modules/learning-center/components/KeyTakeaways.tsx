import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * The three-to-five sentences a reader should still have next week.
 *
 * Every lesson ends with one of these. It is not a summary of the lesson -- a summary
 * would be the lesson again, shorter -- it is the small set of claims the lesson exists
 * to install, written so each one survives on its own.
 *
 * ## Why `items` rather than a markdown list
 *
 * Because the count is part of the contract. Three to five: fewer and the lesson had no
 * point, more and nothing was chosen. An array is countable, so the rule is checkable
 * in development and in a test; a `<ul>` of children is just some elements. It also
 * makes each bullet a single string, which is the length a takeaway should be -- if one
 * needs a code fence to make its point, it is not a takeaway.
 */

/** The spec's budget, quoted from docs/implementation/13-module-learning-center.md. */
export const MIN_TAKEAWAYS = 3;
export const MAX_TAKEAWAYS = 5;

export interface KeyTakeawaysProps {
  /** Three to five short claims. */
  items: readonly ReactNode[];
  /** Overrides the heading, for the rare lesson that ends on something else. */
  title?: string;
  className?: string;
}

export function KeyTakeaways({
  items,
  title = 'Key takeaways',
  className,
}: KeyTakeawaysProps) {
  if (
    process.env.NODE_ENV !== 'production' &&
    (items.length < MIN_TAKEAWAYS || items.length > MAX_TAKEAWAYS)
  ) {
    // Loud in development, silent in production: a reader should never be shown a
    // scolding about the shape of a list, and an author should never miss it.
    console.warn(
      `KeyTakeaways: ${items.length} items. The budget is ${MIN_TAKEAWAYS}-${MAX_TAKEAWAYS} -- ` +
        'fewer means the lesson made no point, more means nothing was chosen.',
    );
  }

  return (
    <section
      aria-label={title}
      className={cn(
        'border-accent/30 bg-accent/[0.06] mt-12 rounded-xl border p-5',
        className,
      )}
    >
      <h2 className="text-accent text-xs font-medium tracking-widest uppercase">
        {title}
      </h2>

      <ul className="mt-4 flex flex-col gap-3">
        {items.map((item, index) => (
          <li
            key={index}
            className="text-fg-secondary flex gap-3 text-sm leading-relaxed"
          >
            <Check aria-hidden="true" className="text-accent mt-0.5 size-4 shrink-0" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
