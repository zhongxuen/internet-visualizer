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

/** Collect every CSP violation the page reports, from before the first script runs. */
async function watchCspViolations(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const violations: string[] = [];
    (window as unknown as { __csp: string[] }).__csp = violations;
    document.addEventListener('securitypolicyviolation', (event) => {
      violations.push(`${event.violatedDirective} blocked ${event.blockedURI}`);
    });
  });

  return async () =>
    page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
}

const COMPLIANCE_SAMPLE: readonly { name: string; path: string }[] = [
  { name: 'home', path: '/' },
  // The heaviest page in the product: React Flow, `motion`, and a playing animation.
  { name: 'module:packet-journey', path: '/packet-journey' },
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
