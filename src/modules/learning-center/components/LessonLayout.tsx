'use client';

import Link from 'next/link';
import { BookOpen, Clock, FileText } from 'lucide-react';
import { useEffect, useMemo, type ReactNode } from 'react';

import { Badge } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';
import { getModule } from '@/modules/registry';

import type { LessonMeta } from '../content/lessons';
import { learnHref, trackHref } from '../content/navigation';
import { getTrack } from '../content/tracks';
import { rememberLessonPosition } from '../progress/actions';

import { LessonNav } from './LessonNav';
import { LessonScopeContext } from './LessonScope';

/**
 * The frame around one lesson.
 *
 * ## What it does and does not draw
 *
 * It draws everything *around* the prose: where you are, how long this takes, where to
 * go and see it running, and what the primary sources are. It deliberately does **not**
 * draw the lesson title. The `#` heading at the top of the MDX file is the page's one
 * `h1`, which means the heading hierarchy a lesson reads with is the one its author
 * wrote and can see, rather than something assembled from a metadata field two files
 * away. `LessonMeta.title` is for the track card and the browser tab.
 *
 * The module and RFC links, on the other hand, are rendered from metadata rather than
 * written into each lesson: "ends with links to the relevant modules and RFCs" is a
 * requirement on every lesson, and requirements that depend on an author remembering
 * are requirements that get forgotten.
 *
 * ## Client, for two small reasons
 *
 * The lesson scope (so a `<Quiz>` knows what it belongs to) and the resume position
 * (so a track card can offer to pick up here) both need the browser. The prose itself
 * stays a server component and is handed in as `children` -- the MDX, the code blocks,
 * and from phase 13.2 the simulations, are all rendered before this file sees them.
 */

export interface LessonLayoutProps {
  lesson: LessonMeta;
  /** The track the lesson was reached through. Fixes prev/next and the breadcrumb. */
  trackId: string;
  /** The compiled MDX. */
  children: ReactNode;
}

export function LessonLayout({ lesson, trackId, children }: LessonLayoutProps) {
  const track = getTrack(trackId);

  const scope = useMemo(() => ({ slug: lesson.slug, trackId }), [lesson.slug, trackId]);

  // "Last position in a track", from the spec's list of what progress remembers. It is
  // recorded on arrival rather than on completion, because the reader who benefits is
  // the one who left in the middle.
  useEffect(() => {
    rememberLessonPosition(trackId, lesson.slug);
  }, [trackId, lesson.slug]);

  const modules = lesson.modules.flatMap((id) => getModule(id) ?? []);

  return (
    <LessonScopeContext value={scope}>
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <nav
          aria-label="Breadcrumb"
          className="text-fg-muted flex flex-wrap items-center gap-2 text-sm"
        >
          <Link
            href={learnHref()}
            className={cn('hover:text-fg rounded-md transition-colors', focusRing)}
          >
            Learning Center
          </Link>
          <span aria-hidden="true">/</span>
          <Link
            href={trackHref(trackId)}
            className={cn('hover:text-fg rounded-md transition-colors', focusRing)}
          >
            {track?.title ?? 'Track'}
          </Link>
        </nav>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-fg-muted flex items-center gap-1.5 text-xs">
            <Clock aria-hidden="true" className="size-3.5" />
            {lesson.minutes} min
          </span>
          <ul className="flex flex-wrap items-center gap-1.5" aria-label="Topics">
            {lesson.topics.map((topic) => (
              <li key={topic}>
                <Badge tone="neutral">{topic}</Badge>
              </li>
            ))}
          </ul>
        </div>

        {/* The MDX. Its `#` heading is this page's h1 -- see the note above. */}
        <article className="mt-6">{children}</article>

        <section aria-labelledby="lesson-next" className="mt-12">
          <h2
            id="lesson-next"
            className="text-fg-muted text-xs font-medium tracking-widest uppercase"
          >
            Take it further
          </h2>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {modules.map((module) => (
              <Link
                key={module.id}
                href={module.route}
                className={cn(
                  'border-border hover:border-border-strong hover:bg-surface-overlay flex items-start gap-3 rounded-lg border p-4 transition-colors',
                  focusRing,
                )}
              >
                <BookOpen
                  aria-hidden="true"
                  className="text-accent mt-0.5 size-4 shrink-0"
                />
                <span className="min-w-0">
                  <span className="text-fg block text-sm font-medium">
                    {module.title}
                  </span>
                  <span className="text-fg-muted mt-1 block text-xs leading-relaxed">
                    {module.summary}
                  </span>
                </span>
              </Link>
            ))}
          </div>

          {lesson.references.length ? (
            <ul className="mt-4 flex flex-col gap-1.5">
              {lesson.references.map((reference) => (
                <li key={reference.href} className="text-xs">
                  <a
                    href={reference.href}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(
                      'text-fg-muted hover:text-fg inline-flex items-baseline gap-2 rounded-sm transition-colors',
                      focusRing,
                    )}
                  >
                    <FileText
                      aria-hidden="true"
                      className="size-3.5 shrink-0 self-center"
                    />
                    <span className="text-fg-secondary font-mono">{reference.label}</span>
                    <span>{reference.title}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <LessonNav trackId={trackId} slug={lesson.slug} />
      </div>
    </LessonScopeContext>
  );
}
