import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { resetProgress } from '../progress/actions';
import { progressStore, quizRecord, type ProgressState } from '../progress/store';

import { LessonScopeContext } from './LessonScope';
import { Quiz, type QuizOption } from './Quiz';

const OPTIONS: QuizOption[] = [
  {
    id: 'header',
    label: 'The header only',
    correct: true,
    why: 'A forwarding decision needs the destination address and nothing else.',
  },
  {
    id: 'payload',
    label: 'The payload, to find the hostname',
    why: 'The name was resolved to an address before the packet was sent.',
  },
];

function renderInLesson(ui: React.ReactElement) {
  return render(
    <LessonScopeContext
      value={{ slug: 'what-is-a-network', trackId: 'internet-foundations' }}
    >
      {ui}
    </LessonScopeContext>,
  );
}

function storedAnswer(quizId: string) {
  return quizRecord(
    progressStore.getSnapshot() as ProgressState,
    'what-is-a-network',
    quizId,
  );
}

beforeEach(() => {
  resetProgress();
});

describe('Quiz', () => {
  /**
   * The unanswered question must not leak its answer. Styling the correct option
   * before anyone has committed would turn every quiz into a spot-the-highlight
   * exercise.
   */
  it('gives nothing away before an answer', () => {
    renderInLesson(
      <Quiz id="q1" question="Which part does a router read?" options={OPTIONS} />,
    );

    expect(screen.getByText('Which part does a router read?')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);

    expect(screen.queryByText('Correct')).not.toBeInTheDocument();
    expect(screen.queryByText(OPTIONS[0].why as string)).not.toBeInTheDocument();
    expect(screen.queryByText(OPTIONS[1].why as string)).not.toBeInTheDocument();
  });

  /**
   * The spec's requirement, and the reason the component makes `why` mandatory: a
   * reader who picked a wrong option had a reason, and that reason is what needs
   * addressing. Showing only "wrong" teaches nothing.
   */
  it('explains every option once one is chosen, including the ones not chosen', async () => {
    const user = userEvent.setup();
    renderInLesson(<Quiz id="q1" question="Which part?" options={OPTIONS} />);

    await user.click(screen.getByRole('radio', { name: /The payload/ }));

    expect(screen.getByText(OPTIONS[0].why as string)).toBeInTheDocument();
    expect(screen.getByText(OPTIONS[1].why as string)).toBeInTheDocument();
    expect(screen.getByText('Not this one')).toBeInTheDocument();
    expect(screen.getByText('Correct')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/Not quite/);
  });

  it('says so when the answer is right', async () => {
    const user = userEvent.setup();
    renderInLesson(<Quiz id="q1" question="Which part?" options={OPTIONS} />);

    await user.click(screen.getByRole('radio', { name: /The header only/ }));
    expect(screen.getByRole('status')).toHaveTextContent(/That is the one/);
  });

  it('records the answer against the lesson it is in', async () => {
    const user = userEvent.setup();
    renderInLesson(
      <Quiz id="header-vs-payload" question="Which part?" options={OPTIONS} />,
    );

    await user.click(screen.getByRole('radio', { name: /The payload/ }));
    expect(storedAnswer('header-vs-payload')).toEqual({ attempts: 1, correct: false });

    // Answering again is free and unremarked; the latest verdict replaces the old one.
    await user.click(screen.getByRole('radio', { name: /The header only/ }));
    expect(storedAnswer('header-vs-payload')).toEqual({ attempts: 2, correct: true });
  });

  it('works, and records nothing, outside a lesson', async () => {
    const user = userEvent.setup();
    render(<Quiz id="loose" question="Which part?" options={OPTIONS} />);

    await user.click(screen.getByRole('radio', { name: /The header only/ }));
    expect(screen.getByRole('status')).toHaveTextContent(/That is the one/);
    expect(progressStore.getSnapshot()?.lessons).toEqual({});
  });

  /**
   * The point of the predict variant: the answer must not be on screen while the
   * question is being asked, or it is not a prediction.
   */
  it('withholds the reveal until the reader has committed', async () => {
    const user = userEvent.setup();
    renderInLesson(
      <Quiz
        id="predict-ttl"
        kind="predict"
        question="What stops a looping packet?"
        options={OPTIONS}
        reveal="Every IPv4 header carries a Time To Live."
      />,
    );

    expect(screen.getByText('Predict what happens next')).toBeInTheDocument();
    expect(screen.queryByText(/Time To Live/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /The header only/ }));

    expect(screen.getByText('What actually happens')).toBeInTheDocument();
    expect(screen.getByText(/Time To Live/)).toBeInTheDocument();
  });

  it('mentions a previous visit without turning it into a score', async () => {
    const user = userEvent.setup();
    const { unmount } = renderInLesson(
      <Quiz id="q1" question="Which part?" options={OPTIONS} />,
    );
    await user.click(screen.getByRole('radio', { name: /The header only/ }));
    unmount();

    renderInLesson(<Quiz id="q1" question="Which part?" options={OPTIONS} />);
    expect(screen.getByText(/You answered this before/)).toHaveTextContent('correctly');
    // No count, no streak, no grade -- just whether they have been here.
    expect(screen.queryByText(/attempts?/i)).not.toBeInTheDocument();
  });
});
