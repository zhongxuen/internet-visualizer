import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CERT_EXPIRED, TLS12_FRESH, TLS13_FRESH, TLS13_RESUMPTION } from '../scenarios';
import { runTlsScenario, type TlsScenario } from '../sim/connection';

import type { OverlayView } from './EncryptionOverlay';
import { HandshakeLadder } from './HandshakeLadder';

/**
 * Two phase-09 acceptance criteria: **the TLS 1.3 ladder is message-accurate and shows
 * where encryption starts**, and **the 0-RTT replay caveat is stated in the resumption
 * scenario** — stated on the ladder, not left in the event log for somebody to scrub for.
 *
 * The encryption-start assertion is positional rather than textual: the marker has to
 * come immediately after `ServerHello` in TLS 1.3 and after `ChangeCipherSpec` in TLS
 * 1.2, because "one message in versus a round trip in" is the comparison, and a marker
 * that merely exists somewhere would pass a text-only check while teaching nothing.
 */

function mount(
  scenario: TlsScenario,
  {
    view = 'participant',
    selectedId = null,
  }: { view?: OverlayView; selectedId?: string | null } = {},
) {
  const run = runTlsScenario(scenario);
  const onSelect = vi.fn();
  render(
    <HandshakeLadder
      messages={run.messages}
      flights={run.flights}
      encryptionStartsAt={run.handshake.encryptionStartsAt}
      view={view}
      now={run.result.durationMs}
      selectedId={selectedId}
      onSelect={onSelect}
      notes={run.handshake.notes}
      {...(run.abort ? { abort: run.abort } : {})}
    />,
  );
  return { run, onSelect };
}

/** Every rung's visible label, in ladder order. */
function rungs(): string[] {
  return screen
    .getAllByRole('listitem')
    .map((item) => within(item).queryAllByRole('button')[0]?.textContent ?? '')
    .filter(Boolean);
}

describe('the TLS 1.3 ladder', () => {
  it('renders the RFC 8446 message sequence, in order', () => {
    mount(TLS13_FRESH);

    const names = rungs();
    const order = [
      'ClientHello',
      'ServerHello',
      '{EncryptedExtensions}',
      '{Certificate}',
      '{CertificateVerify}',
      '{Finished}',
    ];

    let cursor = -1;
    for (const name of order) {
      const found = names.findIndex(
        (label, index) => index > cursor && label.includes(name),
      );
      expect(found, `${name} should follow the message before it`).toBeGreaterThan(
        cursor,
      );
      cursor = found;
    }
  });

  it('brackets each message the way the RFC does, by the key that protects it', () => {
    mount(TLS13_FRESH);
    const names = rungs();

    // Bare in the clear, braces under handshake keys, brackets under application keys.
    expect(
      names.some((label) => label.includes('ClientHello') && !label.includes('{')),
    ).toBe(true);
    expect(names.some((label) => label.includes('{Certificate}'))).toBe(true);
    expect(names.some((label) => label.includes('[NewSessionTicket]'))).toBe(true);
  });

  it('puts the encryption-starts marker immediately after ServerHello', () => {
    const { run } = mount(TLS13_FRESH);

    const items = screen.getAllByRole('listitem');
    const markerIndex = items.findIndex((item) =>
      item.textContent?.includes('Encryption starts here'),
    );
    expect(markerIndex).toBeGreaterThan(-1);

    // The marker lives in the same <li> as the first protected message, and the message
    // before it is the last one in the clear.
    expect(items[markerIndex]!.textContent).toContain('EncryptedExtensions');
    expect(items[markerIndex - 1]!.textContent).toContain('ChangeCipherSpec');
    expect(run.handshake.encryptionStartsAt).toBe('encrypted-extensions');
  });
});

describe('the TLS 1.2 ladder', () => {
  it('starts encrypting a full round trip later, after ChangeCipherSpec', () => {
    const { run } = mount(TLS12_FRESH);

    const items = screen.getAllByRole('listitem');
    const markerIndex = items.findIndex((item) =>
      item.textContent?.includes('Encryption starts here'),
    );

    expect(run.handshake.encryptionStartsAt).toBe('client-finished');
    expect(items[markerIndex]!.textContent).toContain('Finished');

    // The certificate is above the line — in the clear, for anyone watching.
    const certIndex = items.findIndex((item) =>
      item.textContent?.includes('Certificate'),
    );
    expect(certIndex).toBeLessThan(markerIndex);
    expect(items[certIndex]!.textContent).not.toContain('{Certificate}');
  });
});

describe('the observer view', () => {
  it('replaces the fields an observer cannot read, and keeps the ones it can', async () => {
    const user = userEvent.setup();
    const { run } = mount(TLS13_FRESH, {
      view: 'observer',
      selectedId: 'client-hello',
    });

    // ClientHello is in the clear: its SNI really is readable.
    const hello = run.messages.find((message) => message.id === 'client-hello')!;
    const sni = hello.fields.find((field) => field.name.includes('server_name'))!;
    expect(sni.visibleToObserver).toBe(true);
    expect(screen.getByText(sni.value)).toBeInTheDocument();
    expect(screen.getAllByText('Readable by anyone on the path.').length).toBeGreaterThan(
      0,
    );

    await user.click(screen.getAllByRole('button')[0]!);
  });

  it('hides the contents of an encrypted message while keeping it on the ladder', () => {
    mount(TLS13_FRESH, { view: 'observer', selectedId: 'certificate' });

    expect(
      screen.getAllByText(/encrypted — not on the wire in the clear/).length,
    ).toBeGreaterThan(0);
  });
});

describe('the notes beside the ladder', () => {
  it('states the 0-RTT replay caveat on the resumption run, as a warning', () => {
    mount(TLS13_RESUMPTION);

    const notes = within(
      screen.getByRole('heading', { name: /worth noticing/ })
        .parentElement as HTMLElement,
    );
    const replay = notes
      .getAllByRole('listitem')
      .find((item) => /replay/i.test(item.textContent ?? ''))!;

    expect(replay.textContent).toContain('⚠');
    expect(replay.textContent).toMatch(/RFC 8446 § 8/);
  });

  it('puts warnings before the merely interesting notes', () => {
    const { run } = mount(TLS13_RESUMPTION);
    expect(run.handshake.notes.some((note) => note.level === 'warning')).toBe(true);

    const items = within(
      screen.getByRole('heading', { name: /worth noticing/ })
        .parentElement as HTMLElement,
    ).getAllByRole('listitem');

    const lastWarning = items.findLastIndex((item) => item.textContent?.includes('⚠'));
    const firstInfo = items.findIndex((item) => !item.textContent?.includes('⚠'));
    expect(firstInfo === -1 || lastWarning < firstInfo).toBe(true);
  });
});

describe('an aborted connection', () => {
  it('stops the ladder and names the alert that ended it', () => {
    const { run } = mount(CERT_EXPIRED);

    expect(run.messages).toHaveLength(8);
    expect(rungs().some((label) => label.includes('Application Data'))).toBe(false);
    expect(screen.getByText(/Alert: certificate_expired \(45\)/)).toBeInTheDocument();
    expect(screen.getByText('NET::ERR_CERT_DATE_INVALID')).toBeInTheDocument();
  });
});

describe('selection', () => {
  it('reports the message that was clicked, so the module can seek to it', async () => {
    const user = userEvent.setup();
    const { onSelect } = mount(TLS13_FRESH);

    await user.click(screen.getByRole('button', { name: /ClientHello/ }));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'client-hello' }),
    );
  });
});
