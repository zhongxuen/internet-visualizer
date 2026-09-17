import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The sticky top nav, which overlaps whatever is beneath it.
 *
 * `h-14` in `TopNav`. A node under it is visible to the DOM and unclickable in fact, and
 * the difference between those two is exactly the kind of thing a browser test exists to
 * notice -- so the band is excluded rather than worked around with `force: true`, which
 * would assert a click that a person could not perform.
 */
export const STICKY_NAV_PX = 56;

/** Every machine drawn on the diagram, whichever module drew it. */
export function nodes(page: Page): Locator {
  return page.locator('.react-flow__node');
}

/**
 * A machine that can actually be clicked.
 *
 * Not simply the first one. React Flow fits the view onto the whole topology and then
 * clips to its container, so on a wide diagram the first node in DOM order can sit
 * outside the visible box while still reporting itself visible. And the Stage draws
 * things over the canvas on purpose: the step caption along its lower edge at `lg`, the
 * sticky transport along the bottom of the window, the top nav along its top. So a node
 * counts only if the point at its centre is inside the canvas, below the nav, and
 * actually hits that node -- `elementFromPoint`, which is what a click would land on.
 */
export async function clickableNode(page: Page): Promise<Locator> {
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
    if (!insideCanvas || y <= STICKY_NAV_PX) continue;

    const hits = await node.evaluate(
      (element, point) => {
        const top = document.elementFromPoint(point.x, point.y);
        return top !== null && element.contains(top);
      },
      { x, y },
    );
    if (hits) return node;
  }

  throw new Error(`no node lies uncovered inside the visible canvas (${total} drawn)`);
}

/** Whether the page scrolls sideways, with a pixel of slack for sub-pixel rounding. */
export async function scrollsSideways(page: Page): Promise<boolean> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  return scrollWidth > clientWidth + 1;
}
