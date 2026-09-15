import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Callout, type CalloutTone } from './Callout';

const TONES: Array<[CalloutTone, string]> = [
  ['info', 'Note'],
  ['tip', 'Tip'],
  ['warning', 'Warning'],
  ['safety', 'Safety'],
];

describe('Callout', () => {
  it.each(TONES)('%s says its tone in words and draws an icon', (tone, name) => {
    const { container } = render(<Callout tone={tone}>Some words.</Callout>);

    expect(screen.getByText(name)).toBeVisible();
    expect(screen.getByText('Some words.')).toBeVisible();

    const icons = container.querySelectorAll('svg');
    expect(icons).toHaveLength(1);
    expect(icons[0]).toHaveAttribute('aria-hidden', 'true');
  });

  it('draws a different icon for every tone', () => {
    const icons = TONES.map(([tone]) => {
      const { container, unmount } = render(<Callout tone={tone}>x</Callout>);
      const markup = container.querySelector('svg')!.innerHTML;
      unmount();
      return markup;
    });
    expect(new Set(icons).size).toBe(TONES.length);
  });

  it('keeps the tone name for a screen reader under a custom title', () => {
    render(
      <Callout tone="safety" title="This one is real">
        Live mode sends a request from the server.
      </Callout>,
    );
    expect(screen.getByText('This one is real').parentElement).toHaveTextContent(
      'This one is real (Safety)',
    );
  });

  it('is neither a live region nor a landmark, and has nothing to focus', () => {
    const { container } = render(<Callout tone="warning">Careful.</Callout>);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(container.querySelector('[aria-live], [tabindex]')).toBeNull();
    // Exempt from .state-dim, like every tinted surface.
    expect(container.firstElementChild).toHaveAttribute('data-no-dim');
  });
});
