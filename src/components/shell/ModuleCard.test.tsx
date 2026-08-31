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
    expect(screen.getByText(base.summary)).toBeInTheDocument();
  });

  it('shows status and caps the topic badges with a count of the rest', () => {
    renderCard(base);

    expect(screen.getByText('Planned')).toBeInTheDocument();
    expect(screen.getByText('DNS')).toBeInTheDocument();
    expect(screen.queryByText('Anycast')).not.toBeInTheDocument();
    expect(screen.getByText('+1 more')).toBeInTheDocument();
  });

  it('stays reachable while planned, so its EmptyState route is not orphaned', () => {
    renderCard(base);

    const link = screen.getByRole('link', { name: 'DNS Explorer' });
    expect(link).not.toHaveAttribute('aria-disabled');
  });

  it('states the safety posture of every module, live or not', () => {
    const { unmount } = renderCard(base);
    expect(screen.getByText('Simulated')).toBeInTheDocument();
    unmount();

    renderCard({ ...base, id: 'network-diagnostics', usesRealNetwork: true });
    expect(screen.getByText('Live network')).toBeInTheDocument();
  });

  it('renders its idle glyph as decoration only', () => {
    const { container } = renderCard(base);

    const glyph = container.querySelector('svg[aria-hidden="true"]');
    expect(glyph).toBeInTheDocument();
    expect(within(container).queryByRole('img')).not.toBeInTheDocument();
  });
});
