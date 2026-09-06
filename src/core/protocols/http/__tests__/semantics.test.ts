import { describe, expect, it } from 'vitest';

import { HTTP_METHODS, header, response, type HttpMethod } from './message';
import {
  allowsContent,
  describeStatus,
  forbidsContent,
  isCacheableByDefault,
  isFinalStatus,
  isHeuristicallyCacheable,
  isIdempotent,
  isPermanentRedirect,
  isRedirect,
  isSafe,
  METHOD_SEMANTICS,
  methodAfterRedirect,
  methodSemantics,
  reasonPhrase,
  redirectMethodRule,
  redirectTarget,
  STATUS_SEMANTICS,
  statusClass,
  statusSemantics,
} from './semantics';

describe('the method table', () => {
  it('covers every method the message model can express', () => {
    expect(METHOD_SEMANTICS.map((entry) => entry.method).sort()).toEqual(
      [...HTTP_METHODS].sort(),
    );
    for (const method of HTTP_METHODS) {
      expect(methodSemantics(method).method).toBe(method);
    }
  });

  it('lists no method twice', () => {
    const methods = METHOD_SEMANTICS.map((entry) => entry.method);
    expect(new Set(methods).size).toBe(methods.length);
  });

  it('cites only current RFCs, never the obsolete 723x or 2616 series', () => {
    for (const entry of METHOD_SEMANTICS) {
      expect(entry.rfc).not.toMatch(/RFC 72\d\d|RFC 2616/);
    }
  });
});

describe('safe, idempotent, cacheable', () => {
  it('holds the invariant: every safe method is idempotent', () => {
    for (const entry of METHOD_SEMANTICS) {
      if (entry.safe) expect(entry.idempotent).toBe(true);
    }
  });

  it('marks exactly GET, HEAD, OPTIONS, and TRACE safe', () => {
    const safe = METHOD_SEMANTICS.filter((entry) => entry.safe).map((e) => e.method);
    expect(safe).toEqual(['GET', 'HEAD', 'OPTIONS', 'TRACE']);
  });

  it('has PUT and DELETE idempotent without being safe -- the converse fails', () => {
    for (const method of ['PUT', 'DELETE'] as HttpMethod[]) {
      expect(isIdempotent(method)).toBe(true);
      expect(isSafe(method)).toBe(false);
    }
  });

  it('leaves POST and PATCH neither safe nor idempotent', () => {
    for (const method of ['POST', 'PATCH'] as HttpMethod[]) {
      expect(isSafe(method)).toBe(false);
      expect(isIdempotent(method)).toBe(false);
    }
  });

  it('caches GET and HEAD by default and nothing else', () => {
    const cacheable = HTTP_METHODS.filter(isCacheableByDefault);
    expect(cacheable).toEqual(['GET', 'HEAD']);
  });

  it('places POST between the two, not on either side of the boundary', () => {
    expect(methodSemantics('POST').cacheability).toBe('explicit-freshness-only');
    expect(methodSemantics('PUT').cacheability).toBe('not-cacheable');
    expect(methodSemantics('GET').cacheability).toBe('cacheable');
  });

  it('forbids content on TRACE and CONNECT', () => {
    expect(methodSemantics('TRACE').requestContent).toBe('forbidden');
    expect(methodSemantics('CONNECT').requestContent).toBe('forbidden');
  });
});

describe('status classes', () => {
  it('derives the class from the first digit, including for unknown codes', () => {
    expect(statusClass(100)).toBe('informational');
    expect(statusClass(200)).toBe('successful');
    expect(statusClass(304)).toBe('redirection');
    expect(statusClass(418)).toBe('client-error');
    expect(statusClass(499)).toBe('client-error');
    expect(statusClass(599)).toBe('server-error');
  });

  it('agrees with the class recorded in every table row', () => {
    for (const entry of STATUS_SEMANTICS) {
      expect(entry.class).toBe(statusClass(entry.code));
    }
  });

  it('lists no code twice', () => {
    const codes = STATUS_SEMANTICS.map((entry) => entry.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('cites only current RFCs', () => {
    for (const entry of STATUS_SEMANTICS) {
      expect(entry.rfc).not.toMatch(/RFC 72\d\d|RFC 2616/);
    }
  });

  it('reads back a reason-phrase, and copes with a code it has never seen', () => {
    expect(reasonPhrase(404)).toBe('Not Found');
    expect(describeStatus(404)).toBe('404 Not Found');
    expect(reasonPhrase(499)).toBe('');
    expect(describeStatus(499)).toBe('499');
    expect(statusSemantics(499)).toBeUndefined();
  });
});

describe('heuristic cacheability', () => {
  it('matches the RFC 9110 s15.1 list exactly', () => {
    const heuristic = STATUS_SEMANTICS.filter((e) => e.heuristicallyCacheable).map(
      (e) => e.code,
    );
    expect(heuristic).toEqual([
      200, 203, 204, 206, 300, 301, 308, 404, 405, 410, 414, 501,
    ]);
  });

  it('separates the two permanent redirects from the two temporary ones', () => {
    expect(isHeuristicallyCacheable(301)).toBe(true);
    expect(isHeuristicallyCacheable(308)).toBe(true);
    expect(isHeuristicallyCacheable(302)).toBe(false);
    expect(isHeuristicallyCacheable(307)).toBe(false);
  });

  it('does not guess for an unknown code', () => {
    expect(isHeuristicallyCacheable(499)).toBe(false);
  });
});

describe('which responses may carry content', () => {
  it('treats 1xx as interim and everything from 200 up as final', () => {
    expect(isFinalStatus(100)).toBe(false);
    expect(isFinalStatus(103)).toBe(false);
    expect(isFinalStatus(200)).toBe(true);
  });

  it('forbids content on 1xx, 204, and 304', () => {
    expect(forbidsContent(100)).toBe(true);
    expect(forbidsContent(204)).toBe(true);
    expect(forbidsContent(304)).toBe(true);
    expect(forbidsContent(200)).toBe(false);
    expect(forbidsContent(404)).toBe(false);
  });

  it('sends no content for HEAD, whatever the status says', () => {
    expect(allowsContent('HEAD', 200)).toBe(false);
    expect(allowsContent('GET', 200)).toBe(true);
    expect(allowsContent('GET', 304)).toBe(false);
  });

  it('sends no content on a successful CONNECT -- the tunnel takes over', () => {
    expect(allowsContent('CONNECT', 200)).toBe(false);
    expect(allowsContent('CONNECT', 502)).toBe(true);
  });
});

describe('redirects', () => {
  it('counts 301, 302, 303, 307, and 308 as redirects', () => {
    for (const code of [301, 302, 303, 307, 308]) {
      expect(isRedirect(code)).toBe(true);
    }
  });

  it('does not count 304, which is a cache answer and carries no Location', () => {
    expect(isRedirect(304)).toBe(false);
    expect(redirectMethodRule(304)).toBeUndefined();
    expect(statusClass(304)).toBe('redirection');
  });

  it('records which codes are permanent', () => {
    expect([301, 308].every(isPermanentRedirect)).toBe(true);
    expect([302, 303, 307].some(isPermanentRedirect)).toBe(false);
  });

  it('preserves the method on 307 and 308', () => {
    expect(redirectMethodRule(307)).toBe('preserved');
    expect(redirectMethodRule(308)).toBe('preserved');
    expect(methodAfterRedirect('POST', 307)).toBe('POST');
    expect(methodAfterRedirect('POST', 308)).toBe('POST');
  });

  it('turns a POST into a GET at 301, 302, and 303, as browsers do', () => {
    expect(methodAfterRedirect('POST', 301)).toBe('GET');
    expect(methodAfterRedirect('POST', 302)).toBe('GET');
    expect(methodAfterRedirect('POST', 303)).toBe('GET');
    expect(redirectMethodRule(303)).toBe('rewritten-to-get');
    expect(redirectMethodRule(302)).toBe('rewritten-in-practice');
  });

  it('never rewrites HEAD to GET -- headers-only stays headers-only', () => {
    expect(methodAfterRedirect('HEAD', 302)).toBe('HEAD');
    expect(methodAfterRedirect('HEAD', 303)).toBe('HEAD');
  });

  it('leaves the method alone for a status that is not a redirect', () => {
    expect(methodAfterRedirect('POST', 200)).toBe('POST');
  });

  it('reads the Location field a redirect points at', () => {
    const moved = response({
      status: 301,
      reason: 'Moved Permanently',
      headers: [header('location', '/new')],
    });
    expect(redirectTarget(moved)).toBe('/new');
    expect(redirectTarget(response({ status: 200 }))).toBeUndefined();
  });
});
