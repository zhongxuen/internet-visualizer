import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithPreferences } from '@/components/prefs/testing';
import { buildToyRun } from '@/core/sim/toyRun';

import { PhaseStepper } from './PhaseStepper';

const RUN = buildToyRun();

/** The toy run, with a plain sentence on its second step only. */
const WITH_PLAIN = RUN.phases.map((phase) =>
  phase.index === 1
    ? { ...phase, plain: 'Your laptop sends the question across the network.' }
    : phase,
);

describe('PhaseStepper', () => {
  it('lists the phases in order, as numbered steps', () => {
    renderWithPreferences(
      <PhaseStepper phases={RUN.phases} currentIndex={1} onSeek={vi.fn()} />,
      { detail: 'full' },
    );

    const steps = screen.getAllByRole('listitem');
    expect(steps).toHaveLength(3);
    expect(steps[0]).toHaveTextContent(/^Step 1/);
    expect(steps[0]).toHaveTextContent('Building the packet');
    expect(steps[2]).toHaveTextContent(/^Step 3/);
    expect(steps[2]).toHaveTextContent('Echo reply returns');
  });

  it('shows the title and description in Full detail', () => {
    renderWithPreferences(
      <PhaseStepper phases={RUN.phases} currentIndex={0} onSeek={vi.fn()} />,
      { detail: 'full' },
    );

    expect(screen.getByText('Building the packet')).toBeInTheDocument();
    expect(
      screen.getByText(/wraps an ICMP echo request in an IPv4 header/),
    ).toBeInTheDocument();
  });

  it('shows the plain sentence in Simple, and the description where there is none', () => {
    render(<PhaseStepper phases={WITH_PLAIN} currentIndex={0} onSeek={vi.fn()} />);

    const steps = screen.getAllByRole('listitem');
    expect(steps[1]).toHaveTextContent(
      'Your laptop sends the question across the network.',
    );
    expect(steps[1]).not.toHaveTextContent(RUN.phases[1]!.title);
    // No plain text on the first step: its description stands in, and no title.
    expect(steps[0]).toHaveTextContent(RUN.phases[0]!.description);
    expect(steps[0]).not.toHaveTextContent('Building the packet');
  });

  it('names each step button after its words, so a screen reader hears more than a number', () => {
    render(<PhaseStepper phases={WITH_PLAIN} currentIndex={0} onSeek={vi.fn()} />);

    expect(
      screen.getByRole('button', { name: /Step 2 .*sends the question/ }),
    ).toBeInTheDocument();
  });

  it('marks the current step with an icon and the word "Now", not by colour alone', () => {
    renderWithPreferences(
      <PhaseStepper phases={RUN.phases} currentIndex={1} onSeek={vi.fn()} />,
      { detail: 'full' },
    );

    const current = screen.getByRole('button', { name: /Echo request travels/ });
    expect(current).toHaveAttribute('aria-current', 'step');
    expect(current).toHaveTextContent('Now');
    expect(current.querySelector('svg')).not.toBeNull();

    expect(screen.getByRole('button', { name: /Building the packet/ })).toHaveTextContent(
      'Finished',
    );
    expect(screen.getByRole('button', { name: /Echo reply/ })).toHaveTextContent(
      'Not reached yet',
    );
  });

  it('seeks to the start of a step from its button, or from anywhere on its row', async () => {
    const user = userEvent.setup();
    const onSeek = vi.fn();
    renderWithPreferences(
      <PhaseStepper phases={RUN.phases} currentIndex={0} onSeek={onSeek} />,
      { detail: 'full' },
    );

    await user.click(screen.getByRole('button', { name: /Echo reply returns/ }));
    expect(onSeek).toHaveBeenLastCalledWith(60);

    await user.click(screen.getByText('Echo request travels'));
    expect(onSeek).toHaveBeenLastCalledWith(10);
    expect(onSeek).toHaveBeenCalledTimes(2);
  });

  it('prints how long each phase lasts, in Full detail', () => {
    renderWithPreferences(
      <PhaseStepper phases={RUN.phases} currentIndex={0} onSeek={vi.fn()} />,
      { detail: 'full' },
    );

    // 0..10, 10..60, 60..120.
    const steps = screen.getAllByRole('listitem');
    expect(steps[0]).toHaveTextContent('10 ms');
    expect(steps[2]).toHaveTextContent('60 ms');
  });

  it('keeps its text at the small step of the type scale or larger', () => {
    const { container } = render(
      <PhaseStepper phases={RUN.phases} currentIndex={0} onSeek={vi.fn()} />,
    );

    expect(container.querySelector('.text-xs')).toBeNull();
    expect(container.querySelectorAll('.text-small').length).toBeGreaterThan(0);
  });

  it('says so plainly when a run has no phases', () => {
    render(<PhaseStepper phases={[]} currentIndex={-1} onSeek={vi.fn()} />);

    expect(screen.getByText(/one continuous sequence/)).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});
