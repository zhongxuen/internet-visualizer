import { cleanup, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TCP_WEB_REQUEST } from '../scenarios';
import { runJourneyDetailed } from '../sim/journey';

import { NatTable } from './NatTable';

const run = runJourneyDetailed(TCP_WEB_REQUEST);

/** The run's table, or a failure -- a scenario with a NAT that produced none is a bug. */
function natTable() {
  if (!run.natTable) {
    throw new Error('the TCP scenario crosses a NAT and must produce a table');
  }
  return run.natTable;
}

const table = natTable();
const binding = table.bindings[0];

function setup(virtualTime: number) {
  render(
    <NatTable
      table={table}
      routerLabel="Home router (NAPT)"
      virtualTime={virtualTime}
      durationMs={run.result.durationMs}
    />,
  );
  return within(screen.getByRole('region', { name: 'NAT translation table' }));
}

describe('NatTable', () => {
  it('is empty until the first packet out of the house has written a row', () => {
    const panel = setup(0);

    expect(panel.getByText(/Empty\./)).toBeInTheDocument();
    expect(panel.queryByText('192.168.1.112:49152')).not.toBeInTheDocument();
  });

  it('shows the row from the moment the outgoing packet created it', () => {
    const panel = setup(binding.createdAt);

    expect(panel.getByText('192.168.1.112:49152')).toBeInTheDocument();
    expect(panel.getByText('203.0.113.7:60000')).toBeInTheDocument();
    expect(panel.getByText('192.0.2.80:80')).toBeInTheDocument();
    expect(panel.getByText('tcp')).toBeInTheDocument();
  });

  /**
   * The row is what makes the return path possible, so a table that showed every row it
   * would ever hold from the start would be showing the answer before the question.
   */
  it('does not show a row before the packet that creates it', () => {
    const panel = setup(binding.createdAt - 0.001);

    expect(panel.queryByText('203.0.113.7:60000')).not.toBeInTheDocument();
  });

  it('fills in "last used" only once the playhead has reached it', () => {
    const early = setup(binding.createdAt);
    expect(early.getByText('only the packet that made it')).toBeInTheDocument();

    cleanup();

    const late = setup(run.result.durationMs);
    expect(late.queryByText('only the packet that made it')).not.toBeInTheDocument();
  });

  it('names the router and the one public address it translates onto', () => {
    const panel = setup(binding.createdAt);

    // The public address appears in the header, in the caption, and in the row -- which
    // is the point: one address, and a table to tell the machines behind it apart.
    expect(panel.getByText(/Home router \(NAPT\)/)).toBeInTheDocument();
    expect(panel.getAllByText(/203\.0\.113\.7/).length).toBeGreaterThan(1);
  });
});
