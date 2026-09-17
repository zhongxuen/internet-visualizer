import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { playheadMs, scrollsSideways, transport } from './helpers';
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
 * reason the `modules/` specs share one contract: nine modules render the same view, so a keyboard
 * regression in it is a regression in all nine.
 */

/** The module the interaction tests drive. First in registry order, so: Network Map. */
const MODULE = SIMULATING_MODULES[0]!;

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

  test('every step marker is a tab stop that seeks', async ({ page }) => {
    await page.goto(MODULE.route);

    // The markers sit on their own rail above the track, as buttons, precisely so they
    // are reachable without dragging anything.
    const markers = page.getByRole('button', { name: /^Step \d+, / });
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

test('the current step is announced in a live region', async ({ page }) => {
  await page.goto(MODULE.route);

  /*
   * `role="status"` is `aria-live="polite"`; asserting the role rather than the attribute
   * is asserting what a screen reader actually acts on. `StepCaption` -- the visible
   * form of what was `PhaseAnnouncer` -- renders exactly one per view, and it must be the
   * only thing shouting: a second live region fed by the playhead would make both useless.
   */
  const status = page.locator('main [role="status"]');
  await expect(status).toHaveCount(1);
  // Visible, now: the caption is for everyone, not only for a screen reader.
  await expect(status).toBeVisible();

  // Before the first play it asks the story's question, or says how to start.
  const before = (await status.textContent()) ?? '';
  expect(before).toMatch(/\?$|^Press Play to watch it happen/);

  const next = transport(page).getByRole('button', { name: 'Next step', exact: true });
  await next.click();
  await next.click();

  await expect
    .poll(() => status.textContent(), {
      message: 'stepping should change what the live region says',
    })
    .not.toBe(before);

  await expect(status).toHaveText(/^Step \d+ of \d+/);
});

test('"How to use this page" opens on ?, closes on Escape, and returns focus', async ({
  page,
}) => {
  await page.goto(MODULE.route);
  await expect(page.locator('.react-flow')).toBeVisible();

  const help = page.getByRole('button', { name: 'How to use this page' });
  await help.focus();
  await page.keyboard.press('?');

  const dialog = page.getByRole('dialog', { name: 'How to use this page' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Keyboard shortcuts')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(help).toBeFocused();
});

test('the transport stays in reach while the stage is on screen', async ({ page }) => {
  await page.goto(MODULE.route);
  await expect(page.locator('.react-flow')).toBeVisible();

  // Scrolled so the canvas is in view and the bar's own place, under it, is not.
  await page
    .locator('.react-flow')
    .evaluate((canvas) => canvas.scrollIntoView({ block: 'start' }));
  const play = transport(page).getByRole('button', { name: 'Play', exact: true });
  await expect(play).toBeInViewport({ ratio: 1 });

  const box = await play.boundingBox();
  expect(box!.height, 'Play is a primary control, at least 44px').toBeGreaterThanOrEqual(
    44,
  );
});

test.describe('a list view of the canvas, reachable without a pointer', () => {
  test('the topology is readable and selectable from the keyboard', async ({ page }) => {
    await page.goto(MODULE.route);
    await expect(page.locator('.react-flow')).toBeVisible();

    const summary = page.locator('summary', { hasText: 'The map as a list' });
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
     * The point of the list: choosing a machine here fills the same Details panel a click on
     * the diagram fills. Two representations, one selection -- not a read-only summary
     * that leaves a keyboard user unable to ask for detail.
     */
    const first = machines.first();
    const label = (await first.innerText()).split('\n')[0]!.trim();
    await first.press('Enter');

    await expect(first).toHaveAttribute('aria-pressed', 'true');

    const inspector = page.getByRole('region', { name: 'Details', exact: true });
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

      expect(
        await scrollsSideways(page),
        `${route.path} scrolls horizontally at 200% zoom`,
      ).toBe(false);
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

test.describe('layout on a 390px phone', () => {
  /*
   * The narrowest screen the Stage is designed for (uiux-spec.md §5.3, "Mobile"): the
   * story select, a 60svh canvas, the Steps / Details / Go deeper tabs and a sticky
   * transport all have to fit across it without the page scrolling sideways.
   */
  test.use({ viewport: { width: 390, height: 844 } });

  for (const route of ROUTES) {
    test(`${route.name} fits 390px without sideways scrolling`, async ({ page }) => {
      await page.goto(route.path);
      await page.waitForLoadState('networkidle');

      expect(
        await scrollsSideways(page),
        `${route.path} scrolls horizontally at 390px`,
      ).toBe(false);
    });
  }
});
