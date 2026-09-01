import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import {
  createPlaybackStore,
  PlaybackContext,
  usePlaybackContext,
  usePlaybackState,
  type CanvasSelection,
} from '@/components/viz';
import { timelineFrom } from '@/core/sim/playback';
import { HOME_LAN, noteFor } from '@/core/topologies';

import { buildTour, tourStepFor } from '../tour';

import { NodeDetailTab } from './NodeDetailTab';

const TOUR = buildTour(HOME_LAN);

/** Subscribes, so a seek from the tab actually shows up here. */
function Playhead() {
  const store = usePlaybackContext();
  const virtualTime = usePlaybackState(store, (state) => state.virtualTime);
  return <output data-testid="time">{virtualTime}</output>;
}

function Harness({ selection }: { selection: CanvasSelection | null }) {
  const [store] = useState(() => createPlaybackStore(timelineFrom(TOUR.result)));

  return (
    <PlaybackContext value={store}>
      <NodeDetailTab scenario={HOME_LAN} selection={selection} tour={TOUR} />
      <Playhead />
    </PlaybackContext>
  );
}

describe('NodeDetailTab', () => {
  it('prints the scenario note for the selected machine', () => {
    render(<Harness selection={{ type: 'node', id: 'router' }} />);

    expect(screen.getByText(noteFor(HOME_LAN, 'router')!.text)).toBeInTheDocument();
  });

  it('prints the note for a selected hop too', () => {
    render(<Harness selection={{ type: 'link', id: 'access-uplink' }} />);

    expect(
      screen.getByText(noteFor(HOME_LAN, 'access-uplink')!.text),
    ).toBeInTheDocument();
  });

  /**
   * The citation is what makes a claim checkable, so it is printed rather than hidden --
   * and an RFC is free and permanently addressable, so it is a link.
   */
  it('links an RFC citation', () => {
    render(<Harness selection={{ type: 'node', id: 'router' }} />);

    const link = screen.getByRole('link', { name: /RFC 3022/ });
    expect(link).toHaveAttribute('href', expect.stringContaining('rfc3022'));
  });

  /** IEEE and ITU-T documents are paywalled, so a link would be a dead end. */
  it('prints a non-RFC citation as plain text', () => {
    render(<Harness selection={{ type: 'node', id: 'lan-switch' }} />);

    expect(screen.getByText('IEEE 802.1D')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /IEEE/ })).toBeNull();
  });

  it('offers the stop on the tour that explains this machine', async () => {
    render(<Harness selection={{ type: 'node', id: 'modem' }} />);

    const step = tourStepFor(TOUR, 'modem')!;
    await userEvent.click(screen.getByRole('button', { name: /Go to this stop/ }));

    expect(screen.getByTestId('time')).toHaveTextContent(String(step.startMs));
  });

  it('renders nothing when nothing is selected', () => {
    const { container } = render(<Harness selection={null} />);

    expect(container.querySelector('section')).toBeNull();
  });

  /** The map draws no traffic, so a packet is never the thing being inspected here. */
  it('renders nothing for a packet', () => {
    const { container } = render(<Harness selection={{ type: 'pdu', id: 'whatever' }} />);

    expect(container.querySelector('section')).toBeNull();
  });
});
