import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The Stage's playback surface, as the browser suites drive it.
 *
 * One place for these selectors, because every spec that plays a run needs them and the
 * transport's words are the thing most likely to change. Everything is found by role and
 * accessible name, the way a person using a screen reader or voice control finds it.
 */

/**
 * The transport's Back / Play / Next step group.
 *
 * Scoped, not page-wide: "Play again" is also the first button of "What just happened"
 * once a run ends, so a page-wide lookup for it would find two.
 */
export function transport(page: Page): Locator {
  return page.getByRole('group', { name: 'Playback', exact: true });
}

/** The transport's main button while it reads "Play". */
export function playButton(page: Page): Locator {
  return transport(page).getByRole('button', { name: 'Play', exact: true });
}

/** The timeline's position, in virtual milliseconds. */
export async function playheadMs(page: Page): Promise<number> {
  return Number(
    await page.getByRole('slider', { name: 'Playback position' }).inputValue(),
  );
}

export type PlaybackSpeedLabel = '0.25x' | '0.5x' | '1x' | '2x' | '4x';

/**
 * Choose a speed from the speed menu.
 *
 * The ladder lives in a menu now, so this opens it, presses the plain "4x"-style option,
 * and checks the menu's button says the new speed -- the menu closes on a choice, so the
 * option itself is gone by the time anything could be asserted about it.
 */
export async function setSpeed(page: Page, speed: PlaybackSpeedLabel): Promise<void> {
  await page.getByRole('button', { name: /^Speed [\d.]+x$/ }).click();
  await page.getByRole('button', { name: speed, exact: true }).click();
  await expect(page.getByRole('button', { name: `Speed ${speed}` })).toBeVisible();
}

/**
 * Press Play until the run is over, and resolve once the transport reads "Play again".
 *
 * A fresh browser starts in Simple detail, where playback pauses after each step and
 * waits for Play (uiux-spec.md §5.2), so one press is not a whole run. This presses it
 * again at every pause -- which is what a viewer does -- and asserts on the button
 * rather than on the clock, because "Play again" only appears once the store has run the
 * timeline out. "Play" (exact) is never on screen while the run is moving, so a press can
 * only ever resume a pause, never interrupt playback.
 */
export async function playUntilEnded(page: Page, timeout = 60_000): Promise<void> {
  const play = playButton(page);
  const again = transport(page).getByRole('button', { name: 'Play again', exact: true });

  await expect(async () => {
    if (await play.isVisible()) await play.click();
    await expect(again).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout });
}

/**
 * Wind playback to its end, at 4x.
 *
 * 4x not out of impatience: the longest scenario in the product is a cold page load, and
 * at 1x that is most of a minute of wall clock per module.
 */
export async function playToEnd(page: Page): Promise<void> {
  await setSpeed(page, '4x');
  await playUntilEnded(page);
}
