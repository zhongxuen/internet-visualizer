import { describe, expect, it } from 'vitest';

import { REACH_NOT_ICMP } from '@/core/net/diagnostics';

import {
  checkLiveTarget,
  getLiveOperation,
  liveOperationForTool,
  planLiveRequest,
  LIVE_OPERATIONS,
  LIVE_TRACEROUTE_NOTE,
} from './operations';

/**
 * The description of a live request, tested without making one.
 *
 * This file is where the disclosure's promise is checked: that the URL shown to the user
 * is built by the same function the handler uses, that a target only ever lands in a
 * query parameter for the two lookups, and that the plan for `reach` is a `HEAD` to the
 * host that was typed and nothing else. Everything here is pure, so none of it opens a
 * socket -- which is also the point.
 */

/** The plan for a target that is expected to pass validation. */
function planFor(id: 'dns' | 'rdap' | 'reach', target: string, type?: 'A' | 'MX') {
  const operation = getLiveOperation(id)!;
  const checked = checkLiveTarget(id, target);
  if (!checked.allowed) throw new Error(`${target} was refused: ${checked.detail}`);
  return planLiveRequest(operation, checked.value, type);
}

describe('the operation list', () => {
  it('offers three operations and no traceroute', () => {
    expect(LIVE_OPERATIONS.map((operation) => operation.id)).toEqual([
      'dns',
      'rdap',
      'reach',
    ]);
    expect(liveOperationForTool('traceroute')).toBeUndefined();
    expect(LIVE_TRACEROUTE_NOTE).toMatch(/raw socket/);
  });

  it('never calls the reachability check a ping', () => {
    const reach = getLiveOperation('reach')!;
    expect(reach.label).not.toMatch(/ping/i);
    expect(reach.label).toMatch(/TCP/);
    // The same sentence the route puts in its payload, so the two cannot disagree.
    expect(reach.warning).toBe(REACH_NOT_ICMP);
    expect(reach.warning).toMatch(/not an ICMP echo/);
  });

  it('pairs each operation with the simulated tool that explains it', () => {
    expect(liveOperationForTool('ping')?.id).toBe('reach');
    expect(liveOperationForTool('lookup')?.id).toBe('dns');
    expect(liveOperationForTool('rdap')?.id).toBe('rdap');
  });

  it('marks only the reachability check as reaching the target', () => {
    expect(
      LIVE_OPERATIONS.filter((operation) => operation.reachesTheTarget).map((o) => o.id),
    ).toEqual(['reach']);
  });
});

describe('checkLiveTarget', () => {
  it('accepts one hostname and one address', () => {
    expect(checkLiveTarget('dns', 'example.com')).toMatchObject({
      allowed: true,
      value: { value: 'example.com' },
    });
    expect(checkLiveTarget('rdap', '193.0.6.135')).toMatchObject({ allowed: true });
  });

  it('refuses everything that would turn one lookup into a sweep', () => {
    for (const target of [
      'example.com,example.net',
      '192.0.2.0/24',
      '192.0.2.1-192.0.2.9',
      'example.com example.net',
    ]) {
      expect(checkLiveTarget('dns', target).allowed).toBe(false);
    }
  });

  it('refuses the addresses the guard exists to refuse, by the same rules', () => {
    for (const target of [
      '127.0.0.1',
      '10.0.0.1',
      '169.254.169.254',
      'localhost',
      '::1',
    ]) {
      expect(checkLiveTarget('dns', target).allowed).toBe(false);
      expect(checkLiveTarget('reach', target).allowed).toBe(false);
    }
  });

  it('refuses a scheme that is not http or https, rather than rewriting it', () => {
    const result = checkLiveTarget('reach', 'ftp://example.com/');
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe('blocked-scheme');
  });

  it('refuses a port outside 80 and 443', () => {
    const result = checkLiveTarget('reach', 'https://example.com:22/');
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe('blocked-port');
  });

  it('assumes https for a bare host, and says that it did', () => {
    const result = checkLiveTarget('reach', 'example.com');
    expect(result).toMatchObject({
      allowed: true,
      value: { assumedScheme: true, display: 'https://example.com/' },
    });
  });

  it('leaves an explicit http target alone', () => {
    const result = checkLiveTarget('reach', 'http://example.com/');
    expect(result).toMatchObject({ allowed: true, value: { assumedScheme: false } });
  });
});

describe('planLiveRequest', () => {
  it('sends the browser to this origin and nothing else', () => {
    for (const plan of [
      planFor('dns', 'example.com'),
      planFor('rdap', 'example.com'),
      planFor('reach', 'example.com'),
    ]) {
      expect(plan.fromBrowser.method).toBe('GET');
      expect(plan.fromBrowser.url.startsWith('/api/diagnostics/')).toBe(true);
    }
  });

  it('puts a DNS target in a parameter of the resolver’s own URL', () => {
    const plan = planFor('dns', 'example.com', 'MX');
    expect(plan.fromBrowser.url).toBe('/api/diagnostics/dns?target=example.com&type=MX');
    expect(plan.fromServer).toHaveLength(1);
    expect(plan.fromServer[0]?.url).toBe(
      'https://cloudflare-dns.com/dns-query?name=example.com&type=MX',
    );
    // The socket opens to the resolver; the target is only ever a query parameter.
    expect(new URL(plan.fromServer[0]!.url).host).toBe('cloudflare-dns.com');
    expect(plan.reachesTheTarget).toBe(false);
  });

  it('discloses both RDAP steps, and does not invent the registry base', () => {
    const plan = planFor('rdap', 'example.com');
    expect(plan.fromServer).toHaveLength(2);
    expect(plan.fromServer[0]?.url).toBe('https://data.iana.org/rdap/dns.json');
    expect(plan.fromServer[1]?.url).toMatch(/domain\/example\.com$/);
    expect(plan.fromServer[1]?.purpose).toMatch(/only known once the file above is read/);
  });

  it('picks the address bootstrap file for an address', () => {
    expect(planFor('rdap', '193.0.6.135').fromServer[0]?.url).toBe(
      'https://data.iana.org/rdap/ipv4.json',
    );
    // A routable address, not `2001:db8::/32`: the guard refuses the documentation
    // range like any other reserved block, which is itself worth not forgetting.
    expect(planFor('rdap', '2606:4700:4700::1111').fromServer[0]?.url).toBe(
      'https://data.iana.org/rdap/ipv6.json',
    );
  });

  it('plans exactly one HEAD to the typed host for reachability', () => {
    const plan = planFor('reach', 'example.com');
    expect(plan.fromServer).toHaveLength(1);
    expect(plan.fromServer[0]).toMatchObject({
      method: 'HEAD',
      url: 'https://example.com/',
    });
    expect(plan.reachesTheTarget).toBe(true);
  });

  it('never plans more than two outbound requests, for any operation', () => {
    for (const operation of LIVE_OPERATIONS) {
      const checked = checkLiveTarget(operation.id, 'example.com');
      expect(checked.allowed).toBe(true);
      if (!checked.allowed) return;
      const plan = planLiveRequest(operation, checked.value);
      expect(plan.fromServer.length).toBeLessThanOrEqual(2);
    }
  });
});
