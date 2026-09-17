import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MODULE_CHAPTERS,
  MODULES,
  getModule,
  modulesInChapter,
} from '@/modules/registry';

import { LEVEL_LABEL } from './navItems';
import { TopNav } from './TopNav';

const pathname = vi.hoisted(() => ({ current: '/' }));

vi.mock('next/navigation', () => ({
  usePathname: () => pathname.current,
}));

beforeEach(() => {
  pathname.current = '/';
});

describe('TopNav', () => {
  it('shows Start here, Explore, Lessons and Glossary in that order', () => {
    render(<TopNav />);

    const nav = screen.getByRole('navigation', { name: 'Main' });
    const items = [...nav.querySelectorAll('a, button')];
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      'Start here',
      'Explore',
      'Lessons',
      'Glossary',
    ]);
    expect(within(nav).getByRole('link', { name: 'Start here' })).toHaveAttribute(
      'href',
      '/start',
    );
    expect(within(nav).getByRole('link', { name: 'Lessons' })).toHaveAttribute(
      'href',
      '/learn',
    );
    expect(within(nav).getByRole('link', { name: 'Glossary' })).toHaveAttribute(
      'href',
      '/learn/glossary',
    );
  });

  it('keeps Settings and the phone menu button outside the link row', () => {
    render(<TopNav />);

    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Menu' })).toBeInTheDocument();
  });

  it('groups Explore by chapter, in registry order, with every module in it', async () => {
    const user = userEvent.setup();
    render(<TopNav />);

    await user.click(screen.getByRole('button', { name: /Explore/ }));

    const menu = screen.getByRole('menu', { name: 'Explore' });
    const groups = within(menu).getAllByRole('group');
    expect(groups).toHaveLength(MODULE_CHAPTERS.length);

    MODULE_CHAPTERS.forEach((chapter, index) => {
      const group = within(menu).getByRole('group', { name: chapter.label });
      expect(groups[index]).toBe(group);
      const routes = within(group)
        .getAllByRole('menuitem')
        .map((item) => item.getAttribute('href'));
      expect(routes).toEqual(modulesInChapter(chapter.key).map((m) => m.route));
    });

    expect(within(menu).getAllByRole('menuitem')).toHaveLength(MODULES.length);
  });

  it('shows each module’s title, question and level, and no status badge', async () => {
    const user = userEvent.setup();
    render(<TopNav />);

    await user.click(screen.getByRole('button', { name: /Explore/ }));
    const menu = screen.getByRole('menu', { name: 'Explore' });

    const dns = getModule('dns-explorer')!;
    const item = within(menu).getByRole('menuitem', { name: new RegExp(dns.title) });
    expect(item).toHaveAttribute('href', dns.route);
    expect(item).toHaveTextContent(dns.question);
    expect(item).toHaveTextContent(LEVEL_LABEL[dns.level]);

    // Every module is ready, so a status says nothing; it is gone from the nav.
    expect(within(menu).queryByText(/^(Planned|In progress|Ready)$/)).toBeNull();
  });

  it('keeps the compact live badge on Network Diagnostics, and only there', async () => {
    const user = userEvent.setup();
    render(<TopNav />);

    await user.click(screen.getByRole('button', { name: /Explore/ }));
    const menu = screen.getByRole('menu', { name: 'Explore' });

    const live = MODULES.filter((m) => m.usesRealNetwork);
    expect(live.map((m) => m.id)).toEqual(['network-diagnostics']);
    const badges = menu.querySelectorAll('[data-variant="live"]');
    expect(badges).toHaveLength(1);
    expect(
      within(menu).getByRole('menuitem', { name: /Network Diagnostics/ }),
    ).toContainElement(badges[0] as HTMLElement);
    // Inside a link, so it must not be a tab stop of its own.
    expect(badges[0]).not.toHaveAttribute('tabindex');
  });

  it('marks Explore and the item for the current route', async () => {
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

  it('marks Glossary, not Lessons, on the glossary page', () => {
    pathname.current = '/learn/glossary';
    render(<TopNav />);

    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Glossary' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Lessons' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('closes on Escape and hands focus back to its button', async () => {
    const user = userEvent.setup();
    render(<TopNav />);

    const trigger = screen.getByRole('button', { name: /Explore/ });
    await user.click(trigger);
    expect(screen.getByRole('menu', { name: 'Explore' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: 'Explore' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens with ArrowDown and moves between items across chapters', async () => {
    const user = userEvent.setup();
    render(<TopNav />);

    screen.getByRole('button', { name: /Explore/ }).focus();
    await user.keyboard('{ArrowDown}');

    const items = await screen.findAllByRole('menuitem');
    expect(items[0]).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(items[1]).toHaveFocus();

    // The first chapter has two modules, so the third item is in the second chapter.
    await user.keyboard('{ArrowDown}');
    expect(items[2]).toHaveFocus();

    await user.keyboard('{End}');
    expect(items.at(-1)).toHaveFocus();
  });

  it('does not trap focus: tabbing out of the panel closes it', async () => {
    const user = userEvent.setup();
    render(<TopNav />);

    await user.click(screen.getByRole('button', { name: /Explore/ }));
    expect(screen.getByRole('menu', { name: 'Explore' })).toBeInTheDocument();

    // Tab from the trigger walks the items, then out of the menu entirely.
    for (let i = 0; i <= MODULES.length; i += 1) await user.tab();
    expect(screen.queryByRole('menu', { name: 'Explore' })).not.toBeInTheDocument();
  });

  it('opens the same items in a drawer from the menu button', async () => {
    const user = userEvent.setup();
    render(<TopNav />);

    await user.click(screen.getByRole('button', { name: 'Menu' }));

    const drawer = screen.getByRole('dialog', { name: 'Menu' });
    const nav = within(drawer).getByRole('navigation', { name: 'Menu' });
    for (const name of ['Start here', 'Lessons', 'Glossary']) {
      expect(within(nav).getByRole('link', { name })).toBeInTheDocument();
    }
    for (const chapter of MODULE_CHAPTERS) {
      expect(
        within(nav).getByRole('heading', { level: 3, name: chapter.label }),
      ).toBeInTheDocument();
    }
    for (const meta of MODULES) {
      expect(
        within(nav).getByRole('link', { name: new RegExp(meta.title) }),
      ).toHaveAttribute('href', meta.route);
    }
  });
});
