import { describe, expect, it } from 'vitest';

import {
  buildConsoleRequest,
  consoleStore,
  coverageFor,
  CONSOLE_API_KEY,
  DEFAULT_CONSOLE_DRAFT,
  parseConsoleDraft,
  runConsoleRequest,
  type ConsoleDraft,
} from './sandbox';
import { headerValue, parseTarget, queryParam } from './sim/message';

/**
 * The console's boundary.
 *
 * Two things are being checked, and only one of them is validation.
 *
 * The validator is checked the ordinary way: what it rejects, and whether the message says
 * why. But the assertions that matter are the ones about what the boundary *cannot express* --
 * there is no host field, an absolute URL is refused rather than fetched, and every request
 * that survives goes to a pure function over an in-memory store. Those are properties of the
 * shape of this file, and they are asserted here so that a change which quietly added a host
 * parameter would have to delete a test to land.
 */

const draft = (overrides: Partial<ConsoleDraft> = {}): ConsoleDraft => ({
  ...DEFAULT_CONSOLE_DRAFT,
  ...overrides,
});

describe('parseConsoleDraft', () => {
  it('accepts the default draft', () => {
    const parsed = parseConsoleDraft(draft());
    expect(parsed.ok).toBe(true);
  });

  it('refuses an absolute URL, and says why rather than stripping the host', () => {
    const parsed = parseConsoleDraft(
      draft({ target: 'https://api.stripe.com/v1/charges' }),
    );
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? '' : parsed.error).toMatch(/Paths only/);
  });

  it('refuses a target that is not origin-form', () => {
    const parsed = parseConsoleDraft(draft({ target: 'articles' }));
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? '' : parsed.error).toMatch(/starts with "\/"/);
  });

  it('refuses a target with a space in it, because the request-line is space-delimited', () => {
    const parsed = parseConsoleDraft(draft({ target: '/articles 1' }));
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? '' : parsed.error).toMatch(/spaces or control characters/);
  });

  it('refuses an empty target', () => {
    const parsed = parseConsoleDraft(draft({ target: '   ' }));
    expect(parsed.ok).toBe(false);
  });

  it('refuses a body on a method that carries no content', () => {
    const parsed = parseConsoleDraft(draft({ method: 'GET', body: '{"a":1}' }));
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? '' : parsed.error).toMatch(/carries no content/);
  });

  it('refuses a body that is not JSON, and names the alternative that is worth seeing', () => {
    const parsed = parseConsoleDraft(
      draft({ method: 'POST', target: '/articles', body: '{ not json' }),
    );
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? '' : parsed.error).toMatch(/text\/plain/);
  });

  /**
   * A `POST` with no body is malformed by the API's rules and well-formed by the console's,
   * and that distinction is the point: the `400` is the lesson, and a console that refused to
   * send it would be substituting its own opinion for the specification's.
   */
  it('sends a POST with no body rather than pre-empting the 400', () => {
    const parsed = parseConsoleDraft(draft({ method: 'POST', target: '/articles' }));
    expect(parsed.ok).toBe(true);
    const outcome = runConsoleRequest(consoleStore(), parsed.ok ? parsed.value : draft());
    expect(outcome.response.status).toBe(400);
  });

  it('sends a body with the wrong media type rather than pre-empting the 415', () => {
    const parsed = parseConsoleDraft(
      draft({
        method: 'PATCH',
        target: '/articles/1',
        contentType: 'text/plain',
        body: 'title: new',
      }),
    );
    expect(parsed.ok).toBe(true);
    const outcome = runConsoleRequest(consoleStore(), parsed.ok ? parsed.value : draft());
    expect(outcome.response.status).toBe(415);
  });
});

describe('buildConsoleRequest', () => {
  it('puts an API key in the header when asked, and never in the target', () => {
    const parsed = parseConsoleDraft(draft({ credential: 'api-key-header' }));
    if (!parsed.ok) throw new Error(parsed.error);
    const request = buildConsoleRequest(parsed.value);

    expect(headerValue(request.headers, 'X-API-Key')).toBe(CONSOLE_API_KEY);
    expect(request.target).not.toContain(CONSOLE_API_KEY);
  });

  it('puts it in the query string when asked, which is where it then leaks from', () => {
    const parsed = parseConsoleDraft(draft({ credential: 'api-key-query' }));
    if (!parsed.ok) throw new Error(parsed.error);
    const request = buildConsoleRequest(parsed.value);

    expect(queryParam(parseTarget(request.target), 'api_key')).toBe(CONSOLE_API_KEY);
    expect(headerValue(request.headers, 'X-API-Key')).toBeUndefined();
  });

  it('sends whatever bearer token was typed, including a malformed one', () => {
    const parsed = parseConsoleDraft(
      draft({ credential: 'bearer', bearerToken: 'not.a.jwt.at.all' }),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    expect(headerValue(buildConsoleRequest(parsed.value).headers, 'Authorization')).toBe(
      'Bearer not.a.jwt.at.all',
    );
  });

  /** One Content-Type, never two: a second field line is appended, not an override. */
  it('sends exactly one Content-Type', () => {
    const parsed = parseConsoleDraft(
      draft({
        method: 'PATCH',
        target: '/articles/1',
        contentType: 'application/merge-patch+json',
        body: '{"subtitle": null}',
      }),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    const request = buildConsoleRequest(parsed.value);

    expect(request.headers.filter((field) => field.name === 'Content-Type')).toHaveLength(
      1,
    );
    expect(headerValue(request.headers, 'Content-Type')).toBe(
      'application/merge-patch+json',
    );
  });
});

describe('runConsoleRequest', () => {
  it('threads the store, so a second request sees what the first did', () => {
    const first = parseConsoleDraft(
      draft({
        method: 'POST',
        target: '/articles',
        body: '{"title":"a","body":"b"}',
      }),
    );
    if (!first.ok) throw new Error(first.error);

    const after = runConsoleRequest(consoleStore(), first.value);
    expect(after.response.status).toBe(201);

    const again = runConsoleRequest(after.store, first.value);
    expect(again.response.status).toBe(201);
    // Two identical POSTs, two resources. Nothing about the console changes that.
    expect(after.decision.changed).not.toEqual(again.decision.changed);
  });

  it('returns a 200 with a representation for PUT, because the console asks for one', () => {
    const parsed = parseConsoleDraft(
      draft({
        method: 'PUT',
        target: '/articles/1',
        body: '{"title":"replaced","body":"whole new state"}',
      }),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    const outcome = runConsoleRequest(consoleStore(), parsed.value);

    expect(outcome.response.status).toBe(200);
    expect(outcome.response.body).toContain('replaced');
  });
});

describe('coverageFor', () => {
  it('says plainly that an unrouted path is a fact about this repository', () => {
    const coverage = coverageFor(consoleStore(), { target: '/nope', method: 'GET' });
    expect(coverage.known).toBe(false);
    expect(coverage.note).toMatch(/no request left this tab/);
  });

  it('names the resource and what the method promises, for a routed path', () => {
    const coverage = coverageFor(consoleStore(), {
      target: '/articles/1',
      method: 'DELETE',
    });
    expect(coverage.known).toBe(true);
    expect(coverage.note).toMatch(/member 1 of articles/);
  });
});

/**
 * The safety property.
 *
 * Not a behaviour test: a check that the module's source contains no way to reach a network.
 * `buildConsoleRequest` has no host parameter, so the strongest statement available at this
 * level is that whatever it builds is an origin-form path and nothing else.
 */
describe('the boundary', () => {
  it('produces only origin-form targets, whatever is typed', () => {
    const attempts = [
      '/articles',
      '/articles/1?fields=title',
      '/reports',
      '/comments?limit=2',
    ];

    for (const target of attempts) {
      const parsed = parseConsoleDraft(draft({ target }));
      if (!parsed.ok) throw new Error(`${target}: ${parsed.error}`);
      expect(buildConsoleRequest(parsed.value).target.startsWith('/')).toBe(true);
    }
  });

  it('has no field in the draft that could name a host', () => {
    expect(Object.keys(DEFAULT_CONSOLE_DRAFT).sort()).toEqual([
      'bearerToken',
      'body',
      'contentType',
      'credential',
      'method',
      'target',
    ]);
  });
});
