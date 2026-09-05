import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiConsole } from './ApiConsole';

/**
 * The console, tested for the two things it must never get wrong.
 *
 * **It must never reach a network.** `fetch` is stubbed with a spy that fails the test if
 * anything calls it, and the spy stays in place across every interaction below including the
 * one that types an absolute URL into the target field.
 *
 * **It must not substitute its own opinion for the API's.** Three of the interesting answers
 * -- `400` for a missing body, `415` for the wrong media type, `404` for an unrouted path --
 * are only reachable if the console sends requests it could plausibly have talked the user
 * out of. The tests below send all three.
 */

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn(() => {
    throw new Error('the API Visualizer must never make a network request');
  });
  vi.stubGlobal('fetch', fetchSpy);
});

const target = () => screen.getByLabelText('Request-target');
const send = () => screen.getByRole('button', { name: 'Send' });

describe('the console', () => {
  it('opens on a GET it can answer, and sends nothing until asked', async () => {
    render(<ApiConsole />);

    expect(target()).toHaveValue('/articles');
    expect(screen.queryByText(/What came back/)).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('answers a GET from the bundled store', async () => {
    const user = userEvent.setup();
    render(<ApiConsole />);

    await user.click(send());

    expect(await screen.findByText('200 OK')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses an absolute URL rather than trying to fetch it', async () => {
    const user = userEvent.setup();
    render(<ApiConsole />);

    await user.clear(target());
    await user.type(target(), 'https://api.stripe.com/v1/charges');
    await user.click(send());

    expect(await screen.findByRole('alert')).toHaveTextContent(/Paths only/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends a POST with no body, so the 400 is seen rather than prevented', async () => {
    const user = userEvent.setup();
    render(<ApiConsole />);

    await user.selectOptions(screen.getByLabelText('Method'), 'POST');
    await user.click(send());

    expect(await screen.findByText(/^400 Bad Request$/)).toBeInTheDocument();
  });

  it('answers 404 for an unrouted path, and says so is a fact about the fixtures', async () => {
    const user = userEvent.setup();
    render(<ApiConsole />);

    await user.clear(target());
    await user.type(target(), '/invoices');

    expect(screen.getByText(/Nothing is routed at \/invoices/)).toBeInTheDocument();

    await user.click(send());
    expect(await screen.findByText(/^404 Not Found$/)).toBeInTheDocument();
  });

  it('keeps the store between requests, so two POSTs make two resources', async () => {
    const user = userEvent.setup();
    render(<ApiConsole />);

    await user.selectOptions(screen.getByLabelText('Method'), 'POST');
    await user.type(screen.getByLabelText('Body'), '{{"title":"a","body":"b"}');

    await user.click(send());
    expect(await screen.findByText(/^201 Created$/)).toBeInTheDocument();
    expect(screen.getByText(/changed: 3/)).toBeInTheDocument();

    await user.click(send());
    expect(await screen.findByText(/changed: 4/)).toBeInTheDocument();
  });

  it('puts the store back when reset', async () => {
    const user = userEvent.setup();
    render(<ApiConsole />);

    await user.selectOptions(screen.getByLabelText('Method'), 'POST');
    await user.type(screen.getByLabelText('Body'), '{{"title":"a","body":"b"}');
    await user.click(send());
    expect(await screen.findByText(/changed: 3/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reset the mock API' }));
    expect(screen.queryByText(/changed: 3/)).not.toBeInTheDocument();

    await user.click(send());
    expect(await screen.findByText(/changed: 3/)).toBeInTheDocument();
  });

  it('moves the API key between the header and the query when told to', async () => {
    const user = userEvent.setup();
    render(<ApiConsole />);

    await user.click(screen.getByRole('button', { name: 'Key in query' }));
    await user.click(send());

    // The key is now part of the request-target, which is the whole of what makes the query
    // placement worse: a URL is recorded by everything in the path, and a header is not.
    expect(await screen.findByText(/^200 OK$/)).toBeInTheDocument();
    expect(screen.getByText(/api_key=/)).toBeInTheDocument();
    expect(screen.queryByText(/X-API-Key/)).not.toBeInTheDocument();
  });

  it('never calls fetch, whatever is typed', async () => {
    const user = userEvent.setup();
    render(<ApiConsole />);

    for (const value of ['/articles', 'http://localhost:3000/', '//evil.example/x']) {
      await user.clear(target());
      await user.type(target(), value);
      await user.click(send());
    }

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
