'use client';

import { CircleCheck, CircleHelp, CircleX, Eye } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import { Badge } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';

import { recordAnswer } from '../progress/actions';
import { useQuizRecord } from '../progress/useProgress';

import { useLessonScope } from './LessonScope';

/**
 * A check on understanding. Not a grade.
 *
 * ## The two kinds, and why the second one is the point
 *
 * `multiple-choice` asks what the reader now knows. `predict` stops mid-flow and asks
 * what happens **next**, before showing them -- which is a different and much better
 * question, because a reader who can predict the next step has a model rather than a
 * memory of the previous paragraph. `reveal` is what plays afterwards; from phase 13.2
 * that is normally an `<EmbeddedSim>` running the very step they just guessed at.
 *
 * ## Rules this component enforces
 *
 * **Every option explains itself.** `why` is required on all of them, right and wrong
 * alike, and all of them are shown once an answer is in. A quiz that says only "wrong"
 * has taught nothing; a reader who picked a wrong option had a reason, and that reason
 * is what needs addressing. The right answer needs its `why` too, because guessing
 * correctly is not understanding.
 *
 * **No score, no streak, no pressure.** Nothing counts anything up, answering again is
 * free and unremarked, and the stored attempt count is never shown as a tally. The one
 * thing progress remembers is whether the last answer was right, so the lesson can say
 * "you have seen this" rather than "you got 3/5".
 *
 * **Answering is not required.** Nothing is gated behind a quiz. A reader who skips
 * every one of them still gets the whole lesson.
 */

export type QuizKind = 'multiple-choice' | 'predict';

export interface QuizOption {
  /** Stable within the quiz. Used for input ids only. */
  id: string;
  label: ReactNode;
  /** Exactly one option per quiz sets this. */
  correct?: boolean;
  /** Why this is the answer, or why it is not. Shown to everyone once one is chosen. */
  why: ReactNode;
}

export interface QuizProps {
  /** Unique within the lesson. The key the answer is recorded under. */
  id: string;
  kind?: QuizKind;
  question: ReactNode;
  options: readonly QuizOption[];
  /**
   * Shown after the reader commits. For `predict`, this is the answer playing out --
   * a simulation, a code block, a diagram. Withheld until then on purpose: shown
   * alongside the question it would answer it.
   */
  reveal?: ReactNode;
  /** Labels the reveal, e.g. "What actually happens". */
  revealLabel?: string;
  className?: string;
}

const KIND_LABEL: Record<QuizKind, string> = {
  'multiple-choice': 'Check yourself',
  predict: 'Predict what happens next',
};

export function Quiz({
  id,
  kind = 'multiple-choice',
  question,
  options,
  reveal,
  revealLabel = 'What actually happens',
  className,
}: QuizProps) {
  const scope = useLessonScope();
  const groupName = useId();
  const [chosenId, setChosenId] = useState<string | null>(null);

  // What a previous visit recorded. `null` until progress is readable on the client,
  // so nothing about it can reach the server render -- see progress/useProgress.ts.
  const previous = useQuizRecord(scope?.slug ?? '', id);

  const chosen = options.find((option) => option.id === chosenId);
  const answered = chosen !== undefined;

  function choose(option: QuizOption) {
    setChosenId(option.id);
    // Outside a lesson (a test, a future summary page) there is nowhere to record it
    // and the quiz simply works without doing so.
    if (scope) recordAnswer(scope.slug, id, option.correct === true);
  }

  return (
    <section
      aria-labelledby={`${groupName}-question`}
      className={cn(
        'border-border bg-surface-raised mt-8 rounded-xl border p-5',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent" icon={<CircleHelp className="size-3.5" />}>
          {KIND_LABEL[kind]}
        </Badge>
        {/*
          Only after hydration, and only when this session has not answered yet:
          repeating "you answered this before" over a fresh answer would be noise.
        */}
        {previous && !answered ? (
          <span className="text-fg-muted text-xs">
            You answered this before &mdash;{' '}
            {previous.correct ? 'correctly' : 'not correctly'}.
          </span>
        ) : null}
      </div>

      <fieldset className="mt-4">
        <legend id={`${groupName}-question`} className="text-fg font-medium">
          {question}
        </legend>

        <div className="mt-4 flex flex-col gap-2">
          {options.map((option) => {
            const isChosen = option.id === chosenId;
            const isCorrect = option.correct === true;
            // Nothing is marked until an answer is in: the right option must not be
            // inferable from the styling of the unanswered question.
            const verdict = answered ? (isCorrect ? 'correct' : 'wrong') : null;

            return (
              <div
                key={option.id}
                className={cn(
                  'rounded-lg border transition-colors',
                  verdict === 'correct' && 'border-state-ok/50 bg-state-ok/10',
                  verdict === 'wrong' &&
                    isChosen &&
                    'border-state-error/50 bg-state-error/10',
                  verdict === 'wrong' && !isChosen && 'border-border',
                  !verdict && 'border-border hover:border-border-strong',
                )}
              >
                <label
                  className={cn(
                    'flex cursor-pointer items-start gap-3 p-3 text-sm',
                    'has-[input:focus-visible]:outline-focus has-[input:focus-visible]:rounded-lg has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2',
                  )}
                >
                  <input
                    type="radio"
                    name={groupName}
                    value={option.id}
                    checked={isChosen}
                    onChange={() => choose(option)}
                    className={cn('accent-accent mt-0.5 size-4 shrink-0', focusRing)}
                  />
                  <span className="text-fg-secondary">{option.label}</span>
                  {/*
                    The verdict per option carries an icon as well as a colour, and the
                    icon has a text label for anyone not seeing either.
                  */}
                  {verdict === 'correct' ? (
                    <span className="ml-auto flex shrink-0 items-center gap-1 text-xs">
                      <CircleCheck aria-hidden="true" className="text-state-ok size-4" />
                      <span className="text-state-ok">Correct</span>
                    </span>
                  ) : null}
                  {verdict === 'wrong' && isChosen ? (
                    <span className="ml-auto flex shrink-0 items-center gap-1 text-xs">
                      <CircleX aria-hidden="true" className="text-state-error size-4" />
                      <span className="text-state-error">Not this one</span>
                    </span>
                  ) : null}
                </label>

                {answered ? (
                  <p className="text-fg-muted border-border/60 mx-3 mb-3 border-t pt-2 text-xs leading-relaxed">
                    {option.why}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </fieldset>

      {/*
        One live region for the outcome, so the answer is announced rather than only
        appearing. The per-option explanations above are inside it in the DOM order a
        reader walks anyway.
      */}
      <p role="status" className="text-fg-secondary mt-4 text-sm">
        {answered
          ? chosen.correct
            ? 'That is the one. Read the other options too -- the reasons they are wrong are the lesson.'
            : 'Not quite. The explanations above say why each option does or does not work; pick another whenever you like.'
          : ''}
      </p>

      {answered && reveal ? (
        <div className="border-border mt-4 border-t pt-4">
          <p className="text-fg-muted flex items-center gap-2 text-xs font-medium tracking-widest uppercase">
            <Eye aria-hidden="true" className="size-3.5" />
            {revealLabel}
          </p>
          <div className="mt-3">{reveal}</div>
        </div>
      ) : null}
    </section>
  );
}
