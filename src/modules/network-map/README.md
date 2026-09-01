# `src/modules/network-map` — Network Map

An explorable map of how a network is built up, from a single home LAN to the wider
Internet. Simulated end to end: it never scans anything and contacts no real host.

Built per `docs/implementation/05-module-network-map.md`.

## Map

| File                        | What it owns                                                 |
| --------------------------- | ------------------------------------------------------------ |
| `NetworkMapModule.tsx`      | the composition root: five pieces of view state and the wiring |
| `meta.ts`                   | this module's registry id and a typed accessor                |
| `scenarios/`                | which four networks the module offers, and in what order      |
| `tour.ts`                   | the guided tour, built as a `SimResult` with no packets in it |
| `layers.ts`                 | the layer filter as data: which ids to push into the background |
| `components/ScenarioPicker` | which network you are looking at, plus its summary and topics |
| `components/LayerFilter`    | "show me just layer 2" — dims the rest, removes nothing      |
| `components/AddressToggle`  | addresses on or off, on the canvas only                       |
| `components/TopologyLegend` | what every shape means, for this scenario only                |
| `components/GuidedTour`     | the switch that makes the phase stepper drive the map         |
| `components/NodeDetailTab`  | the inspector's module section: why this machine is here      |

The route is `src/app/(modules)/network-map/page.tsx`, a server component that renders
`NetworkMapModule` and nothing else.

## The three ideas worth knowing

**The tour is a run.** A walk through a topology is an ordered list of chapters, each with
a title and an explanation — the same shape as a simulation. So `tour.ts` builds a
`SimResult` whose phases are the scenario's own notes and whose only other events light
the machine each stop is about. The phase stepper becomes the tour, the timeline becomes
its progress bar, and `→` and `Space` work with no code here. `pdus` is empty and no
`transmit` event is ever emitted: phase 06 is what sends traffic across these topologies.

**Nothing is authored twice.** The tour steps *are* `ScenarioTopology.notes`, in the order
the scenario declares them, so a machine cannot gain a note without gaining a tour stop.
The layer filter reads the kind-to-layer table in `@/components/viz`, so a new `NodeKind`
cannot be filtered into the wrong layer.

**Filters hide, they never remove.** A dimmed machine is still drawn, still clickable, and
still in the tab order; a hidden address is still in the inspector and still in the node's
accessible name. A screen reader user is never handed the reduced diagram.

## Where the scenario data actually lives

`src/core/topologies/`. The topologies are shared: phase 06 animates packets across these
same networks and phase 13 teaches from the same notes, and a module may never import
from another module (`eslint.config.mjs`). Putting them in `core` is the only arrangement
that keeps one copy — see `src/core/topologies/README.md` for the address and accuracy
rules those files follow.

The files in `scenarios/` name the scenarios this module offers and fix their order.

## What must NEVER be imported here

Anything under `src/modules/<other-module>/`. Shared code goes through `@/core` or
`@/components`.
