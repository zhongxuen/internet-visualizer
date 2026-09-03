/**
 * The builder's job is to be the place a bad input stops.
 *
 * So the tests that matter here are the rejections and the one property the whole module
 * rests on: whatever survives validation addresses a bundled fixture and nothing else.
 */

import { describe, expect, it } from 'vitest';

import {
  BUILDER_SCENARIO_ID,
  builderScenario,
  coverageFor,
  DEFAULT_REQUEST_DRAFT,
  parseHeaderBlock,
  parseRequestDraft,
  sandboxRouteFor,
  SANDBOX_HOST,
  SANDBOX_ROUTES,
  type RequestDraft,
} from './builder';
import { runHttpScenario } from './sim/exchange';

const draft = (patch: Partial<RequestDraft> = {}): RequestDraft => ({
  ...DEFAULT_REQUEST_DRAFT,
  ...patch,
});

/** Validate, or fail the test with the reason rather than with a type error. */
function build(patch: Partial<RequestDraft> = {}) {
  const parsed = parseRequestDraft(draft(patch));
  if (!parsed.ok) throw new Error(`draft did not validate: ${parsed.error}`);
  return builderScenario(parsed.value);
}

/** Build, run, and hand back the run -- the whole path a Send button takes. */
function send(patch: Partial<RequestDraft> = {}) {
  return runHttpScenario(build(patch));
}

describe('the safety boundary', () => {
  it('addresses only the bundled sandbox origin', () => {
    const scenario = build();

    expect(scenario.origins).toHaveLength(1);
    expect(scenario.origins[0].host).toBe(SANDBOX_HOST);
    expect(scenario.id).toBe(BUILDER_SCENARIO_ID);
  });

  it('puts every simulated machine in the RFC 5737 documentation range', () => {
    const run = send();
    for (const node of run.topology.nodes) {
      if (node.ipv4 === undefined) continue;
      expect(node.ipv4.startsWith('203.0.113.')).toBe(true);
    }
  });

  it('refuses an absolute URL rather than reaching for the host in it', () => {
    const result = parseRequestDraft(draft({ target: 'https://example.com/index.html' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Paths only');
  });

  it('refuses a target that is not origin-form', () => {
    expect(parseRequestDraft(draft({ target: 'index.html' })).ok).toBe(false);
    expect(parseRequestDraft(draft({ target: '' })).ok).toBe(false);
  });

  it('accepts ordinary path punctuation', () => {
    for (const target of ['/api/items', '/a-b/c.d', '/x?q=1&r=2', '/a_b/c~d']) {
      expect(parseRequestDraft(draft({ target })).ok).toBe(true);
    }
  });

  it('refuses a target containing a space, which would split the request-line', () => {
    const result = parseRequestDraft(draft({ target: '/index.html HTTP/1.1' }));
    expect(result.ok).toBe(false);
  });
});

describe('parseHeaderBlock', () => {
  it('keeps order and duplicates, because the wire does', () => {
    const result = parseHeaderBlock('Accept: text/html\nAccept: text/plain\nX-A: 1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((field) => `${field.name}: ${field.value}`)).toEqual([
      'Accept: text/html',
      'Accept: text/plain',
      'X-A: 1',
    ]);
  });

  it('drops blank lines and comments so the box can be annotated', () => {
    const result = parseHeaderBlock('# a note\n\nX-A: 1\n');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it('rejects a line with no colon', () => {
    expect(parseHeaderBlock('Accept text/html').ok).toBe(false);
  });

  it('rejects whitespace before the colon -- one hop of a smuggling chain', () => {
    expect(parseHeaderBlock('Accept : text/html').ok).toBe(false);
  });

  it('treats a newline in the textarea as the next field, not as an injection', () => {
    const result = parseHeaderBlock('X-A: 1\nX-B: 2');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(2);
  });

  it('rejects a bare CR inside a value: that is header injection', () => {
    const result = parseHeaderBlock(`X-A: 1${String.fromCharCode(13)}X-B: 2`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('injection');
  });
});

describe('method and content', () => {
  it('refuses a body on a method that must not carry one', () => {
    const result = parseRequestDraft(draft({ method: 'TRACE', body: 'x' }));
    expect(result.ok).toBe(false);
  });

  it('allows a body on POST', () => {
    expect(
      parseRequestDraft(draft({ method: 'POST', target: '/upload', body: 'x' })).ok,
    ).toBe(true);
  });
});

describe('coverage', () => {
  it('says plainly that an unknown path is a fact about the fixtures', () => {
    const coverage = coverageFor({ target: '/nowhere', method: 'GET' });
    expect(coverage.known).toBe(false);
    expect(coverage.note).toContain('404');
    expect(coverage.note).toContain('no request left this tab');
  });

  it('names what would have worked when the method is wrong', () => {
    const coverage = coverageFor({ target: '/login', method: 'GET' });
    expect(coverage.known).toBe(true);
    expect(coverage.note).toContain('405');
    expect(coverage.note).toContain('POST');
  });

  it('resolves a target with a query to the route without it', () => {
    expect(sandboxRouteFor('/index.html?a=1')?.path).toBe('/index.html');
  });
});

describe('the sandbox answers', () => {
  it('serves the page it declares', () => {
    const run = send();
    expect(run.exchanges).toHaveLength(1);
    expect(run.exchanges[0].response.status).toBe(200);
  });

  it('404s a path it has no route for', () => {
    expect(send({ target: '/nowhere' }).exchanges[0].response.status).toBe(404);
  });

  it('405s a method a route does not allow, and says what it does allow', () => {
    const exchange = send({ target: '/login', method: 'GET' }).exchanges[0];
    expect(exchange.response.status).toBe(405);
    expect(
      exchange.response.headers.some((field) => field.name.toLowerCase() === 'allow'),
    ).toBe(true);
  });

  it('serves the repeat from the browser cache while it is still fresh', () => {
    const run = send({ repeat: true });
    expect(run.exchanges).toHaveLength(2);
    expect(run.exchanges[0].browserCache).toBe('MISS');
    expect(run.exchanges[1].browserCache).toBe('HIT');
  });

  it('stores a no-cache response, then revalidates rather than reusing it', () => {
    const run = send({ target: '/config.json', repeat: true });
    expect(run.exchanges[1].browserCache).toBe('REVALIDATED');
    // Stored is the point: no-cache constrains reuse, not storage. If this were
    // no-store there would be no entry here to revalidate.
    expect(run.browserCache.entries).toHaveLength(1);
    expect(run.browserCache.entries[0].revalidations).toBe(1);
  });

  it('never stores a no-store response, so the repeat costs the body again', () => {
    const run = send({ target: '/statement.html', repeat: true });
    expect(run.exchanges[1].browserCache).toBe('MISS');
    expect(run.browserCache.entries).toHaveLength(0);
  });

  it('is deterministic: the same draft twice is the same run', () => {
    expect(JSON.stringify(send({ repeat: true }))).toBe(
      JSON.stringify(send({ repeat: true })),
    );
  });
});

describe('the route table', () => {
  it('gives every route a note, since the panel prints one per path', () => {
    for (const route of SANDBOX_ROUTES) {
      expect(route.note.length).toBeGreaterThan(20);
    }
  });

  it('has no duplicate paths, which would make the second unreachable', () => {
    const paths = SANDBOX_ROUTES.map((route) => route.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
