import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import boundaries from 'eslint-plugin-boundaries';

/**
 * The architecture boundary rules below are the mechanical enforcement of the two
 * hard rules in CLAUDE.md:
 *
 *   1. "Visualization logic must stay separated from networking logic"
 *      -> src/core/** may not import any framework, UI, app or module code.
 *   2. "Implement and modify one module at a time; don't touch unrelated modules"
 *      -> src/modules/<a>/** may not import from src/modules/<b>/**.
 *
 * Plus the corollary that keeps shared UI shared:
 *   3. src/components/** may not import from src/modules/**.
 *
 * Without these, all three erode within a few phases. Do not weaken them; if a rule
 * is in the way, the code is on the wrong side of a boundary.
 *
 * `src/modules/registry.ts` is deliberately NOT a module -- it is the shared manifest
 * that navigation and the home page read, so importing it from components is allowed.
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // ---------------------------------------------------------------------------
  // Rule 1: src/core stays framework-free.
  // ---------------------------------------------------------------------------
  {
    files: ['src/core/**/*.{ts,tsx}'],
    ignores: ['src/core/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            'react',
            'react-dom',
            'next',
            '@xyflow/react',
            'motion',
            'motion-dom',
            'zustand',
          ].map((name) => ({
            name,
            message:
              'src/core is framework-free simulation logic: it must be unit-testable in a node environment with no DOM. Move anything that needs React into src/components or the module that uses it.',
          })),
          patterns: [
            {
              group: [
                'next/*',
                'react-dom/*',
                'motion/*',
                'zustand/*',
                '@/app/*',
                '@/components/*',
                '@/modules/*',
                '**/app/**',
                '**/components/**',
                '**/modules/**',
              ],
              message:
                'src/core must not depend on the app, UI components, or any module. Dependencies point inward: app -> modules -> components -> core.',
            },
          ],
        },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // Rules 2 and 3: module independence, enforced by path element type.
  // ---------------------------------------------------------------------------
  {
    files: ['src/**/*.{ts,tsx,js,jsx,mjs}'],
    plugins: { boundaries },
    settings: {
      'boundaries/include': ['src/**/*'],
      'boundaries/elements': [
        { type: 'app', pattern: 'src/app' },
        { type: 'core', pattern: 'src/core' },
        { type: 'components', pattern: 'src/components' },
        { type: 'module', pattern: 'src/modules/*', capture: ['moduleName'] },
        { type: 'lib', pattern: 'src/lib' },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'allow',
          policies: [
            {
              from: { element: { type: 'core' } },
              disallow: {
                to: { element: { types: { anyOf: ['app', 'components', 'module'] } } },
              },
              message:
                'src/core must stay framework-free: it may not import UI, app, or module code.',
            },
            // Rule 3
            {
              from: { element: { type: 'components' } },
              disallow: { to: { element: { type: 'module' } } },
              message:
                'src/components are shared building blocks and may not depend on a specific module. If it needs module knowledge, it belongs in that module.',
            },
            // Rule 2
            {
              from: { element: { type: 'module' } },
              disallow: {
                to: {
                  element: {
                    type: 'module',
                    captured: { moduleName: '!{{from.captured.moduleName}}' },
                  },
                },
              },
              message:
                'Modules are independent: this module may not import from "{{to.captured.moduleName}}". Share via src/core or src/components instead.',
            },
          ],
        },
      ],
    },
  },

  // Tests and config files sit outside the architecture; exempt them.
  {
    files: ['**/*.test.{ts,tsx}', 'tests/**/*', '*.config.{ts,mjs,js}'],
    rules: {
      'boundaries/dependencies': 'off',
      'no-restricted-imports': 'off',
    },
  },

  globalIgnores(['.next/**', 'out/**', 'build/**', 'coverage/**', 'next-env.d.ts']),
]);

export default eslintConfig;
