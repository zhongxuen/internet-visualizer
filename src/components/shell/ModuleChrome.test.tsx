import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getModule } from '@/modules/registry';

import { ModuleChrome } from './ModuleChrome';

const pathname = vi.hoisted(() => ({ current: '/dns-explorer' }));

vi.mock('next/navigation', () => ({
  usePathname: () => pathname.current,
}));

beforeEach(() => {
  pathname.current = '/dns-explorer';
});

describe('ModuleChrome', () => {
  it('titles the page from the registry entry the URL resolves to', () => {
    render(
      <ModuleChrome>
        <p>module body</p>
      </ModuleChrome>,
    );

    const meta = getModule('dns-explorer')!;
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent(meta.title);
    expect(screen.getByText(meta.summary)).toBeInTheDocument();
    expect(screen.getByText('module body')).toBeInTheDocument();
  });

  it('shows the back link, topic badges, and safety badge', () => {
    render(<ModuleChrome>{null}</ModuleChrome>);

    expect(screen.getByRole('link', { name: /All modules/ })).toHaveAttribute(
      'href',
      '/',
    );

    const topics = screen.getByRole('list', { name: 'Topics' });
    for (const topic of getModule('dns-explorer')!.topics) {
      expect(within(topics).getByText(topic)).toBeInTheDocument();
    }

    expect(screen.getByText('Simulated')).toBeInTheDocument();
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
