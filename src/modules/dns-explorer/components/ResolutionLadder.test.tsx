import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { buildLadder } from '../ladder';
import { COLD_CACHE, runDnsScenario, WARM_CACHE } from '../scenarios';

import { ResolutionLadder } from './ResolutionLadder';

const cold = runDnsScenario(COLD_CACHE);
const warm = runDnsScenario(WARM_CACHE);
const ladder = buildLadder(cold.resolutions);

function setup(virtualTime: number, onSeek = vi.fn(), onSelectRung = vi.fn()) {
  render(
    <ResolutionLadder
      ladder={ladder}
      virtualTime={virtualTime}
      durationMs={cold.result.durationMs}
      onSeek={onSeek}
      onSelectRung={onSelectRung}
      summary="3 queries"
    />,
  );

  return { onSeek, onSelectRung, user: userEvent.setup() };
}

/** Rungs are buttons labelled "Seek to ...", so this is every arrow on the diagram. */
function rungButtons() {
  return screen.getAllByRole('button', { name: /^Seek to / });
}

describe('ResolutionLadder', () => {
  it('gives every machine the run spoke to a labelled column', () => {
    setup(0);

    const machines = within(
      screen.getByRole('list', { name: 'Machines in this resolution' }),
    );

    expect(machines.getByText('stub resolver')).toBeInTheDocument();
    expect(machines.getByText('recursive resolver')).toBeInTheDocument();
    expect(machines.getByText('root server')).toBeInTheDocument();
  });

  it('draws one rung per message, in time order', () => {
    setup(cold.result.durationMs);

    expect(rungButtons()).toHaveLength(ladder.rungs.length);
  });

  /**
   * The asymmetry the whole design rests on: one recursive query at the top, several
   * iterative ones below it. It has to be readable off the diagram, not just true.
   */
  it('labels the stub query recursive and the resolver queries iterative', () => {
    setup(cold.result.durationMs);

    expect(screen.getAllByText(/^Recursive, RD set/).length).toBe(
      cold.resolutions.length,
    );
    expect(screen.getAllByText(/^Iterative, RD clear/).length).toBeGreaterThan(1);
  });

  /** The misconception, on the face of the diagram. */
  it('labels what comes back from the root a referral rather than an answer', () => {
    setup(cold.result.durationMs);

    expect(screen.getAllByText('Referral, not an answer').length).toBeGreaterThan(0);
  });

  it('seeks to the moment a rung was on the wire, and pins it', async () => {
    const { onSeek, onSelectRung, user } = setup(0);

    await user.click(rungButtons()[2]);

    expect(onSeek).toHaveBeenCalledWith(ladder.rungs[2].at);
    expect(onSelectRung).toHaveBeenCalledWith(ladder.rungs[2]);
  });

  it('marks the rung under the playhead as current', () => {
    const third = ladder.rungs[2];
    setup(third.at);

    const current = screen
      .getAllByRole('listitem')
      .filter((item) => item.getAttribute('aria-current') === 'true');

    expect(current).toHaveLength(1);
    expect(within(current[0]).getByRole('button')).toHaveAccessibleName(
      new RegExp(third.title.replace('.', '\\.')),
    );
  });

  it('marks the pinned rung pressed', () => {
    render(
      <ResolutionLadder
        ladder={ladder}
        virtualTime={0}
        durationMs={cold.result.durationMs}
        onSeek={vi.fn()}
        selectedRungId={ladder.rungs[1].id}
      />,
    );

    const pressed = rungButtons().filter(
      (button) => button.getAttribute('aria-pressed') === 'true',
    );

    expect(pressed).toHaveLength(1);
  });

  /**
   * A ladder that grew a rung at a time could not be used as an index into the run, so
   * the future is dimmed rather than hidden.
   */
  it('shows the rungs the playhead has not reached yet', () => {
    setup(0);

    expect(rungButtons()).toHaveLength(ladder.rungs.length);
  });

  /** A cache hit never leaves the machine, and the ladder has to show that it did not. */
  it('draws a cache hit as its own rung', () => {
    const warmLadder = buildLadder(warm.resolutions);
    render(
      <ResolutionLadder
        ladder={warmLadder}
        virtualTime={warm.result.durationMs}
        durationMs={warm.result.durationMs}
        onSeek={vi.fn()}
      />,
    );

    expect(screen.getAllByText('From cache').length).toBeGreaterThan(0);
    expect(
      screen.getAllByText('Cache lookup — nothing on the wire').length,
    ).toBeGreaterThan(0);
  });

  it('says so rather than drawing an empty grid when nothing was asked', () => {
    render(
      <ResolutionLadder
        ladder={{ columns: [], rungs: [] }}
        virtualTime={0}
        durationMs={0}
        onSeek={vi.fn()}
      />,
    );

    expect(screen.getByText('This run asked nobody anything.')).toBeInTheDocument();
  });
});
