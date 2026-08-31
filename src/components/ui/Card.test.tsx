import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Card } from './Card';

describe('Card', () => {
  it('renders the optional header, body, and footer', () => {
    render(
      <Card
        title="DNS Explorer"
        description="Walk a lookup from stub resolver to authoritative server."
        actions={<span>planned</span>}
        footer="3 topics"
        className="mt-4"
      >
        <p>Body</p>
      </Card>,
    );

    expect(screen.getByRole('heading', { name: 'DNS Explorer', level: 3 })).toBeVisible();
    expect(screen.getByText(/stub resolver/)).toBeVisible();
    expect(screen.getByText('planned')).toBeVisible();
    expect(screen.getByText('Body')).toBeVisible();
    expect(screen.getByText('3 topics')).toBeVisible();
  });

  it('omits the header entirely when it has no header content', () => {
    render(<Card data-testid="card">Body</Card>);

    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByTestId('card')).toHaveClass('bg-surface-raised');
  });
});
