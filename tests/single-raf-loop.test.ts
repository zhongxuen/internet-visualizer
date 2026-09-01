import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * "Exactly one rAF loop exists in the codebase"
 * (docs/implementation/04-visualization-layer.md, acceptance criteria).
 *
 * Not a style preference. The moment a second component starts animating on its own
 * frames, two things on screen are advancing on two clocks, and the guarantee the whole
 * architecture rests on -- that everything visible is a pure function of one number --
 * is gone. Scrubbing backwards, pausing mid-hop, and reduced motion then break quietly,
 * and only in the component that broke the rule.
 *
 * A *loop* is what is banned, not the API: scheduling one frame to do something after
 * the browser has painted (focusing a menu item that did not exist on the keystroke that
 * opened it) is a deferral, not an animation. The two are told apart mechanically -- a
 * loop re-schedules itself and therefore has to be cancellable, so it calls
 * `requestAnimationFrame` more than once or calls `cancelAnimationFrame`. A one-shot
 * does neither, and this test holds it to that.
 *
 * If this fails, the fix is to drive the new thing from `usePlayback`'s loop, not to add
 * the file to the list.
 */

const SOURCE_ROOT = join(process.cwd(), 'src');

/** The one place allowed to run frames continuously. */
const THE_LOOP = 'src/components/viz/hooks/usePlayback.ts';

const SCHEDULE = /requestAnimationFrame\s*\(/g;
const CANCEL = /cancelAnimationFrame\s*\(/g;

interface Usage {
  path: string;
  schedules: number;
  cancels: number;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(entry.name)) return [];
    // Tests may drive or stub frames as much as they like; they are not the product.
    if (/\.test\.tsx?$/.test(entry.name)) return [];
    return [path];
  });
}

function frameUsage(): Usage[] {
  return sourceFiles(SOURCE_ROOT)
    .map((path) => {
      const source = readFileSync(path, 'utf8');
      return {
        path: relative(process.cwd(), path).replaceAll('\\', '/'),
        schedules: source.match(SCHEDULE)?.length ?? 0,
        cancels: source.match(CANCEL)?.length ?? 0,
      };
    })
    .filter((usage) => usage.schedules > 0 || usage.cancels > 0);
}

const isLoop = (usage: Usage) => usage.schedules > 1 || usage.cancels > 0;

describe('the animation loop', () => {
  it('runs in exactly one file', () => {
    expect(
      frameUsage()
        .filter(isLoop)
        .map((usage) => usage.path),
    ).toEqual([THE_LOOP]);
  });

  it('leaves every other use of a frame a one-shot deferral', () => {
    for (const usage of frameUsage().filter((candidate) => !isLoop(candidate))) {
      expect(usage, `${usage.path} schedules more than one frame`).toMatchObject({
        schedules: 1,
        cancels: 0,
      });
    }
  });

  it('starts and cancels its frames in matched pairs', () => {
    const source = readFileSync(join(process.cwd(), THE_LOOP), 'utf8');

    expect(source).toContain('cancelAnimationFrame');
    // Two scheduling sites: the kick-off, and the one the loop queues each frame.
    expect(source.match(/requestAnimationFrame\(step\)/g)).toHaveLength(2);
  });
});
