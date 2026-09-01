import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { KeyboardLegend } from './KeyboardLegend';
import { matchPlaybackKey, PLAYBACK_SHORTCUTS } from './keymap';

/**
 * The acceptance criterion this covers is "every shortcut works and is discoverable via
 * a legend". Discoverability is only worth asserting if the two halves cannot drift, so
 * the last test walks every key cap the legend prints back through `matchPlaybackKey`:
 * a cap that no longer maps to a command would be a lie printed on the page.
 */

/** The key cap spellings the legend prints, mapped to `KeyboardEvent.key` values. */
const AS_EVENT_KEY: Record<string, string> = {
  Space: ' ',
  '→': 'ArrowRight',
  '←': 'ArrowLeft',
};

describe('KeyboardLegend', () => {
  it('prints every shortcut in the map', () => {
    render(<KeyboardLegend />);

    for (const shortcut of PLAYBACK_SHORTCUTS) {
      expect(screen.getByText(shortcut.action)).toBeInTheDocument();
    }
  });

  it('pairs each set of key caps with what it does, as a description list', () => {
    const { container } = render(<KeyboardLegend />);

    expect(container.querySelectorAll('dt')).toHaveLength(PLAYBACK_SHORTCUTS.length);
    expect(container.querySelectorAll('dd')).toHaveLength(PLAYBACK_SHORTCUTS.length);
  });

  it('draws the key caps as real kbd elements', () => {
    const { container } = render(<KeyboardLegend />);

    const caps = [...container.querySelectorAll('kbd')].map((cap) => cap.textContent);

    expect(caps).toContain('Space');
    expect(caps).toContain('Home');
    expect(caps).toContain('Shift');
  });

  it('prints nothing it cannot do: every cap maps back to a command', () => {
    render(<KeyboardLegend />);

    for (const shortcut of PLAYBACK_SHORTCUTS) {
      for (const chord of shortcut.chords) {
        const key = chord[chord.length - 1];
        const command = matchPlaybackKey({
          key: AS_EVENT_KEY[key] ?? key,
          shiftKey: chord.includes('Shift'),
        });

        expect(command, `${chord.join('+')} is printed but does nothing`).not.toBeNull();
      }
    }
  });
});
