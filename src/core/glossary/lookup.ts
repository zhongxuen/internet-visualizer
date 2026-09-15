import { GLOSSARY, type GlossaryTerm } from './index';

/**
 * Find a term by id, by its display spelling, or by an alias.
 *
 * Case-insensitive, because a sentence writes a term in whatever case it needs.
 * `undefined` rather than a throw: an unrecognised term must degrade to plain text,
 * never take a page down.
 */
export function lookupTerm(key: string): GlossaryTerm | undefined {
  const needle = key.trim().toLowerCase();
  if (!needle) return undefined;

  return GLOSSARY.find(
    (entry) =>
      entry.id.toLowerCase() === needle ||
      entry.term.toLowerCase() === needle ||
      entry.aliases?.some((alias) => alias.toLowerCase() === needle),
  );
}

/** The glossary in alphabetical order, which is the only order a glossary may be in. */
export function sortedGlossary(): GlossaryTerm[] {
  return [...GLOSSARY].sort((a, b) => a.term.localeCompare(b.term));
}
