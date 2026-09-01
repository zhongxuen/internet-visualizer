import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Annotation } from '@/core/sim/project';
import type { PDU } from '@/core/types/pdu';
import type { Topology } from '@/core/types/topology';

import { Inspector } from './Inspector';
import type { CanvasSelection } from './types';

/**
 * The inspector is the only surface that grows as scenarios get richer, and the rule it
 * has to keep is that it reads the domain model by value: a field the scenario did not
 * set does not appear, and nothing is inferred. These tests hold it to that, and to
 * being a navigation surface -- a topology has to be explorable from the panel alone.
 */

const TOPOLOGY: Topology = {
  nodes: [
    {
      id: 'laptop',
      kind: 'client',
      label: 'Laptop',
      ipv4: '192.0.2.10',
      mac: 'a4:83:e7:1c:9f:20',
      detail: { Gateway: '192.0.2.1' },
    },
    { id: 'router', kind: 'router', label: 'Home router', ipv4: '192.0.2.1' },
    { id: 'bare', kind: 'switch', label: 'Unmanaged switch' },
  ],
  links: [
    {
      id: 'lan',
      from: 'laptop',
      to: 'router',
      latencyMs: 3,
      bandwidthMbps: 1000,
      medium: 'wifi',
    },
    { id: 'trunk', from: 'router', to: 'bare', latencyMs: 1 },
  ],
};

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
      protocol: 'ICMP',
      fields: [{ name: 'Type', value: '8 (Echo request)', bits: 8 }],
    },
  ],
};

const ANNOTATION: Annotation = {
  id: 'annotation-3',
  targetId: 'router',
  text: 'The router decremented TTL and recomputed the header checksum.',
  reference: { rfc: 791, section: '3.2', title: 'Internet Protocol' },
  at: 20,
};

function renderInspector(
  selection: CanvasSelection | null,
  props: Partial<React.ComponentProps<typeof Inspector>> = {},
) {
  return render(
    <Inspector
      topology={TOPOLOGY}
      selection={selection}
      pdus={{ [PDU_FIXTURE.id]: PDU_FIXTURE }}
      {...props}
    />,
  );
}

const panel = () => within(screen.getByRole('region', { name: 'Inspector' }));

describe('Inspector with nothing selected', () => {
  it('invites a selection, and says both ways of making one', () => {
    renderInspector(null);

    expect(screen.getByText('Nothing selected')).toBeInTheDocument();
    expect(
      screen.getByText(/click it, or tab to it and press enter/i),
    ).toBeInTheDocument();
  });

  it('says when the selection is not part of this scenario', () => {
    renderInspector({ type: 'node', id: 'ghost' });

    expect(screen.getByText('No longer on the diagram')).toBeInTheDocument();
  });
});

describe('Inspector on a node', () => {
  it('names the machine, its role, and what its layer does', () => {
    renderInspector({ type: 'node', id: 'router' });

    expect(panel().getByText('Home router')).toBeInTheDocument();
    expect(panel().getByText('Router')).toBeInTheDocument();
    expect(panel().getByText('Routes packets')).toBeInTheDocument();
    expect(panel().getByText('Machine')).toBeInTheDocument(); // the selection kind badge
  });

  it('reports the state the projection gives it, in words as well as colour', () => {
    renderInspector({ type: 'node', id: 'router' }, { nodeStates: { router: 'error' } });

    expect(panel().getByText(/error/i)).toBeInTheDocument();
  });

  it('treats a node the projection says nothing about as idle', () => {
    renderInspector({ type: 'node', id: 'router' });

    expect(panel().getByText(/idle/i)).toBeInTheDocument();
  });

  it('prints the addresses the scenario set, and only those', () => {
    renderInspector({ type: 'node', id: 'laptop' });

    expect(panel().getByText('192.0.2.10')).toBeInTheDocument();
    expect(panel().getByText('a4:83:e7:1c:9f:20')).toBeInTheDocument();
    expect(panel().queryByText(/2001:db8/)).not.toBeInTheDocument();
  });

  it('says a machine has no addresses rather than inventing one', () => {
    renderInspector({ type: 'node', id: 'bare' });

    expect(panel().getByText(/no addresses/i)).toBeInTheDocument();
  });

  it("carries the scenario's own detail fields through verbatim", () => {
    renderInspector({ type: 'node', id: 'laptop' });

    expect(panel().getByText('Gateway')).toBeInTheDocument();
    expect(panel().getByText('192.0.2.1')).toBeInTheDocument();
  });

  it('lists what it is connected to, with the cost of each hop', () => {
    renderInspector({ type: 'node', id: 'router' });

    const links = panel().getAllByRole('button');

    expect(links.map((button) => button.textContent)).toEqual([
      expect.stringContaining('Laptop'),
      expect.stringContaining('Unmanaged switch'),
    ]);
    expect(links[0]).toHaveTextContent('3 ms');
  });

  it('moves the selection to a link the panel lists', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderInspector({ type: 'node', id: 'router' }, { onSelect });

    await user.click(panel().getByRole('button', { name: /laptop/i }));

    expect(onSelect).toHaveBeenCalledWith({ type: 'link', id: 'lan' });
  });
});

describe('Inspector on a link', () => {
  it('names both ends and the medium', () => {
    renderInspector({ type: 'link', id: 'lan' });

    expect(panel().getByText(/laptop.*home router/i)).toBeInTheDocument();
    expect(panel().getByText('Wi-Fi')).toBeInTheDocument();
  });

  it('shows the round trip as the arithmetic, not just the answer', () => {
    renderInspector({ type: 'link', id: 'lan' });

    expect(panel().getByText('3 ms')).toBeInTheDocument();
    expect(panel().getByText('3 × 2 = 6 ms')).toBeInTheDocument();
    expect(panel().getByText('1000 Mb/s')).toBeInTheDocument();
  });

  it('omits a bandwidth the scenario did not state, and says the medium is unknown', () => {
    renderInspector({ type: 'link', id: 'trunk' });

    expect(panel().queryByText(/Mb\/s/)).not.toBeInTheDocument();
    expect(
      panel().getByText(/does not say what this hop physically is/i),
    ).toBeInTheDocument();
  });

  it('moves the selection to either endpoint', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderInspector({ type: 'link', id: 'lan' }, { onSelect });

    await user.click(panel().getByRole('button', { name: 'Home router' }));

    expect(onSelect).toHaveBeenCalledWith({ type: 'node', id: 'router' });
  });
});

describe('Inspector on a packet', () => {
  it('summarises what it is and what it is carrying', () => {
    renderInspector({ type: 'pdu', id: 'echo-request' });

    expect(panel().getByText(PDU_FIXTURE.summary)).toBeInTheDocument();
    expect(panel().getByText('Ethernet II carrying ICMP')).toBeInTheDocument();
    expect(panel().getByText('98 bytes on the wire')).toBeInTheDocument();
    expect(panel().getByText('2 headers')).toBeInTheDocument();
  });

  it('opens the encapsulation stack, down to real header fields', () => {
    renderInspector({ type: 'pdu', id: 'echo-request' });

    expect(panel().getByText('Encapsulation')).toBeInTheDocument();
    expect(
      panel().getByRole('rowheader', { name: 'Destination MAC' }),
    ).toBeInTheDocument();
    expect(panel().getByText('f0:9f:c2:11:04:aa')).toBeInTheDocument();
  });
});

describe('Inspector notes', () => {
  it('pins a note to the object it is about, with its citation', () => {
    renderInspector({ type: 'node', id: 'router' }, { annotations: [ANNOTATION] });

    expect(panel().getByText(ANNOTATION.text)).toBeInTheDocument();
    expect(panel().getByText(/RFC 791 §3.2 — Internet Protocol/)).toBeInTheDocument();
  });

  it('leaves a note that is about something else where it belongs', () => {
    renderInspector({ type: 'node', id: 'laptop' }, { annotations: [ANNOTATION] });

    expect(panel().queryByText(ANNOTATION.text)).not.toBeInTheDocument();
  });
});

describe('Inspector slots', () => {
  it('appends module-specific content below the standard detail', () => {
    renderInspector(
      { type: 'node', id: 'laptop' },
      { children: <p>Cache hit ratio: 0.82</p> },
    );

    expect(panel().getByText('Cache hit ratio: 0.82')).toBeInTheDocument();
  });

  it('takes a title from the module that mounts it', () => {
    renderInspector({ type: 'node', id: 'laptop' }, { title: 'Query detail' });

    expect(screen.getByRole('region', { name: 'Query detail' })).toBeInTheDocument();
  });
});
