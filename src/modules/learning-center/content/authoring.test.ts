import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadEmbeddableScenarios } from '@/modules/scenarios';

import { LESSONS } from './lessons';

/**
 * The authoring rules from `docs/implementation/13-module-learning-center.md`, applied
 * to every lesson.
 *
 * `lesson-pipeline.test.tsx` mounts one lesson and proves the machinery composes.
 * That is the expensive test and one lesson is the right number for it. This is the
 * cheap one, and it runs over all thirty-three: it reads the MDX as text and checks
 * the shape the phase requires -- one `h1`, at least one live simulation, at least one
 * quiz, three to five takeaways, and no wall of prose between two visual elements.
 *
 * Source text rather than a render, deliberately. Mounting thirty-three lessons would
 * pull in every module's scenario catalogue and every React Flow diagram to assert
 * things that are properties of the file. And the prose budget is measurable *only* in
 * the source: once rendered, the distance between two visuals is a layout question.
 */

/*
 * Resolved from the Vitest root rather than from `import.meta.url`: the `ui` project
 * runs in jsdom, where `import.meta.url` is an http: URL and cannot be turned into a
 * path. The root is the repository root, which is where the config lives.
 */
const LESSON_DIR = join(process.cwd(), 'src/modules/learning-center/content/lessons');

/**
 * The spec's rule, verbatim: "no more than ~150 words of continuous prose between two
 * visual elements". Applied as a hard number because a soft budget nobody measures is
 * not a budget.
 */
const PROSE_BUDGET = 150;

const MIN_TAKEAWAYS = 3;
const MAX_TAKEAWAYS = 5;

function source(slug: string): string {
  return readFileSync(join(LESSON_DIR, `${slug}.mdx`), 'utf8');
}

/**
 * Split a lesson into runs of continuous prose.
 *
 * A "visual element" is anything that breaks up reading: a fenced code sample, a table,
 * or one of the capitalised components. Headings break a run too -- a new section is a
 * new run -- but do not themselves count as visuals, so a lesson cannot satisfy the
 * budget by adding subheadings.
 */
function proseRuns(text: string): string[] {
  const lines = text.split('\n');
  const runs: string[] = [];
  let current: string[] = [];

  let inFence = false;
  /** Depth of a multi-line JSX element, so its props are not counted as prose. */
  let inElement = false;

  const flush = () => {
    if (current.length) runs.push(current.join(' '));
    current = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      flush();
      continue;
    }
    if (inFence) continue;

    if (inElement) {
      // `/>` or `</Name>` at the start of a line closes the element blocks this
      // project writes; nothing inside one is prose.
      if (trimmed === '/>' || trimmed.startsWith('</')) inElement = false;
      continue;
    }

    // An MDX authoring comment: one line, never prose.
    if (trimmed.startsWith('{/*')) continue;

    if (/^<[A-Z]/.test(trimmed)) {
      flush();
      // A self-closing element written on one line ends where it began.
      if (!trimmed.endsWith('/>')) inElement = true;
      continue;
    }

    // A table row, or a heading: both end the run without being prose.
    if (trimmed.startsWith('|') || trimmed.startsWith('#')) {
      flush();
      continue;
    }

    if (!trimmed) {
      // A blank line is a paragraph break inside one run, not the end of it.
      continue;
    }

    current.push(trimmed);
  }

  flush();
  return runs;
}

/** Words as a reader meets them, with inline `<Term>` markup taken back out. */
function wordCount(run: string): number {
  return run
    .replace(/<\/?Term[^>]*>/g, '')
    .split(/\s+/)
    .filter(Boolean).length;
}

interface Embed {
  slug: string;
  moduleId: string;
  scenarioId: string;
}

/** Every `<EmbeddedSim module="..." scenario="..." />` written anywhere in the corpus. */
const EMBEDS: Embed[] = LESSONS.flatMap((lesson) =>
  [
    ...source(lesson.slug).matchAll(
      /<EmbeddedSim\s+module="([^"]+)"\s+scenario="([^"]+)"/g,
    ),
  ].map(([, moduleId, scenarioId]) => ({ slug: lesson.slug, moduleId, scenarioId })),
);

const EMBEDDED_MODULE_IDS = [...new Set(EMBEDS.map((embed) => embed.moduleId))].sort();

/**
 * The one assertion that cannot be made by reading a lesson.
 *
 * `EmbeddedSim` is deliberately forgiving -- a module or scenario that does not exist
 * yet renders an explanatory message instead of throwing, so lessons can be written
 * ahead of modules. That is right for authoring and useless for shipping: a typo in a
 * scenario id degrades to a polite notice and nobody notices. Here it is an error.
 *
 * Read through `@/modules/scenarios`, the same manifest the component uses, so this
 * cannot drift from what actually plays -- and so the module boundary rule stays intact
 * (a module may not import another module; the manifest is the exemption).
 *
 * One case per module rather than one for all of them: each case pulls in exactly one
 * module's composition root, which is the expensive part, so a slow environment cannot
 * push the whole check past a single timeout.
 */
describe('every embedded simulation', () => {
  it('is written by at least one lesson', () => {
    expect(EMBEDS.length).toBeGreaterThan(0);
  });

  it.each(EMBEDDED_MODULE_IDS)('exists in %s', async (moduleId) => {
    const scenarios = await loadEmbeddableScenarios(moduleId);
    expect(scenarios, `no embeddable module "${moduleId}"`).toBeDefined();

    const available = scenarios!.map((scenario) => scenario.id);
    for (const embed of EMBEDS.filter((e) => e.moduleId === moduleId)) {
      expect(
        available,
        `${embed.slug} embeds ${moduleId}/${embed.scenarioId}, which does not exist`,
      ).toContain(embed.scenarioId);
    }
  });
});

describe.each(LESSONS.map((lesson) => lesson.slug))('the lesson %s', (slug) => {
  const text = source(slug);

  it('has exactly one h1, and no h1 below it', () => {
    const headings = text.split('\n').filter((line) => /^# /.test(line));
    expect(headings).toHaveLength(1);
    // The h1 is the lesson title, so it must open the file rather than appear
    // somewhere in the middle of it. LessonLayout renders no heading of its own.
    expect(text.indexOf(headings[0])).toBeLessThan(text.indexOf('\n## ') + 1 || Infinity);
  });

  it('plays at least one real simulation', () => {
    expect(text.match(/<EmbeddedSim\b/g) ?? []).not.toHaveLength(0);
  });

  it('checks understanding at least once', () => {
    expect(text.match(/<Quiz\b/g) ?? []).not.toHaveLength(0);
  });

  it(`ends with ${MIN_TAKEAWAYS}-${MAX_TAKEAWAYS} key takeaways`, () => {
    const block = /<KeyTakeaways\s+items=\{\[([\s\S]*?)\]\}/.exec(text);
    expect(block, 'no KeyTakeaways block').not.toBeNull();

    // One entry per line, which is how Prettier formats an array of long strings.
    const items = block![1].split('\n').filter((line) => /^\s*['"`]/.test(line));
    expect(items.length).toBeGreaterThanOrEqual(MIN_TAKEAWAYS);
    expect(items.length).toBeLessThanOrEqual(MAX_TAKEAWAYS);

    // And it is the last thing in the lesson: takeaways summarise, so nothing may
    // follow them.
    expect(text.trimEnd().endsWith('/>')).toBe(true);
    expect(text.lastIndexOf('<KeyTakeaways')).toBeGreaterThan(text.lastIndexOf('<Quiz'));
  });

  it(`never runs more than ${PROSE_BUDGET} words between two visual elements`, () => {
    for (const run of proseRuns(text)) {
      const words = wordCount(run);
      expect(words, `${words} words: "${run.slice(0, 70)}…"`).toBeLessThanOrEqual(
        PROSE_BUDGET,
      );
    }
  });
});
