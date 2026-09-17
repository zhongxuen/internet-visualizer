import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { RouteError } from './RouteError';

/**
 * An error page has one job beyond being legible: the recovery it offers has to be the
 * one that works. So the assertions here are about what a boundary controls -- that
 * `reset` is actually wired to the button, that the plain headline and the next step
 * come first, and that whatever the runtime managed to say is still on screen below
 * them rather than replaced by a euphemism or folded away.
 *
 * The heading level is asserted because it is a phase-14 acceptance criterion rather
 * than a style choice: under `(modules)` the layout has already drawn the page's `h1`,
 * and a second one there is a violation the axe pass catches.
 */
const boilerplate = {
  title: 'It broke',
  children: <p>Some explanation.</p>,
};

describe('RouteError', () => {
  it('calls reset when the recovery button is pressed', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();

    render(<RouteError {...boilerplate} error={new Error('nope')} reset={reset} />);

    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it('shows the runtime’s own message and digest, visible, under what the browser reported', () => {
    const error = Object.assign(new Error('Loading chunk 42 failed'), {
      digest: '2381729387',
    });

    render(<RouteError {...boilerplate} error={error} reset={vi.fn()} />);

    const detail = screen.getByRole('heading', { name: 'What the browser reported' });
    expect(detail).toBeVisible();
    expect(screen.getByText('Loading chunk 42 failed')).toBeVisible();
    expect(screen.getByText('2381729387')).toBeVisible();
    // Not behind a disclosure: nothing here is collapsed.
    expect(detail.closest('details')).toBeNull();
    expect(screen.queryByRole('button', { expanded: false })).toBeNull();
  });

  it('puts the headline and the next step before what the browser reported', () => {
    const error = Object.assign(new Error('boom'), { digest: 'd1' });
    render(<RouteError {...boilerplate} error={error} reset={vi.fn()} />);

    const order = [
      screen.getByRole('heading', { name: 'It broke' }),
      screen.getByText('Some explanation.'),
      screen.getByRole('button', { name: /try again/i }),
      screen.getByRole('heading', { name: 'What the browser reported' }),
      screen.getByText('boom'),
    ];
    for (let i = 1; i < order.length; i += 1) {
      expect(
        order[i - 1]!.compareDocumentPosition(order[i]!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  /**
   * The production shape of a server-side throw: Next strips the message and leaves the
   * digest. Rendering an empty definition list there would be a labelled box with
   * nothing in it.
   */
  it('renders no detail block when the error carries neither message nor digest', () => {
    render(<RouteError {...boilerplate} error={new Error('')} reset={vi.fn()} />);

    expect(screen.queryByText(/What the browser reported/)).not.toBeInTheDocument();
    expect(screen.queryByText('Digest')).not.toBeInTheDocument();
  });

  it('takes the heading level from the frame it renders inside, skipping none', () => {
    const { rerender } = render(
      <RouteError {...boilerplate} error={new Error('x')} reset={vi.fn()} />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'It broke' })).toBeVisible();
    expect(
      screen.getByRole('heading', { level: 2, name: 'What the browser reported' }),
    ).toBeVisible();

    rerender(
      <RouteError {...boilerplate} level={2} error={new Error('x')} reset={vi.fn()} />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'It broke' })).toBeVisible();
    expect(
      screen.getByRole('heading', { level: 3, name: 'What the browser reported' }),
    ).toBeVisible();
  });

  it('offers the home page as the way out by default', () => {
    const { rerender } = render(
      <RouteError {...boilerplate} error={new Error('x')} reset={vi.fn()} />,
    );
    expect(screen.getByRole('link', { name: /home page/i })).toHaveAttribute('href', '/');

    rerender(
      <RouteError
        {...boilerplate}
        error={new Error('x')}
        reset={vi.fn()}
        escape={{ href: '/learn', label: 'Back to the lessons' }}
      />,
    );
    expect(screen.getByRole('link', { name: /lessons/ })).toHaveAttribute(
      'href',
      '/learn',
    );
  });
});
