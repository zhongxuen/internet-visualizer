import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { HeaderField } from '@/core/types/pdu';

import { HeaderTable } from './HeaderTable';

/**
 * The table is where the animation is held to the specification, so what is asserted
 * here is that it prints what the scenario gave it and nothing else: the real field
 * names, in wire order, with the widths the standard states and an em dash where it
 * states none. The width bar is decoration and is checked only for being hidden from
 * assistive technology -- the bit count beside it is the fact.
 */

const IPV4_FIELDS: HeaderField[] = [
  { name: 'Version', value: '4', bits: 4 },
  {
    name: 'TTL',
    value: '64',
    bits: 8,
    note: 'Every router subtracts one; at zero the packet is dropped.',
  },
  { name: 'Source', value: '192.0.2.10', bits: 32 },
  { name: 'Options', value: 'none' },
];

/** The field rows only -- the `<thead>` is a `<tbody>`-less row group of its own. */
function fieldRows(): HTMLElement[] {
  return screen
    .getAllByRole('row')
    .filter((row) => within(row).queryAllByRole('rowheader').length > 0);
}

describe('HeaderTable', () => {
  it('lists every field in wire order, name and value together', () => {
    render(<HeaderTable fields={IPV4_FIELDS} layer="network" />);

    expect(
      fieldRows().map((row) => within(row).getByRole('rowheader').textContent),
    ).toEqual(['Version', 'TTL', 'Source', 'Options']);
    expect(
      screen.getByRole('rowheader', { name: 'Source' }).parentElement,
    ).toHaveTextContent('192.0.2.10');
  });

  it('prints the width in bits, spelled out for a screen reader', () => {
    render(<HeaderTable fields={IPV4_FIELDS} layer="network" />);

    const ttl = screen.getByRole('rowheader', { name: 'TTL' }).parentElement!;

    expect(ttl).toHaveTextContent('8');
    expect(within(ttl).getByText('bits')).toHaveClass('sr-only');
  });

  it('draws the width to scale against the widest field, as decoration only', () => {
    const { container } = render(<HeaderTable fields={IPV4_FIELDS} layer="network" />);

    const bars = container.querySelectorAll<HTMLElement>('[aria-hidden="true"] > span');

    // 4, 8 and 32 bits against a 32-bit widest: an eighth, a quarter, and the whole bar.
    expect([...bars].map((bar) => bar.style.width)).toEqual(['12.5%', '25%', '100%']);
  });

  it('says nothing about a width the scenario did not state', () => {
    render(<HeaderTable fields={IPV4_FIELDS} />);

    const options = screen.getByRole('rowheader', { name: 'Options' }).parentElement!;

    expect(options).toHaveTextContent('—');
    expect(within(options).queryByText('bits')).not.toBeInTheDocument();
  });

  it('carries the teaching note for the field it belongs to', () => {
    render(<HeaderTable fields={IPV4_FIELDS} layer="network" />);

    expect(screen.getByText(/every router subtracts one/i)).toBeInTheDocument();
  });

  it('captions itself, and takes a caption from the layer that owns it', () => {
    const { rerender } = render(<HeaderTable fields={IPV4_FIELDS} />);
    expect(screen.getByText(/fields in wire order/i)).toBeInTheDocument();

    rerender(
      <HeaderTable fields={IPV4_FIELDS} caption="IPv4 header — fields in wire order." />,
    );
    expect(screen.getByText('IPv4 header — fields in wire order.')).toBeInTheDocument();
  });

  it('says so plainly when a header has no fields, rather than drawing an empty grid', () => {
    render(<HeaderTable fields={[]} />);

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText(/no fields in the scenario/i)).toBeInTheDocument();
  });
});
