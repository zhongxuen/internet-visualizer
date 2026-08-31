import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from './Button';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders title, description, and an action', () => {
    render(
      <EmptyState
        title="Not built yet"
        description="This module is still marked planned in the registry."
        action={<Button size="sm">Back to modules</Button>}
      />,
    );

    expect(screen.getByText('Not built yet')).toBeVisible();
    expect(screen.getByText(/still marked planned/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Back to modules' })).toBeVisible();
  });
});
