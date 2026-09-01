import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { MotionProvider } from '@/components/motion';
import { createPlaybackStore, PlaybackContext } from '@/components/viz';
import { HOME_LAN } from '@/core/topologies';
import { timelineFrom } from '@/core/sim/playback';

import { buildTour, TOUR_STEP_MS, type TourStep } from '../tour';

import { GuidedTour } from './GuidedTour';

const TOUR = buildTour(HOME_LAN);

/**
 * The switch is controlled by the module, so the test has to hold that state for it --
 * otherwise turning the tour on would never actually turn it on and the follow effect
 * would never run.
 */
function Harness({
  onStep = vi.fn(),
  reduced = false,
}: {
  onStep?: (step: TourStep) => void;
  reduced?: boolean;
}) {
  const [store] = useState(() => createPlaybackStore(timelineFrom(TOUR.result)));
  const [following, setFollowing] = useState(false);

  return (
    <MotionProvider defaultPreference={reduced ? 'reduced' : 'full'}>
      <PlaybackContext value={store}>
        <GuidedTour
          tour={TOUR}
          following={following}
          onFollowingChange={setFollowing}
          onStep={onStep}
        />
        <button type="button" onClick={() => store.getState().seek(TOUR_STEP_MS * 2)}>
          seek to the third stop
        </button>
        <output data-testid="status">{store.getState().status}</output>
      </PlaybackContext>
    </MotionProvider>
  );
}

describe('GuidedTour', () => {
  it('opens on the first stop without following it', () => {
    render(<Harness />);

    expect(screen.getByRole('switch', { name: 'Guided tour' })).not.toBeChecked();
    expect(screen.getByText(`Stop 1/${TOUR.steps.length}`)).toBeInTheDocument();
    expect(screen.getByText('Laptop')).toBeInTheDocument();
  });

  it('follows the playhead once it is switched on', async () => {
    const onStep = vi.fn();
    render(<Harness onStep={onStep} />);

    await userEvent.click(screen.getByRole('switch', { name: 'Guided tour' }));

    expect(screen.getByRole('switch', { name: 'Guided tour' })).toBeChecked();
    expect(onStep).toHaveBeenLastCalledWith(
      expect.objectContaining({ index: 0, target: { type: 'node', id: 'laptop' } }),
    );
  });

  it('reports each new stop, so the map can select and frame it', async () => {
    const onStep = vi.fn();
    render(<Harness onStep={onStep} />);

    await userEvent.click(screen.getByRole('switch', { name: 'Guided tour' }));
    onStep.mockClear();

    await userEvent.click(screen.getByRole('button', { name: /third stop/ }));

    expect(screen.getByText(`Stop 3/${TOUR.steps.length}`)).toBeInTheDocument();
    expect(onStep).toHaveBeenCalledTimes(1);
    expect(onStep).toHaveBeenLastCalledWith(expect.objectContaining({ index: 2 }));
  });

  it('says nothing while it is off, however far the playhead moves', async () => {
    const onStep = vi.fn();
    render(<Harness onStep={onStep} />);

    await userEvent.click(screen.getByRole('button', { name: /third stop/ }));

    expect(screen.getByText(`Stop 3/${TOUR.steps.length}`)).toBeInTheDocument();
    expect(onStep).not.toHaveBeenCalled();
  });

  it('starts the tour from the beginning and plays it', async () => {
    render(<Harness />);

    await userEvent.click(screen.getByRole('button', { name: /third stop/ }));
    await userEvent.click(screen.getByRole('switch', { name: 'Guided tour' }));

    expect(screen.getByText(`Stop 1/${TOUR.steps.length}`)).toBeInTheDocument();
  });

  /**
   * The reduced-motion policy applied to a tour: same stops, same explanations, nothing
   * starts moving on its own. The phase stepper and the arrow keys are the way through.
   */
  it('does not start playing for a viewer who asked for less movement', async () => {
    render(<Harness reduced />);

    await userEvent.click(screen.getByRole('switch', { name: 'Guided tour' }));

    expect(screen.getByRole('switch', { name: 'Guided tour' })).toBeChecked();
    expect(screen.getByTestId('status')).toHaveTextContent('idle');
  });

  it('pauses when it is switched off', async () => {
    render(<Harness />);

    const toggle = screen.getByRole('switch', { name: 'Guided tour' });
    await userEvent.click(toggle);
    await act(async () => {
      await userEvent.click(toggle);
    });

    expect(toggle).not.toBeChecked();
    expect(screen.getByTestId('status')).toHaveTextContent('paused');
  });
});
