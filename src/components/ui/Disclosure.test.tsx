import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Disclosure } from './Disclosure';

const summaryOf = (text: string) => screen.getByText(text).closest('summary')!;

describe('Disclosure', () => {
  it('is a native details/summary pair, closed by default', async () => {
    const user = userEvent.setup();
    render(
      <Disclosure summary="Technical details">
        <p>SYN, SYN-ACK, ACK.</p>
      </Disclosure>,
    );

    const summary = summaryOf('Technical details');
    const details = summary.parentElement!;
    expect(details.tagName).toBe('DETAILS');
    expect(details).not.toHaveAttribute('open');
    expect(screen.getByText('SYN, SYN-ACK, ACK.')).not.toBeVisible();

    await user.click(summary);
    expect(details).toHaveAttribute('open');
    expect(screen.getByText('SYN, SYN-ACK, ACK.')).toBeVisible();

    await user.click(summary);
    expect(details).not.toHaveAttribute('open');
  });

  /**
   * The summary's keyboard behaviour is the platform's: Enter and Space on a focused
   * summary fire a click, which is the path the test above takes. user-event does not
   * emulate that for `<summary>`, so this asserts the parts that are the component's --
   * the summary is a tab stop, and nothing here swallows a key.
   */
  it('puts the summary in the tab order and leaves Escape alone', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <Disclosure summary="Experiment" defaultOpen onToggle={onToggle}>
        <button type="button">Message size</button>
      </Disclosure>,
    );

    await user.tab();
    expect(summaryOf('Experiment')).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Message size' })).toHaveFocus();

    // A disclosure is not an overlay; Escape does not close it, and focus stays put.
    await user.keyboard('{Escape}');
    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Message size' })).toHaveFocus();
  });

  it('with lazy, unmounts its content while closed', async () => {
    const user = userEvent.setup();
    render(
      <Disclosure summary="Everything that happened" lazy>
        <ol>
          <li>Row one</li>
        </ol>
      </Disclosure>,
    );

    expect(screen.queryByText('Row one')).not.toBeInTheDocument();
    await user.click(summaryOf('Everything that happened'));
    expect(screen.getByText('Row one')).toBeInTheDocument();
    await user.click(summaryOf('Everything that happened'));
    expect(screen.queryByText('Row one')).not.toBeInTheDocument();
  });

  it('can be controlled: the parent decides, and a refusal leaves it closed', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();

    function Controlled({ allow }: { allow: boolean }) {
      const [open, setOpen] = useState(false);
      return (
        <Disclosure
          summary="What you'll learn"
          open={open}
          onToggle={(next) => {
            onToggle(next);
            if (allow) setOpen(next);
          }}
        >
          <p>Three things.</p>
        </Disclosure>
      );
    }

    const { unmount } = render(<Controlled allow={false} />);
    await user.click(summaryOf("What you'll learn"));
    expect(onToggle).toHaveBeenLastCalledWith(true);
    expect(summaryOf("What you'll learn").parentElement).not.toHaveAttribute('open');
    unmount();

    render(<Controlled allow />);
    await user.click(summaryOf("What you'll learn"));
    expect(summaryOf("What you'll learn").parentElement).toHaveAttribute('open');
  });

  it('reports a toggle the browser made itself, such as find-in-page opening it', () => {
    const onToggle = vi.fn();
    render(
      <Disclosure summary="The map as a list" onToggle={onToggle}>
        <p>Laptop</p>
      </Disclosure>,
    );

    const details = summaryOf('The map as a list').parentElement as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event('toggle'));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('shows a trailing note as part of the summary', () => {
    render(
      <Disclosure summary="Everything that happened" meta="42 events">
        <p>Rows</p>
      </Disclosure>,
    );
    expect(summaryOf('Everything that happened')).toHaveTextContent(
      'Everything that happened42 events',
    );
  });
});
