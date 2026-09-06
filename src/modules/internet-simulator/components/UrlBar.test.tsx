import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { UrlBar } from './UrlBar';

/**
 * The address bar.
 *
 * Three claims are on screen and all three are checkable: that this is simulated and says
 * so; that a URL is validated before it can be run; and that a host the bundled zones have
 * never heard of is called out *while typing*, not after a run has ended in an error page a
 * learner would otherwise read as a fact about the real site.
 */

function renderBar(value = 'https://www.example.com/') {
  const onSubmit = vi.fn();
  render(<UrlBar value={value} onSubmit={onSubmit} />);
  return { onSubmit, input: screen.getByRole('textbox') };
}

describe('UrlBar', () => {
  it('is badged simulated, and the badge is not a hover-only affordance', () => {
    renderBar();
    expect(screen.getByText('Simulated')).toBeInTheDocument();
  });

  it('submits the normalised parse rather than the raw string', () => {
    const { onSubmit, input } = renderBar();

    fireEvent.change(input, { target: { value: 'blog.example.com' } });
    fireEvent.submit(input);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).toBe('https://blog.example.com/');
    expect(onSubmit.mock.calls[0]![1]).toMatchObject({
      scheme: 'https',
      host: 'blog.example.com',
    });
  });

  it('refuses a scheme it has no stages for, and names it', () => {
    const { onSubmit, input } = renderBar();

    fireEvent.change(input, { target: { value: 'ftp://files.example.com' } });
    fireEvent.submit(input);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('status').textContent).toContain('ftp');
  });

  /**
   * The safety message that matters most. Somebody typing a site they know is online has to
   * be told the NXDOMAIN is about this simulation before they see it.
   */
  it('warns while typing that an unknown host will not resolve here', () => {
    const { input } = renderBar();

    fireEvent.change(input, { target: { value: 'https://shop.example-store.test/' } });

    expect(screen.getByText('Unknown to the bundled zones')).toBeInTheDocument();
    expect(screen.getByRole('status').textContent).toContain('NXDOMAIN');
    expect(screen.getByRole('status').textContent).toContain(
      'not about the real Internet',
    );
  });

  it('runs an example chip immediately, without a second click on Load', () => {
    const { onSubmit } = renderBar();

    fireEvent.click(screen.getByRole('button', { name: /shop\.example\.com/ }));

    expect(onSubmit).toHaveBeenCalledWith(
      'https://shop.example.com/',
      expect.objectContaining({ host: 'shop.example.com' }),
    );
  });

  it('follows the committed URL when a scenario changes it underneath', () => {
    const { rerender } = render(
      <UrlBar value="https://www.example.com/" onSubmit={vi.fn()} />,
    );
    expect(screen.getByRole('textbox')).toHaveValue('https://www.example.com/');

    rerender(<UrlBar value="https://shop.example.com/" onSubmit={vi.fn()} />);
    expect(screen.getByRole('textbox')).toHaveValue('https://shop.example.com/');
  });
});
