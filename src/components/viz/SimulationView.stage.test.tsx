import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithPreferences } from '@/components/prefs/testing';
import type { SimResult } from '@/core/sim/result';
import { buildToyRun, TOY_TOPOLOGY } from '@/core/sim/toyRun';

import { SimulationView, type SimulationViewProps } from './SimulationView';
import type { VisualizedRun } from './hooks/useSimulation';
import type { DeeperTab, StoryOption } from './stage';

/**
 * The Stage (uiux-spec.md §5.3), through the surfaces a viewer uses: the step caption,
 * the two overlays, the story picker, help, and the slots below the stage.
 *
 * `SimulationView.test.tsx` covers the playback wiring these sit on; this file covers
 * what UX-2.3 added on top of it.
 */

const TOY = buildToyRun();

/** The toy run with a plain sentence on its first step, as a wave-3 scenario will have. */
const PLAIN: SimResult = {
  ...TOY,
  phases: TOY.phases.map((phase, index) =>
    index === 0
      ? { ...phase, plain: 'Your laptop gets a message ready to send.' }
      : phase,
  ),
};

const RUN: VisualizedRun = { topology: TOY_TOPOLOGY, result: PLAIN };

const STORIES: StoryOption[] = [
  {
    id: 'ping',
    title: 'ICMP echo',
    summary: 'An ICMP echo request and its reply, across a home router.',
    teaches: ['The router forwards the request one hop at a time.'],
    story: {
      plainTitle: 'Is the server there?',
      question: 'How does your laptop check that a server is listening?',
      level: 'beginner',
    },
  },
  { id: 'lost', title: 'Lost reply', summary: 'The reply never arrives.' },
];

function press(key: string, init: KeyboardEventInit = {}) {
  fireEvent.keyDown(window, { key, ...init });
}

function status() {
  return screen.getByRole('status');
}

function transport() {
  return within(screen.getByRole('group', { name: 'Playback' }));
}

function recap() {
  return screen.queryByRole('region', { name: 'What just happened' });
}

function renderStage(props: Partial<SimulationViewProps> = {}, prefs = {}) {
  return renderWithPreferences(<SimulationView simulation={RUN} {...props} />, prefs);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the step caption', () => {
  it('is the view’s one live region', () => {
    renderStage();
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('asks the story’s question before the first play', () => {
    renderStage({ stories: { options: STORIES, selectedId: 'ping', onSelect: vi.fn() } });
    expect(status()).toHaveTextContent(STORIES[0]!.story!.question);
  });

  it('says how many steps there are when the story has no question', () => {
    renderStage();
    expect(status()).toHaveTextContent('Press Play to watch it happen, in 3 steps.');
  });

  it('tells the step in plain words in Simple, falling back to the description', () => {
    renderStage();

    press('Home');
    fireEvent.click(transport().getByRole('button', { name: 'Next step' }));
    fireEvent.click(transport().getByRole('button', { name: 'Back' }));
    expect(status()).toHaveTextContent(
      'Step 1 of 3: Your laptop gets a message ready to send.',
    );

    press('ArrowRight');
    expect(status()).toHaveTextContent(`Step 2 of 3: ${TOY.phases[1]!.description}`);
    expect(status()).not.toHaveTextContent(TOY.phases[1]!.title);
  });

  it('tells the title and the description in Full detail', () => {
    renderStage({}, { detail: 'full' });

    press('ArrowRight');
    expect(status()).toHaveTextContent(
      `Step 2 of 3: ${TOY.phases[1]!.title}. ${TOY.phases[1]!.description}`,
    );
  });

  it('says it is done at the end', () => {
    renderStage();
    press('End');
    expect(status()).toHaveTextContent('Done: here is what happened');
  });
});

describe('the start overlay', () => {
  it('offers "Watch it happen" before the first play, and plays on it', () => {
    renderStage();

    fireEvent.click(screen.getByRole('button', { name: 'Watch it happen' }));

    expect(transport().getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Watch it happen' })).toBeNull();
  });

  it('carries the story’s question', () => {
    renderStage({ stories: { options: STORIES, selectedId: 'ping', onSelect: vi.fn() } });

    const card = screen.getByRole('button', { name: 'Watch it happen' }).parentElement!;
    expect(card).toHaveTextContent(STORIES[0]!.story!.question);
  });

  it('goes away on a seek, as well as on play', () => {
    renderStage();
    fireEvent.change(screen.getByRole('slider'), { target: { value: '30' } });
    expect(screen.queryByRole('button', { name: 'Watch it happen' })).toBeNull();
  });

  it('never plays by itself', () => {
    renderStage();
    expect(transport().getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });
});

describe('the run recap', () => {
  it('lists what happened, one line per step, in plain words in Simple', () => {
    renderStage();
    press('End');

    const region = recap()!;
    const lines = within(region).getAllByRole('listitem');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toHaveTextContent('Your laptop gets a message ready to send.');
    expect(lines[1]).toHaveTextContent(TOY.phases[1]!.description);
  });

  it('lists the step titles in Full detail', () => {
    renderStage({}, { detail: 'full' });
    press('End');

    const lines = within(recap()!).getAllByRole('listitem');
    expect(lines.map((line) => line.textContent)).toEqual(
      TOY.phases.map((phase) => phase.title),
    );
  });

  it('plays again from the start', () => {
    renderStage();
    press('End');

    fireEvent.click(within(recap()!).getByRole('button', { name: 'Play again' }));

    expect(recap()).toBeNull();
    expect(transport().getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('offers the next story only when there is one', () => {
    const onSelect = vi.fn();
    const { unmount } = renderStage({
      stories: { options: STORIES, selectedId: 'ping', onSelect },
    });
    press('End');

    fireEvent.click(within(recap()!).getByRole('button', { name: 'Next story' }));
    expect(onSelect).toHaveBeenCalledWith('lost');
    unmount();

    renderStage();
    press('End');
    expect(within(recap()!).queryByRole('button', { name: 'Next story' })).toBeNull();
  });

  it('closes on its button and hands focus to Play', () => {
    renderStage();
    press('End');

    fireEvent.click(
      within(recap()!).getByRole('button', { name: 'Close what just happened' }),
    );

    expect(recap()).toBeNull();
    expect(transport().getByRole('button', { name: 'Play again' })).toHaveFocus();
  });

  it('closes on Escape, and comes back at the next end', () => {
    renderStage();
    press('End');

    press('Escape');
    expect(recap()).toBeNull();

    press('ArrowLeft');
    press('End');
    expect(recap()).not.toBeNull();
  });

  it('leaves Escape to an open dialog', () => {
    renderStage();
    press('End');

    const dialog = document.createElement('dialog');
    document.body.append(dialog);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    dialog.remove();

    expect(recap()).not.toBeNull();
  });
});

describe('stories', () => {
  it('renders the picker, and reports a choice', () => {
    const onSelect = vi.fn();
    renderStage({ stories: { options: STORIES, selectedId: 'ping', onSelect } });

    fireEvent.click(screen.getByRole('button', { name: /Lost reply/ }));
    expect(onSelect).toHaveBeenCalledWith('lost');
  });

  it('puts what the story teaches under "What you’ll learn"', () => {
    renderStage({ stories: { options: STORIES, selectedId: 'ping', onSelect: vi.fn() } });

    const summary = screen.getByText('What you’ll learn'.replace('’', "'"));
    // Lazy: the list is not in the document until the disclosure is opened.
    expect(screen.queryByText(STORIES[0]!.teaches![0]!)).toBeNull();

    fireEvent.click(summary);
    expect(screen.getByText(STORIES[0]!.teaches![0]!)).toBeInTheDocument();
  });

  it('shows no "What you’ll learn" for a story that teaches nothing listed', () => {
    renderStage({ stories: { options: STORIES, selectedId: 'lost', onSelect: vi.fn() } });
    expect(screen.queryByText("What you'll learn")).toBeNull();
  });
});

describe('the input and deprecated slots', () => {
  it('renders the input in the stage header, and the old slots where they were', () => {
    renderStage({
      input: <label>Name to look up</label>,
      controlPanel: <p>old control panel</p>,
      footer: <p>old footer</p>,
    });

    expect(screen.getByText('Name to look up')).toBeInTheDocument();
    expect(screen.getByText('old control panel')).toBeInTheDocument();
    expect(screen.getByText('old footer')).toBeInTheDocument();
  });
});

describe('Experiment', () => {
  it('is closed, and not mounted, in Simple', () => {
    renderStage({ experiment: <p>message size knob</p> });

    expect(screen.getByText('Experiment')).toBeInTheDocument();
    expect(screen.queryByText('message size knob')).toBeNull();

    fireEvent.click(screen.getByText('Experiment'));
    expect(screen.getByText('message size knob')).toBeInTheDocument();
  });

  it('is open by default in Full detail, and stays closed once closed', () => {
    renderStage({ experiment: <p>message size knob</p> }, { detail: 'full' });
    expect(screen.getByText('message size knob')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Experiment'));
    expect(screen.queryByText('message size knob')).toBeNull();
  });
});

describe('Go deeper', () => {
  const rendered: string[] = [];
  const tab = (id: string, extra: Partial<DeeperTab> = {}): DeeperTab => ({
    id,
    title: `Tab ${id}`,
    render: () => {
      rendered.push(id);
      return <p>content of {id}</p>;
    },
    ...extra,
  });
  const DEEPER = [
    tab('nat', { level: 'advanced', title: 'Address swap (NAT)' }),
    tab('hops', { hint: 'Every router passes the message one step on.' }),
    tab('layers'),
  ];

  function matchLg() {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  }

  it('mounts only the active tab, and orders advanced tabs last with a tag', () => {
    matchLg();
    rendered.length = 0;
    renderStage({ deeper: DEEPER });

    const section = within(screen.getByRole('region', { name: 'Go deeper' }));
    const tabs = section.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Tab hops',
      'Tab layers',
      'Address swap (NAT)Advanced',
    ]);

    expect(section.getByText('content of hops')).toBeInTheDocument();
    expect(
      section.getByText('Every router passes the message one step on.'),
    ).toBeInTheDocument();
    expect(section.queryByText('content of layers')).toBeNull();
    expect(new Set(rendered)).toEqual(new Set(['hops']));

    fireEvent.click(tabs[2]!);
    expect(section.getByText('content of nat')).toBeInTheDocument();
    expect(section.queryByText('content of hops')).toBeNull();
  });

  it('is a tab beside Steps and Details below lg, mounted only when chosen', () => {
    rendered.length = 0;
    renderStage({ deeper: DEEPER });

    expect(screen.queryByRole('region', { name: 'Go deeper' })).toBeNull();
    const list = within(screen.getByRole('tablist', { name: 'About this run' }));
    expect(list.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Steps',
      'Details',
      'Go deeper',
    ]);
    expect(rendered).toEqual([]);

    fireEvent.click(list.getByRole('tab', { name: 'Go deeper' }));
    expect(screen.getByText('content of hops')).toBeInTheDocument();
  });
});

describe('the phone tabs', () => {
  it('start on Steps, move with the arrow keys, and open Details when something is chosen', () => {
    renderStage();

    const list = within(screen.getByRole('tablist', { name: 'About this run' }));
    const steps = list.getByRole('tab', { name: 'Steps' });
    const details = list.getByRole('tab', { name: 'Details' });
    expect(steps).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Steps' })).toBeInTheDocument();

    fireEvent.keyDown(steps, { key: 'ArrowRight' });
    expect(details).toHaveAttribute('aria-selected', 'true');
    expect(details).toHaveFocus();

    fireEvent.keyDown(details, { key: 'Home' });
    expect(steps).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(steps, { key: 'End' });
    expect(details).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(details, { key: 'ArrowLeft' });
    expect(steps).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(steps, { key: 'a' });
    expect(steps).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByTestId('rf__node-router'));
    expect(details).toHaveAttribute('aria-selected', 'true');
  });

  it('carry no tab roles at lg, where the panels sit side by side', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    renderStage();

    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tabpanel')).toBeNull();
    expect(screen.getByRole('region', { name: 'Steps' })).toBeInTheDocument();
  });
});

describe('help', () => {
  it('opens from the "?" button with the module’s own lines', () => {
    renderStage({ help: ['Drag the map to look around.'] });

    fireEvent.click(screen.getByRole('button', { name: 'How to use this page' }));
    const dialog = within(screen.getByRole('dialog', { name: 'How to use this page' }));
    expect(dialog.getByText('Drag the map to look around.')).toBeInTheDocument();
  });

  it('is not offered by a compact view, whose transport does not stick', () => {
    const { container } = render(<SimulationView simulation={RUN} compact />);

    expect(screen.queryByRole('button', { name: 'How to use this page' })).toBeNull();
    expect(container.querySelector('.sticky')).toBeNull();
  });

  it('opens on the ? key', () => {
    renderStage();
    act(() => press('?'));
    expect(
      screen.getByRole('dialog', { name: 'How to use this page' }),
    ).toBeInTheDocument();
  });
});
