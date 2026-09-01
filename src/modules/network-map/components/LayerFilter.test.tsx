import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { HOME_LAN } from '@/core/topologies';
import type { LayerKey } from '@/lib/theme';

import { LayerFilter } from './LayerFilter';

function renderFilter(layer: LayerKey | null = null, onChange = vi.fn()) {
  render(<LayerFilter topology={HOME_LAN.topology} layer={layer} onChange={onChange} />);
  return onChange;
}

describe('LayerFilter', () => {
  it('offers only the layers this scenario has machines at', () => {
    renderFilter();

    expect(screen.getByRole('button', { name: /L2 Link/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /L3 Network/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /L7 Application/ })).toBeInTheDocument();
    // A home LAN has no load balancer, so a transport button would dim everything.
    expect(screen.queryByRole('button', { name: /L4 Transport/ })).toBeNull();
  });

  it('names the layer in words as well as by its colour, and says how many machines', () => {
    renderFilter();

    // Three switches: the access point, the LAN switch, and the bridged fibre terminal.
    expect(
      screen.getByRole('button', { name: 'L2 Link — 3 machines' }),
    ).toBeInTheDocument();
  });

  it('starts on All when no layer is chosen', () => {
    renderFilter(null);

    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('chooses a layer', async () => {
    const onChange = renderFilter(null);

    await userEvent.click(screen.getByRole('button', { name: /L3 Network/ }));

    expect(onChange).toHaveBeenCalledWith('network');
  });

  /** Pressing the layer already in focus is how you get back out of it. */
  it('clears the filter when the active layer is pressed again', async () => {
    const onChange = renderFilter('network');

    await userEvent.click(screen.getByRole('button', { name: /L3 Network/ }));

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('clears the filter from All', async () => {
    const onChange = renderFilter('link');

    await userEvent.click(screen.getByRole('button', { name: 'All' }));

    expect(onChange).toHaveBeenCalledWith(null);
  });
});
