import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { PDU } from '@/core/types/pdu';

import { PacketLayerStack } from './PacketLayerStack';

/**
 * Encapsulation is the claim this component makes, so nesting is what is asserted: the
 * IPv4 box has to be *inside* the Ethernet box in the DOM, not merely after it, because
 * "inside" is the whole idea a flat list of protocol names would lose.
 */

const PDU_FIXTURE: PDU = {
  id: 'echo-request',
  sizeBytes: 98,
  summary: 'ICMP echo request 192.0.2.10 -> 198.51.100.42',
  layers: [
    {
      layer: 'link',
      protocol: 'Ethernet II',
      fields: [{ name: 'Destination MAC', value: 'f0:9f:c2:11:04:aa', bits: 48 }],
    },
    {
      layer: 'network',
      protocol: 'IPv4',
      fields: [
        { name: 'TTL', value: '64', bits: 8, note: 'Every router subtracts one.' },
        { name: 'Source', value: '192.0.2.10', bits: 32 },
      ],
    },
    {
      layer: 'network',
      protocol: 'ICMP',
      fields: [{ name: 'Type', value: '8 (Echo request)', bits: 8 }],
      payloadPreview: '56 bytes of timestamp and padding',
    },
  ],
};

const box = (protocol: string) =>
  document.querySelector<HTMLElement>(`[data-protocol="${protocol}"]`)!;

const toggle = (protocol: string) => within(box(protocol)).getAllByRole('button')[0];

describe('PacketLayerStack', () => {
  it('lists every layer, outermost first', () => {
    render(<PacketLayerStack pdu={PDU_FIXTURE} />);

    expect(
      [...document.querySelectorAll('[data-protocol]')].map((node) =>
        node.getAttribute('data-protocol'),
      ),
    ).toEqual(['Ethernet II', 'IPv4', 'ICMP']);
  });

  it('nests each layer inside the one that encapsulates it', () => {
    render(<PacketLayerStack pdu={PDU_FIXTURE} />);

    expect(box('Ethernet II')).toContainElement(box('IPv4'));
    expect(box('IPv4')).toContainElement(box('ICMP'));
  });

  it('numbers the layers and counts their fields', () => {
    render(<PacketLayerStack pdu={PDU_FIXTURE} />);

    expect(toggle('IPv4')).toHaveTextContent('2');
    expect(toggle('IPv4')).toHaveTextContent('2 fields');
    expect(toggle('ICMP')).toHaveTextContent('1 field');
  });

  it('says which layer nothing else is wrapped inside', () => {
    render(<PacketLayerStack pdu={PDU_FIXTURE} />);

    expect(box('ICMP')).toHaveTextContent(/innermost/i);
    expect(box('Ethernet II')).not.toHaveTextContent(/^Innermost/);
  });

  it('opens the outermost header by default and leaves the rest closed', () => {
    render(<PacketLayerStack pdu={PDU_FIXTURE} />);

    expect(toggle('Ethernet II')).toHaveAttribute('aria-expanded', 'true');
    expect(toggle('IPv4')).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.getByRole('rowheader', { name: 'Destination MAC' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('rowheader', { name: 'TTL' })).not.toBeInTheDocument();
  });

  it('expands a layer into its header fields on demand', async () => {
    const user = userEvent.setup();
    render(<PacketLayerStack pdu={PDU_FIXTURE} />);

    await user.click(toggle('IPv4'));

    expect(toggle('IPv4')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('rowheader', { name: 'TTL' })).toBeInTheDocument();
    expect(screen.getByText('64')).toBeInTheDocument();
    expect(screen.getByText(/every router subtracts one/i)).toBeInTheDocument();
  });

  it('unmounts a collapsed header rather than hiding it', async () => {
    const user = userEvent.setup();
    render(<PacketLayerStack pdu={PDU_FIXTURE} />);

    await user.click(toggle('Ethernet II'));

    expect(
      screen.queryByRole('rowheader', { name: 'Destination MAC' }),
    ).not.toBeInTheDocument();
  });

  it('points each toggle at the panel it controls', async () => {
    const user = userEvent.setup();
    render(<PacketLayerStack pdu={PDU_FIXTURE} />);
    await user.click(toggle('IPv4'));

    const controls = toggle('IPv4').getAttribute('aria-controls');

    expect(controls).toBeTruthy();
    expect(document.getElementById(controls!)).toContainElement(
      screen.getByRole('rowheader', { name: 'TTL' }),
    );
  });

  it('shows a payload excerpt when the layer carries one', async () => {
    const user = userEvent.setup();
    render(<PacketLayerStack pdu={PDU_FIXTURE} />);

    await user.click(toggle('ICMP'));

    expect(screen.getByText('56 bytes of timestamp and padding')).toBeInTheDocument();
  });

  it('honours an explicit set of open layers', () => {
    render(<PacketLayerStack pdu={PDU_FIXTURE} defaultExpanded={[]} />);

    expect(toggle('Ethernet II')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('says so plainly when a PDU carries no layers', () => {
    render(<PacketLayerStack pdu={{ ...PDU_FIXTURE, layers: [] }} />);

    expect(screen.getByText(/no protocol layers/i)).toBeInTheDocument();
    expect(document.querySelector('[data-protocol]')).toBeNull();
  });
});
