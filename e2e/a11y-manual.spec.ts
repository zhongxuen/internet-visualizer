import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { ROUTES, SIMULATING_MODULES } from './routes';

/**
 * The half of section 2's checklist that axe cannot answer.
 *
 * `a11y.spec.ts` runs the static scan. A static scan is blind to everything that only
 * exists while someone is *using* the page: whether the timeline can be driven from the
 * keyboard, whether a phase change is announced rather than merely drawn, whether the
 * topology can be read without a pointer, whether the layout survives 200% zoom. Each
 * test below is one line of the checklist in
 * `docs/implementation/14-quality-and-deployment.md`, section 2.
 *
 * Written against the shared `SimulationView` rather than per module, for the same
 * reason `modules.spec.ts` is: nine modules render the same view, so a keyboard
 * regression in it is a regression in all nine.
 */

/** The module the interaction tests drive. First in registry order, so: Network Map. */
const MODULE = SIMULATING_MODULES[0]!;

/** The timeline's position, in virtual milliseconds. */
async function playheadMs(page: Page): Promise<number> {
  return Number(
    await page.getByRole('slider', { name: 'Playback position' }).inputValue(),
  );
}

test.describe('keyboard traversal of the timeline', () => {
  test('the scrubber is a real slider its own arrow keys drive', async ({ page }) => {
    await page.goto(MODULE.route);

    const slider = page.getByRole('slider', { name: 'Playback position' });
    await slider.focus();
    await expect(slider).toBeFocused();

    /*
     * `ArrowRight` on a focused `<input type="range">` is the browser's, not ours:
     * `shouldIgnoreKey` hands the press back rather than also stepping a phase, so one
     * press moves one step and not two. That hand-back is the thing being tested --
     * without it the playhead would jump a whole chapter and the slider would be
     * unusable at fine grain.
     */
    const start = await playheadMs(page);
    await slider.press('ArrowRight');
    const stepped = await playheadMs(page);
    expect(stepped, 'ArrowRight should nudge the playhead forward').toBeGreaterThan(
      start,
    );

    await slider.press('ArrowLeft');
    expect(await playheadMs(page)).toBeCloseTo(start, 0);

    await slider.press('End');
    const end = await playheadMs(page);
    expect(end).toBeGreaterThan(stepped);

    await slider.press('Home');
    expect(await playheadMs(page)).toBe(0);
  });

  test('every phase marker is a tab stop that seeks', async ({ page }) => {
    await page.goto(MODULE.route);

    // The markers sit on their own rail above the track, as buttons, precisely so they
    // are reachable without dragging anything.
    const markers = page.getByRole('button', { name: /^Phase \d+, / });
    const count = await markers.count();
    expect(count, 'the run should mark its phases on the timeline').toBeGreaterThan(1);

    const last = markers.nth(count - 1);
    await last.focus();
    await expect(last).toBeFocused();
    await last.press('Enter');

    expect(
      await playheadMs(page),
      'activating the last phase marker should seek into the run',
    ).toBeGreaterThan(0);
  });

  test('playback is drivable from the keyboard with nothing focused', async ({
    page,
  }) => {
    await page.goto(MODULE.route);
    await expect(page.locator('.react-flow')).toBeVisible();

    // No focus anywhere: the state a page is in the moment it loads.
    await page.locator('body').click({ position: { x: 2, y: 2 } });

    await page.keyboard.press('End');
    expect(await playheadMs(page), 'End should jump to the end').toBeGreaterThan(0);

    await page.keyboard.press('Home');
    expect(await playheadMs(page)).toBe(0);

    await page.keyboard.press('ArrowRight');
    expect(
      await playheadMs(page),
      'the right arrow should step one phase forward',
    ).toBeGreaterThan(0);
  });
});

test('the current phase is announced in a live region', async ({ page }) => {
  await page.goto(MODULE.route);

  /*
   * `role="status"` is `aria-live="polite"`; asserting the role rather than the attribute
   * is asserting what a screen reader actually acts on. `PhaseAnnouncer` renders exactly
   * one per view, and it must be the only thing shouting -- a second live region fed by
   * the playhead would make both useless.
   */
  const status = page.locator('main [role="status"]');
  await expect(status).toHaveCount(1);

  const before = (await status.textContent()) ?? '';
  expect(before).toMatch(/phases in this run|Phase \d+ of \d+/);

  await page.getByRole('button', { name: 'Next phase' }).click();
  await page.getByRole('button', { name: 'Next phase' }).click();

  await expect
    .poll(() => status.textContent(), {
      message: 'stepping phases should change what the live region says',
    })
    .not.toBe(before);

  await expect(status).toHaveText(/^Phase \d+ of \d+: /);
});

test.describe('a list view of the canvas, reachable without a pointer', () => {
  test('the topology is readable and selectable from the keyboard', async ({ page }) => {
    await page.goto(MODULE.route);
    await expect(page.locator('.react-flow')).toBeVisible();

    const summary = page.locator('summary', { hasText: 'Topology as a list' });
    /*
     * Located by its summary rather than by role: Playwright's role engine does not map
     * `<details>` to `group`, so `getByRole('group')` finds nothing here even though a
     * screen reader sees one.
     */
    const list = page.locator('details').filter({ has: summary });

    // Open it the way a keyboard user would, rather than by clicking.
    await summary.focus();
    await expect(summary).toBeFocused();
    await summary.press('Enter');
    await expect(list).toHaveAttribute('open', '');

    // Both halves of the topology are present, as headings and as buttons.
    await expect(page.getByRole('heading', { name: 'Machines' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Links' })).toBeVisible();

    const machines = list.getByRole('list').first().getByRole('button');
    const drawn = await page.locator('.react-flow__node').count();
    expect(
      await machines.count(),
      'the list should hold exactly the machines the canvas drew',
    ).toBe(drawn);

    /*
     * The point of the list: choosing a machine here fills the same inspector a click on
     * the diagram fills. Two representations, one selection -- not a read-only summary
     * that leaves a keyboard user unable to ask for detail.
     */
    const first = machines.first();
    const label = (await first.innerText()).split('\n')[0]!.trim();
    await first.press('Enter');

    await expect(first).toHaveAttribute('aria-pressed', 'true');

    const inspector = page.getByRole('region', { name: 'Inspector', exact: true });
    await expect(inspector.getByText('Nothing selected')).toHaveCount(0);
    await expect(inspector).toContainText(label);
  });
});

test.describe('layout at 200% zoom', () => {
  /*
   * 200% zoom is a 640x512 CSS viewport on a 1280x1024 screen: the browser halves the
   * pixel budget and the page has to reflow into it. WCAG 1.4.10 is the rule being
   * checked -- content must not require scrolling in two directions -- and a diagram
   * product fails it easily, because a fixed-width canvas or a table that will not wrap
   * pushes the whole document sideways.
   */
  test.use({ viewport: { width: 640, height: 512 } });

  for (const route of ROUTES) {
    test(`${route.name} reflows without sideways scrolling`, async ({ page }) => {
      await page.goto(route.path);
      await page.waitForLoadState('networkidle');

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      // One pixel of slack for sub-pixel rounding in the layout engine.
      expect(
        scrollWidth,
        `${route.path} scrolls horizontally at 200% zoom`,
      ).toBeLessThanOrEqual(clientWidth + 1);
    });
  }

  test('a module route is still axe-clean at 200%', async ({ page }) => {
    await page.goto(MODULE.route);
    await page.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(
      results.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.help}`),
    ).toEqual([]);
  });
});
