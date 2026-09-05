import { describe, expect, it } from 'vitest';

import {
  compareTransports,
  parseGraphQL,
  REST_VS_GRAPHQL,
  runQuery,
  validateDocument,
  type GraphQLSchema,
} from './graphql';
import type { JsonObject } from './message';

// ---------------------------------------------------------------------------
// A schema small enough to read
// ---------------------------------------------------------------------------

const USERS: readonly JsonObject[] = [
  { id: 'u1', name: 'Ada', email: 'ada@example.com', title: 'Engineer' },
  { id: 'u2', name: 'Grace', email: 'grace@example.com', title: 'Rear Admiral' },
];

const POSTS: readonly JsonObject[] = [
  { id: 'p1', title: 'On compilers', body: '...', authorId: 'u1', views: 10 },
  { id: 'p2', title: 'On loops', body: '...', authorId: 'u2', views: 20 },
  { id: 'p3', title: 'On bugs', body: '...', authorId: 'u2', views: 30 },
];

const schema: GraphQLSchema = {
  queryType: 'Query',
  types: {
    Query: {
      name: 'Query',
      fields: {
        user: {
          type: 'User',
          hitsDataSource: true,
          resolve: (_parent, args) => USERS.find((user) => user.id === args.id),
        },
        posts: {
          type: 'Post',
          list: true,
          hitsDataSource: true,
          resolve: (_parent, args) =>
            POSTS.slice(0, typeof args.limit === 'number' ? args.limit : POSTS.length),
        },
        broken: { type: 'String', fails: 'The reporting service is unavailable.' },
      },
    },
    User: {
      name: 'User',
      fields: {
        id: { type: 'ID' },
        name: { type: 'String' },
        email: { type: 'String' },
        title: { type: 'String' },
      },
    },
    Post: {
      name: 'Post',
      fields: {
        id: { type: 'ID' },
        title: { type: 'String' },
        body: { type: 'String' },
        views: { type: 'Int' },
        author: {
          type: 'User',
          hitsDataSource: true,
          resolve: (parent) => USERS.find((user) => user.id === parent?.authorId),
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

describe('parseGraphQL', () => {
  it('parses the shorthand form with no query keyword', () => {
    const document = parseGraphQL('{ user(id: "u1") { name } }');
    expect(document.ok && document.value.operation).toBe('query');
    expect(document.ok && document.value.selections[0]).toMatchObject({
      name: 'user',
      responseKey: 'user',
      args: { id: 'u1' },
    });
  });

  it('parses a named operation', () => {
    const document = parseGraphQL('query Profile { user(id: "u1") { name } }');
    expect(document.ok && document.value.name).toBe('Profile');
  });

  it('parses a mutation', () => {
    const document = parseGraphQL('mutation { user(id: "u1") { name } }');
    expect(document.ok && document.value.operation).toBe('mutation');
  });

  it('treats commas as whitespace, because they are', () => {
    const withCommas = parseGraphQL('{ user(id: "u1") { name, email } }');
    const without = parseGraphQL('{ user(id: "u1") { name email } }');
    expect(withCommas).toEqual(without);
  });

  it('ignores comments', () => {
    const document = parseGraphQL(
      '{\n  # the current user\n  user(id: "u1") { name }\n}',
    );
    expect(document.ok && document.value.selections).toHaveLength(1);
  });

  it('parses an alias, which comes before the field name', () => {
    const document = parseGraphQL('{ me: user(id: "u1") { name } }');
    expect(document.ok && document.value.selections[0]).toMatchObject({
      name: 'user',
      responseKey: 'me',
    });
  });

  it('parses string, number, boolean, and null arguments', () => {
    const document = parseGraphQL(
      '{ posts(limit: 2, since: "x", draft: false, tag: null) { id } }',
    );
    expect(document.ok && document.value.selections[0].args).toEqual({
      limit: 2,
      since: 'x',
      draft: false,
      tag: null,
    });
  });

  it('nests selection sets', () => {
    const document = parseGraphQL('{ posts { author { name } } }');
    const author = document.ok ? document.value.selections[0].selections[0] : undefined;
    expect(author?.selections.map((field) => field.name)).toEqual(['name']);
  });

  it.each([
    ['an empty document', ''],
    ['an unclosed brace', '{ user { name }'],
    ['an empty selection set', '{ user { } }'],
    ['a missing argument value', '{ user(id:) { name } }'],
    ['two operations', '{ a } { b }'],
  ])('rejects %s', (_label, source) => {
    expect(parseGraphQL(source).ok).toBe(false);
  });

  it('says plainly what it does not support rather than ignoring it', () => {
    expect(parseGraphQL('query ($id: ID!) { user(id: $id) { name } }')).toEqual({
      ok: false,
      error: expect.stringContaining('variables'),
    });
    expect(parseGraphQL('{ user { ...Fields } }')).toEqual({
      ok: false,
      error: expect.stringContaining('fragments'),
    });
    expect(parseGraphQL('{ user { name @include(if: true) } }')).toEqual({
      ok: false,
      error: expect.stringContaining('directives'),
    });
    expect(parseGraphQL('subscription { posts { id } }')).toEqual({
      ok: false,
      error: expect.stringContaining('subscriptions'),
    });
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('validation', () => {
  const validate = (source: string) => {
    const document = parseGraphQL(source);
    if (!document.ok) throw new Error(document.error);
    return validateDocument(schema, document.value);
  };

  it('accepts a valid query', () => {
    expect(validate('{ user(id: "u1") { name email } }')).toEqual([]);
  });

  it('rejects a field the type does not have', () => {
    expect(validate('{ user(id: "u1") { salary } }')[0].message).toBe(
      'Cannot query field "salary" on type "User".',
    );
  });

  it('rejects a selection set on a scalar', () => {
    expect(validate('{ user(id: "u1") { name { first } } }')[0].message).toMatch(
      /must not have/,
    );
  });

  it('rejects an object field with no selection set -- there is no "give me everything"', () => {
    expect(validate('{ user(id: "u1") }')[0].message).toMatch(
      /must have a selection set/,
    );
  });

  it('stops execution entirely: data is null, not partial', () => {
    const result = runQuery(schema, '{ user(id: "u1") { salary } }');
    expect(result.ok && result.value.data).toBeNull();
    expect(result.ok && result.value.errors).toHaveLength(1);
    expect(result.ok && result.value.stats.dataSourceCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

describe('executeGraphQL', () => {
  const run = (source: string, batching = false) => {
    const result = runQuery(schema, source, { batchDataSourceCalls: batching });
    if (!result.ok) throw new Error(result.error);
    return result.value;
  };

  it('returns exactly the fields requested and nothing else', () => {
    expect(run('{ user(id: "u1") { name } }').data).toEqual({ user: { name: 'Ada' } });
  });

  it('returns more fields when more are asked for', () => {
    expect(run('{ user(id: "u1") { name email } }').data).toEqual({
      user: { name: 'Ada', email: 'ada@example.com' },
    });
  });

  it('keys the response on the alias', () => {
    expect(run('{ me: user(id: "u1") { name } }').data).toEqual({ me: { name: 'Ada' } });
  });

  it('shapes a list and its nested objects', () => {
    expect(run('{ posts(limit: 2) { title author { name } } }').data).toEqual({
      posts: [
        { title: 'On compilers', author: { name: 'Ada' } },
        { title: 'On loops', author: { name: 'Grace' } },
      ],
    });
  });

  it('returns null for a missing object rather than failing the query', () => {
    expect(run('{ user(id: "nobody") { name } }').data).toEqual({ user: null });
  });

  it('reports a field failure alongside the data that did resolve', () => {
    // Partial success is ordinary in GraphQL, and barely expressible over HTTP status codes.
    const result = run('{ broken user(id: "u1") { name } }');
    expect(result.data).toEqual({ broken: null, user: { name: 'Ada' } });
    expect(result.errors).toEqual([
      { message: 'The reporting service is unavailable.', path: ['broken'] },
    ]);
  });

  it('puts the errors in the body while the transport still says 200', () => {
    const result = run('{ broken }');
    expect(result.body).toContain('"errors"');
    expect(result.body).toContain('"data"');
  });

  it('is deterministic', () => {
    expect(run('{ posts { title author { name } } }')).toEqual(
      run('{ posts { title author { name } } }'),
    );
  });
});

// ---------------------------------------------------------------------------
// N+1
// ---------------------------------------------------------------------------

describe('the N+1 problem', () => {
  const query = '{ posts(limit: 3) { title author { name } } }';

  it('costs one call for the list and one per item for the nested field', () => {
    const result = runQuery(schema, query);
    if (!result.ok) throw new Error(result.error);
    // 1 for Query.posts + 3 for Post.author. This is the default behaviour of the execution
    // model, not a mistake in the schema.
    expect(result.value.stats.callsByField).toEqual({
      'Query.posts': 1,
      'Post.author': 3,
    });
    expect(result.value.stats.dataSourceCalls).toBe(4);
  });

  it('collapses to two calls once the field is batched', () => {
    const result = runQuery(schema, query, { batchDataSourceCalls: true });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.stats.callsByField).toEqual({
      'Query.posts': 1,
      'Post.author': 1,
    });
    expect(result.value.stats.dataSourceCalls).toBe(2);
  });

  it('returns the same data either way -- batching is invisible to the client', () => {
    const naive = runQuery(schema, query);
    const batched = runQuery(schema, query, { batchDataSourceCalls: true });
    expect(naive.ok && naive.value.data).toEqual(batched.ok && batched.value.data);
  });

  it('charges nothing for scalar fields read off the parent', () => {
    const result = runQuery(schema, '{ posts { title body views } }');
    if (!result.ok) throw new Error(result.error);
    expect(result.value.stats.dataSourceCalls).toBe(1);
    expect(result.value.stats.fieldsResolved).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// The comparison
// ---------------------------------------------------------------------------

describe('compareTransports', () => {
  const query = '{ user(id: "u1") { name } posts(limit: 2) { title } }';
  const graphqlResult = (() => {
    const result = runQuery(schema, query);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  })();

  const comparison = compareTransports({
    restCalls: [
      { method: 'GET', target: '/users/u1', responseBytes: 400, usedBytes: 40 },
      { method: 'GET', target: '/users/u1/posts', responseBytes: 900, usedBytes: 120 },
      {
        method: 'GET',
        target: '/posts/p1/comments',
        responseBytes: 300,
        usedBytes: 20,
        dependsOnPrevious: true,
      },
    ],
    graphqlQuery: query,
    graphqlResult,
  });

  it('counts REST round trips and GraphQL’s single one', () => {
    expect(comparison.rest.roundTrips).toBe(3);
    expect(comparison.graphql.roundTrips).toBe(1);
  });

  it('separates round trips from *sequential* round trips', () => {
    // Independent calls cost one round trip of latency between them; a dependent call adds
    // another. Under-fetching is a latency problem, and latency does not improve with bandwidth.
    expect(comparison.rest.sequentialRoundTrips).toBe(2);
  });

  it('measures over-fetching in bytes rather than asserting it', () => {
    expect(comparison.rest.responseBytes).toBe(1600);
    expect(comparison.rest.usedBytes).toBe(180);
    expect(comparison.rest.wastedBytes).toBe(1420);
    expect(comparison.graphql.wastedBytes).toBe(0);
  });

  it('admits that the GraphQL request is larger', () => {
    expect(comparison.graphql.requestBytes).toBeGreaterThan(query.length);
    expect(comparison.notes.join(' ')).toMatch(/GraphQL request is larger/);
  });

  it('names the caching cost in the same breath as the byte saving', () => {
    expect(comparison.notes.join(' ')).toMatch(/cacheable by URL/);
  });

  it('reports the server-side cost the client no longer sees', () => {
    expect(comparison.notes.join(' ')).toMatch(/data-source call/);
  });
});

describe('the tradeoff table', () => {
  it('says something substantive about both models on every row', () => {
    expect(REST_VS_GRAPHQL.length).toBeGreaterThanOrEqual(6);
    for (const row of REST_VS_GRAPHQL) {
      expect(row.rest.length).toBeGreaterThan(40);
      expect(row.graphql.length).toBeGreaterThan(40);
    }
  });

  it('covers caching, N+1, cost control, and errors -- GraphQL’s four weak points', () => {
    const topics = REST_VS_GRAPHQL.map((row) => row.topic.toLowerCase()).join(' ');
    expect(topics).toMatch(/caching/);
    expect(topics).toMatch(/n\+1/);
    expect(topics).toMatch(/cost/);
    expect(topics).toMatch(/errors/);
  });

  it('credits REST where REST wins', () => {
    const caching = REST_VS_GRAPHQL.find((row) => row.topic.includes('caching'));
    expect(caching?.rest).toMatch(/Free/);
    expect(caching?.graphql).toMatch(/absent/);
  });

  it('credits GraphQL where GraphQL wins', () => {
    const fetching = REST_VS_GRAPHQL.find((row) => row.topic.includes('exactly what'));
    expect(fetching?.graphql).toMatch(/no unused fields/);
  });
});
