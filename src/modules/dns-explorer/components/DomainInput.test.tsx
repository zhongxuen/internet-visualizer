import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { coverageFor, DEFAULT_DRAFT, type Lookup, type LookupDraft } from '../lookup';

import { DomainInput } from './DomainInput';

/**
 * The field is controlled by whoever renders it, so the tests have to be too. This is
 * the module's own wiring in miniature: the draft lives outside, and only validated
 * lookups come back out.
 */
function Harness({
  initial,
  onSubmit,
}: {
  initial: LookupDraft;
  onSubmit: (lookup: Lookup) => void;
}) {
  const [draft, setDraft] = useState(initial);

  return <DomainInput draft={draft} onDraftChange={setDraft} onSubmit={onSubmit} />;
}

function setup(initial: LookupDraft = DEFAULT_DRAFT) {
  const submitted: Lookup[] = [];
  render(<Harness initial={initial} onSubmit={(lookup) => submitted.push(lookup)} />);

  return { submitted, user: userEvent.setup() };
}

const field = () => screen.getByLabelText('Domain name');
const resolve = () => screen.getByRole('button', { name: 'Resolve' });

describe('DomainInput', () => {
  /**
   * The security rule from CLAUDE.md, stated on the surface a user is looking at rather
   * than only in the code. Both signals -- the badge and the sentence -- must survive.
   */
  it('says on the field itself that nothing here reaches a network', () => {
    setup();

    expect(screen.getByText('Simulated')).toBeInTheDocument();
    expect(
      screen.getByText(/No name typed here is ever sent to a real nameserver/),
    ).toBeInTheDocument();
  });

  it('submits a validated, canonicalised lookup', async () => {
    const { submitted, user } = setup({ ...DEFAULT_DRAFT, name: '' });

    await user.type(field(), '  WWW.Example.com.  ');
    await user.click(resolve());

    expect(submitted).toEqual([{ ...DEFAULT_DRAFT, name: 'www.example.com' }]);
  });

  it('unwraps a pasted URL rather than rejecting it', async () => {
    const { submitted, user } = setup({ ...DEFAULT_DRAFT, name: '' });

    await user.type(field(), 'https://blog.example.com/posts?a=1');
    await user.click(resolve());

    expect(submitted[0]?.name).toBe('blog.example.com');
  });

  it('shows the reason a name was rejected, and submits nothing', async () => {
    const { submitted, user } = setup({ ...DEFAULT_DRAFT, name: '' });

    await user.type(field(), 'not a host.example.com');
    await user.click(resolve());

    expect(screen.getByRole('alert')).toHaveTextContent(/not a host/);
    expect(field()).toHaveAttribute('aria-invalid', 'true');
    expect(submitted).toEqual([]);
  });

  /** `example.c` is somebody halfway through typing, not a mistake. */
  it('clears the error on the next keystroke', async () => {
    const { user } = setup({ ...DEFAULT_DRAFT, name: 'example..com' });

    await user.click(resolve());
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.type(field(), 'x');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('resolves an example chip in one click', async () => {
    const { submitted, user } = setup();

    await user.click(screen.getByRole('button', { name: /nope\.example\.com/ }));

    expect(submitted[0]).toMatchObject({ name: 'nope.example.com', type: 'A' });
  });

  /** Names delegate right to left, which is the answer and the lesson at once. */
  it('offers the in-addr.arpa form when an address is typed instead of a name', async () => {
    const { submitted, user } = setup({ ...DEFAULT_DRAFT, name: '203.0.113.20' });

    const suggestion = screen.getByRole('button', {
      name: '20.113.0.203.in-addr.arpa PTR',
    });
    await user.click(suggestion);

    expect(submitted[0]).toMatchObject({
      name: '20.113.0.203.in-addr.arpa',
      type: 'PTR',
    });
  });

  it('prints the coverage note for the name currently on the diagram', () => {
    render(
      <DomainInput
        draft={DEFAULT_DRAFT}
        onDraftChange={() => {}}
        onSubmit={vi.fn()}
        coverage={coverageFor('google.com')}
      />,
    );

    expect(screen.getByText('Simulated zone only')).toBeInTheDocument();
    expect(
      screen.getByText(/nothing was asked of a real nameserver/),
    ).toBeInTheDocument();
  });

  it('offers the cache, transport, and DNSSEC knobs the phase doc asks for', () => {
    setup();

    const cache = within(screen.getByRole('group', { name: 'Resolver cache' }));
    expect(cache.getByRole('button', { name: 'Cold' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(cache.getByRole('button', { name: 'Warm' })).toBeInTheDocument();

    expect(screen.getByLabelText('Transport')).toHaveValue('udp');
    expect(screen.getByRole('switch', { name: /Not validating/ })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });
});
