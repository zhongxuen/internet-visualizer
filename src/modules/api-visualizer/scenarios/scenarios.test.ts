import { describe, expect, it } from 'vitest';

import { runApiScenario, type ApiScenario } from '../sim/exchange';
import { consume } from '../sim/ratelimit';

import {
  API_SCENARIOS,
  AUTH_BEARER,
  DEFAULT_API_SCENARIO_ID,
  getApiScenario,
  OAUTH_AUTHCODE_PKCE,
  PAGINATED_COLLECTION,
  RATE_LIMITED,
  REST_CRUD,
  REST_VS_GRAPHQL_SCENARIO,
  WEBHOOK_DELIVERY,
} from './index';

/**
 * The catalogue test.
 *
 * Two kinds of assertion live here and they earn their place differently. The sweep below
 * runs every scenario and checks the properties that must hold for all seven -- determinism,
 * sorted events, a topology whose links name real nodes, and no code path that could reach a
 * network. Then each scenario gets a handful of assertions about the specific thing it exists
 * to demonstrate, because a scenario whose lesson stopped being visible would otherwise still
 * pass every structural check.
 */

function ids(scenarios: readonly ApiScenario[]): string[] {
  return scenarios.map((scenario) => scenario.id);
}

describe('the catalogue', () => {
  it('offers seven scenarios with unique ids, and opens on one of them', () => {
    expect(API_SCENARIOS).toHaveLength(7);
    expect(new Set(ids(API_SCENARIOS)).size).toBe(7);
    expect(getApiScenario(DEFAULT_API_SCENARIO_ID)).toBeDefined();
  });

  it('does not resolve an id it does not have', () => {
    expect(getApiScenario('graphql-subscriptions')).toBeUndefined();
  });
});

describe.each(API_SCENARIOS.map((scenario) => [scenario.id, scenario] as const))(
  '%s',
  (_id, scenario) => {
    const run = runApiScenario(scenario);

    it('replays identically, because nothing in it reads a clock', () => {
      expect(runApiScenario(scenario)).toEqual(run);
    });

    it('emits events in non-decreasing time order', () => {
      const times = run.result.events.map((event) => event.at);
      expect([...times].sort((a, b) => a - b)).toEqual(times);
    });

    it('ends after the last thing that happens', () => {
      for (const event of run.result.events) {
        expect(event.at).toBeLessThanOrEqual(run.result.durationMs);
      }
    });

    it('has at least one phase, and every phase carries a description', () => {
      expect(run.result.phases.length).toBeGreaterThan(0);
      for (const phase of run.result.phases) {
        expect(phase.description.length).toBeGreaterThan(20);
      }
    });

    it('draws a topology whose links name nodes that exist', () => {
      const nodes = new Set(run.topology.nodes.map((each) => each.id));
      for (const wire of run.topology.links) {
        expect(nodes.has(wire.from)).toBe(true);
        expect(nodes.has(wire.to)).toBe(true);
      }
    });

    it('only transmits between machines that are on the diagram', () => {
      const nodes = new Set(run.topology.nodes.map((each) => each.id));
      for (const event of run.result.events) {
        if (event.kind !== 'transmit') continue;
        expect(nodes.has(event.from)).toBe(true);
        expect(nodes.has(event.to)).toBe(true);
        expect(run.result.pdus[event.pduId]).toBeDefined();
      }
    });

    it('says what a learner should take away', () => {
      expect(scenario.teaches.length).toBeGreaterThanOrEqual(4);
      expect(scenario.summary.length).toBeGreaterThan(60);
    });

    /**
     * The safety property, asserted rather than trusted.
     *
     * Every host in this module is under `.example` (RFC 2606) and every address is from
     * `203.0.113.0/24` (RFC 5737), both reserved precisely so an example can never be
     * mistaken for -- or routed to -- a real host. There is no `fetch` in the module and no
     * host parameter to be given one; this checks the addresses anyway, because the cheapest
     * time to catch a scenario that names a real domain is before it is written twice.
     */
    it('addresses nothing that could exist', () => {
      for (const machine of run.topology.nodes) {
        if (machine.ipv4) expect(machine.ipv4.startsWith('203.0.113.')).toBe(true);
      }
      for (const exchange of run.exchanges) {
        const target = exchange.request.target;
        if (/^https?:\/\//i.test(target)) {
          expect(target).toMatch(/^https:\/\/[a-z0-9.-]*\.example(\/|$|\?)/i);
        }
      }
    });
  },
);

// ---------------------------------------------------------------------------
// What each one is for
// ---------------------------------------------------------------------------

describe('rest-crud', () => {
  const run = runApiScenario(REST_CRUD);
  const detail = run.detail;

  it('shows POST making two resources and PUT making one', () => {
    const creates = run.exchanges.filter((each) => each.stepId === 'create');
    expect(creates).toHaveLength(2);
    expect(creates.every((each) => each.status === 201)).toBe(true);
    // Two 201s, two different Location values. That is the whole of "POST is not idempotent".
    const locations = creates.map(
      (each) => each.response.headers.find((field) => field.name === 'Location')?.value,
    );
    expect(new Set(locations).size).toBe(2);

    const replaces = run.exchanges.filter((each) => each.stepId === 'replace');
    expect(replaces).toHaveLength(2);
    expect(replaces.map((each) => each.status)).toEqual([204, 204]);
  });

  it('shows DELETE answering 204 and then 404 with the same state either way', () => {
    const deletes = run.exchanges.filter((each) => each.stepId === 'delete');
    expect(deletes.map((each) => each.status)).toEqual([204, 404]);
    if (detail.kind !== 'rest') throw new Error('expected a rest detail');
    expect(detail.store.records['articles']?.some((record) => record.id === '3')).toBe(
      false,
    );
  });

  it('refuses a body that sets a field the server owns, with 422 and not 400', () => {
    const refused = run.exchanges.find((each) => each.stepId === 'server-owned');
    expect(refused?.status).toBe(422);
    expect(
      refused?.response.headers.find((field) => field.name === 'Content-Type')?.value,
    ).toBe('application/problem+json');
  });

  it('answers 202 for the asynchronous create and 405 with Allow for the collection delete', () => {
    expect(run.exchanges.find((each) => each.stepId === 'report')?.status).toBe(202);
    const refused = run.exchanges.find((each) => each.stepId === 'refused');
    expect(refused?.status).toBe(405);
    expect(
      refused?.response.headers.find((field) => field.name === 'Allow')?.value,
    ).toContain('GET');
  });

  it('deletes a field with a null in the merge patch', () => {
    if (detail.kind !== 'rest') throw new Error('expected a rest detail');
    const article = detail.store.records['articles']?.find((record) => record.id === '1');
    expect(article?.attributes['subtitle']).toBeUndefined();
    expect(article?.attributes['title']).toBe('What a status code is for (revised)');
  });
});

describe('auth-bearer', () => {
  const run = runApiScenario(AUTH_BEARER);
  const byStep = new Map(run.exchanges.map((each) => [each.stepId, each]));

  it('separates "I do not know you" from "I know you and no"', () => {
    expect(byStep.get('anonymous')?.status).toBe(401);
    expect(byStep.get('key-scope')?.status).toBe(403);
  });

  it('owes a WWW-Authenticate field on every 401', () => {
    for (const exchange of run.exchanges) {
      if (exchange.status !== 401) continue;
      expect(
        exchange.response.headers.find((field) => field.name === 'WWW-Authenticate')
          ?.value,
      ).toMatch(/^Bearer /);
    }
  });

  it('never troubles the application with a refused request', () => {
    for (const exchange of run.exchanges) {
      if (exchange.status === 401 || exchange.status === 403) {
        expect(exchange.handledBy).toBe('gateway');
      }
    }
  });

  it('reads every claim of every token without a secret, valid or not', () => {
    const bearers = run.exchanges.filter(
      (each) => each.auth?.credential.kind === 'bearer',
    );
    expect(bearers.length).toBeGreaterThanOrEqual(5);
    for (const exchange of bearers) {
      // Including the expired one, the tampered one, and the one signed with nothing.
      expect(exchange.auth?.decoded?.claims).toBeDefined();
    }
  });

  it('carries a readable email in the payload, which is the point being made', () => {
    const valid = byStep.get('bearer-valid');
    expect(valid?.status).toBe(200);
    expect(valid?.auth?.decoded?.claims['email']).toBe('ada@example.com');
  });

  it('refuses the expired, misaddressed, tampered, and unsigned tokens for four different reasons', () => {
    const failing = (
      ['bearer-expired', 'bearer-audience', 'bearer-tampered', 'bearer-none'] as const
    ).map((step) => byStep.get(step));
    expect(failing.map((each) => each?.status)).toEqual([401, 401, 401, 401]);

    const firstFailedCheck = (stepId: string) =>
      byStep.get(stepId)?.auth?.verification?.checks.find((check) => !check.passed)?.name;
    expect(firstFailedCheck('bearer-expired')).toBe('exp');
    expect(firstFailedCheck('bearer-audience')).toBe('aud');
    expect(firstFailedCheck('bearer-tampered')).toBe('signature');
    expect(firstFailedCheck('bearer-none')).toBe('alg');
  });
});

describe('oauth-authcode-pkce', () => {
  const run = runApiScenario(OAUTH_AUTHCODE_PKCE);
  const detail = run.detail;

  it('commits the challenge before any code exists', () => {
    if (detail.kind !== 'oauth') throw new Error('expected an oauth detail');
    const challengeStep = detail.flow.steps.find((step) =>
      step.url?.includes('code_challenge='),
    );
    const codeStep = detail.flow.steps.find((step) => step.url?.includes('code='));
    expect(challengeStep).toBeDefined();
    expect(codeStep).toBeDefined();
    expect((challengeStep?.index ?? 0) < (codeStep?.index ?? 0)).toBe(true);
  });

  it('sends the verifier exactly once, and never through the browser', () => {
    if (detail.kind !== 'oauth') throw new Error('expected an oauth detail');
    const verifier = detail.flow.pkce.verifier;
    const carrying = detail.flow.steps.filter(
      (step) => step.request?.body?.includes(verifier) || step.url?.includes(verifier),
    );
    expect(carrying).toHaveLength(1);
    expect(carrying[0]?.from).toBe('client');
    expect(carrying[0]?.to).toBe('authorization-server');
  });

  it('refuses the stolen code, and refuses a guessed verifier too', () => {
    if (detail.kind !== 'oauth') throw new Error('expected an oauth detail');
    expect(detail.interception?.refused).toBe(true);
    expect(detail.interception?.response.status).toBe(400);
    expect(detail.guessedInterception?.refused).toBe(true);
  });

  it('draws all four parties of RFC 6749', () => {
    expect(run.topology.nodes.map((each) => each.id).sort()).toEqual([
      'api',
      'authorization-server',
      'client',
      'user',
    ]);
  });
});

describe('rate-limited', () => {
  const run = runApiScenario(RATE_LIMITED);
  const detail = run.detail;

  it('empties the bucket and then refuses', () => {
    if (detail.kind !== 'rate-limit') throw new Error('expected a rate-limit detail');
    expect(detail.run.attempts.filter((each) => !each.allowed).length).toBeGreaterThan(0);
    expect(detail.run.delivered).toBe(9);
  });

  it('carries Retry-After and the announcement fields on every 429', () => {
    const refusals = run.exchanges.filter((each) => each.status === 429);
    expect(refusals.length).toBeGreaterThan(0);
    for (const refusal of refusals) {
      const names = refusal.response.headers.map((field) => field.name);
      expect(names).toContain('Retry-After');
      expect(names).toContain('RateLimit-Remaining');
      expect(refusal.handledBy).toBe('gateway');
    }
  });

  it('announces the remaining quota on successes too, not only on refusals', () => {
    const allowed = run.exchanges.filter((each) => each.status === 200);
    expect(allowed.length).toBeGreaterThan(0);
    for (const success of allowed) {
      expect(success.response.headers.map((field) => field.name)).toContain(
        'RateLimit-Remaining',
      );
    }
  });

  it('charges nothing for a refusal', () => {
    const refusals = run.exchanges.filter((each) => each.limit && !each.limit.allowed);
    for (const refusal of refusals) {
      expect(refusal.limit?.remaining).toBe(0);
    }
  });

  /**
   * The bucket shown on the meter is re-derived in `exchange.ts` rather than threaded out of
   * `runRateLimitedClient`, whose job is the client's behaviour. The two walks consume in the
   * same order at the same instants, so they must agree -- and this is where that is checked
   * rather than assumed.
   */
  it('shows a meter that agrees with the run it was derived from', () => {
    if (detail.kind !== 'rate-limit') throw new Error('expected a rate-limit detail');
    let bucket = detail.initialBucket;
    for (const attempt of detail.run.attempts) {
      const result = consume(bucket, attempt.atMs);
      bucket = result.bucket;
      expect(result.allowed).toBe(attempt.allowed);
      expect(Math.max(0, Math.floor(result.bucket.tokens))).toBe(
        attempt.allowed ? attempt.remaining : 0,
      );
    }
  });

  it('is slower and more refused when the client ignores Retry-After', () => {
    if (detail.kind !== 'rate-limit') throw new Error('expected a rate-limit detail');
    const obedient = detail.run;
    const stubborn = detail.ignoringRetryAfter;
    expect(stubborn).toBeDefined();
    const refusals = (attempts: typeof obedient.attempts) =>
      attempts.filter((each) => !each.allowed).length;
    expect(refusals(stubborn?.attempts ?? [])).toBeGreaterThan(
      refusals(obedient.attempts),
    );
  });
});

describe('paginated-collection', () => {
  const run = runApiScenario(PAGINATED_COLLECTION);
  const detail = run.detail;

  it('hands the offset client a duplicate and loses a row it held throughout', () => {
    if (detail.kind !== 'pagination') throw new Error('expected a pagination detail');
    expect(detail.offset.correct).toBe(false);
    expect(detail.offset.duplicated.length + detail.offset.missed.length).toBeGreaterThan(
      0,
    );
  });

  it('gets the same rows and the same edits right with a cursor', () => {
    if (detail.kind !== 'pagination') throw new Error('expected a pagination detail');
    expect(detail.cursor.correct).toBe(true);
    expect(detail.cursor.duplicated).toEqual([]);
    expect(detail.cursor.missed).toEqual([]);
  });

  it('runs both strategies over the same collection and the same page size', () => {
    if (detail.kind !== 'pagination') throw new Error('expected a pagination detail');
    expect(detail.offset.strategy).toBe('offset');
    expect(detail.cursor.strategy).toBe('cursor');
    expect(detail.items).toHaveLength(12);
    expect(detail.pageSize).toBe(5);
  });

  it('sends a Link header so a client never has to construct a page URL', () => {
    for (const exchange of run.exchanges) {
      expect(exchange.response.headers.map((field) => field.name)).toContain('Link');
    }
  });

  it('marks the repeated ids on the page that repeats them', () => {
    const repeated = run.exchanges.filter(
      (each) => (each.page?.repeated.length ?? 0) > 0,
    );
    expect(repeated.length).toBeGreaterThan(0);
    expect(repeated.every((each) => each.page?.strategy === 'offset')).toBe(true);
  });
});

describe('rest-vs-graphql', () => {
  const run = runApiScenario(REST_VS_GRAPHQL_SCENARIO);
  const detail = run.detail;

  it('costs REST five requests and GraphQL one', () => {
    if (detail.kind !== 'graphql') throw new Error('expected a graphql detail');
    expect(detail.comparison.rest.roundTrips).toBe(5);
    expect(detail.comparison.graphql.roundTrips).toBe(1);
    // The three comment calls can go out together once the ids are known, so the sequential
    // count is two and not four. Overstating it would be flattering GraphQL.
    expect(detail.comparison.rest.sequentialRoundTrips).toBe(2);
  });

  it('measures the over-fetching rather than asserting it', () => {
    if (detail.kind !== 'graphql') throw new Error('expected a graphql detail');
    expect(detail.comparison.rest.wastedBytes).toBeGreaterThan(0);
    expect(detail.comparison.graphql.wastedBytes).toBe(0);
  });

  it('admits GraphQL sends the larger request', () => {
    if (detail.kind !== 'graphql') throw new Error('expected a graphql detail');
    expect(
      detail.comparison.notes.some((note) => note.includes('GraphQL request is larger')),
    ).toBe(true);
  });

  it('credits REST with the caching it gets for free', () => {
    if (detail.kind !== 'graphql') throw new Error('expected a graphql detail');
    expect(
      detail.comparison.notes.some((note) => note.includes('cacheable by URL')),
    ).toBe(true);
    const graphql = run.exchanges.find((each) => each.stepId === 'graphql-query');
    expect(
      graphql?.response.headers.find((field) => field.name === 'Cache-Control')?.value,
    ).toBe('no-store');
  });

  it('counts the N+1 and then counts it again with batching on', () => {
    if (detail.kind !== 'graphql') throw new Error('expected a graphql detail');
    // One user, one posts list, one comment count per post.
    expect(detail.unbatched.stats.dataSourceCalls).toBe(5);
    expect(detail.batched.stats.dataSourceCalls).toBe(3);
    expect(detail.unbatched.errors).toEqual([]);
  });

  it('returns the requested shape and nothing else', () => {
    if (detail.kind !== 'graphql') throw new Error('expected a graphql detail');
    const user = detail.unbatched.data?.['user'] as Record<string, unknown> | undefined;
    expect(Object.keys(user ?? {})).toEqual(['name', 'avatarUrl', 'posts']);
  });
});

describe('webhook-delivery', () => {
  const run = runApiScenario(WEBHOOK_DELIVERY);
  const detail = run.detail;

  it('reverses the direction: the API is the client here', () => {
    for (const exchange of run.exchanges) {
      expect(exchange.from).toBe('api');
      expect(exchange.handledBy).toBe('receiver');
      expect(exchange.request.method).toBe('POST');
    }
  });

  it('retries until the receiver accepts, and stops there', () => {
    if (detail.kind !== 'webhook') throw new Error('expected a webhook detail');
    expect(detail.delivery.attempts).toHaveLength(4);
    expect(detail.delivery.delivered).toBe(true);
    expect(detail.delivery.attempts.map((each) => each.outcome)).toEqual([
      'retry',
      'retry',
      'retry',
      'delivered',
    ]);
  });

  it('re-signs each attempt while keeping the event id fixed', () => {
    if (detail.kind !== 'webhook') throw new Error('expected a webhook detail');
    const signatures = detail.delivery.attempts.map(
      (each) =>
        each.request.headers.find((field) => field.name === 'X-Webhook-Signature')?.value,
    );
    expect(new Set(signatures).size).toBe(signatures.length);

    const eventIds = detail.delivery.attempts.map(
      (each) =>
        each.request.headers.find((field) => field.name === 'X-Webhook-Id')?.value,
    );
    expect(new Set(eventIds).size).toBe(1);
  });

  it('verifies every genuine delivery and refuses the forgery', () => {
    const genuine = run.exchanges.filter((each) => each.stepId.startsWith('attempt-'));
    expect(genuine.length).toBe(4);
    for (const exchange of genuine) {
      expect(exchange.signature?.valid).toBe(true);
    }

    if (detail.kind !== 'webhook') throw new Error('expected a webhook detail');
    expect(detail.forgery?.valid).toBe(false);
    const forged = run.exchanges.find((each) => each.stepId === 'forged-delivery');
    expect(forged?.status).toBe(401);
  });

  it('handles the same event once, however many times it arrives', () => {
    if (detail.kind !== 'webhook') throw new Error('expected a webhook detail');
    expect(detail.firstReceipt.processed).toBe(true);
    expect(detail.secondReceipt.processed).toBe(false);
    // The identical answer is the point: the sender cannot tell which delivery did the work.
    expect(detail.secondReceipt.result).toEqual(detail.firstReceipt.result);
  });

  it('records the timeout as no reply rather than inventing a status', () => {
    const silent = run.exchanges.filter((each) => each.status === 0);
    expect(silent).toHaveLength(1);
    expect(silent[0]?.response.reason).toContain('no reply');
  });
});
