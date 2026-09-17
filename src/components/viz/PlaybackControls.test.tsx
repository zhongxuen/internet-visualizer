import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithPreferences } from '@/components/prefs/testing';
import { PLAYBACK_SPEEDS } from '@/core/sim/playback';

import { PLAYBACK_SHORTCUTS } from './keymap';
import { PlaybackControls } from './PlaybackControls';

function renderControls(overrides: Partial<Parameters<typeof PlaybackControls>[0]> = {}) {
  const onCommand = vi.fn();
  const view = renderWithPreferences(
    <PlaybackControls status="paused" speed={1} onCommand={onCommand} {...overrides} />,
  );
  return { onCommand, user: userEvent.setup(), ...view };
}

/** The speed menu is closed until asked for, like any menu. */
async function openSpeeds(user: ReturnType<typeof userEvent.setup>, speed = 1) {
  await user.click(screen.getByRole('button', { name: `Speed ${speed}x` }));
  return within(screen.getByRole('group', { name: 'Playback speed' }));
}

describe('PlaybackControls', () => {
  it('emits the same commands the keyboard map produces', async () => {
    const { onCommand, user } = renderControls();

    await user.click(screen.getByRole('button', { name: 'Play' }));
    expect(onCommand).toHaveBeenLastCalledWith({ type: 'toggle' });

    await user.click(screen.getByRole('button', { name: 'Next step' }));
    expect(onCommand).toHaveBeenLastCalledWith({ type: 'step-phase', direction: 1 });

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(onCommand).toHaveBeenLastCalledWith({ type: 'step-phase', direction: -1 });

    await user.click(screen.getByRole('button', { name: 'Replay this step' }));
    expect(onCommand).toHaveBeenLastCalledWith({ type: 'replay-phase' });
  });

  it('labels Back, Play and Next step in words, inside their accessible names', () => {
    renderControls();

    // WCAG 2.5.3: what is printed on the button is what it is called.
    for (const name of ['Back', 'Play', 'Next step']) {
      expect(screen.getByRole('button', { name })).toHaveTextContent(name);
    }
  });

  it('draws Replay this step and Play again with different icons', () => {
    renderControls({ status: 'ended' });

    const icon = (name: string) =>
      screen.getByRole('button', { name }).querySelector('svg')?.getAttribute('class');

    expect(icon('Play again')).toMatch(/lucide-rotate-ccw/);
    expect(icon('Replay this step')).toMatch(/lucide-repeat-1/);
  });

  it('offers every speed on the ladder in a menu, and marks the current one', async () => {
    const { onCommand, user } = renderControls({ speed: 2 });

    // Closed: the ladder is not on the page until the menu is opened.
    expect(screen.queryByRole('button', { name: '4x' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Speed 2x' })).toHaveTextContent('2x');

    const speeds = await openSpeeds(user, 2);
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
    // Choosing closes the menu.
    expect(screen.queryByRole('group', { name: 'Playback speed' })).toBeNull();
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

  it('names the shortcut for every control it draws', async () => {
    const { user } = renderControls();

    expect(screen.getByRole('button', { name: 'Play' })).toHaveAttribute(
      'title',
      'Play (Space)',
    );
    expect(screen.getByRole('button', { name: 'Next step' })).toHaveAttribute(
      'title',
      'Next step (Right arrow)',
    );
    expect(screen.getByRole('button', { name: 'Back' })).toHaveAttribute(
      'title',
      'Back one step (Left arrow)',
    );
    expect(screen.getByRole('button', { name: 'Replay this step' })).toHaveAttribute(
      'title',
      'Replay this step (.)',
    );

    const speeds = await openSpeeds(user);
    expect(speeds.getByRole('button', { name: '4x' })).toHaveAttribute(
      'title',
      'Speed 4x (5)',
    );
  });

  it('binds "Pause after each step" to the preference', async () => {
    const { user, preferences } = renderControls();

    // Unset follows the detail level: on in Simple.
    const toggle = screen.getByRole('switch', { name: 'Pause after each step' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    await user.click(toggle);
    expect(preferences.getSnapshot().pauseAtSteps).toBe(false);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('follows Full detail, where pausing after each step is off by default', () => {
    renderWithPreferences(
      <PlaybackControls status="paused" speed={1} onCommand={vi.fn()} />,
      { detail: 'full' },
    );
    expect(screen.getByRole('switch', { name: 'Pause after each step' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('makes the whole keyboard map discoverable from a popover', async () => {
    const { user } = renderControls();

    await user.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));

    for (const shortcut of PLAYBACK_SHORTCUTS) {
      expect(screen.getByText(shortcut.action)).toBeInTheDocument();
    }
    expect(screen.getByText('Space')).toBeInTheDocument();
  });

  it('gathers the extras into one menu for a narrow bar', async () => {
    const { onCommand, user } = renderControls();

    await user.click(screen.getByRole('button', { name: 'More playback options' }));
    const menu = within(screen.getByRole('dialog', { name: 'More playback options' }));

    expect(
      menu.getByRole('switch', { name: 'Pause after each step' }),
    ).toBeInTheDocument();
    expect(menu.getByText(PLAYBACK_SHORTCUTS[0]!.action)).toBeInTheDocument();

    await user.click(menu.getByRole('button', { name: 'Replay this step' }));
    expect(onCommand).toHaveBeenLastCalledWith({ type: 'replay-phase' });
  });

  it('can hand the legend off to a module that prints it elsewhere', () => {
    renderControls({ showLegend: false });
    expect(screen.queryByRole('button', { name: 'Keyboard shortcuts' })).toBeNull();
  });

  it('renders the middle of the bar it is given', () => {
    renderControls({ children: <span>the timeline</span> });
    expect(screen.getByText('the timeline')).toBeInTheDocument();
  });
});
