import { describe, expect, it } from 'vitest';

import {
  INLINE_SPELLINGS,
  type InlineSpelling,
  type InlineTerm,
} from '@/core/glossary/inline';

import { isAcronym, matchTerms, type TermSegment } from './matchTerms';

/** A small glossary of its own, so each rule is tested against exactly the words it needs. */
function glossary(entries: { slug: string; spellings: string[] }[]): InlineSpelling[] {
  return entries.flatMap(({ slug, spellings }) => {
    const entry: InlineTerm = { slug, term: spellings[0]!, short: `${slug}.` };
    return spellings.map((spelling) => ({ spelling, entry }));
  });
}

const DNS = glossary([
  { slug: 'dns', spellings: ['DNS', 'Domain Name System'] },
  { slug: 'dnssec', spellings: ['DNSSEC'] },
  { slug: 'resolver', spellings: ['resolver', 'resolvers', 'recursive resolver'] },
  { slug: 'ttl', spellings: ['TTL', 'time to live'] },
  { slug: 'autonomous-system', spellings: ['autonomous system', 'AS'] },
  { slug: 'ip-address', spellings: ['IP address', 'IP'] },
  { slug: 'packet', spellings: ['packet', 'packets'] },
  { slug: 'hop', spellings: ['hop', 'hops'] },
]);

/** The linked words, as `text→slug`, in order. */
function links(segments: TermSegment[]) {
  return segments.flatMap((s) =>
    typeof s === 'string' ? [] : [`${s.text}→${s.entry.slug}`],
  );
}

/** The segments joined back together, which must always be the input. */
function joined(segments: TermSegment[]) {
  return segments.map((s) => (typeof s === 'string' ? s : s.text)).join('');
}

describe('matchTerms', () => {
  it('links a term and leaves the rest of the string intact around it', () => {
    const text = 'Your resolver asks on your behalf.';
    const segments = matchTerms(text, DNS);
    expect(segments).toEqual([
      'Your ',
      { text: 'resolver', entry: expect.objectContaining({ slug: 'resolver' }) },
      ' asks on your behalf.',
    ]);
    expect(joined(segments)).toBe(text);
  });

  it('is case-insensitive, and keeps the case the sentence wrote', () => {
    expect(links(matchTerms('Resolvers cache answers.', DNS))).toEqual([
      'Resolvers→resolver',
    ]);
    expect(links(matchTerms('the domain name system', DNS))).toEqual([
      'domain name system→dns',
    ]);
  });

  it('matches an all-capitals spelling only in capitals', () => {
    expect(isAcronym('AS')).toBe(true);
    expect(isAcronym('SSL/TLS')).toBe(true);
    expect(isAcronym('IP address')).toBe(false);
    expect(isAcronym('hop')).toBe(false);

    expect(links(matchTerms('Fast as light, as far as I know.', DNS))).toEqual([]);
    expect(links(matchTerms('Each AS runs its own routing.', DNS))).toEqual([
      'AS→autonomous-system',
    ]);
    // A spelling with lower-case letters in it is still case-insensitive.
    expect(links(matchTerms('your ip address', DNS))).toEqual(['ip address→ip-address']);
  });

  it('does not match "DNS" inside "DNSSEC" when both exist', () => {
    expect(links(matchTerms('DNSSEC signs every answer.', DNS))).toEqual([
      'DNSSEC→dnssec',
    ]);
    expect(links(matchTerms('DNSSEC protects DNS.', DNS))).toEqual([
      'DNSSEC→dnssec',
      'DNS→dns',
    ]);
  });

  it('never matches inside a word, on either side', () => {
    expect(links(matchTerms('IPv4 and hopping and shops and TTLs', DNS))).toEqual([]);
    expect(links(matchTerms('reDNS DNS2', DNS))).toEqual([]);
  });

  it('treats punctuation as a word boundary', () => {
    expect(links(matchTerms("the resolver's cache (TTL) and hop-by-hop", DNS))).toEqual([
      'resolver→resolver',
      'TTL→ttl',
      'hop→hop',
    ]);
  });

  it('prefers the longest match', () => {
    expect(links(matchTerms('Ask a recursive resolver.', DNS))).toEqual([
      'recursive resolver→resolver',
    ]);
    expect(links(matchTerms('Every IP address is an IP.', DNS))).toEqual([
      'IP address→ip-address',
    ]);
  });

  it('links only the first occurrence of each entry, counting aliases as the entry', () => {
    expect(links(matchTerms('packets, then a packet, then more packets', DNS))).toEqual([
      'packets→packet',
    ]);
  });

  it('stops at `max` links, 3 by default', () => {
    const text = 'DNS resolver TTL packet hop';
    expect(links(matchTerms(text, DNS))).toEqual([
      'DNS→dns',
      'resolver→resolver',
      'TTL→ttl',
    ]);
    expect(links(matchTerms(text, DNS, { max: 1 }))).toEqual(['DNS→dns']);
    expect(matchTerms(text, DNS, { max: 0 })).toEqual([text]);
    expect(joined(matchTerms(text, DNS, { max: 1 }))).toBe(text);
  });

  it('skips entries named in `skip`, by id or by any spelling, without using up `max`', () => {
    const text = 'DNS resolver TTL packet hop';
    expect(links(matchTerms(text, DNS, { skip: ['dns', 'Resolvers'] }))).toEqual([
      'TTL→ttl',
      'packet→packet',
      'hop→hop',
    ]);
    // A skipped entry's longer spelling does not leave its shorter one to be linked.
    expect(
      links(matchTerms('a recursive resolver', DNS, { skip: ['resolver'] })),
    ).toEqual([]);
  });

  it('returns the string untouched when nothing matches, or the glossary is empty', () => {
    expect(matchTerms('Nothing to see.', DNS)).toEqual(['Nothing to see.']);
    expect(matchTerms('DNS', [])).toEqual(['DNS']);
    expect(matchTerms('', DNS)).toEqual(['']);
  });

  it('escapes spellings that contain regular-expression characters', () => {
    const odd = glossary([
      { slug: 'tls', spellings: ['SSL/TLS'] },
      { slug: 'vlan', spellings: ['802.1Q'] },
    ]);
    expect(links(matchTerms('SSL/TLS over 802.1Q, not 802x1Q', odd))).toEqual([
      'SSL/TLS→tls',
      '802.1Q→vlan',
    ]);
  });

  it('runs against the real glossary', () => {
    const segments = matchTerms(
      'A router forwards each packet one hop closer.',
      INLINE_SPELLINGS,
    );
    expect(links(segments)).toEqual(['router→router', 'packet→packet', 'hop→hop']);
  });
});
