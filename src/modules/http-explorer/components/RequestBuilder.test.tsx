import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_REQUEST_DRAFT, type BuiltRequest, type RequestDraft } from '../builder';

import { RequestBuilder } from './RequestBuilder';

/**
 * The form is controlled by whoever renders it, so the tests have to be too. This is the
 * module's own wiring in miniature: the draft lives outside, and only validated requests
 * come back out.
 */
function Harness({
  initial,
  onSubmit,
}: {
  initial: RequestDraft;
  onSubmit: (request: BuiltRequest) => void;
}) {
  const [draft, setDraft] = useState(initial);
  return <RequestBuilder draft={draft} onDraftChange={setDraft} onSubmit={onSubmit} />;
}

function setup(initial: RequestDraft = DEFAULT_REQUEST_DRAFT) {
  const submitted: BuiltRequest[] = [];
  render(<Harness initial={initial} onSubmit={(request) => submitted.push(request)} />);
  return { submitted, user: userEvent.setup() };
}

const target = () => screen.getByLabelText('Request target');
const send = () => screen.getByRole('button', { name: 'Send' });

describe('the safety statement', () => {
  /**
   * The security rule from CLAUDE.md, stated on the surface a user is looking at rather
   * than only in the code. Both signals -- the badge and the sentence -- must survive.
   */
  it('says on the form itself that nothing here reaches a network', () => {
    setup();

    expect(screen.getByText('Simulated')).toBeInTheDocument();
    expect(
      screen.getByText(/Nothing typed here is\s+ever sent to a real server/),
    ).toBeInTheDocument();
  });

  it('offers no host field at all, which is why it cannot address one', () => {
    setup();

    expect(screen.queryByLabelText(/host/i)).not.toBeInTheDocument();
    expect(screen.getByText('sandbox.example')).toBeInTheDocument();
  });
});

describe('validation', () => {
  it('stays quiet while you type and only complains on Send', async () => {
    const { user } = setup();

    await user.clear(target());
    await user.type(target(), 'index.html');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await user.click(send());
    expect(screen.getByRole('alert')).toHaveTextContent(/origin-form starts with "\/"/);
  });

  it('clears the error on the next edit', async () => {
    const { user } = setup();

    await user.clear(target());
    await user.click(send());
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.type(target(), '/index.html');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('refuses an absolute URL rather than reaching for the host inside it', async () => {
    const { submitted, user } = setup();

    await user.clear(target());
    await user.type(target(), 'https://example.com/');
    await user.click(send());

    expect(screen.getByRole('alert')).toHaveTextContent(/Paths only/);
    expect(submitted).toHaveLength(0);
  });

  it('refuses a header value carrying a control character', async () => {
    const { submitted, user } = setup({
      ...DEFAULT_REQUEST_DRAFT,
      headers: `X-A: 1${String.fromCharCode(13)}X-B: 2`,
    });

    await user.click(send());

    expect(screen.getByRole('alert')).toHaveTextContent(/injection/);
    expect(submitted).toHaveLength(0);
  });

  it('hands the parent a validated request, headers already parsed', async () => {
    const { submitted, user } = setup({
      ...DEFAULT_REQUEST_DRAFT,
      headers: 'X-Request-Id: 7f1a\n# a note\n',
    });

    await user.click(send());

    expect(submitted).toHaveLength(1);
    expect(submitted[0].target).toBe('/index.html');
    expect(submitted[0].headers).toEqual([{ name: 'X-Request-Id', value: '7f1a' }]);
  });
});

describe('the method changes what the form says', () => {
  it('reports whether the method is safe and idempotent', async () => {
    const { user } = setup();

    expect(screen.getByText('Safe · idempotent')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Method'), 'POST');
    expect(screen.getByText('Not safe · not idempotent')).toBeInTheDocument();
  });

  it('disables the body for a method that must not carry content', async () => {
    const { user } = setup();

    await user.selectOptions(screen.getByLabelText('Method'), 'TRACE');

    expect(screen.getByLabelText('Body')).toBeDisabled();
    expect(screen.getByText(/TRACE must not carry content/)).toBeInTheDocument();
  });
});

describe('coverage', () => {
  it('says plainly that an unknown path is a fact about the fixtures', async () => {
    const { user } = setup();

    await user.clear(target());
    await user.type(target(), '/nowhere');

    expect(screen.getByText(/comes back 404 Not Found/)).toBeInTheDocument();
    expect(screen.getByText(/no request left this tab/)).toBeInTheDocument();
  });

  it('names what would have worked when the method is not allowed', async () => {
    const { user } = setup();

    await user.clear(target());
    await user.type(target(), '/login');

    expect(screen.getByText(/405 Method Not Allowed/)).toBeInTheDocument();
  });

  it('fills the form from a route chip, method included', async () => {
    const { user } = setup();

    await user.click(screen.getByRole('button', { name: '/login' }));

    expect(target()).toHaveValue('/login');
    expect(screen.getByLabelText('Method')).toHaveValue('POST');
  });
});

describe('safety', () => {
  it('makes no network request, whatever is typed or clicked', async () => {
    const spy = vi.fn(() => {
      throw new Error('the request builder must never make a network request');
    });
    vi.stubGlobal('fetch', spy);

    const { user } = setup();
    await user.clear(target());
    await user.type(target(), 'https://example.com/admin');
    await user.click(send());
    await user.clear(target());
    await user.type(target(), '/index.html');
    await user.click(send());

    expect(spy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
