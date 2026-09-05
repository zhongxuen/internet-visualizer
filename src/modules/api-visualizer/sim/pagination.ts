/**
 * Pagination -- and the bug that lives inside the obvious way to do it.
 *
 * Offset pagination is what everyone writes first, because it maps onto `LIMIT 20 OFFSET 40`
 * and onto the idea of a page number, and both feel like the shape of the problem. It is also
 * **wrong on any collection that changes**, in a way that produces no error, no warning, and
 * no failing test -- the client simply receives a list that is not the collection.
 *
 * The reason is that an offset addresses a *position in a list*, and the list is not
 * standing still:
 *
 * - **insert** a row near the front between page 1 and page 2, and everything shifts down by
 *   one. Offset 20 now points at the item that was at 19 -- an item the client already has.
 *   It receives a **duplicate**.
 * - **delete** a row near the front, and everything shifts up. Offset 20 now points past the
 *   item that moved into 19. That item is in the collection from beginning to end and the
 *   client **never sees it**.
 *
 * The second is the dangerous one. A duplicate is visible; a silent omission is not, and
 * "the nightly export missed 3% of records" is a bug that survives for years.
 *
 * {@link paginateWithDrift} performs both, on both strategies, and reports what the client
 * actually received. It is a demonstration rather than a description because the description
 * has never convinced anyone -- everybody nods at "offset pagination is unstable" and writes
 * `?page=2` the same afternoon.
 *
 * ## What a cursor is
 *
 * Not an index. A cursor names a **position in an ordering**: "the item whose `created_at` was
 * *this* and whose id was *that*". Rows inserted or deleted elsewhere do not move that
 * position, so the next page is the next page regardless of what happened in between. The
 * tie-breaking id is not optional -- see {@link encodeCursor}.
 *
 * The cost is real and this file states it: a cursor cannot express "jump to page 50", cannot
 * report a total without a second query, and requires a total ordering the index supports.
 * Offset is not merely worse; it is worse at correctness and better at random access.
 */

import { fail, ok, type ParseResult } from '@/core/net/result';
import type { RfcRef } from '@/core/types/events';

import { base64UrlDecodeText, base64UrlEncodeText } from './digest';
import {
  header,
  headerValue,
  parseJson,
  withQuery,
  type HeaderList,
  type JsonObject,
} from './message';

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

/** RFC 8288 -- Web Linking, which defines the Link field. */
export const RFC_8288: RfcRef = { rfc: 8288, title: 'Web Linking' };

/** RFC 8288 s 3.3 -- the registered relation types, `next` and `prev` among them. */
export const RFC_8288_RELATIONS: RfcRef = { ...RFC_8288, section: '3.3' };

// ---------------------------------------------------------------------------
// Link headers
// ---------------------------------------------------------------------------

/** A registered relation this module uses. */
export type LinkRelation = 'first' | 'prev' | 'next' | 'last' | 'self';

/** One link: a target and what it is relative to the current page. */
export interface PageLink {
  readonly rel: LinkRelation;
  readonly target: string;
}

/**
 * Serialise links as a `Link` field value.
 *
 * Putting the links in a header rather than in the body is what makes a paginated API
 * *navigable*: a client follows `rel="next"` without knowing whether the server counts in
 * offsets, cursors, or page numbers, and the server can change that without breaking anyone.
 * A client that constructs `?page=${n + 1}` has hard-coded a scheme it was never promised.
 *
 * Note that `prev` is spelled `prev`, not `previous` -- RFC 8288 s 3.3 registers the short
 * form, and a client matching on `previous` will silently find nothing.
 */
export function formatLinkHeader(links: readonly PageLink[]): string {
  return links.map((link) => `<${link.target}>; rel="${link.rel}"`).join(', ');
}

/**
 * Parse a `Link` field back into links.
 *
 * Written to survive the two things real servers do: sending several `Link` lines instead of
 * one comma-joined line, and putting extra parameters after `rel`. Only `rel` is read; the
 * rest is ignored rather than rejected.
 */
export function parseLinkHeader(headers: HeaderList): readonly PageLink[] {
  const value = headerValue(headers, 'Link');
  if (value === undefined) return [];
  const links: PageLink[] = [];
  // Split on commas that separate link-values, i.e. those followed by a `<`.
  for (const entry of value.split(/,\s*(?=<)/)) {
    const match = /^<([^>]*)>\s*;\s*(.*)$/.exec(entry.trim());
    if (!match) continue;
    const rel = /rel\s*=\s*"?([^";]+)"?/.exec(match[2]);
    if (!rel) continue;
    links.push({ rel: rel[1].trim() as LinkRelation, target: match[1] });
  }
  return links;
}

/** The `Link` field for a page's links, or no header at all when there are none. */
export function linkHeaders(links: readonly PageLink[]): HeaderList {
  return links.length === 0 ? [] : [header('Link', formatLinkHeader(links))];
}

// ---------------------------------------------------------------------------
// Offset pagination
// ---------------------------------------------------------------------------

/** What the client asked for. */
export interface OffsetParams {
  /** How many items to skip. Clamped at zero. */
  readonly offset: number;
  /** How many to return. Clamped to `maxLimit`. */
  readonly limit: number;
}

/** One page, offset-style. */
export interface OffsetPage<T> {
  readonly items: readonly T[];
  readonly offset: number;
  readonly limit: number;
  /**
   * The size of the whole collection **at the moment this page was computed**.
   *
   * Cheap to compute here and expensive in a real database, which is why so many APIs stop
   * reporting it. It is also the number that makes the drift visible: watch it change between
   * two pages of one run and the instability stops being abstract.
   */
  readonly total: number;
  readonly hasMore: boolean;
  readonly links: readonly PageLink[];
}

/** Guard rails a server puts on what a client may ask for. */
export interface PageLimits {
  readonly defaultLimit?: number;
  /** The hard ceiling. Without one, `?limit=1000000` is a denial-of-service request. */
  readonly maxLimit?: number;
}

/** Clamp a requested limit into what the server is willing to serve. */
export function resolveLimit(
  requested: number | undefined,
  limits: PageLimits = {},
): number {
  const fallback = limits.defaultLimit ?? 20;
  const ceiling = limits.maxLimit ?? 100;
  if (requested === undefined || !Number.isFinite(requested)) return fallback;
  return Math.max(1, Math.min(ceiling, Math.floor(requested)));
}

/**
 * Take one page by offset.
 *
 * The arithmetic is trivial and that is the trap: nothing here is wrong, and the result is
 * still unreliable, because the defect is not in the slicing but in the assumption that the
 * list is the same list as last time.
 *
 * Note also what `OFFSET` costs a database. `LIMIT 20 OFFSET 100000` does not seek -- it
 * generates and discards a hundred thousand rows to reach the ones wanted. Deep pages of an
 * offset-paginated endpoint get linearly slower, which is why the last page of a large
 * collection times out while the first is instant.
 */
export function offsetPage<T>(
  items: readonly T[],
  params: OffsetParams,
  basePath = '',
): OffsetPage<T> {
  const offset = Math.max(0, Math.floor(params.offset));
  const limit = Math.max(1, Math.floor(params.limit));
  const total = items.length;
  const page = items.slice(offset, offset + limit);
  const hasMore = offset + limit < total;

  const links: PageLink[] = [];
  if (basePath !== '') {
    links.push({ rel: 'first', target: withQuery(basePath, pageQuery(0, limit)) });
    if (offset > 0) {
      links.push({
        rel: 'prev',
        target: withQuery(basePath, pageQuery(Math.max(0, offset - limit), limit)),
      });
    }
    if (hasMore) {
      links.push({
        rel: 'next',
        target: withQuery(basePath, pageQuery(offset + limit, limit)),
      });
    }
    const lastOffset = Math.max(0, (Math.ceil(total / limit) - 1) * limit);
    links.push({
      rel: 'last',
      target: withQuery(basePath, pageQuery(lastOffset, limit)),
    });
  }

  return { items: page, offset, limit, total, hasMore, links };
}

function pageQuery(
  offset: number,
  limit: number,
): readonly (readonly [string, string])[] {
  return [
    ['offset', `${offset}`],
    ['limit', `${limit}`],
  ];
}

// ---------------------------------------------------------------------------
// Cursors
// ---------------------------------------------------------------------------

/** A position in an ordering: the sort value, and an id to break ties. */
export interface CursorPosition {
  /** The value the collection is ordered by, at the last item of the previous page. */
  readonly sortValue: number;
  /** That item's id. */
  readonly id: string;
}

/**
 * Encode a position as an opaque cursor.
 *
 * Two things about the encoding are deliberate.
 *
 * **It carries the id as well as the sort value.** A cursor of "everything after
 * `created_at = T`" loses every row that shares `T` with the last item of the page, and rows
 * sharing a timestamp are not a rare edge case -- they are what a bulk import produces. The
 * pair `(sortValue, id)` is a total ordering; the sort value alone is not.
 *
 * **It is base64url, which makes it opaque.** Not obfuscation -- anyone can decode it, and
 * {@link decodeCursor} does. It is a *signal*: this value is the server's, its format may
 * change, and a client that parses it has coupled itself to something it was not promised.
 * The moment a cursor looks like `offset:40`, somebody will do arithmetic on it.
 */
export function encodeCursor(position: CursorPosition): string {
  return base64UrlEncodeText(JSON.stringify({ v: position.sortValue, id: position.id }));
}

/** Decode a cursor, rejecting anything that is not one this server issued. */
export function decodeCursor(cursor: string): ParseResult<CursorPosition> {
  const text = base64UrlDecodeText(cursor);
  if (!text.ok) return fail(`cursor is not base64url: ${text.error}`);
  const parsed = parseJson(text.value);
  if (!parsed.ok) return fail(`cursor does not decode to JSON: ${parsed.error}`);
  const value = parsed.value as JsonObject;
  if (typeof value !== 'object' || value === null) return fail('cursor is not an object');
  const sortValue = value.v;
  const id = value.id;
  if (typeof sortValue !== 'number' || typeof id !== 'string') {
    return fail('cursor is missing a sort value or an id');
  }
  return ok({ sortValue, id });
}

/** How to read the ordering out of whatever the collection holds. */
export interface CursorOptions<T> {
  readonly identify: (item: T) => string;
  readonly sortValue: (item: T) => number;
  /** True when the collection is newest-first, which is the usual case for a feed. */
  readonly descending?: boolean;
}

/** One page, cursor-style. */
export interface CursorPage<T> {
  readonly items: readonly T[];
  readonly limit: number;
  /** Feed this back as `after` to get the next page. Absent when there is none. */
  readonly nextCursor?: string;
  readonly hasMore: boolean;
  readonly links: readonly PageLink[];
}

/**
 * Take one page by cursor.
 *
 * The items are filtered to those strictly after the cursor's position **in the collection's
 * own ordering**, rather than sliced by index. That single difference is what makes the
 * result stable: an insert or a delete anywhere else in the collection changes which items
 * exist, and changes nothing about where this page starts.
 *
 * A malformed cursor is rejected rather than treated as "start from the beginning". Silently
 * restarting would turn a client bug into an infinite loop that re-reads page one forever.
 */
export function cursorPage<T>(
  items: readonly T[],
  params: { readonly after?: string; readonly limit: number },
  options: CursorOptions<T>,
  basePath = '',
): ParseResult<CursorPage<T>> {
  const limit = Math.max(1, Math.floor(params.limit));
  const descending = options.descending ?? false;

  let candidates = items;
  if (params.after !== undefined && params.after !== '') {
    const position = decodeCursor(params.after);
    if (!position.ok) return position;
    candidates = items.filter((item) =>
      isAfter(
        position.value,
        options.sortValue(item),
        options.identify(item),
        descending,
      ),
    );
  }

  const page = candidates.slice(0, limit);
  const hasMore = candidates.length > limit;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last !== undefined
      ? encodeCursor({ sortValue: options.sortValue(last), id: options.identify(last) })
      : undefined;

  const links: PageLink[] = [];
  if (basePath !== '') {
    links.push({ rel: 'first', target: withQuery(basePath, [['limit', `${limit}`]]) });
    if (nextCursor !== undefined) {
      links.push({
        rel: 'next',
        target: withQuery(basePath, [
          ['after', nextCursor],
          ['limit', `${limit}`],
        ]),
      });
    }
  }

  return ok({
    items: page,
    limit,
    hasMore,
    links,
    ...(nextCursor === undefined ? {} : { nextCursor }),
  });
}

/**
 * Whether an item sits after a cursor position in the collection's ordering.
 *
 * The comparison is on the pair, not the sort value: equal sort values are ordered by id, so
 * a page boundary that lands in the middle of a block of identical timestamps still has a
 * well-defined "next". Getting this wrong is how a cursor-paginated API loses rows only when
 * two records happen to share a millisecond.
 */
function isAfter(
  position: CursorPosition,
  sortValue: number,
  id: string,
  descending: boolean,
): boolean {
  if (sortValue !== position.sortValue) {
    return descending ? sortValue < position.sortValue : sortValue > position.sortValue;
  }
  return descending ? id < position.id : id > position.id;
}

// ---------------------------------------------------------------------------
// The demonstration
// ---------------------------------------------------------------------------

/** Which strategy a run used. */
export type PaginationStrategy = 'offset' | 'cursor';

/** Something that happens to the collection while the client is paging through it. */
export type CollectionChange<T> =
  /** A new item appears. Where it lands is decided by the ordering. */
  | { readonly kind: 'insert'; readonly afterPage: number; readonly item: T }
  /** An existing item is removed. */
  | { readonly kind: 'delete'; readonly afterPage: number; readonly id: string };

/** One page as the client received it. */
export interface DriftPage<T> {
  readonly index: number;
  readonly items: readonly T[];
  readonly ids: readonly string[];
  /** The size of the collection when this page was served. */
  readonly collectionSize: number;
  /** What happened to the collection immediately after this page was served. */
  readonly changeAfter?: CollectionChange<T>;
}

/** What the client ended up with, and what it should have ended up with. */
export interface DriftRun<T> {
  readonly strategy: PaginationStrategy;
  readonly pages: readonly DriftPage<T>[];
  /** Every id returned, in order, duplicates included. */
  readonly received: readonly string[];
  /** Ids returned more than once. */
  readonly duplicated: readonly string[];
  /**
   * Ids present in the collection for the whole run and never returned.
   *
   * The definition is deliberately strict: an item that was inserted or deleted mid-run is
   * excluded, because whether the client sees it is genuinely a matter of timing. What is
   * left is the damning set -- items that were there the entire time and were still missed.
   */
  readonly missed: readonly string[];
  /** True when the client received exactly the stable set, once each. */
  readonly correct: boolean;
}

/** Everything a drift run needs pinned down. */
export interface DriftOptions<T> {
  readonly items: readonly T[];
  readonly pageSize: number;
  readonly strategy: PaginationStrategy;
  readonly changes?: readonly CollectionChange<T>[];
  readonly identify: (item: T) => string;
  readonly sortValue: (item: T) => number;
  /** Newest-first, the ordering under which a new item lands on page one. */
  readonly descending?: boolean;
  /** Safety net for a run that would otherwise not terminate. */
  readonly maxPages?: number;
}

/**
 * Page through a collection that is being modified underneath the client.
 *
 * The insertion is applied to the **front** of a newest-first collection, which is not a
 * contrived choice -- it is what every feed, changelog, and audit log does all day. One new
 * row between two page fetches is enough.
 *
 * Run this with `strategy: 'offset'` and then `'cursor'`, same items, same changes, and the
 * offset run comes back with a duplicate or a gap while the cursor run comes back clean. The
 * two runs differ in one line of code and that line is the whole lesson.
 */
export function paginateWithDrift<T>(options: DriftOptions<T>): DriftRun<T> {
  const descending = options.descending ?? false;
  const maxPages = options.maxPages ?? 50;
  const changes = options.changes ?? [];

  const sort = (list: readonly T[]): readonly T[] =>
    [...list].sort((a, b) => {
      const difference = options.sortValue(a) - options.sortValue(b);
      const bySortValue = descending ? -difference : difference;
      if (bySortValue !== 0) return bySortValue;
      const left = options.identify(a);
      const right = options.identify(b);
      return descending
        ? left < right
          ? 1
          : left > right
            ? -1
            : 0
        : left < right
          ? -1
          : left > right
            ? 1
            : 0;
    });

  const startingIds = new Set(options.items.map(options.identify));
  let collection = sort(options.items);

  const pages: DriftPage<T>[] = [];
  const received: string[] = [];
  let offset = 0;
  let cursor: string | undefined;

  for (let index = 0; index < maxPages; index += 1) {
    let items: readonly T[];
    let more: boolean;

    if (options.strategy === 'offset') {
      const page = offsetPage(collection, { offset, limit: options.pageSize });
      items = page.items;
      more = page.hasMore;
      offset += options.pageSize;
    } else {
      const page = cursorPage(
        collection,
        { after: cursor, limit: options.pageSize },
        {
          identify: options.identify,
          sortValue: options.sortValue,
          descending,
        },
      );
      // Unreachable: the only cursor fed back in is one this function just issued.
      if (!page.ok) throw new Error(`cursor rejected mid-run: ${page.error}`);
      items = page.value.items;
      more = page.value.hasMore;
      cursor = page.value.nextCursor;
    }

    const change = changes.find((candidate) => candidate.afterPage === index);
    pages.push({
      index,
      items,
      ids: items.map(options.identify),
      collectionSize: collection.length,
      ...(change === undefined ? {} : { changeAfter: change }),
    });
    received.push(...items.map(options.identify));

    if (change) {
      collection =
        change.kind === 'insert'
          ? sort([...collection, change.item])
          : collection.filter((item) => options.identify(item) !== change.id);
    }

    if (!more || items.length === 0) break;
  }

  const endingIds = new Set(collection.map(options.identify));
  const stable = [...startingIds].filter((id) => endingIds.has(id));
  const counts = new Map<string, number>();
  for (const id of received) counts.set(id, (counts.get(id) ?? 0) + 1);

  const duplicated = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id);
  const missed = stable.filter((id) => !counts.has(id));

  return {
    strategy: options.strategy,
    pages,
    received,
    duplicated,
    missed,
    correct: duplicated.length === 0 && missed.length === 0,
  };
}

// ---------------------------------------------------------------------------
// The comparison
// ---------------------------------------------------------------------------

/** One strategy, weighed. */
export interface PaginationTradeoff {
  readonly strategy: PaginationStrategy;
  readonly stableUnderWrites: boolean;
  readonly randomAccess: boolean;
  readonly totalCount: 'free' | 'extra query' | 'unavailable';
  readonly deepPageCost: string;
  readonly useWhen: string;
}

/**
 * Offset versus cursor, without a thumb on the scale.
 *
 * Cursor pagination wins on correctness and loses on ergonomics, and the ergonomics are not
 * trivial: a numbered pager in a UI, a "jump to page 40" control, and a total count on the
 * screen are all things offset gives away and cursor charges for. The right rule is about the
 * collection, not the aesthetics -- an append-heavy collection ordered by time needs cursors,
 * and a stable admin table of four hundred rows does not.
 */
export const PAGINATION_TRADEOFFS: readonly PaginationTradeoff[] = [
  {
    strategy: 'offset',
    stableUnderWrites: false,
    randomAccess: true,
    totalCount: 'free',
    deepPageCost:
      'Linear. OFFSET 100000 makes the database produce and discard a hundred thousand rows before the ones asked for.',
    useWhen:
      'The collection is small or rarely written, and the interface needs page numbers or a total.',
  },
  {
    strategy: 'cursor',
    stableUnderWrites: true,
    randomAccess: false,
    totalCount: 'extra query',
    deepPageCost:
      'Constant, given an index on the ordering: the cursor becomes a WHERE clause the index seeks to directly.',
    useWhen:
      'The collection changes while it is read -- feeds, logs, exports, anything append-heavy -- or is large enough that deep pages matter.',
  },
];
