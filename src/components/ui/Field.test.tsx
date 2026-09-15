import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Field } from './Field';
import { Select } from './Select';

describe('Field', () => {
  it('labels its control and describes it with the hint', () => {
    render(
      <Field label="Website name" hint="For example, example.com.">
        <input type="text" />
      </Field>,
    );

    const input = screen.getByRole('textbox', { name: 'Website name' });
    expect(input).toHaveAccessibleDescription('For example, example.com.');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('marks an error with aria-invalid and reads it before the hint, with no live region', () => {
    render(
      <Field
        label="Website name"
        hint="For example, example.com."
        error="That is not a website name. Try one with a dot in it."
      >
        <input type="text" />
      </Field>,
    );

    const input = screen.getByRole('textbox', { name: 'Website name' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(
      'That is not a website name. Try one with a dot in it. For example, example.com.',
    );

    // The view's one aria-live region is the step caption; a field error is not another.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(document.querySelector('[aria-live]')).toBeNull();
  });

  it('keeps an aria-describedby the control already had, after its own', () => {
    render(
      <>
        <p id="extra">Never sent anywhere.</p>
        <Field label="Path" hint="Starts with a slash.">
          <input type="text" aria-describedby="extra" />
        </Field>
      </>,
    );

    expect(screen.getByRole('textbox', { name: 'Path' })).toHaveAccessibleDescription(
      'Starts with a slash. Never sent anywhere.',
    );
  });

  it('says required in the label and sets aria-required', () => {
    render(
      <Field label="Host" required>
        <input type="text" />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Host (required)' });
    expect(input).toHaveAttribute('aria-required', 'true');
  });

  it('hands the wiring to a render function', () => {
    render(
      <Field label="Method" hint="GET reads, POST sends." error="Pick one.">
        {(control) => (
          <div>
            <Select {...control}>
              <option>GET</option>
              <option>POST</option>
            </Select>
          </div>
        )}
      </Field>,
    );

    const select = screen.getByRole('combobox', { name: 'Method' });
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAccessibleDescription('Pick one. GET reads, POST sends.');
  });

  it('passes focus to the control from its label, and keeps it there on Escape', async () => {
    const user = userEvent.setup();
    render(
      <Field label="Record type">
        <input type="text" />
      </Field>,
    );

    await user.click(screen.getByText('Record type'));
    const input = screen.getByRole('textbox', { name: 'Record type' });
    expect(input).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(input).toHaveFocus();
  });
});
