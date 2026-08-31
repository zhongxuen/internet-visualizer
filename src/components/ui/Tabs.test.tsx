import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Tabs, type TabItem } from './Tabs';

const ITEMS: TabItem[] = [
  { id: 'request', label: 'Request', content: <p>Request headers</p> },
  { id: 'response', label: 'Response', content: <p>Response headers</p> },
  { id: 'timing', label: 'Timing', content: <p>Timing breakdown</p> },
];

describe('Tabs', () => {
  it('keeps a single tab stop and moves selection with the arrow keys', async () => {
    const user = userEvent.setup();
    render(<Tabs items={ITEMS} label="Exchange" />);

    const [request, response, timing] = screen.getAllByRole('tab');

    // Roving tabindex: only the selected tab is reachable from outside the list.
    expect(request).toHaveAttribute('tabindex', '0');
    expect(response).toHaveAttribute('tabindex', '-1');
    expect(timing).toHaveAttribute('tabindex', '-1');

    await user.tab();
    expect(request).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(response).toHaveFocus();
    expect(response).toHaveAttribute('aria-selected', 'true');
    expect(request).toHaveAttribute('tabindex', '-1');
    expect(screen.getByText('Response headers')).toBeVisible();

    // Wraps at the ends.
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(timing).toHaveFocus();

    await user.keyboard('{Home}');
    expect(request).toHaveFocus();
    expect(screen.getByText('Request headers')).toBeVisible();
  });

  it('hides unselected panels and skips disabled tabs', async () => {
    const user = userEvent.setup();
    render(
      <Tabs
        items={[ITEMS[0], { ...ITEMS[1], disabled: true }, ITEMS[2]]}
        label="Exchange"
      />,
    );

    expect(screen.getByText('Response headers')).not.toBeVisible();

    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(screen.getAllByRole('tab')[2]).toHaveFocus();
  });
});
