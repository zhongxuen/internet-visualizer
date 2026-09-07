import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadEmbeddableScenario, type EmbeddableScenario } from '@/modules/scenarios';

import { EmbeddedSim } from './EmbeddedSim';

/**
 * The embed has two jobs and this suite is those two jobs.
 *
 * It has to show the module's own run -- the real diagram, the real controls, the real
 * scenario text -- so a lesson cannot say something the module contradicts. And it has
 * to fail *legibly*, because lessons are written ahead of the modules they teach and an
 * author needs to be told which half of `module`/`scenario` was wrong.
 *
 * Everything is queried the way a reader reaches it: by role and by accessible name.
 * The step-by-step list in particular is asserted through the a11y tree rather than by
 * text, because "readable with the animation off" is the requirement, and text that a
 * screen reader cannot reach does not satisfy it.
 */

/** The reference embed: a real module, a real scenario, resolved the way the UI does. */
const MODULE = 'dns-explorer';
const SCENARIO = 'cold-cache';

let cold: EmbeddableScenario;

beforeEach(async () => {
  cold = (await loadEmbeddableScenario(MODULE, SCENARIO))!;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The caption is where every text assertion belongs -- the panels above repeat it. */
function caption() {
  // Reached by tag rather than by role: <figcaption> has no implicit role, and giving
  // it one would put a landmark in the middle of a lesson's prose.
  const element = screen.getByRole('figure').querySelector('figcaption');
  return within(element as HTMLElement);
}

describe('EmbeddedSim', () => {
  it('plays the module’s own scenario, with working controls', async () => {
    render(<EmbeddedSim module={MODULE} scenario={SCENARIO} />);

    // Resolved asynchronously: the catalogue is a lazy import, so a lesson that embeds
    // nothing carries none of it.
    expect(await screen.findByRole('figure')).toBeInTheDocument();

    expect(screen.getByText(cold.title)).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: new RegExp(cold.title) }),
    ).toBeInTheDocument();

    // Phase 04's composition, not a copy of it.
    expect(screen.getByRole('slider', { name: 'Playback position' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Phases' })).toBeInTheDocument();
  });

  it('says outright that nothing here touches a network', async () => {
    render(<EmbeddedSim module={MODULE} scenario={SCENARIO} />);
    await screen.findByRole('figure');

    expect(screen.getByText('Simulated')).toBeInTheDocument();
  });

  it('links back to the module the scenario belongs to', async () => {
    render(<EmbeddedSim module={MODULE} scenario={SCENARIO} />);
    await screen.findByRole('figure');

    expect(screen.getByRole('link', { name: /DNS Explorer/ })).toHaveAttribute(
      'href',
      '/dns-explorer',
    );
  });

  describe('with the animation never played', () => {
    it('carries the scenario’s own summary and what it teaches', async () => {
      render(<EmbeddedSim module={MODULE} scenario={SCENARIO} />);
      await screen.findByRole('figure');

      // The module's sentence, not a second one written for the lesson: that is the
      // whole point of resolving through the shared catalogue.
      expect(caption().getByText(cold.summary)).toBeInTheDocument();

      const teaches = caption().getByRole('list', {
        name: 'What this simulation demonstrates',
      });
      for (const point of cold.teaches) {
        expect(within(teaches).getByText(point)).toBeInTheDocument();
      }
    });

    it('writes the run out phase by phase, in order', async () => {
      render(<EmbeddedSim module={MODULE} scenario={SCENARIO} />);
      await screen.findByRole('figure');

      const steps = caption().getByRole('list', { name: 'What happens, step by step' });
      const items = within(steps).getAllByRole('listitem');

      const phases = cold.run().result.phases;
      expect(items).toHaveLength(phases.length);
      items.forEach((item, index) => {
        expect(item).toHaveTextContent(phases[index].title);
      });
    });

    /**
     * Not a `<details>`, on purpose. Collapsed disclosure content is removed from the
     * accessibility tree, and a screen-reader user is one of the two audiences this
     * text exists for -- so it is always in the tree, never behind a toggle.
     */
    it('never hides that text behind a disclosure', async () => {
      render(<EmbeddedSim module={MODULE} scenario={SCENARIO} />);
      await screen.findByRole('figure');

      expect(caption().queryByRole('group', { hidden: true })).not.toBeInTheDocument();
      expect(
        caption().getByRole('list', { name: 'What happens, step by step' }),
      ).toBeVisible();
    });
  });

  describe('focus', () => {
    it('accepts a node id, and a comma-separated list of them', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      render(<EmbeddedSim module={MODULE} scenario={SCENARIO} focus="stub, resolver" />);
      await screen.findByRole('figure');

      // Both are real machines in this run, so nothing was dropped.
      expect(warn).not.toHaveBeenCalled();
    });

    it('drops an id the run never touched, and says so in development', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      render(<EmbeddedSim module={MODULE} scenario={SCENARIO} focus="not-a-machine" />);
      await screen.findByRole('figure');

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('not-a-machine'));
      // The embed still renders. A mistyped focus is an authoring slip, not a reason to
      // deny a reader the simulation.
      expect(
        screen.getByRole('slider', { name: 'Playback position' }),
      ).toBeInTheDocument();
    });
  });

  describe('when the lesson was written ahead of the module', () => {
    it('names a module that does not exist at all', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      render(<EmbeddedSim module="cdn-explorer" scenario="cache-hit" />);

      expect(await screen.findByText(/not available yet/i)).toBeInTheDocument();
      expect(screen.getByText(/cdn-explorer/)).toBeInTheDocument();
      expect(screen.queryByRole('figure')).not.toBeInTheDocument();
    });

    /**
     * A real, finished module that simply publishes no catalogue -- Network Diagnostics
     * names its runs by tool and fixture rather than by scenario id. Telling an author
     * "no such module" there would send them looking for a typo that is not one.
     */
    it('distinguishes a module that exists but cannot be embedded', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      render(<EmbeddedSim module="network-diagnostics" scenario="ping" />);

      expect(
        await screen.findByText(/Network Diagnostics cannot play "ping"/),
      ).toBeInTheDocument();
      expect(screen.getByText(/does not publish scenarios/)).toBeInTheDocument();
    });

    it('lists what a real module does offer when the scenario id is wrong', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      render(<EmbeddedSim module={MODULE} scenario="warm-caches" />);

      expect(
        await screen.findByText(/DNS Explorer cannot play "warm-caches"/),
      ).toBeInTheDocument();
      // Every id it does offer, including the near-miss it was probably meant to be.
      expect(
        screen.getByText(
          'cold-cache, warm-cache, cname-chain, cdn-lookup, nxdomain, dnssec-validated',
        ),
      ).toBeInTheDocument();
    });
  });
});
