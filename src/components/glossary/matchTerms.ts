import type { InlineSpelling, InlineTerm } from '@/core/glossary/inline';

/**
 * Where the glossary's words are in a plain string: the matching half of `TermText`, a
 * pure function so every rule can be tested without rendering anything.
 *
 * - **Case-insensitive**, so "Resolver" at the start of a sentence is still `resolver`.
 *   The one exception is a spelling written entirely in capitals ("AS", "CA", "IP"),
 *   which matches only in capitals: otherwise the alias `AS` would link the English word
 *   "as" in nearly every sentence.
 * - **Whole words only.** A match may not have a letter or digit on either side, so "DNS"
 *   never matches inside "DNSSEC" and "IP" never matches inside "IPv4". Punctuation is a
 *   boundary: "resolver's" and "(TTL)" both match.
 * - **Longest match wins.** At any position the longest spelling that fits is taken, so
 *   "recursive resolver" is one link rather than "resolver" with a word left over.
 * - **First occurrence of each entry.** An alias belongs to its entry, so "packets ...
 *   packet" links once.
 * - **At most `max` links**, and never an entry named in `skip` (the term a screen is
 *   already about, say). A skipped word stays plain and does not use up `max`.
 */

export type TermSegment = string | { text: string; entry: InlineTerm };

export interface MatchOptions {
  /** The most links one string may carry. Defaults to 3. */
  max?: number;
  /** Entries never to link, each named by its id or by any of its spellings. */
  skip?: readonly string[];
}

interface Matcher {
  pattern: RegExp | null;
  /** Lower-cased spelling -> its entry and whether its case must match exactly. */
  bySpelling: ReadonlyMap<string, { entry: InlineTerm; exact: string | null }>;
}

const matchers = new WeakMap<readonly InlineSpelling[], Matcher>();

function escapeRegExp(text: string) {
  // Only the syntax characters: under the `u` flag, escaping anything else (`\-`) is an
  // error rather than a no-op.
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Two or more capitals and no lower-case letter: "AS", "SSL/TLS", "802.1Q". */
export function isAcronym(spelling: string) {
  return (spelling.match(/\p{Lu}/gu)?.length ?? 0) >= 2 && !/\p{Ll}/u.test(spelling);
}

function matcherFor(spellings: readonly InlineSpelling[]): Matcher {
  const cached = matchers.get(spellings);
  if (cached) return cached;

  const bySpelling = new Map<string, { entry: InlineTerm; exact: string | null }>();
  for (const { spelling, entry } of spellings) {
    const key = spelling.toLowerCase();
    // First claim wins, as in the index itself.
    if (!bySpelling.has(key)) {
      bySpelling.set(key, { entry, exact: isAcronym(spelling) ? spelling : null });
    }
  }

  const alternatives = [...bySpelling.keys()]
    .filter((key) => key.trim().length > 0)
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .map(escapeRegExp);

  const matcher: Matcher = {
    // Longest first, because an alternation takes the first alternative that fits.
    pattern: alternatives.length
      ? new RegExp(
          `(?<![\\p{L}\\p{N}])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}])`,
          'giu',
        )
      : null,
    bySpelling,
  };
  matchers.set(spellings, matcher);
  return matcher;
}

/** Split `text` into plain runs and the glossary words to link, in order. */
export function matchTerms(
  text: string,
  spellings: readonly InlineSpelling[],
  { max = 3, skip = [] }: MatchOptions = {},
): TermSegment[] {
  const { pattern, bySpelling } = matcherFor(spellings);
  if (!pattern || max <= 0 || !text) return [text];

  const skipped = new Set(
    skip.flatMap((name) => bySpelling.get(name.trim().toLowerCase())?.entry.slug ?? []),
  );
  const linked = new Set<string>();
  const segments: TermSegment[] = [];
  let last = 0;

  pattern.lastIndex = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const found = bySpelling.get(match[0].toLowerCase());
    if (!found) continue;

    const { entry, exact } = found;
    if (exact !== null && match[0] !== exact) {
      // "as" where only "AS" may match. Look again one character on, so a shorter
      // spelling starting later in the same run is not lost.
      pattern.lastIndex = match.index + 1;
      continue;
    }
    if (skipped.has(entry.slug) || linked.has(entry.slug)) continue;

    if (match.index > last) segments.push(text.slice(last, match.index));
    segments.push({ text: match[0], entry });
    linked.add(entry.slug);
    last = match.index + match[0].length;
    if (linked.size >= max) break;
  }

  if (last < text.length) segments.push(text.slice(last));
  return segments;
}
