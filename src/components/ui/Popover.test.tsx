import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Popover } from './Popover';

/**
 * jsdom has no `popover` attribute, so most of these exercise the fallback path -- which
 * is also what an older browser gets. The last block installs a minimal stand-in for the
 * platform API to check the native path's wiring: that the component shows and hides the
 * panel through it, and that a dismissal the platform performs on its own is mirrored
 * back into `aria-expanded`.
 */

function Definition() {
  return (
    <>
      <Popover trigger="resolver">
        <p>A helper that looks up the number for a name.</p>
        <a href="#resolver">Read more</a>
      </Popover>
      <button type="button">Elsewhere</button>
    </>
  );
}

describe('Popover', () => {
  it('wires the trigger to a named, non-modal panel', async () => {
    const user = userEvent.setup();
    render(<Definition />);

    const trigger = screen.getByRole('button', { name: 'resolver' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    // aria-controls always points at an element, even while closed.
    const panelId = trigger.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    expect(document.getElementById(panelId!)).not.toBeNull();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(trigger);

    const panel = screen.getByRole('dialog', { name: 'resolver' });
    expect(panel).toHaveAttribute('id', panelId);
    expect(panel).toHaveAttribute('aria-modal', 'false');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(panel).toHaveTextContent('A helper that looks up the number for a name.');
  });

  it('opens with Enter and with Space, moves focus in, and Escape returns it', async () => {
    const user = userEvent.setup();
    render(<Definition />);
    const trigger = screen.getByRole('button', { name: 'resolver' });

    await user.tab();
    expect(trigger).toHaveFocus();

    await user.keyboard('{Enter}');
    const panel = screen.getByRole('dialog', { name: 'resolver' });
    expect(panel).toHaveFocus();

    // Tab reaches the link inside: the panel follows the trigger in the DOM.
    await user.tab();
    expect(screen.getByRole('link', { name: 'Read more' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();

    await user.keyboard(' ');
    expect(screen.getByRole('dialog', { name: 'resolver' })).toHaveFocus();
  });

  it('closes when its trigger is pressed again, without reopening', async () => {
    const user = userEvent.setup();
    render(<Definition />);
    const trigger = screen.getByRole('button', { name: 'resolver' });

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on a press outside and leaves focus where the user put it', async () => {
    const user = userEvent.setup();
    render(<Definition />);

    await user.click(screen.getByRole('button', { name: 'resolver' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    await user.click(elsewhere);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(elsewhere).toHaveFocus();
  });

  it('mounts its content only while open', async () => {
    const user = userEvent.setup();
    render(<Definition />);

    expect(screen.queryByText(/looks up the number/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'resolver' }));
    expect(screen.getByText(/looks up the number/)).toBeInTheDocument();
  });

  it('can be controlled, and closed from inside through the render prop', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    function Controlled() {
      const [open, setOpen] = useState(false);
      return (
        <Popover
          trigger="Settings"
          open={open}
          onOpenChange={(next) => {
            onOpenChange(next);
            setOpen(next);
          }}
        >
          {({ close }) => (
            <button type="button" onClick={close}>
              Done
            </button>
          )}
        </Popover>
      );
    }

    render(<Controlled />);
    const trigger = screen.getByRole('button', { name: 'Settings' });

    await user.click(trigger);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(onOpenChange).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('takes an explicit panel name for an icon-only trigger', async () => {
    const user = userEvent.setup();
    render(
      <Popover
        trigger={<span aria-hidden="true">⚙</span>}
        label="Settings"
        triggerProps={{ 'aria-label': 'Settings' }}
      >
        <p>Text size</p>
      </Popover>,
    );

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  });

  describe('with the platform popover API', () => {
    const showing = new WeakSet<Element>();
    const originalMatches = Element.prototype.matches;

    function install() {
      const proto = HTMLElement.prototype as HTMLElement & Record<string, unknown>;
      proto.showPopover = function showPopover(this: HTMLElement) {
        showing.add(this);
        this.dispatchEvent(new Event('toggle'));
      };
      proto.hidePopover = function hidePopover(this: HTMLElement) {
        showing.delete(this);
        this.dispatchEvent(new Event('toggle'));
      };
      Element.prototype.matches = function matches(this: Element, selector: string) {
        if (selector === ':popover-open') return showing.has(this);
        return originalMatches.call(this, selector);
      };
    }

    afterEach(() => {
      const proto = HTMLElement.prototype as Partial<HTMLElement>;
      delete proto.showPopover;
      delete proto.hidePopover;
      Element.prototype.matches = originalMatches;
    });

    it('shows and hides the panel in the top layer, and mirrors a platform dismissal', async () => {
      install();
      const user = userEvent.setup();
      render(<Definition />);

      const trigger = screen.getByRole('button', { name: 'resolver' });
      const panel = document.getElementById(trigger.getAttribute('aria-controls')!)!;
      expect(panel).toHaveAttribute('popover', 'auto');
      expect(panel).not.toHaveAttribute('hidden');

      await user.click(trigger);
      expect(showing.has(panel)).toBe(true);
      expect(trigger).toHaveAttribute('aria-expanded', 'true');

      // The platform light-dismisses it (a press outside, or Escape) on its own.
      act(() => panel.hidePopover());
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(trigger).toHaveFocus();

      await user.click(trigger);
      await user.click(trigger);
      expect(showing.has(panel)).toBe(false);
    });
  });
});
