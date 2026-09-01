import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { buildToyRun } from '@/core/sim/toyRun';

import { PhaseStepper } from './PhaseStepper';

const RUN = buildToyRun();

describe('PhaseStepper', () => {
  it('lists the phases in order, as steps', () => {
    render(<PhaseStepper phases={RUN.phases} currentIndex={1} onSeek={vi.fn()} />);

    const steps = screen.getAllByRole('listitem');
    expect(steps).toHaveLength(3);
    expect(steps[0]).toHaveTextContent('Building the packet');
    expect(steps[2]).toHaveTextContent('Echo reply returns');
  });

  it('shows each phase description -- the text a reduced-motion viewer reads', () => {
    render(<PhaseStepper phases={RUN.phases} currentIndex={0} onSeek={vi.fn()} />);

    expect(
      screen.getByText(/wraps an ICMP echo request in an IPv4 header/),
    ).toBeInTheDocument();
  });

  it('marks the current phase, and says so without relying on colour', () => {
    render(<PhaseStepper phases={RUN.phases} currentIndex={1} onSeek={vi.fn()} />);

    const current = screen.getByRole('button', { name: /Echo request travels/ });
    expect(current).toHaveAttribute('aria-current', 'step');
    expect(current).toHaveTextContent('Current phase');

    expect(screen.getByRole('button', { name: /Building the packet/ })).toHaveTextContent(
      'Finished',
    );
    expect(screen.getByRole('button', { name: /Echo reply/ })).toHaveTextContent(
      'Not reached yet',
    );
  });

  it('seeks to the start of a phase when it is chosen', async () => {
    const user = userEvent.setup();
    const onSeek = vi.fn();
    render(<PhaseStepper phases={RUN.phases} currentIndex={0} onSeek={onSeek} />);

    await user.click(screen.getByRole('button', { name: /Echo reply returns/ }));
    expect(onSeek).toHaveBeenCalledWith(60);
  });

  it('prints how long each phase lasts', () => {
    render(<PhaseStepper phases={RUN.phases} currentIndex={0} onSeek={vi.fn()} />);

    // 0..10, 10..60, 60..120.
    expect(screen.getByRole('button', { name: /Building the packet/ })).toHaveTextContent(
      '10 ms',
    );
    expect(screen.getByRole('button', { name: /Echo reply returns/ })).toHaveTextContent(
      '60 ms',
    );
  });

  it('says so plainly when a run has no phases', () => {
    render(<PhaseStepper phases={[]} currentIndex={-1} onSeek={vi.fn()} />);

    expect(screen.getByText(/one continuous sequence/)).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});
