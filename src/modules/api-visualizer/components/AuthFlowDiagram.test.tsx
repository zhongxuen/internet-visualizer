import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { AUTH_BEARER, OAUTH_AUTHCODE_PKCE } from '../scenarios';
import { JWT_PAYLOAD_NOT_ENCRYPTED } from '../sim/auth';
import { runApiScenario } from '../sim/exchange';

import { AuthFlowDiagram } from './AuthFlowDiagram';

/**
 * The credential panel, in both of its shapes.
 *
 * One assertion here is an acceptance criterion of the phase and is not negotiable: whenever a
 * token is on screen, the sentence saying the payload is **encoded and not encrypted** is on
 * screen with it. It is checked against the exported constant rather than against a copy, so a
 * test that still passed after the sentence was reworded in one place would be impossible.
 */

const authRun = runApiScenario(AUTH_BEARER);
const oauthRun = runApiScenario(OAUTH_AUTHCODE_PKCE);

describe('the credential view', () => {
  it('prints the encoded-not-encrypted sentence beside every decoded token', async () => {
    const user = userEvent.setup();
    render(<AuthFlowDiagram exchanges={authRun.exchanges} />);

    const bearers = authRun.exchanges.filter(
      (exchange) => exchange.auth?.credential.kind === 'bearer',
    );
    expect(bearers.length).toBeGreaterThanOrEqual(5);

    for (const exchange of bearers) {
      await user.click(
        screen.getByRole('button', { name: `${exchange.status} — ${exchange.title}` }),
      );
      expect(screen.getByText(JWT_PAYLOAD_NOT_ENCRYPTED)).toBeInTheDocument();
    }
  });

  it('shows every claim, including the ones that should not be in a token', async () => {
    const user = userEvent.setup();
    render(<AuthFlowDiagram exchanges={authRun.exchanges} />);

    await user.click(screen.getByRole('button', { name: /Bearer token, read/ }));

    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getAllByText('private claim').length).toBeGreaterThan(0);
    expect(screen.getByText(/Which API the token was minted for/)).toBeInTheDocument();
  });

  it('names which check failed rather than saying the token is invalid', async () => {
    const user = userEvent.setup();
    render(<AuthFlowDiagram exchanges={authRun.exchanges} />);

    await user.click(screen.getByRole('button', { name: /Bearer token, expired/ }));

    // Every check is listed by name and each says whether it passed, because "invalid token"
    // tells a client nothing it can act on. `exp` appears twice: once as a claim, once as the
    // check that failed on it.
    expect(screen.getAllByText('exp', { selector: 'code' })).toHaveLength(2);
    expect(screen.getByText('signature', { selector: 'code' })).toBeInTheDocument();
    expect(screen.getByText('✕')).toBeInTheDocument();
    expect(
      screen.getByText(/there is no step in verification that consults the server/i),
    ).toBeInTheDocument();
  });

  it('warns about alg: none when a token claims it', async () => {
    const user = userEvent.setup();
    render(<AuthFlowDiagram exchanges={authRun.exchanges} />);

    await user.click(
      screen.getByRole('button', { name: /Bearer token signed with nothing/ }),
    );
    expect(screen.getByText(/RFC 7515 registers "none"/)).toBeInTheDocument();
  });

  it('names where an API key was put, and what that costs', async () => {
    const user = userEvent.setup();
    render(<AuthFlowDiagram exchanges={authRun.exchanges} />);

    await user.click(screen.getByRole('button', { name: /API key in the query string/ }));
    expect(screen.getByText('key in the query')).toBeInTheDocument();
    expect(screen.getByText(/Browser history/i)).toBeInTheDocument();
  });
});

describe('the ladder', () => {
  const detail = oauthRun.detail;

  it('draws all eleven rungs and the four parties', () => {
    if (detail.kind !== 'oauth') throw new Error('expected an oauth detail');
    render(<AuthFlowDiagram flow={detail.flow} />);

    const panel = screen.getByRole('region', { name: 'Authorization code + PKCE' });
    expect(within(panel).getAllByRole('listitem')).toHaveLength(11);
    for (const actor of [
      'User',
      'Client app',
      'Authorization server',
      'Resource server',
    ]) {
      expect(within(panel).getByText(actor)).toBeInTheDocument();
    }
  });

  it('shows the verifier and the challenge derived from it', () => {
    if (detail.kind !== 'oauth') throw new Error('expected an oauth detail');
    render(<AuthFlowDiagram flow={detail.flow} />);

    expect(screen.getByText(`verifier ${detail.flow.pkce.verifier}`)).toBeInTheDocument();
    expect(
      screen.getByText(`challenge ${detail.flow.pkce.challenge} (S256)`),
    ).toBeInTheDocument();
  });

  it('reports the stolen code being refused', () => {
    if (detail.kind !== 'oauth') throw new Error('expected an oauth detail');
    render(
      <AuthFlowDiagram
        flow={detail.flow}
        {...(detail.interception ? { interception: detail.interception } : {})}
      />,
    );

    expect(screen.getByText('The stolen code')).toBeInTheDocument();
    expect(screen.getByText('400 Bad Request')).toBeInTheDocument();
  });

  it('expands a rung to show what it defends against', async () => {
    const user = userEvent.setup();
    if (detail.kind !== 'oauth') throw new Error('expected an oauth detail');
    render(<AuthFlowDiagram flow={detail.flow} />);

    const rung = screen.getByRole('button', {
      name: /The user authenticates and consents/,
    });
    await user.click(rung);
    expect(rung).toHaveAttribute('aria-expanded', 'true');
  });
});
