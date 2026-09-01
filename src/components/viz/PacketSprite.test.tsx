import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MotionProvider } from '@/components/motion';
import type { InFlightPacket } from '@/core/sim/project';
import type { PDU } from '@/core/types/pdu';
import type { Topology } from '@/core/types/topology';

import { PacketSprite } from './PacketSprite';
import { SimulationCanvas } from './SimulationCanvas';

/** Flat left-to-right curve: the point at t is easy to state by hand. */
const FLAT = 'M0,0 C0,0 100,0 100,0';
const FROM = { x: 0, y: 0 };
const TO = { x: 100, y: 0 };

const QUERY: PDU = {
  id: 'query',
  summary: 'DNS A? example.com',
  sizeBytes: 74,
  layers: [
    { layer: 'network', protocol: 'IPv4', fields: [{ name: 'TTL', value: '64' }] },
    { layer: 'application', protocol: 'DNS', fields: [] },
  ],
};

function transformOf(element: HTMLElement): string {
  return element.getAttribute('style') ?? '';
}

describe('PacketSprite', () => {
  it('places itself at the progress it is given, and nowhere else', () => {
    const { rerender } = render(
      <PacketSprite pdu={QUERY} progress={0} path={FLAT} from={FROM} to={TO} />,
    );

    const sprite = screen.getByRole('button');
    expect(transformOf(sprite)).toContain('translate(0px, 0px)');

    rerender(<PacketSprite pdu={QUERY} progress={0.5} path={FLAT} from={FROM} to={TO} />);
    expect(transformOf(sprite)).toContain('translate(50px, 0px)');

    rerender(<PacketSprite pdu={QUERY} progress={1} path={FLAT} from={FROM} to={TO} />);
    expect(transformOf(sprite)).toContain('translate(100px, 0px)');
  });

  it('owns no timer: the same props render the same position for ever', async () => {
    vi.useFakeTimers();
    try {
      render(
        <PacketSprite pdu={QUERY} progress={0.25} path={FLAT} from={FROM} to={TO} />,
      );
      const before = transformOf(screen.getByRole('button'));

      await vi.advanceTimersByTimeAsync(5_000);

      expect(transformOf(screen.getByRole('button'))).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clamps a progress outside 0..1 to the ends of the wire', () => {
    const { rerender } = render(
      <PacketSprite pdu={QUERY} progress={-2} path={FLAT} from={FROM} to={TO} />,
    );
    expect(transformOf(screen.getByRole('button'))).toContain('translate(0px, 0px)');

    rerender(<PacketSprite pdu={QUERY} progress={12} path={FLAT} from={FROM} to={TO} />);
    expect(transformOf(screen.getByRole('button'))).toContain('translate(100px, 0px)');
  });

  it('walks the path backwards for a packet travelling the other way', () => {
    render(
      <PacketSprite
        pdu={QUERY}
        progress={0.25}
        path={FLAT}
        from={FROM}
        to={TO}
        reversed
      />,
    );

    // A quarter of the way from the far end, not from the near one.
    expect(transformOf(screen.getByRole('button'))).toContain('translate(84.375px, 0px)');
  });

  it('points its arrow the way the packet is actually going', () => {
    const { rerender } = render(
      <PacketSprite pdu={QUERY} progress={0.5} path={FLAT} from={FROM} to={TO} />,
    );
    const arrow = () => screen.getByRole('button').querySelector('svg');

    expect(arrow()?.getAttribute('style')).toContain('rotate(0deg)');

    rerender(
      <PacketSprite
        pdu={QUERY}
        progress={0.5}
        path={FLAT}
        from={FROM}
        to={TO}
        reversed
      />,
    );
    expect(arrow()?.getAttribute('style')).toContain('rotate(180deg)');
  });

  it('falls back to the straight line when there is no parseable path', () => {
    render(<PacketSprite pdu={QUERY} progress={0.5} from={FROM} to={{ x: 40, y: 80 }} />);

    expect(transformOf(screen.getByRole('button'))).toContain('translate(20px, 40px)');
  });

  it('names its outermost layer with a short label as well as a colour', () => {
    render(<PacketSprite pdu={QUERY} progress={0.5} path={FLAT} from={FROM} to={TO} />);

    const sprite = screen.getByRole('button');
    expect(sprite).toHaveTextContent('L3');
    expect(sprite).toHaveTextContent('IPv4');
  });

  it('says what it is carrying, and how big it is, to a screen reader', () => {
    render(<PacketSprite pdu={QUERY} progress={0.5} path={FLAT} from={FROM} to={TO} />);

    expect(
      screen.getByRole('button', {
        name: 'DNS A? example.com. Network layer, IPv4. 74 bytes',
      }),
    ).toBeInTheDocument();
  });

  it('reports its selection state, and hands its id over when activated', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <PacketSprite
        pdu={QUERY}
        progress={0.5}
        path={FLAT}
        from={FROM}
        to={TO}
        selected
        onSelect={onSelect}
      />,
    );

    const sprite = screen.getByRole('button');
    expect(sprite).toHaveAttribute('aria-pressed', 'true');

    await user.click(sprite);
    expect(onSelect).toHaveBeenCalledWith('query');
  });

  it('is reachable and activatable by keyboard alone', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <PacketSprite
        pdu={QUERY}
        progress={0.5}
        path={FLAT}
        from={FROM}
        to={TO}
        onSelect={onSelect}
      />,
    );

    await user.tab();
    expect(screen.getByRole('button')).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('query');
  });

  it('snaps to the nearer endpoint under reduced motion, instead of hanging mid-wire', () => {
    const { rerender } = render(
      <MotionProvider defaultPreference="reduced">
        <PacketSprite pdu={QUERY} progress={0.4} path={FLAT} from={FROM} to={TO} />
      </MotionProvider>,
    );

    expect(transformOf(screen.getByRole('button'))).toContain('translate(0px, 0px)');

    rerender(
      <MotionProvider defaultPreference="reduced">
        <PacketSprite pdu={QUERY} progress={0.6} path={FLAT} from={FROM} to={TO} />
      </MotionProvider>,
    );
    expect(transformOf(screen.getByRole('button'))).toContain('translate(100px, 0px)');
  });
});

/**
 * Packets are hosted by `LinkEdge`, which is the only thing that knows the curve the link
 * was drawn with — so the wiring is exercised through the canvas, the way the node and
 * edge tests are.
 */
const TOPOLOGY: Topology = {
  nodes: [
    { id: 'client', kind: 'client', label: 'Laptop' },
    { id: 'resolver', kind: 'dns-resolver', label: 'Resolver' },
  ],
  links: [{ id: 'lan', from: 'client', to: 'resolver', latencyMs: 5 }],
};

const IN_FLIGHT: InFlightPacket[] = [
  {
    pduId: 'query',
    linkId: 'lan',
    from: 'client',
    to: 'resolver',
    progress: 0.5,
  },
];

describe('packets on the canvas', () => {
  it('draws a packet that is in flight, and nothing when the wire is quiet', async () => {
    const { rerender } = render(
      <SimulationCanvas
        topology={TOPOLOGY}
        inFlight={IN_FLIGHT}
        pdus={{ query: QUERY }}
      />,
    );

    await screen.findByRole('button', { name: /DNS A\? example\.com/ });

    rerender(
      <SimulationCanvas topology={TOPOLOGY} inFlight={[]} pdus={{ query: QUERY }} />,
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /DNS A\? example\.com/ })).toBeNull(),
    );
  });

  it('drops a packet whose PDU the run never created, rather than drawing a blank', async () => {
    render(<SimulationCanvas topology={TOPOLOGY} inFlight={IN_FLIGHT} pdus={{}} />);

    await screen.findByTestId('rf__edge-lan');
    expect(screen.queryByRole('button', { name: /DNS/ })).toBeNull();
  });

  it('selects the PDU when its chip is clicked, replacing any node selection', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <SimulationCanvas
        topology={TOPOLOGY}
        inFlight={IN_FLIGHT}
        pdus={{ query: QUERY }}
        defaultSelection={{ type: 'node', id: 'client' }}
        onSelect={onSelect}
      />,
    );

    await user.click(await screen.findByRole('button', { name: /DNS A\? example\.com/ }));

    // The exact call list, not just "was called with": the chip sits on top of the edge,
    // and a click that carried on bubbling used to select the PDU and then the link
    // underneath it -- leaving the inspector showing the wire. One click, one selection.
    expect(onSelect.mock.calls).toEqual([[{ type: 'pdu', id: 'query' }]]);
  });
});
