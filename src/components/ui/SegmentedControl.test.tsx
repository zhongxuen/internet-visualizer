import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SegmentedControl, type SegmentedOption } from './SegmentedControl';

type Detail = 'simple' | 'full' | 'raw';

const OPTIONS: SegmentedOption<Detail>[] = [
  { value: 'simple', label: 'Simple' },
  { value: 'full', label: 'Full detail' },
  { value: 'raw', label: 'Raw' },
];

describe('SegmentedControl', () => {
  it('is a named radio group with one checked radio and one tab stop', async () => {
    const user = userEvent.setup();
    render(<SegmentedControl options={OPTIONS} label="Detail" defaultValue="full" />);

    expect(screen.getByRole('radiogroup', { name: 'Detail' })).toBeInTheDocument();
    const [simple, full, raw] = screen.getAllByRole('radio');

    expect(full).toHaveAttribute('aria-checked', 'true');
    expect(simple).toHaveAttribute('aria-checked', 'false');
    expect([simple, full, raw].map((radio) => radio.tabIndex)).toEqual([-1, 0, -1]);

    await user.tab();
    expect(full).toHaveFocus();
  });

  it('moves and selects with the arrow keys, Home and End, wrapping at the ends', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <SegmentedControl options={OPTIONS} label="Detail" onValueChange={onValueChange} />,
    );
    const [simple, full, raw] = screen.getAllByRole('radio');

    await user.tab();
    expect(simple).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(full).toHaveFocus();
    expect(full).toHaveAttribute('aria-checked', 'true');
    expect(full.tabIndex).toBe(0);
    expect(simple.tabIndex).toBe(-1);

    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(raw).toHaveFocus();

    await user.keyboard('{Home}');
    expect(simple).toHaveFocus();
    await user.keyboard('{End}');
    expect(raw).toHaveFocus();

    expect(onValueChange.mock.calls.map(([value]) => value)).toEqual([
      'full',
      'simple',
      'raw',
      'simple',
      'raw',
    ]);

    // Not an overlay: Escape changes nothing, and focus stays on the checked radio.
    await user.keyboard('{Escape}');
    expect(raw).toHaveFocus();
    expect(raw).toHaveAttribute('aria-checked', 'true');
  });

  it('skips disabled options and selects on click', async () => {
    const user = userEvent.setup();
    render(
      <SegmentedControl
        options={[OPTIONS[0], { ...OPTIONS[1], disabled: true }, OPTIONS[2]]}
        label="Detail"
      />,
    );
    const [simple, , raw] = screen.getAllByRole('radio');

    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(raw).toHaveFocus();

    await user.click(simple);
    expect(simple).toHaveAttribute('aria-checked', 'true');
  });

  it('keeps a tab stop when a controlled value matches no option', async () => {
    const user = userEvent.setup();
    render(
      <SegmentedControl
        options={OPTIONS}
        label="Detail"
        value={'none' as Detail}
        onValueChange={() => {}}
      />,
    );

    await user.tab();
    expect(screen.getAllByRole('radio')[0]).toHaveFocus();
    expect(screen.queryByRole('radio', { checked: true })).not.toBeInTheDocument();
  });
});
