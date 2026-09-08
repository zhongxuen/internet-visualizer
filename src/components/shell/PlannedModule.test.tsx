import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { getModule } from '@/modules/registry';

import { PlannedModule, moduleMetadata } from './PlannedModule';

describe('PlannedModule', () => {
  it('names the module from the registry and offers a way back', () => {
    render(<PlannedModule moduleId="packet-journey" />);

    expect(screen.getByText(/Packet Journey is not built yet/)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Browse the other modules/ }),
    ).toHaveAttribute('href', '/');
  });

  it('degrades to neutral copy for an unknown id rather than throwing', () => {
    render(<PlannedModule moduleId="nope" />);

    expect(screen.getByText(/This module is not built yet/)).toBeInTheDocument();
  });
});

describe('moduleMetadata', () => {
  it('quotes the registry so the tab title cannot drift from the heading', () => {
    const meta = getModule('https-explorer')!;
    const metadata = moduleMetadata('https-explorer');

    expect(metadata.title).toBe(meta.title);
    expect(metadata.description).toBe(meta.summary);
    // The same two strings again, in the shape a link unfurler reads. Written out
    // rather than inherited: `og:title` has no page around it to add the product name.
    expect(metadata.openGraph?.description).toBe(meta.summary);
    expect(metadata.openGraph?.title).toContain(meta.title);
  });

  it('canonicalises to the route the registry gives the module', () => {
    const meta = getModule('https-explorer')!;

    // Root-relative, so `metadataBase` decides the host and a preview deployment
    // points at production rather than at itself.
    expect(moduleMetadata('https-explorer').alternates?.canonical).toBe(meta.route);
  });

  it('returns nothing for an unregistered id', () => {
    expect(moduleMetadata('nope')).toEqual({});
  });
});
