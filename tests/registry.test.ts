import { describe, expect, it } from 'vitest';

import { MODULE_NAMES, wordCount } from '@/core/text/plain';
import {
  MODULE_CHAPTERS,
  MODULES,
  SPEC_LEARNING_TOPICS,
  getChapter,
  getModule,
  getModuleByRoute,
  modulesInChapter,
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

/**
 * The plain voice and the beginner's chapters (docs/implementation/uiux.md §5.5, §7.3).
 * The copy itself is not pinned here, so it can be reworded; what is pinned is that
 * every module has all of it, in the shape the rules in §5.1 give it.
 */
describe('module registry: the plain voice', () => {
  const LEVELS = ['beginner', 'intermediate', 'advanced'];

  it('gives every module a question, a plain summary, a level and a chapter', () => {
    const chapters = new Set(MODULE_CHAPTERS.map((c) => c.key));

    for (const entry of MODULES) {
      expect(entry.question.trim(), `${entry.id}.question`).not.toBe('');
      expect(entry.plainSummary.trim(), `${entry.id}.plainSummary`).not.toBe('');
      expect(LEVELS, `${entry.id}.level`).toContain(entry.level);
      expect(chapters, `${entry.id}.chapter`).toContain(entry.chapter);
    }
  });

  /**
   * Minutes are a first visit's length. The Learning Center is the exception: it is a
   * set of lessons and each lesson states its own, so a single figure would be false.
   */
  it('gives every module but the Learning Center a whole number of minutes', () => {
    for (const entry of MODULES) {
      if (entry.id === 'learning-center') {
        expect(entry.minutes, entry.id).toBeUndefined();
        continue;
      }
      expect(Number.isInteger(entry.minutes), `${entry.id}.minutes`).toBe(true);
      expect(entry.minutes, `${entry.id}.minutes`).toBeGreaterThan(0);
    }
  });

  it('asks every question as a question', () => {
    for (const entry of MODULES) {
      expect(entry.question, entry.id).toMatch(/\?$/);
    }
    for (const chapter of MODULE_CHAPTERS) {
      expect(chapter.question, chapter.key).toMatch(/\?$/);
    }
  });

  it('keeps every plain summary to 30 words or fewer', () => {
    for (const entry of MODULES) {
      expect(wordCount(entry.plainSummary), entry.id).toBeLessThanOrEqual(30);
    }
  });

  /**
   * The safety boundary, restated for chapters: "Real tools" is the one chapter whose
   * name says a real network may be involved, so it must hold exactly the module that
   * can reach one, and nothing else.
   */
  it("puts exactly one module in the 'tools' chapter: the one with usesRealNetwork", () => {
    const tools = MODULES.filter((m) => m.chapter === 'tools');
    expect(tools.map((m) => m.id)).toEqual(['network-diagnostics']);
    expect(tools.map((m) => m.id)).toEqual(
      MODULES.filter((m) => m.usesRealNetwork).map((m) => m.id),
    );
  });

  /**
   * "Everything is simulated" is false on its own (CLAUDE.md, "Documentation"), so the
   * one module that can go live names the exception in its plain summary too.
   */
  it('names Live mode in the Network Diagnostics plain summary', () => {
    expect(getModule('network-diagnostics')?.plainSummary).toContain('Live mode');
  });

  it("keeps the plain-text checker's module names in step with the registry titles", () => {
    expect([...MODULE_NAMES].sort()).toEqual(MODULES.map((m) => m.title).sort());
  });
});

describe('module registry: chapters', () => {
  it('lists the five chapters in §5.5 order', () => {
    expect(MODULE_CHAPTERS.map((c) => c.key)).toEqual([
      'basics',
      'websites',
      'apps',
      'tools',
      'learn',
    ]);
    expect(new Set(MODULE_CHAPTERS.map((c) => c.label)).size).toBe(
      MODULE_CHAPTERS.length,
    );
  });

  /**
   * A chapter's reading order and each module's `chapter` field say the same thing twice;
   * this is what stops them disagreeing.
   */
  it('lists in each chapter exactly the modules whose chapter it is, each once', () => {
    for (const chapter of MODULE_CHAPTERS) {
      expect(new Set(chapter.moduleIds).size, chapter.key).toBe(chapter.moduleIds.length);
      expect([...chapter.moduleIds].sort(), chapter.key).toEqual(
        MODULES.filter((m) => m.chapter === chapter.key)
          .map((m) => m.id)
          .sort(),
      );
    }
    expect(MODULE_CHAPTERS.flatMap((c) => c.moduleIds)).toHaveLength(MODULES.length);
  });

  it('reads each chapter in the §5.5 order, which is not registry order', () => {
    expect(
      Object.fromEntries(
        MODULE_CHAPTERS.map((c) => [c.key, modulesInChapter(c.key).map((m) => m.id)]),
      ),
    ).toEqual({
      basics: ['network-map', 'packet-journey'],
      websites: ['internet-simulator', 'dns-explorer', 'http-explorer', 'https-explorer'],
      apps: ['api-visualizer', 'websocket-viewer'],
      tools: ['network-diagnostics'],
      learn: ['learning-center'],
    });
    expect(getChapter('websites')?.label).toBe('Opening a website');
  });
});
