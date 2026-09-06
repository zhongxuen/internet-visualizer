import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NetworkDiagnosticsModule } from './NetworkDiagnosticsModule';

/**
 * The composition root.
 *
 * Mounting this tree brings up a React Flow canvas and four separate runs, so this file
 * asserts the things that are properties of the *composition* -- which tool is on screen,
 * that switching tools switches the scenario picker with it, and that the corrections each
 * tool exists to make are actually rendered -- and leaves the protocol behaviour to the
 * model tests in `sim/`.
 *
 * The safety tests are the ones that must never be deleted. This is the only module in the
 * product allowed to reach a real network, and the whole of that permission is expressed in
 * this tree: Learn mode is the default and cannot call out, the live console is not mounted
 * until an acknowledgement has been given, and every request is disclosed before it is made
 * and never retried after it fails. The last three describes assert that from the outside,
 * rather than trusting the file layout to imply it.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

/** Move to a tool by its pill. */
function selectTool(label: string): void {
  fireEvent.click(screen.getByRole('button', { name: label, pressed: false }));
}

/** Press the Live mode segment. On its own this only opens the gate. */
function pressLive(): void {
  fireEvent.click(screen.getByRole('button', { name: /Live mode/ }));
}

/** Pass the acknowledgement gate the way a user has to: tick, then confirm. */
function enterLiveMode(): void {
  pressLive();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Enable Live mode' }));
}

/** Type a target into the live console. */
function typeTarget(value: string): void {
  fireEvent.change(screen.getByLabelText(/^Target/), { target: { value } });
}

/** A stubbed `fetch` that answers with `body`, and counts its calls. */
function stubFetch(body: unknown, init: ResponseInit = { status: 200 }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () =>
      new Response(JSON.stringify(body), {
        ...init,
        headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
      }),
  );
}

describe('NetworkDiagnosticsModule', () => {
  it('opens on ping, on the healthy path, with the simulated badge on the controls', () => {
    render(<NetworkDiagnosticsModule />);

    expect(screen.getByRole('button', { name: 'ping', pressed: true })).toBeVisible();
    expect(
      screen.getByRole('button', { name: /CDN one hop away/, pressed: true }),
    ).toBeVisible();
    expect(screen.getAllByText('Simulated').length).toBeGreaterThan(0);
  });

  it('shows the four tools', () => {
    render(<NetworkDiagnosticsModule />);
    const tools = screen.getByRole('group', { name: 'Tool' });

    for (const label of ['ping', 'traceroute', 'DNS lookup', 'WHOIS / RDAP']) {
      expect(within(tools).getByRole('button', { name: label })).toBeVisible();
    }
  });

  it('swaps the scenario picker with the tool', () => {
    render(<NetworkDiagnosticsModule />);

    expect(screen.getByRole('group', { name: 'Network' })).toBeVisible();

    selectTool('DNS lookup');
    expect(screen.queryByRole('group', { name: 'Network' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Question' })).toBeVisible();

    selectTool('WHOIS / RDAP');
    expect(screen.getByRole('group', { name: 'Record' })).toBeVisible();
  });

  it('offers the probe-type choice only on traceroute', () => {
    render(<NetworkDiagnosticsModule />);
    expect(screen.queryByRole('group', { name: 'Probe type' })).toBeNull();

    selectTool('traceroute');
    expect(screen.getByRole('group', { name: 'Probe type' })).toBeVisible();
  });
});

describe('the corrections each tool exists to make', () => {
  /** Ping's whole argument: the TCP check is on screen beside the loss figure. */
  it('shows the TCP contrast next to the ping result, on every path', () => {
    render(<NetworkDiagnosticsModule />);

    expect(screen.getByText('Is the host actually up?')).toBeVisible();
    expect(screen.getByText(/TCP connection attempt, not an ICMP echo/)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: /Filtered host/ }));
    expect(screen.getAllByText(/up the whole time/).length).toBeGreaterThan(0);
    expect(screen.getByText(/TCP 443 open/)).toBeVisible();
  });

  it('states the four standing reasons that silence is weak evidence', () => {
    render(<NetworkDiagnosticsModule />);
    expect(screen.getByText('Why silence is weak evidence')).toBeVisible();
    expect(
      screen.getByText(/ICMP is a different protocol from the one you care about/),
    ).toBeVisible();
  });

  it('shows the TTL walk behind a traceroute row, ending in the expiry', () => {
    render(<NetworkDiagnosticsModule />);
    selectTool('traceroute');

    expect(screen.getByText('How hop 1 was found')).toBeVisible();
    expect(
      screen.getAllByText(/RFC 791 requires the datagram to be discarded/).length,
    ).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /^Hop 3/ }));
    expect(screen.getByText('How hop 3 was found')).toBeVisible();
  });

  it('shows every caveat, marking the ones the current trace demonstrates', () => {
    render(<NetworkDiagnosticsModule />);
    selectTool('traceroute');

    // All five are always listed: the clean trace is where false confidence forms.
    expect(screen.getByText('`* * *` almost never means a broken hop')).toBeVisible();
    const onClean = screen.getAllByText('visible in this trace').length;

    // The long-haul path demonstrates three more of them than the clean one does.
    fireEvent.click(screen.getByRole('button', { name: /Across an ocean/ }));
    expect(screen.getAllByText('visible in this trace').length).toBe(onClean + 3);
  });

  it('puts the warm run beside the cold one on a lookup', () => {
    render(<NetworkDiagnosticsModule />);
    selectTool('DNS lookup');

    expect(screen.getByText('Asked again, immediately')).toBeVisible();
    expect(screen.getByText('0 queries')).toBeVisible();
  });

  it('explains the status codes and prints both protocols on a registration lookup', () => {
    render(<NetworkDiagnosticsModule />);
    selectTool('WHOIS / RDAP');

    expect(screen.getByText('clientTransferProhibited')).toBeVisible();
    expect(screen.getByText('Port 43, plain text, in the clear')).toBeVisible();
    expect(screen.getByText(/HTTPS, application\/rdap\+json/)).toBeVisible();
  });

  it('shows clientHold on the expired domain, which is what explains the outage', () => {
    render(<NetworkDiagnosticsModule />);
    selectTool('WHOIS / RDAP');

    fireEvent.click(screen.getByRole('button', { name: /example\.org/ }));
    expect(screen.getByText('clientHold')).toBeVisible();
    expect(screen.getByText(/stops resolving everywhere/)).toBeVisible();
  });
});

describe('the safety boundary', () => {
  /**
   * Learn mode is the default, and in it this tree contains nothing that can call out.
   * Every tool is visited and every scenario switch exercised; none may reach a network.
   */
  it('never calls fetch in Learn mode, whichever tool or scenario is selected', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<NetworkDiagnosticsModule />);

    fireEvent.click(screen.getByRole('button', { name: /Across an ocean/ }));
    selectTool('traceroute');
    fireEvent.click(screen.getByRole('button', { name: /ICMP probes/ }));
    selectTool('DNS lookup');
    fireEvent.click(screen.getByRole('button', { name: /example\.com MX/ }));
    selectTool('WHOIS / RDAP');
    fireEvent.click(screen.getByRole('button', { name: /203\.0\.113\.0\/24/ }));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('opens in Learn mode, with no live badge and no live console', () => {
    render(<NetworkDiagnosticsModule />);

    expect(
      screen.getByRole('button', { name: /Learn mode/, pressed: true }),
    ).toBeVisible();
    expect(screen.queryByText('Live network')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Live diagnostics' })).toBeNull();
    expect(screen.getAllByText('Simulated').length).toBeGreaterThan(0);
  });
});

describe('the acknowledgement gate', () => {
  it('does not enter Live mode on the first press; it states what will happen instead', () => {
    render(<NetworkDiagnosticsModule />);
    pressLive();

    expect(
      screen.getByRole('button', { name: /Learn mode/, pressed: true }),
    ).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Live diagnostics' })).toBeNull();

    expect(
      screen.getByRole('heading', { name: /Live mode makes real network requests/ }),
    ).toBeVisible();
    expect(screen.getByText(/server makes the request, not your browser/)).toBeVisible();
    expect(screen.getByText(/One target, one request/)).toBeVisible();
    expect(screen.getByText(/Nothing is retried on your behalf/)).toBeVisible();
  });

  it('will not confirm until the checkbox is ticked', () => {
    render(<NetworkDiagnosticsModule />);
    pressLive();

    const confirm = screen.getByRole('button', { name: 'Enable Live mode' });
    expect(confirm).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(confirm).toBeEnabled();
  });

  it('leaves the user in Learn mode when the gate is declined', () => {
    render(<NetworkDiagnosticsModule />);
    pressLive();
    fireEvent.click(screen.getByRole('button', { name: 'Stay in Learn mode' }));

    expect(
      screen.getByRole('button', { name: /Learn mode/, pressed: true }),
    ).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Live diagnostics' })).toBeNull();
    expect(screen.queryByText('Live network')).toBeNull();
  });

  it('shows the live badge for as long as Live mode is active, and drops it on return', () => {
    render(<NetworkDiagnosticsModule />);
    enterLiveMode();

    expect(screen.getByRole('region', { name: 'Live diagnostics' })).toBeVisible();
    expect(screen.getAllByText('Live network').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /Learn mode/ }));
    expect(screen.queryByText('Live network')).toBeNull();
  });
});

describe('live mode', () => {
  it('discloses the exact URL and method before anything is sent', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<NetworkDiagnosticsModule />);
    enterLiveMode();
    selectTool('DNS lookup');
    typeTarget('example.com');

    const disclosure = screen.getByRole('region', { name: 'Before you press Run' });
    expect(
      within(disclosure).getByText('/api/diagnostics/dns?target=example.com&type=A'),
    ).toBeVisible();
    expect(
      within(disclosure).getByText(
        'https://cloudflare-dns.com/dns-query?name=example.com&type=A',
      ),
    ).toBeVisible();
    expect(within(disclosure).getAllByText('GET')).toHaveLength(2);

    // The whole point of the panel: it is on screen, and nothing has been requested.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('labels the live ping as TCP and HTTP timing rather than ICMP', () => {
    render(<NetworkDiagnosticsModule />);
    enterLiveMode();

    // `ping` is the tool that opens, so its live counterpart is the first thing on
    // screen -- and it must not be called ping.
    expect(screen.getByText(/Live: Reachability \(TCP \+ HTTP timing\)/)).toBeVisible();
    typeTarget('example.com');
    expect(screen.getAllByText(/not an ICMP echo/).length).toBeGreaterThan(0);
    expect(screen.getByText('HEAD')).toBeVisible();
  });

  it('refuses a private address in the browser, before any request is made', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<NetworkDiagnosticsModule />);
    enterLiveMode();
    selectTool('DNS lookup');
    typeTarget('10.0.0.1');

    expect(screen.getByRole('button', { name: 'Run once' })).toBeDisabled();
    expect(screen.getByText(/private/i)).toBeVisible();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a list and a CIDR block, so a scan has nowhere to be typed', () => {
    render(<NetworkDiagnosticsModule />);
    enterLiveMode();
    selectTool('DNS lookup');

    typeTarget('example.com,example.net');
    expect(screen.getByText(/not a list/)).toBeVisible();

    typeTarget('192.0.2.0/24');
    expect(screen.getByText(/not a CIDR block or a path/)).toBeVisible();

    expect(screen.getByRole('button', { name: 'Run once' })).toBeDisabled();
  });

  it('sends exactly one same-origin request per press, and shows the answer', async () => {
    const fetchSpy = stubFetch({
      ok: true,
      requestedAt: '2026-09-06T00:00:00.000Z',
      elapsedMs: 12,
      source: {
        kind: 'doh',
        name: 'Cloudflare DNS (1.1.1.1)',
        endpoint: 'https://cloudflare-dns.com/dns-query?name=example.com&type=A',
        note: 'Resolved over DNS-over-HTTPS by Cloudflare, from this server.',
      },
      target: 'example.com',
      type: 'A',
      question: { name: 'example.com', type: 'A' },
      rcode: 'NOERROR',
      rcodeValue: 0,
      authenticatedData: false,
      checkingDisabled: false,
      truncated: false,
      answers: [
        { name: 'example.com', type: 'A', typeValue: 1, ttl: 300, data: '93.184.216.34' },
      ],
      authority: [],
    });

    render(<NetworkDiagnosticsModule />);
    enterLiveMode();
    selectTool('DNS lookup');
    typeTarget('example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Run once' }));

    expect(await screen.findByText('93.184.216.34')).toBeVisible();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      '/api/diagnostics/dns?target=example.com&type=A',
    );
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ method: 'GET' });
  });

  it('shows a refusal plainly, and does not retry it', async () => {
    const fetchSpy = stubFetch(
      {
        ok: false,
        error: {
          code: 'blocked-target',
          message: 'that address is loopback and will not be requested',
          reason: 'blocked-resolved-address',
          address: '127.0.0.1',
        },
        requestedAt: '2026-09-06T00:00:00.000Z',
      },
      { status: 403 },
    );

    render(<NetworkDiagnosticsModule />);
    enterLiveMode();
    selectTool('DNS lookup');
    typeTarget('example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Run once' }));

    expect(
      await screen.findByText(/that address is loopback and will not be requested/),
    ).toBeVisible();
    expect(screen.getByText('blocked-resolved-address')).toBeVisible();
    expect(screen.getByText(/Nothing was retried/)).toBeVisible();

    // The assertion that matters: still one call, some time after the failure landed.
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  });

  it('shows the rate limit and blocks the button rather than retrying', async () => {
    stubFetch(
      {
        ok: false,
        error: {
          code: 'rate-limited',
          message: 'You have used your share of live lookups. Try again in 30s.',
          retryAfterSeconds: 30,
        },
        requestedAt: '2026-09-06T00:00:00.000Z',
      },
      {
        status: 429,
        headers: {
          'Retry-After': '30',
          'X-RateLimit-Limit': '10',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': '0',
        },
      },
    );

    render(<NetworkDiagnosticsModule />);
    enterLiveMode();
    selectTool('DNS lookup');
    typeTarget('example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Run once' }));

    expect(await screen.findByText(/used your share of live lookups/)).toBeVisible();
    expect(screen.getByText(/Nothing was retried, and nothing will be/)).toBeVisible();

    // The button names the wait and refuses to fire, rather than going quietly dead.
    expect(screen.queryByRole('button', { name: 'Run once' })).toBeNull();
    expect(screen.getByRole('button', { name: /^Wait \d+s$/ })).toBeDisabled();
  });

  it('offers no live traceroute, and says why in its place', () => {
    render(<NetworkDiagnosticsModule />);
    enterLiveMode();
    selectTool('traceroute');

    expect(screen.getByRole('region', { name: 'No live traceroute' })).toBeVisible();
    expect(screen.getByText(/needs a raw socket/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Run once' })).toBeNull();
  });

  it('keeps the simulated explanation of the same tool beside the live one', () => {
    render(<NetworkDiagnosticsModule />);
    enterLiveMode();

    // Live reachability above, and the simulated ping that explains what it is below.
    expect(screen.getByText(/Live: Reachability/)).toBeVisible();
    expect(screen.getByText('Simulated ping')).toBeVisible();
    expect(screen.getByText('Is the host actually up?')).toBeVisible();
  });
});
