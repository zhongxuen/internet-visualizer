import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Button } from './Button';
import { Tooltip } from './Tooltip';

describe('Tooltip', () => {
  it('opens on keyboard focus, describes the trigger, and closes on Escape', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Touches a real network">
        <Button>Live mode</Button>
      </Tooltip>,
    );

    const trigger = screen.getByRole('button', { name: 'Live mode' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    await user.tab();
    expect(trigger).toHaveFocus();

    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('Touches a real network');
    expect(trigger).toHaveAttribute('aria-describedby', tooltip.id);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(trigger).not.toHaveAttribute('aria-describedby');
  });

  it('also opens on hover and closes when the pointer leaves', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Simulated only" side="bottom">
        <Button>Simulated</Button>
      </Tooltip>,
    );

    await user.hover(screen.getByRole('button', { name: 'Simulated' }));
    expect(await screen.findByRole('tooltip')).toBeVisible();

    await user.unhover(screen.getByRole('button', { name: 'Simulated' }));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
