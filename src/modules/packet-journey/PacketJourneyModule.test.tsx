import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { PacketJourneyModule } from './PacketJourneyModule';
import { TCP_WEB_REQUEST } from './scenarios';

/**
 * The phase-06 acceptance test, driven through the surfaces a learner uses.
 *
 * The protocol facts themselves are pinned much closer to where they are decided --
 * `sim/journey.test.ts` for the engine, `ledger.test.ts` for the derivation the tables
 * print. What is asserted here is that the module *composes*: the diagram, the ledger,
 * and the encapsulation panel all come from one run, the controls re-run it, and the
 * playback machinery is the shared one rather than a second animation loop.
 */

function hopTable() {
  return within(screen.getByRole('region', { name: 'Hop by hop' }));
}

function encapsulation() {
  return within(screen.getByRole('region', { name: 'Encapsulation' }));
}

describe('PacketJourneyModule', () => {
  it('opens on the TCP web request, drawn and captioned', () => {
    render(<PacketJourneyModule />);

    expect(
      screen.getByRole('region', { name: 'TCP web request packet journey' }),
    ).toBeInTheDocument();
    expect(screen.getByText(TCP_WEB_REQUEST.summary)).toBeInTheDocument();
  });

  it('reuses the shared playback surfaces rather than building its own', () => {
    render(<PacketJourneyModule />);

    expect(screen.getByRole('region', { name: 'Phases' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Inspector' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Playback position' })).toBeInTheDocument();
  });

  it('shows the ledger, the encapsulation panel, and the NAT table for one run', () => {
    render(<PacketJourneyModule />);

    // One per packet the laptop sends: the ledger is the whole run, not just the first hop.
    expect(
      hopTable().getAllByText(/Laptop → Home router \(NAPT\)/).length,
    ).toBeGreaterThan(0);
    expect(encapsulation().getByText(/Ethernet frame prepended/)).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'NAT translation table' }),
    ).toBeInTheDocument();
  });

  it('switches scenarios in place, with no navigation', async () => {
    render(<PacketJourneyModule />);

    await userEvent.click(screen.getByRole('button', { name: /UDP DNS query/ }));

    expect(
      screen.getByRole('region', { name: 'UDP DNS query packet journey' }),
    ).toBeInTheDocument();
    // A different path: the resolver is one hop past the gateway, not a server abroad.
    expect(hopTable().getAllByText(/ISP resolver/).length).toBeGreaterThan(0);
    expect(hopTable().queryByText(/Origin server/)).not.toBeInTheDocument();
  });

  it('re-runs the simulation when a knob is turned', async () => {
    render(<PacketJourneyModule />);

    const before = hopTable().getAllByRole('row').length;
    await userEvent.selectOptions(screen.getByLabelText('Transport'), 'udp');

    // No handshake and no teardown: far fewer packets, so far fewer hops.
    expect(hopTable().getAllByRole('row').length).toBeLessThan(before);
    expect(screen.queryByText(/TCP handshake/)).not.toBeInTheDocument();
  });

  /*
    `fireEvent` rather than `userEvent` here: this test re-runs the simulation twice and
    re-renders the whole ledger each time, and userEvent's pointer sequence on a tree this
    size is the slowest part of the suite. The behaviour under test is the state reset,
    not the pointer.
  */
  it('puts the knobs back when the scenario changes', () => {
    render(<PacketJourneyModule />);

    fireEvent.change(screen.getByLabelText('Link MTU'), { target: { value: '1400' } });
    expect(screen.getByLabelText('Link MTU')).toHaveValue('1400');

    fireEvent.click(screen.getByRole('button', { name: /UDP DNS query/ }));

    expect(screen.getByLabelText('Link MTU')).toHaveValue('authored');
    expect(screen.getByRole('button', { name: /Reset to the scenario/ })).toBeDisabled();
  });

  /** The interaction the phase doc asks for by name. */
  it('seeks the timeline when a hop row is clicked', async () => {
    render(<PacketJourneyModule />);

    const rows = hopTable().getAllByRole('row');
    // The last data row in the table: far enough along that the playhead must move.
    const last = rows[rows.length - 1];
    await userEvent.click(last);

    expect(last).toHaveAttribute('aria-current', 'true');
    // And the encapsulation panel followed it, rather than staying at the first packet.
    expect(
      encapsulation().queryByText(/Ethernet frame prepended/),
    ).not.toBeInTheDocument();
  });

  it('fills the NAT table in as the run reaches the packet that writes the row', async () => {
    render(<PacketJourneyModule />);

    const nat = within(screen.getByRole('region', { name: 'NAT translation table' }));
    expect(nat.getByText(/Empty\./)).toBeInTheDocument();

    const rows = hopTable().getAllByRole('row');
    await userEvent.click(rows[rows.length - 1]);

    expect(nat.queryByText(/Empty\./)).not.toBeInTheDocument();
    expect(nat.getByText('192.168.1.112:49152')).toBeInTheDocument();
    expect(nat.getByText('203.0.113.7:60000')).toBeInTheDocument();
  });
});
