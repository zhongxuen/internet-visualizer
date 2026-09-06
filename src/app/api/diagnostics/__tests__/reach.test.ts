/**
 * Integration tests for `GET /api/diagnostics/reach`.
 *
 * This is the route where the user chooses the address a socket is opened to, so it
 * gets the hardest tests in the module. The one that matters most is `rebinding`: a
 * hostname that looks entirely ordinary and resolves to `10.0.0.1`. Validating the
 * string is not enough, and the only proof that the post-resolution re-check is wired
 * in is a test where the string is fine and the answer is not.
 */

import { describe, expect, it } from 'vitest';

import { createReachHandler, normalizeReachTarget, REACH_NOT_ICMP } from '../_lib/reach';
import { bodyOf, fakeFetch, get, makeDeps, noFetch, tableResolver } from './harness';

/** A HEAD answer with the headers this route reports, and one it must drop. */
function headResponse(init: ResponseInit = {}): Response {
  return new Response(null, {
    status: 200,
    statusText: 'OK',
    ...init,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      server: 'ECS (dcb/7F84)',
      'strict-transport-security': 'max-age=63072000',
      'set-cookie': 'tracking=please-do-not-render-me',
      'x-internal-debug': 'leak me',
      ...(init.headers ?? {}),
    },
  });
}

function stubbed(
  response: Response | (() => Response | Promise<Response>) = headResponse(),
) {
  return fakeFetch({ 'https://': response, 'http://': response });
}

describe('GET /api/diagnostics/reach', () => {
  describe('a successful HEAD', () => {
    it('reports the status, the timing, and the addresses the guard cleared', async () => {
      const stub = stubbed();
      const response = await createReachHandler(makeDeps({ fetch: stub.fetch }))(
        get('/api/diagnostics/reach?target=https://example.com/'),
      );
      const body = await bodyOf(response);

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        target: 'https://example.com/',
        requestedUrl: 'https://example.com/',
        method: 'HEAD',
        scheme: 'https:',
        hostname: 'example.com',
        port: 443,
        answered: true,
        status: 200,
        ok: true,
        resolved: true,
      });
      expect(body.addresses).toEqual([
        { address: '93.184.216.34', scope: 'public', version: 4 },
      ]);
      expect(typeof body.responseTimeMs).toBe('number');
      expect(stub.calls).toHaveLength(1);
    });

    it('says plainly that this is not an ICMP ping', async () => {
      const stub = stubbed();
      const body = await bodyOf(
        await createReachHandler(makeDeps({ fetch: stub.fetch }))(
          get('/api/diagnostics/reach?target=https://example.com/'),
        ),
      );

      expect(body.note).toBe(REACH_NOT_ICMP);
      expect(body.note).toContain('not an ICMP echo');
    });

    it('reports only the allow-listed response headers', async () => {
      const stub = stubbed();
      const body = await bodyOf(
        await createReachHandler(makeDeps({ fetch: stub.fetch }))(
          get('/api/diagnostics/reach?target=https://example.com/'),
        ),
      );

      expect(body.headers).toMatchObject({
        'content-type': 'text/html; charset=utf-8',
        server: 'ECS (dcb/7F84)',
        'strict-transport-security': 'max-age=63072000',
      });
      expect(body.headers['set-cookie']).toBeUndefined();
      expect(body.headers['x-internal-debug']).toBeUndefined();
    });

    it('describes what TLS proves and what it cannot show', async () => {
      const stub = stubbed();
      const body = await bodyOf(
        await createReachHandler(makeDeps({ fetch: stub.fetch }))(
          get('/api/diagnostics/reach?target=https://example.com/'),
        ),
      );

      expect(body.tls).toMatchObject({ negotiated: true });
      expect(body.tls.note).toContain('certificate');
    });

    it('omits the TLS block for a plain http target', async () => {
      const stub = stubbed();
      const body = await bodyOf(
        await createReachHandler(makeDeps({ fetch: stub.fetch }))(
          get('/api/diagnostics/reach?target=http://example.com/'),
        ),
      );

      expect(body.tls).toBeUndefined();
      expect(body.port).toBe(80);
    });

    it('gives a bare hostname the https scheme, and says which URL it used', async () => {
      const stub = stubbed();
      const body = await bodyOf(
        await createReachHandler(makeDeps({ fetch: stub.fetch }))(
          get('/api/diagnostics/reach?target=example.com'),
        ),
      );

      expect(body.target).toBe('example.com');
      expect(body.requestedUrl).toBe('https://example.com/');
      expect(stub.calls[0]?.url).toBe('https://example.com/');
    });

    it('counts a 404 as reachable, because the host answered', async () => {
      const stub = stubbed(new Response(null, { status: 404, statusText: 'Not Found' }));
      const body = await bodyOf(
        await createReachHandler(makeDeps({ fetch: stub.fetch }))(
          get('/api/diagnostics/reach?target=https://example.com/missing'),
        ),
      );

      expect(body.answered).toBe(true);
      expect(body.status).toBe(404);
      expect(body.ok).toBe(false);
    });
  });

  describe('the outbound request', () => {
    it('is a single HEAD with no credentials, cookies, or referrer', async () => {
      const stub = stubbed();
      await createReachHandler(makeDeps({ fetch: stub.fetch }))(
        get('/api/diagnostics/reach?target=https://example.com/', {
          cookie: 'session=secret',
          authorization: 'Bearer secret',
          'x-api-key': 'secret',
        }),
      );

      expect(stub.calls).toHaveLength(1);
      const init = stub.calls[0]!.init;
      expect(init.method).toBe('HEAD');
      expect(init.credentials).toBe('omit');
      expect(init.redirect).toBe('manual');
      expect(init.referrerPolicy).toBe('no-referrer');
      expect(init.cache).toBe('no-store');
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.headers).toEqual({});
    });

    it('reports a redirect instead of obeying it', async () => {
      const stub = stubbed(
        new Response(null, {
          status: 301,
          headers: { location: 'https://www.example.com/' },
        }),
      );
      const body = await bodyOf(
        await createReachHandler(makeDeps({ fetch: stub.fetch }))(
          get('/api/diagnostics/reach?target=https://example.com/'),
        ),
      );

      expect(body.redirect).toMatchObject({
        status: 301,
        location: 'https://www.example.com/',
        followed: false,
      });
      // The point: one request, not two.
      expect(stub.calls).toHaveLength(1);
    });

    it('does not follow a redirect that points at the metadata endpoint', async () => {
      const stub = stubbed(
        new Response(null, {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data/' },
        }),
      );
      const body = await bodyOf(
        await createReachHandler(makeDeps({ fetch: stub.fetch }))(
          get('/api/diagnostics/reach?target=https://example.com/'),
        ),
      );

      expect(body.redirect.followed).toBe(false);
      expect(stub.calls).toHaveLength(1);
      expect(stub.calls[0]?.url).toBe('https://example.com/');
    });
  });

  describe('the SSRF guard, end to end', () => {
    it('refuses a hostname that resolves to a private address (DNS rebinding)', async () => {
      const stub = stubbed();
      const resolver = tableResolver({ 'totally-normal.example.com': ['10.0.0.1'] });
      const response = await createReachHandler(
        makeDeps({ fetch: stub.fetch, resolve: resolver.resolve }),
      )(get('/api/diagnostics/reach?target=https://totally-normal.example.com/'));
      const body = await bodyOf(response);

      expect(response.status).toBe(403);
      expect(body.error.reason).toBe('blocked-resolved-address');
      expect(body.error.address).toBe('10.0.0.1');
      expect(body.error.scope).toBe('private');
      // Resolved, then refused -- no socket was ever opened.
      expect(resolver.seen).toContain('totally-normal.example.com');
      expect(stub.calls).toEqual([]);
    });

    it('refuses a name that resolves to the metadata endpoint, by name', async () => {
      const stub = stubbed();
      const resolver = tableResolver({
        'metadata-proxy.example.com': ['169.254.169.254'],
      });
      const body = await bodyOf(
        await createReachHandler(
          makeDeps({ fetch: stub.fetch, resolve: resolver.resolve }),
        )(get('/api/diagnostics/reach?target=https://metadata-proxy.example.com/')),
      );

      expect(body.error.metadataEndpoint).toMatch(/metadata/i);
      expect(stub.calls).toEqual([]);
    });

    it('refuses a name whose answer set mixes a public and a private address', async () => {
      const stub = stubbed();
      const resolver = tableResolver({
        'split-horizon.example.com': ['93.184.216.34', '192.168.1.5'],
      });
      const response = await createReachHandler(
        makeDeps({ fetch: stub.fetch, resolve: resolver.resolve }),
      )(get('/api/diagnostics/reach?target=https://split-horizon.example.com/'));

      expect(response.status).toBe(403);
      expect(stub.calls).toEqual([]);
    });

    it('reports a name that resolves to nothing as not found', async () => {
      const stub = stubbed();
      const resolver = tableResolver({ 'nowhere.example.com': [] });
      const response = await createReachHandler(
        makeDeps({ fetch: stub.fetch, resolve: resolver.resolve }),
      )(get('/api/diagnostics/reach?target=https://nowhere.example.com/'));

      expect(response.status).toBe(404);
      expect((await bodyOf(response)).error.code).toBe('not-found');
      expect(stub.calls).toEqual([]);
    });

    const refused: [string, string, number][] = [
      ['http://localhost/', 'blocked-hostname', 403],
      ['http://127.0.0.1/', 'blocked-address', 403],
      ['http://10.0.0.1/', 'blocked-address', 403],
      ['http://192.168.1.1/', 'blocked-address', 403],
      ['http://169.254.169.254/latest/meta-data/', 'blocked-address', 403],
      ['http://[::1]/', 'blocked-address', 403],
      ['http://[::ffff:169.254.169.254]/', 'blocked-address', 403],
      ['https://example.com:8080/', 'blocked-port', 403],
      ['https://example.com:22/', 'blocked-port', 403],
      ['file:///etc/passwd', 'blocked-scheme', 403],
      ['gopher://example.com/', 'blocked-scheme', 403],
      ['https://user:pass@example.com/', 'credentials-in-url', 400],
      // The URL parser would happily read these as 127.0.0.1 (or, worse, 8.0.0.1).
      ['http://2130706433/', 'ambiguous-host', 400],
      ['http://010.0.0.1/', 'ambiguous-host', 400],
      ['http://127.1/', 'ambiguous-host', 400],
      ['http://intranet/', 'malformed-host', 400],
      ['https://wiki.internal/', 'blocked-hostname', 403],
    ];

    for (const [target, reason, status] of refused) {
      it(`refuses ${target} without opening a socket`, async () => {
        const stub = noFetch();
        const response = await createReachHandler(makeDeps({ fetch: stub.fetch }))(
          get(`/api/diagnostics/reach?target=${encodeURIComponent(target)}`),
        );
        const body = await bodyOf(response);

        expect(response.status).toBe(status);
        expect(body.error.reason).toBe(reason);
        expect(stub.calls).toEqual([]);
      });
    }
  });

  describe('exactly one target', () => {
    const multi = [
      'target=https://example.com/&target=https://evil.example.net/',
      'targets=https://example.com/',
      'target=192.0.2.0/24',
      'target=192.0.2.1-192.0.2.9',
      'ports=22,80,443&target=https://example.com/',
    ];

    for (const query of multi) {
      it(`refuses "${query}"`, async () => {
        const stub = noFetch();
        const response = await createReachHandler(makeDeps({ fetch: stub.fetch }))(
          get(`/api/diagnostics/reach?${query}`),
        );

        expect(response.status).toBe(400);
        expect((await bodyOf(response)).error.code).toBe('invalid-target');
        expect(stub.calls).toEqual([]);
      });
    }

    it('contacts one host even when a second URL is smuggled into the path', async () => {
      // A URL has exactly one authority, so `https://a/,https://b/` is a request to
      // `a` with a peculiar path -- not two targets. Asserted rather than assumed,
      // because "it looks like two" is the reason someone would try it.
      const stub = stubbed();
      const body = await bodyOf(
        await createReachHandler(makeDeps({ fetch: stub.fetch }))(
          get(
            `/api/diagnostics/reach?target=${encodeURIComponent('https://example.com/,https://evil.example.net/')}`,
          ),
        ),
      );

      expect(body.hostname).toBe('example.com');
      expect(stub.calls).toHaveLength(1);
      expect(new URL(stub.calls[0]!.url).hostname).toBe('example.com');
    });
  });

  describe('rate limiting', () => {
    it('answers 429 with Retry-After and opens no socket', async () => {
      const stub = stubbed();
      const handler = createReachHandler(makeDeps({ fetch: stub.fetch, limit: 1 }));

      expect(
        (await handler(get('/api/diagnostics/reach?target=https://example.com/'))).status,
      ).toBe(200);

      const refused = await handler(
        get('/api/diagnostics/reach?target=https://example.com/'),
      );
      const body = await bodyOf(refused);

      expect(refused.status).toBe(429);
      expect(Number(refused.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
      expect(refused.headers.get('X-RateLimit-Limit')).toBe('1');
      expect(body.error.code).toBe('rate-limited');
      expect(stub.calls).toHaveLength(1);
    });
  });

  describe('failures are named, not retried', () => {
    it('reports a timeout as a timeout', async () => {
      const stub = stubbed(() => {
        const error = new Error('This operation was aborted');
        error.name = 'AbortError';
        return Promise.reject(error);
      });
      const response = await createReachHandler(makeDeps({ fetch: stub.fetch }))(
        get('/api/diagnostics/reach?target=https://example.com/'),
      );

      expect(response.status).toBe(504);
      expect((await bodyOf(response)).error.code).toBe('timeout');
      expect(stub.calls).toHaveLength(1);
    });

    it('reports a refused connection once, without retrying', async () => {
      const stub = stubbed(() =>
        Promise.reject(
          Object.assign(new TypeError('fetch failed'), {
            cause: new Error('ECONNREFUSED 93.184.216.34:443'),
          }),
        ),
      );
      const response = await createReachHandler(makeDeps({ fetch: stub.fetch }))(
        get('/api/diagnostics/reach?target=https://example.com/'),
      );
      const body = await bodyOf(response);

      expect(response.status).toBe(502);
      expect(body.error.code).toBe('upstream-failed');
      expect(body.error.message).toContain('ECONNREFUSED');
      expect(stub.calls).toHaveLength(1);
    });
  });
});

describe('normalizeReachTarget', () => {
  it('leaves a URL exactly as typed', () => {
    expect(normalizeReachTarget('http://example.com/a?b=c')).toEqual({
      url: 'http://example.com/a?b=c',
      assumedScheme: false,
    });
  });

  it('leaves a disallowed scheme alone so the guard can name it', () => {
    expect(normalizeReachTarget('file:///etc/passwd').assumedScheme).toBe(false);
  });

  it('assumes https for a bare hostname', () => {
    expect(normalizeReachTarget('example.com')).toEqual({
      url: 'https://example.com/',
      assumedScheme: true,
    });
  });

  it('brackets a bare IPv6 literal', () => {
    expect(normalizeReachTarget('2606:2800:220:1:248:1893:25c8:1946').url).toBe(
      'https://[2606:2800:220:1:248:1893:25c8:1946]/',
    );
  });

  it('hands anything unparseable straight through', () => {
    expect(normalizeReachTarget('192.0.2.0/24')).toEqual({
      url: '192.0.2.0/24',
      assumedScheme: false,
    });
  });
});
