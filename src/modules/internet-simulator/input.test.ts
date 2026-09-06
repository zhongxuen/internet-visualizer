import { describe, expect, it } from 'vitest';

import { coverageFor, handoffFor, parseAddress, SUGGESTED_URLS } from './input';
import { STAGE_IDS, STAGE_MODULE_ROUTES } from './sim/stage';
import { parseUrl } from './sim/stages/url-parse';

/**
 * The address bar's boundary, and the handoff out of it.
 *
 * Two claims are being tested. The first is the safety one: what survives validation is a
 * URL this simulator can run, and a host the bundled zones have never heard of is reported
 * as such *before* the run rather than as an error page afterwards. The second is the
 * teaching one: every stage with a module of its own offers a link into it that carries the
 * host currently in the field, because a handoff that dropped the input would send a learner
 * to a default and quietly lose the thread.
 */

const url = (raw: string) => {
  const parsed = parseUrl(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
};

describe('parseAddress', () => {
  it('accepts a bare host and fills in https, as a browser does', () => {
    const result = parseAddress('example.com');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scheme).toBe('https');
    expect(result.value.href).toBe('https://example.com/');
  });

  it('rejects a scheme this simulator has no stages for, and says which', () => {
    const result = parseAddress('ftp://files.example.com/');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('ftp');
  });

  it('rejects an empty field with an instruction rather than a parser fragment', () => {
    const result = parseAddress('   ');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Type a URL/);
  });

  it('keeps the fragment out of the request target', () => {
    const result = parseAddress('https://www.example.com/pricing#plans');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.fragment).toBe('plans');
    expect(result.value.target).toBe('/pricing');
  });

  it('agrees with the stage-1 parser, which is the one on screen', () => {
    for (const suggestion of SUGGESTED_URLS) {
      expect(parseAddress(suggestion.url)).toEqual(parseUrl(suggestion.url));
    }
  });
});

describe('coverageFor', () => {
  it('confirms a host the bundled zones are authoritative for', () => {
    const coverage = coverageFor('www.example.com');
    expect(coverage.known).toBe(true);
    expect(coverage.note).toContain('example.com');
  });

  /**
   * The load-bearing case. A learner typing a site they know is online must be told that
   * the NXDOMAIN they are about to see is a fact about this simulation, before they see it.
   */
  it('warns about a host it has never heard of, and says why', () => {
    const coverage = coverageFor('search.example-search.test');
    expect(coverage.known).toBe(false);
    expect(coverage.note).toContain('NXDOMAIN');
    expect(coverage.note).toContain('not about the real Internet');
  });

  /**
   * Coverage is about the *zone*, not the name. `nope.example.com` sits inside the bundled
   * `example.com` zone and is covered by it -- the zone is simulated, is asked, and answers
   * NXDOMAIN because that name is genuinely not in it. That is a different thing from a name
   * whose top-level domain the simulated root has never delegated, and conflating the two
   * would make the warning fire on names this simulator models perfectly well.
   */
  it('covers every suggestion, including the one that answers NXDOMAIN', () => {
    for (const suggestion of SUGGESTED_URLS) {
      const parsed = parseUrl(suggestion.url);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      expect(coverageFor(parsed.value.host).known).toBe(true);
    }
  });
});

describe('handoffFor', () => {
  const target = url('https://shop.example.com/catalog?page=2');

  it('offers a link for every stage that has a module of its own', () => {
    for (const stage of STAGE_IDS) {
      const handoff = handoffFor(stage, target);
      expect(Boolean(handoff)).toBe(STAGE_MODULE_ROUTES[stage] !== undefined);
    }
  });

  it('carries the host into the DNS Explorer as a name to look up', () => {
    const handoff = handoffFor('dns', target);
    expect(handoff?.href).toBe(
      '/dns-explorer?name=shop.example.com&type=A&from=internet-simulator',
    );
  });

  it('carries the host and port into the Packet Journey', () => {
    const handoff = handoffFor('tcp', target);
    expect(handoff?.href).toContain('host=shop.example.com');
    expect(handoff?.href).toContain('port=443');
  });

  it('carries the whole URL into the HTTP Explorer, target included', () => {
    const handoff = handoffFor('http', target);
    expect(handoff?.href).toContain('/http-explorer?');
    expect(handoff?.href).toContain(encodeURIComponent(target.href));
    expect(handoff?.href).toContain(encodeURIComponent('/catalog?page=2'));
  });

  it('marks where the learner came from, on every link', () => {
    for (const stage of STAGE_IDS) {
      const handoff = handoffFor(stage, target);
      if (!handoff) continue;
      expect(handoff.href).toContain('from=internet-simulator');
    }
  });

  /**
   * The two stages with no module are not an oversight: parsing a URL and painting a page
   * are browser behaviour, and there is nowhere honest to send someone for them.
   */
  it('has nowhere to send the URL and render stages', () => {
    expect(handoffFor('url-parse', target)).toBeUndefined();
    expect(handoffFor('render', target)).toBeUndefined();
  });
});
