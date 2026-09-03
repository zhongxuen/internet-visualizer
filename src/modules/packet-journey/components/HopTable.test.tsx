import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { formatTimecode, labelsFor } from '@/components/viz';

import { buildLedger, type HopRow } from '../ledger';
import { TCP_WEB_REQUEST } from '../scenarios';
import { runJourneyDetailed } from '../sim/journey';

import { HopTable } from './HopTable';

const run = runJourneyDetailed(TCP_WEB_REQUEST);
const rows = buildLedger(run.result, TCP_WEB_REQUEST.topology);
const labels = labelsFor(TCP_WEB_REQUEST.topology);

function setup(virtualTime = 0, tableRows: readonly HopRow[] = rows) {
  const onSeek = vi.fn();

  render(
    <HopTable
      rows={tableRows}
      virtualTime={virtualTime}
      durationMs={run.result.durationMs}
      onSeek={onSeek}
      labels={labels}
    />,
  );

  return { onSeek };
}

/**
 * One hop's seek button, by its full accessible name.
 *
 * An exact name rather than a pattern: hop numbers restart per packet, so `hop 2` alone
 * matches a dozen rows, and a machine label like `Home router (NAPT)` is not a safe
 * regular expression.
 */
function seekButtonFor(row: HopRow): HTMLElement {
  return screen.getByRole('button', {
    name: `Seek to ${row.summary}, hop ${row.hop}: ${labels[row.from]} to ${labels[row.to]} at ${formatTimecode(row.at, run.result.durationMs)}`,
  });
}

/** The data row for one hop. */
function rowFor(row: HopRow): HTMLElement {
  const tr = seekButtonFor(row).closest('tr');
  if (!tr) throw new Error('the seek button is not in a row');
  return tr;
}

describe('HopTable', () => {
  it('has a row per hop and names both ends of it', () => {
    setup();

    const first = rows[0];
    const cells = within(rowFor(first)).getAllByRole('cell');

    expect(cells[2].textContent).toContain('Laptop → Home router (NAPT)');
    expect(cells[3]).toHaveTextContent('64');
  });

  it('names the layer-2 devices the frame passed through, and says they changed nothing', () => {
    setup();

    expect(
      within(rowFor(rows[0])).getByText(/via Wi-Fi access point, LAN switch — unchanged/),
    ).toBeInTheDocument();
  });

  it('prints the addressing the packet actually carried', () => {
    setup();

    const cells = within(rowFor(rows[0])).getAllByRole('cell');

    expect(cells[5].textContent).toContain('192.168.1.112:49152');
    expect(cells[5].textContent).toContain('192.0.2.80:80');
  });

  it('shows what changed at the hop, and marks the first hop as having no previous', () => {
    setup();

    expect(within(rowFor(rows[0])).getByText('first hop')).toBeInTheDocument();

    // The hop the home router sends the first packet onto: the one place on the path an
    // address changes, alongside the TTL and checksum every router touches.
    const translated = rows.find((row) => row.pduId === rows[0].pduId && row.hop === 2);
    if (!translated) throw new Error('the first packet never left the house');
    const changed = within(rowFor(translated));

    expect(
      changed.getByText('NAT: source 192.168.1.112:49152 → 203.0.113.7:60000'),
    ).toBeInTheDocument();
    expect(changed.getByText('TTL 64 → 63')).toBeInTheDocument();
    expect(changed.getByText(/Checksum recomputed/)).toBeInTheDocument();
  });

  it('seeks the timeline when a row button is used', async () => {
    const { onSeek } = setup();

    await userEvent.click(seekButtonFor(rows[1]));

    expect(onSeek).toHaveBeenCalledWith(rows[1].at);
  });

  it('seeks when the row itself is clicked', async () => {
    const { onSeek } = setup();

    await userEvent.click(rowFor(rows[0]));

    expect(onSeek).toHaveBeenCalledWith(rows[0].at);
  });

  it('marks the hop under the playhead, and only that one', () => {
    setup(rows[2].at);

    const current = screen
      .getAllByRole('row')
      .filter((row) => row.getAttribute('aria-current') === 'true');

    expect(current).toHaveLength(1);
    expect(current[0]).toBe(rowFor(rows[2]));
  });

  it('keeps hops the playhead has not reached on screen', () => {
    setup(rows[0].at);

    // Still rendered, still clickable: the ledger is an index into the run, not a log
    // that grows a line at a time.
    expect(rowFor(rows[rows.length - 1])).toBeInTheDocument();
  });

  it('says so when the run put nothing on a wire', () => {
    setup(0, []);

    expect(screen.getByText(/never put a packet on a wire/)).toBeInTheDocument();
  });
});
