import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import {
  allLessonParams,
  getLesson,
  getTrack,
  LessonLayout,
  LESSON_COMPONENTS,
  loadLessonContent,
} from '@/modules/learning-center';

/**
 * `/learn/[track]/[lesson]` -- one lesson.
 *
 * The lesson is MDX compiled at build time and imported here; the surrounding frame,
 * the quizzes and the progress are React. `LESSON_COMPONENTS` is what makes `<Quiz>`
 * and `<Term>` legal inside a `.mdx` file that imports nothing.
 *
 * Both dynamic segments are checked, not just the lesson: reaching a real lesson
 * through a track that does not list it would render the right prose under the wrong
 * "Lesson 3 of 6" and offer the wrong "next", so it is a wrong URL and gets the answer
 * a wrong URL gets.
 */

/**
 * Every lesson is pre-rendered, and `dynamicParams = false` means nothing else exists.
 * The curriculum is a fixed set of files in this repository -- there is no such thing
 * as a lesson that was not known at build time, so a URL outside the list is a typo
 * and should 404 rather than reach a handler.
 */
export function generateStaticParams() {
  return allLessonParams();
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: PageProps<'/learn/[track]/[lesson]'>): Promise<Metadata> {
  const { lesson: slug } = await params;
  const lesson = getLesson(slug);

  return lesson ? { title: lesson.title, description: lesson.summary } : {};
}

export default async function LessonPage({
  params,
}: PageProps<'/learn/[track]/[lesson]'>) {
  const { track: trackId, lesson: slug } = await params;

  const track = getTrack(trackId);
  const lesson = getLesson(slug);
  if (!track || !lesson || !track.lessons.includes(slug)) notFound();

  const Lesson = await loadLessonContent(slug);
  if (!Lesson) notFound();

  return (
    <LessonLayout lesson={lesson} trackId={track.id}>
      <Lesson components={LESSON_COMPONENTS} />
    </LessonLayout>
  );
}
