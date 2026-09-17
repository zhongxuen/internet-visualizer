import type { ReactNode } from 'react';

import { GlossaryTerm } from '@/components/glossary/GlossaryTerm';

/**
 * `<Term>` in a lesson: a thin wrapper over the product-wide `GlossaryTerm`, kept so that
 * no lesson's MDX has to change (uiux-spec.md §5.6).
 *
 * A lesson's words and a module screen's words open the same popover with the same
 * sentence, because both read `@/core/glossary` and there is no second copy of a
 * definition anywhere in the product. Everything about how the term behaves -- a button
 * rather than hover, the link to the glossary page, plain text for a word with no entry
 * -- is `GlossaryTerm`'s, and documented there. A missing entry is still a content bug,
 * and `content.test.ts` is what catches it rather than a reader.
 */

export interface TermProps {
  /**
   * Glossary id, when the word in the sentence is not the entry's spelling. Usually
   * unnecessary: the text is looked up directly, and `aliases` covers plurals.
   */
  id?: string;
  children: ReactNode;
}

export function Term({ id, children }: TermProps) {
  return <GlossaryTerm term={id}>{children}</GlossaryTerm>;
}
