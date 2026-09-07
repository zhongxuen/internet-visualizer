'use client';

import { Children, isValidElement, type ReactNode } from 'react';

import { Tooltip } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';

import { lookupTerm } from '../content/glossary';

/**
 * A glossary term, wherever it appears.
 *
 * `<Term>packet</Term>` in any lesson gets the same sentence, because both this and
 * the glossary page read `content/glossary.ts` and there is no second copy of a
 * definition anywhere in the product.
 *
 * ## Why a button, and why hover is not enough
 *
 * The trigger is a real `<button>`, so the definition is reachable by Tab and by tap,
 * not only by hovering a mouse over exactly the right word. That is the phase 02 rule
 * applied to content rather than to controls, and it is the only reason this is not a
 * `<span title>`.
 *
 * The popover is text and nothing else -- no links, no controls, `pointer-events:
 * none` courtesy of `Tooltip`. That is what lets it open on hover *and* on focus with
 * no pinning, no focus trap and no dismissal rules beyond blur and Escape: there is
 * never anything inside it to reach. The links to the lessons and modules that cover a
 * term live on the glossary page, which is where someone who wants to follow one is
 * going anyway.
 *
 * ## Failing softly
 *
 * A term with no glossary entry renders as ordinary text. A missing definition is a
 * content bug to fix in `glossary.ts`, not a reason for a paragraph to stop rendering
 * or to sprout a button that explains nothing -- and `content.test.ts` is what catches
 * it, rather than a reader.
 */

export interface TermProps {
  /**
   * Glossary id, when the word in the sentence is not the entry's spelling. Usually
   * unnecessary: the text is looked up directly, and `aliases` covers plurals.
   */
  id?: string;
  children: ReactNode;
}

/** The visible text of the term, so `<Term>packets</Term>` can be looked up as written. */
function textOf(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

export function Term({ id, children }: TermProps) {
  const entry = lookupTerm(id ?? textOf(Children.toArray(children)));

  if (!entry) return <>{children}</>;

  return (
    <Tooltip
      content={
        <>
          <span className="text-fg block font-medium">{entry.term}</span>
          <span className="mt-1 block">{entry.short}</span>
        </>
      }
    >
      <button
        type="button"
        // `decoration-dotted` rather than colour alone: the affordance has to survive
        // being read in greyscale, same rule as every badge in the product.
        className={cn(
          'text-fg cursor-help rounded-sm underline decoration-dotted decoration-from-font underline-offset-4',
          'hover:decoration-accent focus-visible:decoration-accent transition-colors',
          focusRing,
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}
