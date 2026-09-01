import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { buildToyRun } from '@/core/sim/toyRun';

import { Timeline } from './Timeline';

const RUN = buildToyRun();

function renderTimeline(overrides: Partial<Parameters<typeof Timeline>[0]> = {}) {
  const onSeek = vi.fn();
  render(
    <Timeline
      durationMs={RUN.durationMs}
      virtualTime={30}
      phases={RUN.phases}
      currentPhaseIndex={1}
      onSeek={onSeek}
      {...overrides}
    />,
  );
  return { onSeek };
}

describe('Timeline', () => {
  it('is a real slider, reporting virtual time', () => {
    renderTimeline();

    const scrubber = screen.getByRole('slider', { name: 'Playback position' });
    expect(scrubber).toHaveValue('30');
    expect(scrubber).toHaveAttribute('aria-valuetext', '30 ms of 120 ms');
  });

  it('seeks when it is dragged', () => {
    const { onSeek } = renderTimeline();

    fireEvent.change(screen.getByRole('slider'), { target: { value: '84' } });
    expect(onSeek).toHaveBeenCalledWith(84);
  });

  it('gives every phase a labelled marker that seeks to its start', async () => {
    const user = userEvent.setup();
    const { onSeek } = renderTimeline();

    const marker = screen.getByRole('button', {
      name: 'Phase 3, Echo reply returns, at 60 ms',
    });
    await user.click(marker);

    expect(onSeek).toHaveBeenCalledWith(60);
  });

  it('marks which phase the playhead is in', () => {
    renderTimeline();

    const current = screen.getByRole('button', { name: /Phase 2/ });
    expect(current).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('button', { name: /Phase 1/ })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('is reachable by keyboard: every marker is a tab stop', async () => {
    const user = userEvent.setup();
    const { onSeek } = renderTimeline();

    await user.tab();
    expect(screen.getByRole('button', { name: /Phase 1/ })).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(onSeek).toHaveBeenCalledWith(0);
  });

  it('switches to seconds for a run long enough to need them', () => {
    renderTimeline({ durationMs: 4200, virtualTime: 1234, phases: [] });

    expect(screen.getByRole('slider')).toHaveAttribute(
      'aria-valuetext',
      '1.23 s of 4.20 s',
    );
  });

  it('disables itself rather than pretending an empty run can be scrubbed', () => {
    renderTimeline({ durationMs: 0, virtualTime: 0, phases: [] });
    expect(screen.getByRole('slider')).toBeDisabled();
  });
});
