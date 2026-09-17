import { expect, test } from '@playwright/test';

import { START_HERE_DESTINATION } from '@/app/start/destination';

import { NOT_FOUND_ROUTES, ROUTES, SIMULATING_MODULES, watchConsole } from './routes';

/**
 * Every route in the registry loads, and none of them logs an error.
 *
 * The cheapest test in the suite and the one most likely to catch a real regression:
 * a server component that throws, a client component that reads `window` during render,
 * a lesson whose MDX imports something that no longer exists. None of those show up in
 * a unit test, because none of them happen until Next assembles the page.
 *
 * The assertion is deliberately blunt -- status 200, one `h1`, zero console errors --
 * because the depth belongs in `modules.spec.ts`. What this file guarantees is coverage:
 * it visits *every* URL, including all thirty-three lessons, which no other test does.
 */

for (const route of ROUTES) {
  test(`${route.name} (${route.path}) loads clean`, async ({ page }) => {
    const browserConsole = watchConsole(page);

    const response = await page.goto(route.path);
    expect(response?.status(), `${route.path} should serve a 200`).toBe(200);

    /*
     * One `h1`, always. It is the accessibility checklist item from section 2 that is
     * cheap enough to assert here rather than wait for the axe pass, and it doubles as
     * proof the page rendered its content and not just the shell: `main` exists in the
     * root layout whether or not the route below it produced anything.
     */
    await expect(page.locator('main h1')).toHaveCount(1);

    /*
     * Give client components a beat to mount and run their effects. Without this the
     * check races the page: `goto` resolves on `load`, and React hydrates after it, so
     * an error thrown during hydration would be recorded a few milliseconds too late.
     */
    await page.waitForLoadState('networkidle');

    expect(browserConsole.errors, `${route.path} logged browser errors`).toEqual([]);
  });
}

/**
 * The same three assertions for the two pages that must *not* serve a 200.
 *
 * A 404 that renders is easy to get wrong in a way nothing else catches: the status can
 * be right while the page is Next's built-in default, or the page can be this app's
 * while the status is 200 and every crawler indexes a dead link. Both halves are checked.
 */
for (const route of NOT_FOUND_ROUTES) {
  test(`${route.name} (${route.path}) serves this app's 404`, async ({ page }) => {
    const browserConsole = watchConsole(page);

    const response = await page.goto(route.path);
    expect(response?.status(), `${route.path} should serve a 404`).toBe(404);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(route.expects);
    await expect(page.locator('main h1')).toHaveCount(1);

    await page.waitForLoadState('networkidle');

    /*
     * Chromium logs the document's own non-2xx status as a console error, so these two
     * routes cannot be held to the empty-array assertion the 200s are held to. Filtered
     * here rather than added to `IGNORED_CONSOLE` in `routes.ts`: globally, that pattern
     * would also swallow a *missing asset* on a page that loaded fine, which is a real
     * defect and is exactly what the watcher exists to catch. Everything else the page
     * logs still fails the test.
     */
    const unexpected = browserConsole.errors.filter(
      (message) => !/Failed to load resource.*404/i.test(message),
    );
    expect(unexpected, `${route.path} logged browser errors`).toEqual([]);
  });
}

/**
 * `/start` is a redirect, not a page, so it is not in `ROUTES` (whose test asserts a 200)
 * and not in the sitemap. What it has to do is send "Start here" to the first lesson of
 * the First steps track, and say so with a redirect status rather than a page that
 * happens to link there.
 *
 * Asserted on the response itself, with redirects not followed, so the check is about
 * where `/start` points and not about whether the lesson it points at has been written
 * yet.
 */
test('/start redirects to the first lesson of First steps', async ({ request }) => {
  const response = await request.get('/start', { maxRedirects: 0 });

  expect([307, 308]).toContain(response.status());
  expect(new URL(response.headers().location ?? '', 'http://x').pathname).toBe(
    START_HERE_DESTINATION,
  );
});

/**
 * The module header -- breadcrumb, title, question, level, safety badge and the words
 * the page uses -- is at most 140px tall on a 1366px-wide screen, so the simulation starts
 * above the fold on a common laptop (uiux-spec.md §4, "one obvious next action").
 */
test.describe('module header', () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  for (const meta of SIMULATING_MODULES) {
    test(`${meta.id} fits in 140px at 1366 wide`, async ({ page }) => {
      await page.goto(meta.route);
      await page.waitForLoadState('networkidle');

      const header = page.locator('[data-module-header]');
      await expect(header).toBeVisible();
      const box = await header.boundingBox();
      // From the bottom of the navigation bar, so the chrome's own top padding counts.
      const nav = await page.locator('body > header, header').first().boundingBox();
      const top = (nav?.y ?? 0) + (nav?.height ?? 0);
      expect(
        box!.y + box!.height - top,
        `${meta.route} header height`,
      ).toBeLessThanOrEqual(140);
    });
  }
});
