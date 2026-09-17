import { describe, expect, it } from 'vitest';

import type { PhaseSummary } from '@/core/sim/result';

import {
  DONE_CAPTION,
  groupStories,
  nextStory,
  orderDeeperTabs,
  recapLines,
  splitStories,
  stageMoment,
  stepCaption,
  storyName,
  type DeeperTab,
  type StoryOption,
} from './stage';

const option = (id: string, extra: Partial<StoryOption> = {}): StoryOption => ({
  id,
  title: `Title ${id}`,
  summary: `Summary ${id}`,
  ...extra,
});

const PHASES: PhaseSummary[] = [
  {
    index: 0,
    id: 'a',
    title: 'Handshake',
    description: 'SYN, SYN-ACK, ACK.',
    plain: 'The two ends greet each other.',
    startMs: 0,
    endMs: 10,
  },
  {
    index: 1,
    id: 'b',
    title: 'Request',
    description: 'GET / over TLS.',
    startMs: 10,
    endMs: 20,
  },
];

describe('storyName', () => {
  const told = option('x', {
    story: { plainTitle: 'A first visit', question: 'What happens?', level: 'beginner' },
  });

  it('is the plain title in Simple and the technical title in Full', () => {
    expect(storyName(told, 'simple')).toBe('A first visit');
    expect(storyName(told, 'full')).toBe('Title x');
  });

  it('falls back to the title when there is no story yet', () => {
    expect(storyName(option('y'), 'simple')).toBe('Title y');
  });
});

describe('splitStories', () => {
  const seven = ['1', '2', '3', '4', '5', '6', '7'].map((id) => option(id));

  it('keeps everything in the row when it fits', () => {
    const { visible, more } = splitStories(seven.slice(0, 5), '1');
    expect(visible.map((o) => o.id)).toEqual(['1', '2', '3', '4', '5']);
    expect(more).toEqual([]);
  });

  it('shows five, then the rest under "More stories"', () => {
    const { visible, more } = splitStories(seven, '2');
    expect(visible.map((o) => o.id)).toEqual(['1', '2', '3', '4', '5']);
    expect(more.map((o) => o.id)).toEqual(['6', '7']);
  });

  it('brings a selected story out of the overflow into the row’s last place', () => {
    const { visible, more } = splitStories(seven, '7');
    expect(visible.map((o) => o.id)).toEqual(['1', '2', '3', '4', '7']);
    expect(more.map((o) => o.id)).toEqual(['5', '6']);
  });
});

describe('groupStories', () => {
  it('groups consecutive runs and keeps authored order', () => {
    const groups = groupStories([
      option('a'),
      option('b', { group: 'When things go wrong' }),
      option('c', { group: 'When things go wrong' }),
      option('d'),
    ]);

    expect(groups.map((g) => [g.heading, g.options.map((o) => o.id)])).toEqual([
      [undefined, ['a']],
      ['When things go wrong', ['b', 'c']],
      [undefined, ['d']],
    ]);
  });
});

describe('nextStory', () => {
  it('moves to the next option, wrapping round', () => {
    const options = [option('a'), option('b')];
    expect(nextStory(options, 'a')?.id).toBe('b');
    expect(nextStory(options, 'b')?.id).toBe('a');
  });

  it('is null when there is nowhere else to go', () => {
    expect(nextStory([option('a')], 'a')).toBeNull();
  });
});

describe('orderDeeperTabs', () => {
  it('puts advanced tabs last, keeping authored order within each', () => {
    const tab = (id: string, level?: DeeperTab['level']): DeeperTab => ({
      id,
      title: id,
      level,
      render: () => null,
    });
    const ordered = orderDeeperTabs([
      tab('nat', 'advanced'),
      tab('hops'),
      tab('bits', 'advanced'),
      tab('layers', 'beginner'),
    ]);
    expect(ordered.map((t) => t.id)).toEqual(['hops', 'layers', 'nat', 'bits']);
  });
});

describe('stageMoment', () => {
  it('is ready only at rest at the start, done only at the end', () => {
    expect(stageMoment('idle', 0)).toBe('ready');
    expect(stageMoment('paused', 0)).toBe('running');
    expect(stageMoment('playing', 5)).toBe('running');
    expect(stageMoment('ended', 20)).toBe('done');
  });
});

describe('stepCaption', () => {
  it('asks the question before the first play, or says how many steps there are', () => {
    expect(stepCaption(PHASES, -1, 'ready', 'simple', 'Why?').text).toBe('Why?');
    expect(stepCaption(PHASES, -1, 'ready', 'simple').text).toBe(
      'Press Play to watch it happen, in 2 steps.',
    );
    expect(stepCaption([PHASES[0]!], -1, 'ready', 'full').text).toMatch(/in 1 step\.$/);
    expect(stepCaption([], -1, 'ready', 'full').text).toBe(
      'Press Play to watch it happen.',
    );
  });

  it('tells a step plainly in Simple, falling back to the description', () => {
    expect(stepCaption(PHASES, 0, 'running', 'simple')).toEqual({
      step: 'Step 1 of 2',
      title: null,
      text: 'The two ends greet each other.',
    });
    expect(stepCaption(PHASES, 1, 'running', 'simple').text).toBe('GET / over TLS.');
  });

  it('tells the title and the description in Full detail', () => {
    expect(stepCaption(PHASES, 0, 'running', 'full')).toEqual({
      step: 'Step 1 of 2',
      title: 'Handshake',
      text: 'SYN, SYN-ACK, ACK.',
    });
  });

  it('says it is done at the end', () => {
    expect(stepCaption(PHASES, 1, 'done', 'simple').text).toBe(DONE_CAPTION);
  });

  it('asks the question again when a seek lands before the first step', () => {
    expect(stepCaption(PHASES, -1, 'running', 'simple', 'Why?')).toEqual({
      step: null,
      title: null,
      text: 'Why?',
    });
  });
});

describe('recapLines', () => {
  it('is one plain line per step in Simple, and the titles in Full', () => {
    expect(recapLines(PHASES, 'simple')).toEqual([
      'The two ends greet each other.',
      'GET / over TLS.',
    ]);
    expect(recapLines(PHASES, 'full')).toEqual(['Handshake', 'Request']);
  });
});
