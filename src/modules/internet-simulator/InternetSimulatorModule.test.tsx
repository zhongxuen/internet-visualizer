import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InternetSimulatorModule } from './InternetSimulatorModule';

/**
 * The composition root.
 *
 * Mounting this tree is expensive -- it brings up a React Flow canvas, eight stages, a
 * waterfall, and six runs of the pipeline -- so this file asserts the few things that are
 * genuinely properties of the *composition* and leaves everything else to the component and
 * model tests beside it.
 *
 * The safety test is the one that must never be deleted. CLAUDE.md's rule is that a user is
 * never unsure whether an action touches a real network, and this module puts a text field
 * in front of them that looks exactly like the one that does. The guarantee is structural --
 * there is no `fetch` in the module and no host it could be pointed at -- and this asserts
 * it from the outside, with a real host name typed into the field.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe('InternetSimulatorModule', () => {
  it('opens on the cold first visit, with the address bar and the rail', () => {
    render(<InternetSimulatorModule />);

    expect(screen.getByRole('textbox')).toHaveValue('https://www.example.com/');
    expect(screen.getByRole('list', { name: 'Page load stages' })).toBeInTheDocument();
    expect(screen.getByText('Simulated')).toBeInTheDocument();
  });

  it('opens a stage when the rail is clicked, with the handoff inside it', () => {
    render(<InternetSimulatorModule />);

    fireEvent.click(screen.getByRole('button', { name: /^DNS/ }));

    expect(screen.getByText('Stage: DNS')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open in DNS Explorer/ })).toHaveAttribute(
      'href',
      expect.stringContaining('name=www.example.com'),
    );
  });

  it('re-runs on a different link when the network profile changes', () => {
    render(<InternetSimulatorModule />);

    const cable = screen.getByRole('radio', { name: /Cable/ });
    const satellite = screen.getByRole('radio', { name: /Satellite/ });
    expect(cable).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(satellite);
    expect(satellite).toHaveAttribute('aria-checked', 'true');
    expect(cable).toHaveAttribute('aria-checked', 'false');
  });

  /**
   * The security boundary, asserted rather than asserted about. Nothing in this module may
   * reach the network, whatever is typed into a field that deliberately looks like the one
   * that would.
   */
  it('never calls fetch, whatever is typed into it', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<InternetSimulatorModule />);

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'https://www.wikipedia.org/wiki/HTTP' } });
    fireEvent.submit(input);

    fireEvent.click(screen.getByRole('button', { name: /^DNS/ }));

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
