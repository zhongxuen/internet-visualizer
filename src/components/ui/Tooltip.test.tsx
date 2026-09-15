import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Button } from './Button';
import { VIEWPORT_PADDING } from './position';
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

  it('leaves focus on the trigger through open and Escape', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Runs in your browser">
        <Button>Simulated</Button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Simulated' });

    await user.tab();
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
  });

  describe('on touch', () => {
    it('toggles on a tap, and a second tap closes it', async () => {
      const user = userEvent.setup();
      render(
        <Tooltip content="Simulated only">
          <Button>Simulated</Button>
        </Tooltip>,
      );
      const trigger = screen.getByRole('button', { name: 'Simulated' });

      await user.pointer({ keys: '[TouchA]', target: trigger });
      expect(screen.getByRole('tooltip')).toHaveTextContent('Simulated only');

      await user.pointer({ keys: '[TouchA]', target: trigger });
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    it('closes on a tap anywhere else', async () => {
      const user = userEvent.setup();
      render(
        <>
          <Tooltip content="Simulated only">
            <Button>Simulated</Button>
          </Tooltip>
          <p>Elsewhere</p>
        </>,
      );

      await user.pointer({
        keys: '[TouchA]',
        target: screen.getByRole('button', { name: 'Simulated' }),
      });
      expect(screen.getByRole('tooltip')).toBeInTheDocument();

      await user.pointer({ keys: '[TouchA]', target: screen.getByText('Elsewhere') });
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });
  });

  describe('viewport collision', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    /** Put the tooltip's wrapper at a given point; jsdom lays nothing out itself. */
    function anchorAt(left: number, top: number) {
      const original = Element.prototype.getBoundingClientRect;
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: Element,
      ) {
        if (this instanceof HTMLSpanElement && this.querySelector('button')) {
          return {
            left,
            top,
            width: 40,
            height: 20,
            right: left + 40,
            bottom: top + 20,
          } as DOMRect;
        }
        return original.call(this);
      });
    }

    it('shifts back inside the viewport at the right edge', async () => {
      anchorAt(window.innerWidth - 20, 300);
      const user = userEvent.setup();
      render(
        <Tooltip content="Touches a real network">
          <Button>Live</Button>
        </Tooltip>,
      );

      await user.tab();
      const tooltip = screen.getByRole('tooltip');
      // jsdom reports every unsized box as 100px wide (tests/setup.ts).
      expect(tooltip.style.left).toBe(`${window.innerWidth - 100 - VIEWPORT_PADDING}px`);
    });

    it('flips below when there is no room above', async () => {
      anchorAt(200, 4);
      const user = userEvent.setup();
      render(
        <Tooltip content="Touches a real network" side="top">
          <Button>Live</Button>
        </Tooltip>,
      );

      await user.tab();
      expect(screen.getByRole('tooltip')).toHaveAttribute('data-side', 'bottom');
    });
  });
});
