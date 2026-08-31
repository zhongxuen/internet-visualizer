import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MODULES } from '@/modules/registry';

import { ModuleGrid } from './ModuleGrid';

describe('ModuleGrid', () => {
  /**
   * The acceptance criterion for step 5: a registry entry is the only thing needed to
   * get a card. Asserted against the live registry on purpose — a hardcoded count
   * would pass while the grid quietly dropped a module.
   */
  it('renders one card per registry entry, with no other source of truth', () => {
    render(<ModuleGrid />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(MODULES.length);

    for (const meta of MODULES) {
      expect(screen.getByRole('link', { name: meta.title })).toHaveAttribute(
        'href',
        meta.route,
      );
    }
  });

  it('accepts a filtered subset for narrower views', () => {
    const subset = MODULES.slice(0, 2);
    render(<ModuleGrid modules={subset} />);

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
});
