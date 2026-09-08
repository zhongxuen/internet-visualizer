/**
 * The manifest of embeddable scenarios.
 *
 * `registry.ts` says which modules exist. This file says which of their **runs** a
 * lesson may drop inline, and is the one place that knows how to turn a module's
 * scenario into the `{ topology, result }` pair `SimulationView` draws.
 *
 * ## Why it lives here and not in the Learning Center
 *
 * `eslint.config.mjs` forbids `src/modules/<a>/**` from importing `src/modules/<b>/**`,
 * dynamic `import()` included -- so `EmbeddedSim`, which is Learning Center code, cannot
 * reach DNS Explorer's scenarios itself. This file is a direct child of `src/modules/`
 * rather than a folder inside it, which makes it a sibling of `registry.ts` and not a
 * module: exactly the exemption the registry already relies on, for exactly the same
 * reason. It is a manifest that names every module, and a manifest has to.
 *
 * The rule it protects is untouched. Nothing here lets DNS Explorer learn that the HTTP
 * Explorer exists; the arrows still all point one way, out of this file.
 *
 * ## What it does not hardcode
 *
 * Scenario ids. A loader names a *module* and hands back whatever that module's exported
 * catalogue currently holds, so adding a scenario to a module makes it embeddable with
 * no edit here, and renaming one cannot leave a stale id behind. That is the phase-03
 * decision the whole Learning Center rests on -- scenarios are shared data, so a lesson
 * cannot drift out of sync with the module it teaches -- and restating a list of ids
 * here would quietly undo it.
 *
 * The uniform part of the contract is `{ id, title, summary, teaches }`. Every scenario
 * type in the project already has those four fields, which is what makes one adapter per
 * module enough; `scenarios.test.ts` asserts it stays that way.
 *
 * ## Each entry stays lazy
 *
 * A module index pulls in that module's whole composition root. A lesson embedding two
 * simulations should carry two of those and not nine, so every entry is an `import()`
 * and the resolved catalogue is cached below -- `/learn` renders the curriculum without
 * loading any of them.
 *
 * ## Network Diagnostics is deliberately absent
 *
 * It is the one ready module with no exported scenario catalogue: its Learn mode is a
 * *tool* (ping, traceroute, lookup, RDAP) chosen against a *fixture*, so a run is named
 * by a pair rather than by a scenario id. Giving it one here would mean inventing an id
 * space that the module itself does not publish -- the drift this file exists to prevent.
 * If a lesson needs it, the fix is for that module to export a catalogue of its own.
 * Until then `EmbeddedSim` says so plainly rather than guessing.
 */

import type { VisualizedRun } from '@/components/viz';

/**
 * One run a lesson can embed.
 *
 * The four description fields are the scenario's own, verbatim -- a lesson shows the
 * same sentence the module's scenario picker shows. `run` is deferred because a
 * simulation is not cheap and an embed that is never scrolled to should never cost one.
 */
export interface EmbeddableScenario {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  /** What a learner should walk away understanding, as short phrases. */
  readonly teaches: readonly string[];
  /** Run it. Deterministic: same scenario in, deep-equal run out. */
  run(): VisualizedRun;
}

/**
 * The shape every scenario type in the project already has.
 *
 * Not a base type anything extends -- the modules are independent and none of them
 * imports this file. It is the overlap, asserted structurally here and in the test, so
 * one adapter per module is all this file needs.
 */
interface DescribedScenario {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly teaches: readonly string[];
}

/** Pair a module's scenario list with the one function that runs one. */
function embeddable<S extends DescribedScenario>(
  scenarios: readonly S[],
  run: (scenario: S) => VisualizedRun,
): readonly EmbeddableScenario[] {
  return scenarios.map((scenario) => ({
    id: scenario.id,
    title: scenario.title,
    summary: scenario.summary,
    teaches: scenario.teaches,
    run: () => run(scenario),
  }));
}

type CatalogueLoader = () => Promise<readonly EmbeddableScenario[]>;

/**
 * One entry per module that publishes a scenario catalogue, in registry order.
 *
 * Written out by hand rather than derived from `MODULES`, for the reason `load.ts` gives
 * about lessons: a template-literal import would pull every module into the graph and
 * turn a typo into a runtime rejection. Written out, an id that is not here is simply
 * not embeddable, and `EmbeddedSim` can say which ones are.
 */
const LOADERS: Record<string, CatalogueLoader> = {
  'network-map': async () => {
    const { NETWORK_MAP_SCENARIOS, buildTour } = await import('./network-map');
    // The only entry whose scenario is a topology rather than a run: the Network Map
    // teaches a network standing still. The guided tour is what gives it a timeline.
    return embeddable(NETWORK_MAP_SCENARIOS, (scenario) => ({
      topology: scenario.topology,
      result: buildTour(scenario).result,
    }));
  },

  'packet-journey': async () => {
    const { PACKET_JOURNEY_SCENARIOS, runJourney } = await import('./packet-journey');
    return embeddable(PACKET_JOURNEY_SCENARIOS, (scenario) => ({
      topology: scenario.topology,
      result: runJourney(scenario),
    }));
  },

  'dns-explorer': async () => {
    const { DNS_SCENARIOS, runDnsScenario } = await import('./dns-explorer');
    return embeddable(DNS_SCENARIOS, (scenario) => runDnsScenario(scenario));
  },

  'http-explorer': async () => {
    const { HTTP_SCENARIOS, runHttpScenario } = await import('./http-explorer');
    return embeddable(HTTP_SCENARIOS, (scenario) => runHttpScenario(scenario));
  },

  'https-explorer': async () => {
    const { TLS_SCENARIOS, runTlsScenario } = await import('./https-explorer');
    return embeddable(TLS_SCENARIOS, (scenario) => runTlsScenario(scenario));
  },

  'api-visualizer': async () => {
    const { API_SCENARIOS, runApiScenario } = await import('./api-visualizer');
    return embeddable(API_SCENARIOS, (scenario) => runApiScenario(scenario));
  },

  'websocket-viewer': async () => {
    const { WEBSOCKET_SCENARIOS, runWebSocketScenario } =
      await import('./websocket-viewer');
    return embeddable(WEBSOCKET_SCENARIOS, (scenario) => runWebSocketScenario(scenario));
  },

  'internet-simulator': async () => {
    const { SIMULATOR_SCENARIOS, runPageLoad } = await import('./internet-simulator');
    return embeddable(SIMULATOR_SCENARIOS, (scenario) => runPageLoad(scenario));
  },
};

/**
 * Resolved catalogues, keyed by module id.
 *
 * Two embeds of the same module share one chunk and one set of scenario objects, which
 * matters beyond the bytes: `useSimulation` memoizes on the identity of what it is
 * handed, so a stable `EmbeddableScenario` is what keeps a re-render from re-running a
 * simulation.
 */
const catalogues = new Map<string, Promise<readonly EmbeddableScenario[]>>();

/** Module ids a lesson may embed, in registry order. */
export const EMBEDDABLE_MODULE_IDS: readonly string[] = Object.keys(LOADERS);

/** Whether this module publishes a catalogue at all. Synchronous; loads nothing. */
export function isEmbeddableModule(moduleId: string): boolean {
  return moduleId in LOADERS;
}

/**
 * Every scenario one module offers, or `undefined` if it offers none.
 *
 * `undefined` rather than a throw, and `undefined` rather than an empty array: "this
 * module cannot be embedded" and "this module has no scenarios" are different things to
 * tell an author, and the caller is a component that has to render something either way.
 *
 * A *failed* load is a third thing again, and it rejects rather than resolving to
 * `undefined` -- a chunk that did not download is a transient fault with a retry, not a
 * fact about the curriculum, and flattening it into "this module has no scenarios"
 * would put a permanent authoring error in front of a reader with a flaky connection.
 * The cache is evicted on the way past for the same reason: a rejected promise left in
 * the map is a failure remembered forever, so one dropped chunk would disable every
 * embed of that module for the life of the page.
 */
export async function loadEmbeddableScenarios(
  moduleId: string,
): Promise<readonly EmbeddableScenario[] | undefined> {
  const load = LOADERS[moduleId];
  if (!load) return undefined;

  let pending = catalogues.get(moduleId);
  if (!pending) {
    pending = load().catch((error: unknown) => {
      catalogues.delete(moduleId);
      throw error;
    });
    catalogues.set(moduleId, pending);
  }

  return pending;
}

/** One scenario by module and id; `undefined` if either half is unknown. */
export async function loadEmbeddableScenario(
  moduleId: string,
  scenarioId: string,
): Promise<EmbeddableScenario | undefined> {
  const scenarios = await loadEmbeddableScenarios(moduleId);
  return scenarios?.find((scenario) => scenario.id === scenarioId);
}
