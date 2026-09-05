import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HttpsExplorerModule } from './HttpsExplorerModule';

/**
 * The composition root, tested for the wiring rather than for the protocol -- the
 * handshake models, the key schedule, the certificate validator, the record layer and the
 * five views each have their own tests, and this file is about whether picking a scenario
 * and flipping the vantage point do what they say.
 *
 * Two assertions here are not about wiring and must never be relaxed:
 *
 * - **no input to this module can cause a network request.** `fetch` is stubbed with a spy
 *   that fails the test if anything calls it.
 * - **the participant/observer toggle changes the whole page**, not one panel. It is the
 *   module's headline control, and a toggle that only redrew the overlay would teach that
 *   the observer view is a display mode rather than a different vantage point.
 */

const scenario = (title: string) =>
  screen.getByRole('button', { name: (name: string) => name.includes(title) });

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn(() => {
    throw new Error('the HTTPS Explorer must never make a network request');
  });
  vi.stubGlobal('fetch', fetchSpy);
});

describe('the module', () => {
  it('opens on the fresh TLS 1.3 handshake with all five views present', () => {
    render(<HttpsExplorerModule />);

    expect(scenario('TLS 1.3, from cold')).toHaveAttribute('aria-pressed', 'true');

    for (const name of [
      'Handshake ladder',
      'What is on the wire',
      /Key schedule/,
      /Certificate chain/,
      'Cipher suite, decomposed',
      'TLS 1.2 vs TLS 1.3',
    ] as (string | RegExp)[]) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rebuilds the run when another scenario is picked', async () => {
    const user = userEvent.setup();
    render(<HttpsExplorerModule />);

    const ladder = () => screen.getByRole('region', { name: 'Handshake ladder' });
    const before = within(ladder()).getAllByRole('listitem').length;

    await user.click(scenario('Expired certificate'));

    // The aborted run stops at the alert, so it is strictly shorter.
    expect(within(ladder()).getAllByRole('listitem').length).toBeLessThan(before);
    expect(within(ladder()).getByText(/Connection aborted/)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('shows the failing certificate check for the scenario that broke it', async () => {
    const user = userEvent.setup();
    render(<HttpsExplorerModule />);

    await user.click(scenario('Right certificate, wrong name'));

    const chain = screen.getByRole('region', { name: /Certificate chain/ });
    expect(
      within(chain).getByText('NET::ERR_CERT_COMMON_NAME_INVALID'),
    ).toBeInTheDocument();
    expect(within(chain).getByText('1 of 5 checks failed')).toBeInTheDocument();
  });

  it('drops the certificate panel to its no-certificate copy when the session resumes', async () => {
    const user = userEvent.setup();
    render(<HttpsExplorerModule />);

    await user.click(scenario('Resumption and 0-RTT'));

    const chain = screen.getByRole('region', { name: /Certificate chain/ });
    expect(
      within(chain).getByText(/authenticates with the pre-shared key from the ticket/),
    ).toBeInTheDocument();
  });
});

describe('the vantage-point toggle', () => {
  it('switches the ladder and the overlay together, from one control', async () => {
    const user = userEvent.setup();
    render(<HttpsExplorerModule />);

    const ladder = () => screen.getByRole('region', { name: 'Handshake ladder' });
    const overlay = () => screen.getByRole('region', { name: 'What is on the wire' });

    expect(within(ladder()).getByText(/as a participant sees it/)).toBeInTheDocument();
    expect(
      within(overlay()).getByRole('heading', { name: /as an endpoint holds it/ }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Observer view' }));

    expect(within(ladder()).getByText(/as an observer sees it/)).toBeInTheDocument();
    expect(
      within(overlay()).getByRole('heading', { name: /as the observer reads it/ }),
    ).toBeInTheDocument();
  });

  it('can also be flipped from inside the overlay, and the ladder follows', async () => {
    const user = userEvent.setup();
    render(<HttpsExplorerModule />);

    const overlay = screen.getByRole('region', { name: 'What is on the wire' });
    await user.click(within(overlay).getByRole('button', { name: 'Observer' }));

    expect(
      within(screen.getByRole('region', { name: 'Handshake ladder' })).getByText(
        /as an observer sees it/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Observer view' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

describe('the comparison', () => {
  it('is drawn from the reference runs, so it survives every scenario', async () => {
    const user = userEvent.setup();
    render(<HttpsExplorerModule />);

    const comparison = () => screen.getByRole('region', { name: 'TLS 1.2 vs TLS 1.3' });
    expect(
      within(comparison()).getByText('1 RTT before application data'),
    ).toBeInTheDocument();
    expect(
      within(comparison()).getByText('2 RTT before application data'),
    ).toBeInTheDocument();

    await user.click(scenario('TLS 1.2, for comparison'));

    // Same two tracks, and now TLS 1.2 is the one marked as this run.
    const tls12Track = within(comparison())
      .getAllByRole('listitem')
      .find((item) => item.textContent?.startsWith('TLS 1.2'))!;
    expect(within(tls12Track).getByText('this run')).toBeInTheDocument();
  });
});
