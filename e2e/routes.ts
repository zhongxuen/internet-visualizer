import type { ConsoleMessage, Page } from '@playwright/test';

import { allLessonParams } from '@/modules/learning-center/content/navigation';
import { MODULES, readyModules, type ModuleMeta } from '@/modules/registry';

/**
 * Every URL this product serves, derived rather than listed.
 *
 * The point of `registry.ts` is that nothing else hardcodes a module list, and a test
 * file is not an exception -- a module added without a route that loads should fail the
 * smoke test the moment its entry lands, not whenever someone remembers to edit an
 * array here. The lessons come from `allLessonParams()` for the same reason: it is the
 * function `generateStaticParams` itself uses, so the set tested and the set built are
 * the same set by construction.
 *
 * `@/modules/learning-center/content/navigation` is imported by path rather than through
 * the module's index, which would pull React and MDX into a Node test process for a list
 * of strings.
 */

export interface RouteUnderTest {
  /** Reported in the test name, so a failure says which page broke. */
  readonly name: string;
  readonly path: string;
}

/** The home page, every module, and the whole Learning Center. */
export const ROUTES: readonly RouteUnderTest[] = [
  { name: 'home', path: '/' },
  ...MODULES.map((module) => ({ name: module.id, path: module.route })),
  { name: 'learn:glossary', path: '/learn/glossary' },
  ...allLessonParams().map(({ track, lesson }) => ({
    name: `learn:${track}/${lesson}`,
    path: `/learn/${track}/${lesson}`,
  })),
];

/**
 * URLs that must 404, and the text the page should carry.
 *
 * Deliberately not part of {@link ROUTES}: the smoke test there asserts a 200, and a 404
 * that returned one would be the bug. They are still routes a visitor reaches -- a
 * renamed lesson in someone's bookmarks is the common case -- so they get the same
 * treatment as every other page in the smoke and axe suites.
 *
 * Both land on the same page, and the second entry is here to prove it does. Every
 * lesson URL is pre-rendered and `/learn/[track]/[lesson]` sets `dynamicParams = false`,
 * so a wrong track or a wrong slug never reaches the page component at all -- Next
 * answers from the root not-found boundary rather than from any boundary under `/learn`.
 * A not-found page inside that subtree would be unreachable in a production build, which
 * is why there is not one.
 */
export const NOT_FOUND_ROUTES: readonly (RouteUnderTest & {
  readonly expects: RegExp;
})[] = [
  {
    name: '404:root',
    path: '/no-such-module',
    expects: /There is nothing at this address/i,
  },
  {
    name: '404:lesson',
    // Both segments wrong, which is the shape a stale bookmark takes.
    path: '/learn/no-such-track/no-such-lesson',
    expects: /There is nothing at this address/i,
  },
];

/**
 * The nine modules that render a simulation.
 *
 * The Learning Center is `ready` too and is deliberately not here: it teaches from the
 * other nine rather than simulating anything, so it has no canvas, no timeline and no
 * inspector of its own to drive. `modules.spec.ts` asserts that exclusion is exactly one
 * module wide, so a tenth simulating module cannot quietly skip the suite.
 */
export const SIMULATING_MODULES: readonly ModuleMeta[] = readyModules().filter(
  (module) => module.id !== 'learning-center',
);

/**
 * Console output that is the browser's, not the product's.
 *
 * Kept as short as it can be: every entry is a message no page code can prevent, and
 * anything the app itself logs must fail the smoke test. If this list grows, the fix is
 * almost always in the app.
 */
const IGNORED_CONSOLE = [
  // Chromium prints this for any page served over plain http with a `preload` hint it
  // then reuses from cache; it is a network-stack notice, not application output.
  /was preloaded using link preload but not used within a few seconds/i,
];

export interface ConsoleWatcher {
  /** Console errors and uncaught exceptions seen since the watcher was attached. */
  readonly errors: string[];
}

/**
 * Record everything that would show up red in devtools.
 *
 * Both halves matter and they are different events: `console` with type `error` catches
 * React's own complaints (a failed prop type, a key warning promoted to an error, a
 * caught render error the boundary logged), while `pageerror` catches an exception that
 * escaped entirely and would have blanked the page. A route is only clean if neither
 * fired.
 */
export function watchConsole(page: Page): ConsoleWatcher {
  const errors: string[] = [];

  page.on('console', (message: ConsoleMessage) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (IGNORED_CONSOLE.some((pattern) => pattern.test(text))) return;
    errors.push(`console.error: ${text}`);
  });

  page.on('pageerror', (error: Error) => {
    errors.push(`pageerror: ${error.message}`);
  });

  return {
    get errors() {
      return errors;
    },
  };
}
