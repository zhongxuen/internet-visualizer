import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HANDSHAKE_AND_CHAT, RFC_EXAMPLE_ACCEPT, RFC_EXAMPLE_KEY } from '../scenarios';
import { runWebSocketScenario } from '../sim/exchange';

import { UpgradePanel } from './UpgradePanel';

/**
 * The handshake panel.
 *
 * Two claims are being made on screen and both are checkable: that this is an ordinary HTTP
 * request, and that `Sec-WebSocket-Accept` is derived rather than asserted. The first is shown
 * by rendering the request verbatim, so the test looks for the request line; the second by
 * keeping every intermediate value, so the test looks for the concatenated string and the
 * digest as well as the answer.
 *
 * The passing checks are asserted too. A panel that only rendered failures would leave a
 * reader knowing what breaks a handshake and not what one is.
 */

const run = runWebSocketScenario(HANDSHAKE_AND_CHAT);
const handshake = run.handshakes[0];

describe('UpgradePanel', () => {
  it('renders the request as the ordinary GET it is', () => {
    render(<UpgradePanel handshake={handshake} />);

    expect(screen.getByText(/GET \/chat\?room=lobby HTTP\/1\.1/)).toBeInTheDocument();
    // Once in the status-line badge, once in the rendered response text.
    expect(screen.getAllByText(/101 Switching Protocols/).length).toBeGreaterThan(1);
  });

  it('shows the accept derivation step by step, not just its answer', () => {
    render(<UpgradePanel handshake={handshake} />);

    expect(screen.getByText('Take the key as sent')).toBeInTheDocument();
    expect(screen.getByText('Append the fixed GUID')).toBeInTheDocument();
    expect(screen.getByText('SHA-1 it')).toBeInTheDocument();
    expect(screen.getByText('base64 the digest')).toBeInTheDocument();

    // The concatenation is where the two load-bearing details live: nothing goes between the
    // key and the GUID, and the key is hashed exactly as it was sent.
    expect(
      screen.getByText(`${RFC_EXAMPLE_KEY}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`),
    ).toBeInTheDocument();
    expect(screen.getAllByText(RFC_EXAMPLE_ACCEPT).length).toBeGreaterThan(0);
  });

  it('says the digest proves comprehension rather than identity', () => {
    render(<UpgradePanel handshake={handshake} />);
    expect(screen.getByText(/proof of comprehension, not a secret/)).toBeInTheDocument();
  });

  it('lists passing checks as well as failing ones, with the requirement level', () => {
    render(<UpgradePanel handshake={handshake} />);

    const musts = screen.getAllByText('MUST');
    expect(musts.length).toBeGreaterThan(3);
    // Exactly one SHOULD in the table, and it is the Origin check -- the row that matters.
    expect(screen.getAllByText('SHOULD')).toHaveLength(1);
    expect(screen.getByText('Origin is one the server accepts')).toBeInTheDocument();
  });

  it('shows Connection as a token list, because that is the bug servers ship', () => {
    render(<UpgradePanel handshake={handshake} />);

    expect(screen.getByText('Connection tokens')).toBeInTheDocument();
    expect(screen.getAllByText(/rejects/).length).toBeGreaterThan(0);
  });

  it('names the subprotocol the server chose', () => {
    render(<UpgradePanel handshake={handshake} />);
    expect(screen.getByText('chat.v1')).toBeInTheDocument();
  });

  it('offers a picker only when the run made more than one handshake', () => {
    const { rerender } = render(
      <UpgradePanel handshake={handshake} handshakes={run.handshakes} />,
    );
    expect(screen.queryByRole('group', { name: 'Handshake' })).not.toBeInTheDocument();

    const reconnected = [
      handshake,
      { ...handshake, id: 'attempt-3', label: 'Reconnection (attempt 3)' },
    ];
    rerender(<UpgradePanel handshake={handshake} handshakes={reconnected} />);
    expect(screen.getByRole('group', { name: 'Handshake' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Reconnection (attempt 3)' }),
    ).toBeInTheDocument();
  });
});
