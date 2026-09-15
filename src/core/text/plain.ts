/**
 * The mechanical half of the plain-language rules (docs/implementation/uiux.md §5.1).
 *
 * A plain sentence is written for someone who has never heard "DNS" or "TCP". Most of
 * what makes one good is judgement, but four things are countable, and these count them:
 * how long it is, how long each sentence in it is, whether every technical word in it
 * can be tapped for a definition, and the banned phrases `docs/CONTENT-STYLE.md` already
 * rules out everywhere.
 *
 * `checkPlainStory` is what a test calls on a `plain` field; the other three are its
 * parts, exported so a test can say precisely what failed.
 */

import { lookupTerm } from '../glossary/lookup';

/** Words in `text`: whitespace-separated runs holding at least one letter or digit. */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

/**
 * `text` cut into sentences at `.`, `?` or `!` followed by space (a closing quote or
 * bracket may sit between). A full stop with no space after it -- `example.com` -- does
 * not end a sentence.
 */
export function sentences(text: string): string[] {
  return text
    .trim()
    .split(/(?<=[.?!]["'”’)\]]?)\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/**
 * The product's own module names, which are names rather than jargon: "HTTPS Explorer"
 * is where a reader goes, not a word they need defined. Kept here because `src/core`
 * may not import the registry; `tests/registry.test.ts` asserts it matches the
 * registry's titles.
 */
export const MODULE_NAMES: readonly string[] = [
  'Network Map',
  'Packet Journey',
  'DNS Explorer',
  'HTTP Explorer',
  'HTTPS Explorer',
  'API Visualizer',
  'WebSocket Viewer',
  'Internet Simulator',
  'Network Diagnostics',
  'Learning Center',
];

/**
 * Capitals that are not jargon: size units, which are allowed beside a number, and the
 * few everyday abbreviations a beginner already reads without help.
 */
export const ALLOWED_CAPITALS: ReadonlySet<string> = new Set([
  'KB',
  'MB',
  'GB',
  'TB',
  'ID',
  'OK',
  'PC',
  'TV',
]);

/**
 * Lower-case words that are jargon to a beginner. Each is flagged unless the glossary
 * defines it, so a word here that has an entry is allowed -- the entry is what lets a
 * screen make it tappable. Short on purpose: it catches the words that keep turning up,
 * and the all-capitals rule catches the acronyms.
 */
export const KNOWN_JARGON: ReadonlySet<string> = new Set([
  'bandwidth',
  'checksum',
  'cipher',
  'ciphertext',
  'datagram',
  'encapsulation',
  'endpoint',
  'fragmentation',
  'handshake',
  'hash',
  'hop',
  'ipv4',
  'ipv6',
  'latency',
  'nonce',
  'octet',
  'packet',
  'payload',
  'ping',
  'protocol',
  'resolver',
  'socket',
  'subnet',
  'traceroute',
  'whois',
]);

/** The word without a plural ending, for the lists above and for the glossary. */
function singularsOf(word: string): string[] {
  const forms = [word];
  if (/es$/i.test(word)) forms.push(word.slice(0, -2));
  if (/s$/i.test(word)) forms.push(word.slice(0, -1));
  return forms;
}

function isGlossed(word: string): boolean {
  return singularsOf(word).some((form) => lookupTerm(form) !== undefined);
}

function isJargon(word: string): boolean {
  // Two or more capitals, optionally pluralised: DNS, TTL, APIs, URLs.
  if (/^[A-Z]{2,}s?$/.test(word)) {
    return !singularsOf(word).some((form) => ALLOWED_CAPITALS.has(form));
  }
  return singularsOf(word.toLowerCase()).some((form) => KNOWN_JARGON.has(form));
}

/**
 * Every technical word in `text` that a reader could not tap for a definition: tokens
 * of two or more capitals, and the words in {@link KNOWN_JARGON}, that do not resolve
 * through `lookupTerm`. Numbers, size units and the product's module names are allowed.
 * Each word is reported once, as first written, in reading order.
 */
export function findUnglossedJargon(text: string): string[] {
  const withoutNames = MODULE_NAMES.reduce(
    (rest, name) => rest.split(name).join(' '),
    text,
  );
  const tokens = withoutNames.match(/[A-Za-z0-9]+(?:['’][A-Za-z]+)*/g) ?? [];

  const found = new Map<string, string>();
  for (const token of tokens) {
    const word = token.replace(/['’]s$/i, '');
    const key = word.toLowerCase();
    if (found.has(key) || !isJargon(word) || isGlossed(word)) continue;
    found.set(key, word);
  }
  return [...found.values()];
}

/** The phrases CONTENT-STYLE bans in every voice; each tells a reader they are the problem. */
const BANNED_PHRASES = /\b(simply|just|of course|obviously|as you can see)\b/gi;

export interface PlainStoryOptions {
  /** The most words the whole text may have. §5.1: 30 for a phase, 40 for an annotation. */
  maxWords?: number;
  /** Every sentence must be shorter than this. */
  sentenceWordLimit?: number;
}

/**
 * Everything wrong with `text` as plain language, one sentence per problem; empty
 * means it passes. Checks the length, the length of each sentence, unglossed jargon,
 * the banned phrases and exclamation marks.
 */
export function checkPlainStory(
  text: string,
  { maxWords = 30, sentenceWordLimit = 20 }: PlainStoryOptions = {},
): string[] {
  if (!text.trim()) return ['is empty'];

  const problems: string[] = [];

  const words = wordCount(text);
  if (words > maxWords) problems.push(`has ${words} words; the limit is ${maxWords}`);

  sentences(text).forEach((sentence, index) => {
    const count = wordCount(sentence);
    if (count >= sentenceWordLimit) {
      problems.push(
        `sentence ${index + 1} has ${count} words; each must be under ${sentenceWordLimit}`,
      );
    }
  });

  for (const word of findUnglossedJargon(text)) {
    problems.push(`uses "${word}", which has no glossary entry`);
  }

  for (const [phrase] of text.matchAll(BANNED_PHRASES)) {
    problems.push(`uses "${phrase}"`);
  }
  if (text.includes('!')) problems.push('uses an exclamation mark');

  return problems;
}
