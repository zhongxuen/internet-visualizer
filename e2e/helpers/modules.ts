import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { SIMULATING_MODULES, watchConsole } from '../routes';

import { clickableNode, nodes } from './layout';
import { playButton, playheadMs, playToEnd, transport } from './playback';

/**
 * The interaction contract every simulating module shares, for `e2e/modules/<id>.spec.ts`.
 *
 * `SimulationView` is what makes one contract enough for nine modules: each of them
 * writes a scenario and gets the same canvas, timeline, transport, step list and details
 * panel. So the contract drives the *shared* surface -- a module's own knobs are that
 * module's to test, in its own spec file under this one call -- and asks the question a
 * unit test in jsdom structurally cannot answer: does it actually work in a browser that
 * lays out?
 *
 * `tests/setup.ts` stubs `ResizeObserver` and `getBoundingClientRect` so React Flow will
 * mount in jsdom at all, and every box it measures there is zero-sized. A node that
 * cannot be clicked because it has no area, an edge that never renders because its
 * handles were never measured, a playhead that never advances because rAF never ran --
 * all of those pass in jsdom and fail here.
 *
 * One file per module so that wave 3's ten module passes each edit one file.
 */

/** The spec files in `e2e/modules/`, by module id. */
function specFiles(): string[] {
  return readdirSync(join(test.info().project.testDir, 'modules'))
    .filter((file) => file.endsWith('.spec.ts'))
    .map((file) => file.replace(/\.spec\.ts$/, ''));
}

export function moduleContract(id: string): void {
  // `meta`, not `module`: `@next/next/no-assign-module-variable` reserves that name.
  const meta = SIMULATING_MODULES.find((candidate) => candidate.id === id);

  /**
   * Each simulating module has exactly one spec file, and nothing else does.
   *
   * The Learning Center is `ready` and deliberately absent: it teaches from the other
   * nine and has no canvas of its own. Left implicit, "skip the module without a canvas"
   * would silently excuse the next module that fails to render one -- so the set of
   * files and the set of simulating modules are compared outright.
   */
  test('every simulating module, and only those, has a spec file here', () => {
    expect(meta, `${id} is not a simulating module`).toBeDefined();
    expect(SIMULATING_MODULES).toHaveLength(9);
    expect(SIMULATING_MODULES.map((module) => module.id)).not.toContain(
      'learning-center',
    );
    expect(new Set(specFiles())).toEqual(new Set(SIMULATING_MODULES.map((m) => m.id)));
  });

  if (!meta) return;

  test.describe(meta.title, () => {
    test('loads, plays to the end, steps back, and opens the details', async ({
      page,
    }) => {
      const browserConsole = watchConsole(page);

      await page.goto(meta.route);
      await expect(page.locator('main h1')).toHaveText(meta.title);

      // The diagram has to have laid out before anything else here means anything.
      await expect(page.locator('.react-flow')).toBeVisible();
      await expect(nodes(page).first()).toBeVisible();

      // --- the one obvious next action -------------------------------------------
      await expect(page.getByRole('button', { name: 'Watch it happen' })).toBeVisible();

      // --- run a scenario to completion ------------------------------------------
      await playToEnd(page);

      const endMs = await playheadMs(page);
      expect(
        endMs,
        'a finished run should leave the playhead past the start',
      ).toBeGreaterThan(0);
      await expect(
        page.getByRole('region', { name: 'What just happened' }),
      ).toBeVisible();

      // --- step backwards --------------------------------------------------------
      await transport(page).getByRole('button', { name: 'Back', exact: true }).click();

      await expect
        .poll(() => playheadMs(page), {
          message: 'stepping back should move the playhead earlier',
        })
        .toBeLessThan(endMs);

      /*
       * Leaving the end is a state change, not just a smaller number: `statusAfterSeek`
       * demotes `ended` to `paused`, so the transport offers Play and the recap
       * steps aside. Scrubbing backwards being exact -- rather than something the view
       * has to undo -- is the whole reason `virtualTime` is the only mutable state in it.
       */
      await expect(playButton(page)).toBeVisible();
      await expect(page.getByRole('region', { name: 'What just happened' })).toHaveCount(
        0,
      );

      // --- open the details ------------------------------------------------------
      /*
       * `exact`, because a module may add an inspector of its own beside the shared one
       * -- the WebSocket Viewer's "Frame inspector" is one -- and this test is about the
       * panel every module gets from `SimulationView`.
       */
      const inspector = page.getByRole('region', { name: 'Inspector', exact: true });
      const node = await clickableNode(page);

      /*
       * The node's own label, read off the card, then looked for in the panel. Asserting
       * that the panel holds *this* machine rather than merely that it stopped being
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
