import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithPreferences } from '@/components/prefs/testing';
import { buildToyRun, TOY_TOPOLOGY } from '@/core/sim/toyRun';

import { EventLog } from './EventLog';
import { labelsFor } from './events';

const RUN = buildToyRun();
const LABELS = labelsFor(TOY_TOPOLOGY);

/** Rendered open, in Full detail unless a test says otherwise. */
function renderLog(
  overrides: Partial<Parameters<typeof EventLog>[0]> = {},
  detail: 'simple' | 'full' = 'full',
) {
  const onSeek = vi.fn();
  renderWithPreferences(
    <EventLog
      events={RUN.events}
      virtualTime={16}
      durationMs={RUN.durationMs}
      labels={LABELS}
      pdus={RUN.pdus}
      onSeek={onSeek}
      defaultOpen
      {...overrides}
    />,
    { detail },
  );
  return { onSeek, user: userEvent.setup() };
}

describe('EventLog', () => {
  it.each(['simple', 'full'] as const)(
    'is closed by default in %s, with no rows mounted until it is opened',
    async (detail) => {
      const { user } = renderLog({ defaultOpen: undefined }, detail);

      const summary = screen.getByText('Everything that happened');
      expect(summary.closest('details')).not.toHaveAttribute('open');
      expect(screen.queryAllByRole('listitem')).toHaveLength(0);

      await user.click(summary);
      expect(summary.closest('details')).toHaveAttribute('open');
      expect(screen.getAllByRole('listitem')).toHaveLength(RUN.events.length);

      // Closing unmounts them again: a closed log costs the document one row.
      await user.click(summary);
      expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    },
  );

  it('lists the whole run, not only what has happened', () => {
    renderLog();
    expect(screen.getAllByRole('listitem')).toHaveLength(RUN.events.length);
  });

  it('counts how far through the run the playhead is, even while closed', () => {
    renderLog({ defaultOpen: false });

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

  it('names a packet by what it is for in Simple detail', () => {
    const pdus = {
      ...RUN.pdus,
      'echo-request': { ...RUN.pdus['echo-request']!, plainLabel: 'Are you there?' },
    };
    renderLog({ pdus }, 'simple');

    expect(
      screen.getAllByText('Laptop to Home router: Are you there?').length,
    ).toBeGreaterThan(0);
  });

  it('announces a teaching note as a note, and a phase as a step', () => {
    renderLog({ virtualTime: RUN.durationMs });

    const note = RUN.events.find((event) => event.kind === 'annotate')!;
    const noteRow = screen
      .getAllByRole('button')
      .find((button) =>
        button.textContent?.includes(note.kind === 'annotate' ? note.text : '-'),
      );
    expect(noteRow).toHaveTextContent(/Note\./);
    expect(noteRow).not.toHaveTextContent('Phase');

    const phaseRow = screen.getByText('Phase: Building the packet');
    expect(phaseRow.closest('button')).toHaveTextContent('Step.');
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
        defaultOpen
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
          defaultOpen
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
