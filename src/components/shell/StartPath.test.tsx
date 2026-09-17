import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StartPath } from './StartPath';
import { FIRST_STEPS_PATH } from './StartPathSteps';

const steps = FIRST_STEPS_PATH.steps.map((step) => ({
  ...step,
  href: `/learn/first-steps/${step.slug}`,
}));

describe('StartPath', () => {
  it('lists six numbered steps, each linking to its lesson', () => {
    render(<StartPath steps={steps} completed={null} />);

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(6);
    links.forEach((link, index) => {
      expect(link).toHaveAccessibleName(`Step ${index + 1}: ${steps[index].title}`);
      expect(link).toHaveAttribute('href', steps[index].href);
    });
  });

  it('marks the done steps, in words as well as with a tick', () => {
    const done = new Set([steps[0].slug, steps[2].slug]);
    render(<StartPath steps={steps} completed={done} />);

    const links = screen.getAllByRole('link');
    expect(links[0]).toHaveAccessibleName(`Step 1: ${steps[0].title} (done)`);
    expect(links[0]).toHaveAttribute('data-done', 'true');
    expect(links[1]).not.toHaveAttribute('data-done');
    expect(links[2]).toHaveAttribute('data-done', 'true');
  });

  /*
   * The no-layout-shift promise: the tick box is in the DOM for every step whether or
   * not progress is known, so hydrating progress changes visibility only.
   */
  it('renders the same boxes before and after progress is known', () => {
    const { container, rerender } = render(<StartPath steps={steps} completed={null} />);
    const before = container.querySelectorAll('li svg').length;
    expect(before).toBe(steps.length);

    rerender(<StartPath steps={steps} completed={new Set(steps.map((s) => s.slug))} />);
    expect(container.querySelectorAll('li svg')).toHaveLength(before);
  });
});
