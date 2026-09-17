import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { inlineTerm } from '@/core/glossary/inline';

import { matchTerms } from './matchTerms';
import { TermText } from './TermText';
import { preloadInlineGlossary } from './useInlineGlossary';

// Pass-through, so a test can count how often a string is matched.
vi.mock('./matchTerms', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./matchTerms')>();
  return { ...actual, matchTerms: vi.fn(actual.matchTerms) };
});

describe('TermText', () => {
  it('links the first occurrence of each glossary word and keeps every character', async () => {
    const text = 'A router forwards each packet one hop closer; every packet does.';
    const { container } = render(
      <p>
        <TermText text={text} />
      </p>,
    );

    expect(await screen.findByRole('button', { name: 'router' })).toBeInTheDocument();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'router',
      'packet',
      'hop',
    ]);
    expect(container.querySelector('p')).toHaveTextContent(text);
  });

  it('opens the same popover as a GlossaryTerm', async () => {
    const user = userEvent.setup();
    render(<TermText text="Every DNS answer has a TTL." />);

    await user.click(await screen.findByRole('button', { name: 'TTL' }));
    expect(screen.getByRole('dialog', { name: 'TTL' })).toHaveTextContent(
      inlineTerm('ttl')!.short,
    );
  });

  it('honours `max` and `skip`', async () => {
    render(
      <>
        <p data-testid="max">
          <TermText text="A router forwards each packet one hop closer." max={1} />
        </p>
        <p data-testid="skip">
          <TermText
            text="A router forwards each packet one hop closer."
            skip={['router']}
          />
        </p>
      </>,
    );

    await screen.findAllByRole('button');
    expect(
      [...screen.getByTestId('max').querySelectorAll('button')].map((b) => b.textContent),
    ).toEqual(['router']);
    expect(
      [...screen.getByTestId('skip').querySelectorAll('button')].map(
        (b) => b.textContent,
      ),
    ).toEqual(['packet', 'hop']);
  });

  it('renders a string with no glossary words in it as it is', async () => {
    await preloadInlineGlossary();
    render(<TermText text="Nothing here is a term." />);
    expect(screen.getByText('Nothing here is a term.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('matches a string once, not on every render', async () => {
    await preloadInlineGlossary();
    vi.mocked(matchTerms).mockClear();

    // A new `skip` array each render, as an inline prop would be.
    const { rerender } = render(<TermText text="DNS and a TTL" skip={['dns']} />);
    rerender(<TermText text="DNS and a TTL" skip={['dns']} />);
    rerender(<TermText text="DNS and a TTL" skip={['dns']} />);
    expect(matchTerms).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'TTL' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'DNS' })).not.toBeInTheDocument();

    rerender(<TermText text="A TTL and DNS" skip={['dns']} />);
    expect(matchTerms).toHaveBeenCalledTimes(2);
  });
});
