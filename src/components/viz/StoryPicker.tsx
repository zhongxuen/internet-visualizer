'use client';

import { ChevronDown } from 'lucide-react';
import { memo, useId } from 'react';

import { TermText } from '@/components/glossary';
import { useDetail } from '@/components/prefs';
import { Badge, Disclosure, Popover, Select } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import type { Level } from '@/core/types/story';
import { cn } from '@/lib/cn';

import {
  groupStories,
  splitStories,
  storyName,
  type Detail,
  type StoriesProp,
  type StoryOption,
} from './stage';

/**
 * The one scenario picker (uiux-spec.md §5.3, principle 8: one picker, everywhere).
 *
 * Five copies of a picker existed before this; a module now passes `stories` and gets
 * this one.
 *
 * - **Simple:** each option is its plain title and a level chip; the chosen story's
 *   question sits underneath.
 * - **Full detail:** each option is its technical title; the chosen story's summary sits
 *   underneath, with "What this run teaches" one click away.
 * - **No `story` yet** (every scenario until its module's wave-3 pass): the title and
 *   the summary, in either mode.
 *
 * At `lg` the options are a row of toggle buttons, at most five, then "More stories";
 * below `lg` they are one native `<select>`, which is the control a phone already knows.
 * Both are rendered and CSS picks one, so the server HTML is already right at either
 * width and nothing moves at hydration. The hidden one is `display: none`, which takes
 * it out of the accessibility tree as well as off the screen.
 */

const LEVEL_WORD: Record<Level, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

const LEVEL_TONE = {
  beginner: 'ok',
  intermediate: 'accent',
  advanced: 'warn',
} as const;

export interface StoryPickerProps extends StoriesProp {
  className?: string;
}

function LevelChip({ level }: { level: Level }) {
  return <Badge tone={LEVEL_TONE[level]}>{LEVEL_WORD[level]}</Badge>;
}

function OptionButton({
  option,
  detail,
  selected,
  onSelect,
  className,
}: {
  option: StoryOption;
  detail: Detail;
  selected: boolean;
  onSelect: (id: string) => void;
  className?: string;
}) {
  const simple = detail === 'simple' && option.story;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(option.id)}
      className={cn(
        'min-h-target inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-sm font-medium transition-colors',
        selected
          ? 'border-accent bg-accent/15 text-fg'
          : 'border-border bg-surface-raised text-fg-secondary hover:border-border-strong hover:text-fg',
        focusRing,
        className,
      )}
    >
      <span>{storyName(option, detail)}</span>
      {simple ? <LevelChip level={option.story!.level} /> : null}
    </button>
  );
}

export const StoryPicker = memo(function StoryPicker({
  options,
  selectedId,
  onSelect,
  label = 'Story',
  className,
}: StoryPickerProps) {
  const detail = useDetail();
  const selectId = useId();

  const selected = options.find((option) => option.id === selectedId) ?? options[0];
  if (!selected) return null;

  const { visible, more } = splitStories(options, selected.id);
  const plain = detail === 'simple' && selected.story;

  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      {/* lg and up: a row of toggles, grouped, then the overflow. */}
      <div
        role="group"
        aria-label={label}
        className="hidden flex-wrap items-center gap-x-3 gap-y-2 lg:flex"
      >
        <span aria-hidden="true" className="text-fg-muted text-sm font-medium">
          {label}:
        </span>
        {groupStories(visible).map((group, index) => (
          <div
            key={`${group.heading ?? ''}-${index}`}
            role={group.heading ? 'group' : undefined}
            aria-label={group.heading}
            className="flex flex-wrap items-center gap-1.5"
          >
            {group.heading ? (
              <span aria-hidden="true" className="text-fg-muted text-caption">
                {group.heading}
              </span>
            ) : null}
            {group.options.map((option) => (
              <OptionButton
                key={option.id}
                option={option}
                detail={detail}
                selected={option.id === selected.id}
                onSelect={onSelect}
              />
            ))}
          </div>
        ))}

        {more.length ? (
          <Popover
            label={`More ${label.toLowerCase()} options`}
            align="start"
            triggerVariant="secondary"
            triggerClassName="gap-1.5"
            trigger={
              <>
                More stories
                <ChevronDown aria-hidden="true" className="size-4" />
              </>
            }
          >
            {({ close }) => (
              <div className="flex flex-col gap-3">
                {groupStories(more).map((group, index) => (
                  <div
                    key={`${group.heading ?? ''}-${index}`}
                    role="group"
                    aria-label={group.heading ?? `More ${label.toLowerCase()} options`}
                    className="flex flex-col gap-1.5"
                  >
                    {group.heading ? (
                      <p aria-hidden="true" className="text-fg-muted text-caption">
                        {group.heading}
                      </p>
                    ) : null}
                    {group.options.map((option) => (
                      <OptionButton
                        key={option.id}
                        option={option}
                        detail={detail}
                        selected={false}
                        onSelect={(id) => {
                          onSelect(id);
                          close();
                        }}
                        className="w-full justify-between"
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </Popover>
        ) : null}
      </div>

      {/* Below lg: one native select. */}
      <div className="flex min-w-0 items-center gap-2 lg:hidden">
        <label htmlFor={selectId} className="text-fg-muted shrink-0 text-sm font-medium">
          {label}
        </label>
        <Select
          id={selectId}
          value={selected.id}
          onChange={(event) => onSelect(event.target.value)}
          className="min-w-0 flex-1"
        >
          {groupStories(options).map((group, index) =>
            group.heading ? (
              <optgroup key={`${group.heading}-${index}`} label={group.heading}>
                {group.options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {storyName(option, detail)}
                  </option>
                ))}
              </optgroup>
            ) : (
              group.options.map((option) => (
                <option key={option.id} value={option.id}>
                  {storyName(option, detail)}
                </option>
              ))
            ),
          )}
        </Select>
        {plain ? <LevelChip level={selected.story!.level} /> : null}
      </div>

      {/* What the chosen story is about. */}
      {plain ? (
        // A div: a glossary word opens a popover, and a <p> may not hold its panel.
        <div className="text-fg text-body leading-relaxed">
          <TermText text={selected.story!.question} />
        </div>
      ) : (
        <p className="text-fg-muted max-w-3xl text-sm leading-relaxed">
          {selected.summary}
        </p>
      )}

      {detail === 'full' && selected.teaches?.length ? (
        <Disclosure summary="What this run teaches" lazy className="max-w-3xl">
          <ul className="text-fg-secondary flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed">
            {selected.teaches.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </Disclosure>
      ) : null}
    </div>
  );
});
