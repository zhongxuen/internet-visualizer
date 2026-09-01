import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { buildToyRun, TOY_TOPOLOGY } from '@/core/sim/toyRun';

import { EventLog } from './EventLog';
import { labelsFor } from './events';

const RUN = buildToyRun();
const LABELS = labelsFor(TOY_TOPOLOGY);

function renderLog(overrides: Partial<Parameters<typeof EventLog>[0]> = {}) {
  const onSeek = vi.fn();
  render(
    <EventLog
      events={RUN.events}
      virtualTime={16}
      durationMs={RUN.durationMs}
      labels={LABELS}
      pdus={RUN.pdus}
      onSeek={onSeek}
      {...overrides}
    />,
  );
  return { onSeek, user: userEvent.setup() };
}

describe('EventLog', () => {
  it('lists the whole run, not only what has happened', () => {
    renderLog();
    expect(screen.getAllByRole('listitem')).toHaveLength(RUN.events.length);
  });

  it('counts how far through the run the playhead is', () => {
    renderLog();

    const reached = RUN.events.filter((event) => event.at <= 16).length;
    expect(reached).toBeGreaterThan(0);
    expect(reached).toBeLessThan(RUN.events.length);
    expect(screen.getByText(`${reached} / ${RUN.events.length}`)).toBeInTheDocument();
  });

  it('says what happened in labels, not ids', () => {
    renderLog();

    expect(
      screen.getByText(
        'Laptop -> Home router: ICMP echo request 192.168.1.24 -> 198.51.100.42',
      ),
    ).toBeInTheDocument();
  });

  it('seeks to an event when its line is clicked -- forwards or backwards', async () => {
    const { onSeek, user } = renderLog();

    await user.click(screen.getByText(/Echo reply returns/));
    expect(onSeek).toHaveBeenLastCalledWith(60);

    await user.click(screen.getByText(/ping echo\.example\.net/));
    expect(onSeek).toHaveBeenLastCalledWith(0);
  });

  it('marks the lines the playhead has not reached, in text as well as in colour', () => {
    renderLog();

    const ahead = screen.getByText(/Echo reply returns/).closest('button');
    expect(ahead).toHaveTextContent('Not reached yet');

    const passed = screen.getByText(/ping echo\.example\.net/).closest('button');
    expect(passed).not.toHaveTextContent('Not reached yet');
  });

  it('prints the timestamp of every line, in the run’s own unit', () => {
    renderLog();
    expect(screen.getAllByText('16 ms').length).toBeGreaterThan(0);
  });

  it('is collapsible, and open by default', async () => {
    const { user } = renderLog();

    const disclosure = screen.getByText('Event log');
    expect(disclosure.closest('details')).toHaveAttribute('open');

    await user.click(disclosure);
    expect(disclosure.closest('details')).not.toHaveAttribute('open');
  });

  /**
   * jsdom has no layout, so the scrolling itself cannot be asserted here -- only the
   * mechanism. `scrollIntoView` scrolls every scrollable ancestor including the document,
   * so a log that follows the playhead with it drags the whole page along on every event.
   * That is a real defect a browser shows and this environment cannot, which is exactly
   * why the ban is asserted rather than the effect.
   */
  it('follows the playhead without scrolling anything but its own box', () => {
    const scrollIntoView = vi.fn();
    // Defined rather than spied on: jsdom does not implement `scrollIntoView`, so the
    // optional call this replaced was a no-op here and the suite could never have seen
    // it. Installing a real one is what makes a regression observable at all.
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: scrollIntoView,
    });

    const { rerender } = render(
      <EventLog
        events={RUN.events}
        virtualTime={0}
        durationMs={RUN.durationMs}
        labels={LABELS}
        pdus={RUN.pdus}
        onSeek={vi.fn()}
      />,
    );

    // Walk the playhead across the whole run, so every active-line change is exercised.
    for (const time of [8, 16, 60, 96, 120]) {
      rerender(
        <EventLog
          events={RUN.events}
          virtualTime={time}
          durationMs={RUN.durationMs}
          labels={LABELS}
          pdus={RUN.pdus}
          onSeek={vi.fn()}
        />,
      );
    }

    expect(scrollIntoView).not.toHaveBeenCalled();

    delete (Element.prototype as Partial<Element>).scrollIntoView;
  });
});
