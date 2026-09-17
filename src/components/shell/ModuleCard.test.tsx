import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ModuleMeta } from '@/modules/registry';

import { ModuleCard } from './ModuleCard';

const base: ModuleMeta = {
  id: 'dns-explorer',
  group: 'explore',
  title: 'DNS Explorer',
  route: '/dns-explorer',
  summary: 'Walk a domain lookup from stub resolver to authoritative server.',
  status: 'planned',
  topics: ['DNS', 'UDP', 'Caching', 'Anycast'],
  usesRealNetwork: false,
  question: "How does your computer find a website's address?",
  plainSummary: 'Watch your computer ask a chain of servers until one knows the number.',
  level: 'beginner',
  chapter: 'websites',
  minutes: 8,
};

function renderCard(module: ModuleMeta) {
  return render(
    <ul>
      <ModuleCard module={module} />
    </ul>,
  );
}

describe('ModuleCard', () => {
  it('links the whole card to the module route under its title', () => {
    renderCard(base);

    const link = screen.getByRole('link', { name: 'DNS Explorer' });
    expect(link).toHaveAttribute('href', '/dns-explorer');
  });

  it('asks the module question and gives its level and length in words', () => {
    renderCard(base);

    expect(screen.getByText(base.question)).toBeInTheDocument();
    expect(screen.getByText('Beginner')).toBeInTheDocument();
    expect(screen.getByText('8 min')).toBeInTheDocument();
  });

  it('shows no status badge, and no length where the registry gives none', () => {
    renderCard({ ...base, status: 'ready', minutes: undefined });

    expect(screen.queryByText(/^(Planned|In progress|Ready)$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bmin$/)).not.toBeInTheDocument();
  });

  it('states the safety posture of every module, live or not', () => {
    // Compact: the word is still in the badge, as visually hidden text.
    const { unmount } = renderCard(base);
    expect(screen.getByText('Simulated').closest('[data-variant]')).toHaveAttribute(
      'data-variant',
      'simulated',
    );
    unmount();

    renderCard({ ...base, id: 'network-diagnostics', usesRealNetwork: true });
    expect(screen.getByText('Live network').closest('[data-variant]')).toHaveAttribute(
      'data-variant',
      'live',
    );
  });

  it('titles itself one level deeper under a chapter heading', () => {
    const { unmount } = renderCard(base);
    expect(
      screen.getByRole('heading', { level: 3, name: 'DNS Explorer' }),
    ).toBeInTheDocument();
    unmount();

    render(
      <ul>
        <ModuleCard module={base} headingLevel={4} />
      </ul>,
    );
    expect(
      screen.getByRole('heading', { level: 4, name: 'DNS Explorer' }),
    ).toBeInTheDocument();
  });

  it('renders its idle glyph as decoration only', () => {
    const { container } = renderCard(base);

    const glyph = container.querySelector('svg[aria-hidden="true"]');
    expect(glyph).toBeInTheDocument();
    expect(within(container).queryByRole('img')).not.toBeInTheDocument();
  });
});
