import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { preloadInlineGlossary } from '@/components/glossary';
import { inlineTerm } from '@/core/glossary/inline';
import { getChapter, getModule } from '@/modules/registry';

import { LEVEL_LABEL } from './navItems';
import { ModuleChrome } from './ModuleChrome';

const pathname = vi.hoisted(() => ({ current: '/dns-explorer' }));

vi.mock('next/navigation', () => ({
  usePathname: () => pathname.current,
}));

beforeAll(async () => {
  await preloadInlineGlossary();
});

beforeEach(() => {
  pathname.current = '/dns-explorer';
});

describe('ModuleChrome', () => {
  it('titles the page from the registry entry, with its question under it', () => {
    render(
      <ModuleChrome>
        <p>module body</p>
      </ModuleChrome>,
    );

    const meta = getModule('dns-explorer')!;
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent(meta.title);
    expect(screen.getByText(meta.question)).toBeInTheDocument();
    expect(screen.getByText('module body')).toBeInTheDocument();
  });

  it('draws the breadcrumb Home / Explore / chapter / title', () => {
    render(<ModuleChrome>{null}</ModuleChrome>);

    const meta = getModule('dns-explorer')!;
    const crumbs = within(screen.getByRole('navigation', { name: 'Breadcrumb' }));
    const items = crumbs.getAllByRole('listitem').map((li) => li.textContent?.trim());
    expect(items).toEqual([
      'Home',
      'Explore',
      getChapter(meta.chapter)!.label,
      meta.title,
    ]);

    expect(crumbs.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(crumbs.getAllByRole('listitem').at(-1)).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('shows the level, the minutes and the safety badge, and no status', () => {
    render(<ModuleChrome>{null}</ModuleChrome>);

    const meta = getModule('dns-explorer')!;
    expect(screen.getByText(LEVEL_LABEL[meta.level])).toBeInTheDocument();
    expect(screen.getByText(`${meta.minutes} min`)).toBeInTheDocument();
    expect(screen.getByText('Simulated')).toBeInTheDocument();
    expect(screen.queryByText(/^(Planned|In progress|Ready)$/)).toBeNull();
  });

  it('gives Network Diagnostics the live badge with its warning', async () => {
    pathname.current = getModule('network-diagnostics')!.route;
    const user = userEvent.setup();
    render(<ModuleChrome>{null}</ModuleChrome>);

    const badge = screen.getByText('Live network');
    await user.hover(badge);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/real network/i);
  });

  it('lists its topics as glossary terms, and plain badges for the rest', async () => {
    const user = userEvent.setup();
    render(<ModuleChrome>{null}</ModuleChrome>);

    const words = screen.getByRole('list', { name: /Words you’ll meet/ });
    const topics = getModule('dns-explorer')!.topics;
    expect(within(words).getAllByRole('listitem')).toHaveLength(topics.length);

    const defined = topics.filter((topic) => inlineTerm(topic));
    const undefinedTopics = topics.filter((topic) => !inlineTerm(topic));
    // The fixture has to exercise both branches, or this test proves half of it.
    expect(defined.length).toBeGreaterThan(0);

    for (const topic of defined) {
      expect(within(words).getByRole('button', { name: topic })).toBeInTheDocument();
    }
    for (const topic of undefinedTopics) {
      expect(within(words).getByText(topic).closest('button')).toBeNull();
    }

    await user.click(within(words).getByRole('button', { name: defined[0]! }));
    expect(
      await screen.findByRole('link', { name: /Read more in the glossary/ }),
    ).toHaveAttribute('href', `/learn/glossary#${inlineTerm(defined[0]!)!.slug}`);
  });

  it('renders a topic the glossary does not define as a plain badge', () => {
    pathname.current = getModule('network-map')!.route;
    render(<ModuleChrome>{null}</ModuleChrome>);

    const words = screen.getByRole('list', { name: /Words you’ll meet/ });
    const plain = getModule('network-map')!.topics.filter((topic) => !inlineTerm(topic));
    expect(plain.length).toBeGreaterThan(0);
    for (const topic of plain) {
      expect(within(words).getByText(topic).closest('button')).toBeNull();
    }
  });

  it('resolves nested module routes to the same chrome', () => {
    pathname.current = '/dns-explorer/root-servers';
    render(<ModuleChrome>{null}</ModuleChrome>);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('DNS Explorer');
  });

  it('collapses the panel slot until a module fills it', () => {
    const { container, rerender } = render(<ModuleChrome>{null}</ModuleChrome>);
    expect(container.querySelector('aside')).toBeEmptyDOMElement();

    rerender(<ModuleChrome panel={<p>Explanation</p>}>{null}</ModuleChrome>);
    expect(container.querySelector('aside')).toHaveTextContent('Explanation');
  });

  it('renders content bare for a route with no registry entry', () => {
    pathname.current = '/not-a-module';
    render(
      <ModuleChrome>
        <p>orphan</p>
      </ModuleChrome>,
    );

    expect(screen.getByText('orphan')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });
});
