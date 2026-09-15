import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { Button } from './Button';
import { Drawer, type DrawerProps } from './Drawer';

function Harness({ side }: Pick<DrawerProps, 'side'>) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>Menu</Button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Menu" side={side}>
        <nav aria-label="Main">
          <a href="#start">Start here</a>
          <a href="#lessons">Lessons</a>
        </nav>
      </Drawer>
    </>
  );
}

describe('Drawer', () => {
  it('is a named dialog that keeps its links mounted while closed', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);

    // Closed: not exposed, but the links are in the markup (and so in the server HTML).
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(container.querySelector('a[href="#start"]')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Menu' }));
    const drawer = screen.getByRole('dialog', { name: 'Menu' });
    expect(drawer).toContainElement(screen.getByRole('link', { name: 'Start here' }));
  });

  it('moves focus in, reaches its links by keyboard, and Escape returns focus', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Menu' });

    await user.tab();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog')).toContainElement(
      document.activeElement as HTMLElement,
    );

    await user.tab();
    expect(screen.getByRole('link', { name: 'Start here' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('closes from its close button and returns focus', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Menu' });

    await user.click(opener);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('is a bottom sheet on a phone and a side sheet on the chosen edge from sm up', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness side="right" />);
    await user.click(screen.getByRole('button', { name: 'Menu' }));

    const right = screen.getByRole('dialog');
    expect(right).toHaveClass('bottom-0', 'sm:right-0');
    expect(right).not.toHaveClass('sm:left-0');
    unmount();

    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.getByRole('dialog')).toHaveClass('sm:left-0');
  });
});
