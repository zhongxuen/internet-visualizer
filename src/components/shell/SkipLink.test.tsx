import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { MAIN_CONTENT_ID, SkipLink } from './SkipLink';

describe('SkipLink', () => {
  it('points at the main landmark and is the first thing Tab reaches', async () => {
    const user = userEvent.setup();
    render(
      <>
        <SkipLink />
        <button type="button">Nav item</button>
        <main id={MAIN_CONTENT_ID} tabIndex={-1}>
          <h1>Page</h1>
        </main>
      </>,
    );

    const link = screen.getByRole('link', { name: 'Skip to content' });
    expect(link).toHaveAttribute('href', `#${MAIN_CONTENT_ID}`);

    await user.tab();
    expect(link).toHaveFocus();
  });

  it('is off-screen until focused rather than hidden from the tab order', () => {
    render(<SkipLink />);

    const link = screen.getByRole('link', { name: 'Skip to content' });
    expect(link).toHaveClass('skip-link');
    expect(link).not.toHaveAttribute('aria-hidden');
    expect(link).not.toHaveAttribute('tabindex');
  });
});
