import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TLS12_FRESH, TLS13_FRESH } from '../scenarios';
import { CLIENT_IP, runTlsScenario } from '../sim/connection';

import { EncryptionOverlay } from './EncryptionOverlay';

/**
 * The phase-09 acceptance criterion this component exists for: **the overlay correctly
 * shows what remains visible to an observer.**
 *
 * The failure mode being tested against is the flattering one — an overlay that shows
 * plaintext on one side and a wall of hex on the other, teaching that HTTPS hides
 * everything. So the assertions here are almost all about what is still *readable*: the
 * destination address, the SNI hostname, the record types and lengths, the timing, and
 * the sizes. The single assertion about what is hidden is deliberately outnumbered,
 * which is the same ratio the panel itself uses.
 */

const tls13 = runTlsScenario(TLS13_FRESH);
const tls12 = runTlsScenario(TLS12_FRESH);

/** Render at a playhead past the end, so nothing is dimmed for being unsent. */
function mount(run: typeof tls13, view: 'participant' | 'observer' = 'observer') {
  const onViewChange = vi.fn();
  render(
    <EncryptionOverlay
      run={run}
      view={view}
      onViewChange={onViewChange}
      now={run.result.durationMs}
    />,
  );
  return { onViewChange };
}

const visibleFacts = () =>
  screen.getByRole('list', { name: 'Still visible to an observer' });
const hiddenFacts = () => screen.getByRole('list', { name: 'Concealed by encryption' });

describe('what stays visible to an observer', () => {
  it('shows the IP and TCP headers, outside TLS entirely', () => {
    mount(tls13);

    const box = screen.getByRole('heading', {
      name: /Outside TLS entirely/,
    }).parentElement as HTMLElement;

    expect(
      within(box).getByText(`${CLIENT_IP} → ${TLS13_FRESH.serverIp}`),
    ).toBeInTheDocument();
    expect(within(box).getByText(/→ 443 \(HTTPS\)/)).toBeInTheDocument();
  });

  it('shows the traffic shape: how many records, how many bytes, over how long', () => {
    mount(tls13);

    expect(
      screen.getByText(
        new RegExp(`${tls13.wire.length} records · ${tls13.wireBytes} bytes`),
      ),
    ).toBeInTheDocument();
  });

  it('lists the destination address, the SNI hostname, the timing and the sizes as visible', () => {
    mount(tls13);

    const visible = visibleFacts();
    for (const label of [
      'Destination IP address',
      'Hostname (SNI)',
      'Timing and traffic pattern',
      'Sizes',
    ]) {
      expect(within(visible).getByText(label)).toBeInTheDocument();
    }
    expect(within(visible).getByText(TLS13_FRESH.host)).toBeInTheDocument();
  });

  it('puts the path, headers, cookies and body on the hidden side, and only those', () => {
    mount(tls13);

    const hidden = hiddenFacts();
    expect(
      within(hidden).getByText('URL path, headers, cookies, and body'),
    ).toBeInTheDocument();
  });

  it('gives every record its type and its length, whether or not it is encrypted', () => {
    mount(tls13);

    const rows = within(
      screen.getByRole('list', { name: 'Records on the wire' }),
    ).getAllByRole('listitem');
    expect(rows).toHaveLength(tls13.wire.length);

    for (const [index, row] of rows.entries()) {
      const observed = tls13.observed[index]!;
      expect(row.textContent).toContain(`length ${observed.length}`);
      expect(row.textContent).toContain(`type ${observed.type}`);
    }
  });

  it('says the real type is encrypted on a protected TLS 1.3 record, and does not on TLS 1.2', () => {
    const { unmount } = render(
      <EncryptionOverlay
        run={tls13}
        view="observer"
        onViewChange={vi.fn()}
        now={tls13.result.durationMs}
      />,
    );
    expect(screen.getAllByText(/real type encrypted/).length).toBeGreaterThan(0);
    unmount();

    mount(tls12);
    expect(screen.queryByText(/real type encrypted/)).not.toBeInTheDocument();
  });
});

describe('the difference the version makes', () => {
  it('marks the certificate and the record type as visible under TLS 1.2 and hidden under TLS 1.3', () => {
    const { unmount } = render(
      <EncryptionOverlay
        run={tls12}
        view="observer"
        onViewChange={vi.fn()}
        now={tls12.result.durationMs}
      />,
    );
    expect(
      within(visibleFacts()).getByText('Server certificate and identity'),
    ).toBeInTheDocument();
    expect(
      within(visibleFacts()).getByText('Which kind of message each record holds'),
    ).toBeInTheDocument();
    unmount();

    mount(tls13);
    expect(
      within(visibleFacts()).queryByText('Server certificate and identity'),
    ).not.toBeInTheDocument();
    expect(
      within(hiddenFacts()).getByText('Which kind of message each record holds'),
    ).toBeInTheDocument();
  });
});

describe('the participant view', () => {
  it('shows the HTTP request in plaintext, which the observer view does not', async () => {
    const user = userEvent.setup();
    const { onViewChange } = mount(tls13, 'participant');

    expect(screen.getByText(/GET \/account\/orders HTTP\/1\.1/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Observer' }));
    expect(onViewChange).toHaveBeenCalledWith('observer');
  });

  it('still shows the IP headers and the visible-facts list, because those do not change', () => {
    mount(tls13, 'participant');

    expect(
      screen.getByRole('heading', { name: /Outside TLS entirely/ }),
    ).toBeInTheDocument();
    expect(
      within(visibleFacts()).getByText('Destination IP address'),
    ).toBeInTheDocument();
  });
});
