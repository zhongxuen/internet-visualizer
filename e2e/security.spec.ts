import { expect, test, type Page } from '@playwright/test';

import { ROUTES } from './routes';

/**
 * The security headers, asserted where they actually have to be true: on a response
 * from a production build.
 *
 * `tests/security-headers.test.ts` checks what the policy *says*; nothing in it can
 * catch a header that is never sent. The two failures this file exists for are exactly
 * that shape and neither is hypothetical -- a `headers()` entry whose `source` pattern
 * misses a route, and a header that a platform strips or overwrites on the way out.
 *
 * ## The two halves
 *
 * **Presence** is checked on every URL the product serves, cheaply: `request.get()`
 * fetches a response without a browser rendering it, so the whole sweep -- home, ten
 * modules, the glossary, thirty-three lessons, the OG image and a diagnostics route --
 * costs about as much as one page load.
 *
 * **Compliance** -- does the policy break the product? -- is checked on a sample,
 * because it needs a real browser and every page in a given shape violates or does not
 * violate identically. The sample is one of each shape the product has: the home page,
 * a module with a React Flow canvas and a running animation, a lesson with an embedded
 * simulation inside MDX, and the glossary. A violation is collected through the
 * `securitypolicyviolation` DOM event rather than by reading the console, which is what
 * makes this test say the same thing in both modes: in report-only the browser fires
 * the event and renders anyway, so a policy can be proven clean *before* it is allowed
 * to break anything. That is the phase doc's "report-only first, then enforce", and the
 * rollout is written down in `.env.example`.
 */

const REQUIRED_HEADERS: readonly (readonly [string, RegExp])[] = [
  ['strict-transport-security', /max-age=\d{7,}/],
  ['x-content-type-options', /^nosniff$/],
  ['referrer-policy', /^strict-origin-when-cross-origin$/],
  ['permissions-policy', /camera=\(\)/],
  ['x-frame-options', /^DENY$/i],
];

/** The header carrying the policy, whichever mode the build was made in. */
function cspOf(headers: Record<string, string>): string | undefined {
  return (
    headers['content-security-policy'] ?? headers['content-security-policy-report-only']
  );
}

/** Every URL the product serves, plus the two that are not pages. */
const RESPONSES_UNDER_TEST = [
  ...ROUTES,
  { name: 'og:image', path: '/opengraph-image' },
  { name: 'sitemap', path: '/sitemap.xml' },
  { name: 'robots', path: '/robots.txt' },
  // A denial, deliberately: the headers have to be on the refusals too, and this is
  // the shape of response a caller who got the target wrong actually receives.
  { name: 'api:diagnostics', path: '/api/diagnostics/dns?target=&type=A' },
];

for (const route of RESPONSES_UNDER_TEST) {
  test(`${route.name} (${route.path}) carries the security headers`, async ({
    request,
  }) => {
    const response = await request.get(route.path, { maxRedirects: 0 });
    const headers = response.headers();

    for (const [name, pattern] of REQUIRED_HEADERS) {
      expect(headers[name], `${route.path} is missing ${name}`).toBeDefined();
      expect(headers[name], `${route.path} has an unexpected ${name}`).toMatch(pattern);
    }

    const csp = cspOf(headers);
    expect(csp, `${route.path} is missing a Content-Security-Policy`).toBeDefined();

    /*
     * The three directives that carry the product's own rules, rather than generic
     * hardening. `connect-src 'self'` is the browser-level form of "every module is a
     * client-side simulation": no module can reach an origin that is not this one,
     * whatever its code asks for.
     */
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");

    // Development loosens two directives. A build that shipped them would mean the
    // deployment was built with NODE_ENV=development, which is worth failing over.
    expect(csp).not.toContain("'unsafe-eval'");
  });
}

/**
 * The one violation the product knowingly produces, and why it is allowed through.
 *
 * zod compiles a validator with `new Function` when it can, and finds out whether it
 * can by evaluating `Function("")` inside a `try`/`catch`. Under this policy that
 * throws, zod catches it and runs interpreted (`jitless`) instead -- which is the
 * outcome a CSP-hardened environment wants and the reason the probe is written as a
 * probe. Nothing is broken by it; the browser simply reports every violation it sees,
 * handled or not.
 *
 * It is reported once per page, on the four module routes that validate typed input --
 * DNS Explorer, HTTP Explorer, API Visualizer and the Internet Simulator -- and would
 * also appear on Network Diagnostics if Live mode were used, since `guard.ts` validates
 * a target the same way.
 *
 * It is *not* silenced, for three reasons: silencing it would mean either
 * `'unsafe-eval'` (which would hand a real weapon to an injected script) or a
 * side-effect-only module calling `z.config({ jitless: true })` (which
 * `"sideEffects": ["*.css"]` in package.json permits the bundler to delete outright).
 * The third is that threading `{ jitless: true }` through every `.parse()` call is a
 * fix that silently stops working the first time someone adds a call and forgets. So it
 * is named here instead, and everything that is not exactly this still fails.
 */
const ZOD_JIT_PROBE = 'script-src blocked eval';

/**
 * Collect every CSP violation the page reports, from before the first script runs, and
 * drop the one above.
 */
async function watchCspViolations(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const violations: string[] = [];
    (window as unknown as { __csp: string[] }).__csp = violations;
    document.addEventListener('securitypolicyviolation', (event) => {
      violations.push(`${event.violatedDirective} blocked ${event.blockedURI}`);
    });
  });

  return async () => {
    const all = await page.evaluate(
      () => (window as unknown as { __csp?: string[] }).__csp ?? [],
    );
    return all.filter((entry) => entry !== ZOD_JIT_PROBE);
  };
}

const COMPLIANCE_SAMPLE: readonly { name: string; path: string }[] = [
  { name: 'home', path: '/' },
  // The heaviest page in the product: React Flow, `motion`, and a playing animation.
  { name: 'module:packet-journey', path: '/packet-journey' },
  // A zod route, so the one known violation stays inside the assertion rather than
  // outside the sample. Leaving these out is how it went unnoticed the first time.
  { name: 'module:internet-simulator', path: '/internet-simulator' },
  { name: 'module:dns-explorer', path: '/dns-explorer' },
  // MDX with a real simulation embedded in it, which is a lazily-loaded chunk.
  { name: 'lesson', path: '/learn/internet-foundations/what-is-a-network' },
  { name: 'glossary', path: '/learn/glossary' },
];

for (const route of COMPLIANCE_SAMPLE) {
  test(`${route.name} (${route.path}) violates nothing in the policy`, async ({
    page,
  }) => {
    const violations = await watchCspViolations(page);

    await page.goto(route.path);
    await page.waitForLoadState('networkidle');

    expect(await violations(), `${route.path} broke the policy`).toEqual([]);
  });
}

/**
 * The policy holds while the product is actually being used, not only at load.
 *
 * Playback is where a violation would appear late: the canvas chunk arrives through
 * `next/dynamic` after hydration, `motion` writes inline styles for every frame, and
 * `worker-src`/`blob:` are only exercised once something animates. Loading the page and
 * declaring victory would miss all three.
 */
test('a scenario runs to completion without a CSP violation', async ({ page }) => {
  const violations = await watchCspViolations(page);

  await page.goto('/packet-journey');
  await page.getByRole('button', { name: '4x', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play again' })).toBeVisible({
    timeout: 60_000,
  });

  expect(await violations()).toEqual([]);
});

/**
 * The known violation is still the known violation.
 *
 * The filter above would hide a second `script-src blocked eval` from a different and
 * less benign source just as happily as it hides zod's probe. This is the other half:
 * on a zod route the report is expected exactly once, and on a route with no zod it is
 * expected not at all. Either count changing is worth looking at -- if it disappears,
 * zod stopped probing and the filter is now dead code that could mask something.
 */
test('the zod JIT probe is the only eval report, and only on zod routes', async ({
  page,
}) => {
  const raw = async () =>
    page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);

  await page.addInitScript(() => {
    const violations: string[] = [];
    (window as unknown as { __csp: string[] }).__csp = violations;
    document.addEventListener('securitypolicyviolation', (event) => {
      violations.push(`${event.violatedDirective} blocked ${event.blockedURI}`);
    });
  });

  await page.goto('/internet-simulator');
  await page.waitForLoadState('networkidle');
  expect(await raw()).toEqual([ZOD_JIT_PROBE]);

  // Network Map takes no typed input, so it has no zod and must report nothing at all.
  await page.goto('/network-map');
  await page.waitForLoadState('networkidle');
  expect(await raw()).toEqual([]);
});

/**
 * The claim the whole product rests on, checked in a browser rather than argued for.
 *
 * "Every module is a deterministic client-side simulation, except Network Diagnostics'
 * Live mode" is a sentence in the footer, the README and the home page. `connect-src
 * 'self'` is what makes it enforceable: a simulated module cannot reach another origin
 * even if its code asked to, because the browser refuses before a socket is opened. So
 * this test does what a compromised or careless module would do -- `fetch` and
 * `WebSocket` to somewhere else -- and asserts both are refused.
 *
 * `example.com` is the IANA-reserved documentation domain, and no request to it leaves
 * the machine: the point is that the attempt never becomes a connection.
 */
test('a simulated module cannot reach another origin, even if it tries', async ({
  page,
  baseURL,
}) => {
  // From `baseURL`, not a hardcoded localhost: this spec is the one that is meant to be
  // pointed at a deployment (see `playwright.config.ts`), and a same-origin check that
  // only recognises 127.0.0.1 reports every legitimate request as a leak the moment it
  // is.
  const origin = new URL(baseURL ?? 'http://127.0.0.1:3100').origin;

  const offOrigin: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) {
      offOrigin.push(url);
    }
  });

  await page.goto('/packet-journey');
  await page.waitForLoadState('networkidle');

  const fetched = await page.evaluate(async () => {
    try {
      await fetch('https://example.com/probe', { mode: 'no-cors' });
      return 'allowed';
    } catch {
      return 'blocked';
    }
  });
  const socket = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        try {
          const ws = new WebSocket('wss://example.com/probe');
          ws.onopen = () => resolve('allowed');
          ws.onerror = () => resolve('blocked');
          setTimeout(() => resolve('blocked'), 3000);
        } catch {
          resolve('blocked');
        }
      }),
  );

  expect(fetched).toBe('blocked');
  expect(socket).toBe('blocked');

  // And nothing the page did of its own accord left this origin either.
  expect(offOrigin.filter((url) => !url.includes('example.com'))).toEqual([]);
});
