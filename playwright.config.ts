import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration (phase 14, section 1).
 *
 * ## Against a production build, not the dev server
 *
 * `smoke.spec.ts` fails a route that logs a console error, and a dev server logs plenty
 * that a shipped page never will -- hydration diagnostics, Fast Refresh chatter, the
 * `<Suspense>` warnings Turbopack prints while a chunk is still compiling. Asserting
 * "no console errors" against that would mean an allowlist of exceptions long enough to
 * hide a real one. `next build && next start` is also what Vercel serves, so a route
 * that only breaks when it is statically rendered breaks here too.
 *
 * The cost is a build per run. `reuseExistingServer` outside CI is the escape hatch:
 * start `npx next start --port 3100` yourself once and every subsequent `npx playwright
 * test` attaches to it.
 *
 * ## Port 3100
 *
 * Not 3000. `npm run dev` lives there, and an e2e run that silently attached to a dev
 * server would quietly undo the paragraph above.
 */

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const LOCAL_URL = `http://127.0.0.1:${PORT}`;

/**
 * ## Running against a deployment instead of a local build
 *
 * `PLAYWRIGHT_BASE_URL=https://<host> npx playwright test e2e/security.spec.ts` points
 * the suite at something already running and starts no server of its own. That is the
 * middle step of the CSP rollout in `.env.example`: deploy a preview with
 * `CSP_MODE=report-only`, run the security spec against it to prove the policy is clean
 * while a violation still cannot break anything, then enforce.
 *
 * Only `security.spec.ts` is really portable this way. `smoke` and `a11y` will pass
 * against a deployment too, but `modules.spec.ts` plays every scenario to completion
 * over the public internet, which is slow enough to be a bad idea rather than a wrong
 * one.
 */
const DEPLOYED_URL = process.env.PLAYWRIGHT_BASE_URL?.replace(/\/+$/, '');
const BASE_URL = DEPLOYED_URL || LOCAL_URL;

export default defineConfig({
  testDir: './e2e',
  /* Every spec here drives a browser; none of them shares state with another. */
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  /*
   * Generous, deliberately. `modules.spec.ts` plays a scenario to its end at 4x, and the
   * longest run in the product is a page load with a cold cache; a timeout tuned to the
   * fastest module would turn a slow CI runner into a flake.
   */
  timeout: 90_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  // Nothing to start when the target is somewhere else; `undefined` is how Playwright
  // is told so, and it is the difference between testing a deployment and rebuilding
  // the app in order to ignore it.
  webServer: DEPLOYED_URL
    ? undefined
    : {
        command: `npm run build && npx next start --port ${PORT}`,
        url: LOCAL_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
});
