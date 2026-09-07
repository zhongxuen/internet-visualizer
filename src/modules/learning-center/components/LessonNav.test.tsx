import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';

import { lessonsInTrack } from '../content/navigation';
import { TRACKS } from '../content/tracks';
import { resetProgress } from '../progress/actions';
import { isLessonComplete, progressStore, type ProgressState } from '../progress/store';

import { LessonNav } from './LessonNav';

const TRACK = TRACKS[0];
const LESSON = lessonsInTrack(TRACK.id)[0];

beforeEach(() => {
  resetProgress();
});

describe('LessonNav', () => {
  it('says where in the track the reader is', () => {
    render(<LessonNav trackId={TRACK.id} slug={LESSON.slug} />);

    const nav = screen.getByRole('navigation', { name: 'Lesson' });
    expect(nav).toHaveTextContent(`Lesson 1 of ${lessonsInTrack(TRACK.id).length}`);
    expect(screen.getByRole('link', { name: TRACK.title })).toHaveAttribute(
      'href',
      `/learn#track-${TRACK.id}`,
    );
  });

  it('marks the lesson complete, and unmarks it', async () => {
    const user = userEvent.setup();
    render(<LessonNav trackId={TRACK.id} slug={LESSON.slug} />);

    const button = screen.getByRole('button', { name: 'Mark complete' });
    expect(button).toHaveAttribute('aria-pressed', 'false');

    await user.click(button);
    expect(
      isLessonComplete(progressStore.getSnapshot() as ProgressState, LESSON.slug),
    ).toBe(true);

    const pressed = screen.getByRole('button', { name: 'Completed' });
    expect(pressed).toHaveAttribute('aria-pressed', 'true');

    await user.click(pressed);
    expect(
      isLessonComplete(progressStore.getSnapshot() as ProgressState, LESSON.slug),
    ).toBe(false);
  });

  /**
   * Navigation has no business waiting on `localStorage`: prev/next must work before,
   * during, and without hydration. The completed count and the button state are the
   * only things here that may not.
   */
  it('renders its links on the server and its progress nowhere', () => {
    const html = renderToStaticMarkup(
      <LessonNav trackId={TRACK.id} slug={LESSON.slug} />,
    );

    expect(html).toContain(`Lesson 1 of ${lessonsInTrack(TRACK.id).length}`);
    expect(html).toContain(`/learn#track-${TRACK.id}`);
    // No count, and a toggle that refuses to be pressed: `complete === null` is "not
    // known yet", and a control that guessed would be wrong half the time.
    expect(html).not.toMatch(/\d+ complete/);
    expect(html).toContain('disabled');
  });

  /** The route 404s first; this is the belt to that braces. */
  it('renders nothing for a lesson the track does not list', () => {
    const { container } = render(
      <LessonNav trackId="infrastructure" slug={LESSON.slug} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
