import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiVisualizerModule } from './ApiVisualizerModule';

/**
 * The composition root, tested for the wiring rather than for the protocol -- the REST
 * router, the credential checks, the token bucket, the paginators, the GraphQL executor and
 * the webhook signer each have their own tests, and this file is about whether picking a
 * scenario puts the right panel on screen with the right numbers in it.
 *
 * Two assertions are not about wiring and must never be relaxed.
 *
 * **No input to this module can cause a network request.** `fetch` is stubbed with a spy that
 * fails the test if anything calls it, and it stays stubbed while every scenario is visited
 * and while the console is used.
 *
 * **The JWT view states that the payload is encoded and not encrypted.** The sentence lives in
 * `sim/auth.ts` as `JWT_PAYLOAD_NOT_ENCRYPTED` precisely so it cannot be quietly edited out of
 * one surface, and the assertion below is what stops it being edited out of this one.
 */

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn(() => {
    throw new Error('the API Visualizer must never make a network request');
  });
  vi.stubGlobal('fetch', fetchSpy);
});

const scenario = (title: string) =>
  screen.getByRole('button', { name: (name: string) => name.includes(title) });

const requests = () => screen.getByRole('region', { name: /^Requests/ });

describe('the module', () => {
  it('opens on the REST run, with the ledger, the shape view, the explorer and the console', () => {
    render(<ApiVisualizerModule />);

    expect(scenario('REST, verb by verb')).toHaveAttribute('aria-pressed', 'true');

    for (const name of [
      /^Requests/,
      'What came back, key by key',
      'Endpoints',
      'Console',
    ] as (string | RegExp)[]) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rebuilds the run when another scenario is picked', async () => {
    const user = userEvent.setup();
    render(<ApiVisualizerModule />);

    expect(within(requests()).getByText('/reports')).toBeInTheDocument();

    await user.click(scenario('Pagination'));

    expect(scenario('Pagination')).toHaveAttribute('aria-pressed', 'true');
    expect(within(requests()).queryByText('/reports')).not.toBeInTheDocument();
    expect(within(requests()).getAllByText(/offset=/).length).toBeGreaterThan(0);
  });

  it('shows the token bucket only on the rate-limiting run', async () => {
    const user = userEvent.setup();
    render(<ApiVisualizerModule />);

    expect(
      screen.queryByRole('region', { name: 'Token bucket' }),
    ).not.toBeInTheDocument();

    await user.click(scenario('Rate limiting'));
    const meter = within(screen.getByRole('region', { name: 'Token bucket' })).getByRole(
      'meter',
    );
    expect(meter).toHaveAttribute('aria-valuemax', '5');
  });

  it('draws the four OAuth parties and the PKCE challenge', async () => {
    const user = userEvent.setup();
    render(<ApiVisualizerModule />);

    await user.click(scenario('OAuth 2.0'));
    const ladder = screen.getByRole('region', { name: 'Authorization code + PKCE' });

    for (const actor of [
      'User',
      'Client app',
      'Authorization server',
      'Resource server',
    ]) {
      expect(within(ladder).getByText(actor)).toBeInTheDocument();
    }
    // Eleven rungs, in order, and the challenge derived from the RFC 7636 vector.
    expect(within(ladder).getAllByRole('button')).toHaveLength(11);
    expect(within(ladder).getByText(/^verifier /)).toBeInTheDocument();
    expect(within(ladder).getByText(/^challenge /)).toBeInTheDocument();
  });

  /**
   * The acceptance criterion from the phase document, asserted at the surface a learner
   * actually reads rather than at the constant.
   */
  it('states that a JWT payload is encoded and not encrypted', async () => {
    const user = userEvent.setup();
    render(<ApiVisualizerModule />);

    await user.click(scenario('API keys and bearer tokens'));
    const credentials = screen.getByRole('region', { name: 'Credentials' });

    // The first request presents no credential at all, so pick the one that presents a token
    // the verifier accepts -- the case where reading the claims is most obviously not a trick.
    await user.click(
      within(credentials).getByRole('button', { name: /Bearer token, read/ }),
    );

    expect(
      within(credentials).getByText(/^The payload is encoded, not encrypted\./),
    ).toBeInTheDocument();
    expect(
      within(credentials).getByText(/Base64url is a transport encoding with no key/),
    ).toBeInTheDocument();
    // And the claims really are on screen, read without a secret -- which is what makes the
    // sentence above a demonstration rather than a warning.
    expect(within(credentials).getByText('ada@example.com')).toBeInTheDocument();
  });

  it('shows both bills on the GraphQL run, including what GraphQL gives up', async () => {
    const user = userEvent.setup();
    render(<ApiVisualizerModule />);

    await user.click(scenario('REST against GraphQL'));
    const bill = screen.getByRole('region', { name: 'Both bills' });

    expect(within(bill).getByText('HTTP caching')).toBeInTheDocument();
    expect(within(bill).getByText('The N+1 problem')).toBeInTheDocument();
    expect(within(bill).getByText(/cacheable by URL/)).toBeInTheDocument();

    // 5 data-source calls unbatched, 3 with per-field batching, on the row that says so.
    const resolvers = within(bill)
      .getByText('Data-source calls on the server')
      .closest('tr');
    expect(resolvers).not.toBeNull();
    expect(within(resolvers as HTMLElement).getByText('5')).toBeInTheDocument();
    expect(within(resolvers as HTMLElement).getByText('3')).toBeInTheDocument();
  });

  it('shows the offset run repeating a row and the cursor run not', async () => {
    const user = userEvent.setup();
    render(<ApiVisualizerModule />);

    await user.click(scenario('Pagination'));
    const verdict = screen.getByRole('region', {
      name: 'What each client ended up with',
    });

    expect(within(verdict).getByText('wrong')).toBeInTheDocument();
    expect(
      within(verdict).getByText('every stable row exactly once'),
    ).toBeInTheDocument();
  });

  it('marks a webhook delivery that got no reply as no reply, not as a status', async () => {
    const user = userEvent.setup();
    render(<ApiVisualizerModule />);

    await user.click(scenario('Webhooks'));
    expect(within(requests()).getByText('no reply')).toBeInTheDocument();
  });

  it('fills the console in when a verb chip is activated in the explorer', async () => {
    const user = userEvent.setup();
    render(<ApiVisualizerModule />);

    const explorer = screen.getByRole('region', { name: 'Endpoints' });
    const chip = within(explorer).getByRole('button', {
      name: /DELETE \/articles\/1\. Not safe, idempotent/,
    });
    await user.click(chip);

    expect(screen.getByLabelText('Request-target')).toHaveValue('/articles/1');
    expect(screen.getByLabelText('Method')).toHaveValue('DELETE');
  });

  it('never calls fetch, on any scenario', async () => {
    const user = userEvent.setup();
    render(<ApiVisualizerModule />);

    for (const title of [
      'API keys and bearer tokens',
      'OAuth 2.0',
      'Rate limiting',
      'Pagination',
      'REST against GraphQL',
      'Webhooks',
    ]) {
      await user.click(scenario(title));
    }

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
