import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './Button';

describe('Button', () => {
  it('renders a non-submitting button, merges className, and fires onClick', async () => {
    const onClick = vi.fn();
    render(
      <Button variant="secondary" size="sm" className="w-full" onClick={onClick}>
        Run simulation
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Run simulation' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('w-full', 'bg-surface-raised');

    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not fire when disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Run
      </Button>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
