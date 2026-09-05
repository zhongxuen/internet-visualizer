/**
 * GraphQL -- one endpoint, a query that describes the answer, and the bill that comes with it.
 *
 * The pitch is easy to state and genuinely true: the client sends the *shape* it wants and
 * receives exactly that shape, in one round trip, instead of calling three REST endpoints and
 * discarding most of what they return. A screen needing a user's name, their last three post
 * titles, and a comment count is three requests and several kilobytes over REST, and one
 * request of a few hundred bytes over GraphQL.
 *
 * The pitch is also incomplete in ways that matter, and this file models both halves, because
 * a module that only taught the pitch would be advertising rather than explaining.
 *
 * ## What GraphQL gives up
 *
 * - **HTTP caching.** REST's cache story is the URL: `GET /articles/1` is a cache key, and
 *   every browser, proxy, and CDN between client and origin already knows what to do with it
 *   at no cost to anyone. GraphQL is one `POST /graphql` whose meaning is in the body. A
 *   shared cache cannot key on that, cannot know what a mutation invalidated, and by default
 *   does nothing at all. The answer is a client-side normalised cache -- real, effective, and
 *   entirely your problem, where REST's was free.
 * - **N+1 queries.** The resolver model is per-field, so a query for 50 posts and each post's
 *   author naively runs one query for the posts and then fifty more, one per author. This is
 *   not a beginner's mistake; it is the default behaviour of the execution model, and every
 *   production GraphQL server runs a batching layer to undo it. {@link executeGraphQL} counts
 *   the calls so the shape is visible rather than asserted.
 * - **Cost control.** A REST endpoint's worst case is bounded by its author. A GraphQL query
 *   can nest `posts { author { posts { author { ... } } } }` until the server falls over,
 *   which is why real deployments need depth limits, complexity scoring, or persisted queries
 *   -- three things REST never needed.
 * - **Status codes.** A GraphQL error usually arrives as `200 OK` with an `errors` array,
 *   because the *transport* succeeded. Every piece of HTTP machinery that reacts to status
 *   codes -- retries, alerting, dashboards -- goes blind.
 *
 * Both models are defensible. The honest summary is that GraphQL moves work from the network
 * to the server and from the server to the client's cache, and whether that trade is good
 * depends on how many clients there are and how different their needs are.
 *
 * ## Scope of the parser
 *
 * Fields, aliases, nested selection sets, scalar arguments, and comments. **No** fragments,
 * variables, directives, subscriptions, or introspection. That is enough for the contrast the
 * module is drawing and stops well short of pretending to be an implementation; anything
 * unsupported is rejected with a message saying so, never silently ignored.
 */

import { fail, ok, type ParseResult } from '@/core/net/result';

import { byteLength, jsonText, type JsonObject, type JsonValue } from './message';

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

/** One requested field. */
export interface GraphQLField {
  /** The field on the type. */
  readonly name: string;
  /** The key it appears under in the response -- the alias, or the name. */
  readonly responseKey: string;
  readonly args: JsonObject;
  /** Nested selections. Empty for a scalar. */
  readonly selections: readonly GraphQLField[];
}

/** A parsed operation. */
export interface GraphQLDocument {
  readonly operation: 'query' | 'mutation';
  readonly name?: string;
  readonly selections: readonly GraphQLField[];
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

type Token =
  | { readonly kind: 'punct'; readonly value: string; readonly at: number }
  | { readonly kind: 'name'; readonly value: string; readonly at: number }
  | { readonly kind: 'string'; readonly value: string; readonly at: number }
  | { readonly kind: 'number'; readonly value: number; readonly at: number };

const PUNCTUATION = new Set(['{', '}', '(', ')', ':', '[', ']']);
const NAME_START = /[A-Za-z_]/;
const NAME_REST = /[A-Za-z0-9_]/;

function tokenize(source: string): ParseResult<readonly Token[]> {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const character = source[index];

    // Whitespace and commas are both insignificant in GraphQL: a comma is documentation
    // for the reader, not syntax, which is why `{ a b }` and `{ a, b }` are the same query.
    if (/[\s,﻿]/.test(character)) {
      index += 1;
      continue;
    }
    if (character === '#') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (PUNCTUATION.has(character)) {
      tokens.push({ kind: 'punct', value: character, at: index });
      index += 1;
      continue;
    }
    if (character === '"') {
      let value = '';
      index += 1;
      while (index < source.length && source[index] !== '"') {
        if (source[index] === '\\') {
          index += 1;
          if (index >= source.length) return fail('unterminated escape in a string');
          const escaped = source[index];
          value += escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped;
        } else {
          value += source[index];
        }
        index += 1;
      }
      if (index >= source.length) return fail('unterminated string');
      index += 1;
      tokens.push({ kind: 'string', value, at: index });
      continue;
    }
    if (/[-0-9]/.test(character)) {
      const start = index;
      index += 1;
      while (index < source.length && /[0-9.eE+-]/.test(source[index])) index += 1;
      const text = source.slice(start, index);
      const value = Number(text);
      if (!Number.isFinite(value)) return fail(`"${text}" is not a number`);
      tokens.push({ kind: 'number', value, at: start });
      continue;
    }
    if (NAME_START.test(character)) {
      const start = index;
      while (index < source.length && NAME_REST.test(source[index])) index += 1;
      tokens.push({ kind: 'name', value: source.slice(start, index), at: start });
      continue;
    }
    if (character === '$') {
      return fail('variables ($name) are not supported by this teaching parser');
    }
    if (character === '.') {
      return fail('fragments (... on Type) are not supported by this teaching parser');
    }
    if (character === '@') {
      return fail(
        'directives (@include, @skip) are not supported by this teaching parser',
      );
    }
    return fail(`unexpected character "${character}" at position ${index}`);
  }
  return ok(tokens);
}

/**
 * Parse a query.
 *
 * The shorthand form -- a bare selection set with no `query` keyword -- is accepted because it
 * is what every example in every tutorial uses, and a parser that rejected it would look
 * broken to a learner pasting one in.
 */
export function parseGraphQL(source: string): ParseResult<GraphQLDocument> {
  const tokenized = tokenize(source);
  if (!tokenized.ok) return tokenized;
  const tokens = tokenized.value;

  let position = 0;
  const peek = (): Token | undefined => tokens[position];

  let operation: 'query' | 'mutation' = 'query';
  let name: string | undefined;

  const first = peek();
  if (first === undefined) return fail('the document is empty');
  if (first.kind === 'name') {
    if (first.value !== 'query' && first.value !== 'mutation') {
      if (first.value === 'subscription') {
        return fail('subscriptions are not supported by this teaching parser');
      }
      if (first.value === 'fragment') {
        return fail('fragments are not supported by this teaching parser');
      }
      return fail(
        `expected "query", "mutation", or a selection set, got "${first.value}"`,
      );
    }
    operation = first.value;
    position += 1;
    const maybeName = peek();
    if (maybeName?.kind === 'name') {
      name = maybeName.value;
      position += 1;
    }
  }

  const opening = peek();
  if (opening?.kind !== 'punct' || opening.value !== '{') {
    return fail('expected "{" to open the selection set');
  }

  const parseSelectionSet = (depth: number): ParseResult<readonly GraphQLField[]> => {
    if (depth > 20) return fail('selection set nested more than 20 deep');
    const open = tokens[position];
    if (open?.kind !== 'punct' || open.value !== '{') return fail('expected "{"');
    position += 1;

    const fields: GraphQLField[] = [];
    for (;;) {
      const token = tokens[position];
      if (token === undefined) return fail('unterminated selection set: expected "}"');
      if (token.kind === 'punct' && token.value === '}') {
        position += 1;
        if (fields.length === 0)
          return fail('a selection set must select at least one field');
        return ok(fields);
      }
      if (token.kind !== 'name') {
        return fail(`expected a field name, got ${describe(token)}`);
      }
      position += 1;

      let fieldName = token.value;
      const responseKey = token.value;
      // `alias: field` -- the alias comes first, which is the opposite of what most people
      // guess, and is what makes it possible to request the same field twice with different
      // arguments in one query.
      const colon = tokens[position];
      if (colon?.kind === 'punct' && colon.value === ':') {
        position += 1;
        const aliased = tokens[position];
        if (aliased?.kind !== 'name') return fail('expected a field name after an alias');
        position += 1;
        fieldName = aliased.value;
      }

      let args: JsonObject = {};
      const paren = tokens[position];
      if (paren?.kind === 'punct' && paren.value === '(') {
        const parsed = parseArguments();
        if (!parsed.ok) return parsed;
        args = parsed.value;
      }

      let selections: readonly GraphQLField[] = [];
      const brace = tokens[position];
      if (brace?.kind === 'punct' && brace.value === '{') {
        const nested = parseSelectionSet(depth + 1);
        if (!nested.ok) return nested;
        selections = nested.value;
      }

      fields.push({ name: fieldName, responseKey, args, selections });
    }
  };

  const parseArguments = (): ParseResult<JsonObject> => {
    position += 1; // consume '('
    const args: Record<string, JsonValue> = {};
    for (;;) {
      const token = tokens[position];
      if (token === undefined) return fail('unterminated argument list: expected ")"');
      if (token.kind === 'punct' && token.value === ')') {
        position += 1;
        return ok(args);
      }
      if (token.kind !== 'name') {
        return fail(`expected an argument name, got ${describe(token)}`);
      }
      position += 1;
      const colon = tokens[position];
      if (colon?.kind !== 'punct' || colon.value !== ':') {
        return fail(`argument "${token.value}" needs a colon and a value`);
      }
      position += 1;
      const value = tokens[position];
      if (value === undefined) return fail(`argument "${token.value}" has no value`);
      position += 1;
      if (value.kind === 'string') args[token.value] = value.value;
      else if (value.kind === 'number') args[token.value] = value.value;
      else if (value.kind === 'name') {
        args[token.value] =
          value.value === 'true'
            ? true
            : value.value === 'false'
              ? false
              : value.value === 'null'
                ? null
                : value.value;
      } else {
        return fail(`argument "${token.value}" has an unsupported value`);
      }
    }
  };

  const selections = parseSelectionSet(0);
  if (!selections.ok) return selections;
  if (position !== tokens.length) {
    return fail('this parser handles one operation per document');
  }

  return ok({
    operation,
    selections: selections.value,
    ...(name === undefined ? {} : { name }),
  });
}

function describe(token: Token): string {
  return token.kind === 'punct' ? `"${token.value}"` : `${token.kind} ${token.value}`;
}

// ---------------------------------------------------------------------------
// The schema
// ---------------------------------------------------------------------------

/** What a field returns. */
export interface SchemaField {
  /** A scalar name (`String`, `Int`, `Boolean`, `ID`) or a type in the schema. */
  readonly type: string;
  readonly list?: boolean;
  /**
   * Fetch the value.
   *
   * Absent means "read it off the parent object", which is what a real GraphQL server's
   * default resolver does and is why scalar fields cost nothing. A field *with* a resolver is
   * a field that hits a data source, and that is what makes N+1 possible.
   */
  readonly resolve?: (
    parent: JsonObject | undefined,
    args: JsonObject,
  ) => JsonValue | readonly JsonObject[] | undefined;
  /**
   * When set, resolving this field fails with this message.
   *
   * Modelled declaratively so a scenario can show partial data with an `errors` array beside
   * it -- the shape that makes GraphQL error handling different from HTTP's.
   */
  readonly fails?: string;
  /** Whether resolving this field is a data-source round trip. Counted for the N+1 view. */
  readonly hitsDataSource?: boolean;
}

/** One object type. */
export interface SchemaType {
  readonly name: string;
  readonly fields: Readonly<Record<string, SchemaField>>;
}

/** The schema: types, and the root query type. */
export interface GraphQLSchema {
  readonly types: Readonly<Record<string, SchemaType>>;
  readonly queryType: string;
}

const SCALARS = new Set(['String', 'Int', 'Float', 'Boolean', 'ID']);

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/** An error, with the response path it occurred at. */
export interface GraphQLError {
  readonly message: string;
  /** The path into `data`, e.g. `['user', 'posts', 0, 'title']` (RFC-free; GraphQL spec s 7.1.2). */
  readonly path?: readonly (string | number)[];
}

/** What a query cost, counted per field. */
export interface ResolverStats {
  /** Data-source round trips per field path, e.g. `{ 'Query.user': 1, 'Post.author': 50 }`. */
  readonly callsByField: Readonly<Record<string, number>>;
  /** Total data-source round trips. The N+1 number. */
  readonly dataSourceCalls: number;
  /** Fields resolved in total, data source or not. */
  readonly fieldsResolved: number;
}

/** The whole result of running a query. */
export interface GraphQLResult {
  /** `null` when validation failed, so nothing executed at all. */
  readonly data: JsonObject | null;
  readonly errors: readonly GraphQLError[];
  readonly stats: ResolverStats;
  /** The response body as it would be sent -- always `200 OK`, whatever `errors` says. */
  readonly body: string;
  readonly responseBytes: number;
}

/** Options for one execution. */
export interface ExecuteOptions {
  /**
   * Whether the server batches per-field data-source calls, as DataLoader does.
   *
   * With batching on, resolving the same field across `n` siblings costs one call instead of
   * `n`. That is the whole fix, and it is a library every serious GraphQL server installs --
   * which is worth saying plainly, because "GraphQL has an N+1 problem" is usually met with
   * "just use DataLoader", and both halves are true.
   */
  readonly batchDataSourceCalls?: boolean;
}

/**
 * Validate and execute a query against a schema.
 *
 * Validation happens first and completely. That is not an optimisation -- it is the GraphQL
 * execution model: a query naming a field that does not exist is rejected *before* anything
 * runs, and the response carries `data: null` with the errors. A field that exists and fails
 * while resolving is a different thing entirely: execution continues, that field becomes
 * `null`, and the error is reported alongside the data that did resolve. Partial success is
 * ordinary here, where in HTTP it barely exists.
 *
 * Either way the transport status is `200`, which is the trade-off named in the file header.
 */
export function executeGraphQL(
  schema: GraphQLSchema,
  document: GraphQLDocument,
  options: ExecuteOptions = {},
): GraphQLResult {
  const validationErrors = validateDocument(schema, document);
  if (validationErrors.length > 0) {
    const body = jsonText({
      data: null,
      errors: validationErrors.map((error) => ({ message: error.message })),
    });
    return {
      data: null,
      errors: validationErrors,
      stats: { callsByField: {}, dataSourceCalls: 0, fieldsResolved: 0 },
      body,
      responseBytes: byteLength(body),
    };
  }

  const calls: Record<string, number> = {};
  const errors: GraphQLError[] = [];
  let fieldsResolved = 0;
  const batched = options.batchDataSourceCalls ?? false;
  // With batching, a field is charged once per level rather than once per parent object.
  const batchedFields = new Set<string>();

  const resolveSelections = (
    typeName: string,
    selections: readonly GraphQLField[],
    parent: JsonObject | undefined,
    path: readonly (string | number)[],
  ): JsonObject => {
    const type = schema.types[typeName];
    const out: Record<string, JsonValue> = {};

    for (const selection of selections) {
      const field = type.fields[selection.name];
      const fieldKey = `${typeName}.${selection.name}`;
      const fieldPath = [...path, selection.responseKey];
      fieldsResolved += 1;

      if (field.hitsDataSource) {
        const alreadyCharged = batched && batchedFields.has(fieldKey);
        if (!alreadyCharged) {
          calls[fieldKey] = (calls[fieldKey] ?? 0) + 1;
          if (batched) batchedFields.add(fieldKey);
        }
      }

      if (field.fails !== undefined) {
        errors.push({ message: field.fails, path: fieldPath });
        out[selection.responseKey] = null;
        continue;
      }

      const raw = field.resolve
        ? field.resolve(parent, selection.args)
        : parent?.[selection.name];

      if (raw === undefined || raw === null) {
        out[selection.responseKey] = null;
        continue;
      }

      if (SCALARS.has(field.type)) {
        out[selection.responseKey] = raw as JsonValue;
        continue;
      }

      if (field.list) {
        const list = Array.isArray(raw) ? (raw as readonly JsonObject[]) : [];
        out[selection.responseKey] = list.map((item, index) =>
          resolveSelections(field.type, selection.selections, item, [
            ...fieldPath,
            index,
          ]),
        );
        continue;
      }

      out[selection.responseKey] = resolveSelections(
        field.type,
        selection.selections,
        raw as JsonObject,
        fieldPath,
      );
    }
    return out;
  };

  const data = resolveSelections(schema.queryType, document.selections, undefined, []);
  const body = jsonText(
    errors.length === 0
      ? { data }
      : {
          data,
          errors: errors.map((error) => ({
            message: error.message,
            path: error.path as JsonValue,
          })),
        },
  );

  return {
    data,
    errors,
    stats: {
      callsByField: calls,
      dataSourceCalls: Object.values(calls).reduce((total, count) => total + count, 0),
      fieldsResolved,
    },
    body,
    responseBytes: byteLength(body),
  };
}

/**
 * Check every field in the document against the schema.
 *
 * Three rules, and all three produce errors people meet on their first day: a field that does
 * not exist on the type; a scalar with a selection set on it; and an object field with none.
 * The last is the one that surprises -- GraphQL has no "give me the whole object" -- and it is
 * deliberate, because a query that could ask for everything would reintroduce over-fetching
 * and make every response's shape a server-side decision again.
 */
export function validateDocument(
  schema: GraphQLSchema,
  document: GraphQLDocument,
): readonly GraphQLError[] {
  const errors: GraphQLError[] = [];

  const walk = (
    typeName: string,
    selections: readonly GraphQLField[],
    path: readonly string[],
  ): void => {
    const type = schema.types[typeName];
    if (!type) {
      errors.push({ message: `Unknown type "${typeName}".`, path });
      return;
    }
    for (const selection of selections) {
      const field = type.fields[selection.name];
      const fieldPath = [...path, selection.responseKey];
      if (!field) {
        errors.push({
          message: `Cannot query field "${selection.name}" on type "${typeName}".`,
          path: fieldPath,
        });
        continue;
      }
      const isScalar = SCALARS.has(field.type);
      if (isScalar && selection.selections.length > 0) {
        errors.push({
          message: `Field "${selection.name}" must not have a selection set: ${field.type} is a scalar.`,
          path: fieldPath,
        });
        continue;
      }
      if (!isScalar && selection.selections.length === 0) {
        errors.push({
          message: `Field "${selection.name}" of type "${field.type}" must have a selection set.`,
          path: fieldPath,
        });
        continue;
      }
      if (!isScalar) walk(field.type, selection.selections, fieldPath);
    }
  };

  walk(schema.queryType, document.selections, []);
  return errors;
}

/** Parse and execute in one call -- the whole request, as the endpoint would handle it. */
export function runQuery(
  schema: GraphQLSchema,
  source: string,
  options: ExecuteOptions = {},
): ParseResult<GraphQLResult> {
  const document = parseGraphQL(source);
  if (!document.ok) return document;
  return ok(executeGraphQL(schema, document.value, options));
}

// ---------------------------------------------------------------------------
// The comparison
// ---------------------------------------------------------------------------

/** One REST call a screen has to make. */
export interface RestCall {
  readonly method: string;
  readonly target: string;
  /** Bytes the response carried. */
  readonly responseBytes: number;
  /** Bytes of that response the screen actually used. */
  readonly usedBytes: number;
  /** True when this call cannot start until an earlier one has returned. */
  readonly dependsOnPrevious?: boolean;
}

/** What one strategy cost. */
export interface TransportCost {
  readonly roundTrips: number;
  /** Round trips that cannot be made in parallel -- the ones that add latency. */
  readonly sequentialRoundTrips: number;
  readonly requestBytes: number;
  readonly responseBytes: number;
  readonly usedBytes: number;
  /** Bytes transferred and thrown away. Over-fetching, measured. */
  readonly wastedBytes: number;
}

/** Both strategies, side by side. */
export interface TransportComparison {
  readonly rest: TransportCost;
  readonly graphql: TransportCost;
  /** The observations a fair reading supports -- in both directions. */
  readonly notes: readonly string[];
}

/**
 * Measure the same screen's data over both strategies.
 *
 * Two numbers are worth separating and are routinely conflated.
 *
 * **Round trips** are not all equal. Three REST calls that can be issued at once cost one
 * round trip of latency; three where each needs an id from the last cost three. The second
 * pattern -- *under*-fetching, the client fetching a list and then looping to fetch each
 * item's detail -- is what makes REST feel slow on a mobile connection, and it is a worse
 * problem than over-fetching because latency does not improve with bandwidth.
 *
 * **Wasted bytes** are the over-fetching half: REST endpoints return a fixed representation,
 * and a screen wanting three fields of a forty-field object pays for all forty.
 *
 * GraphQL's request is *larger* -- the query is the body -- which is counted here rather than
 * quietly dropped, because on a small response the query can be a meaningful fraction of the
 * total.
 */
export function compareTransports(input: {
  readonly restCalls: readonly RestCall[];
  readonly graphqlQuery: string;
  readonly graphqlResult: GraphQLResult;
  /** Bytes of the GraphQL response the screen used. Defaults to all of it. */
  readonly graphqlUsedBytes?: number;
  /** Per-request header overhead, applied to both sides equally. */
  readonly headerBytes?: number;
}): TransportComparison {
  const headerBytes = input.headerBytes ?? 200;

  const restResponseBytes = input.restCalls.reduce(
    (total, call) => total + call.responseBytes,
    0,
  );
  const restUsedBytes = input.restCalls.reduce(
    (total, call) => total + call.usedBytes,
    0,
  );
  const sequential = input.restCalls.filter((call) => call.dependsOnPrevious).length;

  const rest: TransportCost = {
    roundTrips: input.restCalls.length,
    // Independent calls share one round trip; each dependent call adds another.
    sequentialRoundTrips: input.restCalls.length === 0 ? 0 : 1 + sequential,
    requestBytes: input.restCalls.reduce(
      (total, call) => total + headerBytes + byteLength(`${call.method} ${call.target}`),
      0,
    ),
    responseBytes: restResponseBytes,
    usedBytes: restUsedBytes,
    wastedBytes: restResponseBytes - restUsedBytes,
  };

  const graphqlUsed = input.graphqlUsedBytes ?? input.graphqlResult.responseBytes;
  const graphql: TransportCost = {
    roundTrips: 1,
    sequentialRoundTrips: 1,
    requestBytes: headerBytes + byteLength(input.graphqlQuery),
    responseBytes: input.graphqlResult.responseBytes,
    usedBytes: graphqlUsed,
    wastedBytes: input.graphqlResult.responseBytes - graphqlUsed,
  };

  const notes: string[] = [
    `REST needed ${rest.roundTrips} request${rest.roundTrips === 1 ? '' : 's'} (${rest.sequentialRoundTrips} of them unavoidably sequential); GraphQL needed one.`,
    `REST transferred ${rest.wastedBytes} bytes the screen never read; GraphQL returned the requested shape.`,
    `The GraphQL request is larger -- ${graphql.requestBytes} bytes against ${rest.requestBytes} -- because the query travels in the body.`,
    `Every REST response is cacheable by URL in any shared cache; the single POST /graphql is not, and its caching has to be rebuilt on the client.`,
  ];
  if (input.graphqlResult.stats.dataSourceCalls > 0) {
    notes.push(
      `Serving that one query cost ${input.graphqlResult.stats.dataSourceCalls} data-source call${input.graphqlResult.stats.dataSourceCalls === 1 ? '' : 's'} on the server -- work the client no longer sees but somebody still pays for.`,
    );
  }

  return { rest, graphql, notes };
}

/** One claim about one strategy, with the counter-claim attached. */
export interface Tradeoff {
  readonly topic: string;
  readonly rest: string;
  readonly graphql: string;
}

/**
 * The comparison as data, so the UI cannot quietly become an advertisement.
 *
 * Each row states what both models do. Where one is clearly better it says so; where the
 * answer is "it depends on how many different clients you have", it says that instead.
 */
export const REST_VS_GRAPHQL: readonly Tradeoff[] = [
  {
    topic: 'Fetching exactly what a screen needs',
    rest: 'Fixed representations. A screen wanting three fields of a forty-field object receives forty, and a screen needing data from three resources makes three calls.',
    graphql:
      'The query is the shape. One request, one response, no unused fields -- the reason GraphQL exists.',
  },
  {
    topic: 'HTTP caching',
    rest: 'Free and already deployed. The URL is the cache key, and every browser, proxy, and CDN in the path honours it without being told anything.',
    graphql:
      'Effectively absent. One POST endpoint whose meaning is in the body cannot be keyed on by a shared cache. Client-side normalised caching works well and is entirely your responsibility.',
  },
  {
    topic: 'Server cost of one request',
    rest: 'Bounded by whoever wrote the endpoint. The worst case is known in advance.',
    graphql:
      'Determined by the client. Deep or wide queries can be arbitrarily expensive, so depth limits, complexity scoring, or persisted queries become necessary.',
  },
  {
    topic: 'The N+1 problem',
    rest: 'Appears as under-fetching on the client: fetch a list, then loop and fetch each item. Visible in the network panel, and fixable with a batch endpoint.',
    graphql:
      'Appears on the server, because resolvers run per field. It is the default behaviour, not a mistake, and every production server installs a batching layer such as DataLoader to undo it.',
  },
  {
    topic: 'Errors',
    rest: 'Status codes, which every layer of tooling already understands -- retries, alerts, dashboards, load balancers.',
    graphql:
      'Usually 200 with an errors array, because the transport succeeded. Partial success is expressible, which HTTP handles badly, at the cost of making failure invisible to anything watching status codes.',
  },
  {
    topic: 'Evolving the API',
    rest: 'Versioned paths, or additive changes and a deprecation policy. Breaking changes are visible.',
    graphql:
      'Fields are deprecated rather than removed, and the schema records who queries what -- so unused fields can be retired with evidence. The schema itself becomes the contract to maintain.',
  },
  {
    topic: 'Number of client types',
    rest: 'Fine with one or two clients whose needs are known. Painful with many, each wanting a different slice.',
    graphql:
      'Pays for itself as clients multiply and diverge. For a single first-party web client, the machinery may cost more than it saves.',
  },
];
