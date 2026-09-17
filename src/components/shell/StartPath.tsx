import Link from 'next/link';
import { Check } from 'lucide-react';

import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';

export interface StartPathItem {
  slug: string;
  title: string;
  href: string;
}

export interface StartPathProps {
  steps: readonly StartPathItem[];
  /**
   * Slugs of the lessons already done, or `null` while that is not known -- on the
   * server and through hydration, because progress lives only in `localStorage`
   * (learning-center/progress/store.ts). `null` draws exactly what "nothing done" draws.
   */
  completed: ReadonlySet<string> | null;
  className?: string;
}

/**
 * "Your path": the First steps track as six numbered stops, each linking to its lesson,
 * with a tick on the ones already done (uiux-spec.md §5.5).
 *
 * Presentational, and deliberately ignorant of where progress comes from: the shell may
 * not import a module (CLAUDE.md, architecture rule 3), so the client island that reads
 * the Learning Center's store lives beside the home page and hands the answer in.
 *
 * **The tick costs no layout.** Every step always renders its tick box at full size; a
 * done step only makes it visible, and says "done" to a screen reader through text that
 * takes no space. Hydrating progress therefore changes paint, never geometry.
 */
export function StartPath({ steps, completed, className }: StartPathProps) {
  return (
    <ol
      className={cn(
        'grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-6 lg:gap-3',
        className,
      )}
    >
      {steps.map((step, index) => {
        const done = completed?.has(step.slug) ?? false;

        return (
          <li key={step.slug} className="flex">
            <Link
              href={step.href}
              data-done={done || undefined}
              className={cn(
                'group border-border bg-surface-raised hover:border-border-strong hover:bg-surface-overlay',
                'min-h-target flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors lg:flex-col lg:items-start',
                focusRing,
              )}
            >
              <span className="relative inline-flex shrink-0">
                <span
                  aria-hidden="true"
                  className="border-border-strong text-fg-secondary group-data-done:border-state-ok group-data-done:text-state-ok inline-flex size-8 items-center justify-center rounded-full border font-mono text-sm font-semibold"
                >
                  {index + 1}
                </span>
                {/* Always in the layout; only its visibility follows progress. */}
                <span
                  aria-hidden="true"
                  className="bg-state-ok text-accent-ink invisible absolute -right-1.5 -bottom-1 inline-flex size-4 items-center justify-center rounded-full group-data-done:visible"
                >
                  <Check className="size-3" strokeWidth={3} />
                </span>
              </span>
              <span className="text-fg text-sm leading-snug font-medium">
                {/*
                  The spaces sit outside the hidden spans: name computation trims a
                  hidden span's own text, which would read "Step 1:What happens…".
                */}
                <span className="sr-only">Step {index + 1}:</span> {step.title}
                {done ? (
                  <>
                    {' '}
                    <span className="sr-only">(done)</span>
                  </>
                ) : null}
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
