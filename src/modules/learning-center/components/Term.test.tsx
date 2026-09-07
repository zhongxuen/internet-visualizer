import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { lookupTerm } from '../content/glossary';

import { Term } from './Term';

describe('Term', () => {
  /**
   * The phase 02 rule applied to prose: a definition reachable only by hovering
   * exactly the right word with a mouse is a definition most readers do not have.
   */
  it('is reachable by keyboard, and describes itself while open', async () => {
    const user = userEvent.setup();
    render(
      <p>
        Each step is a <Term>hop</Term>.
      </p>,
    );

    const trigger = screen.getByRole('button', { name: 'hop' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    await user.tab();
    expect(trigger).toHaveFocus();

    const popover = await screen.findByRole('tooltip');
    expect(popover).toHaveTextContent(lookupTerm('hop')!.short);
    expect(trigger).toHaveAttribute('aria-describedby', popover.id);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('opens on hover too', async () => {
    const user = userEvent.setup();
    render(<Term>router</Term>);

    await user.hover(screen.getByRole('button', { name: 'router' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      lookupTerm('router')!.short,
    );
  });

  /** So a lesson can write the word the sentence needs rather than the entry's spelling. */
  it('resolves plurals and other aliases, and an explicit id', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Term>packets</Term>
        <Term id="ip-address">that number</Term>
      </>,
    );

    await user.hover(screen.getByRole('button', { name: 'packets' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      lookupTerm('packet')!.short,
    );

    await user.hover(screen.getByRole('button', { name: 'that number' }));
    expect(await screen.findByText(lookupTerm('ip-address')!.short)).toBeInTheDocument();
  });

  /**
   * A missing definition is a content bug for `content.test.ts` to catch, not a reason
   * for a paragraph to sprout a button that explains nothing.
   */
  it('degrades to plain text when there is no entry', () => {
    render(
      <p>
        A <Term>flurb</Term> is not a thing.
      </p>,
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/A flurb is not a thing/)).toBeInTheDocument();
  });
});
