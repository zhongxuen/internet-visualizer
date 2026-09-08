import mdx from '@mdx-js/rollup';
import react from '@vitejs/plugin-react';
import remarkGfm from 'remark-gfm';
import { defineConfig } from 'vitest/config';

/**
 * The per-folder budget every module's `sim/` has to meet on its own.
 *
 * Named once because the point is that it is the *same* number for all of them: a module
 * whose simulation is harder to cover is not a module allowed to cover less of it.
 *
 * Two modules are absent from the list below and neither is an oversight. `network-map`
 * has no `sim/` folder -- its scenarios are topologies and its timeline comes from
 * `tour.ts`. `dns-explorer` has none either: its resolution logic was promoted into
 * `src/core/protocols/dns` in phase 11, so it is held to the `src/core` budget instead.
 * `tests/coverage-shape.test.ts` asserts that stays true, so a module that grows a
 * `sim/` folder without a budget here fails.
 *
 * ## Why `branches` is the odd one out
 *
 * 90% for the three metrics that count *code*, and a lower floor for the one that counts
 * *paths*. That is a statement about what is left uncovered, not a discount:
 *
 * A simulation is a fan of authored alternatives, and a scenario picks one arm of each.
 * `http-stage.ts` is the clearest case -- 100% of its lines run, and its branch figure is
 * in the fifties, because every shipped scenario negotiates HTTP/2 and the HTTP/1.1 arms
 * (text framing, uncompressed headers, no ALPN) are therefore never taken. Closing that
 * gap means authoring scenarios to make a percentage move rather than to teach something,
 * which is the wrong reason for a scenario to exist in this product.
 *
 * So the floor is set where it holds the real property -- every line of every simulation
 * runs, and every exported function is called -- and the residual is named rather than
 * hidden. `src/core` is held to 90% on all four, branches included (see below): the
 * protocol layer has no authored alternatives to excuse, and it is the layer the doc
 * names.
 */
const MODULE_SIM = { lines: 90, functions: 90, statements: 90, branches: 80 };

/**
 * Two projects, deliberately:
 *
 * - `core` runs in **node**. `src/core/**` is framework-free simulation logic, so its
 *   tests must not need a DOM. If a core test ever requires jsdom, that is a signal the
 *   boundary rule in eslint.config.mjs has been violated.
 * - `routes` runs in **node** too. The phase-12 diagnostics Route Handlers are server
 *   code: they use `Request`/`Response`, `node:dns` and `fetch`, and never a DOM. They
 *   are their own project rather than part of `core` so a failure names which side of
 *   the boundary broke -- the pure guard, or the handler wiring around it.
 * - `ui` runs in **jsdom** for components, modules, and shared UI helpers.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: 'core',
          environment: 'node',
          include: ['src/core/**/*.test.ts'],
        },
      },
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: 'routes',
          environment: 'node',
          include: ['src/app/api/**/*.test.ts'],
        },
      },
      {
        resolve: { tsconfigPaths: true },
        /*
         * `mdx()` before `react()`, and `enforce: 'pre'` so it claims `.mdx` before
         * esbuild tries to parse one as TypeScript.
         *
         * Next compiles lessons through `@next/mdx`; this compiles the same files for
         * the test run. Two compilers for one file type is a real duplication, and the
         * alternative -- testing lessons as strings, or not at all -- is worse: the
         * Learning Center's whole claim is that a lesson is executable, so a lesson
         * has to be able to fail a test. `remark-gfm` is listed in both places for the
         * same reason, and is the only plugin either side runs.
         */
        plugins: [{ enforce: 'pre', ...mdx({ remarkPlugins: [remarkGfm] }) }, react()],
        test: {
          name: 'ui',
          environment: 'jsdom',
          setupFiles: ['./tests/setup.ts'],
          /**
           * Mounting a React Flow diagram in jsdom is not cheap, and a module test does
           * it several times over as it switches scenarios. Under the parallelism the
           * whole suite runs at, that reliably crosses the 5 s default on an ordinary
           * laptop -- a slow environment, not a slow test. Real timing belongs in the
           * phase-14 Playwright suite, in a browser that actually lays out.
           *
           * Raised from 20 s to 60 s, then to 120 s, both times for the same reason and
           * both times against a measurement. `--coverage` adds v8 instrumentation to
           * every one of those mounts: at 20 s that timed out twenty-three tests that
           * pass in isolation in a fraction of the budget, and at 60 s it timed out one
           * more -- `PacketJourneyModule.test.tsx`, which is the heaviest file in the
           * suite because Packet Journey is the largest page in the product (CLAUDE.md
           * has the element counts).
           *
           * The numbers behind 120 s, all for that one file, alone on an idle machine:
           * 65 s for eight tests uninstrumented, 134 s instrumented. In a full parallel
           * run under coverage it took 201 s and one test hit the cap. So the slowest
           * single test needs somewhere near a minute of its own even before contention,
           * and 60 s left it no headroom at all.
           *
           * A timeout is a backstop against a hang, not a performance budget; sizing it
           * to the fastest machine that ever runs the suite just converts CI load into
           * red. Real timing belongs in Playwright, in a browser that actually lays out.
           */
          testTimeout: 120_000,
          /**
           * Half the cores, not all of them.
           *
           * Every file in this project builds a jsdom environment and most of them mount
           * React Flow into it, which is the most memory-hungry thing the suite does. At
           * the default worker count that is a dozen of them alive at once, and under
           * `--coverage` -- which adds v8 instrumentation to every one -- the machine
           * spends its time in GC rather than in tests. The symptom is unmistakable and
           * was what prompted this: *synchronous* tests timing out at sixty seconds.
           * A test that does no I/O cannot be slow; it can only be starved.
           *
           * Halving the workers costs a little wall clock on an idle machine and buys a
           * suite that finishes at all on a busy one. A CI runner with two cores is the
           * busy case, not the exception.
           */
          maxWorkers: '50%',
          /*
           * A distinct group is what makes the line above legal -- vitest refuses two
           * projects with different worker counts in the same group -- and it is the
           * right shape anyway: `core` and `routes` are pure node and take seconds, so
           * running them to completion first means the heavy jsdom project gets the
           * machine to itself rather than competing with them for it.
           */
          sequence: { groupOrder: 1 },
          include: [
            'src/{components,modules,lib}/**/*.test.{ts,tsx}',
            'tests/**/*.test.{ts,tsx}',
          ],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      // `*.ts` throughout rather than `**`: several of these folders carry a README, and
      // v8 tries to parse every included file as source before deciding it is not one --
      // which lands a `.md` in the report at 0% and drags the folder's average with it.
      include: [
        'src/core/**/*.ts',
        'src/modules/**/sim/**/*.ts',
        'src/lib/**/*.ts',
        'src/app/api/**/*.ts',
      ],
      // `__tests__/` holds the diagnostics route harness, which is test scaffolding and
      // not shipped code; measuring it would report on the tests rather than the product.
      exclude: ['**/*.test.*', '**/index.ts', '**/types/**', '**/__tests__/**'],
      /*
       * Report even when something failed. The default swallows the whole report on a
       * single red test, which is exactly when you most want to see whether the failure
       * took a branch's coverage with it.
       */
      reportOnFailure: true,
      /**
       * The phase-14 budgets, enforced rather than aspired to.
       *
       * `thresholds` fails the run, so `npm run test:coverage` is the gate and CI does
       * not need to parse a number out of a report. Four tiers, each with its own
       * argument behind it:
       *
       *  - **`src/core/**` at 90% on all four metrics.** The figure the phase doc names,
       *    applied to the layer it names. This is pure protocol logic -- no DOM, no
       *    framework, no I/O, and no authored alternatives -- so anything uncovered here
       *    is uncovered by choice, branches included.
       *  - **`src/core/net/guard.ts` at 95%**, higher than everything else because it is
       *    the SSRF guard: the one file where an untested branch is a security hole
       *    rather than a gap. It sits at 100% lines today; 95 is the floor, not the
       *    target.
       *  - **every module `sim/` folder in its own right**, at {@link MODULE_SIM}. A
       *    global number can be carried by `src/core`, which is much the larger body of
       *    code, and "every module's sim/ folder tested independently of its UI" is a
       *    per-module claim that only a per-module threshold makes.
       *  - **a global floor** underneath all of it, which also catches `src/lib` and the
       *    diagnostics Route Handlers. Vitest applies the global numbers to every
       *    included file, glob-matched ones included, so this is the aggregate and is
       *    necessarily the loosest of the four on branches.
       *
       * `perFile` is left off throughout: the unit is the folder. A small pure helper
       * sitting at 88% inside a folder at 96% is not a hole worth failing a build over.
       */
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
        branches: 85,

        'src/core/**': {
          lines: 90,
          functions: 90,
          statements: 90,
          branches: 90,
        },

        'src/core/net/guard.ts': {
          lines: 95,
          functions: 95,
          branches: 95,
          statements: 95,
        },

        'src/modules/api-visualizer/sim/**': MODULE_SIM,
        'src/modules/http-explorer/sim/**': MODULE_SIM,
        'src/modules/https-explorer/sim/**': MODULE_SIM,
        'src/modules/internet-simulator/sim/**': MODULE_SIM,
        'src/modules/network-diagnostics/sim/**': MODULE_SIM,
        'src/modules/packet-journey/sim/**': MODULE_SIM,
        'src/modules/websocket-viewer/sim/**': MODULE_SIM,
      },
    },
  },
});
