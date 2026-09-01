import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PLAYBACK_SPEEDS } from '@/core/sim/playback';

import { PLAYBACK_SHORTCUTS } from './keymap';
import { PlaybackControls } from './PlaybackControls';

function renderControls(overrides: Partial<Parameters<typeof PlaybackControls>[0]> = {}) {
  const onCommand = vi.fn();
  render(
    <PlaybackControls status="paused" speed={1} onCommand={onCommand} {...overrides} />,
  );
  return { onCommand, user: userEvent.setup() };
}

describe('PlaybackControls', () => {
  it('emits the same commands the keyboard map produces', async () => {
    const { onCommand, user } = renderControls();

    await user.click(screen.getByRole('button', { name: 'Play' }));
    expect(onCommand).toHaveBeenLastCalledWith({ type: 'toggle' });

    await user.click(screen.getByRole('button', { name: 'Next phase' }));
    expect(onCommand).toHaveBeenLastCalledWith({ type: 'step-phase', direction: 1 });

    await user.click(screen.getByRole('button', { name: 'Previous phase' }));
    expect(onCommand).toHaveBeenLastCalledWith({ type: 'step-phase', direction: -1 });

    await user.click(screen.getByRole('button', { name: 'Jump to the start' }));
    expect(onCommand).toHaveBeenLastCalledWith({ type: 'jump', to: 'start' });

    await user.click(screen.getByRole('button', { name: 'Jump to the end' }));
    expect(onCommand).toHaveBeenLastCalledWith({ type: 'jump', to: 'end' });

    await user.click(screen.getByRole('button', { name: 'Replay the current phase' }));
    expect(onCommand).toHaveBeenLastCalledWith({ type: 'replay-phase' });
  });

  it('offers every speed on the ladder and marks the current one', async () => {
    const { onCommand, user } = renderControls({ speed: 2 });

    const speeds = within(screen.getByRole('group', { name: 'Playback speed' }));
    for (const speed of PLAYBACK_SPEEDS) {
      expect(speeds.getByRole('button', { name: `${speed}x` })).toBeInTheDocument();
    }

    expect(speeds.getByRole('button', { name: '2x' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(speeds.getByRole('button', { name: '1x' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    await user.click(speeds.getByRole('button', { name: '0.25x' }));
    expect(onCommand).toHaveBeenLastCalledWith({ type: 'speed', speed: 0.25 });
  });

  it('says what the main button will do next', () => {
    const { unmount } = render(
      <PlaybackControls status="playing" speed={1} onCommand={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    unmount();

    render(<PlaybackControls status="ended" speed={1} onCommand={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Play again' })).toBeInTheDocument();
  });

  it('names the shortcut for every control it draws', () => {
    renderControls();

    expect(screen.getByRole('button', { name: 'Play' })).toHaveAttribute(
      'title',
      'Play (Space)',
    );
    expect(screen.getByRole('button', { name: 'Next phase' })).toHaveAttribute(
      'title',
      'Next phase (Right arrow)',
    );
    expect(screen.getByRole('button', { name: '4x' })).toHaveAttribute(
      'title',
      'Speed 4x (5)',
    );
  });

  it('makes the whole keyboard map discoverable from a legend', async () => {
    const { user } = renderControls();

    await user.click(screen.getByText('Shortcuts'));

    for (const shortcut of PLAYBACK_SHORTCUTS) {
      expect(screen.getByText(shortcut.action)).toBeInTheDocument();
    }
    expect(screen.getByText('Space')).toBeInTheDocument();
  });

  it('can hand the legend off to a module that prints it elsewhere', () => {
    renderControls({ showLegend: false });
    expect(screen.queryByText('Shortcuts')).toBeNull();
  });
});
