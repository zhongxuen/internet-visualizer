/**
 * Where lessons are, and what comes before and after each one.
 *
 * Every URL the Learning Center emits is built here. Two reasons that matters:
 *
 *  - the module's base path comes from the registry (`learningCenterRoute()`), so
 *    moving the Learning Center is a one-line registry edit and no link breaks;
 *  - `generateStaticParams` and the navigation buttons derive from the *same*
 *    functions, so a lesson that is linked is a lesson that was pre-rendered, and a
 *    lesson that was not cannot be linked to.
 *
 * Order comes from `TRACKS[].lessons` and nowhere else -- see the note in `tracks.ts`.
 */

import { learningCenterRoute } from '../meta';

import { getLesson, type LessonMeta } from './lessons';
import { getTrack, trackOfLesson, TRACKS, type Track } from './tracks';

/** The `/learn` index. */
export function learnHref(): string {
  return learningCenterRoute();
}

/** The glossary, which is a sibling of the tracks rather than a lesson in one. */
export function glossaryHref(): string {
  return `${learningCenterRoute()}/glossary`;
}

/**
 * A track has no page of its own -- it is a section of the index -- so linking to one
 * is an anchor. `TrackList` renders the matching `id`.
 */
export function trackHref(trackId: string): string {
  return `${learningCenterRoute()}#${trackAnchorId(trackId)}`;
}

/** The DOM id `trackHref` points at. Prefixed so it cannot collide with a lesson's. */
export function trackAnchorId(trackId: string): string {
  return `track-${trackId}`;
}

/** `/learn/<track>/<lesson>` -- the shape the route file declares. */
export function lessonHref(trackId: string, slug: string): string {
  return `${learningCenterRoute()}/${trackId}/${slug}`;
}

/**
 * The canonical URL of a lesson, resolving its track for the caller.
 *
 * `undefined` for a lesson no track lists: such a lesson has no place in the
 * curriculum and therefore no address. The content test asserts there are none.
 */
export function lessonPath(slug: string): string | undefined {
  const track = trackOfLesson(slug);
  return track ? lessonHref(track.id, slug) : undefined;
}

/**
 * A track's lessons as metadata, in teaching order.
 *
 * Slugs with no `LESSONS` entry are dropped rather than rendered as a broken link --
 * the content test is where that becomes an error, so a typo fails the suite instead
 * of shipping a dead card.
 */
export function lessonsInTrack(trackId: string): LessonMeta[] {
  const track = getTrack(trackId);
  if (!track) return [];

  return track.lessons
    .map((slug) => getLesson(slug))
    .filter((lesson): lesson is LessonMeta => lesson !== undefined);
}

export interface LessonPosition {
  /** 1-based, for "Lesson 2 of 6". */
  number: number;
  total: number;
  previous?: LessonMeta;
  next?: LessonMeta;
}

/**
 * Where a lesson sits in its track, and its neighbours.
 *
 * `undefined` when the lesson is not in that track at all, which is the same condition
 * the route treats as a 404 -- a lesson reached through the wrong track's URL is a
 * wrong URL, not a lesson to render under the wrong heading.
 */
export function lessonPosition(
  trackId: string,
  slug: string,
): LessonPosition | undefined {
  const lessons = lessonsInTrack(trackId);
  const index = lessons.findIndex((lesson) => lesson.slug === slug);
  if (index < 0) return undefined;

  return {
    number: index + 1,
    total: lessons.length,
    previous: lessons[index - 1],
    next: lessons[index + 1],
  };
}

/** The lesson a track opens with, if it has one yet. */
export function firstLessonOf(track: Track): LessonMeta | undefined {
  return lessonsInTrack(track.id)[0];
}

/** Every track/lesson pair, in curriculum order. Feeds `generateStaticParams`. */
export function allLessonParams(): { track: string; lesson: string }[] {
  return TRACKS.flatMap((track) =>
    lessonsInTrack(track.id).map((lesson) => ({
      track: track.id,
      lesson: lesson.slug,
    })),
  );
}
