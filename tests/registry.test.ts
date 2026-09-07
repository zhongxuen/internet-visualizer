import { describe, expect, it } from 'vitest';
import {
  MODULES,
  SPEC_LEARNING_TOPICS,
  getModule,
  getModuleByRoute,
  readyModules,
} from '@/modules/registry';

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
   * phase 11 the Internet Simulator, phase 12 Network Diagnostics, and phase 13 the
   * Learning Center -- which is last because it teaches from the other nine.
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
      'learning-center',
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

  /**
   * The Learning Center is the one module whose routes are a small site rather than a
   * single page, and the one whose pages are not wrapped in `ModuleChrome` -- a lesson
   * needs its own `h1`. Its entry still has to resolve the whole subtree back to the
   * module, because that is what the nav highlights the "Learn" group from.
   */
  it('resolves every Learning Center URL back to the module', () => {
    expect(getModule('learning-center')?.route).toBe('/learn');
    expect(getModuleByRoute('/learn')?.id).toBe('learning-center');
    expect(getModuleByRoute('/learn/glossary')?.id).toBe('learning-center');
    expect(getModuleByRoute('/learn/internet-foundations/what-is-a-network')?.id).toBe(
      'learning-center',
    );
  });

  /**
   * The spec's own list of learning topics, kept here because the spec file is
   * git-ignored. The Learning Center's coverage test asserts every one of these is
   * taught; this asserts the list itself has not been quietly edited, and that the
   * strings modules and lessons share are spelled one way.
   */
  it('keeps the spec learning topics verbatim, and spells module topics the same way', () => {
    expect(SPEC_LEARNING_TOPICS).toEqual([
      'DNS',
      'HTTP',
      'HTTPS',
      'TCP/IP',
      'UDP',
      'SSL/TLS',
      'CDN',
      'Load Balancers',
      'Reverse Proxy',
      'APIs',
      'WebSockets',
      'Cookies',
      'Sessions',
      'Authentication',
    ]);

    // Case matters: a module writing 'Https' would look covered to a reader and not to
    // the coverage test. Compare case-insensitively, and require an exact match.
    const spelled = new Map(SPEC_LEARNING_TOPICS.map((t) => [t.toLowerCase(), t]));
    for (const entry of MODULES) {
      for (const topic of entry.topics) {
        const canonical = spelled.get(topic.toLowerCase());
        if (canonical) expect(topic, `${entry.id} spells a spec topic`).toBe(canonical);
      }
    }
  });

  /** The module that reaches a network must also be the one that is finished. */
  it('gives the live module a ready status, so the badge is never on an unfinished page', () => {
    expect(getModule('network-diagnostics')?.status).toBe('ready');
  });
});
