import { describe, expect, it, vi } from 'vitest';

import { runLiveRequest } from './client';
import { checkLiveTarget, getLiveOperation, planLiveRequest } from './operations';

/**
 * The module's only I/O, tested with an injected `fetch` so this file opens no sockets.
 *
 * The assertions are about the properties Live mode's safety argument rests on, not about
 * rendering: one request per call, to the URL that was disclosed, with no credentials;
 * every ending a value rather than a throw; and no retry anywhere, for any status.
 */

/** A plan for `example.com`, for whichever operation is named. */
function planFor(id: 'dns' | 'rdap' | 'reach') {
  const operation = getLiveOperation(id)!;
  const checked = checkLiveTarget(id, 'example.com');
  if (!checked.allowed) throw new Error('fixture target was refused');
  return planLiveRequest(operation, checked.value);
}

/** A `fetch` stand-in that records its calls and answers with `body`. */
function fakeFetch(body: unknown, init: ResponseInit = { status: 200 }) {
  // Typed as `fetch` so `mock.calls` carries the real argument tuple and the assertions
  // below can read the URL and the RequestInit the client actually passed.
  return vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(body), {
        ...init,
        headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
      }),
  );
}

const OK_BODY = {
  ok: true,
  requestedAt: '2026-09-06T00:00:00.000Z',
  elapsedMs: 8,
  source: { kind: 'doh', name: 'Cloudflare', endpoint: 'https://…', note: 'note' },
  target: 'example.com',
  answers: [],
};

describe('runLiveRequest', () => {
  it('makes exactly one request, to the URL the plan disclosed', async () => {
    const plan = planFor('dns');
    const fetchImpl = fakeFetch(OK_BODY);

    const outcome = await runLiveRequest(plan, { fetchImpl });

    expect(outcome.status).toBe('ok');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(plan.fromBrowser.url);
  });

  it('forwards no credentials and asks for no cache', async () => {
    const fetchImpl = fakeFetch(OK_BODY);
    await runLiveRequest(planFor('reach'), {
      fetchImpl,
    });

    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
    });
  });

  it('reads the rate-limit headers off a successful response too', async () => {
    const fetchImpl = fakeFetch(OK_BODY, {
      status: 200,
      headers: {
        'X-RateLimit-Limit': '10',
        'X-RateLimit-Remaining': '7',
        'X-RateLimit-Reset': '1757116800',
      },
    });

    const outcome = await runLiveRequest(planFor('dns'), {
      fetchImpl,
    });

    expect(outcome).toMatchObject({
      status: 'ok',
      quota: { limit: 10, remaining: 7, resetAt: 1757116800 },
    });
  });

  it('passes a guard refusal through with its reason intact, and does not retry', async () => {
    const fetchImpl = fakeFetch(
      {
        ok: false,
        error: {
          code: 'blocked-target',
          message: 'that address is loopback and will not be requested',
          reason: 'blocked-resolved-address',
          address: '127.0.0.1',
        },
        requestedAt: '2026-09-06T00:00:00.000Z',
      },
      { status: 403 },
    );

    const outcome = await runLiveRequest(planFor('reach'), {
      fetchImpl,
    });

    expect(outcome).toMatchObject({
      status: 'failed',
      failure: {
        code: 'blocked-target',
        reason: 'blocked-resolved-address',
        address: '127.0.0.1',
        httpStatus: 403,
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('surfaces the retry delay on a 429 without acting on it', async () => {
    const fetchImpl = fakeFetch(
      {
        ok: false,
        error: {
          code: 'rate-limited',
          message: 'You have used your share of live lookups.',
          retryAfterSeconds: 30,
        },
        requestedAt: '2026-09-06T00:00:00.000Z',
      },
      { status: 429, headers: { 'Retry-After': '30' } },
    );

    const outcome = await runLiveRequest(planFor('dns'), {
      fetchImpl,
    });

    expect(outcome).toMatchObject({
      status: 'failed',
      failure: { code: 'rate-limited', retryAfterSeconds: 30 },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('turns a dead connection into a failure value rather than a throw', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError('Failed to fetch');
    });

    const outcome = await runLiveRequest(planFor('dns'), {
      fetchImpl,
    });

    expect(outcome).toMatchObject({ status: 'failed', failure: { code: 'network' } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reports an abort as an abort, not as a network error', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new DOMException('The operation was aborted.', 'AbortError');
    });

    const outcome = await runLiveRequest(planFor('dns'), {
      signal: controller.signal,
      fetchImpl,
    });

    expect(outcome).toMatchObject({ status: 'failed', failure: { code: 'aborted' } });
  });

  it('does not mistake an unrecognised body for an answer', async () => {
    const fetchImpl = fakeFetch({ something: 'else' }, { status: 502 });

    const outcome = await runLiveRequest(planFor('rdap'), {
      fetchImpl,
    });

    expect(outcome).toMatchObject({
      status: 'failed',
      failure: { code: 'upstream-failed', httpStatus: 502 },
    });
  });
});
