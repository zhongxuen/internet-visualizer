import { GLOSSARY } from './index';

/**
 * The compact index a popover needs: every spelling of every term, mapped to the entry's
 * anchor, its display spelling and its one-sentence `short`. The only glossary file an
 * inline term should import (docs/implementation/uiux.md §5.6); the full entries belong
 * to the glossary page.
 *
 * It is built from `GLOSSARY`, so importing it brings the definitions along too -- which
 * is why `GlossaryTerm` loads it on demand rather than putting it in a route's first load
 * (see `src/components/glossary/useInlineGlossary.ts`).
 */
export interface InlineTerm {
  /** The entry's id, which is also its anchor on `/learn/glossary`. */
  slug: string;
  /** How the glossary writes the term. */
  term: string;
  /** The one-sentence definition. */
  short: string;
}

/** One way of writing a term, exactly as the glossary writes it. */
export interface InlineSpelling {
  spelling: string;
  entry: InlineTerm;
}

function buildSpellings(): readonly InlineSpelling[] {
  return GLOSSARY.flatMap((entry) => {
    const inline: InlineTerm = { slug: entry.id, term: entry.term, short: entry.short };
    return [entry.id, entry.term, ...(entry.aliases ?? [])].map((spelling) => ({
      spelling,
      entry: inline,
    }));
  });
}

/**
 * Every id, term and alias with its capitals intact, in authoring order. What `TermText`
 * matches a string against: case matters there ("AS" is a term, "as" is a word), and the
 * map below has already lower-cased it away.
 */
export const INLINE_SPELLINGS: readonly InlineSpelling[] = buildSpellings();

function buildIndex(): ReadonlyMap<string, InlineTerm> {
  const index = new Map<string, InlineTerm>();
  for (const { spelling, entry } of INLINE_SPELLINGS) {
    const key = spelling.toLowerCase();
    // First claim wins, matching `lookupTerm`; the uniqueness test keeps there from being
    // a second.
    if (!index.has(key)) index.set(key, entry);
  }
  return index;
}

/** Lower-cased id, term or alias → the term it names. */
export const INLINE_TERMS: ReadonlyMap<string, InlineTerm> = buildIndex();

/** Resolve one spelling, in any case and ignoring surrounding space. */
export function inlineTerm(key: string): InlineTerm | undefined {
  return INLINE_TERMS.get(key.trim().toLowerCase());
}
