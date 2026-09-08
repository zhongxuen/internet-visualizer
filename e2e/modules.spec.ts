import { expect, test, type Locator, type Page } from '@playwright/test';

import { SIMULATING_MODULES, watchConsole } from './routes';

/**
 * The interaction contract every simulating module shares.
 *
 * `SimulationView` is what makes one spec enough for nine modules: each of them writes a
 * scenario and a picker and gets the same canvas, timeline, playback controls, phase
 * stepper and inspector. So this file drives the *shared* surface rather than each
 * module's own knobs -- which are covered by that module's own Testing Library suite --
 * and asks the one question a unit test in jsdom structurally cannot answer: does it
 * actually work in a browser that lays out?
 *
 * That distinction is the reason the suite exists. `tests/setup.ts` stubs
 * `ResizeObserver` and `getBoundingClientRect` so React Flow will mount at all in jsdom,
 * and every box it measures there is zero-sized. A node that cannot be clicked because it
 * has no area, an edge that never renders because its handles were never measured, a
 * playhead that never advances because rAF never ran -- all of those pass in jsdom and
 * fail here.
 */

/**
 * Wind playback to its end.
 *
 * 4x first, and not out of impatience: the longest scenario in the product is a cold page
 * load, and at 1x that is most of a minute of wall clock per module. The speed control is
 * part of the contract being tested anyway.
 */
async function playToEnd(page: Page): Promise<void> {
  const fastest = page.getByRole('button', { name: '4x', exact: true });
  await fastest.click();
  await expect(fastest).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Play', exact: true }).click();

  /*
   * `Play again` is `playbackAction('ended')` -- the toggle only reads that way once the
   * store has run the timeline out. Asserting on the button rather than on the clock is
   * what makes this a test of playback finishing rather than of a number being written.
   */
  await expect(page.getByRole('button', { name: 'Play again' })).toBeVisible({
    timeout: 60_000,
  });
}

/** The timeline's position, in virtual milliseconds. */
async function playheadMs(page: Page): Promise<number> {
  return Number(
    await page.getByRole('slider', { name: 'Playback position' }).inputValue(),
  );
}

/** Every machine drawn on the diagram, whichever module drew it. */
function nodes(page: Page): Locator {
  return page.locator('.react-flow__node');
}

/**
 * The sticky top nav, which overlaps whatever is beneath it.
 *
 * `h-14` in `TopNav`. A node under it is visible to the DOM and unclickable in fact, and
 * the difference between those two is exactly the kind of thing a browser test exists to
 * notice -- so the band is excluded here rather than worked around with `force: true`,
 * which would assert a click that a person could not perform.
 */
const STICKY_NAV_PX = 56;

/**
 * A machine that can actually be clicked.
 *
 * Not simply the first one. React Flow `fitView`s onto the whole topology and then clips
 * to its container, so on a wide diagram -- Packet Journey's ten hops, the WebSocket
 * Viewer's long-lived connection -- the first node in DOM order can sit outside the
 * visible box while still reporting itself visible. Picking by geometry is the honest
 * version of "click a machine on the diagram", and it is the one thing this suite can
 * check that jsdom cannot: there, every box is zero-sized and any node would do.
 */
async function clickableNode(page: Page): Promise<Locator> {
  const canvas = page.locator('.react-flow').first();
  await canvas.scrollIntoViewIfNeeded();

  const area = await canvas.boundingBox();
  expect(area, 'the canvas should have laid out').not.toBeNull();

  const all = nodes(page);
  const total = await all.count();

  for (let index = 0; index < total; index += 1) {
    const node = all.nth(index);
    const box = await node.boundingBox();
    if (!box || !area) continue;

    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const insideCanvas =
      x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height;

    if (insideCanvas && y > STICKY_NAV_PX) return node;
  }

  throw new Error(`no node lies inside the visible canvas (${total} drawn)`);
}

/**
 * One module is `ready` and does not belong here, and it must stay exactly one.
 *
 * The Learning Center teaches from the other nine rather than simulating anything, so it
 * has no canvas of its own to drive. Left implicit, "skip the module without a canvas"
 * would silently excuse the next module that fails to render one.
 */
test('every ready module but the Learning Center is exercised here', () => {
  expect(SIMULATING_MODULES.map((module) => module.id)).toHaveLength(9);
  expect(SIMULATING_MODULES.map((module) => module.id)).not.toContain('learning-center');
});

// `meta`, not `module`: `@next/next/no-assign-module-variable` reserves that name.
for (const meta of SIMULATING_MODULES) {
  test.describe(meta.title, () => {
    test('loads, plays to the end, steps back, and opens the inspector', async ({
      page,
    }) => {
      const browserConsole = watchConsole(page);

      await page.goto(meta.route);
      await expect(page.locator('main h1')).toHaveText(meta.title);

      // The diagram has to have laid out before anything else here means anything.
      await expect(page.locator('.react-flow')).toBeVisible();
      await expect(nodes(page).first()).toBeVisible();

      // --- run a scenario to completion ------------------------------------------
      await playToEnd(page);

      const endMs = await playheadMs(page);
      expect(
        endMs,
        'a finished run should leave the playhead past the start',
      ).toBeGreaterThan(0);

      // --- step backwards --------------------------------------------------------
      await page.getByRole('button', { name: 'Previous phase' }).click();

      await expect
        .poll(() => playheadMs(page), {
          message: 'stepping back should move the playhead earlier',
        })
        .toBeLessThan(endMs);

      /*
       * Leaving the end is a state change, not just a smaller number: `statusAfterSeek`
       * demotes `ended` to `paused`, so the toggle offers `Play` again. Scrubbing
       * backwards being exact -- rather than something the view has to undo -- is the
       * whole reason `virtualTime` is the only mutable state in the view.
       */
      await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();

      // --- open the inspector ----------------------------------------------------
      /*
       * `exact`, because a module may add an inspector of its own beside the shared one
       * -- the WebSocket Viewer's "Frame inspector" is one -- and this test is about the
       * panel every module gets from `SimulationView`.
       */
      const inspector = page.getByRole('region', { name: 'Inspector', exact: true });
      const node = await clickableNode(page);

      /*
       * The node's own label, read off the card, then looked for in the panel. Asserting
       * that the inspector holds *this* machine rather than merely that it stopped being
       * empty is what makes this a test of selection and not of a click landing anywhere.
       *
       * The "before" state is deliberately not asserted: the Network Map drives its own
       * selection from the guided tour, so its panel is legitimately already showing
       * something on load.
       */
      const label = (await node.innerText()).split('\n')[0]!.trim();
      expect(label, 'a node card should be labelled').not.toBe('');

      await node.click();

      await expect(inspector.getByText('Nothing selected')).toHaveCount(0);
      await expect(inspector.getByRole('heading', { name: 'Addresses' })).toBeVisible();
      await expect(inspector).toContainText(label);

      expect(browserConsole.errors, `${meta.route} logged browser errors`).toEqual([]);
    });
  });
}
