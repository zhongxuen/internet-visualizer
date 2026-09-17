import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { useReducedMotionSafe } from '@/components/motion';
import { renderWithPreferences } from '@/components/prefs/testing';

import { DETAIL_EXPLANATIONS, SettingsMenu } from './SettingsMenu';

/** What the rest of the product reads, rendered beside the menu. */
function MotionProbe() {
  const { reduced } = useReducedMotionSafe();
  return <output aria-label="motion">{reduced ? 'reduced' : 'full'}</output>;
}

async function openSettings(prefs: Parameters<typeof renderWithPreferences>[1] = {}) {
  const user = userEvent.setup();
  const result = renderWithPreferences(
    <>
      <SettingsMenu />
      <MotionProbe />
    </>,
    prefs,
  );
  await user.click(screen.getByRole('button', { name: 'Settings' }));
  const panel = screen.getByRole('dialog', { name: 'Settings' });
  return { user, panel, ...result };
}

describe('SettingsMenu', () => {
  it('opens from a labelled button and closes on Escape, returning focus', async () => {
    const { user, panel } = await openSettings();
    expect(panel).toBeVisible();

    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('sets the detail level, and explains both levels in one line each', async () => {
    const { user, panel, preferences } = await openSettings();

    const group = within(panel).getByRole('radiogroup', { name: 'Detail level' });
    expect(within(group).getByRole('radio', { name: 'Simple' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(panel).toHaveTextContent(DETAIL_EXPLANATIONS.simple);
    expect(panel).toHaveTextContent(DETAIL_EXPLANATIONS.full);

    await user.click(within(group).getByRole('radio', { name: 'Full detail' }));
    expect(preferences.getSnapshot().detail).toBe('full');
  });

  it('overrides motion in both directions, and can hand it back to the device', async () => {
    const { user, panel, preferences } = await openSettings();
    const group = within(panel).getByRole('radiogroup', { name: 'Animation' });

    expect(within(group).getByRole('radio', { name: 'Match my device' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await user.click(within(group).getByRole('radio', { name: 'Reduced' }));
    expect(preferences.getSnapshot().motion).toBe('reduced');
    expect(screen.getByRole('status', { name: 'motion' })).toHaveTextContent('reduced');

    await user.click(within(group).getByRole('radio', { name: 'On' }));
    expect(preferences.getSnapshot().motion).toBe('full');
    expect(screen.getByRole('status', { name: 'motion' })).toHaveTextContent('full');

    await user.click(within(group).getByRole('radio', { name: 'Match my device' }));
    expect(preferences.getSnapshot().motion).toBe('system');
  });

  it('promises that reducing motion keeps every step', async () => {
    const { panel } = await openSettings({ motion: 'reduced' });
    expect(panel).toHaveTextContent(/still shows every step/i);
  });

  it('sets the text size', async () => {
    const { user, panel, preferences } = await openSettings();
    const group = within(panel).getByRole('radiogroup', { name: 'Text size' });

    await user.click(within(group).getByRole('radio', { name: 'Large' }));
    expect(preferences.getSnapshot().textSize).toBe('large');
  });

  it('shows pause-after-each-step following the detail level until it is set', async () => {
    const { user, panel, preferences } = await openSettings({ detail: 'simple' });
    const toggle = within(panel).getByRole('switch', { name: 'Pause after each step' });

    // Simple pauses by default.
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    await user.click(toggle);
    expect(preferences.getSnapshot().pauseAtSteps).toBe(false);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('never offers Live mode, which must not outlive a reload', async () => {
    const { panel } = await openSettings();
    expect(panel).not.toHaveTextContent(/live/i);
  });
});
