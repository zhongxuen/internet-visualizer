import { describe, expect, it } from 'vitest';

import { headerValue } from './message';
import {
  cursorPage,
  decodeCursor,
  encodeCursor,
  formatLinkHeader,
  linkHeaders,
  offsetPage,
  PAGINATION_TRADEOFFS,
  paginateWithDrift,
  parseLinkHeader,
  resolveLimit,
  type CollectionChange,
} from './pagination';

/**
 * A newest-first feed: article 10 is the most recent. `sortValue` is the creation time, and
 * ordering descending by it is what every changelog, feed, and audit log does.
 */
interface Article {
  readonly id: string;
  readonly created: number;
}

const article = (id: number): Article => ({ id: `${id}`, created: id });

/** Ten articles, newest first: 10, 9, 8, ... 1. */
const FEED: readonly Article[] = Array.from({ length: 10 }, (_, index) =>
  article(10 - index),
);

const identify = (item: Article) => item.id;
const sortValue = (item: Article) => item.created;

// ---------------------------------------------------------------------------
// Offset
// ---------------------------------------------------------------------------

describe('offsetPage', () => {
  it('slices the page asked for', () => {
    const page = offsetPage(FEED, { offset: 3, limit: 3 });
    expect(page.items.map(identify)).toEqual(['7', '6', '5']);
    expect(page.total).toBe(10);
    expect(page.hasMore).toBe(true);
  });

  it('reports the last page as having no more', () => {
    expect(offsetPage(FEED, { offset: 9, limit: 3 }).hasMore).toBe(false);
  });

  it('returns an empty page past the end rather than failing', () => {
    const page = offsetPage(FEED, { offset: 50, limit: 3 });
    expect(page.items).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  it('clamps a negative offset', () => {
    expect(offsetPage(FEED, { offset: -5, limit: 2 }).offset).toBe(0);
  });

  it('builds first, prev, next, and last links', () => {
    const page = offsetPage(FEED, { offset: 3, limit: 3 }, '/articles');
    const byRel = Object.fromEntries(page.links.map((link) => [link.rel, link.target]));
    expect(byRel.first).toBe('/articles?offset=0&limit=3');
    expect(byRel.prev).toBe('/articles?offset=0&limit=3');
    expect(byRel.next).toBe('/articles?offset=6&limit=3');
    expect(byRel.last).toBe('/articles?offset=9&limit=3');
  });

  it('omits prev on the first page and next on the last', () => {
    const first = offsetPage(FEED, { offset: 0, limit: 3 }, '/articles');
    expect(first.links.some((link) => link.rel === 'prev')).toBe(false);
    const last = offsetPage(FEED, { offset: 9, limit: 3 }, '/articles');
    expect(last.links.some((link) => link.rel === 'next')).toBe(false);
  });
});

describe('resolveLimit', () => {
  it('falls back to the default when the client asks for nothing', () => {
    expect(resolveLimit(undefined, { defaultLimit: 25 })).toBe(25);
  });

  it('caps what a client may ask for -- otherwise ?limit=1000000 is an attack', () => {
    expect(resolveLimit(1_000_000, { maxLimit: 100 })).toBe(100);
  });

  it('refuses a zero or negative page size', () => {
    expect(resolveLimit(0)).toBe(1);
    expect(resolveLimit(-10)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Link headers
// ---------------------------------------------------------------------------

describe('the Link field', () => {
  it('formats links the way RFC 8288 spells them', () => {
    expect(
      formatLinkHeader([
        { rel: 'next', target: '/articles?offset=3&limit=3' },
        { rel: 'last', target: '/articles?offset=9&limit=3' },
      ]),
    ).toBe(
      '</articles?offset=3&limit=3>; rel="next", </articles?offset=9&limit=3>; rel="last"',
    );
  });

  it('uses "prev", not "previous"', () => {
    expect(formatLinkHeader([{ rel: 'prev', target: '/a' }])).toContain('rel="prev"');
  });

  it('round-trips through the parser', () => {
    const links = [
      { rel: 'next' as const, target: '/articles?after=abc&limit=3' },
      { rel: 'first' as const, target: '/articles?limit=3' },
    ];
    expect(parseLinkHeader(linkHeaders(links))).toEqual(links);
  });

  it('reads several Link lines as well as one comma-joined line', () => {
    const separate = parseLinkHeader([
      { name: 'Link', value: '</a>; rel="next"' },
      { name: 'Link', value: '</b>; rel="prev"' },
    ]);
    expect(separate.map((link) => link.rel)).toEqual(['next', 'prev']);
  });

  it('ignores parameters other than rel rather than rejecting the line', () => {
    const links = parseLinkHeader([
      {
        name: 'Link',
        value: '</a>; rel="next"; title="Next page"; type="application/json"',
      },
    ]);
    expect(links).toEqual([{ rel: 'next', target: '/a' }]);
  });

  it('emits no header at all when there are no links', () => {
    expect(linkHeaders([])).toEqual([]);
    expect(headerValue(linkHeaders([]), 'Link')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Cursors
// ---------------------------------------------------------------------------

describe('cursors', () => {
  it('round-trips a position', () => {
    const cursor = encodeCursor({ sortValue: 8, id: '8' });
    expect(decodeCursor(cursor)).toEqual({ ok: true, value: { sortValue: 8, id: '8' } });
  });

  it('is opaque: it does not read as an offset', () => {
    expect(encodeCursor({ sortValue: 8, id: '8' })).not.toContain('offset');
    expect(encodeCursor({ sortValue: 8, id: '8' })).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it('rejects a cursor it did not issue instead of restarting from the beginning', () => {
    // Silently restarting would turn a client bug into a loop that re-reads page one forever.
    expect(decodeCursor('not-a-cursor').ok).toBe(false);
    expect(decodeCursor('').ok).toBe(false);
  });

  it('rejects a well-formed base64url value that is not a position', () => {
    expect(decodeCursor(encodeCursor({ sortValue: 1, id: 'x' }).slice(0, 4)).ok).toBe(
      false,
    );
  });

  it('pages forward through a descending feed', () => {
    const first = cursorPage(
      FEED,
      { limit: 3 },
      { identify, sortValue, descending: true },
    );
    expect(first.ok && first.value.items.map(identify)).toEqual(['10', '9', '8']);

    const second = cursorPage(
      FEED,
      { after: first.ok ? first.value.nextCursor : undefined, limit: 3 },
      { identify, sortValue, descending: true },
    );
    expect(second.ok && second.value.items.map(identify)).toEqual(['7', '6', '5']);
  });

  it('stops cleanly at the end', () => {
    let cursor: string | undefined;
    const seen: string[] = [];
    for (let page = 0; page < 10; page += 1) {
      const result = cursorPage(
        FEED,
        { after: cursor, limit: 4 },
        { identify, sortValue, descending: true },
      );
      if (!result.ok) throw new Error(result.error);
      seen.push(...result.value.items.map(identify));
      cursor = result.value.nextCursor;
      if (!result.value.hasMore) break;
    }
    expect(seen).toEqual(FEED.map(identify));
    expect(cursor).toBeUndefined();
  });

  it('breaks ties on the id, so records sharing a timestamp are not lost', () => {
    // A bulk import gives every row the same created time. A cursor keyed only on the sort
    // value would skip every row that shares the boundary value.
    const imported: readonly Article[] = [
      { id: 'a', created: 5 },
      { id: 'b', created: 5 },
      { id: 'c', created: 5 },
      { id: 'd', created: 5 },
    ];
    const first = cursorPage(imported, { limit: 2 }, { identify, sortValue });
    expect(first.ok && first.value.items.map(identify)).toEqual(['a', 'b']);

    const second = cursorPage(
      imported,
      { after: first.ok ? first.value.nextCursor : undefined, limit: 2 },
      { identify, sortValue },
    );
    expect(second.ok && second.value.items.map(identify)).toEqual(['c', 'd']);
  });
});

// ---------------------------------------------------------------------------
// The edge case this file exists for
// ---------------------------------------------------------------------------

describe('the offset skip and duplicate problem', () => {
  /** A new article appears at the front of the feed after page 1 is served. */
  const insertion: CollectionChange<Article> = {
    kind: 'insert',
    afterPage: 0,
    item: article(11),
  };
  /** The newest article is removed after page 1 is served. */
  const deletion: CollectionChange<Article> = { kind: 'delete', afterPage: 0, id: '10' };

  const run = (
    strategy: 'offset' | 'cursor',
    changes: readonly CollectionChange<Article>[],
  ) =>
    paginateWithDrift({
      items: FEED,
      pageSize: 3,
      strategy,
      changes,
      identify,
      sortValue,
      descending: true,
    });

  it('offset pagination shows an item twice when a row is inserted mid-run', () => {
    const drifted = run('offset', [insertion]);

    // Page 1 was [10, 9, 8]. Article 11 then arrives at the front, pushing everything down
    // one, so offset 3 -- which used to point at article 7 -- now points at article 8 again.
    expect(drifted.pages[0].ids).toEqual(['10', '9', '8']);
    expect(drifted.pages[1].ids).toEqual(['8', '7', '6']);
    expect(drifted.duplicated).toEqual(['8']);
    expect(drifted.correct).toBe(false);
  });

  it('offset pagination silently omits an item when a row is deleted mid-run', () => {
    const drifted = run('offset', [deletion]);

    // Page 1 was [10, 9, 8]. Removing article 10 shifts everything up one, so offset 3 skips
    // straight past article 7 -- which was in the collection the whole time and is never sent.
    expect(drifted.pages[0].ids).toEqual(['10', '9', '8']);
    expect(drifted.pages[1].ids).toEqual(['6', '5', '4']);
    expect(drifted.missed).toEqual(['7']);
    expect(drifted.duplicated).toEqual([]);
    expect(drifted.correct).toBe(false);
  });

  it('cursor pagination is unaffected by the same insertion', () => {
    const stable = run('cursor', [insertion]);
    expect(stable.pages[0].ids).toEqual(['10', '9', '8']);
    expect(stable.pages[1].ids).toEqual(['7', '6', '5']);
    expect(stable.duplicated).toEqual([]);
    expect(stable.missed).toEqual([]);
    expect(stable.correct).toBe(true);
  });

  it('cursor pagination is unaffected by the same deletion', () => {
    const stable = run('cursor', [deletion]);
    expect(stable.pages[1].ids).toEqual(['7', '6', '5']);
    expect(stable.correct).toBe(true);
  });

  it('delivers every stable item exactly once under cursors, and not under offsets', () => {
    const changes = [
      insertion,
      { ...deletion, afterPage: 1 } as CollectionChange<Article>,
    ];
    expect(run('cursor', changes).correct).toBe(true);
    expect(run('offset', changes).correct).toBe(false);
  });

  it('both strategies are correct when nothing changes underneath', () => {
    // The defect is in the interaction with writes, not in the arithmetic. Without a change,
    // offset pagination is perfectly fine -- which is exactly why the bug survives review.
    expect(run('offset', []).correct).toBe(true);
    expect(run('cursor', []).correct).toBe(true);
    expect(run('offset', []).received).toEqual(FEED.map(identify));
  });

  it('records the collection size changing between pages', () => {
    const drifted = run('offset', [insertion]);
    expect(drifted.pages[0].collectionSize).toBe(10);
    expect(drifted.pages[1].collectionSize).toBe(11);
    expect(drifted.pages[0].changeAfter).toEqual(insertion);
  });

  it('counts an item inserted mid-run as neither missed nor duplicated', () => {
    // Whether a client sees a row that appeared while it was paging is genuinely a matter of
    // timing, so it is excluded. What remains is the damning set.
    const drifted = run('cursor', [insertion]);
    expect(drifted.received).not.toContain('11');
    expect(drifted.missed).not.toContain('11');
  });

  it('replays identically', () => {
    expect(run('offset', [insertion])).toEqual(run('offset', [insertion]));
  });
});

describe('the tradeoff table', () => {
  it('gives each strategy a genuine advantage', () => {
    const offset = PAGINATION_TRADEOFFS.find((entry) => entry.strategy === 'offset');
    const cursor = PAGINATION_TRADEOFFS.find((entry) => entry.strategy === 'cursor');
    expect(offset?.randomAccess).toBe(true);
    expect(offset?.stableUnderWrites).toBe(false);
    expect(cursor?.randomAccess).toBe(false);
    expect(cursor?.stableUnderWrites).toBe(true);
  });

  it('names the deep-page cost on both sides', () => {
    for (const entry of PAGINATION_TRADEOFFS) {
      expect(entry.deepPageCost.length).toBeGreaterThan(20);
      expect(entry.useWhen.length).toBeGreaterThan(20);
    }
  });
});
