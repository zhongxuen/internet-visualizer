/**
 * Integration tests for `GET /api/diagnostics/dns`.
 *
 * Three things are being checked, in descending order of how much they matter:
 *
 *   1. a blocked target never reaches `fetch` -- asserted by the call log being empty,
 *      not by the status code, because a 403 with a request already sent is worthless;
 *   2. exactly one target can be asked about, however it is written;
 *   3. an exhausted bucket answers 429 with `Retry-After` and makes no request.
 *
 * Everything else -- the shape of the answer, the RR type names, an NXDOMAIN being a
 * successful lookup -- is here too, but it is the easy part.
 */

import { describe, expect, it } from 'vitest';

import { createRateLimiter } from '@/core/net/ratelimit';

import { createDnsHandler, DOH_RESOLVER, dohUrlFor } from '../_lib/dns';
import { bodyOf, fakeFetch, get, jsonResponse, makeDeps, noFetch } from './harness';

/** A Cloudflare `application/dns-json` answer for `example.com A`. */
const ANSWER = {
  Status: 0,
  TC: false,
  RD: true,
  RA: true,
  AD: false,
  CD: false,
  Question: [{ name: 'example.com.', type: 1 }],
  Answer: [
    { name: 'example.com.', type: 1, TTL: 300, data: '93.184.216.34' },
    { name: 'example.com.', type: 1, TTL: 300, data: '93.184.215.14' },
  ],
};

function withAnswer(body: unknown = ANSWER) {
  const stub = fakeFetch({ [DOH_RESOLVER.endpoint]: jsonResponse(body) });
  return { ...stub, deps: makeDeps({ fetch: stub.fetch }) };
}

describe('GET /api/diagnostics/dns', () => {
  describe('a successful lookup', () => {
    it('queries the one allow-listed resolver and maps the answer', async () => {
      const { deps, calls } = withAnswer();
      const response = await createDnsHandler(deps)(
        get('/api/diagnostics/dns?target=example.com&type=A'),
      );
      const body = await bodyOf(response);

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.rcode).toBe('NOERROR');
      expect(body.answers).toHaveLength(2);
      // The trailing dot of a fully qualified name comes off here, once.
      expect(body.answers[0]).toMatchObject({
        name: 'example.com',
        type: 'A',
        typeValue: 1,
        ttl: 300,
        data: '93.184.216.34',
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe(dohUrlFor('example.com', 'A'));
      expect(new URL(calls[0]!.url).origin).toBe(DOH_RESOLVER.origin);
    });

    it('names its source and timestamps the answer', async () => {
      const { deps } = withAnswer();
      const body = await bodyOf(
        await createDnsHandler(deps)(get('/api/diagnostics/dns?target=example.com')),
      );

      expect(body.source).toMatchObject({ kind: 'doh', name: DOH_RESOLVER.name });
      expect(body.source.endpoint).toBe(dohUrlFor('example.com', 'A'));
      expect(Number.isNaN(Date.parse(body.requestedAt))).toBe(false);
      expect(typeof body.elapsedMs).toBe('number');
    });

    it('defaults to an A lookup when no type is given', async () => {
      const { deps, calls } = withAnswer();
      const body = await bodyOf(
        await createDnsHandler(deps)(get('/api/diagnostics/dns?target=example.com')),
      );

      expect(body.type).toBe('A');
      expect(calls[0]?.url).toContain('type=A');
    });

    it('treats NXDOMAIN as an answer, not a failure', async () => {
      const { deps } = withAnswer({
        Status: 3,
        Question: [{ name: 'nope.example.com.', type: 1 }],
        Authority: [
          { name: 'example.com.', type: 6, TTL: 900, data: 'ns.example.com. ...' },
        ],
      });
      const response = await createDnsHandler(deps)(
        get('/api/diagnostics/dns?target=nope.example.com'),
      );
      const body = await bodyOf(response);

      expect(response.status).toBe(200);
      expect(body.rcode).toBe('NXDOMAIN');
      expect(body.answers).toEqual([]);
      expect(body.authority[0]).toMatchObject({ type: 'SOA' });
    });
  });

  describe('the outbound request carries nothing of the user', () => {
    it('forwards no cookies, credentials, or referrer, and follows no redirect', async () => {
      const { deps, calls } = withAnswer();
      await createDnsHandler(deps)(
        get('/api/diagnostics/dns?target=example.com', {
          cookie: 'session=secret',
          authorization: 'Bearer secret',
        }),
      );

      const init = calls[0]?.init ?? {};
      expect(init.method).toBe('GET');
      expect(init.credentials).toBe('omit');
      expect(init.redirect).toBe('manual');
      expect(init.referrerPolicy).toBe('no-referrer');
      expect(init.cache).toBe('no-store');
      expect(init.signal).toBeInstanceOf(AbortSignal);
      // The only header that goes out is the one the DoH endpoint needs.
      expect(Object.keys(init.headers as Record<string, string>)).toEqual(['accept']);
    });
  });

  describe('blocked targets never reach the network', () => {
    const blocked: [string, string, number][] = [
      ['localhost', 'blocked-hostname', 403],
      ['router.local', 'blocked-hostname', 403],
      ['127.0.0.1', 'blocked-address', 403],
      ['10.0.0.1', 'blocked-address', 403],
      ['192.168.1.1', 'blocked-address', 403],
      ['169.254.169.254', 'blocked-address', 403],
      ['::1', 'blocked-address', 403],
      ['::ffff:169.254.169.254', 'blocked-address', 403],
    ];

    for (const [target, reason, status] of blocked) {
      it(`refuses ${target} without making a request`, async () => {
        const stub = noFetch();
        const deps = makeDeps({ fetch: stub.fetch });
        const response = await createDnsHandler(deps)(
          get(`/api/diagnostics/dns?target=${encodeURIComponent(target)}`),
        );
        const body = await bodyOf(response);

        expect(response.status).toBe(status);
        expect(body.ok).toBe(false);
        expect(body.error.reason).toBe(reason);
        expect(stub.calls).toEqual([]);
      });
    }

    it('names the cloud metadata endpoint when that is what was asked for', async () => {
      const stub = noFetch();
      const body = await bodyOf(
        await createDnsHandler(makeDeps({ fetch: stub.fetch }))(
          get('/api/diagnostics/dns?target=169.254.169.254'),
        ),
      );

      expect(body.error.metadataEndpoint).toMatch(/metadata/i);
      expect(body.error.code).toBe('blocked-target');
    });

    it('refuses an address literal, and points at the RDAP lookup instead', async () => {
      const stub = noFetch();
      const response = await createDnsHandler(makeDeps({ fetch: stub.fetch }))(
        get('/api/diagnostics/dns?target=93.184.216.34'),
      );
      const body = await bodyOf(response);

      expect(response.status).toBe(400);
      expect(body.error.message).toContain('RDAP');
      expect(stub.calls).toEqual([]);
    });
  });

  describe('exactly one target', () => {
    const multi: string[] = [
      'target=example.com&target=evil.example.net',
      'target=example.com,evil.example.net',
      'targets=example.com,evil.example.net',
      'target=example.com&targets=evil.example.net',
      'target=192.0.2.0/24',
      'target=192.0.2.1-192.0.2.9',
      'target=example.com%20evil.example.net',
      'range=192.0.2.0-192.0.2.255&target=example.com',
    ];

    for (const query of multi) {
      it(`refuses "${query}"`, async () => {
        const stub = noFetch();
        const response = await createDnsHandler(makeDeps({ fetch: stub.fetch }))(
          get(`/api/diagnostics/dns?${query}`),
        );
        const body = await bodyOf(response);

        expect(response.status).toBe(400);
        expect(body.error.code).toBe('invalid-target');
        expect(stub.calls).toEqual([]);
      });
    }

    it('refuses a missing target', async () => {
      const response = await createDnsHandler(makeDeps())(get('/api/diagnostics/dns'));
      expect(response.status).toBe(400);
      expect((await bodyOf(response)).error.message).toContain('required');
    });

    it('refuses two record types as firmly as two targets', async () => {
      const stub = noFetch();
      const response = await createDnsHandler(makeDeps({ fetch: stub.fetch }))(
        get('/api/diagnostics/dns?target=example.com&type=A&type=TXT'),
      );
      expect(response.status).toBe(400);
      expect(stub.calls).toEqual([]);
    });

    it('refuses a record type outside the offered set', async () => {
      const stub = noFetch();
      const response = await createDnsHandler(makeDeps({ fetch: stub.fetch }))(
        get('/api/diagnostics/dns?target=example.com&type=ANY'),
      );
      expect(response.status).toBe(400);
      expect((await bodyOf(response)).error.message).toContain('A, AAAA, MX, NS, TXT');
      expect(stub.calls).toEqual([]);
    });
  });

  describe('rate limiting', () => {
    it('answers 429 with Retry-After once the bucket is empty, and makes no request', async () => {
      const stub = fakeFetch({ [DOH_RESOLVER.endpoint]: jsonResponse(ANSWER) });
      const deps = makeDeps({ fetch: stub.fetch, limit: 2 });
      const handler = createDnsHandler(deps);

      expect((await handler(get('/api/diagnostics/dns?target=example.com'))).status).toBe(
        200,
      );
      expect((await handler(get('/api/diagnostics/dns?target=example.com'))).status).toBe(
        200,
      );

      const refused = await handler(get('/api/diagnostics/dns?target=example.com'));
      const body = await bodyOf(refused);

      expect(refused.status).toBe(429);
      expect(refused.headers.get('Retry-After')).toBeTruthy();
      expect(Number(refused.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
      expect(refused.headers.get('X-RateLimit-Remaining')).toBe('0');
      expect(body.error.code).toBe('rate-limited');
      expect(body.error.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      // Two allowed requests, two outbound calls, and nothing from the third.
      expect(stub.calls).toHaveLength(2);
    });

    it('reports the remaining quota on a successful lookup too', async () => {
      const { deps } = withAnswer();
      const response = await createDnsHandler(makeDeps({ fetch: deps.fetch, limit: 5 }))(
        get('/api/diagnostics/dns?target=example.com'),
      );

      expect(response.headers.get('X-RateLimit-Limit')).toBe('5');
      expect(response.headers.get('X-RateLimit-Remaining')).toBe('4');
    });

    it('spends a token even on a refused target, so validation is not a free oracle', async () => {
      const limiter = createRateLimiter({
        client: { limit: 3, windowMs: 60_000, burst: 3 },
        global: null,
      });
      const deps = makeDeps({ fetch: noFetch().fetch, limiter });
      const handler = createDnsHandler(deps);

      await handler(get('/api/diagnostics/dns?target=localhost'));
      const after = await handler(get('/api/diagnostics/dns?target=10.0.0.1'));

      expect(after.headers.get('X-RateLimit-Remaining')).toBe('1');
    });

    it('keeps two different clients in two different buckets', async () => {
      const stub = fakeFetch({ [DOH_RESOLVER.endpoint]: jsonResponse(ANSWER) });
      const handler = createDnsHandler(makeDeps({ fetch: stub.fetch, limit: 1 }));

      const first = await handler(
        get('/api/diagnostics/dns?target=example.com', { 'x-real-ip': '198.51.100.1' }),
      );
      const second = await handler(
        get('/api/diagnostics/dns?target=example.com', { 'x-real-ip': '198.51.100.2' }),
      );

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
    });
  });

  describe('when the resolver misbehaves', () => {
    it('reports a non-200 from the resolver as an upstream failure', async () => {
      const stub = fakeFetch({
        [DOH_RESOLVER.endpoint]: new Response('nope', { status: 503 }),
      });
      const response = await createDnsHandler(makeDeps({ fetch: stub.fetch }))(
        get('/api/diagnostics/dns?target=example.com'),
      );

      expect(response.status).toBe(502);
      expect((await bodyOf(response)).error.code).toBe('upstream-failed');
    });

    it('reports an unreadable body rather than throwing', async () => {
      const stub = fakeFetch({
        [DOH_RESOLVER.endpoint]: new Response('<html>captive portal</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      });
      const response = await createDnsHandler(makeDeps({ fetch: stub.fetch }))(
        get('/api/diagnostics/dns?target=example.com'),
      );

      expect(response.status).toBe(502);
      expect((await bodyOf(response)).error.message).toContain('DNS-over-HTTPS');
    });

    it('refuses a body larger than the cap before decoding it', async () => {
      const stub = fakeFetch({
        [DOH_RESOLVER.endpoint]: () =>
          new Response('x'.repeat(70_000), {
            status: 200,
            headers: { 'content-length': '70000' },
          }),
      });
      const response = await createDnsHandler(makeDeps({ fetch: stub.fetch }))(
        get('/api/diagnostics/dns?target=example.com'),
      );
      const body = await bodyOf(response);

      expect(response.status).toBe(502);
      expect(body.error.reason).toBe('response-too-large');
    });

    it('reports a timeout as a timeout, not as a failure of the target', async () => {
      const stub = fakeFetch({
        [DOH_RESOLVER.endpoint]: () => {
          const error = new Error('The operation was aborted');
          error.name = 'AbortError';
          return Promise.reject(error);
        },
      });
      const response = await createDnsHandler(makeDeps({ fetch: stub.fetch }))(
        get('/api/diagnostics/dns?target=example.com'),
      );

      expect(response.status).toBe(504);
      expect((await bodyOf(response)).error.code).toBe('timeout');
    });

    it('reports a transport failure as unreachable', async () => {
      const stub = fakeFetch({
        [DOH_RESOLVER.endpoint]: () =>
          Promise.reject(
            Object.assign(new TypeError('fetch failed'), {
              cause: new Error('ECONNREFUSED'),
            }),
          ),
      });
      const response = await createDnsHandler(makeDeps({ fetch: stub.fetch }))(
        get('/api/diagnostics/dns?target=example.com'),
      );

      expect(response.status).toBe(502);
      expect((await bodyOf(response)).error.code).toBe('upstream-failed');
    });
  });

  it('never caches a live measurement', async () => {
    const { deps } = withAnswer();
    const response = await createDnsHandler(deps)(
      get('/api/diagnostics/dns?target=example.com'),
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});
