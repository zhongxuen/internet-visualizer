'use client';

import Link from 'next/link';
import { Children, isValidElement, type ReactNode } from 'react';

import { Popover } from '@/components/ui/Popover';
import { focusRing } from '@/components/ui/styles';
import type { InlineTerm } from '@/core/glossary/inline';
import { cn } from '@/lib/cn';

import { useInlineGlossary } from './useInlineGlossary';

/**
 * A word the glossary defines, wherever it appears: a dotted-underline button that opens
 * a `Popover` with the term, its one-sentence definition and a link to its entry on
 * `/learn/glossary` (uiux-spec.md §5.6).
 *
 * ## Why a Popover and not a Tooltip
 *
 * The panel holds a link, and a Tooltip is for a label (the rule at the top of
 * Tooltip.tsx). A Popover opens by tap, click, Enter or Space, moves focus into the panel
 * so Tab reaches the link, and returns focus to the word on Escape. Hover does not open
 * it: a box that closes when the pointer leaves the word could never be clicked into.
 *
 * ## Failing softly
 *
 * A word with no glossary entry renders as ordinary text, and so does every word until
 * the index has loaded (see `useInlineGlossary` for why it loads on demand, and why that
 * shifts nothing). A missing definition is a content bug to fix in `src/core/glossary/`,
 * never a reason for a sentence to stop rendering or sprout a button that explains
 * nothing.
 */

export interface GlossaryTermProps {
  /** The word as the sentence writes it. */
  children: ReactNode;
  /**
   * What to look up, when the words in the sentence are not a spelling of the entry: its
   * id, term or any alias. Defaults to the text of `children`.
   */
  term?: string;
  className?: string;
}

/** The visible text of the children, so `<GlossaryTerm>packets</GlossaryTerm>` can be looked up as written. */
export function textOf(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

/** `/learn/glossary#<id>`: each entry on the glossary page renders `id={entry.id}`. */
export function glossaryHref(entry: Pick<InlineTerm, 'slug'>) {
  return `/learn/glossary#${entry.slug}`;
}

export function GlossaryTerm({ children, term, className }: GlossaryTermProps) {
  const glossary = useInlineGlossary();
  const entry = glossary?.inlineTerm(term ?? textOf(Children.toArray(children)));

  if (!entry) return <>{children}</>;
  return (
    <GlossaryTermButton entry={entry} className={className}>
      {children}
    </GlossaryTermButton>
  );
}

/** The button and its popover, for a caller that has already resolved the entry. */
export function GlossaryTermButton({
  entry,
  children,
  className,
}: {
  entry: InlineTerm;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Popover
      trigger={children}
      triggerVariant="unstyled"
      triggerClassName={cn(
        // `decoration-dotted` rather than colour alone: the affordance has to survive
        // greyscale, the same rule as every badge in the product.
        'text-fg cursor-help rounded-sm underline decoration-dotted decoration-from-font underline-offset-4',
        'hover:decoration-accent focus-visible:decoration-accent transition-colors',
        className,
      )}
      side="top"
    >
      <span className="text-fg block font-medium">{entry.term}</span>
      <span className="mt-1 block">{entry.short}</span>
      <Link
        href={glossaryHref(entry)}
        className={cn(
          'text-accent hover:text-accent-strong mt-2 inline-block rounded-sm underline decoration-dotted underline-offset-4 transition-colors',
          focusRing,
        )}
      >
        Read more in the glossary
      </Link>
    </Popover>
  );
}
