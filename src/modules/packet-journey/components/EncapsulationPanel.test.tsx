import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { labelsFor } from '@/components/viz';

import { focusAt } from '../ledger';
import { LOSSY_LINK, TCP_WEB_REQUEST } from '../scenarios';
import { runJourneyDetailed } from '../sim/journey';

import { EncapsulationPanel } from './EncapsulationPanel';

const run = runJourneyDetailed(TCP_WEB_REQUEST);
const labels = labelsFor(TCP_WEB_REQUEST.topology);

function panelAt(virtualTime: number) {
  render(<EncapsulationPanel focus={focusAt(run.result, virtualTime)} labels={labels} />);
  return within(screen.getByRole('region', { name: 'Encapsulation' }));
}

/** The layer boxes on screen, outermost first. */
function stack(): string[] {
  return [...document.querySelectorAll('[data-protocol]')].map(
    (box) => box.getAttribute('data-protocol') ?? '',
  );
}

describe('EncapsulationPanel', () => {
  it('says so plainly when nothing has been sent yet', () => {
    render(<EncapsulationPanel focus={undefined} labels={labels} />);

    expect(screen.getByText(/Nothing has been sent yet/)).toBeInTheDocument();
  });

  it('draws the stack outermost first, and says how big the packet is', () => {
    const panel = panelAt(0);

    // The order a receiving network card reads the headers in, top to bottom.
    expect(stack()).toEqual(['Ethernet II', 'IPv4', 'TCP']);
    expect(panel.getByText('54 B')).toBeInTheDocument();
  });

  it('prints what just happened to the packet, in the engine own words', () => {
    const panel = panelAt(0);

    expect(panel.getByText('Header added')).toBeInTheDocument();
    expect(panel.getByText(/Ethernet frame prepended/)).toBeInTheDocument();
  });

  it('follows the current hop: it names the wire the packet is on', () => {
    const transmit = run.result.events.find(
      (event) => event.kind === 'transmit' && event.to === 'router',
    );
    if (transmit?.kind !== 'transmit') throw new Error('the run sent nothing');

    const panel = panelAt(transmit.at + transmit.durationMs / 2);

    expect(panel.getByText('On the wire')).toBeInTheDocument();
    // Asserted on the region's text rather than one node: the location is printed beside
    // the status, and a machine label may itself contain regex punctuation.
    expect(screen.getByRole('region', { name: 'Encapsulation' }).textContent).toContain(
      `${labels[transmit.from]} → ${labels[transmit.to]}`,
    );
  });

  /**
   * The panel's whole reason for existing: the stack has fewer boxes at the end of the
   * journey than it had at the start, because the receiver threw the outer headers away.
   */
  it('loses the frame and the packet header once the far end has stripped them', () => {
    const panel = panelAt(run.result.durationMs);

    expect(panel.getByText('Header stripped')).toBeInTheDocument();
    expect(panel.queryByText('Ethernet II')).not.toBeInTheDocument();
    expect(panel.queryByText('IPv4')).not.toBeInTheDocument();
    expect(panel.getByText('TCP')).toBeInTheDocument();
  });

  it('opens the IPv4 header by default, where the TTL is', () => {
    const panel = panelAt(0);

    expect(panel.getByRole('button', { name: /IPv4/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(panel.getByText('TTL')).toBeInTheDocument();
    expect(panel.getByRole('button', { name: /Ethernet II/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('expands a header to its fields, in wire order', async () => {
    const panel = panelAt(0);

    await userEvent.click(panel.getByRole('button', { name: /Ethernet II/ }));

    expect(panel.getByText('Destination MAC')).toBeInTheDocument();
    expect(panel.getByText('Source MAC')).toBeInTheDocument();
    expect(panel.getByText('EtherType')).toBeInTheDocument();
  });

  it('says a dropped packet was dropped, and why', () => {
    const lossy = runJourneyDetailed(LOSSY_LINK);
    const drop = lossy.result.events.find((event) => event.kind === 'drop');
    if (drop?.kind !== 'drop') throw new Error('nothing was dropped');

    render(
      <EncapsulationPanel
        focus={focusAt(lossy.result, drop.at)}
        labels={labelsFor(LOSSY_LINK.topology)}
      />,
    );

    expect(screen.getByText('Dropped')).toBeInTheDocument();
    expect(screen.getByText(/lost in transit on backbone/)).toBeInTheDocument();
  });
});
