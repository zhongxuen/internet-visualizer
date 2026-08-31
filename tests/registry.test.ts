import { describe, expect, it } from 'vitest';
import { MODULES, getModule, readyModules } from '@/modules/registry';

describe('module registry', () => {
  it('seeds all ten spec modules', () => {
    expect(MODULES).toHaveLength(10);
  });

  it('has unique ids and routes', () => {
    expect(new Set(MODULES.map((m) => m.id)).size).toBe(MODULES.length);
    expect(new Set(MODULES.map((m) => m.route)).size).toBe(MODULES.length);
  });

  it('looks a module up by id', () => {
    expect(getModule('dns-explorer')?.title).toBe('DNS Explorer');
    expect(getModule('nope')).toBeUndefined();
  });

  it('has no ready modules yet', () => {
    expect(readyModules()).toHaveLength(0);
  });

  /**
   * The security boundary from CLAUDE.md. Phase 12 flips network-diagnostics to true;
   * this test must be updated to assert it is the ONLY one, never relaxed.
   */
  it('has no module able to touch a real network', () => {
    expect(MODULES.filter((m) => m.usesRealNetwork)).toHaveLength(0);
  });
});
