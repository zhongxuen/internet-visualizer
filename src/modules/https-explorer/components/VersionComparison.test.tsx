import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TLS12_FRESH, TLS13_FRESH } from '../scenarios';
import { runTlsScenario } from '../sim/connection';
import { VERSION_COMPARISON, type Tls12Handshake } from '../sim/handshake12';
import type { Tls13Handshake } from '../sim/handshake13';

import { VersionComparison } from './VersionComparison';

/**
 * The phase-09 acceptance criterion: **the 1.2 vs 1.3 comparison shows the extra round
 * trip on the timeline.**
 *
 * "On the timeline" is the load-bearing part, so the assertions are about geometry as
 * well as text: both tracks are drawn against one scale, TLS 1.2's application-data
 * marker sits to the right of TLS 1.3's, and its encryption marker does too. A table
 * saying "2 RTT versus 1 RTT" would satisfy a text-only check while showing nothing.
 */

const tls13 = runTlsScenario(TLS13_FRESH).handshake as Tls13Handshake;
const tls12 = runTlsScenario(TLS12_FRESH).handshake as Tls12Handshake;

function mount(current: 'TLS 1.2' | 'TLS 1.3' = 'TLS 1.3') {
  render(
    <VersionComparison
      tls12={tls12}
      tls13={tls13}
      rows={VERSION_COMPARISON}
      current={current}
    />,
  );
}

/** The left offset of a marker, as a percentage of the shared scale. */
function offsetOf(track: HTMLElement, title: RegExp): number {
  const marker = within(track).getAllByTitle(title).at(0)! as HTMLElement;
  return parseFloat(marker.style.left);
}

const trackFor = (version: string) =>
  within(screen.getByRole('list', { name: 'Handshake timelines' }))
    .getAllByRole('listitem')
    .find((item) => item.textContent?.startsWith(version))!;

describe('the timeline', () => {
  it('shows TLS 1.2 needing two round trips where TLS 1.3 needs one', () => {
    mount();

    expect(tls13.roundTrips).toBe(1);
    expect(tls12.roundTrips).toBe(2);
    expect(
      within(trackFor('TLS 1.3')).getByText('1 RTT before application data'),
    ).toBeInTheDocument();
    expect(
      within(trackFor('TLS 1.2')).getByText('2 RTT before application data'),
    ).toBeInTheDocument();
  });

  it('places the extra round trip as a visible gap on one shared scale', () => {
    mount();

    const ready13 = offsetOf(trackFor('TLS 1.3'), /Application data may be sent/);
    const ready12 = offsetOf(trackFor('TLS 1.2'), /Application data may be sent/);

    expect(ready12).toBeGreaterThan(ready13);
    expect(tls12.applicationDataAt - tls13.applicationDataAt).toBeGreaterThan(0);
    expect(
      screen.getByText(`${tls12.applicationDataAt - tls13.applicationDataAt} ms`),
    ).toBeInTheDocument();
  });

  it('places the moment encryption begins much later in TLS 1.2', () => {
    mount();

    const starts13 = offsetOf(trackFor('TLS 1.3'), /Encryption starts/);
    const starts12 = offsetOf(trackFor('TLS 1.2'), /Encryption starts/);

    expect(starts12).toBeGreaterThan(starts13);
  });

  it('marks which version the current run negotiated', () => {
    mount('TLS 1.2');

    expect(within(trackFor('TLS 1.2')).getByText('this run')).toBeInTheDocument();
    expect(within(trackFor('TLS 1.3')).queryByText('this run')).not.toBeInTheDocument();
  });
});

describe('the table', () => {
  it('renders every comparison row with its citation', () => {
    mount();

    for (const row of VERSION_COMPARISON) {
      const cell = screen.getByRole('rowheader', {
        name: (name: string) => name.startsWith(row.aspect),
      });
      expect(cell.textContent).toContain(`RFC ${row.reference.rfc}`);
    }
  });

  it('keeps the one row where TLS 1.3 is not simply better', () => {
    mount();

    const tradeOff = VERSION_COMPARISON.filter((row) => !row.improved);
    expect(tradeOff).toHaveLength(1);
    expect(tradeOff[0]!.aspect).toBe('Replay risk');
    expect(screen.getByText(/0-RTT early data is replayable/)).toBeInTheDocument();
  });

  it('explains forward secrecy where static RSA is named', () => {
    mount();

    expect(
      screen.getByText(/one leaked key decrypts every session ever/),
    ).toBeInTheDocument();
  });
});
