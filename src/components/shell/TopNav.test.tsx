import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MODULE_GROUPS, MODULES, modulesInGroup } from '@/modules/registry';

import { TopNav } from './TopNav';

const pathname = vi.hoisted(() => ({ current: '/' }));

vi.mock('next/navigation', () => ({
  usePathname: () => pathname.current,
}));

beforeEach(() => {
  pathname.current = '/';
});

describe('TopNav', () => {
  it('renders one menu per registry group, in registry order', () => {
    render(<TopNav />);

    const nav = screen.getByRole('navigation', { name: 'Modules' });
    const buttons = within(nav).getAllByRole('button');
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(
      MODULE_GROUPS.map((g) => g.label),
    );
  });

  it('lists a group’s modules from the registry, with their status', async () => {
    const user = userEvent.setup();
    render(<TopNav />);

    await user.click(screen.getByRole('button', { name: /Explore/ }));

    const menu = screen.getByRole('menu', { name: 'Explore' });
    const items = within(menu).getAllByRole('menuitem');
    expect(items).toHaveLength(modulesInGroup('explore').length);
    expect(within(menu).getByRole('menuitem', { name: /DNS Explorer/ })).toHaveAttribute(
      'href',
      '/dns-explorer',
    );
    expect(within(menu).getAllByText('Planned').length).toBe(items.length);
  });

  it('covers every registered module across the three groups', () => {
    const grouped = MODULE_GROUPS.flatMap((g) => modulesInGroup(g.key));
    expect(grouped).toHaveLength(MODULES.length);
  });

  it('marks the group and the item for the current route', async () => {
    pathname.current = '/dns-explorer';
    const user = userEvent.setup();
    render(<TopNav />);

    await user.click(screen.getByRole('button', { name: /Explore/ }));

    expect(screen.getByRole('menuitem', { name: /DNS Explorer/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('menuitem', { name: /HTTP Explorer/ })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('closes on Escape and hands focus back to its button', async () => {
    const user = userEvent.setup();
    render(<TopNav />);

    const trigger = screen.getByRole('button', { name: /Learn/ });
    await user.click(trigger);
    expect(screen.getByRole('menu', { name: 'Learn' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: 'Learn' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens with ArrowDown and moves between items with the arrow keys', async () => {
    const user = userEvent.setup();
    render(<TopNav />);

    screen.getByRole('button', { name: /Explore/ }).focus();
    await user.keyboard('{ArrowDown}');

    const items = await screen.findAllByRole('menuitem');
    expect(items[0]).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(items[1]).toHaveFocus();

    await user.keyboard('{End}');
    expect(items.at(-1)).toHaveFocus();
  });

  it('does not trap focus: tabbing out of the panel closes it', async () => {
    const user = userEvent.setup();
    render(<TopNav />);

    await user.click(screen.getByRole('button', { name: /Tools/ }));
    expect(screen.getByRole('menu', { name: 'Tools' })).toBeInTheDocument();

    // Tab from the trigger lands on the first item, then out of the group entirely.
    await user.tab();
    await user.tab();
    expect(screen.queryByRole('menu', { name: 'Tools' })).not.toBeInTheDocument();
  });
});
