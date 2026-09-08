import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every module `sim/` folder carries its own coverage budget.
 *
 * The phase-14 requirement is "every module's `sim/` folder tested independently of its
 * UI", and a global percentage cannot express that: `src/core` is much the larger body
 * of code, so a module whose simulation is barely covered disappears into it. The
 * per-folder thresholds in `vitest.config.mts` are what make the claim per-module.
 *
 * Those thresholds are a hand-written list of globs, though, and a hand-written list is
 * one module away from being wrong. This test is the guard: it reads the folders that
 * actually exist and asserts each one is named in the config. A module that grows a
 * `sim/` folder without a budget fails here rather than shipping uncovered.
 *
 * It reads the config as text rather than importing it. `vitest.config.mts` is the file
 * running this test, and importing it back into the run to inspect the very object it
 * was configured from is a circularity with no upside: the assertion is about what is
 * written down, and the text is what is written down.
 */

const MODULES_DIR = join(process.cwd(), 'src/modules');

/** Module folders that ship a `sim/`, read off disk. */
function modulesWithSim(): string[] {
  return readdirSync(MODULES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => {
      try {
        return readdirSync(join(MODULES_DIR, entry.name)).includes('sim');
      } catch {
        return false;
      }
    })
    .map((entry) => entry.name)
    .sort();
}

describe('coverage thresholds cover every simulation', () => {
  const config = readFileSync(join(process.cwd(), 'vitest.config.mts'), 'utf8');

  it('gives every module sim/ folder its own threshold', () => {
    const missing = modulesWithSim().filter(
      (name) => !config.includes(`'src/modules/${name}/sim/**'`),
    );

    expect(
      missing,
      'add a MODULE_SIM threshold in vitest.config.mts for these modules',
    ).toEqual([]);
  });

  /**
   * The other direction, so a module that is renamed or folded away takes its budget
   * with it. A threshold glob matching nothing passes silently in vitest -- it is a
   * budget for zero files -- which is exactly how a stale one survives.
   */
  it('has no threshold for a sim/ folder that no longer exists', () => {
    const declared = [...config.matchAll(/'src\/modules\/([^/']+)\/sim\/\*\*'/g)].map(
      (match) => match[1]!,
    );

    expect(declared.sort()).toEqual(modulesWithSim());
  });

  /**
   * The security-critical file the doc singles out. Named here so that deleting its
   * entry from the config is a test failure rather than a quiet relaxation -- the same
   * reason `tests/registry.test.ts` pins `usesRealNetwork` to one module.
   */
  it('holds the SSRF guard to a higher bar than everything else', () => {
    expect(config).toContain("'src/core/net/guard.ts'");
    expect(config).toMatch(/'src\/core\/net\/guard\.ts':\s*\{[^}]*lines:\s*95/);
  });
});
