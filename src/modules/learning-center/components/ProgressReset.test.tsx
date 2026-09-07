import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';

import { markLessonComplete, recordAnswer, resetProgress } from '../progress/actions';
import {
  hasAnyProgress,
  PROGRESS_STORAGE_KEY,
  progressStore,
  type ProgressState,
} from '../progress/store';

import { ProgressReset } from './ProgressReset';

beforeEach(() => {
  resetProgress();
});

describe('ProgressReset', () => {
  it('says what is stored and where, before anything has been', () => {
    render(<ProgressReset />);

    expect(screen.getByText(/Nothing recorded yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reset progress/ })).toBeDisabled();
  });

  it('counts completed lessons', () => {
    markLessonComplete('what-is-a-network', true);
    render(<ProgressReset />);

    expect(screen.getByText(/1 lesson completed/)).toBeInTheDocument();
    expect(screen.getByText(/no account, and nothing sent anywhere/)).toBeInTheDocument();
  });

  /**
   * Broader than the completed count on purpose: a quiz answered without the lesson
   * being ticked is still a record of the reader, and "you have nothing to delete" has
   * to be true when it is said.
   */
  it('offers to delete a bare quiz answer too', () => {
    recordAnswer('what-is-a-network', 'q1', false);
    render(<ProgressReset />);

    expect(screen.getByRole('button', { name: /Reset progress/ })).toBeEnabled();
  });

  it('asks once, then deletes it for real', async () => {
    const user = userEvent.setup();
    markLessonComplete('what-is-a-network', true);
    render(<ProgressReset />);

    await user.click(screen.getByRole('button', { name: /Reset progress/ }));
    expect(screen.getByRole('status')).toHaveTextContent('Delete it all?');
    // Nothing is destroyed by the press that asks the question.
    expect(hasAnyProgress(progressStore.getSnapshot() as ProgressState)).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Yes, reset' }));

    expect(hasAnyProgress(progressStore.getSnapshot() as ProgressState)).toBe(false);
    // A tombstone flag would leave the data on the machine. Removed means removed.
    expect(window.localStorage.getItem(PROGRESS_STORAGE_KEY)).toBeNull();
    expect(screen.getByText(/Nothing recorded yet/)).toBeInTheDocument();
  });

  it('backs out on Cancel and on Escape', async () => {
    const user = userEvent.setup();
    markLessonComplete('what-is-a-network', true);
    render(<ProgressReset />);

    await user.click(screen.getByRole('button', { name: /Reset progress/ }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: /Reset progress/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Reset progress/ }));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: /Reset progress/ })).toBeInTheDocument();
    expect(hasAnyProgress(progressStore.getSnapshot() as ProgressState)).toBe(true);
  });

  /** Nothing to report and nothing to delete until the browser has been read. */
  it('renders nothing on the server', () => {
    markLessonComplete('what-is-a-network', true);
    expect(renderToStaticMarkup(<ProgressReset />)).toBe('');
  });
});
