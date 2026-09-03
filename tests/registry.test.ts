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

  /**
   * One entry per completed phase. Phase 05 shipped the Network Map, phase 06 the Packet
   * Journey, phase 07 the DNS Explorer, and phase 08 the HTTP Explorer; every other
   * module is still 'planned', and each later phase adds its own id here as it lands.
   */
  it('marks exactly the modules whose phase has shipped as ready', () => {
    expect(readyModules().map((m) => m.id)).toEqual([
      'network-map',
      'packet-journey',
      'dns-explorer',
      'http-explorer',
    ]);
  });

  /**
   * The security boundary from CLAUDE.md. Phase 12 flips network-diagnostics to true;
   * this test must be updated to assert it is the ONLY one, never relaxed.
   */
  it('has no module able to touch a real network', () => {
    expect(MODULES.filter((m) => m.usesRealNetwork)).toHaveLength(0);
  });
});
