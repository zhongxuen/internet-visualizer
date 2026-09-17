import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PLAYBACK_SHORTCUTS } from './keymap';
import { HELP_STEPS, StageHelp } from './StageHelp';

function dialog() {
  return screen.queryByRole('dialog', { name: 'How to use this page' });
}

describe('StageHelp', () => {
  it('opens a dialog with the three steps, the module’s lines, and the keyboard map', () => {
    render(<StageHelp help={['Type a name, then press Play.']} />);

    fireEvent.click(screen.getByRole('button', { name: 'How to use this page' }));

    const inside = within(dialog()!);
    for (const step of HELP_STEPS) expect(inside.getByText(step)).toBeInTheDocument();
    expect(inside.getByText('Type a name, then press Play.')).toBeInTheDocument();
    expect(inside.getByText(PLAYBACK_SHORTCUTS[0]!.action)).toBeInTheDocument();
  });

  it('opens on the ? key', () => {
    render(<StageHelp />);
    fireEvent.keyDown(window, { key: '?' });
    expect(dialog()).not.toBeNull();
  });

  it('ignores ? while the viewer is typing, and with a modifier held', () => {
    render(
      <>
        <StageHelp />
        <input aria-label="Name" />
        <textarea aria-label="Notes" />
      </>,
    );

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: '?' });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Notes' }), { key: '?' });
    fireEvent.keyDown(window, { key: '?', ctrlKey: true });
    expect(dialog()).toBeNull();
  });

  it('does not listen for the key when told not to', () => {
    render(<StageHelp bindKey={false} />);
    fireEvent.keyDown(window, { key: '?' });
    expect(dialog()).toBeNull();
  });

  it('keeps its content out of the document until opened, and closes again', () => {
    render(<StageHelp />);
    expect(screen.queryByText(HELP_STEPS[0])).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'How to use this page' }));
    fireEvent.click(within(dialog()!).getByRole('button', { name: 'Close' }));
    expect(screen.queryByText(HELP_STEPS[0])).toBeNull();
  });
});
