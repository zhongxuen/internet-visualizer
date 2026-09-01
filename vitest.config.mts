import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Two projects, deliberately:
 *
 * - `core` runs in **node**. `src/core/**` is framework-free simulation logic, so its
 *   tests must not need a DOM. If a core test ever requires jsdom, that is a signal the
 *   boundary rule in eslint.config.mjs has been violated.
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
        plugins: [react()],
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
           */
          testTimeout: 20_000,
          include: [
            'src/{components,modules,lib}/**/*.test.{ts,tsx}',
            'tests/**/*.test.{ts,tsx}',
          ],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/core/**', 'src/modules/**/sim/**', 'src/lib/**'],
      exclude: ['**/*.test.*', '**/index.ts', '**/types/**'],
    },
  },
});
