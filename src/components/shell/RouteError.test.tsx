import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { RouteError } from './RouteError';

/**
 * An error page has one job beyond being legible: the recovery it offers has to be the
 * one that works. So the assertions here are about the two things a boundary controls --
 * that `reset` is actually wired to the button, and that whatever the runtime managed to
 * say is on screen rather than replaced by a euphemism.
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

  it('shows the runtime’s own message and digest', () => {
    const error = Object.assign(new Error('Loading chunk 42 failed'), {
      digest: '2381729387',
    });

    render(<RouteError {...boilerplate} error={error} reset={vi.fn()} />);

    expect(screen.getByText('Loading chunk 42 failed')).toBeInTheDocument();
    expect(screen.getByText('2381729387')).toBeInTheDocument();
  });

  /**
   * The production shape of a server-side throw: Next strips the message and leaves the
   * digest. Rendering an empty definition list there would be a labelled box with
   * nothing in it.
   */
  it('renders no detail block when the error carries neither message nor digest', () => {
    render(<RouteError {...boilerplate} error={new Error('')} reset={vi.fn()} />);

    expect(screen.queryByText(/What the runtime said/)).not.toBeInTheDocument();
    expect(screen.queryByText('Digest')).not.toBeInTheDocument();
  });

  it('takes the heading level from the frame it renders inside', () => {
    const { rerender } = render(
      <RouteError {...boilerplate} error={new Error('x')} reset={vi.fn()} />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'It broke' })).toBeVisible();

    rerender(
      <RouteError {...boilerplate} level={2} error={new Error('x')} reset={vi.fn()} />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'It broke' })).toBeVisible();
  });

  it('offers the module explorer as the way out by default', () => {
    const { rerender } = render(
      <RouteError {...boilerplate} error={new Error('x')} reset={vi.fn()} />,
    );
    expect(screen.getByRole('link', { name: /all modules/i })).toHaveAttribute(
      'href',
      '/',
    );

    rerender(
      <RouteError
        {...boilerplate}
        error={new Error('x')}
        reset={vi.fn()}
        escape={{ href: '/learn', label: 'Back to the Learning Center' }}
      />,
    );
    expect(screen.getByRole('link', { name: /Learning Center/ })).toHaveAttribute(
      'href',
      '/learn',
    );
  });
});
