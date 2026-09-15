import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Button } from './Button';
import { Dialog } from './Dialog';

/**
 * jsdom has no `showModal()`, so the component's fallback runs by default -- the same
 * path an older browser takes. The last block stands in for the platform's API to check
 * the native path: that it is used, and that a close the platform performs itself
 * (Escape) reaches the parent.
 */

function Harness({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>How to use this page</Button>
      <Dialog
        open={open}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        title="How to use this page"
        description="Three steps, and the keys that do the same."
        footer={<Button onClick={() => setOpen(false)}>Got it</Button>}
      >
        <p>Press Play to watch it happen.</p>
      </Dialog>
    </>
  );
}

async function openIt() {
  const user = userEvent.setup();
  render(<Harness />);
  const opener = screen.getByRole('button', { name: 'How to use this page' });
  await user.click(opener);
  return { user, opener, dialog: screen.getByRole('dialog') };
}

describe('Dialog', () => {
  it('is closed until opened, then named and described by its title and description', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'How to use this page' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('How to use this page');
    expect(dialog).toHaveAccessibleDescription(
      'Three steps, and the keys that do the same.',
    );
    expect(
      screen.getByRole('heading', { level: 2, name: 'How to use this page' }),
    ).toBeVisible();
    expect(screen.getByText('Press Play to watch it happen.')).toBeVisible();
  });

  it('puts focus on the body, not on the close button', async () => {
    const { dialog, user } = await openIt();
    const body = screen.getByText('Press Play to watch it happen.').parentElement!;

    expect(body).toHaveFocus();
    expect(dialog).toContainElement(body);

    // The close button is one Shift+Tab away; the footer's action is one Tab away.
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('closes on Escape and returns focus to the opener', async () => {
    const { user, opener } = await openIt();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('closes from the close button and returns focus to the opener', async () => {
    const { user, opener } = await openIt();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('returns focus when the parent closes it too', async () => {
    const { user, opener } = await openIt();

    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('closes on a click on the backdrop, and not on a click inside', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'How to use this page' }));

    await user.click(screen.getByText('Press Play to watch it happen.'));
    expect(onClose).not.toHaveBeenCalled();

    // A backdrop click lands on the <dialog> element itself.
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  describe('with the platform dialog API', () => {
    afterEach(() => {
      const proto = HTMLDialogElement.prototype as Partial<HTMLDialogElement>;
      delete proto.showModal;
      delete proto.close;
    });

    it('opens with showModal() and reports a platform close (Escape) to the parent', async () => {
      const showModal = vi.fn(function showModal(this: HTMLDialogElement) {
        this.setAttribute('open', '');
      });
      const proto = HTMLDialogElement.prototype as HTMLDialogElement &
        Record<string, unknown>;
      proto.showModal = showModal;
      proto.close = function close(this: HTMLDialogElement) {
        this.removeAttribute('open');
        this.dispatchEvent(new Event('close'));
      };

      const onClose = vi.fn();
      const user = userEvent.setup();
      render(<Harness onClose={onClose} />);
      const opener = screen.getByRole('button', { name: 'How to use this page' });

      await user.click(opener);
      expect(showModal).toHaveBeenCalledOnce();
      const dialog = screen.getByRole('dialog');

      // The platform closes the dialog itself on Escape and fires `close`.
      act(() => (dialog as HTMLDialogElement).close());
      expect(onClose).toHaveBeenCalledOnce();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(opener).toHaveFocus();
    });
  });
});
