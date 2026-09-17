import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { QuickStart } from './QuickStart';

describe('QuickStart', () => {
  beforeEach(() => push.mockReset());

  it('is a real GET form to the simulator, so it works before hydration', () => {
    const { container } = render(<QuickStart />);

    const form = container.querySelector('form');
    expect(form).toHaveAttribute('action', '/internet-simulator');
    expect(form).toHaveAttribute('method', 'get');
    expect(screen.getByRole('textbox', { name: /type a website/i })).toHaveAttribute(
      'name',
      'url',
    );
  });

  it('navigates to the simulator with the address', async () => {
    const user = userEvent.setup();
    render(<QuickStart />);

    await user.type(screen.getByRole('textbox'), 'example.com');
    await user.click(screen.getByRole('button', { name: 'Watch' }));

    expect(push).toHaveBeenCalledWith('/internet-simulator?url=example.com');
  });

  it('refuses a shape that is not an address, says why, and keeps focus on the field', async () => {
    const user = userEvent.setup();
    render(<QuickStart />);

    const field = screen.getByRole('textbox');
    await user.type(field, 'not an address');
    fireEvent.submit(field.closest('form')!);

    expect(push).not.toHaveBeenCalled();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription(/doesn't look like a web address/);
    expect(field).toHaveFocus();

    await user.type(field, 'x');
    expect(field).not.toHaveAttribute('aria-invalid');
  });
});
