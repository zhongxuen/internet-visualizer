import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithPreferences } from '@/components/prefs/testing';
import { HOME_LAN } from '@/core/topologies';
import type { Topology } from '@/core/types/topology';

import { actionKeyOf, SimulationCanvas } from './SimulationCanvas';
import type { CanvasSelection } from './types';

/**
 * Pointer interactions go through `fireEvent.click` rather than `userEvent.click`.
 * A full pointer sequence reaches d3-zoom's `mousedown` handler on the pan surface,
 * which dereferences `event.view` -- and jsdom leaves that null, so the canvas throws
 * from inside the zoom library before React Flow ever sees the click. React Flow selects
 * on `click`, so the single event is enough to exercise what these tests are about.
 */
const TOPOLOGY: Topology = {
  nodes: [
    { id: 'client', kind: 'client', label: 'Laptop', ipv4: '192.0.2.10' },
    { id: 'gw', kind: 'router', label: 'Home router', ipv4: '192.0.2.1' },
  ],
  links: [{ id: 'lan', from: 'client', to: 'gw', latencyMs: 2, medium: 'wifi' }],
};

describe('SimulationCanvas', () => {
  it('draws every machine and every link in the topology', async () => {
    render(<SimulationCanvas topology={TOPOLOGY} />);

    expect(screen.getByTestId('rf__node-client')).toBeInTheDocument();
    expect(screen.getByTestId('rf__node-gw')).toBeInTheDocument();
    expect(await screen.findByTestId('rf__edge-lan')).toBeInTheDocument();
  });

  it('is a named region, so the diagram is findable on a page of panels', () => {
    render(<SimulationCanvas topology={TOPOLOGY} label="DNS lookup" />);

    expect(screen.getByRole('region', { name: 'DNS lookup' })).toBeInTheDocument();
  });

  it('offers pan, zoom, and fit-view as real buttons rather than gestures only', () => {
    render(<SimulationCanvas topology={TOPOLOGY} />);

    expect(screen.getByRole('button', { name: /zoom in/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /zoom out/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /fit view/i })).toBeInTheDocument();
  });

  it('reports the node a pointer selects', () => {
    const onSelect = vi.fn();
    render(<SimulationCanvas topology={TOPOLOGY} onSelect={onSelect} />);

    fireEvent.click(screen.getByTestId('rf__node-gw'));

    expect(onSelect).toHaveBeenCalledWith({ type: 'node', id: 'gw' });
  });

  it('reports the node a keyboard selects, without a pointer anywhere', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<SimulationCanvas topology={TOPOLOGY} onSelect={onSelect} />);

    screen.getByTestId('rf__node-client').focus();
    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledWith({ type: 'node', id: 'client' });
  });

  it('clears the selection on Escape', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<SimulationCanvas topology={TOPOLOGY} onSelect={onSelect} />);

    const node = screen.getByTestId('rf__node-gw');
    node.focus();
    await user.keyboard('{Enter}');
    await user.keyboard('{Escape}');

    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('holds one selection at a time across nodes and links', async () => {
    const onSelect = vi.fn();
    render(<SimulationCanvas topology={TOPOLOGY} onSelect={onSelect} />);

    const edge = await screen.findByTestId('rf__edge-lan');
    fireEvent.click(edge.querySelector('.react-flow__edge-interaction')!);
    expect(onSelect).toHaveBeenLastCalledWith({ type: 'link', id: 'lan' });

    fireEvent.click(screen.getByTestId('rf__node-gw'));

    // Selecting the node must not be undone by React Flow unselecting the edge in the
    // same tick -- the last thing the caller hears is the node.
    expect(onSelect).toHaveBeenLastCalledWith({ type: 'node', id: 'gw' });
    await waitFor(() =>
      expect(screen.getByTestId('rf__edge-lan')).not.toHaveClass('selected'),
    );
    expect(screen.getByTestId('rf__node-gw')).toHaveClass('selected');
  });

  it('honours a controlled selection instead of keeping its own', () => {
    const onSelect = vi.fn();
    const selection: CanvasSelection = { type: 'node', id: 'client' };

    render(
      <SimulationCanvas topology={TOPOLOGY} selection={selection} onSelect={onSelect} />,
    );

    expect(screen.getByTestId('rf__node-client')).toHaveClass('selected');

    fireEvent.click(screen.getByTestId('rf__node-gw'));

    // The caller is told, and nothing moves until the caller says so.
    expect(onSelect).toHaveBeenCalledWith({ type: 'node', id: 'gw' });
    expect(screen.getByTestId('rf__node-client')).toHaveClass('selected');
  });

  it('starts from defaultSelection when it owns the selection', () => {
    render(
      <SimulationCanvas
        topology={TOPOLOGY}
        defaultSelection={{ type: 'node', id: 'gw' }}
      />,
    );

    expect(screen.getByTestId('rf__node-gw')).toHaveClass('selected');
  });

  it('lays the diagram out by hop when no positions are supplied', () => {
    render(<SimulationCanvas topology={TOPOLOGY} />);

    // Client in column 0, router one hop to its right; nodes are centred on their
    // position, so the transform is offset by half the node width.
    expect(screen.getByTestId('rf__node-client')).toHaveStyle({
      transform: 'translate(-116px,-62px)',
    });
    expect(screen.getByTestId('rf__node-gw')).toHaveStyle({
      transform: 'translate(244px,-62px)',
    });
  });

  it('uses supplied positions verbatim', () => {
    render(
      <SimulationCanvas
        topology={TOPOLOGY}
        positions={{ client: { x: 0, y: 0 }, gw: { x: 0, y: 400 } }}
      />,
    );

    expect(screen.getByTestId('rf__node-gw')).toHaveStyle({
      transform: 'translate(-116px,338px)',
    });
  });

  it('never lets a user rearrange the network', () => {
    render(<SimulationCanvas topology={TOPOLOGY} />);

    expect(screen.getByTestId('rf__node-client')).not.toHaveClass('draggable');
  });
});

describe('places on the map', () => {
  it('draws each zone as a labelled backdrop, with its icon', async () => {
    render(<SimulationCanvas topology={HOME_LAN.topology} />);

    const zones = await screen.findByTestId('canvas-zones');
    const drawn = [...zones.querySelectorAll('[data-zone]')];
    expect(drawn.map((zone) => zone.getAttribute('data-zone'))).toEqual(['home', 'isp']);
    expect(drawn[0]).toHaveTextContent('Your home');
    expect(drawn[0].querySelector('svg')).not.toBeNull();
  });

  it('never makes a zone something to focus, click or count as a machine', async () => {
    render(<SimulationCanvas topology={HOME_LAN.topology} />);

    const zones = await screen.findByTestId('canvas-zones');
    expect(zones).toHaveAttribute('aria-hidden', 'true');
    expect(zones).toHaveClass('pointer-events-none');
    expect(zones.querySelector('[tabindex]')).toBeNull();
    // The diagram draws exactly the machines, and no place among them.
    expect(document.querySelectorAll('.react-flow__node')).toHaveLength(
      HOME_LAN.topology.nodes.length,
    );
  });

  it('draws no backdrop for a topology without zones', () => {
    render(<SimulationCanvas topology={TOPOLOGY} />);

    expect(screen.queryByTestId('canvas-zones')).toBeNull();
  });
});

describe('the canvas corner', () => {
  it('has a 44px camera toggle that swaps between the two framings', async () => {
    const user = userEvent.setup();
    render(<SimulationCanvas topology={TOPOLOGY} />);

    // jsdom's canvas is far too small to show even two machines readably, so once
    // measured the camera follows the action and offers the overview.
    const overview = await screen.findByRole('button', { name: 'Show whole map' });
    expect(overview).toHaveClass('h-target');
    await user.click(overview);
    const follow = await screen.findByRole('button', { name: 'Follow the action' });
    await user.click(follow);
    expect(await screen.findByRole('button', { name: 'Show whole map' })).toBeVisible();
  });

  it('has a Key that lists the places, machines, links and states this diagram uses', async () => {
    const user = userEvent.setup();
    render(<SimulationCanvas topology={HOME_LAN.topology} />);

    const trigger = screen.getByRole('button', { name: 'Key' });
    // Closed, the key is one button and nothing else.
    const panel = document.getElementById(trigger.getAttribute('aria-controls')!);
    expect(panel?.className).not.toMatch(/(^|\s)(flex|grid|block)(\s|$)/);
    expect(screen.queryByText('What the machines are doing')).toBeNull();

    await user.click(trigger);
    const key = screen.getByRole('dialog', { name: 'Key to the diagram' });
    expect(key).toHaveTextContent('Your home');
    expect(key).toHaveTextContent('Router');
    // Kinds this diagram does not draw are not listed.
    expect(key).not.toHaveTextContent('Load balancer');
    expect(key).toHaveTextContent('A packet is one small piece of a message');
    expect(key).toHaveTextContent('Wi-Fi');
    expect(key).not.toHaveTextContent('Cellular');
    // Simple by default: the plain state words.
    expect(key).toHaveTextContent('Working');
    expect(key).toHaveTextContent('Problem');

    await user.keyboard('{Escape}');
    expect(screen.queryByText('What the machines are doing')).toBeNull();
  });

  it('uses the technical words in the Key in Full detail', async () => {
    const user = userEvent.setup();
    renderWithPreferences(<SimulationCanvas topology={HOME_LAN.topology} />, {
      detail: 'full',
    });

    await user.click(screen.getByRole('button', { name: 'Key' }));
    const key = screen.getByRole('dialog', { name: 'Key to the diagram' });
    expect(key).toHaveTextContent('Error');
    expect(key).toHaveTextContent('Forwards packets between networks');
  });
});

describe('the camera', () => {
  it('frames the diagram itself once the machines are measured', async () => {
    render(<SimulationCanvas topology={HOME_LAN.topology} />);

    // A canvas far too small for the whole house resolves to following the action, and
    // the viewport has moved off React Flow's untouched identity transform.
    expect(await screen.findByRole('button', { name: 'Show whole map' })).toBeVisible();
    await waitFor(() =>
      expect(
        document.querySelector<HTMLElement>('.react-flow__viewport')?.style.transform,
      ).not.toBe('translate(0px, 0px) scale(1)'),
    );
  });
});

describe('actionKeyOf', () => {
  it('is every machine not idle, and both ends of every link a packet is on', () => {
    const key = actionKeyOf(TOPOLOGY, { gw: 'processing', client: 'idle' }, [
      {
        pduId: 'p',
        linkId: 'lan',
        from: 'gw',
        to: 'client',
        progress: 0.2,
        startMs: 0,
        durationMs: 10,
      },
    ]);
    expect(key).toBe('client,gw');
  });

  it('is empty while nothing is happening, so a quiet moment moves no camera', () => {
    expect(actionKeyOf(TOPOLOGY, { client: 'idle' }, [])).toBe('');
    expect(actionKeyOf(TOPOLOGY, undefined, undefined)).toBe('');
  });

  it('is the same string for the same set, however it was reached', () => {
    expect(actionKeyOf(TOPOLOGY, { gw: 'active', client: 'error' }, [])).toBe(
      actionKeyOf(TOPOLOGY, { client: 'active', gw: 'processing' }, []),
    );
  });
});
