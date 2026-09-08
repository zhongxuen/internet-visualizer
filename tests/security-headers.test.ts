import { describe, expect, it } from 'vitest';

import {
  contentSecurityPolicy,
  cspModeFromEnv,
  PERMISSIONS_POLICY,
  securityHeaders,
  STRICT_TRANSPORT_SECURITY,
} from '@/lib/securityHeaders';

/**
 * The header policy, asserted rather than described.
 *
 * `e2e/security.spec.ts` proves the headers reach a browser; this proves they say the
 * right thing. The split matters because the e2e suite needs a production build and
 * five minutes, so it is not where you want to find out that a directive was dropped.
 *
 * Most of what follows is deliberately a restatement of the policy in a second voice.
 * That is the value: a directive cannot be quietly removed, because removing it here
 * too is an edit someone has to justify in a diff.
 */

/** Parse the policy string into `directive -> sources`. */
function directives(policy: string): Record<string, string[]> {
  const parsed: Record<string, string[]> = {};
  for (const clause of policy.split(';')) {
    const [name, ...sources] = clause.trim().split(/\s+/).filter(Boolean);
    if (name) parsed[name] = sources;
  }
  return parsed;
}

describe('contentSecurityPolicy', () => {
  it('confines every network destination to this origin', () => {
    // The browser-level form of "every module is a client-side simulation". If this
    // ever gains a host, a module can call it -- so it must not gain one.
    expect(directives(contentSecurityPolicy())['connect-src']).toEqual(["'self'"]);
  });

  it('refuses framing, plugins and base-tag rewriting outright', () => {
    const parsed = directives(contentSecurityPolicy());

    expect(parsed['frame-ancestors']).toEqual(["'none'"]);
    expect(parsed['frame-src']).toEqual(["'none'"]);
    expect(parsed['object-src']).toEqual(["'none'"]);
    expect(parsed['base-uri']).toEqual(["'self'"]);
    expect(parsed['form-action']).toEqual(["'self'"]);
  });

  it('allows no external origin in any fetch directive', () => {
    // The product self-hosts its fonts and has no third-party script, stylesheet or
    // image. A scheme or host appearing in any of these would be a new dependency
    // arriving without anyone deciding to take it on.
    const parsed = directives(contentSecurityPolicy());

    for (const [name, sources] of Object.entries(parsed)) {
      for (const source of sources) {
        expect(source, `${name} allows ${source}`).not.toMatch(/^https?:\/\//);
      }
    }
  });

  it('does not permit eval, and upgrades insecure requests', () => {
    const policy = contentSecurityPolicy();

    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).toContain('upgrade-insecure-requests');
  });

  it('loosens exactly two directives for the dev server', () => {
    const shipped = directives(contentSecurityPolicy());
    const dev = directives(contentSecurityPolicy({ development: true }));

    expect(dev['script-src']).toContain("'unsafe-eval'");
    expect(dev['connect-src']).toEqual(expect.arrayContaining(['ws:', 'wss:']));

    // `upgrade-insecure-requests` is the third difference and is a subtraction rather
    // than a loosening: it is dropped because a dev server speaks http, and keeping it
    // would rewrite every asset request to a port nothing is listening on.
    expect(dev['upgrade-insecure-requests']).toBeUndefined();

    // Nothing else moved.
    const changed = Object.keys(shipped).filter(
      (name) => shipped[name]?.join(' ') !== dev[name]?.join(' '),
    );
    expect(changed.sort()).toEqual([
      'connect-src',
      'script-src',
      'upgrade-insecure-requests',
    ]);
  });

  it('adds a report-uri only when one is configured', () => {
    expect(contentSecurityPolicy()).not.toContain('report-uri');
    expect(contentSecurityPolicy({ reportUri: '/csp-report' })).toContain(
      'report-uri /csp-report',
    );
  });
});

describe('securityHeaders', () => {
  const byKey = (options?: Parameters<typeof securityHeaders>[0]) =>
    Object.fromEntries(securityHeaders(options).map(({ key, value }) => [key, value]));

  it('carries every header section 7 of the phase doc names', () => {
    const headers = byKey();

    expect(headers['Content-Security-Policy']).toBeTruthy();
    expect(headers['Strict-Transport-Security']).toBe(STRICT_TRANSPORT_SECURITY);
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['Permissions-Policy']).toBe(PERMISSIONS_POLICY);
  });

  it('denies camera, microphone and geolocation with an empty allowlist', () => {
    for (const feature of ['camera', 'microphone', 'geolocation']) {
      expect(PERMISSIONS_POLICY).toContain(`${feature}=()`);
    }
  });

  it('states HSTS in seconds, for at least a year, across subdomains', () => {
    const maxAge = Number(/max-age=(\d+)/.exec(STRICT_TRANSPORT_SECURITY)?.[1]);

    expect(maxAge).toBeGreaterThanOrEqual(31_536_000);
    expect(STRICT_TRANSPORT_SECURITY).toContain('includeSubDomains');
  });

  it('renames the header in report-only mode and changes nothing else', () => {
    const reporting = byKey({ mode: 'report-only' });

    expect(reporting['Content-Security-Policy']).toBeUndefined();
    expect(reporting['Content-Security-Policy-Report-Only']).toBe(
      contentSecurityPolicy(),
    );
    expect(reporting['Strict-Transport-Security']).toBe(STRICT_TRANSPORT_SECURITY);
  });
});

describe('cspModeFromEnv', () => {
  it('reports only when asked, case- and whitespace-insensitively', () => {
    expect(cspModeFromEnv({ CSP_MODE: 'report-only' })).toBe('report-only');
    expect(cspModeFromEnv({ CSP_MODE: '  Report-Only ' })).toBe('report-only');
  });

  it('enforces for anything else, including a typo or an unset variable', () => {
    // The direction the default has to fail in: an environment that never set the
    // variable, or set it wrong, must end up protected rather than merely observed.
    expect(cspModeFromEnv({})).toBe('enforce');
    expect(cspModeFromEnv({ CSP_MODE: '' })).toBe('enforce');
    expect(cspModeFromEnv({ CSP_MODE: 'reportonly' })).toBe('enforce');
    expect(cspModeFromEnv({ CSP_MODE: 'enforce' })).toBe('enforce');
  });
});
