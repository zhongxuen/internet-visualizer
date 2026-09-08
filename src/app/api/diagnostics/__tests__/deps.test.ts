/**
 * Tests for `_lib/deps.ts` -- the one file in this folder that touches the outside world.
 *
 * Everything else here takes a `DiagnosticsDeps` and is therefore trivially testable
 * without a socket. `deps.ts` is where that stops: it holds the real resolver, the real
 * `fetch`, and the real clock, so it is the file a test has to reach into rather than
 * around. `node:dns` is mocked for exactly that reason and for no other -- the assertions
 * below are about which DNS calls are made and what is done with their answers, which is
 * a security decision, not a networking convenience.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolve4 = vi.fn<(hostname: string) => Promise<string[]>>();
const resolve6 = vi.fn<(hostname: string) => Promise<string[]>>();

vi.mock('node:dns', () => ({ promises: { resolve4, resolve6 } }));

const { clientKeyOf, defaultDeps, resolveHost } = await import('../_lib/deps');

beforeEach(() => {
  resolve4.mockReset();
  resolve6.mockReset();
});

describe('resolveHost', () => {
  /**
   * The reason this file is not just `dns.lookup`. `lookup` goes through the OS
   * resolver, which reads `/etc/hosts` first -- so an attacker who can write a host
   * entry gets an SSRF vector that never touches DNS and that the guard would therefore
   * never see. `resolve4`/`resolve6` ask DNS and nothing else.
   */
  it('asks DNS directly, never the OS resolver', async () => {
    resolve4.mockResolvedValue(['93.184.216.34']);
    resolve6.mockResolvedValue(['2606:2800:220:1:248:1893:25c8:1946']);

    await resolveHost('example.com');

    expect(resolve4).toHaveBeenCalledWith('example.com');
    expect(resolve6).toHaveBeenCalledWith('example.com');
  });

  /**
   * Every address, both families, in one list. The guard checks the list it is given, so
   * returning only the A records would leave a name that resolves to a public v4 and a
   * loopback v6 looking safe.
   */
  it('hands back both families together', async () => {
    resolve4.mockResolvedValue(['93.184.216.34', '93.184.216.35']);
    resolve6.mockResolvedValue(['2606:2800:220:1:248:1893:25c8:1946']);

    await expect(resolveHost('example.com')).resolves.toEqual([
      '93.184.216.34',
      '93.184.216.35',
      '2606:2800:220:1:248:1893:25c8:1946',
    ]);
  });

  it('tolerates a v4-only name, whose AAAA lookup legitimately fails', async () => {
    resolve4.mockResolvedValue(['198.51.100.7']);
    resolve6.mockRejectedValue(new Error('queryAaaa ENODATA'));

    await expect(resolveHost('v4only.test')).resolves.toEqual(['198.51.100.7']);
  });

  it('tolerates a v6-only name, whose A lookup legitimately fails', async () => {
    resolve4.mockRejectedValue(new Error('queryA ENODATA'));
    resolve6.mockResolvedValue(['2001:db8::1']);

    await expect(resolveHost('v6only.test')).resolves.toEqual(['2001:db8::1']);
  });

  /**
   * Both families failing is a resolution failure, and it has to propagate: the guard
   * reports `resolution-failed` to the caller, and swallowing it into an empty list would
   * downgrade "we could not check this name" to "this name has no addresses" -- two very
   * different things to tell someone about a target they are about to probe.
   */
  it('throws when neither family resolved', async () => {
    resolve4.mockRejectedValue(new Error('queryA ENOTFOUND'));
    resolve6.mockRejectedValue(new Error('queryAaaa ENOTFOUND'));

    await expect(resolveHost('nope.invalid')).rejects.toThrow('queryA ENOTFOUND');
  });

  /** `Promise.allSettled` hands back whatever was thrown, which need not be an Error. */
  it('wraps a non-Error rejection rather than throwing a bare value', async () => {
    resolve4.mockRejectedValue('ENOTFOUND');
    resolve6.mockRejectedValue('ENOTFOUND');

    await expect(resolveHost('nope.invalid')).rejects.toThrow('ENOTFOUND');
  });

  /** An empty answer from both families is not a failure -- there is nothing to throw. */
  it('returns nothing, without throwing, when both families answer empty', async () => {
    resolve4.mockResolvedValue([]);
    resolve6.mockResolvedValue([]);

    await expect(resolveHost('empty.test')).resolves.toEqual([]);
  });
});

describe('defaultDeps', () => {
  /**
   * Bound, not passed by reference. An unbound `globalThis.fetch` throws "Illegal
   * invocation" in some runtimes, and the failure would only appear in production.
   */
  it('calls fetch with a correct receiver', async () => {
    const response = new Response('ok');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(function (
      this: unknown,
    ) {
      expect(this === undefined || this === globalThis).toBe(true);
      return Promise.resolve(response);
    });

    await expect(defaultDeps.fetch('https://example.test/')).resolves.toBe(response);
    expect(fetchSpy).toHaveBeenCalledWith('https://example.test/');
    fetchSpy.mockRestore();
  });

  it('reports a clock that moves forward', () => {
    const first = defaultDeps.now();
    const second = defaultDeps.now();

    expect(typeof first).toBe('number');
    expect(second).toBeGreaterThanOrEqual(first);
  });

  it('wires the shared limiter and the DNS-only resolver', () => {
    expect(defaultDeps.limiter).toBeDefined();
    expect(defaultDeps.resolve).toBe(resolveHost);
  });
});

describe('clientKeyOf', () => {
  const request = (headers: Record<string, string>) =>
    new Request('https://visualizer.test/api/diagnostics/dns?name=example.com', {
      headers,
    });

  /**
   * Only the entry a *trusted* proxy appended can be believed, and on Vercel that is the
   * platform-set header -- so it wins over the client-controllable forwarded chain.
   * Otherwise a caller could mint a fresh quota per request by spoofing one header.
   */
  it('prefers the platform header over the forwarded chain', () => {
    const spoofed = clientKeyOf(
      request({ 'x-forwarded-for': '10.0.0.9', 'x-real-ip': '203.0.113.7' }),
    );

    expect(spoofed).toBe(clientKeyOf(request({ 'x-real-ip': '203.0.113.7' })));
    expect(spoofed).not.toBe(clientKeyOf(request({ 'x-forwarded-for': '10.0.0.9' })));
  });

  it('falls back to the Vercel header when x-real-ip is absent', () => {
    expect(clientKeyOf(request({ 'x-vercel-forwarded-for': '203.0.113.7' }))).toBe(
      clientKeyOf(request({ 'x-real-ip': '203.0.113.7' })),
    );
  });

  /**
   * An unidentifiable caller shares one bucket with every other unidentifiable caller.
   * That is the strict direction: no header means less quota, never an exemption.
   */
  it('gives an unidentifiable caller the shared bucket', () => {
    const anonymous = clientKeyOf(request({}));

    expect(anonymous).toBe(clientKeyOf(request({ 'x-real-ip': 'not-an-address' })));
    expect(anonymous).not.toBe(clientKeyOf(request({ 'x-real-ip': '203.0.113.7' })));
  });
});
