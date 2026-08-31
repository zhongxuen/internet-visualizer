import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { layerColor } from '@/lib/theme';

import { Badge } from './Badge';

describe('Badge', () => {
  it('renders a tone pill with token classes', () => {
    render(
      <Badge tone="ok" className="ml-2">
        Ready
      </Badge>,
    );

    const badge = screen.getByText('Ready');
    expect(badge).toHaveClass('text-state-ok', 'ml-2');
  });

  it('colours a layer badge from the token accessors and always shows its short label', () => {
    render(<Badge layer="transport" />);

    const badge = screen.getByText('L4').parentElement;
    expect(badge).toHaveTextContent('L4');
    expect(badge).toHaveTextContent('Transport');
    expect(badge).toHaveStyle({ color: layerColor('transport') });
  });
});
