import { describe, expect, it } from 'vitest';

import { RESOURCES } from './scenarios/common';
import { describeObject, explainField, FIELD_EXPLANATIONS, originOf } from './shape';

/**
 * The field catalogue.
 *
 * Most of what is asserted here is that the *ambiguities* resolve correctly, because those
 * are the only entries that can be wrong in an interesting way: `status` means one thing in a
 * problem document and another in a report; `type` is a URI in one and an event name in
 * another; `id` belongs to the resource when there is one and to the webhook envelope when
 * there is not.
 */

describe('the catalogue', () => {
  it('gives every entry a sentence, and a reference where one exists', () => {
    for (const entry of FIELD_EXPLANATIONS) {
      expect(entry.what.length).toBeGreaterThan(20);
      if (entry.reference) expect(entry.reference.rfc).toBeGreaterThan(0);
    }
  });

  it('distinguishes two keys with the same name by their origin', () => {
    expect(explainField('type', 'problem')?.what).toMatch(/URI identifying the problem/);
    expect(explainField('id', 'webhook')?.what).toMatch(/event id/);
  });

  it('returns nothing for a key it does not know', () => {
    expect(explainField('featureFlags')).toBeUndefined();
  });
});

describe('originOf', () => {
  it('reads a problem document from its shape rather than from a status code', () => {
    expect(
      originOf({ type: 'about:blank', title: 'Not Found', status: 404, detail: '…' }),
    ).toBe('problem');
  });

  it('reads a token response', () => {
    expect(originOf({ access_token: 'x', token_type: 'Bearer', expires_in: 900 })).toBe(
      'oauth',
    );
  });

  it('reads a GraphQL response by its errors array', () => {
    expect(originOf({ data: null, errors: [] })).toBe('graphql');
  });

  it('reads a paginated collection', () => {
    expect(originOf({ data: [], total: 12, offset: 0, limit: 5 })).toBe('pagination');
    expect(originOf({ data: [], next_cursor: null, limit: 5 })).toBe('pagination');
  });

  it('falls back to the envelope convention, which is what most bodies are', () => {
    expect(originOf({ data: [] })).toBe('envelope');
    expect(originOf([1, 2, 3])).toBe('envelope');
    expect(originOf('a string')).toBe('envelope');
  });
});

describe('describeObject', () => {
  const articles = RESOURCES.find((resource) => resource.name === 'articles');

  it('prefers the resource’s own definition over the catalogue', () => {
    if (!articles) throw new Error('the articles resource is missing');
    const fields = describeObject(
      { id: '1', title: 'A', views: 4 },
      { resource: articles },
    );

    const id = fields.find((field) => field.name === 'id');
    expect(id?.explanation?.origin).toBe('resource');
    // Not the webhook `id`, which is about deduplication and would be wrong here.
    expect(id?.explanation?.what).toMatch(/server picks it/i);
  });

  it('marks a server-owned field with what sending it earns', () => {
    if (!articles) throw new Error('the articles resource is missing');
    const fields = describeObject({ views: 4 }, { resource: articles });
    expect(fields[0]?.explanation?.detail).toMatch(/422/);
  });

  it('leaves unknown keys unexplained rather than guessing', () => {
    const fields = describeObject({ somethingNobodyDocumented: true });
    expect(fields[0]?.explanation).toBeUndefined();
  });

  it('keeps the document’s own key order', () => {
    const fields = describeObject({ b: 1, a: 2, c: 3 });
    expect(fields.map((field) => field.name)).toEqual(['b', 'a', 'c']);
  });
});
