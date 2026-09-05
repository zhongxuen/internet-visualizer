/**
 * Scenario 6 -- one screen's data, fetched both ways, with both bills itemised.
 *
 * The screen is an author page: a name and an avatar, that author's three latest posts, and
 * a comment count under each. It is deliberately ordinary, because the interesting numbers
 * only appear on a screen that needs data from more than one place.
 *
 * **What REST costs here.** Five requests. The user endpoint returns a fixed representation
 * -- forty fields for a screen that reads two -- and the posts endpoint does the same. That
 * is over-fetching, and it is measurable: the bytes are counted below. Worse is the shape of
 * the last three: the client cannot ask for comment counts until it knows the post ids, so it
 * fetches a list and then loops. That is *under*-fetching, and it is the more serious of the
 * two, because it costs a round trip rather than bandwidth and latency does not improve when
 * the connection gets faster.
 *
 * **What GraphQL costs here.** One request, whose response has exactly the requested fields
 * and nothing else. The request is larger -- the query travels in the body -- and on a small
 * response that is a meaningful fraction of the total, so it is counted rather than dropped.
 *
 * **What GraphQL gives up, and this scenario shows rather than mentions:**
 *
 * - *Caching.* Every REST response here is cacheable by URL, in a browser cache, a CDN, or a
 *   reverse proxy, at no cost to anyone -- and the module marks each one. The single
 *   `POST /graphql` carries `Cache-Control: no-store`, because a shared cache cannot key on a
 *   body and cannot know what a mutation invalidated. The answer is a client-side normalised
 *   cache: real, effective, and entirely your problem, where REST's was free.
 * - *N+1.* The one query costs the server five data-source calls -- one for the user, one for
 *   the posts, and one per post for the comment count. This is not a beginner's mistake; it is
 *   the resolver model's default. The scenario runs the same query again with per-field
 *   batching, as every production GraphQL server does with DataLoader, and the count falls to
 *   three. Both halves of "GraphQL has an N+1 problem" / "just use DataLoader" are true, and
 *   the counter is there so neither can be waved away.
 * - *Status codes.* The response is `200 OK` whatever the `errors` array says, because the
 *   transport succeeded. Every piece of HTTP machinery that reacts to status codes -- retries,
 *   alerting, dashboards -- goes blind, and that has to be rebuilt too.
 *
 * Both models are defensible. The honest summary is that GraphQL moves work from the network
 * to the server and from the server to the client's cache, and whether that trade is worth it
 * depends on how many clients there are and how differently they need the same data.
 */

import type { ApiScenario } from '../sim/exchange';
import type { GraphQLSchema } from '../sim/graphql';
import type { JsonObject } from '../sim/message';

import { API_HOST } from './common';

/**
 * The rows behind both sides.
 *
 * The user record is wide on purpose. A real `GET /users/{id}` returns whatever its author
 * decided it returns, and a screen wanting two fields pays for all of them.
 */
const USER: JsonObject = {
  id: 'u1',
  name: 'Ada Okonkwo',
  avatarUrl: 'https://cdn.example/avatars/u1.png',
  email: 'ada@example.com',
  bio: 'Writes about the parts of the stack that only misbehave in production.',
  location: 'Lagos',
  timezone: 'Africa/Lagos',
  locale: 'en-NG',
  createdAt: '2019-04-02T09:14:00Z',
  updatedAt: '2026-02-27T11:02:00Z',
  followerCount: 4_120,
  followingCount: 233,
  postCount: 68,
  plan: 'pro',
  emailVerified: true,
  twoFactorEnabled: true,
  lastSeenAt: '2026-03-01T08:41:00Z',
  preferences: { theme: 'dark', digest: 'weekly', mentions: 'all' },
};

const POSTS: readonly JsonObject[] = [
  {
    id: 'p1',
    title: 'Why your retry made it worse',
    publishedAt: '2026-02-24T10:00:00Z',
    body: 'A retry without jitter preserves whatever synchronisation caused the overload, and a retry without a cap is a client that has stopped without saying so. The interesting failures are the ones where every instance in a fleet was refused at the same instant and agreed, precisely, on when to try again.',
    excerpt:
      'A retry without jitter preserves the synchronisation that caused the overload.',
    authorId: 'u1',
    tags: ['reliability', 'backoff'],
    views: 8_401,
    draft: false,
  },
  {
    id: 'p2',
    title: 'Reading a traceroute honestly',
    publishedAt: '2026-02-19T15:30:00Z',
    body: 'The middle of a traceroute is the least trustworthy part of it. Routers deprioritise generating ICMP, paths differ per packet, and the reverse path is invisible -- so a spike on hop seven is evidence about hop seven answering, not about hop seven forwarding.',
    excerpt: 'The middle of a traceroute is the least trustworthy part of it.',
    authorId: 'u1',
    tags: ['icmp', 'diagnostics'],
    views: 5_233,
    draft: false,
  },
  {
    id: 'p3',
    title: 'Every cache is a bet',
    publishedAt: '2026-02-11T08:05:00Z',
    body: 'A cache entry is a claim that the world has not changed in a way you care about. Freshness is how long you are willing to be wrong, and revalidation is the price of finding out.',
    excerpt: 'Freshness is how long you are willing to be wrong.',
    authorId: 'u1',
    tags: ['caching'],
    views: 12_907,
    draft: false,
  },
];

const COMMENT_COUNTS: Readonly<Record<string, number>> = { p1: 41, p2: 12, p3: 88 };

/**
 * The schema.
 *
 * `hitsDataSource` is set on exactly the fields that would be a database round trip in a real
 * server: the user lookup, the posts lookup, and the comment count on each post. Scalars read
 * off the parent object and cost nothing, which is why the N+1 lands on `commentCount` and
 * not on `title`.
 */
const SCHEMA: GraphQLSchema = {
  queryType: 'Query',
  types: {
    Query: {
      name: 'Query',
      fields: {
        user: {
          type: 'User',
          hitsDataSource: true,
          resolve: (_parent, args) => (args['id'] === USER['id'] ? USER : undefined),
        },
      },
    },
    User: {
      name: 'User',
      fields: {
        id: { type: 'ID' },
        name: { type: 'String' },
        avatarUrl: { type: 'String' },
        email: { type: 'String' },
        posts: {
          type: 'Post',
          list: true,
          hitsDataSource: true,
          resolve: (_parent, args) =>
            POSTS.slice(
              0,
              typeof args['limit'] === 'number' ? args['limit'] : POSTS.length,
            ),
        },
      },
    },
    Post: {
      name: 'Post',
      fields: {
        id: { type: 'ID' },
        title: { type: 'String' },
        publishedAt: { type: 'String' },
        excerpt: { type: 'String' },
        commentCount: {
          type: 'Int',
          hitsDataSource: true,
          resolve: (parent) =>
            COMMENT_COUNTS[
              typeof parent?.['id'] === 'string' ? (parent['id'] as string) : ''
            ] ?? 0,
        },
      },
    },
  },
};

/** Exactly the fields the screen renders, and no others. */
const QUERY = `query AuthorPage {
  user(id: "u1") {
    name
    avatarUrl
    posts(limit: 3) {
      title
      publishedAt
      commentCount
    }
  }
}`;

/** Five REST calls and one GraphQL query, with both bills itemised. */
export const REST_VS_GRAPHQL_SCENARIO: ApiScenario = {
  id: 'rest-vs-graphql',
  title: 'REST against GraphQL',
  summary:
    'One author page, fetched five ways over REST and once over GraphQL, with round trips, ' +
    'wasted bytes, cacheability, and server-side resolver calls counted on both sides.',
  teaches: [
    'Over-fetching is bandwidth; under-fetching is latency, and latency is the worse of the two',
    'REST responses are cacheable by URL in every shared cache, for free',
    'One POST /graphql is cacheable by nothing, so the cache has to be rebuilt on the client',
    'The N+1 problem is the resolver model’s default, not a mistake -- and batching fixes it',
    'A GraphQL error arrives as 200 OK, so HTTP status codes stop being the error channel',
    'The GraphQL request is the larger of the two, because the query travels in the body',
  ],
  apiHost: API_HOST,
  conditions: { rttMs: 120 },
  plan: {
    kind: 'graphql',
    schema: SCHEMA,
    query: QUERY,
    endpoint: '/graphql',
    restCalls: [
      {
        id: 'user',
        title: 'GET /users/u1',
        intent:
          'The author. The screen needs a name and an avatar URL; the endpoint returns everything it has, because its representation was decided by its author and not by this screen.',
        target: '/users/u1',
        body: USER,
        // "Ada Okonkwo" and one URL: roughly seventy bytes of a response several times that.
        usedBytes: 72,
      },
      {
        id: 'posts',
        title: 'GET /users/u1/posts?limit=3',
        intent:
          'Their three latest posts. Each carries its full body and a tag list; the screen shows a title and a date.',
        target: '/users/u1/posts?limit=3',
        body: { data: POSTS, total: 68 },
        usedBytes: 190,
      },
      {
        id: 'comments-p1',
        title: 'GET /posts/p1/comments?count_only=true',
        intent:
          'The first comment count -- and the first request that could not have been sent earlier, because it needs a post id that only arrived a moment ago.',
        target: '/posts/p1/comments?count_only=true',
        body: { postId: 'p1', count: COMMENT_COUNTS['p1'] ?? 0 },
        usedBytes: 28,
        dependsOnPrevious: true,
      },
      {
        id: 'comments-p2',
        title: 'GET /posts/p2/comments?count_only=true',
        intent:
          'The second. Once the ids are known these three can go out together, so they cost bandwidth but not another round trip.',
        target: '/posts/p2/comments?count_only=true',
        body: { postId: 'p2', count: COMMENT_COUNTS['p2'] ?? 0 },
        usedBytes: 28,
      },
      {
        id: 'comments-p3',
        title: 'GET /posts/p3/comments?count_only=true',
        intent:
          'The third, and the last of the five. Twenty-eight bytes of useful answer, arriving in a response of its own with its own headers -- which is the other half of the bill for a chatty client.',
        target: '/posts/p3/comments?count_only=true',
        body: { postId: 'p3', count: COMMENT_COUNTS['p3'] ?? 0 },
        usedBytes: 28,
      },
    ],
  },
  notes: [
    {
      phase: 'rest-user',
      text: 'Over-fetching, measured. The screen reads two fields and the response carries eighteen, because a REST endpoint returns a fixed representation and this one serves every screen in the product. The alternative -- a per-screen endpoint -- works right up until there are twelve screens and four clients, which is the pressure GraphQL was built under.',
      reference: { rfc: 9110, section: '3.2', title: 'HTTP Semantics: Resources' },
    },
    {
      phase: 'rest-comments-p1',
      text: 'This is the expensive one, and the cost is not in the bytes. The client could not construct this request until the previous response arrived, because it needed the post ids. That is under-fetching: a list, then a loop. It costs a round trip, and a round trip on a mobile connection is a hundred milliseconds that a faster connection does not shorten. Over-fetching wastes bandwidth, which gets cheaper every year; under-fetching wastes latency, which does not.',
    },
    {
      phase: 'graphql-query',
      text: 'One round trip, and a response with exactly the requested shape. Now read the other three numbers beside it. The request is the larger of the two, because the query is the body. The response says Cache-Control: no-store, because a shared cache cannot key on a POST body -- every browser cache, CDN, and reverse proxy in the path is out of the picture, and the caching REST got for free has to be rebuilt on the client. And the server spent five data-source calls serving it: one for the user, one for the posts, and one per post for the comment count.',
    },
    {
      phase: 'graphql-query',
      target: 'api',
      text: 'That five is the N+1 problem, and it is the resolver model working as designed rather than anybody’s mistake: fields resolve independently, so a field on n siblings resolves n times. Every production GraphQL server installs a batching layer -- DataLoader is the usual one -- which collapses the per-field calls into one per level. The same query with batching on costs three. Both halves of the usual exchange are true, and the counter is here so neither side of it can be waved away.',
    },
  ],
};
