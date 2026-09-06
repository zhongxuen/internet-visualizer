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
   * Journey, phase 07 the DNS Explorer, phase 08 the HTTP Explorer, phase 09 the HTTPS
   * Explorer, phase 10 part A the API Visualizer, phase 10 part B the WebSocket Viewer,
   * phase 11 the Internet Simulator, and phase 12 Network Diagnostics; the Learning
   * Center is still 'planned', and phase 13 adds its id here when it lands.
   */
  it('marks exactly the modules whose phase has shipped as ready', () => {
    expect(readyModules().map((m) => m.id)).toEqual([
      'network-map',
      'packet-journey',
      'dns-explorer',
      'http-explorer',
      'https-explorer',
      'api-visualizer',
      'websocket-viewer',
      'internet-simulator',
      'network-diagnostics',
    ]);
  });

  /**
   * The security boundary from CLAUDE.md, now that phase 12 has flipped the flag: the
   * assertion is that network-diagnostics is the ONLY entry with it. Tighten this test,
   * never relax it -- a second module setting `usesRealNetwork` is a design error, not a
   * new feature, because every live request in the product goes through the three Route
   * Handlers this module owns.
   */
  it('has exactly one module able to touch a real network', () => {
    expect(MODULES.filter((m) => m.usesRealNetwork).map((m) => m.id)).toEqual([
      'network-diagnostics',
    ]);
  });

  /** The module that reaches a network must also be the one that is finished. */
  it('gives the live module a ready status, so the badge is never on an unfinished page', () => {
    expect(getModule('network-diagnostics')?.status).toBe('ready');
  });
});
