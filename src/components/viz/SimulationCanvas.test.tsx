import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Topology } from '@/core/types/topology';

import { SimulationCanvas } from './SimulationCanvas';
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
