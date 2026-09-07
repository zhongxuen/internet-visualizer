'use client';

import Link from 'next/link';
import { Check, Circle, Clock, PenLine } from 'lucide-react';

import { Badge } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';

import { lessonHref, lessonsInTrack, trackAnchorId } from '../content/navigation';
import { TRACKS, type Track } from '../content/tracks';
import { useProgress } from '../progress/useProgress';
import { isLessonComplete, type ProgressState } from '../progress/store';

/**
 * The curriculum: seven ordered paths, and every lesson in each one.
 *
 * The whole thing is rendered flat rather than behind seven "expand" controls. A
 * learner deciding where to start is answering "what is in here", and a list that
 * hides its contents until clicked cannot answer that.
 *
 * Tracks with no lessons yet are shown, not hidden. The seven paths are the shape of
 * the subject, decided in `docs/implementation/13-module-learning-center.md`; an
 * absent track would read as "this product does not cover TLS", which is both wrong
 * and unfixable by the reader. "Being written" is the honest version.
 *
 * Progress -- the ticks, the counts, the resume link -- is `null` until the browser has
 * been read, and this component renders the same markup the server did until then. The
 * list itself never depends on it.
 */

export interface TrackListProps {
  className?: string;
}

function TrackSection({
  track,
  progress,
}: {
  track: Track;
  progress: ProgressState | null;
}) {
  const lessons = lessonsInTrack(track.id);
  const headingId = trackAnchorId(track.id);
  const completed = progress
    ? lessons.filter((lesson) => isLessonComplete(progress, lesson.slug)).length
    : null;

  const resumeSlug = progress?.lastLesson[track.id];
  const resume = lessons.find((lesson) => lesson.slug === resumeSlug);

  return (
    <section aria-labelledby={headingId} className="scroll-mt-20">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id={headingId} className="text-fg text-lg font-medium tracking-tight">
          {track.title}
        </h3>
        {completed !== null && lessons.length > 0 ? (
          <p className="text-fg-muted text-xs">
            {completed} of {lessons.length} complete
          </p>
        ) : null}
      </div>

      <p className="text-fg-muted mt-1 max-w-[68ch] text-sm leading-relaxed">
        {track.summary}
      </p>

      {lessons.length === 0 ? (
        <p className="border-border text-fg-muted mt-4 flex items-center gap-2 rounded-lg border border-dashed px-4 py-3 text-xs">
          <PenLine aria-hidden="true" className="size-3.5 shrink-0" />
          The lessons for this track are still being written.
        </p>
      ) : (
        <>
          <ol className="mt-4 flex flex-col gap-2">
            {lessons.map((lesson, index) => {
              const done = progress ? isLessonComplete(progress, lesson.slug) : null;

              return (
                <li key={lesson.slug}>
                  <Link
                    href={lessonHref(track.id, lesson.slug)}
                    className={cn(
                      'border-border hover:border-border-strong hover:bg-surface-overlay flex items-start gap-3 rounded-lg border p-4 transition-colors',
                      focusRing,
                    )}
                  >
                    {/*
                      The tick is a state the browser knows and the server does not, so
                      until progress is readable this renders the *number* -- which is
                      true in every state -- rather than an empty circle that would
                      claim "not done" before anything has been checked.
                    */}
                    <span
                      aria-hidden="true"
                      className="mt-0.5 flex size-5 shrink-0 items-center justify-center"
                    >
                      {done === null ? (
                        <span className="text-fg-muted font-mono text-xs tabular-nums">
                          {index + 1}
                        </span>
                      ) : done ? (
                        <Check className="text-state-ok size-4" />
                      ) : (
                        <Circle className="text-fg-muted size-3.5" />
                      )}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-fg text-sm font-medium">
                          {lesson.title}
                        </span>
                        {done ? (
                          // Never colour alone: the tick above is repeated as a word,
                          // and this is what a screen reader reads.
                          <span className="text-state-ok text-xs">Completed</span>
                        ) : null}
                      </span>
                      <span className="text-fg-muted mt-1 block text-xs leading-relaxed">
                        {lesson.summary}
                      </span>
                    </span>

                    <span className="text-fg-muted flex shrink-0 items-center gap-1 text-xs">
                      <Clock aria-hidden="true" className="size-3.5" />
                      {lesson.minutes} min
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>

          {resume ? (
            <p className="mt-3 text-xs">
              <Link
                href={lessonHref(track.id, resume.slug)}
                className={cn(
                  'text-accent hover:text-accent-strong rounded-sm underline decoration-dotted underline-offset-4 transition-colors',
                  focusRing,
                )}
              >
                Pick up where you left off: {resume.title}
              </Link>
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

export function TrackList({ className }: TrackListProps) {
  // One subscription for the whole list rather than one per lesson row: the ticks all
  // answer the same question and re-render together anyway.
  const progress = useProgress();

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-fg-muted text-xs font-medium tracking-widest uppercase">
          Tracks
        </h2>
        <Badge tone="neutral">{TRACKS.length} paths</Badge>
      </div>

      <div className="mt-6 flex flex-col gap-10">
        {TRACKS.map((track) => (
          <TrackSection key={track.id} track={track} progress={progress} />
        ))}
      </div>
    </div>
  );
}
