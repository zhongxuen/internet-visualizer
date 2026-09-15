import { describe, expect, it } from 'vitest';

import { lookupTerm } from '../../glossary/lookup';
import {
  ALLOWED_CAPITALS,
  checkPlainStory,
  findUnglossedJargon,
  KNOWN_JARGON,
  MODULE_NAMES,
  sentences,
  wordCount,
} from '../plain';

describe('wordCount', () => {
  it.each([
    ['', 0],
    ['   ', 0],
    ['one', 1],
    ['  two   words  ', 2],
    // A dash standing alone is punctuation; a hyphenated word is one word.
    ['three-way handshake — done', 3],
    ["it's 2,400 km", 3],
    ['line\nbreaks\tcount too', 4],
  ])('%j has %d words', (text, count) => {
    expect(wordCount(text)).toBe(count);
  });
});

describe('sentences', () => {
  it('splits after a full stop, question mark or exclamation mark followed by space', () => {
    expect(sentences('One. Two? Three! Four')).toEqual([
      'One.',
      'Two?',
      'Three!',
      'Four',
    ]);
  });

  it('keeps a closing quote or bracket with its sentence', () => {
    expect(sentences('It says "done." Then it stops. (Quietly.) The end.')).toEqual([
      'It says "done."',
      'Then it stops.',
      '(Quietly.)',
      'The end.',
    ]);
  });

  it('does not split inside a name like example.com', () => {
    expect(sentences('Your computer asks for example.com and waits.')).toHaveLength(1);
  });

  it('returns nothing for blank text', () => {
    expect(sentences('  ')).toEqual([]);
  });
});

describe('findUnglossedJargon', () => {
  it('allows acronyms and jargon the glossary defines, in any number', () => {
    expect(
      findUnglossedJargon(
        'Your computer uses DNS, then TCP, then TLS. The packets hop by hop.',
      ),
    ).toEqual([]);
    // Plural acronyms resolve through their alias or their singular.
    expect(findUnglossedJargon('Two APIs and three CNAMEs.')).toEqual([]);
  });

  it('flags capitals and known jargon the glossary cannot explain, once each', () => {
    expect(
      findUnglossedJargon(
        'The ISP runs a ping, then another ping, then a traceroute to the ISP.',
      ),
    ).toEqual(['ISP', 'ping', 'traceroute']);
  });

  it('flags a plural or possessive by the word itself', () => {
    expect(findUnglossedJargon("The ISP's checksums and two URLs.")).toEqual([
      'ISP',
      'checksums',
      'URLs',
    ]);
    expect(findUnglossedJargon('Two hashes.')).toEqual(['hashes']);
  });

  it('flags lower-case jargon regardless of case, and mixed-case names like IPv4', () => {
    expect(findUnglossedJargon('Whois says one thing and IPv4 another.')).toEqual([
      'Whois',
      'IPv4',
    ]);
  });

  it('allows numbers, size units, everyday capitals and the module names', () => {
    expect(
      findUnglossedJargon(
        'It is 1500 bytes, about 1.5 KB, sent at 100 Mb/s in 12 ms. Check the ID, OK.',
      ),
    ).toEqual([]);
    expect(
      findUnglossedJargon(
        'Open the HTTPS Explorer, then the API Visualizer and the IDs.',
      ),
    ).toEqual([]);
  });

  it('does not flag an ordinary word that happens to start a sentence', () => {
    expect(findUnglossedJargon('A router passes messages on. It is quick.')).toEqual([]);
  });

  it('finds nothing in text with no words', () => {
    expect(findUnglossedJargon('')).toEqual([]);
    expect(findUnglossedJargon(' — … ')).toEqual([]);
  });

  it('keeps its lists honest: nothing allowed is also listed as jargon', () => {
    for (const word of KNOWN_JARGON) {
      expect(word, 'jargon is listed in lower case').toBe(word.toLowerCase());
      expect(ALLOWED_CAPITALS.has(word.toUpperCase()), word).toBe(false);
    }
    for (const capital of ALLOWED_CAPITALS) {
      expect(
        lookupTerm(capital),
        `${capital} is in the glossary; no need to allow it`,
      ).toBe(undefined);
    }
    expect(new Set(MODULE_NAMES).size).toBe(MODULE_NAMES.length);
  });
});

describe('checkPlainStory', () => {
  it('passes plain sentences', () => {
    for (const text of [
      // DNS Explorer's plain summary, from §5.5.
      'Websites have names, but computers need numbers. Watch your computer ask a chain of servers until one knows the number.',
      'Your computer has never looked up this name. It asks a helper, the resolver, to find it.',
      'Before any data moves, your laptop and the server greet each other three times.',
    ]) {
      expect(checkPlainStory(text), text).toEqual([]);
    }
  });

  it('reports blank text as empty and nothing else', () => {
    expect(checkPlainStory(' ')).toEqual(['is empty']);
  });

  it('counts words against maxWords, 30 by default', () => {
    const ten = 'One two three four five six seven eight nine ten.';
    const thirty = [ten, ten, ten].join(' ');
    expect(checkPlainStory(thirty)).toEqual([]);
    expect(checkPlainStory(`${thirty} More.`)).toEqual(['has 31 words; the limit is 30']);
    expect(checkPlainStory(`${thirty} More.`, { maxWords: 40 })).toEqual([]);
  });

  it('keeps every sentence under 20 words', () => {
    const nineteen = `${'word '.repeat(18)}end.`;
    const twenty = `${'word '.repeat(19)}end.`;
    expect(checkPlainStory(nineteen)).toEqual([]);
    expect(checkPlainStory(`Short. ${twenty}`)).toEqual([
      'sentence 2 has 20 words; each must be under 20',
    ]);
    expect(checkPlainStory(twenty, { sentenceWordLimit: 25 })).toEqual([]);
  });

  it('names each unglossed word', () => {
    expect(checkPlainStory('The ISP answers.')).toEqual([
      'uses "ISP", which has no glossary entry',
    ]);
  });

  it('holds the phrases CONTENT-STYLE bans, and exclamation marks', () => {
    expect(checkPlainStory('Simply press play, as you can see. It just works!')).toEqual([
      'uses "Simply"',
      'uses "as you can see"',
      'uses "just"',
      'uses an exclamation mark',
    ]);
    expect(checkPlainStory('Of course it is obviously fine.')).toEqual([
      'uses "Of course"',
      'uses "obviously"',
    ]);
    // Inside another word is not the word.
    expect(checkPlainStory('Adjust the size.')).toEqual([]);
  });
});
