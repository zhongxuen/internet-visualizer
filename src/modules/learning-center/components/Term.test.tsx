import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it } from 'vitest';

import { glossaryHref, preloadInlineGlossary } from '@/components/glossary';
import { INLINE_SPELLINGS } from '@/core/glossary/inline';
import { lookupTerm } from '@/core/glossary/lookup';

import { Glossary } from './Glossary';
import { Term } from './Term';

/**
 * `<Term>` is a thin wrapper over `GlossaryTerm`, whose own tests cover keyboard, tap,
 * the link and the fallback. These pin what a lesson relies on: the word as written, an
 * explicit `id`, and plain text for a word with no entry.
 */
describe('Term', () => {
  // The index loads on demand. Load it once up front, so these tests are about behaviour
  // rather than about how fast a chunk arrives in a busy worker pool.
  beforeAll(() => preloadInlineGlossary());

  /**
   * The phase 02 rule applied to prose: a definition reachable only by hovering
   * exactly the right word with a mouse is a definition most readers do not have.
   */
  it('is reachable by keyboard, and opens the definition with a link to the glossary', async () => {
    const user = userEvent.setup();
    render(
      <p>
        Each step is a <Term>hop</Term>.
      </p>,
    );

    const trigger = await screen.findByRole('button', { name: 'hop' });
    await user.tab();
    expect(trigger).toHaveFocus();

    await user.keyboard('{Enter}');
    const popover = screen.getByRole('dialog', { name: 'hop' });
    expect(popover).toHaveTextContent(lookupTerm('hop')!.short);
    expect(
      screen.getByRole('link', { name: 'Read more in the glossary' }),
    ).toHaveAttribute('href', '/learn/glossary#hop');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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

    await user.click(await screen.findByRole('button', { name: 'packets' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(lookupTerm('packet')!.short);

    await user.click(screen.getByRole('button', { name: 'that number' }));
    expect(screen.getByRole('dialog', { name: 'that number' })).toHaveTextContent(
      lookupTerm('ip-address')!.short,
    );
  });

  /**
   * A missing definition is a content bug for `content.test.ts` to catch, not a reason
   * for a paragraph to sprout a button that explains nothing.
   */
  it('degrades to plain text when there is no entry', async () => {
    render(
      <p>
        A <Term>flurb</Term> is not a thing; a <Term>hop</Term> is.
      </p>,
    );

    await screen.findByRole('button', { name: 'hop' });
    expect(screen.queryByRole('button', { name: 'flurb' })).not.toBeInTheDocument();
    expect(screen.getByText(/A flurb is not a thing/)).toBeInTheDocument();
  });

  /** Every popover's "Read more" link lands on an entry that exists on `/learn/glossary`. */
  it('links only to anchors the glossary page renders', () => {
    const { container } = render(<Glossary />);
    const targets = new Set(INLINE_SPELLINGS.map(({ entry }) => glossaryHref(entry)));

    for (const href of targets) {
      const id = href.slice('/learn/glossary#'.length);
      expect(container.querySelector(`li[id="${id}"]`), href).not.toBeNull();
    }
  });
});
