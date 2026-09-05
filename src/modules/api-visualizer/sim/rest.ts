/**
 * REST -- resources, verbs, and the status code that is actually correct.
 *
 * Most API tutorials teach REST as a table: POST means create, `200` means fine. That table
 * is a summary of the real rules and it is wrong in the places that matter. The real rules
 * are two properties, defined per method in RFC 9110 s 9.2, from which nearly everything
 * else follows:
 *
 * - **safe** -- the method is read-only, so a crawler, a link prefetcher, or a browser
 *   restoring a tab may perform it without asking. This is why `GET /articles/1/delete` is
 *   not a clever shortcut but a bug waiting for a search engine to find it.
 * - **idempotent** -- performing it *N* times leaves the server in the state one would. This
 *   is what decides whether a client may retry after a timeout, which is the single most
 *   consequential question in API design, because a timed-out request is indistinguishable
 *   from a lost response.
 *
 * `POST` is neither, and that is its whole character. Everything about idempotency keys,
 * `PUT`-with-a-client-chosen-id, and the double-charged customer traces back to it.
 *
 * ## The bit people get wrong about DELETE
 *
 * `DELETE` is idempotent, and a second `DELETE` returns `404`. Those look contradictory and
 * are not. Idempotency is a property of the **server's state**, not of the response: after
 * one delete and after five, the resource is equally gone. The `404` describes the state the
 * client found, not a different effect. {@link deleteTwice} demonstrates it, because the
 * sentence alone never convinces anyone.
 *
 * ## Status selection
 *
 * {@link STATUS_CHOICES} is the part of this file most worth reading. The interesting
 * choices are not between success and failure but between two successes -- `200` or `204`,
 * `201` or `202` -- and each one encodes a different promise about what the server did.
 *
 * ## Scope
 *
 * A router, a store, and a decision record. Pagination, auth, and rate limiting each layer
 * over this in their own file and compose in `exchange.ts`; keeping them out means the verb
 * semantics can be read, and tested, on their own.
 */

import type { RfcRef } from '@/core/types/events';

import {
  header,
  headerValue,
  isHttpMethod,
  jsonText,
  parseJson,
  parseTarget,
  response,
  setHeader,
  withJsonBody,
  type HeaderList,
  type HttpMethod,
  type HttpRequest,
  type HttpResponse,
  type JsonObject,
  type JsonValue,
} from './message';

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

const SEMANTICS_TITLE = 'HTTP Semantics';

/** RFC 9110 s 9.2 -- common method properties: safe, idempotent, cacheable. */
export const RFC_9110_METHOD_PROPERTIES: RfcRef = {
  rfc: 9110,
  section: '9.2',
  title: SEMANTICS_TITLE,
};

/** RFC 9110 s 15 -- status codes. */
export const RFC_9110_STATUS: RfcRef = {
  rfc: 9110,
  section: '15',
  title: SEMANTICS_TITLE,
};

/** RFC 9110 s 10.2.2 -- the Location field. */
export const RFC_9110_LOCATION: RfcRef = {
  rfc: 9110,
  section: '10.2.2',
  title: SEMANTICS_TITLE,
};

/** RFC 5789 -- the PATCH method. */
export const RFC_5789: RfcRef = { rfc: 5789, title: 'PATCH Method for HTTP' };

/** RFC 7396 -- JSON Merge Patch, the patch format this module applies. */
export const RFC_7396: RfcRef = { rfc: 7396, title: 'JSON Merge Patch' };

// ---------------------------------------------------------------------------
// Method semantics
// ---------------------------------------------------------------------------

/** What one method promises, and what it does not. */
export interface VerbSemantics {
  readonly method: HttpMethod;
  /** Read-only: performing it makes no change the client asked for (RFC 9110 s 9.2.1). */
  readonly safe: boolean;
  /** Repeating it leaves the same server state (RFC 9110 s 9.2.2). */
  readonly idempotent: boolean;
  /** A response may be stored and reused without an explicit freshness signal. */
  readonly cacheableByDefault: boolean;
  /** The verb in one line. */
  readonly what: string;
  /** The thing people get wrong about it. */
  readonly detail: string;
  /** Whether a request body is expected, tolerated, or meaningless. */
  readonly body: 'required' | 'optional' | 'none';
}

/**
 * Every method this module models, with the two properties that decide how it may be used.
 *
 * Note what safety and idempotency are *not*: promises the server is forced to keep. They
 * are promises the specification asks it to keep, and a `GET` handler that deletes a row is
 * a broken server, not a redefinition of `GET`. The value of the property is that everything
 * between the client and the server -- browsers, proxies, retry libraries, crawlers -- is
 * built assuming it holds.
 */
export const VERB_SEMANTICS: readonly VerbSemantics[] = [
  {
    method: 'GET',
    safe: true,
    idempotent: true,
    cacheableByDefault: true,
    body: 'none',
    what: 'Fetch the current representation of a resource.',
    detail:
      'Safe, so anything may perform it unbidden: a prefetcher, a crawler, a browser restoring tabs, an email client rendering a link preview. A GET that changes state will be triggered by all four.',
  },
  {
    method: 'HEAD',
    safe: true,
    idempotent: true,
    cacheableByDefault: true,
    body: 'none',
    what: 'Identical to GET, but the server sends only the header section.',
    detail:
      'The headers must be the ones GET would have sent -- including Content-Length, describing the body that is deliberately absent. That is how you check a size or an ETag without downloading anything.',
  },
  {
    method: 'POST',
    safe: false,
    idempotent: false,
    cacheableByDefault: false,
    body: 'required',
    what: 'Submit data for the target resource to process however it defines.',
    detail:
      'Neither safe nor idempotent -- the only method that is neither -- so a client that retries after a timeout may create two of something. Everything about idempotency keys exists because of this one row.',
  },
  {
    method: 'PUT',
    safe: false,
    idempotent: true,
    cacheableByDefault: false,
    body: 'required',
    what: 'Replace the target resource entirely with the enclosed representation.',
    detail:
      'Replace, not merge: a field left out of the body is a field removed. Idempotent because the body is the whole new state, so sending it five times ends where sending it once does.',
  },
  {
    method: 'PATCH',
    safe: false,
    idempotent: false,
    cacheableByDefault: false,
    body: 'required',
    what: 'Apply a described set of changes to the target resource.',
    detail:
      'Not idempotent in general, because a patch format may describe a relative change ("add 1 to the count"). JSON Merge Patch happens to be idempotent; JSON Patch need not be. The method cannot promise what the format does not.',
  },
  {
    method: 'DELETE',
    safe: false,
    idempotent: true,
    cacheableByDefault: false,
    body: 'none',
    what: 'Remove the association between the target and its current functionality.',
    detail:
      'Idempotent even though the second call returns 404. Idempotency is about the state left behind, not the status returned: after one delete and after five, the resource is equally gone.',
  },
  {
    method: 'OPTIONS',
    safe: true,
    idempotent: true,
    cacheableByDefault: false,
    body: 'none',
    what: 'Ask what the target supports; the answer is the Allow field.',
    detail:
      'Rarely called deliberately. Its common appearance is the CORS preflight, which a browser sends on its own initiative before certain cross-origin requests.',
  },
];

/** Look up one method's semantics. */
export function verbSemantics(method: HttpMethod): VerbSemantics {
  const found = VERB_SEMANTICS.find((entry) => entry.method === method);
  // Unreachable while HttpMethod and the table agree; a missing row is a repository bug.
  if (!found) throw new Error(`no semantics recorded for ${method}`);
  return found;
}

/** Read-only, so anything may perform it unbidden. */
export function isSafe(method: HttpMethod): boolean {
  return verbSemantics(method).safe;
}

/** Repeating it leaves the same state -- so a client may retry a timeout. */
export function isIdempotent(method: HttpMethod): boolean {
  return verbSemantics(method).idempotent;
}

/**
 * Whether a client may automatically retry after a timeout or a connection reset.
 *
 * The same thing as idempotency, given its own name because this is the question a retry
 * library is actually asking, and because "is it idempotent?" is asked about the method
 * while "may I retry?" is asked about the request. They come apart precisely when a POST
 * carries an idempotency key -- see `webhook.ts`, where the receiver's side of that bargain
 * is modelled.
 */
export function isAutomaticallyRetriable(method: HttpMethod): boolean {
  return isIdempotent(method);
}

// ---------------------------------------------------------------------------
// Status selection
// ---------------------------------------------------------------------------

/** One status, with the condition that makes it the right one. */
export interface StatusChoice {
  readonly status: number;
  readonly reason: string;
  /** When this status is the correct answer. */
  readonly when: string;
  /** What choosing it instead of the neighbouring code tells the client. */
  readonly contrast?: string;
  readonly reference: RfcRef;
}

/**
 * The status codes an API actually chooses between.
 *
 * Ordered as a decision list rather than numerically, because that is how it is used: the
 * hard calls are `200` versus `204`, `201` versus `202`, and `401` versus `403`, and each
 * pair is a genuine statement about what happened rather than a stylistic preference.
 */
export const STATUS_CHOICES: readonly StatusChoice[] = [
  {
    status: 200,
    reason: 'OK',
    when: 'The request succeeded and there is a representation to send back.',
    contrast:
      'Prefer 204 when there is genuinely nothing to send. A 200 with an empty body makes the client parse nothing and hope.',
    reference: { rfc: 9110, section: '15.3.1', title: SEMANTICS_TITLE },
  },
  {
    status: 201,
    reason: 'Created',
    when: 'The request created one or more resources. Location gives the primary one.',
    contrast:
      'A 201 without Location is the most common status bug in APIs: the client is told something was created and not told where.',
    reference: { rfc: 9110, section: '15.3.2', title: SEMANTICS_TITLE },
  },
  {
    status: 202,
    reason: 'Accepted',
    when: 'The work was queued, not done. Nothing has changed yet, and it may still fail.',
    contrast:
      'The honest answer for asynchronous work. 201 would be a lie: it promises the resource exists now, and 202 deliberately promises nothing.',
    reference: { rfc: 9110, section: '15.3.3', title: SEMANTICS_TITLE },
  },
  {
    status: 204,
    reason: 'No Content',
    when: 'The request succeeded and there is deliberately no body.',
    contrast:
      'The usual answer to DELETE, and to a PUT whose result the client already holds. A 204 may not carry a body at all -- not even an empty JSON object.',
    reference: { rfc: 9110, section: '15.3.5', title: SEMANTICS_TITLE },
  },
  {
    status: 400,
    reason: 'Bad Request',
    when: 'The request is malformed -- the server cannot parse it.',
    contrast:
      'Not a catch-all. If the syntax was fine and the meaning was wrong, 422 says so far more usefully.',
    reference: { rfc: 9110, section: '15.5.1', title: SEMANTICS_TITLE },
  },
  {
    status: 401,
    reason: 'Unauthorized',
    when: 'No credentials, or credentials that did not authenticate. WWW-Authenticate is required.',
    contrast:
      'Misnamed: it means unauthenticated. "Who are you?" A client may usefully retry after logging in.',
    reference: { rfc: 9110, section: '15.5.2', title: SEMANTICS_TITLE },
  },
  {
    status: 403,
    reason: 'Forbidden',
    when: 'The credentials were understood and are not permitted to do this.',
    contrast:
      '"I know who you are, and no." Retrying with the same credentials is pointless, which is exactly what distinguishes it from 401.',
    reference: { rfc: 9110, section: '15.5.4', title: SEMANTICS_TITLE },
  },
  {
    status: 404,
    reason: 'Not Found',
    when: 'There is no resource at this target, or the server will not say that there is.',
    contrast:
      'Also the polite answer where 403 would confirm that something exists. Hiding existence is a legitimate use.',
    reference: { rfc: 9110, section: '15.5.5', title: SEMANTICS_TITLE },
  },
  {
    status: 405,
    reason: 'Method Not Allowed',
    when: 'The target exists but does not support this method. Allow is required.',
    contrast:
      'The Allow field is mandatory and routinely omitted, which turns a helpful answer into a guessing game.',
    reference: { rfc: 9110, section: '15.5.6', title: SEMANTICS_TITLE },
  },
  {
    status: 409,
    reason: 'Conflict',
    when: 'The request conflicts with the resource’s current state.',
    contrast:
      'A duplicate unique key, or an edit against a version that has moved on. Says "try again after looking", where 400 says "you wrote it wrong".',
    reference: { rfc: 9110, section: '15.5.10', title: SEMANTICS_TITLE },
  },
  {
    status: 415,
    reason: 'Unsupported Media Type',
    when: 'The body is in a format this resource does not accept.',
    contrast:
      'What a JSON API owes a client that sent form encoding -- rather than a 400, which suggests the bytes were broken.',
    reference: { rfc: 9110, section: '15.5.16', title: SEMANTICS_TITLE },
  },
  {
    status: 422,
    reason: 'Unprocessable Content',
    when: 'The syntax parsed and the content is semantically wrong -- a missing field, a bad value.',
    contrast:
      'The distinction from 400 is the whole point: 400 means "I could not read it", 422 means "I read it, and it says something impossible".',
    reference: { rfc: 9110, section: '15.5.21', title: SEMANTICS_TITLE },
  },
  {
    status: 429,
    reason: 'Too Many Requests',
    when: 'The client has sent too many requests in a window. See ratelimit.ts.',
    contrast:
      'Should carry Retry-After. Without it, every client invents its own backoff and they all synchronise.',
    reference: { rfc: 6585, section: '4', title: 'Additional HTTP Status Codes' },
  },
];

/** Look up the copy for a status this module can return. */
export function statusChoice(status: number): StatusChoice | undefined {
  return STATUS_CHOICES.find((entry) => entry.status === status);
}

/** The reason phrase for a status, or an empty string. Advisory text only. */
export function reasonPhrase(status: number): string {
  return statusChoice(status)?.reason ?? '';
}

// ---------------------------------------------------------------------------
// The resource model
// ---------------------------------------------------------------------------

/** One field of a resource, described for the explorer and the shape view. */
export interface FieldDefinition {
  readonly name: string;
  readonly type: 'string' | 'number' | 'boolean' | 'id' | 'list';
  /** What the field means -- shown beside the value in `ResponseShape`. */
  readonly what: string;
  /** Whether a create request must supply it. */
  readonly required?: boolean;
  /** Whether the server owns it and a client may not set it. */
  readonly serverOwned?: boolean;
}

/**
 * One resource type.
 *
 * Resources are **nouns**, and their paths are plural nouns. That convention is not
 * decoration: it is what makes the method the only verb in the request, which is what lets
 * every intermediary reason about a request it knows nothing else about. `/getArticle` is a
 * remote procedure call wearing HTTP as a costume -- and there is nothing wrong with RPC, but
 * a cache cannot help you with it, because the method no longer says whether it is safe.
 */
export interface ResourceDefinition {
  /** Plural, lower-case: `articles`. Also the key into {@link RestStore.records}. */
  readonly name: string;
  /** Singular, for prose: `article`. */
  readonly singular: string;
  /** The collection path: `/articles`. Items live beneath it at `/articles/{id}`. */
  readonly collectionPath: string;
  readonly summary: string;
  readonly fields: readonly FieldDefinition[];
  /** Methods allowed on the collection itself. */
  readonly collectionMethods: readonly HttpMethod[];
  /** Methods allowed on one item. */
  readonly itemMethods: readonly HttpMethod[];
  /**
   * When set, POST to this collection is asynchronous: the server answers `202` and the work
   * is not done yet. Modelled because "the request succeeded" and "the thing exists" are two
   * different claims, and only one status makes the weaker one.
   */
  readonly asynchronousCreate?: boolean;
}

/** One stored record: an id the server owns, and the attributes a client may write. */
export interface RestRecord {
  readonly id: string;
  readonly attributes: JsonObject;
}

/** The mock API's entire state. Immutable -- every handler returns a new one. */
export interface RestStore {
  readonly resources: readonly ResourceDefinition[];
  /** Records per resource name, in insertion order. */
  readonly records: Readonly<Record<string, readonly RestRecord[]>>;
  /** The next id per resource. Sequential so scenarios are readable, not because it is wise. */
  readonly nextId: Readonly<Record<string, number>>;
}

/** Build a store from resource definitions and their seed records. */
export function createStore(
  resources: readonly ResourceDefinition[],
  seed: Readonly<Record<string, readonly RestRecord[]>> = {},
): RestStore {
  const records: Record<string, readonly RestRecord[]> = {};
  const nextId: Record<string, number> = {};
  for (const resource of resources) {
    const seeded = seed[resource.name] ?? [];
    records[resource.name] = seeded;
    nextId[resource.name] =
      seeded.reduce((highest, record) => Math.max(highest, Number(record.id) || 0), 0) +
      1;
  }
  return { resources, records, nextId };
}

/** Every record of a resource, in insertion order. */
export function listRecords(store: RestStore, resource: string): readonly RestRecord[] {
  return store.records[resource] ?? [];
}

/** One record by id, or `undefined`. */
export function findRecord(
  store: RestStore,
  resource: string,
  id: string,
): RestRecord | undefined {
  return listRecords(store, resource).find((record) => record.id === id);
}

/** A record as the JSON document a response body carries: id first, then attributes. */
export function representation(record: RestRecord): JsonObject {
  return { id: record.id, ...record.attributes };
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/** What a request-target pointed at. */
export type TargetKind = 'collection' | 'item' | 'unknown';

/** A parsed target, resolved against the store's resources. */
export interface RestTarget {
  readonly kind: TargetKind;
  readonly resource?: ResourceDefinition;
  /** Present when `kind` is `'item'`. */
  readonly id?: string;
  readonly path: string;
}

/** Resolve a request-target to a collection, an item, or nothing. */
export function resolveTarget(store: RestStore, target: string): RestTarget {
  const { path } = parseTarget(target);
  for (const resource of store.resources) {
    if (path === resource.collectionPath) {
      return { kind: 'collection', resource, path };
    }
    if (path.startsWith(`${resource.collectionPath}/`)) {
      const id = path.slice(resource.collectionPath.length + 1);
      // One segment only. `/articles/1/comments` is a different resource, not this one.
      if (id !== '' && !id.includes('/')) return { kind: 'item', resource, id, path };
    }
  }
  return { kind: 'unknown', path };
}

/** The methods allowed at a target -- the value of the `Allow` field. */
export function allowedMethods(target: RestTarget): readonly HttpMethod[] {
  if (!target.resource) return [];
  const declared =
    target.kind === 'collection'
      ? target.resource.collectionMethods
      : target.resource.itemMethods;
  // A server that supports GET must support HEAD (RFC 9110 s 9.3.2), and OPTIONS answers
  // for every target. Both are added here rather than repeated in every definition.
  const withImplied = new Set<HttpMethod>(declared);
  if (withImplied.has('GET')) withImplied.add('HEAD');
  withImplied.add('OPTIONS');
  return (['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const).filter(
    (method) => withImplied.has(method),
  );
}

// ---------------------------------------------------------------------------
// The decision record
// ---------------------------------------------------------------------------

/** Why the server answered the way it did -- the teaching payload of a request. */
export interface RestDecision {
  readonly method: HttpMethod;
  readonly target: RestTarget;
  readonly status: number;
  /** One sentence: why this status and not the neighbouring one. */
  readonly why: string;
  readonly safe: boolean;
  readonly idempotent: boolean;
  /** Ids created, replaced, or removed -- what the request did to the store. */
  readonly changed: readonly string[];
  readonly notes: readonly string[];
}

/** A request, the response, the store it left behind, and why. */
export interface RestOutcome {
  readonly store: RestStore;
  readonly request: HttpRequest;
  readonly response: HttpResponse;
  readonly decision: RestDecision;
}

// ---------------------------------------------------------------------------
// JSON Merge Patch (RFC 7396)
// ---------------------------------------------------------------------------

/**
 * Apply a JSON Merge Patch.
 *
 * The format is almost too simple to need a specification, and has one rule that surprises
 * everyone: **`null` means delete**. `{"subtitle": null}` removes `subtitle` rather than
 * setting it to null, which means a merge patch cannot express "set this field to null" at
 * all. That is the price of the format's simplicity, and it is why JSON Patch (RFC 6902),
 * with its explicit operation list, exists alongside it.
 *
 * Merge Patch is also idempotent -- applying the same patch twice changes nothing the second
 * time -- even though the PATCH *method* is not. The method cannot promise what the format
 * does not, so it promises nothing and each format speaks for itself.
 */
export function applyMergePatch(target: JsonObject, patch: JsonObject): JsonObject {
  const out: Record<string, JsonValue> = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete out[key];
    } else if (isPlainObject(value)) {
      const existing = out[key];
      out[key] = applyMergePatch(isPlainObject(existing) ? existing : {}, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function isPlainObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// The handler
// ---------------------------------------------------------------------------

/** Options a scenario can vary without editing the router. */
export interface RestOptions {
  /**
   * Whether a successful `PUT` returns the new representation (`200`) or nothing (`204`).
   * Both are correct; the choice is about whether the client already knows what it sent.
   */
  readonly putReturnsRepresentation?: boolean;
}

/**
 * Handle one request against the mock API.
 *
 * Pure: the store goes in, a new store comes out, and nothing else changes. The `decision`
 * is as much the point as the response -- it is what the console renders under the status
 * line, and what `rest.test.ts` asserts on.
 */
export function handleRest(
  store: RestStore,
  incoming: HttpRequest,
  options: RestOptions = {},
): RestOutcome {
  const target = resolveTarget(store, incoming.target);
  const semantics = verbSemantics(incoming.method);
  const base = {
    method: incoming.method,
    target,
    safe: semantics.safe,
    idempotent: semantics.idempotent,
  } as const;

  const finish = (
    result: HttpResponse,
    next: RestStore,
    why: string,
    changed: readonly string[] = [],
    notes: readonly string[] = [],
  ): RestOutcome => ({
    store: next,
    request: incoming,
    response: result,
    decision: { ...base, status: result.status, why, changed, notes },
  });

  if (target.kind === 'unknown' || !target.resource) {
    return finish(
      problem(404, 'No resource is routed at this path.'),
      store,
      'Nothing is routed here, so there is no resource whose existence could be reported.',
    );
  }

  const resource = target.resource;
  const allow = allowedMethods(target);

  if (incoming.method === 'OPTIONS') {
    return finish(
      response({
        status: 204,
        reason: reasonPhrase(204),
        headers: [header('Allow', allow.join(', '))],
      }),
      store,
      'OPTIONS answers with the Allow field and no body; 204 is the shape of that answer.',
      [],
      [
        'A browser sends OPTIONS on its own as a CORS preflight, before certain requests.',
      ],
    );
  }

  if (!allow.includes(incoming.method)) {
    return finish(
      withAllow(problem(405, `${incoming.method} is not supported here.`), allow),
      store,
      'The target exists, so this is 405 and not 404 -- and 405 obliges the server to send Allow.',
    );
  }

  switch (incoming.method) {
    case 'GET':
    case 'HEAD':
      return handleRead(store, incoming, target, resource, finish);
    case 'POST':
      return handleCreate(store, incoming, target, resource, finish);
    case 'PUT':
      return handleReplace(store, incoming, target, resource, options, finish);
    case 'PATCH':
      return handlePatch(store, incoming, target, resource, finish);
    case 'DELETE':
      return handleDelete(store, incoming, target, resource, finish);
    default:
      return finish(
        problem(405, `${incoming.method} is not supported here.`),
        store,
        'Unreachable while allowedMethods and this switch agree.',
      );
  }
}

type Finish = (
  result: HttpResponse,
  next: RestStore,
  why: string,
  changed?: readonly string[],
  notes?: readonly string[],
) => RestOutcome;

function handleRead(
  store: RestStore,
  incoming: HttpRequest,
  target: RestTarget,
  resource: ResourceDefinition,
  finish: Finish,
): RestOutcome {
  if (target.kind === 'collection') {
    const items = listRecords(store, resource.name).map(representation);
    const body: JsonObject = { data: items, total: items.length };
    return finish(
      bodyForMethod(incoming.method, jsonResponseWithCache(200, body)),
      store,
      'A collection always exists, even when it is empty. An empty collection is 200 with an empty list, never 404.',
      [],
      incoming.method === 'HEAD'
        ? [
            'HEAD sends the headers GET would have sent, including the Content-Length of the body it is not sending.',
          ]
        : [],
    );
  }

  const record = findRecord(store, resource.name, target.id as string);
  if (!record) {
    return finish(
      problem(404, `No ${resource.singular} with id ${target.id}.`),
      store,
      'The collection exists; this member does not.',
    );
  }
  return finish(
    bodyForMethod(incoming.method, jsonResponseWithCache(200, representation(record))),
    store,
    'A representation exists and is being sent, so 200 rather than 204.',
  );
}

function handleCreate(
  store: RestStore,
  incoming: HttpRequest,
  target: RestTarget,
  resource: ResourceDefinition,
  finish: Finish,
): RestOutcome {
  if (target.kind !== 'collection') {
    return finish(
      problem(
        405,
        'POST creates a member of a collection; it is not addressed to a member.',
      ),
      store,
      'POST goes to the collection, which is the resource that processes it.',
    );
  }

  const parsed = readJsonBody(incoming);
  if (!parsed.ok) return finish(parsed.response, store, parsed.why);

  const invalid = validate(resource, parsed.value, { partial: false });
  if (invalid) return finish(invalid.response, store, invalid.why);

  const id = `${store.nextId[resource.name]}`;
  const record: RestRecord = { id, attributes: parsed.value };
  const next: RestStore = {
    ...store,
    records: {
      ...store.records,
      [resource.name]: [...listRecords(store, resource.name), record],
    },
    nextId: { ...store.nextId, [resource.name]: store.nextId[resource.name] + 1 },
  };
  const location = `${resource.collectionPath}/${id}`;

  if (resource.asynchronousCreate) {
    return finish(
      withJsonBody(
        response({
          status: 202,
          reason: reasonPhrase(202),
          headers: [header('Location', `${resource.collectionPath}/jobs/${id}`)],
        }),
        { status: 'queued', id },
      ),
      next,
      '202 because the work was accepted, not done. 201 would promise the resource exists now, and it does not.',
      [id],
      [
        'Location on a 202 points at something that reports progress, not at the finished resource.',
      ],
    );
  }

  return finish(
    withJsonBody(
      response({
        status: 201,
        reason: reasonPhrase(201),
        headers: [header('Location', location)],
      }),
      representation(record),
    ),
    next,
    '201 because a resource now exists that did not before; Location says where it is.',
    [id],
    [
      'POST is not idempotent. Sending this request twice creates two resources with two different ids -- which is what an idempotency key is for.',
    ],
  );
}

function handleReplace(
  store: RestStore,
  incoming: HttpRequest,
  target: RestTarget,
  resource: ResourceDefinition,
  options: RestOptions,
  finish: Finish,
): RestOutcome {
  if (target.kind !== 'item') {
    return finish(
      problem(405, 'PUT replaces one resource, so it must address one.'),
      store,
      'PUT names the resource it is replacing; a collection has no single representation to replace.',
    );
  }

  const parsed = readJsonBody(incoming);
  if (!parsed.ok) return finish(parsed.response, store, parsed.why);

  const invalid = validate(resource, parsed.value, { partial: false });
  if (invalid) return finish(invalid.response, store, invalid.why);

  const id = target.id as string;
  const existing = findRecord(store, resource.name, id);
  const record: RestRecord = { id, attributes: parsed.value };
  const records = existing
    ? listRecords(store, resource.name).map((item) => (item.id === id ? record : item))
    : [...listRecords(store, resource.name), record];
  const next: RestStore = {
    ...store,
    records: { ...store.records, [resource.name]: records },
  };

  if (!existing) {
    return finish(
      withJsonBody(
        response({
          status: 201,
          reason: reasonPhrase(201),
          headers: [header('Location', `${resource.collectionPath}/${id}`)],
        }),
        representation(record),
      ),
      next,
      'PUT to a target with nothing there creates it, at the id the client chose -- so 201.',
      [id],
      [
        'This is the idempotent way to create: the client picks the id, so a retry replaces rather than duplicates.',
      ],
    );
  }

  const returnsBody = options.putReturnsRepresentation ?? false;
  return finish(
    returnsBody
      ? withJsonBody(
          response({ status: 200, reason: reasonPhrase(200) }),
          representation(record),
        )
      : response({ status: 204, reason: reasonPhrase(204) }),
    next,
    returnsBody
      ? '200 because the server is sending the stored representation back.'
      : '204 because the client already holds exactly what it sent; echoing it teaches nothing and costs bytes.',
    [id],
    [
      'PUT replaces. Any field the body omits is gone -- this is not a merge, and a client that sends a partial body silently deletes the rest.',
      'Repeating this exact request leaves the same state, which is what makes PUT safe to retry after a timeout.',
    ],
  );
}

function handlePatch(
  store: RestStore,
  incoming: HttpRequest,
  target: RestTarget,
  resource: ResourceDefinition,
  finish: Finish,
): RestOutcome {
  if (target.kind !== 'item') {
    return finish(
      problem(405, 'PATCH changes one resource, so it must address one.'),
      store,
      'A patch describes changes to a specific resource.',
    );
  }

  const contentType = headerValue(incoming.headers, 'Content-Type') ?? '';
  const mediaType = contentType.split(';')[0].trim().toLowerCase();
  if (
    mediaType !== '' &&
    mediaType !== 'application/merge-patch+json' &&
    mediaType !== 'application/json'
  ) {
    return finish(
      problem(
        415,
        `This resource patches with application/merge-patch+json, not ${mediaType}.`,
      ),
      store,
      '415, not 400: the bytes were fine, the format is not one this resource accepts.',
    );
  }

  const parsed = readJsonBody(incoming);
  if (!parsed.ok) return finish(parsed.response, store, parsed.why);

  const id = target.id as string;
  const existing = findRecord(store, resource.name, id);
  if (!existing) {
    return finish(
      problem(404, `No ${resource.singular} with id ${id} to patch.`),
      store,
      'A patch describes a change to something that exists. Unlike PUT, it cannot create.',
    );
  }

  const patched = applyMergePatch(existing.attributes, parsed.value);
  const invalid = validate(resource, patched, { partial: false });
  if (invalid) return finish(invalid.response, store, invalid.why);

  const record: RestRecord = { id, attributes: patched };
  const next: RestStore = {
    ...store,
    records: {
      ...store.records,
      [resource.name]: listRecords(store, resource.name).map((item) =>
        item.id === id ? record : item,
      ),
    },
  };

  return finish(
    withJsonBody(
      response({ status: 200, reason: reasonPhrase(200) }),
      representation(record),
    ),
    next,
    '200 with the patched representation, because after a partial change the client does not know the whole state.',
    [id],
    [
      'JSON Merge Patch reads null as "delete this field", so it cannot express "set this field to null".',
      'PATCH is not idempotent as a method, because a patch format may describe a relative change. This one happens to be.',
    ],
  );
}

function handleDelete(
  store: RestStore,
  incoming: HttpRequest,
  target: RestTarget,
  resource: ResourceDefinition,
  finish: Finish,
): RestOutcome {
  if (target.kind !== 'item') {
    return finish(
      problem(405, 'DELETE on a whole collection is refused here.'),
      store,
      'Deleting a collection is legal HTTP and almost always a mistake to expose.',
    );
  }

  const id = target.id as string;
  const existing = findRecord(store, resource.name, id);
  if (!existing) {
    return finish(
      problem(404, `No ${resource.singular} with id ${id}.`),
      store,
      'Already gone. The 404 reports the state the client found -- it does not mean the delete failed.',
      [],
      [
        'DELETE is still idempotent: the state after one call and after five is identical. Idempotency is about the state left behind, not the status returned.',
      ],
    );
  }

  const next: RestStore = {
    ...store,
    records: {
      ...store.records,
      [resource.name]: listRecords(store, resource.name).filter((item) => item.id !== id),
    },
  };
  return finish(
    response({ status: 204, reason: reasonPhrase(204) }),
    next,
    '204 because the resource is gone and there is nothing left to represent.',
    [id],
    [
      'A 204 carries no body at all -- not even {} -- so clients must not try to parse one.',
    ],
  );
}

// ---------------------------------------------------------------------------
// Bodies, validation, and problem documents
// ---------------------------------------------------------------------------

type BodyResult =
  | { readonly ok: true; readonly value: JsonObject }
  | { readonly ok: false; readonly response: HttpResponse; readonly why: string };

function readJsonBody(incoming: HttpRequest): BodyResult {
  const contentType = headerValue(incoming.headers, 'Content-Type') ?? '';
  const mediaType = contentType.split(';')[0].trim().toLowerCase();
  if (
    mediaType !== '' &&
    mediaType !== 'application/json' &&
    mediaType !== 'application/merge-patch+json'
  ) {
    return {
      ok: false,
      response: problem(415, `This API accepts application/json, not ${mediaType}.`),
      why: '415, not 400: the request was well formed, in a format this resource does not accept.',
    };
  }
  if (incoming.body === undefined || incoming.body.trim() === '') {
    return {
      ok: false,
      response: problem(400, 'A body is required and none was sent.'),
      why: 'There is nothing to process, which is a syntax problem rather than a semantic one.',
    };
  }
  const parsed = parseJson(incoming.body);
  if (!parsed.ok) {
    return {
      ok: false,
      response: problem(400, `The body is not valid JSON: ${parsed.error}`),
      why: '400 because the server could not parse the request at all.',
    };
  }
  if (!isPlainObject(parsed.value)) {
    return {
      ok: false,
      response: problem(422, 'The body must be a JSON object describing the resource.'),
      why: '422 because the JSON parsed cleanly and then said something this resource cannot use.',
    };
  }
  return { ok: true, value: parsed.value };
}

function validate(
  resource: ResourceDefinition,
  attributes: JsonObject,
  { partial }: { partial: boolean },
): { readonly response: HttpResponse; readonly why: string } | undefined {
  const problems: string[] = [];
  for (const field of resource.fields) {
    if (field.name === 'id' || field.serverOwned) {
      if (field.serverOwned && field.name in attributes) {
        problems.push(`"${field.name}" is set by the server and may not be sent.`);
      }
      continue;
    }
    const value = attributes[field.name];
    if (value === undefined) {
      if (field.required && !partial) problems.push(`"${field.name}" is required.`);
      continue;
    }
    if (!matchesType(value, field.type)) {
      problems.push(`"${field.name}" must be a ${field.type}.`);
    }
  }
  if (problems.length === 0) return undefined;
  return {
    response: problem(422, problems.join(' ')),
    why: '422 rather than 400: the JSON was readable, and what it said was not usable.',
  };
}

function matchesType(value: JsonValue, type: FieldDefinition['type']): boolean {
  switch (type) {
    case 'string':
    case 'id':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    case 'list':
      return Array.isArray(value);
  }
}

/**
 * An error response as an RFC 9457 problem document.
 *
 * `application/problem+json` exists so that a client can read an error from an API it has
 * never seen: `type`, `title`, `status`, `detail`. The alternative -- every API inventing
 * `{"error": "..."}` or `{"message": "..."}` or `{"errors": [...]}` -- is why error handling
 * is written once per integration instead of once.
 */
export function problem(
  status: number,
  detail: string,
  extra: JsonObject = {},
): HttpResponse {
  const document: JsonObject = {
    type: 'about:blank',
    title: reasonPhrase(status),
    status,
    detail,
    ...extra,
  };
  const body = jsonText(document);
  return response({
    status,
    reason: reasonPhrase(status),
    headers: [
      header('Content-Type', 'application/problem+json'),
      header('Content-Length', `${new TextEncoder().encode(body).length}`),
    ],
    body,
  });
}

/** RFC 9457 -- Problem Details for HTTP APIs. */
export const RFC_9457: RfcRef = { rfc: 9457, title: 'Problem Details for HTTP APIs' };

function withAllow(result: HttpResponse, allow: readonly HttpMethod[]): HttpResponse {
  return { ...result, headers: setHeader(result.headers, 'Allow', allow.join(', ')) };
}

function jsonResponseWithCache(status: number, body: JsonObject): HttpResponse {
  return withJsonBody(response({ status, reason: reasonPhrase(status) }), body);
}

/**
 * Strip the body from a HEAD response, keeping every header -- `Content-Length` included.
 *
 * That retained `Content-Length` is the point of HEAD. It describes the body GET would have
 * sent, so a client can learn a resource's size, media type, or entity tag without
 * transferring it. A server that recomputed the length as `0` would break every such client.
 */
function bodyForMethod(method: HttpMethod, result: HttpResponse): HttpResponse {
  if (method !== 'HEAD') return result;
  return {
    status: result.status,
    reason: result.reason,
    headers: result.headers,
  };
}

// ---------------------------------------------------------------------------
// Demonstrations
// ---------------------------------------------------------------------------

/** The result of sending the same request more than once. */
export interface RepeatOutcome {
  readonly store: RestStore;
  readonly outcomes: readonly RestOutcome[];
  /** Ids that exist at the end. The number of them is the lesson. */
  readonly finalIds: readonly string[];
  readonly idempotent: boolean;
}

/**
 * Send the identical request `times` times and report what the store looks like afterwards.
 *
 * This is the demonstration that makes idempotency concrete instead of definitional. Three
 * `POST /articles` leave three articles; three `PUT /articles/99` leave one. Nothing about
 * the requests differs except the method, which is the entire claim.
 */
export function repeatRequest(
  store: RestStore,
  incoming: HttpRequest,
  times: number,
  options: RestOptions = {},
): RepeatOutcome {
  const outcomes: RestOutcome[] = [];
  let current = store;
  for (let attempt = 0; attempt < times; attempt += 1) {
    const outcome = handleRest(current, incoming, options);
    outcomes.push(outcome);
    current = outcome.store;
  }
  const target = resolveTarget(current, incoming.target);
  const finalIds = target.resource
    ? listRecords(current, target.resource.name).map((record) => record.id)
    : [];
  return {
    store: current,
    outcomes,
    finalIds,
    idempotent: isIdempotent(incoming.method),
  };
}

/** What two successive DELETEs of the same resource look like. */
export interface DeleteTwiceOutcome {
  readonly first: RestOutcome;
  readonly second: RestOutcome;
  /** True when the store is identical after both -- which is what idempotent means. */
  readonly sameStateAfterBoth: boolean;
}

/**
 * Delete the same resource twice.
 *
 * The pair `204` then `404` is the clearest counterexample to "idempotent means the same
 * response". The two statuses differ; the two end states do not, and it is the end state the
 * property is about.
 */
export function deleteTwice(store: RestStore, target: string): DeleteTwiceOutcome {
  const first = handleRest(store, { method: 'DELETE', target, headers: [] });
  const second = handleRest(first.store, { method: 'DELETE', target, headers: [] });
  return {
    first,
    second,
    sameStateAfterBoth:
      jsonText(storeSnapshot(first.store)) === jsonText(storeSnapshot(second.store)),
  };
}

function storeSnapshot(store: RestStore): JsonValue {
  return Object.fromEntries(
    Object.entries(store.records).map(([name, records]) => [
      name,
      records.map(representation),
    ]),
  );
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

/** A request with a JSON body and the headers that describe it. */
export function jsonRequest(init: {
  method: HttpMethod;
  target: string;
  body: JsonValue;
  headers?: HeaderList;
  contentType?: string;
}): HttpRequest {
  const body = jsonText(init.body);
  return {
    method: init.method,
    target: init.target,
    headers: [
      ...(init.headers ?? []),
      header('Content-Type', init.contentType ?? 'application/json'),
      header('Content-Length', `${new TextEncoder().encode(body).length}`),
    ],
    body,
  };
}

/**
 * Whether a string names a method this module models -- re-exported so callers validating
 * user input do not have to reach into `message.ts` for it.
 */
export { isHttpMethod };
