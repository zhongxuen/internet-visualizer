import { describe, expect, it } from 'vitest';

import { GLOSSARY } from '@/core/glossary';
import { getModule } from '@/modules/registry';

import { getLesson, LESSONS } from './lessons';
import { lessonSlugsWithContent } from './load';
import {
  allLessonParams,
  firstLessonOf,
  glossaryHref,
  lessonHref,
  lessonPath,
  lessonPosition,
  lessonsInTrack,
} from './navigation';
import { getTrack, TRACKS, trackOfLesson } from './tracks';

/**
 * The content model has three files that must agree -- the tracks, the lesson
 * metadata, and the MDX on disk -- plus a glossary that points into both. Nothing in
 * the type system connects them: a slug is a string in all four places.
 *
 * So this suite is the connection. Every assertion below is a way one of those files
 * can be edited and leave the product with a link to nowhere, and each one of them is
 * a typo an author will eventually make.
 */
describe('the curriculum', () => {
  it('gives every lesson a track, and every track only real lessons', () => {
    for (const track of TRACKS) {
      for (const slug of track.lessons) {
        expect(
          getLesson(slug),
          `${track.id} lists an unknown lesson "${slug}"`,
        ).toBeDefined();
      }
    }

    for (const lesson of LESSONS) {
      // A lesson in no track has no URL and cannot be reached. See navigation.ts.
      expect(
        trackOfLesson(lesson.slug),
        `"${lesson.slug}" is in no track, so nothing links to it`,
      ).toBeDefined();
    }
  });

  it('never lists a lesson in two tracks', () => {
    const placements = TRACKS.flatMap((track) => track.lessons);
    expect(new Set(placements).size).toBe(placements.length);
  });

  it('has unique track ids and lesson slugs', () => {
    expect(new Set(TRACKS.map((t) => t.id)).size).toBe(TRACKS.length);
    expect(new Set(LESSONS.map((l) => l.slug)).size).toBe(LESSONS.length);
  });

  /**
   * The set of lessons that exist and the set that are written about must be the same
   * set. This is the assertion the hand-written map in `load.ts` buys: a lesson with
   * no MDX file, and an MDX file no track lists, both fail here rather than at runtime.
   */
  it('has exactly one MDX file per lesson', () => {
    expect(lessonSlugsWithContent().sort()).toEqual(LESSONS.map((l) => l.slug).sort());
  });

  it('keeps every lesson inside the 5-10 minute budget', () => {
    for (const lesson of LESSONS) {
      expect(lesson.minutes, lesson.slug).toBeGreaterThanOrEqual(5);
      expect(lesson.minutes, lesson.slug).toBeLessThanOrEqual(10);
    }
  });

  it('sends every lesson to real modules and real sources', () => {
    for (const lesson of LESSONS) {
      expect(lesson.modules.length, `${lesson.slug} links to no module`).toBeGreaterThan(
        0,
      );
      for (const id of lesson.modules) {
        expect(
          getModule(id),
          `${lesson.slug} links to unknown module "${id}"`,
        ).toBeDefined();
      }

      expect(lesson.references.length, `${lesson.slug} cites nothing`).toBeGreaterThan(0);
      for (const reference of lesson.references) {
        expect(reference.href).toMatch(/^https:\/\//);
      }
    }
  });
});

describe('navigation', () => {
  it('builds every lesson URL under the module route from the registry', () => {
    expect(lessonHref('internet-foundations', 'what-is-a-network')).toBe(
      '/learn/internet-foundations/what-is-a-network',
    );
    expect(glossaryHref()).toBe('/learn/glossary');
  });

  it('gives every lesson a resolvable path', () => {
    for (const lesson of LESSONS) {
      expect(lessonPath(lesson.slug), lesson.slug).toBeDefined();
    }
  });

  it('pre-renders exactly the pairs the tracks describe', () => {
    const params = allLessonParams();

    expect(params).toEqual(
      TRACKS.flatMap((track) =>
        track.lessons.map((lesson) => ({ track: track.id, lesson })),
      ),
    );
  });

  it('numbers a lesson within its track and finds its neighbours', () => {
    const track = TRACKS[0];
    const lessons = lessonsInTrack(track.id);
    expect(lessons.length).toBeGreaterThan(0);

    const first = lessons[0];
    const position = lessonPosition(track.id, first.slug);

    expect(position).toMatchObject({ number: 1, total: lessons.length });
    expect(position?.previous).toBeUndefined();
    expect(position?.next).toBe(lessons[1]);
    expect(firstLessonOf(track)).toBe(first);
  });

  /**
   * The route treats this as a 404 rather than rendering the lesson under the wrong
   * track heading, with the wrong "next" beneath it.
   */
  it('refuses to place a lesson in a track that does not list it', () => {
    expect(lessonPosition('infrastructure', 'what-is-a-network')).toBeUndefined();
    expect(lessonPosition('no-such-track', 'what-is-a-network')).toBeUndefined();
    expect(lessonsInTrack('no-such-track')).toEqual([]);
    expect(getTrack('no-such-track')).toBeUndefined();
  });
});

/**
 * The glossary lives in `src/core/glossary/` now, and its own rules -- unique spellings
 * across the base and every module's extras, the lookup, the popover length, the
 * alphabetical listing -- are asserted there. What stays here is the half only this
 * module can check: that every entry's links land on a real lesson.
 */
describe('the glossary', () => {
  it('points only at lessons and modules that exist', () => {
    for (const entry of GLOSSARY) {
      for (const slug of entry.lessons ?? []) {
        expect(getLesson(slug), `${entry.id} -> unknown lesson "${slug}"`).toBeDefined();
      }
      for (const id of entry.modules ?? []) {
        expect(getModule(id), `${entry.id} -> unknown module "${id}"`).toBeDefined();
      }
    }
  });
});
