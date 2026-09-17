import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { inlineTerm } from '@/core/glossary/inline';

import { GlossaryTerm } from './GlossaryTerm';

const hop = inlineTerm('hop')!;

describe('GlossaryTerm', () => {
  /** Hover is not a way in: the definition has to be reachable with no mouse at all. */
  it('opens from the keyboard, lets Tab reach the link, and gives focus back on Escape', async () => {
    const user = userEvent.setup();
    render(
      <p>
        Each step is a <GlossaryTerm>hop</GlossaryTerm>.
      </p>,
    );

    const trigger = await screen.findByRole('button', { name: 'hop' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.tab();
    expect(trigger).toHaveFocus();
    await user.keyboard('{Enter}');

    const panel = screen.getByRole('dialog', { name: 'hop' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(panel).toHaveTextContent(hop.term);
    expect(panel).toHaveTextContent(hop.short);
    expect(panel).toHaveFocus();

    await user.tab();
    expect(
      within(panel).getByRole('link', { name: 'Read more in the glossary' }),
    ).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('opens with Space too', async () => {
    const user = userEvent.setup();
    render(<GlossaryTerm>hop</GlossaryTerm>);

    (await screen.findByRole('button', { name: 'hop' })).focus();
    await user.keyboard(' ');
    expect(screen.getByRole('dialog', { name: 'hop' })).toHaveTextContent(hop.short);
  });

  it('opens on a tap, and a second tap on the word closes it', async () => {
    const user = userEvent.setup();
    render(<GlossaryTerm>hop</GlossaryTerm>);
    const trigger = await screen.findByRole('button', { name: 'hop' });

    await user.pointer({ keys: '[TouchA]', target: trigger });
    expect(screen.getByRole('dialog', { name: 'hop' })).toHaveTextContent(hop.short);

    await user.pointer({ keys: '[TouchA]', target: trigger });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not open on hover, since the pointer could never reach the link', async () => {
    const user = userEvent.setup();
    render(<GlossaryTerm>hop</GlossaryTerm>);

    await user.hover(await screen.findByRole('button', { name: 'hop' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('links to the entry on the glossary page, whose anchor is the entry id', async () => {
    const user = userEvent.setup();
    render(<GlossaryTerm>packets</GlossaryTerm>);

    await user.click(await screen.findByRole('button', { name: 'packets' }));
    const link = screen.getByRole('link', { name: 'Read more in the glossary' });
    expect(link).toHaveAttribute('href', '/learn/glossary#packet');
  });

  it('resolves an alias as written, and an explicit term when the words are not one', async () => {
    const user = userEvent.setup();
    render(
      <>
        <GlossaryTerm>Resolvers</GlossaryTerm>
        <GlossaryTerm term="ip-address">that number</GlossaryTerm>
      </>,
    );

    await user.click(await screen.findByRole('button', { name: 'Resolvers' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(inlineTerm('resolver')!.short);

    await user.click(screen.getByRole('button', { name: 'that number' }));
    expect(screen.getByRole('dialog', { name: 'that number' })).toHaveTextContent(
      inlineTerm('ip-address')!.short,
    );
  });

  it('renders an unknown term as plain text', async () => {
    render(
      <p>
        A <GlossaryTerm>flurb</GlossaryTerm> is not a thing, but a{' '}
        <GlossaryTerm>hop</GlossaryTerm> is.
      </p>,
    );

    // Wait for the index, so "no button" is a lookup result rather than a loading state.
    await screen.findByRole('button', { name: 'hop' });
    expect(screen.queryByRole('button', { name: 'flurb' })).not.toBeInTheDocument();
    expect(screen.getByText(/A flurb is not a thing/)).toBeInTheDocument();
  });
});
