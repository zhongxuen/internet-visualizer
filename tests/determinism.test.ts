import { describe, expect, it } from 'vitest';

import {
  DIAGNOSTIC_PATHS,
  LOOKUP_EXAMPLES,
  METHOD_NOTES,
  REGISTRATION_RECORDS,
  runLookup,
  runPing,
  runRegistrationLookup,
  runTraceroute,
  type ProbeMethod,
} from '@/modules/network-diagnostics';
import {
  EMBEDDABLE_MODULE_IDS,
  loadEmbeddableScenarios,
  type EmbeddableScenario,
} from '@/modules/scenarios';

/**
 * The determinism guard: every scenario in the codebase, run twice, deep-equal.
 *
 * ## Why this is the load-bearing test of the whole product
 *
 * "No database. Every module is a deterministic client-side simulation" is not a
 * performance note, it is the thing that makes the rest of the architecture legal. A
 * lesson embeds a module's *own* run rather than a recording of it, so a lesson's prose
 * is only true if that run is the same run every time. Scrubbing the timeline backwards
 * is exact because the whole picture is derived from `virtualTime` rather than
 * accumulated -- which only holds if re-deriving is free of surprises. And a scenario is
 * checked into the repo as data precisely so that "what happened" is a property of the
 * file, not of when you opened it.
 *
 * One `Math.random()` or one `Date.now()` anywhere under a `sim/` folder breaks all
 * three at once, silently, and every existing test would still pass: a module's own
 * suite asserts on one run, and one run is self-consistent no matter how it was
 * produced. Only running the same scenario twice can see it.
 *
 * ## Why it lives in `tests/` rather than in any module
 *
 * It is the one test that has to know about every module at once, and
 * `eslint.config.mjs` forbids a module from importing another. `src/modules/scenarios.ts`
 * is the manifest that exists for exactly this reason, and using it here has a second
 * benefit: the list is not written down. A module that adds a scenario is covered
 * without an edit to this file, and a module that adds a *catalogue* is covered by
 * adding it there.
 *
 * ## Network Diagnostics is enumerated by hand
 *
 * It is the one ready module with no scenario catalogue -- its Learn mode is a tool
 * chosen against a fixture, so a run is named by a pair rather than by an id, and
 * `scenarios.ts` says at length why inventing an id space for it would be worse than
 * leaving it out. Left at that, though, the module with the live network flag would be
 * the one module whose simulations no determinism test ever ran, so its four entry
 * points are crossed with their fixtures below.
 */

/** Both halves of a comparison, plus enough evidence that it compared something. */
function expectDeterministic<T>(
  label: string,
  run: () => T,
  weight: (value: T) => number,
) {
  const first = run();
  const second = run();

  /*
   * `toStrictEqual`, not `toEqual`: a field that is `undefined` in one run and absent in
   * the other is a difference a consumer can see -- `'field' in pdu` and
   * `Object.keys(...)` both change -- and `toEqual` treats the two as the same.
   */
  expect(second, `${label} is not deterministic`).toStrictEqual(first);

  /*
   * A run of nothing is trivially equal to a run of nothing. This is the assertion that
   * stops a scenario that quietly stopped producing anything from passing as stable.
   */
  expect(weight(first), `${label} produced an empty run`).toBeGreaterThan(0);
}

/**
 * Every catalogue, resolved before collection starts.
 *
 * Top-level `await`, deliberately. Each entry in the manifest is an `import()`, and the
 * alternative -- one `it` that loops over every scenario -- reports "some scenario in
 * some module drifted" and stops at the first one. Resolving here lets each scenario be
 * its own named test, so a failure says which one, and the rest still run.
 */
const CATALOGUES = await Promise.all(
  EMBEDDABLE_MODULE_IDS.map(
    async (moduleId) =>
      [moduleId, (await loadEmbeddableScenarios(moduleId)) ?? []] as const,
  ),
);

describe('every module scenario is deterministic', () => {
  it('found a catalogue for every embeddable module', () => {
    expect(CATALOGUES.map(([moduleId]) => moduleId)).toEqual(EMBEDDABLE_MODULE_IDS);
    for (const [moduleId, scenarios] of CATALOGUES) {
      expect(scenarios.length, `${moduleId} publishes no scenarios`).toBeGreaterThan(0);
    }
  });

  for (const [moduleId, scenarios] of CATALOGUES) {
    describe(moduleId, () => {
      for (const scenario of scenarios as readonly EmbeddableScenario[]) {
        it(`${scenario.id} runs the same twice`, () => {
          expectDeterministic(
            `${moduleId}/${scenario.id}`,
            () => scenario.run(),
            /*
             * Events rather than phases: the Network Map's scenario is a topology and
             * its timeline comes from the guided tour, so phases are the one thing every
             * catalogue does not agree on. Every run emits events.
             */
            (visualized) => visualized.result.events.length,
          );
        });
      }
    });
  }
});

/**
 * Network Diagnostics, tool by fixture.
 *
 * Every combination the Learn-mode UI can reach, because the pairs are what that module
 * has instead of scenario ids. `METHOD_NOTES` is keyed by `ProbeMethod`, so the
 * traceroute sweep picks up a new probe method without an edit here.
 */
describe('network-diagnostics Learn mode is deterministic', () => {
  const probeMethods = Object.keys(METHOD_NOTES) as ProbeMethod[];

  /**
   * All four Learn-mode runs end in a `SimResult`, because all four are drawn by the
   * same `SimulationView` the other nine modules use. Weighing them by their event count
   * is therefore the same measure the scenario sweep above uses, not a second one.
   */
  const eventCount = (run: { result: { events: readonly unknown[] } }) =>
    run.result.events.length;

  for (const path of DIAGNOSTIC_PATHS) {
    it(`ping over ${path.id} runs the same twice`, () => {
      expectDeterministic(
        `ping/${path.id}`,
        () => runPing(path),
        (run) => run.probes.length,
      );
    });

    for (const method of probeMethods) {
      it(`traceroute (${method}) over ${path.id} runs the same twice`, () => {
        expectDeterministic(
          `traceroute/${method}/${path.id}`,
          () => runTraceroute(path, { method }),
          eventCount,
        );
      });
    }
  }

  for (const example of LOOKUP_EXAMPLES) {
    it(`lookup of ${example.name} ${example.type} runs the same twice`, () => {
      expectDeterministic(
        `lookup/${example.name}/${example.type}`,
        () => runLookup(example),
        eventCount,
      );
    });
  }

  for (const record of REGISTRATION_RECORDS) {
    it(`registration lookup of ${record.id} runs the same twice`, () => {
      expectDeterministic(
        `rdap/${record.id}`,
        () => runRegistrationLookup(record),
        (run) => run.whois.length + run.rdap.length,
      );
    });
  }
});
