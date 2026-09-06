import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FAILURE_DNS, FAILURE_TLS, FIRST_VISIT_HTTPS } from '../scenarios';
import { runPageLoad } from '../sim/pipeline';

import { StageRail } from './StageRail';

/**
 * The rail.
 *
 * The acceptance criterion is that its proportions match the real virtual durations, so the
 * test asserts on the flex weights the component actually sets rather than on anything it
 * says -- a caption can drift from the timeline and a computed style cannot.
 */

const cold = runPageLoad(FIRST_VISIT_HTTPS);

function renderRail(run = cold, selected: string | null = null) {
  const onSelect = vi.fn();
  render(
    <StageRail
      stages={run.stages}
      durationMs={run.result.durationMs}
      selected={selected as never}
      onSelect={onSelect}
      {...(run.failure ? { failure: run.failure } : {})}
    />,
  );
  return { onSelect };
}

describe('StageRail', () => {
  it('shows all eight stages, whatever the run did', () => {
    renderRail();
    const items = screen.getByRole('list', { name: 'Page load stages' });
    expect(items.querySelectorAll('li')).toHaveLength(8);
  });

  it('sizes each stage by its real share of the run', () => {
    renderRail();
    const items = [
      ...screen
        .getByRole('list', { name: 'Page load stages' })
        .querySelectorAll<HTMLLIElement>('li'),
    ];

    items.forEach((item, index) => {
      const stage = cold.stages[index]!;
      // The floor keeps a fifth-of-a-millisecond stage clickable; above it the weight is
      // the share the pipeline computed, unmodified.
      expect(item.style.flexGrow).toBe(String(Math.max(0.045, stage.share)));
    });
  });

  it('reports a stage that took time, and dashes one that took none', () => {
    renderRail(runPageLoad(FAILURE_DNS));
    // Five stages never got a turn, and those print `--` rather than `0 ms`: they did not
    // happen quickly, they did not happen.
    expect(screen.getAllByText('--')).toHaveLength(5);
  });

  it('hands the clicked stage back to the module', () => {
    const { onSelect } = renderRail();
    fireEvent.click(screen.getByRole('button', { name: /DNS/ }));
    expect(onSelect).toHaveBeenCalledWith('dns');
  });

  it('marks the stage a failed run died in', () => {
    const failed = runPageLoad(FAILURE_TLS);
    renderRail(failed);
    const button = screen.getByRole('button', { name: /TLS/ });
    expect(button.className).toContain('state-error');
  });

  it('names the heaviest stage, which is the point of the control', () => {
    renderRail();
    const heaviest = [...cold.stages]
      .filter((stage) => stage.status === 'ran')
      .sort((a, b) => b.durationMs - a.durationMs)[0]!;
    expect(
      screen.getByText(new RegExp(`${heaviest.title} is \\d+% of it`)),
    ).toBeInTheDocument();
  });
});
