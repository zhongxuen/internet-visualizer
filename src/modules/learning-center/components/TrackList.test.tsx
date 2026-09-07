import { render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';

import { lessonsInTrack } from '../content/navigation';
import { TRACKS } from '../content/tracks';
import {
  markLessonComplete,
  rememberLessonPosition,
  resetProgress,
} from '../progress/actions';

import { TrackList } from './TrackList';

const FIRST = TRACKS[0];
const FIRST_LESSON = lessonsInTrack(FIRST.id)[0];

beforeEach(() => {
  resetProgress();
});

describe('TrackList', () => {
  it('shows every track, and says so when one has nothing in it yet', () => {
    render(<TrackList />);

    for (const track of TRACKS) {
      expect(screen.getByRole('heading', { name: track.title })).toBeInTheDocument();
    }

    /*
     * An absent track would read as "this product does not cover TLS", which is both
     * wrong and unfixable by the reader -- so an empty one is rendered with an honest
     * note instead of being hidden.
     *
     * Phase 13.3 filled all seven, so `empty` is currently zero-length and this
     * asserts the note appears nowhere. Written against the count rather than against
     * a fixed number, so it stays true from either direction: adding a track ahead of
     * its lessons must produce exactly one note, and writing those lessons must remove
     * it.
     */
    const empty = TRACKS.filter((track) => lessonsInTrack(track.id).length === 0);
    expect(screen.queryAllByText(/still being written/)).toHaveLength(empty.length);
  });

  it('links each lesson at its track-qualified URL', () => {
    render(<TrackList />);

    expect(
      screen.getByRole('link', { name: new RegExp(FIRST_LESSON.title) }),
    ).toHaveAttribute('href', `/learn/${FIRST.id}/${FIRST_LESSON.slug}`);
  });

  it('ticks a completed lesson, in words as well as in colour', () => {
    markLessonComplete(FIRST_LESSON.slug, true);
    render(<TrackList />);

    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(
      screen.getByText(`1 of ${lessonsInTrack(FIRST.id).length} complete`),
    ).toBeInTheDocument();
  });

  it('offers to resume where the reader left off', () => {
    rememberLessonPosition(FIRST.id, FIRST_LESSON.slug);
    render(<TrackList />);

    expect(
      screen.getByRole('link', { name: /Pick up where you left off/ }),
    ).toHaveAttribute('href', `/learn/${FIRST.id}/${FIRST_LESSON.slug}`);
  });

  /**
   * The acceptance criterion "no hydration warnings", asserted rather than hoped for.
   *
   * The server has no reader, so it must render no progress -- even with a full
   * `localStorage` sitting right there, which is exactly the situation a returning
   * visitor is in. What the server emits here is what the client emits on its
   * hydration pass, because both read `getServerSnapshot()`.
   */
  it('renders no progress at all on the server', () => {
    markLessonComplete(FIRST_LESSON.slug, true);
    rememberLessonPosition(FIRST.id, FIRST_LESSON.slug);

    const html = renderToStaticMarkup(<TrackList />);

    expect(html).toContain(FIRST_LESSON.title);
    expect(html).not.toContain('Completed');
    expect(html).not.toMatch(/\d+ of \d+ complete/);
    expect(html).not.toContain('Pick up where you left off');
  });
});
