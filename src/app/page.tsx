import Link from 'next/link';
import { Play } from 'lucide-react';

import { HeroJourney, ModuleGrid, QuickStart } from '@/components/shell';
import { buttonClasses } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';
import { firstStepsPath } from '@/modules/learning-center/content/navigation';
import { MODULE_CHAPTERS, MODULES } from '@/modules/registry';

import { StartPathProgress } from './_home/StartPathProgress';

/** `/start` redirects to the first lesson of First steps (UX-2.1). */
const START_HREF = '/start';

/**
 * Home — a page that starts somewhere (docs/implementation/uiux-spec.md §5.5).
 *
 * Top to bottom it answers the beginner's ten seconds: the question the product answers
 * as the `h1`, one primary button, a picture of the journey, the six-step path with
 * ticks for what is done, then every module grouped by the question it answers.
 *
 * Everything is a server component except two small islands: `QuickStart`'s form and
 * `StartPathProgress`, which reads progress from `localStorage`. The hero is CSS.
 */
export default function Home() {
  /*
   * Found rather than named. `tests/registry.test.ts` asserts there is exactly one, and
   * looking it up here means the sentence below cannot end up pointing at the wrong
   * module or surviving a rename.
   */
  const live = MODULES.find((module) => module.usesRealNetwork);

  // The step count and the minutes are the First steps track's own, not a copy.
  const { steps, minutes } = firstStepsPath();

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 sm:py-16">
      <section className="max-w-3xl">
        <h1 className="text-fg text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          How does the internet actually work?
        </h1>
        <p className="text-fg-secondary text-lead mt-4 text-pretty">
          Watch your message leave your laptop, cross the world, and come back.
        </p>

        <div className="mt-8 flex flex-col gap-6 sm:flex-row sm:items-end sm:gap-8">
          <div className="flex flex-col items-start gap-2">
            <Link
              href={START_HREF}
              aria-describedby="start-here-length"
              className={buttonClasses({ className: 'px-6' })}
            >
              <Play aria-hidden="true" className="size-4" />
              Start here
            </Link>
            <p id="start-here-length" className="text-fg-muted text-sm">
              {steps.length} short steps &middot; about {minutes} minutes
            </p>
          </div>

          <QuickStart />
        </div>
      </section>

      <HeroJourney className="mt-10 sm:mt-12" />

      <section aria-labelledby="path-heading" className="mt-14">
        <h2 id="path-heading" className="text-fg text-xl font-semibold tracking-tight">
          Your path
        </h2>
        <StartPathProgress steps={steps} className="mt-4" />
      </section>

      {/* `scroll-mt` clears the sticky header when a link lands on `/#explore`. */}
      <section
        aria-labelledby="explore-heading"
        id="explore"
        className="mt-16 scroll-mt-20"
      >
        <h2 id="explore-heading" className="text-fg text-xl font-semibold tracking-tight">
          Explore by question
        </h2>

        <div className="mt-6 flex flex-col gap-10">
          {MODULE_CHAPTERS.map((chapter) => (
            <section
              key={chapter.key}
              aria-labelledby={`chapter-${chapter.key}`}
              className="lg:grid lg:grid-cols-[16rem_1fr] lg:gap-8"
            >
              <h3
                id={`chapter-${chapter.key}`}
                className="text-fg-secondary text-lead font-medium text-balance"
              >
                {chapter.question}
              </h3>
              <ModuleGrid
                chapter={chapter.key}
                headingLevel={4}
                className="mt-4 lg:mt-0"
              />
            </section>
          ))}
        </div>
      </section>

      {/*
        The safety posture of the whole product, stated once and exactly: "everything is
        simulated" with an unmentioned exception is worse than no claim at all, so the one
        module that can go live is named here, and each card wears its own badge.
      */}
      <p className="text-fg-muted border-border mt-16 border-t pt-6 text-sm">
        Everything here runs in your browser
        {live ? (
          <>
            , except{' '}
            <Link
              href={live.route}
              className={cn(
                'text-fg-secondary hover:text-fg underline underline-offset-2',
                focusRing,
              )}
            >
              {live.title}
            </Link>
            &rsquo; Live mode, which only runs when you switch it on.
          </>
        ) : (
          '.'
        )}
      </p>
    </div>
  );
}
