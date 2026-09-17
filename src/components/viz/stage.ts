import type { ReactNode } from 'react';

import type { PhaseSummary } from '@/core/sim/result';
import type { Level, StoryMeta } from '@/core/types/story';

/**
 * The Stage contract: what a module hands `SimulationView` beyond its run
 * (docs/implementation/uiux-spec.md §7.4).
 *
 * UX-2.3 builds the Stage against these types and wave 3 moves every module onto them,
 * so they are additive and nothing in them is renamed at the type level. The functions
 * below are the Stage's decisions that are expressible as data in and data out -- which
 * story is shown where, what order the "Go deeper" tabs take, what the step caption says
 * -- kept here so they are tested without mounting anything.
 */

export interface StoryOption {
  id: string;
  /** The technical title, as the module's scenario already has it. */
  title: string;
  summary: string;
  teaches?: readonly string[];
  /** The beginner-facing face of the scenario (§7.1). Optional until its wave-3 pass. */
  story?: StoryMeta;
  /** A heading to list the option under, e.g. 'When things go wrong'. */
  group?: string;
}

export interface StoriesProp {
  options: readonly StoryOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** What a story is called here. Default 'Story'; Network Diagnostics uses 'Network'. */
  label?: string;
}

export interface DeeperTab {
  id: string;
  /** A plain title with the term in it, e.g. 'Address swap (NAT)'. */
  title: string;
  /** One plain line shown at the top of the tab. */
  hint?: string;
  /** `'advanced'` tabs are tagged and ordered last. */
  level?: Level;
  /** Called only while the tab is active. */
  render: () => ReactNode;
}

/** The detail level, as `useDetail()` returns it. */
export type Detail = 'simple' | 'full';

/** How many story options sit in the row before the rest go under "More stories". */
export const MAX_VISIBLE_STORIES = 5;

/** The name a story goes by: its plain title in Simple, its technical title in Full. */
export function storyName(option: StoryOption, detail: Detail): string {
  return detail === 'simple' && option.story ? option.story.plainTitle : option.title;
}

/**
 * Split the options into the row and the "More stories" overflow.
 *
 * Authored order is kept, with one exception: a selected story that would fall into the
 * overflow takes the row's last place, so what is playing is always on screen.
 */
export function splitStories(
  options: readonly StoryOption[],
  selectedId: string,
  max = MAX_VISIBLE_STORIES,
): { visible: StoryOption[]; more: StoryOption[] } {
  if (options.length <= max) return { visible: [...options], more: [] };

  const visible = options.slice(0, max);
  const more = options.slice(max);
  const hidden = more.findIndex((option) => option.id === selectedId);
  if (hidden === -1) return { visible, more };

  const [selected] = more.splice(hidden, 1);
  const bumped = visible.pop()!;
  return { visible: [...visible, selected!], more: [bumped, ...more] };
}

export interface StoryGroup {
  /** `undefined` for options with no `group`. */
  heading: string | undefined;
  options: StoryOption[];
}

/**
 * Consecutive runs of options that share a `group`, in order.
 *
 * Runs rather than buckets: an author who lists a group twice meant two places, and
 * regrouping would reorder a picker they wrote in a deliberate order.
 */
export function groupStories(options: readonly StoryOption[]): StoryGroup[] {
  const groups: StoryGroup[] = [];
  for (const option of options) {
    const last = groups.at(-1);
    if (last && last.heading === option.group) last.options.push(option);
    else groups.push({ heading: option.group, options: [option] });
  }
  return groups;
}

/** The story after `selectedId`, wrapping round; `null` when there is no other. */
export function nextStory(
  options: readonly StoryOption[],
  selectedId: string,
): StoryOption | null {
  if (options.length < 2) return null;
  const index = options.findIndex((option) => option.id === selectedId);
  return options[(index + 1) % options.length] ?? null;
}

/** Tabs in authored order, with `advanced` ones moved to the end (a stable sort). */
export function orderDeeperTabs(tabs: readonly DeeperTab[]): DeeperTab[] {
  return [
    ...tabs.filter((tab) => tab.level !== 'advanced'),
    ...tabs.filter((tab) => tab.level === 'advanced'),
  ];
}

/**
 * Where a run stands, as the Stage's overlays and caption need it.
 *
 * `ready` is before the first play or seek -- `idle` at zero, which is also where a new
 * story starts. `done` is the resting state at the end.
 */
export type StageMoment = 'ready' | 'running' | 'done';

export function stageMoment(status: string, virtualTime: number): StageMoment {
  if (status === 'idle' && virtualTime <= 0) return 'ready';
  return status === 'ended' ? 'done' : 'running';
}

/** What the step caption says, as text, before any glossary word is linked. */
export interface StepCaptionText {
  /** 'Step 2 of 4', or `null` when no step is in force. */
  step: string | null;
  /** Full detail's title line, or `null` in Simple and outside a step. */
  title: string | null;
  text: string;
}

export const DONE_CAPTION = 'Done: here is what happened';

/**
 * The caption for a moment in a run.
 *
 * Simple shows a step's `plain` sentence, falling back to its description when the
 * scenario wrote none; Full shows the title and the description (§5.2). Before the first
 * play it asks the story's question, when there is one.
 */
export function stepCaption(
  phases: readonly PhaseSummary[],
  currentIndex: number,
  moment: StageMoment,
  detail: Detail,
  question?: string,
): StepCaptionText {
  const count = phases.length;
  const steps = `${count} ${count === 1 ? 'step' : 'steps'}`;

  if (moment === 'done') return { step: null, title: null, text: DONE_CAPTION };

  const phase = phases[currentIndex];
  if (moment === 'ready' || !phase) {
    const fallback = count
      ? `Press Play to watch it happen, in ${steps}.`
      : 'Press Play to watch it happen.';
    return { step: null, title: null, text: question ?? fallback };
  }

  const step = `Step ${currentIndex + 1} of ${count}`;
  if (detail === 'full') return { step, title: phase.title, text: phase.description };
  return { step, title: null, text: phase.plain ?? phase.description };
}

/** One line per step for "What just happened": plain in Simple, the title in Full. */
export function recapLines(phases: readonly PhaseSummary[], detail: Detail): string[] {
  return phases.map((phase) =>
    detail === 'simple' ? (phase.plain ?? phase.description) : phase.title,
  );
}
