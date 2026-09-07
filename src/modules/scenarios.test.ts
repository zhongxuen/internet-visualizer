import { describe, expect, it } from 'vitest';

import { MODULES, getModule, readyModules } from '@/modules/registry';

import {
  EMBEDDABLE_MODULE_IDS,
  isEmbeddableModule,
  loadEmbeddableScenario,
  loadEmbeddableScenarios,
} from './scenarios';

/**
 * The catalogue is a manifest that has to agree with two things nothing in the type
 * system connects it to: the registry, and eight independent modules' scenario lists.
 *
 * Every assertion below is a way that agreement can be broken by an edit somewhere else
 * -- a module renaming its scenario export, a scenario dropping a field the caption
 * renders, a new module shipping without being wired in -- and every one of them would
 * otherwise surface as an embed that silently falls back to "not available yet" in a
 * lesson nobody reopened.
 */
describe('the embeddable scenario catalogue', () => {
  it('names only real modules, in registry order', () => {
    for (const id of EMBEDDABLE_MODULE_IDS) {
      expect(getModule(id), `"${id}" is not in the registry`).toBeDefined();
    }

    const registryOrder = MODULES.map((entry) => entry.id).filter((id) =>
      EMBEDDABLE_MODULE_IDS.includes(id),
    );
    expect(EMBEDDABLE_MODULE_IDS).toEqual(registryOrder);
  });

  /**
   * The two exceptions, stated as assertions so each stays a decision rather than an
   * oversight.
   *
   * Network Diagnostics publishes tools and fixtures, not a scenario catalogue, so a
   * run there is named by a pair and has no id to embed -- see the note at the top of
   * `scenarios.ts`. The Learning Center is on the other side of this file entirely: it
   * is the module that *reads* catalogues, and it has no simulation of its own for
   * anything to embed.
   *
   * If either module ever exports a catalogue, delete it from this list rather than
   * loosening the check.
   */
  it('covers every ready module that publishes a scenario catalogue', () => {
    const NO_CATALOGUE = ['network-diagnostics', 'learning-center'];

    const ready = readyModules().map((entry) => entry.id);
    expect(EMBEDDABLE_MODULE_IDS).toEqual(
      ready.filter((id) => !NO_CATALOGUE.includes(id)),
    );

    for (const id of NO_CATALOGUE) {
      expect(isEmbeddableModule(id), `${id} unexpectedly publishes a catalogue`).toBe(
        false,
      );
    }
  });

  it('says no for a module it does not carry, without loading anything', () => {
    expect(isEmbeddableModule('learning-center')).toBe(false);
    expect(isEmbeddableModule('cdn-explorer')).toBe(false);
  });

  it('resolves nothing for an unknown module or an unknown scenario', async () => {
    await expect(loadEmbeddableScenarios('cdn-explorer')).resolves.toBeUndefined();
    await expect(
      loadEmbeddableScenario('cdn-explorer', 'anything'),
    ).resolves.toBeUndefined();
    await expect(
      loadEmbeddableScenario('dns-explorer', 'no-such-scenario'),
    ).resolves.toBeUndefined();
  });

  it('caches a catalogue, so two embeds of one module share its scenarios', async () => {
    const first = await loadEmbeddableScenarios('dns-explorer');
    const second = await loadEmbeddableScenarios('dns-explorer');

    // Identity, not equality. `useSimulation` memoizes on the identity of what it is
    // handed, so a fresh object per embed would re-run the simulation on every render.
    expect(first).toBe(second);
    expect(await loadEmbeddableScenario('dns-explorer', 'cold-cache')).toBe(
      first?.find((entry) => entry.id === 'cold-cache'),
    );
  });

  describe.each(EMBEDDABLE_MODULE_IDS)('%s', (moduleId) => {
    it('offers scenarios that can each be described and run', async () => {
      const scenarios = await loadEmbeddableScenarios(moduleId);
      expect(scenarios, `${moduleId} loaded no catalogue`).toBeDefined();
      expect(scenarios?.length).toBeGreaterThan(0);

      const ids = scenarios!.map((entry) => entry.id);
      expect(new Set(ids).size, `${moduleId} has duplicate scenario ids`).toBe(
        ids.length,
      );

      for (const scenario of scenarios!) {
        // The four fields the caption renders. A scenario type that drops one is a
        // compile error in `scenarios.ts`; a scenario that leaves one empty is this.
        expect(scenario.id, `${moduleId} scenario with no id`).toBeTruthy();
        expect(scenario.title, `${moduleId}/${scenario.id} has no title`).toBeTruthy();
        expect(
          scenario.summary,
          `${moduleId}/${scenario.id} has no summary`,
        ).toBeTruthy();
        expect(
          scenario.teaches.length,
          `${moduleId}/${scenario.id} teaches nothing`,
        ).toBeGreaterThan(0);

        const run = scenario.run();

        expect(
          run.topology.nodes.length,
          `${moduleId}/${scenario.id} drew an empty topology`,
        ).toBeGreaterThan(0);
        expect(
          run.result.durationMs,
          `${moduleId}/${scenario.id} has no duration`,
        ).toBeGreaterThan(0);
        // The phases are the text half of the embed: with the animation off, they are
        // the whole story. A run with none would be an embed a lesson cannot describe.
        expect(
          run.result.phases.length,
          `${moduleId}/${scenario.id} has no phases to narrate`,
        ).toBeGreaterThan(0);
        for (const phase of run.result.phases) {
          expect(
            phase.title,
            `${moduleId}/${scenario.id} has an untitled phase`,
          ).toBeTruthy();
        }
      }
    });

    it('runs deterministically, so an embed and the module agree', async () => {
      const scenarios = await loadEmbeddableScenarios(moduleId);
      const scenario = scenarios![0];

      expect(scenario.run()).toEqual(scenario.run());
    });
  });
});
