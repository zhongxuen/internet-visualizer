import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { MDX_ELEMENTS } from '@/mdx-components';

import { LESSON_COMPONENTS } from './components/lessonComponents';
import { LessonLayout } from './components/LessonLayout';
import { getLesson } from './content/lessons';
import { trackOfLesson } from './content/tracks';
import { resetProgress } from './progress/actions';
import {
  isLessonComplete,
  progressStore,
  quizRecord,
  type ProgressState,
} from './progress/store';

import Lesson from './content/lessons/what-is-a-network.mdx';

/**
 * The pipeline, end to end, on the real lesson.
 *
 * Everything phase 13.1 built has to meet in one place for a lesson to render at all:
 * the MDX compiler, the element mapping in `src/mdx-components.tsx`, the lesson
 * vocabulary in `LESSON_COMPONENTS`, the frame, the scope a quiz reads, and the store
 * it writes to. A unit test of each of those can pass while the composition is broken,
 * so this test mounts the actual file the route mounts.
 *
 * Vitest compiles the `.mdx` with `@mdx-js/rollup` and Next compiles it with
 * `@next/mdx`; both run `remark-gfm` and nothing else, which is what keeps the two
 * compilations equivalent. See the note in `vitest.config.mts`.
 */

const LESSON = getLesson('what-is-a-network')!;
const TRACK = trackOfLesson(LESSON.slug)!;

function renderLesson() {
  return render(
    <LessonLayout lesson={LESSON} trackId={TRACK.id}>
      <Lesson components={{ ...MDX_ELEMENTS, ...LESSON_COMPONENTS }} />
    </LessonLayout>,
  );
}

beforeEach(() => {
  resetProgress();
});

describe('a lesson, as the route renders it', () => {
  it('has exactly one h1, and it is the lesson', () => {
    renderLesson();

    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent('What a network actually is');
  });

  it('renders markdown through the product typography, not raw tags', () => {
    renderLesson();

    // Fenced code becomes the same `CodeBlock` every module renders, not a bare `pre`.
    const figures = document.querySelectorAll('figure');
    expect(figures.length).toBeGreaterThan(0);
    expect(figures[0]).toHaveTextContent('to: 192.0.2.30');

    // GFM is on: the latency/bandwidth comparison is a table.
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('resolves the lesson vocabulary with no import in the MDX file', async () => {
    const user = userEvent.setup();
    renderLesson();

    // <Term>
    const term = screen.getByRole('button', { name: 'protocol' });
    await user.hover(term);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/An agreement about/);

    // <KeyTakeaways>
    const takeaways = screen.getByRole('region', { name: 'Key takeaways' });
    expect(within(takeaways).getAllByRole('listitem')).toHaveLength(5);

    // <Quiz>, both kinds
    expect(screen.getByText('Check yourself')).toBeInTheDocument();
    expect(screen.getByText('Predict what happens next')).toBeInTheDocument();
  });

  /**
   * `<EmbeddedSim>` on its own, and with a budget of its own.
   *
   * It is the one entry in the vocabulary that does not resolve synchronously: it
   * `import()`s the whole Packet Journey module, runs the scenario, and mounts a React
   * Flow diagram. Cold, inside a worker pool saturated by the rest of the suite, that
   * is seconds rather than milliseconds -- so it gets its own test rather than spending
   * the shared 20 s budget the assertions above sit comfortably inside.
   *
   * The assertion is deliberately shallow. That the embed *works* is
   * `EmbeddedSim.test.tsx`'s job; this only asserts that a lesson may write the tag and
   * get a real simulation, which is the pipeline claim and cannot be made anywhere else.
   */
  it(
    'resolves an <EmbeddedSim> to the module’s real scenario',
    { timeout: 90_000 },
    async () => {
      renderLesson();

      expect(
        await screen.findByRole(
          'region',
          { name: /TCP web request/ },
          { timeout: 60_000 },
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('slider', { name: 'Playback position' }),
      ).toBeInTheDocument();
    },
  );

  it('wires a quiz to the lesson it is written in', async () => {
    const user = userEvent.setup();
    renderLesson();

    await user.click(screen.getByRole('radio', { name: /The header only/ }));

    expect(
      quizRecord(
        progressStore.getSnapshot() as ProgressState,
        LESSON.slug,
        'header-vs-payload',
      ),
    ).toEqual({
      attempts: 1,
      correct: true,
    });
  });

  it('frames the prose with where it came from and where to go next', async () => {
    const user = userEvent.setup();
    renderLesson();

    expect(screen.getByRole('link', { name: 'Learning Center' })).toHaveAttribute(
      'href',
      '/learn',
    );
    expect(screen.getAllByRole('link', { name: TRACK.title }).length).toBeGreaterThan(0);

    // Modules and sources come from `LessonMeta`, so no lesson can forget them.
    expect(screen.getByRole('link', { name: /Network Map/ })).toHaveAttribute(
      'href',
      '/network-map',
    );
    expect(screen.getByRole('link', { name: /RFC 1122/ })).toHaveAttribute(
      'href',
      'https://www.rfc-editor.org/rfc/rfc1122',
    );

    await user.click(screen.getByRole('button', { name: 'Mark complete' }));
    expect(
      isLessonComplete(progressStore.getSnapshot() as ProgressState, LESSON.slug),
    ).toBe(true);
  });

  /** The spec's rule, checked on the one lesson that exists. */
  it('records the reader position on arrival, not on completion', () => {
    renderLesson();
    expect(progressStore.getSnapshot()?.lastLesson[TRACK.id]).toBe(LESSON.slug);
  });
});
