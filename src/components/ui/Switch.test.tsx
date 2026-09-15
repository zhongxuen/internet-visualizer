import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Switch } from './Switch';

describe('Switch', () => {
  it('is a switch named by its visible label alone, with its state in words', async () => {
    const user = userEvent.setup();
    render(
      <Switch
        label="Pause after each step"
        description="The run stops at the end of every step until you press Next."
      />,
    );

    const toggle = screen.getByRole('switch', { name: 'Pause after each step' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveAccessibleDescription(
      'The run stops at the end of every step until you press Next.',
    );
    expect(screen.getByText('Off')).toBeVisible();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('On')).toBeVisible();
    expect(screen.queryByText('Off')).not.toBeInTheDocument();
  });

  it('flips with Space and Enter, keeps focus, and ignores Escape', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch label="Show addresses" onCheckedChange={onCheckedChange} />);
    const toggle = screen.getByRole('switch', { name: 'Show addresses' });

    await user.tab();
    expect(toggle).toHaveFocus();

    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(onCheckedChange.mock.calls).toEqual([[true], [false]]);

    await user.keyboard('{Escape}');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveFocus();
  });

  it('can be controlled, and does nothing while disabled', async () => {
    const user = userEvent.setup();

    function Controlled() {
      const [on, setOn] = useState(true);
      return <Switch label="Follow the action" checked={on} onCheckedChange={setOn} />;
    }

    const { unmount } = render(<Controlled />);
    const toggle = screen.getByRole('switch', { name: 'Follow the action' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    unmount();

    const onCheckedChange = vi.fn();
    render(<Switch label="Locked" disabled onCheckedChange={onCheckedChange} />);
    await user.click(screen.getByRole('switch', { name: 'Locked' }));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it('takes custom on/off words and an aria-label override', () => {
    render(
      <Switch
        label="Motion"
        aria-label="Reduce motion"
        defaultChecked
        onLabel="Reduced"
        offLabel="Full"
      />,
    );
    expect(screen.getByRole('switch', { name: 'Reduce motion' })).toBeInTheDocument();
    expect(screen.getByText('Reduced')).toBeVisible();
  });
});
