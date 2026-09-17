import { lessonHref } from '@/modules/learning-center/content/navigation';

/**
 * Where "Start here" lands: the first lesson of the First steps track
 * (docs/implementation/uiux-spec.md §7.7).
 *
 * The track is being written in parallel with this redirect (UX-2.6), so for now the
 * lesson is named by the slug §7.7 gives it, in this one place. UX-W2 replaces the
 * slug with the track's own first lesson and deletes this note -- until then, a
 * renamed lesson breaks "Start here" here and nowhere else.
 */
export const START_HERE_DESTINATION = lessonHref(
  'first-steps',
  'what-happens-when-you-open-a-website',
);
