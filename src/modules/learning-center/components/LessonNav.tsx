'use client';

import Link from 'next/link';
import { ArrowLeft, ArrowRight, Check, Circle } from 'lucide-react';

import { Button } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';

import {
  lessonHref,
  lessonPosition,
  lessonsInTrack,
  trackHref,
} from '../content/navigation';
import { getTrack } from '../content/tracks';
import { markLessonComplete } from '../progress/actions';
import { useLessonComplete, useTrackProgress } from '../progress/useProgress';

/**
 * Where you are in the track, whether you are done with this one, and what is next.
 *
 * Everything about position comes from `TRACKS[].lessons`, so "next" is the curriculum
 * order and not something a lesson asserts about itself.
 *
 * ## The client-only half
 *
 * Two things here depend on `localStorage` -- the completed count and the state of the
 * button -- and both render as `null` until the browser has been read. The count then
 * simply appears; the button renders its *unknown* state as an outline with no verdict
 * either way, rather than defaulting to "not complete" and flipping a tick on a moment
 * later. A control that lies for one frame is worse than one that waits for one.
 *
 * The prev/next links have no such dependency and render on the server with everything
 * else, because navigation must work before, during and without hydration.
 */

export interface LessonNavProps {
  trackId: string;
  slug: string;
  className?: string;
}

export function LessonNav({ trackId, slug, className }: LessonNavProps) {
  const track = getTrack(trackId);
  const position = lessonPosition(trackId, slug);
  const slugs = lessonsInTrack(trackId).map((lesson) => lesson.slug);

  const progress = useTrackProgress(trackId, slugs);
  const complete = useLessonComplete(slug);

  // A lesson reached through a track that does not list it. The route 404s before this
  // renders; this is the belt to that braces.
  if (!track || !position) return null;

  const { number, total, previous, next } = position;
  const done = progress?.completed ?? 0;

  return (
    <nav
      aria-label="Lesson"
      className={cn('border-border mt-12 border-t pt-6', className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-fg-muted text-xs">
            <Link
              href={trackHref(trackId)}
              className={cn(
                'hover:text-fg rounded-sm underline decoration-dotted underline-offset-4 transition-colors',
                focusRing,
              )}
            >
              {track.title}
            </Link>
            {' · '}
            Lesson {number} of {total}
            {/* Only once the browser has answered. See the note above. */}
            {progress ? ` · ${done} complete` : null}
          </p>

          {/*
            The bar is decorative -- the sentence above already carries the numbers --
            so it is hidden from assistive tech rather than duplicated into it.
          */}
          <div
            aria-hidden="true"
            className="bg-surface-overlay mt-2 h-1 w-48 overflow-hidden rounded-full"
          >
            <div
              className="bg-accent h-full rounded-full transition-[width] duration-[--dur-base]"
              style={{ width: total > 0 ? `${(done / total) * 100}%` : '0%' }}
            />
          </div>
        </div>

        <Button
          variant={complete ? 'secondary' : 'primary'}
          size="sm"
          // `complete === null` means progress is not readable yet. Pressing then would
          // toggle from a state nobody knows, so the control waits one render instead.
          disabled={complete === null}
          aria-pressed={complete ?? false}
          onClick={() => markLessonComplete(slug, !complete)}
          icon={complete ? <Check className="size-4" /> : <Circle className="size-4" />}
        >
          {complete ? 'Completed' : 'Mark complete'}
        </Button>
      </div>

      <div className="mt-6 flex flex-wrap items-stretch justify-between gap-3">
        {previous ? (
          <Link
            href={lessonHref(trackId, previous.slug)}
            rel="prev"
            className={cn(
              'border-border hover:border-border-strong hover:bg-surface-overlay group flex max-w-full min-w-0 flex-col rounded-lg border px-4 py-3 transition-colors',
              focusRing,
            )}
          >
            <span className="text-fg-muted flex items-center gap-1.5 text-xs">
              <ArrowLeft aria-hidden="true" className="size-3.5" />
              Previous
            </span>
            <span className="text-fg mt-1 truncate text-sm font-medium">
              {previous.title}
            </span>
          </Link>
        ) : (
          // A spacer, so "next" stays right-aligned at the start of a track.
          <span />
        )}

        {next ? (
          <Link
            href={lessonHref(trackId, next.slug)}
            rel="next"
            className={cn(
              'border-border hover:border-border-strong hover:bg-surface-overlay group flex max-w-full min-w-0 flex-col rounded-lg border px-4 py-3 text-right transition-colors',
              focusRing,
            )}
          >
            <span className="text-fg-muted flex items-center justify-end gap-1.5 text-xs">
              Next
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </span>
            <span className="text-fg mt-1 truncate text-sm font-medium">
              {next.title}
            </span>
          </Link>
        ) : (
          <Link
            href={trackHref(trackId)}
            className={cn(
              'border-border hover:border-border-strong hover:bg-surface-overlay flex max-w-full min-w-0 flex-col rounded-lg border px-4 py-3 text-right transition-colors',
              focusRing,
            )}
          >
            <span className="text-fg-muted flex items-center justify-end gap-1.5 text-xs">
              End of track
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </span>
            <span className="text-fg mt-1 truncate text-sm font-medium">
              Back to {track.title}
            </span>
          </Link>
        )}
      </div>
    </nav>
  );
}
