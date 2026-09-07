import Link from 'next/link';
import { BookMarked } from 'lucide-react';

import { SafetyBadge } from '@/components/shell';
import { buttonClasses } from '@/components/ui';

import { ProgressReset } from './components/ProgressReset';
import { TrackList } from './components/TrackList';
import { glossaryHref } from './content/navigation';
import { learningCenterMeta } from './meta';

/**
 * The Learning Center index: what there is to learn, and how far you have got.
 *
 * ## Why this module draws its own header
 *
 * Every other module route sits under `(modules)/` and wears `ModuleChrome`, which
 * renders the module title as the page's `h1`. The Learning Center cannot: a lesson's
 * `h1` is the lesson, one per page, and a shared layout that insisted otherwise would
 * put "Learning Center" above every one of them. So the routes live at `app/learn/`
 * outside that group, and the index draws the header itself -- from the registry
 * entry, so the title, summary and safety posture are still the registry's to state
 * and not this file's to invent.
 *
 * A server component. The two interactive pieces below (`TrackList`, `ProgressReset`)
 * are client components because progress is a browser fact; everything else here is
 * static and should cost nothing to hydrate.
 */

export function LearningCenterModule() {
  const meta = learningCenterMeta();

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-fg text-2xl font-semibold tracking-tight sm:text-3xl">
            {meta?.title ?? 'Learning Center'}
          </h1>
          <p className="text-fg-secondary mt-3 max-w-[68ch] leading-relaxed">
            {meta?.summary ??
              'Guided lessons that reuse the same scenarios the modules run.'}
          </p>
        </div>

        {/*
          Same badge every module route carries, for the same reason: a reader should
          read the safety posture rather than have to notice the absence of one. A
          lesson embeds simulations, so it is simulated all the way down.
        */}
        <SafetyBadge variant="simulated" />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Link
          href={glossaryHref()}
          className={buttonClasses({ variant: 'secondary', size: 'sm' })}
        >
          <BookMarked aria-hidden="true" className="mr-2 size-4" />
          Glossary
        </Link>
        <p className="text-fg-muted text-sm">
          Every term the lessons define, in one list.
        </p>
      </div>

      <ProgressReset className="mt-8" />

      <TrackList className="mt-12" />
    </div>
  );
}
