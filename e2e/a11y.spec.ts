import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { NOT_FOUND_ROUTES, ROUTES, SIMULATING_MODULES } from './routes';

/**
 * axe-core on every URL this product serves, failing on serious and critical only.
 *
 * ## Why the severity floor
 *
 * axe reports four impact levels and only the top two are defects a user hits: a
 * `serious` violation is something a person using a screen reader or a keyboard cannot
 * work around (an unlabelled control, text below 4.5:1, a landmark that swallows
 * content), and `critical` is something that stops them entirely. `moderate` and `minor`
 * are largely conventions -- "this list has a non-`li` child", "this region has no
 * heading" -- and gating on them would make the suite a style checker that the first
 * legitimate exception turns off. The section-2 acceptance criterion is exactly this
 * line: *zero serious/critical axe violations on every route*.
 *
 * ## Why every route, not a sample
 *
 * Thirty-three lessons are thirty-three different compositions of MDX and embedded
 * simulations, and the one that renders a table without a header row is not the one
 * anybody would have sampled. `ROUTES` is derived from the registry and
 * `allLessonParams()` (see `routes.ts`), so a lesson added tomorrow is scanned tomorrow.
 *
 * ## What axe cannot see, and where that is covered instead
 *
 * A static scan cannot tell you that the timeline is reachable by keyboard, that a phase
 * change is announced, or that the topology has a non-pointer alternative. Those are the
 * manual items on the section-2 checklist and they are asserted in `a11y-manual.spec.ts`
 * beside this file, because "axe is green" and "a keyboard user can drive it" are
 * different claims.
 *
 * Heading hierarchy is checked here rather than there because it costs one `evaluate` on
 * a page this test has already loaded -- and because axe deliberately will not check it:
 * `heading-order` is a `moderate` rule, below this file's severity floor, and
 * `page-has-heading-one` is best-practice rather than WCAG. The checklist asks for both
 * anyway, so they are asserted directly.
 */

/** WCAG 2.1 AA, which is the standard the checklist's contrast numbers come from. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

interface Violation {
  readonly id: string;
  readonly impact?: string | null;
  readonly help: string;
  readonly nodes: readonly {
    readonly target: unknown[];
    readonly failureSummary?: string;
  }[];
}

/** Everything axe found at `serious` or above, formatted so a failure is actionable. */
function blocking(violations: readonly Violation[]): string[] {
  return violations
    .filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    )
    .map((violation) => {
      const where = violation.nodes
        .slice(0, 4)
        .map((node) => `      - ${JSON.stringify(node.target)}`)
        .join('\n');
      const more =
        violation.nodes.length > 4
          ? `\n      ... and ${violation.nodes.length - 4} more`
          : '';
      return `  [${violation.impact}] ${violation.id}: ${violation.help}\n${where}${more}`;
    });
}

async function scan(page: Page, context?: string) {
  const builder = new AxeBuilder({ page }).withTags(TAGS);
  const results = await builder.analyze();
  const failures = blocking(results.violations as unknown as Violation[]);
  expect(
    failures,
    `${context ?? page.url()} has serious/critical axe violations:\n${failures.join('\n')}`,
  ).toEqual([]);
}

/**
 * Exactly one `h1`, and no level skipped on the way down.
 *
 * A screen reader's heading list is the table of contents for a page, and a skipped level
 * reads as a missing chapter: `h2` straight to `h4` says "there is a section here you
 * cannot see". This is the check that catches a component reused at the wrong depth --
 * a panel body written as `h4` when the panel's own title is the `h2` above it.
 *
 * Headings inside an `aria-hidden` subtree are excluded because they are not in the
 * accessibility tree at all, so they cannot be skipped past.
 */
async function expectSaneHeadings(page: Page, where: string): Promise<void> {
  const headings = await page.evaluate(() =>
    [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')]
      .filter((element) => element.closest('[aria-hidden="true"]') === null)
      .map((element) => ({
        level: Number(element.tagName[1]),
        text: (element.textContent ?? '').trim().slice(0, 60),
      })),
  );

  expect(
    headings.filter((heading) => heading.level === 1),
    `${where} should have exactly one h1`,
  ).toHaveLength(1);

  const skips = headings
    .map((heading, index) => ({ heading, previous: headings[index - 1] }))
    .filter(
      ({ heading, previous }) =>
        previous !== undefined && heading.level > previous.level + 1,
    )
    .map(
      ({ heading, previous }) =>
        `h${previous!.level} -> h${heading.level} at "${heading.text}"`,
    );

  expect(skips, `${where} skips a heading level`).toEqual([]);
}

for (const route of ROUTES) {
  test(`${route.name} (${route.path}) has no serious or critical violations`, async ({
    page,
  }) => {
    await page.goto(route.path);
    /*
     * Contrast is computed from painted pixels, so the scan has to wait for the page to
     * have finished painting them -- a module route mounts React Flow, and a node still
     * mid-hydration has no computed colour for axe to measure.
     */
    await page.waitForLoadState('networkidle');
    await scan(page, route.path);
    await expectSaneHeadings(page, route.path);
  });
}

/**
 * The 404 pages get scanned too.
 *
 * They are the one kind of page nobody navigates to on purpose and everybody eventually
 * lands on, which is exactly the combination that leaves a heading level skipped or a
 * link at 3:1 for a year. The root one also renders the whole module grid, so it is a
 * second scan of every card.
 */
for (const route of NOT_FOUND_ROUTES) {
  test(`${route.name} (${route.path}) has no serious or critical violations`, async ({
    page,
  }) => {
    await page.goto(route.path);
    await page.waitForLoadState('networkidle');
    await scan(page, route.path);
    await expectSaneHeadings(page, route.path);
  });
}

/**
 * A module mid-run, not just at rest.
 *
 * Every route above is scanned in its initial state, where a simulation has drawn its
 * topology and nothing else. The states that only exist once something has been clicked
 * -- an inspector holding a selected machine, a phase marked current, a run sitting at
 * `ended` -- are where a contrast or naming regression is most likely to hide, because
 * they are the states nobody looks at in a screenshot. One module is enough: they all
 * render the same `SimulationView`.
 */
test('a module in a played, selected state stays clean', async ({ page }) => {
  const [meta] = SIMULATING_MODULES;
  await page.goto(meta!.route);
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: '4x', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play again' })).toBeVisible({
    timeout: 60_000,
  });

  await page.locator('.react-flow__node').first().click();

  await scan(page, `${meta!.route} (played, node selected)`);
});
