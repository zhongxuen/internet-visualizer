import { act, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { GlossaryTerm } from './GlossaryTerm';
import { TermText } from './TermText';
import { preloadInlineGlossary } from './useInlineGlossary';

/**
 * What a page shows before the glossary index arrives. Its own file, because the index is a
 * module-level value: once any test in a file has loaded it, nothing in that file can see
 * the state before.
 */
describe('before the glossary index has loaded', () => {
  it('renders words as plain text on the server, where the index never loads', () => {
    const html = renderToString(
      <p>
        A <GlossaryTerm>hop</GlossaryTerm>, and <TermText text="a router" />.
      </p>,
    );
    expect(html).not.toContain('<button');
    expect(html).toContain('hop');
    expect(html).toContain('a router');
  });

  it('renders plain text first, then a button once the index arrives, with no second request', async () => {
    render(
      <p>
        Each step is a <GlossaryTerm>hop</GlossaryTerm>.
      </p>,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/Each step is a hop/)).toBeInTheDocument();

    const first = preloadInlineGlossary();
    expect(preloadInlineGlossary()).toBe(first);
    await act(() => first);

    expect(screen.getByRole('button', { name: 'hop' })).toBeInTheDocument();

    // Mounted after the index is in: a button on its first render.
    render(<GlossaryTerm>router</GlossaryTerm>);
    expect(screen.getByRole('button', { name: 'router' })).toBeInTheDocument();
  });
});
