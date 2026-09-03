import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HttpExplorerModule } from './HttpExplorerModule';

/**
 * The composition root, tested for the wiring rather than for the protocol -- the message
 * model, the caches, the cookie jar, and the validator each have their own tests, and this
 * file is about whether picking a scenario, sending a request, and clicking a status code
 * do what they say.
 *
 * One assertion here is not about wiring at all, and is the one that must never be
 * relaxed: **no input to this module can cause a network request.** `fetch` is stubbed
 * with a spy that fails the test if anything calls it.
 */

const target = () => screen.getByLabelText('Request target');
const send = () => screen.getByRole('button', { name: 'Send' });
/**
 * A scenario chip, by its scenario title.
 *
 * A substring of the whole title rather than a loose regex: the chip's accessible name
 * carries its position as well ("3 Redirect chain"), and a pattern like /redirect/i would
 * also match the "Follow redirects" toggle and start asserting about whichever came first.
 */
const scenario = (title: string) =>
  screen.getByRole('button', { name: (name: string) => name.includes(title) });

/** Every entry in the exchange ledger. */
const ledger = () =>
  screen
    .getAllByRole('group', { name: 'Exchanges in this run' })[0]
    .querySelectorAll('button');

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn(() => {
    throw new Error('the HTTP Explorer must never make a network request');
  });
  vi.stubGlobal('fetch', fetchSpy);
});

describe('the module', () => {
  it('opens on the simple GET, with the wire view and both panels beside it', () => {
    render(<HttpExplorerModule />);

    expect(scenario('A simple GET')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region', { name: 'On the wire' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Caches' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Cookie jar' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Status codes' })).toBeInTheDocument();
  });

  it('rebuilds the run when another scenario is picked', async () => {
    const user = userEvent.setup();
    render(<HttpExplorerModule />);

    const before = ledger().length;
    await user.click(scenario('Redirect chain'));

    expect(ledger().length).not.toBe(before);
  });

  it('shows the version comparison only for the run that has one', async () => {
    const user = userEvent.setup();
    render(<HttpExplorerModule />);

    expect(
      screen.queryByRole('region', { name: /The same page load, three ways/ }),
    ).not.toBeInTheDocument();

    await user.click(scenario('h1 vs h2 vs h3'));

    expect(
      screen.getByRole('region', { name: /The same page load, three ways/ }),
    ).toBeInTheDocument();
  });
});

describe('the wire view and the explainer are wired together', () => {
  it('explains a field when its line is picked', async () => {
    const user = userEvent.setup();
    render(<HttpExplorerModule />);

    const host = [...screen.getAllByRole('button')].find(
      (button) => button.textContent === 'Host: example.com',
    );
    expect(host).toBeDefined();
    await user.click(host!);

    expect(screen.getByRole('region', { name: 'Host' })).toBeInTheDocument();
    expect(
      screen.getByText(
        /the entire reason one IP address can serve more than one website/,
      ),
    ).toBeInTheDocument();
  });

  it('cites a current RFC rather than the obsolete series', async () => {
    const user = userEvent.setup();
    render(<HttpExplorerModule />);

    const etag = [...screen.getAllByRole('button')].find((button) =>
      button.textContent?.startsWith('ETag:'),
    );
    await user.click(etag!);

    expect(screen.getByText('RFC 9110 §8.8.3')).toBeInTheDocument();
  });
});

describe('the builder', () => {
  it('runs a request typed into the form', async () => {
    const user = userEvent.setup();
    render(<HttpExplorerModule />);

    await user.clear(target());
    await user.type(target(), '/teapot');
    await user.click(send());

    // The scenario buttons all release: this is the builder's run now.
    expect(scenario('A simple GET')).toHaveAttribute('aria-pressed', 'false');
    expect([...ledger()].some((button) => button.textContent?.includes('418'))).toBe(
      true,
    );
  });

  it('404s a path the fixtures do not serve, rather than reaching for a real one', async () => {
    const user = userEvent.setup();
    render(<HttpExplorerModule />);

    await user.clear(target());
    await user.type(target(), '/definitely-not-here');
    await user.click(send());

    expect([...ledger()].some((button) => button.textContent?.includes('404'))).toBe(
      true,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('the status map', () => {
  it('loads a run that produces a code that is clicked', async () => {
    const user = userEvent.setup();
    render(<HttpExplorerModule />);

    const map = screen.getByRole('region', { name: 'Status codes' });
    const cell = [...map.querySelectorAll('button')].find((button) =>
      button.textContent?.startsWith('500'),
    );
    expect(cell).toBeDefined();
    await user.click(cell!);

    expect([...ledger()].some((button) => button.textContent?.includes('500'))).toBe(
      true,
    );
  });

  it('leaves codes this module cannot produce unclickable', () => {
    render(<HttpExplorerModule />);

    const map = screen.getByRole('region', { name: 'Status codes' });
    const codes = [...map.querySelectorAll('button')].map((button) =>
      button.textContent?.slice(0, 3),
    );

    // 402 Payment Required is in the registry and in no run here.
    expect(codes).not.toContain('402');
  });
});

describe('safety', () => {
  /**
   * The rule from CLAUDE.md, asserted against the surface rather than only the code: no
   * sequence of inputs a user can perform reaches a network.
   */
  it('never makes a network request, whatever is clicked or typed', async () => {
    const user = userEvent.setup();
    render(<HttpExplorerModule />);

    await user.click(scenario('Cookies and sessions'));
    await user.clear(target());
    await user.type(target(), 'https://example.com/admin');
    await user.click(send());
    await user.clear(target());
    await user.type(target(), '/api/items');
    await user.click(send());

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
