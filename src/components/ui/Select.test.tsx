import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Field } from './Field';
import { Select } from './Select';

function Speed({ onChange = () => {} }: { onChange?: (value: string) => void }) {
  return (
    <Field label="Speed" hint="How fast the run plays.">
      <Select defaultValue="1" onChange={(event) => onChange(event.target.value)}>
        <option value="0.5">Half speed</option>
        <option value="1">Normal</option>
        <option value="2">Double</option>
      </Select>
    </Field>
  );
}

describe('Select', () => {
  it('is a native select, labelled and described through Field', () => {
    render(<Speed />);

    const select = screen.getByRole('combobox', { name: 'Speed' });
    expect(select.tagName).toBe('SELECT');
    expect(select).toHaveAccessibleDescription('How fast the run plays.');
    expect(select).toHaveDisplayValue('Normal');
  });

  it('is reachable and operable by keyboard, and keeps focus on Escape', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Speed onChange={onChange} />);
    const select = screen.getByRole('combobox', { name: 'Speed' });

    await user.tab();
    expect(select).toHaveFocus();

    await user.selectOptions(select, 'Double');
    expect(onChange).toHaveBeenCalledWith('2');
    expect(select).toHaveDisplayValue('Double');

    await user.keyboard('{Escape}');
    expect(select).toHaveFocus();
  });

  it('forwards its ref and keeps the chevron out of the accessibility tree', () => {
    const ref = createRef<HTMLSelectElement>();
    const { container } = render(
      <Select ref={ref} aria-label="Zoom" size="sm" className="w-40">
        <option>100%</option>
      </Select>,
    );

    expect(ref.current).toBe(screen.getByRole('combobox', { name: 'Zoom' }));
    expect(container.firstElementChild).toHaveClass('w-40');
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
