import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { MotionProvider } from '@/components/motion';

import { MotionToggle } from './MotionToggle';

// The session override outlives a render, by design — clear it so each case starts
// from the same place.
beforeEach(() => {
  window.sessionStorage.clear();
});

describe('MotionToggle', () => {
  it('reports the resolved motion setting as a switch', () => {
    render(
      <MotionProvider>
        <MotionToggle />
      </MotionProvider>,
    );

    expect(screen.getByRole('switch', { name: 'Motion: full' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('overrides the setting for the session in both directions', async () => {
    const user = userEvent.setup();
    render(
      <MotionProvider>
        <MotionToggle />
      </MotionProvider>,
    );

    await user.click(screen.getByRole('switch'));
    expect(screen.getByRole('switch', { name: 'Motion: reduced' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await user.click(screen.getByRole('switch'));
    expect(screen.getByRole('switch', { name: 'Motion: full' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('promises that reducing motion keeps the simulation explorable', async () => {
    const user = userEvent.setup();
    render(
      <MotionProvider defaultPreference="reduced">
        <MotionToggle />
      </MotionProvider>,
    );

    await user.tab();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      /simulations still run/i,
    );
  });
});
