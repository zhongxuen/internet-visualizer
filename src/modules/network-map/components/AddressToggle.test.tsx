import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AddressToggle } from './AddressToggle';

describe('AddressToggle', () => {
  it('is a switch, so its state is announced without being read off the screen', async () => {
    const onChange = vi.fn();
    render(<AddressToggle showAddresses onChange={onChange} />);

    const toggle = screen.getByRole('switch', { name: 'Addresses' });
    expect(toggle).toBeChecked();

    await userEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('turns addresses back on when they are hidden', async () => {
    const onChange = vi.fn();
    render(<AddressToggle showAddresses={false} onChange={onChange} />);

    const toggle = screen.getByRole('switch', { name: 'Addresses' });
    expect(toggle).not.toBeChecked();

    await userEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  /**
   * The tooltip has to say where the addresses went, or hiding them reads as losing
   * them.
   */
  it('explains that the inspector still has them', async () => {
    render(<AddressToggle showAddresses={false} onChange={vi.fn()} />);

    await userEvent.hover(screen.getByRole('switch', { name: 'Addresses' }));

    expect(await screen.findByText(/inspector/)).toBeInTheDocument();
  });
});
