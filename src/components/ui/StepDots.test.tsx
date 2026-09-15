import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MAX_DOTS, StepDots } from './StepDots';

describe('StepDots', () => {
  it('always says the step in words, and hides the dots from assistive tech', () => {
    const { container } = render(<StepDots current={3} total={6} />);

    expect(screen.getByText('Step 3 of 6')).toBeVisible();

    const dots = container.querySelectorAll('[data-state]');
    expect(dots).toHaveLength(6);
    expect(dots[0].parentElement).toHaveAttribute('aria-hidden', 'true');
    expect([...dots].map((dot) => dot.getAttribute('data-state'))).toEqual([
      'done',
      'done',
      'current',
      'todo',
      'todo',
      'todo',
    ]);
  });

  it('tells past, current and future apart by shape as well as colour', () => {
    const { container } = render(<StepDots current={2} total={3} />);
    const [done, current, todo] = container.querySelectorAll('[data-state]');

    // Filled, larger-and-ringed, hollow.
    expect(done).toHaveClass('bg-fg-muted');
    expect(current).toHaveClass('h-2.5', 'ring-2');
    expect(todo).toHaveClass('border');
    expect(todo.className).not.toMatch(/\bbg-/);
  });

  it('drops the dots past MAX_DOTS and keeps the words', () => {
    const { container } = render(<StepDots current={20} total={MAX_DOTS + 1} />);
    expect(container.querySelectorAll('[data-state]')).toHaveLength(0);
    expect(screen.getByText(`Step 13 of ${MAX_DOTS + 1}`)).toBeVisible();
  });

  it('clamps an out-of-range step and takes another noun', () => {
    render(<StepDots current={0} total={4} noun="Stop" />);
    expect(screen.getByText('Stop 1 of 4')).toBeVisible();
  });

  it('renders nothing for a run with no steps', () => {
    const { container } = render(<StepDots current={1} total={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is not interactive and not live', () => {
    const { container } = render(<StepDots current={1} total={4} />);
    expect(container.querySelector('[aria-live], [tabindex], button')).toBeNull();
  });
});
