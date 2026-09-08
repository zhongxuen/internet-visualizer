import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { buildToyRun } from '@/core/sim/toyRun';

import { PhaseAnnouncer, phaseAnnouncement } from './PhaseAnnouncer';

const RUN = buildToyRun();

describe('phaseAnnouncement', () => {
  it('gives the phase its position, so "3 of 3" is heard without counting', () => {
    expect(phaseAnnouncement(RUN.phases, 2)).toMatch(/^Phase 3 of 3: /);
  });

  it('reads the phase title and its description, the sentence written for a human', () => {
    const message = phaseAnnouncement(RUN.phases, 0);

    expect(message).toContain(RUN.phases[0]!.title);
    expect(message).toContain(RUN.phases[0]!.description);
  });

  it('says the run has not started rather than nothing at all', () => {
    // `-1` is the playhead sitting before the first phase begins, which is where every
    // run starts. Silence there would leave a screen reader with no idea how long the
    // thing it just landed on is.
    expect(phaseAnnouncement(RUN.phases, -1)).toBe('Not started. 3 phases in this run.');
  });

  it('is empty for a run with no phases, so nothing is announced at all', () => {
    expect(phaseAnnouncement([], 0)).toBe('');
  });
});

describe('PhaseAnnouncer', () => {
  it('is a status region, which is what a screen reader watches', () => {
    render(<PhaseAnnouncer phases={RUN.phases} currentIndex={1} />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Phase 2 of 3');
  });

  it('is visually hidden rather than hidden, so it is still announced', () => {
    render(<PhaseAnnouncer phases={RUN.phases} currentIndex={0} />);

    const status = screen.getByRole('status');
    expect(status).toHaveClass('sr-only');
    // `aria-hidden` or `display: none` would take it out of the accessibility tree, and
    // a live region nobody can read announces nothing.
    expect(status).not.toHaveAttribute('aria-hidden');
  });

  it('rewrites the sentence when the chapter turns over', () => {
    const { rerender } = render(<PhaseAnnouncer phases={RUN.phases} currentIndex={0} />);
    const first = screen.getByRole('status').textContent;

    rerender(<PhaseAnnouncer phases={RUN.phases} currentIndex={1} />);

    expect(screen.getByRole('status').textContent).not.toBe(first);
  });
});
