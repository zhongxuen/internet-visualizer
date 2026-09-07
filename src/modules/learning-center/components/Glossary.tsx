import Link from 'next/link';

import { Badge } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';
import { getModule } from '@/modules/registry';

import { sortedGlossary, type GlossaryTerm } from '../content/glossary';
import { getLesson } from '../content/lessons';
import { lessonPath } from '../content/navigation';

/**
 * The whole term list, alphabetically, with somewhere to go from each entry.
 *
 * The counterpart to `<Term>`: the popover answers "what does this word mean" without
 * moving the reader, and this page answers "where do I go to actually understand it".
 * The two read the same file, so the short and the long form can differ in length but
 * never in claim.
 *
 * A server component -- there is nothing interactive here, and a list that grows to
 * every term in the curriculum should not cost the reader a hydration pass.
 */

const linkClasses = cn(
  'text-accent hover:text-accent-strong rounded-sm text-xs underline decoration-dotted underline-offset-4 transition-colors',
  focusRing,
);

function TermEntry({ entry }: { entry: GlossaryTerm }) {
  // Only lessons that exist and sit in a track are linkable. A lesson written but not
  // yet placed in one has no URL, so it is named without a link rather than dropped --
  // the reader learns it is coming.
  const lessons = (entry.lessons ?? []).flatMap((slug) => {
    const lesson = getLesson(slug);
    return lesson ? [{ lesson, href: lessonPath(slug) }] : [];
  });

  const modules = (entry.modules ?? []).flatMap((id) => getModule(id) ?? []);

  return (
    // A list of `h2` sections rather than a `<dl>`: a definition list may not contain
    // heading content, and each term needs to be a heading so it shows up in a screen
    // reader's outline and can be linked to.
    <li
      // `scroll-mt` clears the sticky header when a link jumps to this term.
      id={entry.id}
      className="border-border scroll-mt-20 border-t py-6 first:border-t-0 first:pt-0"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-fg text-base font-medium">{entry.term}</h2>
        {entry.aliases?.length ? (
          <span className="text-fg-muted text-xs">also: {entry.aliases.join(', ')}</span>
        ) : null}
      </div>

      <div className="mt-2">
        <p className="text-fg-secondary max-w-[68ch] text-sm leading-relaxed">
          {entry.definition}
        </p>

        {lessons.length || modules.length ? (
          <div className="mt-3 flex flex-col gap-2 text-xs sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6">
            {lessons.length ? (
              <p className="text-fg-muted flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>Taught in</span>
                {lessons.map(({ lesson, href }) =>
                  href ? (
                    <Link key={lesson.slug} href={href} className={linkClasses}>
                      {lesson.title}
                    </Link>
                  ) : (
                    <span key={lesson.slug} className="text-fg-secondary">
                      {lesson.title}
                    </span>
                  ),
                )}
              </p>
            ) : null}

            {modules.length ? (
              <p className="text-fg-muted flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>Watch it run</span>
                {modules.map((module) => (
                  <Link key={module.id} href={module.route} className={linkClasses}>
                    {module.title}
                  </Link>
                ))}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

export interface GlossaryProps {
  className?: string;
}

export function Glossary({ className }: GlossaryProps) {
  const terms = sortedGlossary();

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-fg text-2xl font-semibold tracking-tight sm:text-3xl">
          Glossary
        </h1>
        <Badge tone="neutral">{terms.length} terms</Badge>
      </div>

      <p className="text-fg-secondary mt-3 max-w-[68ch] leading-relaxed">
        Every term the lessons define, with the same wording they use. Anywhere one of
        these appears in a lesson it is underlined -- hover it, or Tab to it, for the
        short version without leaving the page.
      </p>

      <ul className="mt-10">
        {terms.map((entry) => (
          <TermEntry key={entry.id} entry={entry} />
        ))}
      </ul>
    </div>
  );
}
