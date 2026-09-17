import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HeroJourney } from './HeroJourney';

describe('HeroJourney', () => {
  it('is a figure whose caption tells the whole journey in words', () => {
    render(<HeroJourney />);

    // Browsers name a figure from its figcaption; jsdom's name computation does not, so
    // the caption is checked as the figure's own child rather than as its name.
    const figure = screen.getByRole('figure');
    expect(figure.querySelector(':scope > figcaption')?.textContent).toMatch(
      /laptop.*Wi-Fi.*router.*provider.*ocean.*data centre.*back/i,
    );
  });

  it('names the six places in order, each with a plain caption', () => {
    render(<HeroJourney />);

    const places = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(places.map((place) => place.querySelector('p')?.textContent)).toEqual([
      'You',
      'Wi-Fi',
      'Home router',
      'Internet provider',
      'Ocean cable',
      "The website's data centre",
    ]);
    for (const place of places) {
      expect(place.querySelectorAll('p')[1]?.textContent).toMatch(/^\w.*\.$/);
    }
  });

  it('keeps everything that moves out of the accessibility tree', () => {
    const { container } = render(<HeroJourney />);

    const moving = container.querySelectorAll('[class*="animate-hero"]');
    expect(moving.length).toBeGreaterThan(0);
    for (const element of moving) {
      expect(element.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });
});
