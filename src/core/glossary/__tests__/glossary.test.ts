import { describe, expect, it } from 'vitest';

import { MODULES } from '@/modules/registry';

import { EXTRA_TERMS_BY_MODULE, GLOSSARY, TERMS, type GlossaryTerm } from '../index';
import { INLINE_SPELLINGS, INLINE_TERMS, inlineTerm } from '../inline';
import { lookupTerm, sortedGlossary } from '../lookup';

function spellingsOf(entry: GlossaryTerm): Set<string> {
  // Within one entry the id and the term are usually the same word, which is fine.
  return new Set(
    [entry.id, entry.term, ...(entry.aliases ?? [])].map((s) => s.toLowerCase()),
  );
}

describe('the merged glossary', () => {
  it('has one extra file per registry module, and merges all of them after the base', () => {
    expect(Object.keys(EXTRA_TERMS_BY_MODULE)).toEqual(MODULES.map((m) => m.id));
    expect(GLOSSARY).toEqual([...TERMS, ...Object.values(EXTRA_TERMS_BY_MODULE).flat()]);
    expect(TERMS).toHaveLength(62);
  });

  /**
   * The rule that lets ten module passes add terms in parallel: across the base list and
   * every extra, no id repeats and no spelling answers to two entries. `lookupTerm`
   * returns the first match, so the loser of a collision would silently never appear.
   * The label says which file each claim came from.
   */
  it('has unique ids, terms and aliases across the base and every extra', () => {
    const sources: [string, readonly GlossaryTerm[]][] = [
      ['terms.ts', TERMS],
      ...Object.entries(EXTRA_TERMS_BY_MODULE).map(
        ([id, terms]) => [`extra/${id}.ts`, terms] as [string, readonly GlossaryTerm[]],
      ),
    ];

    const ids = new Map<string, string>();
    const claimedBy = new Map<string, string>();
    for (const [file, terms] of sources) {
      for (const entry of terms) {
        const label = `${file}#${entry.id}`;
        expect(ids.get(entry.id), `id "${entry.id}" in ${label}`).toBeUndefined();
        ids.set(entry.id, label);

        for (const spelling of spellingsOf(entry)) {
          const owner = claimedBy.get(spelling);
          expect(
            owner,
            `"${spelling}" is claimed by both ${owner} and ${label}`,
          ).toBeUndefined();
          claimedBy.set(spelling, label);
        }
      }
    }
    expect(ids.size).toBe(GLOSSARY.length);
  });

  /** A popover is one sentence. Anything longer belongs in `definition`. */
  it('keeps the popover short and the entry longer', () => {
    for (const entry of GLOSSARY) {
      expect(entry.short.length, `${entry.id}: short`).toBeLessThanOrEqual(200);
      expect(entry.definition.length, `${entry.id}: definition`).toBeGreaterThan(
        entry.short.length,
      );
    }
  });
});

describe('lookupTerm', () => {
  it('finds a term by id, by spelling, and by alias, in any case', () => {
    expect(lookupTerm('ip-address')?.id).toBe('ip-address');
    expect(lookupTerm('IP Address')?.id).toBe('ip-address');
    expect(lookupTerm('  PACKETS ')?.id).toBe('packet');
    expect(lookupTerm('nonsense')).toBeUndefined();
    expect(lookupTerm('')).toBeUndefined();
    expect(lookupTerm('   ')).toBeUndefined();
  });

  it('lists terms alphabetically without reordering the source', () => {
    const before = GLOSSARY.map((t) => t.id);
    const sorted = sortedGlossary();

    expect(sorted.map((t) => t.term)).toEqual(
      [...GLOSSARY.map((t) => t.term)].sort((a, b) => a.localeCompare(b)),
    );
    // `GLOSSARY` is the authoring order and several other things read it; an in-place
    // `.sort()` here would quietly reorder all of them.
    expect(GLOSSARY.map((t) => t.id)).toEqual(before);
  });
});

describe('the inline index', () => {
  it('answers to every spelling lookupTerm answers to, with the same entry', () => {
    for (const entry of GLOSSARY) {
      for (const spelling of spellingsOf(entry)) {
        expect(INLINE_TERMS.get(spelling), spelling).toEqual({
          slug: entry.id,
          term: entry.term,
          short: entry.short,
        });
        expect(lookupTerm(spelling)?.id).toBe(entry.id);
      }
    }
    expect(INLINE_TERMS.size).toBe(
      GLOSSARY.reduce((total, entry) => total + spellingsOf(entry).size, 0),
    );
  });

  it('carries nothing a popover does not show', () => {
    expect(Object.keys(inlineTerm('TTL')!).sort()).toEqual(['short', 'slug', 'term']);
  });

  it('keeps every spelling with its capitals, for matching text where case matters', () => {
    const expected = GLOSSARY.flatMap((entry) =>
      [entry.id, entry.term, ...(entry.aliases ?? [])].map((spelling) => ({
        spelling,
        slug: entry.id,
      })),
    );
    expect(
      INLINE_SPELLINGS.map(({ spelling, entry }) => ({ spelling, slug: entry.slug })),
    ).toEqual(expected);
    for (const { spelling, entry } of INLINE_SPELLINGS) {
      expect(INLINE_TERMS.get(spelling.toLowerCase())).toEqual(entry);
    }
  });

  it('resolves in any case and ignores surrounding space', () => {
    expect(inlineTerm('  dns ')?.slug).toBe('dns');
    expect(inlineTerm('Domain Name System')?.slug).toBe('dns');
    expect(inlineTerm('nonsense')).toBeUndefined();
  });
});
