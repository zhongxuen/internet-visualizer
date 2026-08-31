import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { SafetyBadge, safetyVariantFor } from './SafetyBadge';

describe('SafetyBadge', () => {
  it('defaults to the calm simulated variant', () => {
    render(<SafetyBadge />);

    const badge = screen.getByText('Simulated');
    expect(badge).toHaveAttribute('data-variant', 'simulated');
    expect(badge).toHaveClass('text-fg-muted');
  });

  it('marks the live variant with its own colour, icon, and wording', () => {
    render(<SafetyBadge variant="live" />);

    const badge = screen.getByText('Live network');
    expect(badge).toHaveAttribute('data-variant', 'live');
    expect(badge).toHaveClass('text-state-warn');
    // Colour is never the only signal: an icon rides along with the text.
    expect(badge.querySelector('svg')).toBeInTheDocument();
  });

  it('states that the live variant touches a real network, reachable by keyboard', async () => {
    const user = userEvent.setup();
    render(<SafetyBadge variant="live" />);

    await user.tab();
    expect(screen.getByText('Live network')).toHaveFocus();

    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      /touches a real network/i,
    );
  });

  it('keeps its label available when compacted to the icon alone', () => {
    render(<SafetyBadge variant="live" compact />);

    expect(screen.getByLabelText('Live network')).toBeInTheDocument();
    expect(screen.queryByText('Live network')).not.toBeInTheDocument();
  });

  it('maps the registry flag to a variant', () => {
    expect(safetyVariantFor(false)).toBe('simulated');
    expect(safetyVariantFor(true)).toBe('live');
  });
});
