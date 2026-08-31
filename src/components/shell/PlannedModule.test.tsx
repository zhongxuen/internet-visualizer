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

    expect(moduleMetadata('https-explorer')).toEqual({
      title: meta.title,
      description: meta.summary,
    });
  });

  it('returns nothing for an unregistered id', () => {
    expect(moduleMetadata('nope')).toEqual({});
  });
});
