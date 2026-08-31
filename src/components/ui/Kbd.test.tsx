import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Kbd } from './Kbd';

describe('Kbd', () => {
  it('renders a single key and a chord', () => {
    const { rerender } = render(<Kbd>Esc</Kbd>);
    expect(screen.getByText('Esc')).toBeVisible();

    rerender(<Kbd keys={['Ctrl', 'K']} className="ml-1" />);
    expect(screen.getByText('Ctrl')).toBeVisible();
    expect(screen.getByText('K')).toBeVisible();
    expect(screen.getByText('+')).toBeVisible();
  });
});
