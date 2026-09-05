import { describe, expect, it } from 'vitest';

import { headerValue, parseJson, request, type JsonObject } from './message';
import {
  allowedMethods,
  applyMergePatch,
  createStore,
  deleteTwice,
  findRecord,
  handleRest,
  isIdempotent,
  isSafe,
  jsonRequest,
  listRecords,
  repeatRequest,
  representation,
  resolveTarget,
  statusChoice,
  STATUS_CHOICES,
  VERB_SEMANTICS,
  verbSemantics,
  type ResourceDefinition,
  type RestStore,
} from './rest';

const articles: ResourceDefinition = {
  name: 'articles',
  singular: 'article',
  collectionPath: '/articles',
  summary: 'Published articles.',
  fields: [
    { name: 'title', type: 'string', what: 'The headline.', required: true },
    { name: 'body', type: 'string', what: 'The text.', required: true },
    { name: 'views', type: 'number', what: 'Read count.', serverOwned: true },
  ],
  collectionMethods: ['GET', 'POST'],
  itemMethods: ['GET', 'PUT', 'PATCH', 'DELETE'],
};

const exports_: ResourceDefinition = {
  name: 'exports',
  singular: 'export',
  collectionPath: '/exports',
  summary: 'Long-running exports.',
  fields: [{ name: 'format', type: 'string', what: 'csv or json.', required: true }],
  collectionMethods: ['POST'],
  itemMethods: ['GET'],
  asynchronousCreate: true,
};

const store = (): RestStore =>
  createStore([articles, exports_], {
    articles: [
      { id: '1', attributes: { title: 'First', body: 'Hello' } },
      { id: '2', attributes: { title: 'Second', body: 'World' } },
    ],
  });

const body = (response: { body?: string }): JsonObject => {
  const parsed = parseJson(response.body ?? '{}');
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value as JsonObject;
};

// ---------------------------------------------------------------------------
// Semantics
// ---------------------------------------------------------------------------

describe('method semantics', () => {
  it('marks exactly GET, HEAD, and OPTIONS as safe', () => {
    expect(
      VERB_SEMANTICS.filter((entry) => entry.safe).map((entry) => entry.method),
    ).toEqual(['GET', 'HEAD', 'OPTIONS']);
  });

  it('marks POST and PATCH as the only non-idempotent methods', () => {
    expect(
      VERB_SEMANTICS.filter((entry) => !entry.idempotent).map((entry) => entry.method),
    ).toEqual(['POST', 'PATCH']);
  });

  it('makes POST the only method that is neither safe nor idempotent', () => {
    const neither = VERB_SEMANTICS.filter((entry) => !entry.safe && !entry.idempotent);
    expect(neither.map((entry) => entry.method)).toEqual(['POST', 'PATCH']);
    // PATCH is unsafe and non-idempotent too, but only because a patch *format* may be
    // relative; POST is the one whose own definition promises neither.
    expect(verbSemantics('PATCH').detail).toMatch(/format/);
  });

  it('holds that every safe method is also idempotent', () => {
    // Safety implies idempotency: a method that changes nothing changes nothing twice.
    for (const entry of VERB_SEMANTICS) {
      if (entry.safe) expect(entry.idempotent).toBe(true);
    }
  });

  it('explains DELETE’s idempotency in terms of state, not status', () => {
    expect(isIdempotent('DELETE')).toBe(true);
    expect(verbSemantics('DELETE').detail).toMatch(/404/);
    expect(verbSemantics('DELETE').detail).toMatch(/state/);
  });

  it('keeps only cacheable-by-default methods marked as such', () => {
    const cacheable = VERB_SEMANTICS.filter((entry) => entry.cacheableByDefault);
    expect(cacheable.map((entry) => entry.method)).toEqual(['GET', 'HEAD']);
  });

  it('exposes safety as a function too', () => {
    expect(isSafe('GET')).toBe(true);
    expect(isSafe('POST')).toBe(false);
  });
});

describe('status choices', () => {
  it('contrasts each status with the one it is confused for', () => {
    for (const choice of STATUS_CHOICES) {
      expect(choice.when.length).toBeGreaterThan(20);
      expect(choice.reference.rfc).toBeGreaterThan(0);
    }
  });

  it('records that 401 means unauthenticated and 403 means refused', () => {
    expect(statusChoice(401)?.contrast).toMatch(/unauthenticated/);
    expect(statusChoice(403)?.contrast).toMatch(/know who you are/);
  });

  it('records the 400 versus 422 distinction', () => {
    expect(statusChoice(422)?.contrast).toMatch(/could not read it/);
  });
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

describe('routing', () => {
  it('resolves a collection and an item', () => {
    expect(resolveTarget(store(), '/articles').kind).toBe('collection');
    expect(resolveTarget(store(), '/articles/1')).toMatchObject({
      kind: 'item',
      id: '1',
    });
  });

  it('ignores the query string when routing', () => {
    expect(resolveTarget(store(), '/articles?limit=3').kind).toBe('collection');
  });

  it('does not treat a deeper path as an item of this collection', () => {
    expect(resolveTarget(store(), '/articles/1/comments').kind).toBe('unknown');
  });

  it('implies HEAD wherever GET is supported, and OPTIONS everywhere', () => {
    const allow = allowedMethods(resolveTarget(store(), '/articles'));
    expect(allow).toEqual(['GET', 'HEAD', 'POST', 'OPTIONS']);
  });
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

describe('GET', () => {
  it('returns a collection as 200 with a list', () => {
    const outcome = handleRest(store(), request({ method: 'GET', target: '/articles' }));
    expect(outcome.response.status).toBe(200);
    expect(body(outcome.response).total).toBe(2);
  });

  it('returns 200 with an empty list rather than 404 for an empty collection', () => {
    const empty = createStore([articles], { articles: [] });
    const outcome = handleRest(empty, request({ method: 'GET', target: '/articles' }));
    expect(outcome.response.status).toBe(200);
    expect(body(outcome.response).data).toEqual([]);
    expect(outcome.decision.why).toMatch(/never 404/);
  });

  it('returns one item as 200', () => {
    const outcome = handleRest(
      store(),
      request({ method: 'GET', target: '/articles/1' }),
    );
    expect(body(outcome.response)).toEqual({ id: '1', title: 'First', body: 'Hello' });
  });

  it('returns 404 for a member that does not exist', () => {
    expect(
      handleRest(store(), request({ method: 'GET', target: '/articles/99' })).response
        .status,
    ).toBe(404);
  });

  it('changes nothing, because it is safe', () => {
    const before = store();
    const outcome = handleRest(before, request({ method: 'GET', target: '/articles' }));
    expect(outcome.store).toEqual(before);
    expect(outcome.decision.changed).toEqual([]);
  });
});

describe('HEAD', () => {
  const outcome = handleRest(store(), request({ method: 'HEAD', target: '/articles/1' }));

  it('sends no body', () => {
    expect(outcome.response.body).toBeUndefined();
  });

  it('keeps the Content-Length of the body it is not sending', () => {
    const length = Number(headerValue(outcome.response.headers, 'Content-Length'));
    expect(length).toBeGreaterThan(0);
    const withBody = handleRest(
      store(),
      request({ method: 'GET', target: '/articles/1' }),
    );
    expect(headerValue(withBody.response.headers, 'Content-Length')).toBe(`${length}`);
  });
});

describe('OPTIONS', () => {
  it('answers 204 with Allow', () => {
    const outcome = handleRest(
      store(),
      request({ method: 'OPTIONS', target: '/articles/1' }),
    );
    expect(outcome.response.status).toBe(204);
    expect(headerValue(outcome.response.headers, 'Allow')).toBe(
      'GET, HEAD, PUT, PATCH, DELETE, OPTIONS',
    );
  });
});

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

describe('POST', () => {
  const create = jsonRequest({
    method: 'POST',
    target: '/articles',
    body: { title: 'Third', body: 'New' },
  });

  it('answers 201 with a Location', () => {
    const outcome = handleRest(store(), create);
    expect(outcome.response.status).toBe(201);
    expect(headerValue(outcome.response.headers, 'Location')).toBe('/articles/3');
  });

  it('returns the created representation', () => {
    expect(body(handleRest(store(), create).response)).toEqual({
      id: '3',
      title: 'Third',
      body: 'New',
    });
  });

  it('is not idempotent: sending it three times creates three resources', () => {
    const repeated = repeatRequest(store(), create, 3);
    expect(repeated.finalIds).toEqual(['1', '2', '3', '4', '5']);
    expect(repeated.idempotent).toBe(false);
    const created = repeated.outcomes.map((outcome) =>
      headerValue(outcome.response.headers, 'Location'),
    );
    expect(new Set(created).size).toBe(3);
  });

  it('answers 202 when the work is queued rather than done', () => {
    const outcome = handleRest(
      store(),
      jsonRequest({ method: 'POST', target: '/exports', body: { format: 'csv' } }),
    );
    expect(outcome.response.status).toBe(202);
    expect(outcome.decision.why).toMatch(/not done/);
    // Location on a 202 points at progress, not at the finished resource.
    expect(headerValue(outcome.response.headers, 'Location')).toContain('/jobs/');
  });

  it('answers 422 when a required field is missing', () => {
    const outcome = handleRest(
      store(),
      jsonRequest({ method: 'POST', target: '/articles', body: { title: 'No body' } }),
    );
    expect(outcome.response.status).toBe(422);
    expect(body(outcome.response).detail).toMatch(/"body" is required/);
  });

  it('answers 422 when a client tries to set a server-owned field', () => {
    const outcome = handleRest(
      store(),
      jsonRequest({
        method: 'POST',
        target: '/articles',
        body: { title: 'T', body: 'B', views: 9999 },
      }),
    );
    expect(outcome.response.status).toBe(422);
  });

  it('answers 400 for a body that is not JSON', () => {
    const outcome = handleRest(store(), {
      method: 'POST',
      target: '/articles',
      headers: [{ name: 'Content-Type', value: 'application/json' }],
      body: '{not json',
    });
    expect(outcome.response.status).toBe(400);
  });

  it('answers 415 for a format this resource does not accept', () => {
    const outcome = handleRest(store(), {
      method: 'POST',
      target: '/articles',
      headers: [{ name: 'Content-Type', value: 'application/x-www-form-urlencoded' }],
      body: 'title=T&body=B',
    });
    expect(outcome.response.status).toBe(415);
    expect(outcome.decision.why).toMatch(/415, not 400/);
  });

  it('answers 405 with Allow when posted to a member', () => {
    const outcome = handleRest(
      store(),
      jsonRequest({
        method: 'POST',
        target: '/articles/1',
        body: { title: 'x', body: 'y' },
      }),
    );
    expect(outcome.response.status).toBe(405);
    expect(headerValue(outcome.response.headers, 'Allow')).toContain('PUT');
  });

  it('emits a problem document rather than an invented error shape', () => {
    const outcome = handleRest(
      store(),
      jsonRequest({ method: 'POST', target: '/articles', body: {} }),
    );
    expect(headerValue(outcome.response.headers, 'Content-Type')).toBe(
      'application/problem+json',
    );
    expect(body(outcome.response)).toMatchObject({
      status: 422,
      title: 'Unprocessable Content',
    });
  });
});

describe('PUT', () => {
  const replace = jsonRequest({
    method: 'PUT',
    target: '/articles/1',
    body: { title: 'Replaced', body: 'Entirely' },
  });

  it('answers 204 when replacing an existing resource', () => {
    const outcome = handleRest(store(), replace);
    expect(outcome.response.status).toBe(204);
    expect(outcome.response.body).toBeUndefined();
  });

  it('can be asked to return the representation instead', () => {
    const outcome = handleRest(store(), replace, { putReturnsRepresentation: true });
    expect(outcome.response.status).toBe(200);
    expect(body(outcome.response).title).toBe('Replaced');
  });

  it('replaces rather than merges: an omitted field is gone', () => {
    const outcome = handleRest(
      store(),
      jsonRequest({
        method: 'PUT',
        target: '/articles/1',
        body: { title: 'T', body: 'B' },
      }),
    );
    const stored = findRecord(outcome.store, 'articles', '1');
    expect(stored?.attributes).toEqual({ title: 'T', body: 'B' });
  });

  it('answers 201 when it creates at a client-chosen id', () => {
    const outcome = handleRest(
      store(),
      jsonRequest({
        method: 'PUT',
        target: '/articles/99',
        body: { title: 'New', body: 'B' },
      }),
    );
    expect(outcome.response.status).toBe(201);
    expect(headerValue(outcome.response.headers, 'Location')).toBe('/articles/99');
  });

  it('is idempotent: sending it three times leaves one resource', () => {
    const repeated = repeatRequest(
      store(),
      jsonRequest({
        method: 'PUT',
        target: '/articles/99',
        body: { title: 'New', body: 'B' },
      }),
      3,
    );
    expect(repeated.finalIds).toEqual(['1', '2', '99']);
    expect(repeated.idempotent).toBe(true);
  });

  it('leaves the identical store after one call and after five', () => {
    const once = repeatRequest(store(), replace, 1).store;
    const fiveTimes = repeatRequest(store(), replace, 5).store;
    expect(fiveTimes).toEqual(once);
  });
});

describe('PATCH', () => {
  it('applies a merge patch and returns the result', () => {
    const outcome = handleRest(
      store(),
      jsonRequest({
        method: 'PATCH',
        target: '/articles/1',
        body: { title: 'Retitled' },
        contentType: 'application/merge-patch+json',
      }),
    );
    expect(outcome.response.status).toBe(200);
    expect(body(outcome.response)).toEqual({ id: '1', title: 'Retitled', body: 'Hello' });
  });

  it('cannot create, unlike PUT', () => {
    const outcome = handleRest(
      store(),
      jsonRequest({ method: 'PATCH', target: '/articles/99', body: { title: 'x' } }),
    );
    expect(outcome.response.status).toBe(404);
    expect(outcome.decision.why).toMatch(/Unlike PUT/);
  });

  it('answers 415 for a patch format the resource does not accept', () => {
    const outcome = handleRest(store(), {
      method: 'PATCH',
      target: '/articles/1',
      headers: [{ name: 'Content-Type', value: 'application/json-patch+json' }],
      body: '[]',
    });
    expect(outcome.response.status).toBe(415);
  });
});

describe('applyMergePatch', () => {
  it('adds and overwrites fields', () => {
    expect(applyMergePatch({ a: 1 }, { a: 2, b: 3 })).toEqual({ a: 2, b: 3 });
  });

  it('reads null as delete -- so it cannot set a field to null', () => {
    expect(applyMergePatch({ a: 1, b: 2 }, { b: null })).toEqual({ a: 1 });
  });

  it('merges nested objects rather than replacing them', () => {
    expect(applyMergePatch({ meta: { x: 1, y: 2 } }, { meta: { y: 3 } })).toEqual({
      meta: { x: 1, y: 3 },
    });
  });

  it('replaces arrays wholesale, because a merge patch cannot address an element', () => {
    expect(applyMergePatch({ tags: ['a', 'b'] }, { tags: ['c'] })).toEqual({
      tags: ['c'],
    });
  });

  it('is itself idempotent, even though the PATCH method is not', () => {
    const once = applyMergePatch({ a: 1, b: 2 }, { a: 9, b: null });
    expect(applyMergePatch(once, { a: 9, b: null })).toEqual(once);
  });
});

describe('DELETE', () => {
  it('answers 204 with no body', () => {
    const outcome = handleRest(
      store(),
      request({ method: 'DELETE', target: '/articles/1' }),
    );
    expect(outcome.response.status).toBe(204);
    expect(outcome.response.body).toBeUndefined();
    expect(listRecords(outcome.store, 'articles').map((r) => r.id)).toEqual(['2']);
  });

  it('answers 404 the second time and leaves the same state -- which is what idempotent means', () => {
    const twice = deleteTwice(store(), '/articles/1');
    expect(twice.first.response.status).toBe(204);
    expect(twice.second.response.status).toBe(404);
    expect(twice.sameStateAfterBoth).toBe(true);
    expect(twice.second.decision.notes.join(' ')).toMatch(/state left behind/);
  });
});

describe('representation', () => {
  it('puts the id first, which is where a reader looks for it', () => {
    expect(Object.keys(representation({ id: '7', attributes: { z: 1, a: 2 } }))).toEqual([
      'id',
      'z',
      'a',
    ]);
  });
});

describe('purity', () => {
  it('never mutates the store it was given', () => {
    const before = store();
    const snapshot = JSON.stringify(before);
    handleRest(
      before,
      jsonRequest({
        method: 'POST',
        target: '/articles',
        body: { title: 'T', body: 'B' },
      }),
    );
    handleRest(before, request({ method: 'DELETE', target: '/articles/1' }));
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('replays identically', () => {
    const create = jsonRequest({
      method: 'POST',
      target: '/articles',
      body: { title: 'T', body: 'B' },
    });
    expect(handleRest(store(), create)).toEqual(handleRest(store(), create));
  });
});
