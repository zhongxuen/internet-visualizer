import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildToyRun, TOY_TOPOLOGY } from '@/core/sim/toyRun';

import { SimulationView } from './SimulationView';
import { usePlaybackContext, usePlaybackState } from './hooks/usePlayback';
import type { VisualizedRun } from './hooks/useSimulation';

/**
 * The phase-04 acceptance test: the toy run driven end to end through the composed view.
 *
 * Everything here goes through the same surfaces a learner does -- the keyboard map, the
 * scrubber, the phase list -- rather than through the store, because the point being
 * asserted is that the wiring holds: one number moves, and the whole picture follows it.
 */

const RUN: VisualizedRun = { topology: TOY_TOPOLOGY, result: buildToyRun() };

/** Mid-way across the first hop, where a packet is on the LAN wire. */
const MID_HOP = 13;

function renderView() {
  return render(<SimulationView simulation={RUN} />);
}

/** Where the playhead is, read the way a screen reader would read it. */
function positionMs(): number {
  const text = screen.getByRole('slider').getAttribute('aria-valuetext') ?? '';
  return Number.parseFloat(text);
}

function press(key: string, options: { shiftKey?: boolean } = {}) {
  fireEvent.keyDown(window, { key, ...options });
}

function scrubTo(time: number) {
  fireEvent.change(screen.getByRole('slider'), { target: { value: String(time) } });
}

/** The phase list, the canvas, and the log all mention the same words -- scope queries. */
function phasePanel() {
  return within(screen.getByRole('region', { name: 'Phases' }));
}

function canvas() {
  return within(screen.getByRole('region', { name: 'Network topology' }));
}

function currentPhase(): string {
  return (
    phasePanel()
      .getAllByRole('button')
      .find((button) => button.getAttribute('aria-current') === 'step')?.textContent ?? ''
  );
}

describe('SimulationView', () => {
  it('renders the whole composition from one run', () => {
    renderView();

    expect(screen.getByRole('region', { name: /topology/i })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Playback position' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.getByText('Event log')).toBeInTheDocument();
    expect(
      phasePanel().getByRole('button', { name: /Building the packet/ }),
    ).toBeInTheDocument();
  });

  it('starts at rest, at the beginning', () => {
    renderView();
    expect(positionMs()).toBe(0);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  describe('module slots', () => {
    /**
     * A module fills a slot rather than forking the layout, and slot content is rendered
     * inside `PlaybackContext` so it can read and move the playhead. Packet Journey's hop
     * table is the reason `footer` exists; this is the contract it depends on.
     */
    function Seeker() {
      const store = usePlaybackContext();
      const time = usePlaybackState(store, (state) => state.virtualTime);

      return (
        <button type="button" onClick={() => store.getState().seek(MID_HOP)}>
          footer at {time}
        </button>
      );
    }

    it('renders the footer slot and gives it the playback store', () => {
      render(<SimulationView simulation={RUN} footer={<Seeker />} />);

      const button = screen.getByRole('button', { name: /footer at/ });
      expect(button).toHaveTextContent('footer at 0');

      fireEvent.click(button);

      expect(button).toHaveTextContent(`footer at ${MID_HOP}`);
      expect(positionMs()).toBe(MID_HOP);
    });

    it('omits the footer entirely when a module passes none', () => {
      renderView();

      expect(screen.queryByRole('button', { name: /footer at/ })).not.toBeInTheDocument();
    });
  });

  describe('phase stepping', () => {
    it('walks the phase boundaries with the arrow keys', () => {
      renderView();

      press('ArrowRight');
      expect(positionMs()).toBe(10);
      expect(currentPhase()).toContain('Echo request travels');

      press('ArrowRight');
      expect(positionMs()).toBe(60);
      expect(currentPhase()).toContain('Echo reply returns');

      press('ArrowLeft');
      expect(positionMs()).toBe(10);
      expect(currentPhase()).toContain('Echo request travels');
    });

    it('steps one event at a time when Shift is held', () => {
      renderView();

      press('ArrowRight', { shiftKey: true });
      expect(positionMs()).toBe(8);

      press('ArrowRight', { shiftKey: true });
      expect(positionMs()).toBe(10);

      press('ArrowLeft', { shiftKey: true });
      expect(positionMs()).toBe(8);
    });

    it('jumps to either end of the run', () => {
      renderView();

      press('End');
      expect(positionMs()).toBe(120);
      expect(screen.getByRole('button', { name: 'Play again' })).toBeInTheDocument();

      press('Home');
      expect(positionMs()).toBe(0);
    });

    it('follows the phase list when a phase is chosen with the pointer', () => {
      renderView();

      fireEvent.click(phasePanel().getByRole('button', { name: /Echo reply returns/ }));
      expect(positionMs()).toBe(60);
    });
  });

  describe('scrubbing', () => {
    it('shows the same frame however the playhead reached a time', () => {
      renderView();

      scrubTo(MID_HOP);
      const forwards = document.body.innerHTML;

      scrubTo(110);
      scrubTo(MID_HOP);

      // Scrubbing backwards is exact: the frame is a pure function of the time, so
      // arriving from the far end of the run is indistinguishable from arriving from
      // the near one.
      expect(document.body.innerHTML).toBe(forwards);
    });

    it('puts a packet on the wire mid-hop and takes it off once the run is at rest', async () => {
      renderView();

      scrubTo(MID_HOP);
      expect(
        await canvas().findByRole('button', { name: /ICMP echo request/ }),
      ).toBeInTheDocument();

      scrubTo(120);
      expect(canvas().queryByRole('button', { name: /ICMP echo request/ })).toBeNull();
    });

    it('seeks from a line in the event log', () => {
      renderView();

      fireEvent.click(screen.getByText(/64 bytes from 198\.51\.100\.42/));
      expect(positionMs()).toBe(102);
    });
  });

  /**
   * "Clicking a packet opens its layer stack with real header fields" -- the acceptance
   * criterion, exercised the long way round: scrub until a packet is actually on the
   * wire, click the chip on the canvas, and read the header out of the inspector.
   */
  describe('inspecting a packet', () => {
    const inspector = () => within(screen.getByRole('region', { name: 'Inspector' }));

    it('starts with nothing selected', () => {
      renderView();

      expect(inspector().getByText('Nothing selected')).toBeInTheDocument();
    });

    it('opens the layer stack of the packet that was clicked', async () => {
      renderView();
      scrubTo(MID_HOP);

      fireEvent.click(await canvas().findByRole('button', { name: /ICMP echo request/ }));

      expect(
        inspector().getByText('ICMP echo request 192.168.1.24 -> 198.51.100.42'),
      ).toBeInTheDocument();
      expect(inspector().getByText('Ethernet II carrying ICMP')).toBeInTheDocument();
      expect(inspector().getByText('98 bytes on the wire')).toBeInTheDocument();
    });

    it('shows real header fields, with their widths and teaching notes', async () => {
      renderView();
      scrubTo(MID_HOP);
      fireEvent.click(await canvas().findByRole('button', { name: /ICMP echo request/ }));

      // The outermost header is open by default: the frame the receiving NIC reads first.
      expect(
        inspector().getByRole('rowheader', { name: 'Destination MAC' }),
      ).toBeInTheDocument();
      expect(inspector().getByText('f0:9f:c2:11:04:aa')).toBeInTheDocument();
      expect(inspector().getByText(/rewritten at every hop/i)).toBeInTheDocument();
    });

    it('opens an inner header on demand, down to the TTL the router will change', async () => {
      renderView();
      scrubTo(MID_HOP);
      fireEvent.click(await canvas().findByRole('button', { name: /ICMP echo request/ }));

      const ipv4 = document.querySelector<HTMLElement>('[data-protocol="IPv4"]')!;
      fireEvent.click(within(ipv4).getAllByRole('button')[0]);

      expect(inspector().getByRole('rowheader', { name: 'TTL' })).toBeInTheDocument();
      expect(inspector().getByText('64')).toBeInTheDocument();
      expect(inspector().getByText(/at zero the packet is dropped/i)).toBeInTheDocument();
    });

    it('keeps the selection while the playhead moves, and reports it gone once it is', async () => {
      renderView();
      scrubTo(MID_HOP);
      fireEvent.click(await canvas().findByRole('button', { name: /ICMP echo request/ }));

      // Selection is the viewer's, not the timeline's -- seeking must not clear it.
      scrubTo(120);

      expect(
        inspector().getByText(/ICMP echo request 192\.168\.1\.24/),
      ).toBeInTheDocument();
    });

    it('replaces a selected machine when a packet is clicked instead', async () => {
      renderView();
      fireEvent.click(canvas().getByTestId('rf__node-router'));
      expect(inspector().getByText('Home router')).toBeInTheDocument();

      scrubTo(MID_HOP);
      fireEvent.click(await canvas().findByRole('button', { name: /ICMP echo request/ }));

      expect(inspector().queryByText('Home router')).toBeNull();
      expect(inspector().getByText('Encapsulation')).toBeInTheDocument();
    });
  });

  describe('speed', () => {
    it('is set by the number keys and reflected in the control', () => {
      renderView();

      const speeds = within(screen.getByRole('group', { name: 'Playback speed' }));
      expect(speeds.getByRole('button', { name: '1x' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );

      press('5');
      expect(speeds.getByRole('button', { name: '4x' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );

      press('1');
      expect(speeds.getByRole('button', { name: '0.25x' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    it('does not move the playhead', () => {
      renderView();

      press('ArrowRight');
      press('5');
      expect(positionMs()).toBe(10);
    });
  });
});

describe('SimulationView, playing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function advance(ms: number) {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }

  it('plays forward on Space, and pauses on Space', () => {
    renderView();

    press(' ');
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();

    advance(64);
    const played = positionMs();
    expect(played).toBeGreaterThan(0);
    expect(played).toBeLessThan(120);

    press(' ');
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();

    advance(200);
    expect(positionMs()).toBe(played);
  });

  it('runs to the end and stops there', () => {
    renderView();

    press('5'); // 4x
    press(' ');
    advance(200);

    expect(positionMs()).toBe(120);
    expect(screen.getByRole('button', { name: 'Play again' })).toBeInTheDocument();
    expect(currentPhase()).toContain('Echo reply returns');
  });

  it('replays the current phase on the full stop key', () => {
    renderView();

    press('End');
    press('.');
    expect(positionMs()).toBe(60);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('pauses when a step is taken mid-playback', () => {
    renderView();

    press(' ');
    advance(32);
    press('ArrowRight');

    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    // Two frames in, the playhead is inside the second phase, so the next boundary
    // ahead of it is the third one.
    expect(positionMs()).toBe(60);
  });
});
