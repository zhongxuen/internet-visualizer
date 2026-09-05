/**
 * Scenario 5 -- the same twelve rows, paged twice, with the same edit landing mid-run.
 *
 * This is the scenario that exists because the sentence has never convinced anybody. "Offset
 * pagination is unstable under concurrent writes" is true, is repeated in every API design
 * guide, and is ignored, because the arithmetic is obviously right: skip twenty, take twenty.
 * Nothing in the server is wrong. The defect is not in the slicing -- it is in the assumption
 * that the list is the same list it was a moment ago.
 *
 * So the run pages through a newest-first feed twice with identical timing and identical
 * edits, changing exactly one thing: how the client asks for page two.
 *
 * - **Offset.** One row is posted between page one and page two, and because the feed is
 *   newest-first the new row lands at the front and pushes everything down by one. Page two
 *   starts at row six of a list whose row six is now what row five used to be, so the client
 *   receives an item it has already been given. Later a row is deleted, everything shifts back
 *   up, and an item that was present for the entire run is never sent at all.
 * - **Cursor.** Same rows, same edits, same order. The client asks to resume *after a position
 *   in the ordering* rather than after a row count, so an insert or delete anywhere else in
 *   the collection changes which items exist and changes nothing about where this page starts.
 *
 * The two runs differ by one line of server code, and that line is the whole lesson.
 *
 * What makes the bug survive review is the thing worth noticing last: with nothing changing
 * underneath, both strategies are exactly correct. It is not reproducible on a quiet database,
 * and every feed, changelog, and audit log is the opposite of quiet.
 *
 * Cursors are not free, and the comparison in `PAGINATION_TRADEOFFS` says so: you cannot jump
 * to page fifty, you cannot show "page 3 of 27", and the cursor is opaque so a client cannot
 * construct one. Offset also gets slower the deeper you page -- `LIMIT 20 OFFSET 100000` does
 * not seek, it generates and discards a hundred thousand rows -- which is why the last page of
 * a large collection times out while the first is instant.
 */

import type { ApiScenario, CollectionItem } from '../sim/exchange';

import { API_HOST } from './common';

/**
 * Twelve rows of a newest-first feed.
 *
 * `postedAt` is the ordering, and it is what a cursor encodes a position in. The ids run the
 * other way round from the order deliberately: an id is not a position, and a paginator that
 * assumed it was would work here and break the first time a row was backfilled.
 */
const FEED: readonly CollectionItem[] = [
  { id: 'p01', title: 'Why your retry made it worse', postedAt: 1_200 },
  { id: 'p02', title: 'Reading a traceroute honestly', postedAt: 1_190 },
  { id: 'p03', title: 'The blank line is the framing', postedAt: 1_180 },
  { id: 'p04', title: 'What the padlock actually checked', postedAt: 1_170 },
  { id: 'p05', title: 'Idempotency is about the state, not the status', postedAt: 1_160 },
  { id: 'p06', title: 'Every cache is a bet', postedAt: 1_150 },
  { id: 'p07', title: 'Ports are a transport idea', postedAt: 1_140 },
  { id: 'p08', title: 'The resolver you did not configure', postedAt: 1_130 },
  { id: 'p09', title: 'TTL is not a timer', postedAt: 1_120 },
  { id: 'p10', title: 'Three ways to say no', postedAt: 1_110 },
  { id: 'p11', title: 'Names, addresses, routes', postedAt: 1_100 },
  { id: 'p12', title: 'A packet has no idea where it is', postedAt: 1_090 },
];

/** Six pages, two strategies, one insert and one delete. */
export const PAGINATED_COLLECTION: ApiScenario = {
  id: 'paginated-collection',
  title: 'Pagination: offset against cursor',
  summary:
    'Twelve rows of a newest-first feed, paged five at a time, with one row posted after ' +
    'page one and one deleted after page two. The offset run repeats an item and then misses ' +
    'one; the cursor run, same rows and same edits, is clean.',
  teaches: [
    'Offset pagination is correct arithmetic over a list that is no longer the same list',
    'One insert at the front of a newest-first feed is enough to hand a client a duplicate',
    'One delete is enough for a client to never see a row that was there the whole time',
    'A cursor names a position in the ordering, so edits elsewhere cannot move it',
    'Cursors cost you random access: no jumping to page 50, and no "page 3 of 27"',
    'Link headers make a collection navigable without the client knowing the scheme',
  ],
  apiHost: API_HOST,
  plan: {
    kind: 'pagination',
    basePath: '/articles',
    items: FEED,
    pageSize: 5,
    descending: true,
    betweenPagesMs: 500,
    changes: [
      {
        kind: 'insert',
        afterPage: 0,
        item: {
          id: 'p13',
          title: 'Posted while you were reading page one',
          postedAt: 1_210,
        },
      },
      // Deleting something already served shifts the rest up, which is the other half of the
      // failure: not a duplicate this time, but a row the client is never sent at all.
      { kind: 'delete', afterPage: 1, id: 'p03' },
    ],
  },
  notes: [
    {
      phase: 'offset-page-1',
      text: 'Nothing is wrong yet, and nothing will be wrong with the server at any point in this run. Watch the total field: it is the size of the collection at the moment this page was computed, and it is about to change. It is also cheap here and expensive in a real database, which is why so many APIs stop reporting it.',
      reference: {
        rfc: 8288,
        section: '3.3',
        title: 'Web Linking: Registered Relation Types',
      },
    },
    {
      phase: 'offset-page-2',
      text: 'A row was posted after page one was served, and in a newest-first feed it lands at the front. Page two asks for rows six to ten of a list that has grown by one at the top, so row six is what row five used to be -- and the client is handed an item it already has. Nobody made an arithmetic error. The offset was computed against a list that no longer exists.',
    },
    {
      phase: 'offset-page-3',
      text: 'And here is the other direction. A row already served was deleted, everything below it shifted up, and page three now starts one row further along than it should. An item that was in the collection from the first request to the last has been skipped entirely -- which is worse than the duplicate, because a duplicate is visible and a gap is not.',
    },
    {
      phase: 'cursor-page-1',
      text: 'The same twelve rows, the same page size, and the same two edits about to happen at exactly the same points. The only difference is what page two will ask for: not "skip five" but "resume after this position in the ordering". Watch next_cursor -- it encodes the sort value and the id of the last item on this page.',
    },
    {
      phase: 'cursor-page-2',
      text: 'The insert happened, and it changed nothing about where this page starts. The cursor names a position in the ordering rather than a row count, so items appearing above it are simply items this client has already paged past. The new row is not lost -- a client that pages backwards, or restarts, will see it. It is just not smuggled into a page that was already accounted for.',
    },
    {
      phase: 'cursor-page-3',
      text: 'Clean run: every stable row exactly once. The cost is real and worth stating -- a cursor is opaque, so a client cannot construct one, cannot jump to page fifty, and cannot render "page 3 of 27". Offset can do all three, which is why it survives in admin tables and catalogues where nothing is being written while somebody reads. The rule is about the collection, not about taste.',
    },
  ],
};
