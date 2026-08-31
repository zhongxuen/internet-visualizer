import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Panel } from './Panel';

describe('Panel', () => {
  it('exposes a labelled region and renders aside, body, and footer', () => {
    render(
      <Panel title="Explanation" aside={<span>L4</span>} footer="Step 2 of 6" scroll>
        <p>What just happened</p>
      </Panel>,
    );

    expect(screen.getByRole('region', { name: 'Explanation' })).toBeVisible();
    expect(screen.getByText('L4')).toBeVisible();
    expect(screen.getByText('What just happened')).toBeVisible();
    expect(screen.getByText('Step 2 of 6')).toBeVisible();
  });
});
