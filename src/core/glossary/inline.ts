import { GLOSSARY } from './index';

/**
 * The compact index a popover needs: every spelling of every term, mapped to the entry's
 * anchor, its display spelling and its one-sentence `short`. The only glossary file an
 * inline term should import (docs/implementation/uiux.md §5.6); the full entries belong
 * to the glossary page.
 */
export interface InlineTerm {
  /** The entry's id, which is also its anchor on `/learn/glossary`. */
  slug: string;
  /** How the glossary writes the term. */
  term: string;
  /** The one-sentence definition. */
  short: string;
}

function buildIndex(): ReadonlyMap<string, InlineTerm> {
  const index = new Map<string, InlineTerm>();
  for (const entry of GLOSSARY) {
    const inline: InlineTerm = { slug: entry.id, term: entry.term, short: entry.short };
    for (const spelling of [entry.id, entry.term, ...(entry.aliases ?? [])]) {
      const key = spelling.toLowerCase();
      // First claim wins, matching `lookupTerm`; the uniqueness test keeps there from being
      // a second.
      if (!index.has(key)) index.set(key, inline);
    }
  }
  return index;
}

/** Lower-cased id, term or alias → the term it names. */
export const INLINE_TERMS: ReadonlyMap<string, InlineTerm> = buildIndex();

/** Resolve one spelling, in any case and ignoring surrounding space. */
export function inlineTerm(key: string): InlineTerm | undefined {
  return INLINE_TERMS.get(key.trim().toLowerCase());
}
