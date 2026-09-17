import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithPreferences } from '@/components/prefs/testing';
import type { Annotation } from '@/core/sim/project';
import { describeDuration, describeSize, fibreDistanceKm } from '@/core/text/humanScale';
import { PLAIN_KINDS } from '@/core/text/kinds';
import type { SimEvent } from '@/core/types/events';
import type { PDU } from '@/core/types/pdu';
import type { Topology } from '@/core/types/topology';

import { Inspector } from './Inspector';
import type { CanvasSelection } from './types';

/**
 * The Details panel is the only surface that grows as scenarios get richer, and the rule
 * it has to keep is that it reads the domain model by value: a field the scenario did not
 * set does not appear, and nothing is inferred. These tests hold it to that, to being a
 * navigation surface -- a topology has to be explorable from the panel alone -- and to
 * its two voices: a plain summary on top, and everything technical beneath it in a
 * disclosure that is closed and unmounted in Simple, and open in Full detail.
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
    {
      id: 'bare',
      kind: 'switch',
      label: 'Unmanaged switch',
      plainRole: 'Joins the two desks together',
    },
    { id: 'server', kind: 'server', label: 'example.com' },
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
    { id: 'wan', from: 'router', to: 'server', latencyMs: 12, medium: 'fiber' },
  ],
};

const PDU_FIXTURE: PDU = {
  id: 'echo-request',
  sizeBytes: 98,
  summary: 'ICMP echo request 192.0.2.10 -> 198.51.100.42',
  plainLabel: 'Are you there?',
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

const EVENTS: SimEvent[] = [
  {
    kind: 'transmit',
    at: 0,
    pduId: 'echo-request',
    from: 'laptop',
    to: 'router',
    durationMs: 3,
    linkId: 'lan',
  },
  {
    kind: 'transmit',
    at: 3,
    pduId: 'echo-request',
    from: 'router',
    to: 'server',
    durationMs: 12,
    linkId: 'wan',
  },
];

const ANNOTATION: Annotation = {
  id: 'annotation-3',
  targetId: 'router',
  text: 'The router decremented TTL and recomputed the header checksum.',
  reference: { rfc: 791, section: '3.2', title: 'Internet Protocol' },
  at: 20,
};

const PLAIN_NOTE = { ...ANNOTATION, plain: 'One hop of the journey is used up here.' };

type Props = Partial<React.ComponentProps<typeof Inspector>>;

function ui(selection: CanvasSelection | null, props: Props = {}) {
  return (
    <Inspector
      topology={TOPOLOGY}
      selection={selection}
      pdus={{ [PDU_FIXTURE.id]: PDU_FIXTURE }}
      {...props}
    />
  );
}

/** Simple detail: what jsdom and a fresh browser both start in. */
function renderSimple(selection: CanvasSelection | null, props: Props = {}) {
  return render(ui(selection, props));
}

function renderFull(selection: CanvasSelection | null, props: Props = {}) {
  return renderWithPreferences(ui(selection, props), { detail: 'full' });
}

const panel = () => within(screen.getByRole('region', { name: 'Details' }));

function technical() {
  return panel().getByText('Technical details').closest('details')!;
}

describe('Details with nothing selected', () => {
  it('is a named landmark, and says how to fill it without position or colour', () => {
    renderSimple(null);

    expect(screen.getByRole('region', { name: 'Details' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Click anything on the map (a device, a cable, or a moving message) to see what it is.',
      ),
    ).toBeInTheDocument();
  });

  it('says when the selection is not part of this scenario', () => {
    renderSimple({ type: 'node', id: 'ghost' });

    expect(screen.getByText('No longer on the map')).toBeInTheDocument();
  });
});

describe('Details: the technical disclosure', () => {
  it('is closed in Simple, with nothing technical mounted', () => {
    renderSimple({ type: 'node', id: 'laptop' });

    expect(technical()).not.toHaveAttribute('open');
    expect(panel().queryByText('192.0.2.10')).not.toBeInTheDocument();
    expect(panel().queryByText('Gateway')).not.toBeInTheDocument();
  });

  it('is open by default in Full detail', () => {
    renderFull({ type: 'node', id: 'laptop' });

    expect(technical()).toHaveAttribute('open');
    expect(panel().getByText('192.0.2.10')).toBeInTheDocument();
  });

  it('opens on demand in Simple', async () => {
    const user = userEvent.setup();
    renderSimple({ type: 'node', id: 'laptop' });

    await user.click(panel().getByText('Technical details'));

    expect(panel().getByText('192.0.2.10')).toBeInTheDocument();
  });
});

describe('Details on a machine, in plain words', () => {
  it("names it, and says what it is for with its kind's analogy", () => {
    renderSimple({ type: 'node', id: 'router' });

    expect(panel().getByText('Home router')).toBeInTheDocument();
    expect(
      panel().getByText(
        `${PLAIN_KINDS.router.plainRole}, like ${PLAIN_KINDS.router.analogy}.`,
      ),
    ).toBeInTheDocument();
    expect(panel().getByText('Machine')).toBeInTheDocument(); // the selection kind badge
  });

  it("prefers the machine's own plain role to its kind's", () => {
    renderSimple({ type: 'node', id: 'bare' });

    expect(panel().getByText('Joins the two desks together.')).toBeInTheDocument();
    expect(panel().queryByText(/mail room/)).not.toBeInTheDocument();
  });

  it('says what it is doing now, in words as well as colour', () => {
    renderSimple({ type: 'node', id: 'router' }, { nodeStates: { router: 'error' } });

    expect(panel().getByText('Error')).toBeInTheDocument();
    expect(panel().getByText('something failed here.')).toBeInTheDocument();
  });

  it('treats a node the projection says nothing about as idle', () => {
    renderSimple({ type: 'node', id: 'router' });

    expect(panel().getByText('Idle')).toBeInTheDocument();
  });

  it('lists what it is connected to, with each delay on a human scale', () => {
    renderSimple({ type: 'node', id: 'router' });

    const links = panel()
      .getAllByRole('button')
      .filter((button) => button.textContent?.startsWith('Connected to'));

    expect(links.map((button) => button.textContent)).toEqual([
      `Connected to Laptop, about 3 ms away (${describeDuration(3)})`,
      `Connected to Unmanaged switch, about 1 ms away (${describeDuration(1)})`,
      `Connected to example.com, about 12 ms away (${describeDuration(12)})`,
    ]);
  });

  it('moves the selection to a link the panel lists', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderSimple({ type: 'node', id: 'router' }, { onSelect });

    await user.click(panel().getByRole('button', { name: /connected to laptop/i }));

    expect(onSelect).toHaveBeenCalledWith({ type: 'link', id: 'lan' });
  });
});

describe('Details on a machine, technically', () => {
  it('names its role and what its layer does', () => {
    renderFull({ type: 'node', id: 'router' });

    expect(panel().getByText('Router')).toBeInTheDocument();
    expect(panel().getByText('Routes packets')).toBeInTheDocument();
  });

  it('prints the addresses the scenario set, and only those', () => {
    renderFull({ type: 'node', id: 'laptop' });

    expect(panel().getByText('192.0.2.10')).toBeInTheDocument();
    expect(panel().getByText('a4:83:e7:1c:9f:20')).toBeInTheDocument();
    expect(panel().queryByText(/2001:db8/)).not.toBeInTheDocument();
  });

  it('says a machine has no addresses rather than inventing one', () => {
    renderFull({ type: 'node', id: 'bare' });

    expect(panel().getByText(/no addresses/i)).toBeInTheDocument();
  });

  it("carries the scenario's own detail fields through verbatim", () => {
    renderFull({ type: 'node', id: 'laptop' });

    expect(panel().getByText('Gateway')).toBeInTheDocument();
    expect(panel().getByText('192.0.2.1')).toBeInTheDocument();
  });

  it('lists its links with the cost of each hop', () => {
    renderFull({ type: 'node', id: 'router' });

    const section = within(
      panel().getByRole('heading', { name: 'Links' }).parentElement!,
    );
    const rows = section.getAllByRole('listitem');

    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Laptop'),
      expect.stringContaining('Unmanaged switch'),
      expect.stringContaining('example.com'),
    ]);
    expect(rows[0]).toHaveTextContent('3 ms');
  });
});

describe('Details on a link', () => {
  it('names both ends and the medium in plain words, with the delay on a human scale', () => {
    renderSimple({ type: 'link', id: 'lan' });

    expect(panel().getByText(/laptop.*home router/i)).toBeInTheDocument();
    expect(panel().getByText(/^Wi-Fi: radio waves/)).toBeInTheDocument();
    expect(
      panel().getByText(`A message takes 3 ms to cross it: ${describeDuration(3)}.`),
    ).toBeInTheDocument();
  });

  it('turns a fibre delay into a rough distance, and only on fibre', () => {
    renderSimple({ type: 'link', id: 'wan' });

    expect(fibreDistanceKm(12)).toMatch(/^roughly /);
    expect(panel().getByText(new RegExp(fibreDistanceKm(12)))).toBeInTheDocument();
  });

  it('draws no distance for a road that is not fibre', () => {
    renderSimple({ type: 'link', id: 'lan' });

    expect(panel().queryByText(/km of cable/)).not.toBeInTheDocument();
  });

  it('shows the round trip as the arithmetic, not just the answer', () => {
    renderFull({ type: 'link', id: 'lan' });

    expect(panel().getByText('Wi-Fi')).toBeInTheDocument();
    expect(panel().getByText('3 ms')).toBeInTheDocument();
    expect(panel().getByText('3 × 2 = 6 ms')).toBeInTheDocument();
    expect(panel().getByText('1000 Mb/s')).toBeInTheDocument();
  });

  it('omits a bandwidth the scenario did not state, and says the medium is unknown', () => {
    renderFull({ type: 'link', id: 'trunk' });

    expect(panel().queryByText(/Mb\/s/)).not.toBeInTheDocument();
    expect(
      panel().getByText(/does not say what this hop physically is/i),
    ).toBeInTheDocument();
    expect(panel().getByText(/doesn't say what kind of connection/i)).toBeInTheDocument();
  });

  it('moves the selection to either endpoint', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderSimple({ type: 'link', id: 'lan' }, { onSelect });

    await user.click(panel().getByRole('button', { name: 'Home router' }));

    expect(onSelect).toHaveBeenCalledWith({ type: 'node', id: 'router' });
  });
});

describe('Details on a packet', () => {
  it('says what it is for, who sends it to whom by name, and how big it is', () => {
    renderSimple({ type: 'pdu', id: 'echo-request' }, { events: EVENTS });

    expect(panel().getByText('Are you there?')).toBeInTheDocument();
    expect(panel().getByText('From Laptop to example.com.')).toBeInTheDocument();
    expect(panel().getByText(`Size: ${describeSize(98)}.`)).toBeInTheDocument();
  });

  it('leaves the route out when it was given no events to read it from', () => {
    renderSimple({ type: 'pdu', id: 'echo-request' });

    expect(panel().queryByText(/^From /)).not.toBeInTheDocument();
  });

  it('draws its envelopes, outermost first', () => {
    renderSimple({ type: 'pdu', id: 'echo-request' });

    const envelopes = panel()
      .getAllByRole('button')
      .filter((button) => /^Envelope \d/.test(button.textContent ?? ''));
    expect(envelopes.map((button) => button.textContent)).toEqual([
      expect.stringMatching(/^Envelope 1.*Ethernet II/),
      expect.stringMatching(/^Envelope 2.*ICMP/),
    ]);
  });

  it('summarises what it is and what it is carrying, technically', () => {
    renderFull({ type: 'pdu', id: 'echo-request' });

    expect(panel().getByText(PDU_FIXTURE.summary)).toBeInTheDocument();
    expect(panel().getByText('Ethernet II carrying ICMP')).toBeInTheDocument();
    expect(panel().getByText('98 bytes on the wire')).toBeInTheDocument();
    expect(panel().getByText('2 headers')).toBeInTheDocument();
  });

  it('opens the encapsulation stack, down to real header fields', () => {
    renderFull({ type: 'pdu', id: 'echo-request' });

    expect(panel().getByText('Encapsulation')).toBeInTheDocument();
    expect(
      panel().getByRole('rowheader', { name: 'Destination MAC' }),
    ).toBeInTheDocument();
    expect(panel().getByText('f0:9f:c2:11:04:aa')).toBeInTheDocument();
  });
});

describe('Details notes', () => {
  it('shows the plain sentence up top, and the technical text with its citation beneath', () => {
    renderFull({ type: 'node', id: 'router' }, { annotations: [PLAIN_NOTE] });

    expect(panel().getByText(PLAIN_NOTE.plain)).toBeInTheDocument();
    const inside = within(technical());
    expect(inside.getByText(ANNOTATION.text)).toBeInTheDocument();
    expect(inside.getByText(/RFC 791 §3.2 — Internet Protocol/)).toBeInTheDocument();
  });

  it('keeps the citation out of Simple until the disclosure is opened', () => {
    renderSimple({ type: 'node', id: 'router' }, { annotations: [PLAIN_NOTE] });

    expect(panel().getByText(PLAIN_NOTE.plain)).toBeInTheDocument();
    expect(panel().queryByText(ANNOTATION.text)).not.toBeInTheDocument();
    expect(panel().queryByText(/RFC 791/)).not.toBeInTheDocument();
  });

  it('falls back to the technical text when a note has no plain sentence', () => {
    renderSimple({ type: 'node', id: 'router' }, { annotations: [ANNOTATION] });

    expect(panel().getByText(ANNOTATION.text)).toBeInTheDocument();
  });

  it('leaves a note that is about something else where it belongs', () => {
    renderFull({ type: 'node', id: 'laptop' }, { annotations: [ANNOTATION] });

    expect(panel().queryByText(ANNOTATION.text)).not.toBeInTheDocument();
  });
});

describe('Details slots', () => {
  it('appends module-specific content below the standard detail', () => {
    renderSimple(
      { type: 'node', id: 'laptop' },
      { children: <p>Cache hit ratio: 0.82</p> },
    );

    expect(panel().getByText('Cache hit ratio: 0.82')).toBeInTheDocument();
  });

  it('takes a title from the module that mounts it', () => {
    renderSimple({ type: 'node', id: 'laptop' }, { title: 'Query detail' });

    expect(screen.getByRole('region', { name: 'Query detail' })).toBeInTheDocument();
  });
});
