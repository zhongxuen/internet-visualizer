import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TOY_TOPOLOGY } from '@/core/sim/toyRun';

import { TopologyList } from './TopologyList';

/**
 * The canvas's second representation.
 *
 * What is asserted here is the *parity*: the list holds every machine and every link the
 * topology has, states them in words rather than in colour, and writes to the same
 * selection the diagram writes to. A list that only showed some of the network, or that a
 * keyboard could read but not act on, would satisfy the letter of "provide a list view"
 * and none of its point.
 *
 * jsdom is enough for all of it: unlike `SimulationCanvas`, nothing here is measured.
 */

function open() {
  const details = screen.getByText('Topology as a list').closest('details');
  if (!details) throw new Error('the list should be a details/summary disclosure');
  details.open = true;
}

/**
 * Queries scoped to one half of the list.
 *
 * Necessary rather than tidy: a link button names both its endpoints, so `/Laptop/`
 * matches the laptop *and* every link touching it. The section a button is in is what
 * makes "the machine called Laptop" a single element.
 */
function machines() {
  return within(screen.getByRole('heading', { name: 'Machines' }).parentElement!);
}

function links() {
  return within(screen.getByRole('heading', { name: 'Links' }).parentElement!);
}

describe('TopologyList', () => {
  it('counts the topology in its summary, before it is opened', () => {
    render(<TopologyList topology={TOY_TOPOLOGY} />);

    // Three machines and two links -- the toy run's whole network.
    expect(screen.getByText('3 machines, 2 links')).toBeInTheDocument();
  });

  it('lists every machine with its role and its addresses', () => {
    render(<TopologyList topology={TOY_TOPOLOGY} />);
    open();

    expect(machines().getAllByRole('button')).toHaveLength(TOY_TOPOLOGY.nodes.length);

    const laptop = machines().getByRole('button', { name: /Laptop/ });
    expect(laptop).toHaveTextContent('Client');
    expect(laptop).toHaveTextContent('192.168.1.24');
  });

  it('names both ends of every link, and what the hop costs', () => {
    render(<TopologyList topology={TOY_TOPOLOGY} />);
    open();

    const rows = links().getAllByRole('button');

    expect(rows).toHaveLength(TOY_TOPOLOGY.links.length);
    expect(rows[0]).toHaveTextContent('Laptop');
    expect(rows[0]).toHaveTextContent('Home router');
    expect(rows[0]).toHaveTextContent(`${TOY_TOPOLOGY.links[0]!.latencyMs} ms`);
  });

  it('says the node state in words, not only in colour', () => {
    render(<TopologyList topology={TOY_TOPOLOGY} nodeStates={{ router: 'error' }} />);
    open();

    expect(machines().getByRole('button', { name: /Home router/ })).toHaveTextContent(
      'Error',
    );
    // Anything the projection did not name is idle, and says so too.
    expect(machines().getByRole('button', { name: /Laptop/ })).toHaveTextContent('Idle');
  });

  it('selects a machine, and reports it the way the canvas does', async () => {
    const onSelect = vi.fn();
    render(<TopologyList topology={TOY_TOPOLOGY} onSelect={onSelect} />);
    open();

    await userEvent.click(machines().getByRole('button', { name: /Laptop/ }));

    expect(onSelect).toHaveBeenCalledWith({ type: 'node', id: 'laptop' });
  });

  it('marks what is selected, and clears it when it is chosen again', async () => {
    const onSelect = vi.fn();
    render(
      <TopologyList
        topology={TOY_TOPOLOGY}
        selection={{ type: 'node', id: 'laptop' }}
        onSelect={onSelect}
      />,
    );
    open();

    const laptop = machines().getByRole('button', { name: /Laptop/ });
    expect(laptop).toHaveAttribute('aria-pressed', 'true');

    // Same behaviour as clicking the pane: choosing the current selection clears it.
    await userEvent.click(laptop);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('selects a link too, so the whole topology is reachable from here', async () => {
    const onSelect = vi.fn();
    render(<TopologyList topology={TOY_TOPOLOGY} onSelect={onSelect} />);
    open();

    await userEvent.click(links().getAllByRole('button')[1]!);

    expect(onSelect).toHaveBeenCalledWith({
      type: 'link',
      id: TOY_TOPOLOGY.links[1]!.id,
    });
  });

  it('says so rather than rendering an empty list when a scenario has no links', () => {
    render(<TopologyList topology={{ nodes: TOY_TOPOLOGY.nodes, links: [] }} />);
    open();

    expect(screen.getByText(/no links/)).toBeInTheDocument();
    expect(screen.getByText('3 machines, 0 links')).toBeInTheDocument();
  });
});
