import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DnsExplorerModule } from './DnsExplorerModule';

/**
 * The composition root, tested for the wiring rather than for the protocol -- the
 * resolver, the ladder, and the validator each have their own tests, and this file is
 * about whether picking a scenario, typing a name, and clicking a rung do what they say.
 *
 * One assertion here is not about wiring at all, and is the one that must never be
 * relaxed: **no input to this module can cause a network request.** `fetch` is stubbed
 * with a spy that fails the test if anything calls it.
 */

const field = () => screen.getByLabelText('Domain name');
const resolve = () => screen.getByRole('button', { name: 'Resolve' });

/** Every arrow on the ladder is a "Seek to ..." button. */
const rungs = () => screen.getAllByRole('button', { name: /^Seek to / });

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn(() => {
    throw new Error('the DNS Explorer must never make a network request');
  });
  vi.stubGlobal('fetch', fetchSpy);
});

describe('DnsExplorerModule', () => {
  it('opens on the cold-cache walk, with the ladder and the cache panel beside it', () => {
    render(<DnsExplorerModule />);

    expect(screen.getByRole('button', { name: /Cold cache/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('region', { name: 'Resolution ladder' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Resolver cache' })).toBeInTheDocument();
    expect(rungs().length).toBeGreaterThan(0);
  });

  /**
   * The caching lesson is the contrast between two runs of the same question, so
   * switching between them has to actually rebuild the diagram.
   */
  it('rebuilds the run when another scenario is picked', async () => {
    const user = userEvent.setup();
    render(<DnsExplorerModule />);

    const coldRungs = rungs().length;
    await user.click(screen.getByRole('button', { name: /Warm cache/ }));

    expect(screen.getByRole('button', { name: /Warm cache/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getAllByText('From cache').length).toBeGreaterThan(0);
    expect(rungs().length).not.toBe(coldRungs);
  });

  it('runs a name typed into the field, and deselects the authored scenarios', async () => {
    const user = userEvent.setup();
    render(<DnsExplorerModule />);

    await user.clear(field());
    await user.type(field(), 'example.org');
    await user.click(resolve());

    expect(screen.getByRole('button', { name: /Cold cache/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    // The run now describes itself as the typed lookup rather than as an authored one.
    expect(
      screen.getByText(
        /^A records for example\.org\., resolved against the bundled zones/,
      ),
    ).toBeInTheDocument();
  });

  /**
   * The rule the module is built around, asserted on the surface: a name the fixtures
   * have never heard of is answered by the simulated hierarchy, said to be answered by
   * the simulated hierarchy, and never looked up for real.
   */
  it('resolves an unknown name against the bundled zones and says so', async () => {
    const user = userEvent.setup();
    render(<DnsExplorerModule />);

    await user.clear(field());
    await user.type(field(), 'google.com');
    await user.click(resolve());

    expect(screen.getByText('Simulated zone only')).toBeInTheDocument();
    expect(
      screen.getByText(/nothing was asked of a real nameserver/),
    ).toBeInTheDocument();
    expect(screen.getAllByText('NXDOMAIN — no such name').length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never calls fetch, whatever is typed into it', async () => {
    const user = userEvent.setup();
    render(<DnsExplorerModule />);

    for (const name of ['example.com', 'anthropic.com', 'https://news.ycombinator.com']) {
      await user.clear(field());
      await user.type(field(), name);
      await user.click(resolve());
    }

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('shows the message behind a rung when the rung is clicked', async () => {
    const user = userEvent.setup();
    render(<DnsExplorerModule />);

    await user.click(rungs()[1]);

    const table = screen.getByRole('region', { name: /^(Query|Reply):/ });
    expect(within(table).getByText('Answer')).toBeInTheDocument();
    expect(within(table).getByText('Authority')).toBeInTheDocument();
    expect(within(table).getByText('Additional')).toBeInTheDocument();
  });

  it('drops the pinned rung when the run underneath it changes', async () => {
    const user = userEvent.setup();
    render(<DnsExplorerModule />);

    await user.click(rungs()[1]);
    expect(
      rungs().filter((rung) => rung.getAttribute('aria-pressed') === 'true'),
    ).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /CNAME chain/ }));

    expect(
      rungs().filter((rung) => rung.getAttribute('aria-pressed') === 'true'),
    ).toHaveLength(0);
  });
});
