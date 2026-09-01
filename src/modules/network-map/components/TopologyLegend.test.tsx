import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DATACENTER, HOME_LAN } from '@/core/topologies';

import { TopologyLegend } from './TopologyLegend';

describe('TopologyLegend', () => {
  it('captions the scenario in front of you, not the whole kind table', () => {
    render(<TopologyLegend topology={HOME_LAN.topology} defaultOpen />);

    expect(screen.getByText('Router')).toBeInTheDocument();
    expect(screen.getByText('Switch')).toBeInTheDocument();
    expect(screen.getByText('Client')).toBeInTheDocument();
    // No load balancer in a house, so no load balancer in its legend.
    expect(screen.queryByText('Load balancer')).toBeNull();
  });

  it('lists a kind once however many of them are on the diagram', () => {
    render(<TopologyLegend topology={HOME_LAN.topology} defaultOpen />);

    // Three clients and three switches in the home LAN.
    expect(screen.getAllByText('Client')).toHaveLength(1);
    expect(screen.getAllByText('Switch')).toHaveLength(1);
  });

  it('names the media the scenario actually uses', () => {
    render(<TopologyLegend topology={HOME_LAN.topology} defaultOpen />);

    expect(screen.getByText('Wi-Fi')).toBeInTheDocument();
    expect(screen.getByText('Ethernet')).toBeInTheDocument();
    expect(screen.getByText('Fiber')).toBeInTheDocument();
    expect(screen.queryByText('Cellular')).toBeNull();
  });

  /** Colour is spent on the OSI layer, and the layer always prints its `L2`..`L7` too. */
  it('gives every machine its layer in words as well as in colour', () => {
    render(<TopologyLegend topology={HOME_LAN.topology} defaultOpen />);

    expect(screen.getByText('Forwards frames')).toBeInTheDocument();
    expect(screen.getByText('Routes packets')).toBeInTheDocument();
  });

  it('summarises itself while collapsed', () => {
    render(<TopologyLegend topology={DATACENTER.topology} />);

    expect(screen.getByText(/kinds of machine/)).toBeInTheDocument();
  });
});
