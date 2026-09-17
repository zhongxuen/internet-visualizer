# `src/components/viz` — the visualization layer

Everything that turns a simulation into something you can look at. Built in phase 04
(`docs/implementation/04-visualization-layer.md`).

The payoff: **building a module means writing a scenario, not writing animation code.**
A module renders one `SimulationView` -- the Stage (`docs/implementation/uiux-spec.md`
§5.3, built in UX-2.3) -- hands it a run and its stories, and gets the story picker, the
canvas, packets, the step caption, the transport bar, the keyboard map, the details
panel, the step list, and the event log.

## Rules

- **Renders, never simulates.** Nothing in here owns a clock or a timer, and exactly one
  file owns a `requestAnimationFrame` loop (`hooks/usePlayback.ts` —
  `tests/single-raf-loop.test.ts` fails if a second one appears). Components take the
  state of an instant and draw it. That is what keeps "visualization logic stays separated
  from networking logic" true rather than aspirational, and it is why scrubbing backwards
  costs nothing.
- **One number drives the picture.** `virtualTime` moves; `projectAt` turns it into a
  `VisualState`; components render that. No accumulated animation state exists anywhere,
  so seeking to `t` and playing to `t` produce the same frame — asserted, not assumed.
- **Colour is never the only signal.** Node state is a colour *and* an icon *and* a word
  *and* an outline shape. Link medium is a dash pattern *and* an icon. OSI layer is a
  colour *and* its `L2`..`L7` short label. Anything added here inherits that rule; see
  `nodes/state.ts` and `edges/media.ts` for the tables that enforce it, and
  `tests/non-colour-signals.test.ts`, which fails if two entries in any of those tables
  become indistinguishable in greyscale.
- **Recession is a colour, not an alpha.** `opacity-45` on a not-yet-reached row blends
  its text toward the surface and takes `text-fg-muted` from 6.4:1 to 2.3:1 — which is how
  every colour-contrast failure in the phase-14 axe pass got there. Use the `.state-dim`
  class from `src/app/globals.css`; it applies `--text-dim`, the dimmest value that still
  clears 4.5:1 on all three surfaces, and it never goes on a row that is also drawing a
  selection tint.
- **The canvas is never the only route in.** `SimulationView` renders `TopologyList`
  below the diagram and `StepCaption` beside it -- the view's one `aria-live` region -- so
  the network is readable and the run followable with no pointer at all. A new visual affordance has to answer "and how is this
  reached from a keyboard" before it ships.
- **No literal colours, including the library's.** React Flow ships its own greys through
  `--xy-*` custom properties; `SimulationCanvas` rebinds every one it uses to a token from
  `src/styles/tokens.css`.
- **The domain model travels by value.** A node's `data` carries the `SimNode` itself, not
  a flattened copy, so an address on screen cannot disagree with the scenario.
- **Reduced motion removes tweening, never content.** Packets snap to the endpoints of
  their link, playback never autostarts, and the phase stepper becomes the way through the
  run. Every fact stays on screen and every control stays operable.
- **The canvas arrives late in the product, and eagerly in a test.** `SimulationCanvas`
  loads through `next/dynamic` (`LazyCanvas`), so on a real page there is a moment between
  mount and the chunk landing when the rest of the view is up and the diagram is not --
  which costs nothing, because `TopologyList` and every control are server-rendered as
  before. In jsdom there is no bundle to split, so `tests/setup.ts` swaps the split for the
  real component; the dynamic path is covered where it is real, by Playwright against a
  production build. Do not reintroduce the asynchrony into unit tests: it was worth six
  failures that only appeared under parallel workers.
- **A frame costs no render.** Playback moves `virtualTime` sixty times a second, but
  almost nothing on screen changes that often: node highlights, the phase, the pinned
  notes and how much of the log has been reached all change only when the playhead
  crosses an event -- a few dozen times in a whole run. `projectionKey` in
  `core/sim/project.ts` collapses that to one number, `useVisibleState` memoizes on it,
  and everything downstream keeps its identity in between. Packet position is the one
  genuinely continuous thing, and it does not go through React at all: `PacketSprite`
  subscribes to the `FrameClock` and writes its own `transform`. Anything new that would
  re-render on every frame has to justify itself the same way -- before the phase-14
  performance pass, playback on `/packet-journey` measured 2.2 fps under a 4x CPU
  throttle, and all of it was React reconciling a diagram that had not changed.
- **Pure things stay pure.** `layout.ts`, `graph.ts`, `packetPath.ts`, `keymap.ts`,
  `events.ts`, and `time.ts` are plain functions over data and are unit-tested without
  mounting anything. Put logic there, not in a component, whenever it is expressible as
  data in and data out.

## Map

| File                 | What it owns                                                   |
| -------------------- | -------------------------------------------------------------- |
| `SimulationView`     | the Stage: the composed layout every module uses, and the only state there is |
| `stage.ts`           | the Stage contract (`StoryOption`, `StoriesProp`, `DeeperTab`) and its pure decisions: story names, the "More stories" split, tab order, the caption's words |
| `StoryPicker`        | the one scenario picker: a row of up to five toggles at `lg`, a select below it |
| `useScenarioParam`   | the selected story in `?scenario=`, read without making the route dynamic |
| `StepCaption`        | the current step in one large sentence -- and the view's one `aria-live` region |
| `StartOverlay`       | "Watch it happen", over the canvas until the first play or seek |
| `RunRecap`           | "What just happened", over the canvas at the end of a run |
| `StageHelp`          | "How to use this page": the `?` button and key, and its dialog |
| `SimulationCanvas`   | the React Flow surface: pan, zoom, selection, tokens, zones, and a camera that frames the whole map or follows the action |
| `CameraToggle`       | "Show whole map" / "Follow the action", a 44px button in the canvas corner |
| `CanvasLegend`       | the "Key" popover: the kinds present, what a packet is, link media, state meanings |
| `LazyCanvas`         | the canvas behind `next/dynamic` (React Flow is ~80 KB and off the first load) and behind an error boundary, so a chunk that never arrives costs the picture and not the module |
| `frameClock.ts`      | the playhead, readable without a render; how a packet moves      |
| `layout.ts`          | placement by zone, then by hops within a zone (a long zone wraps to two rows); the camera's framing arithmetic |
| `graph.ts`           | `Topology` → React Flow nodes/edges, handle sides, aria labels  |
| `nodes/kinds.ts`     | icon, role word, plain role (from `core/text/kinds.ts`), layer, and silhouette per `NodeKind` |
| `nodes/zones.tsx`    | zone kinds and their icons, and `ZoneLayer`: labelled backdrops that never take focus |
| `nodes/state.ts`     | colour + icon + word + outline per `NodeState`                  |
| `nodes/*Node.tsx`    | one component per family of kinds, over a shared `NodeShell`    |
| `edges/media.ts`     | dash pattern + icon per `LinkMedium`                            |
| `edges/LinkEdge`     | a `SimLink`: latency, bandwidth, medium, focus halo, its packets |
| `PacketSprite`       | a PDU along its link — no timer ever, and no render per frame   |
| `packetPath.ts`      | the point and heading at `t` along a drawn bezier, arithmetically |
| `PacketLayerStack`   | the encapsulation stack, outermost first, each layer expandable |
| `HeaderTable`        | header fields: name, value, bit width, teaching note            |
| `Inspector`          | the "Details" region: the selected node, link, or PDU in plain words, with everything technical in a "Technical details" disclosure |
| `Timeline`           | the scrubber, with a focusable marker per step at `lg`          |
| `PlaybackControls`   | the transport: Back, Play, Next step, speed menu, "Pause after each step", shortcuts |
| `PhaseStepper`       | the steps of the run; the primary navigation under reduced motion |
| `TopologyList`       | "The map as a list": the canvas as tab-through buttons; the non-pointer route into the topology |
| `EventLog`           | "Everything that happened": the whole run as text, closed by default and mounted only while open; click any line to seek |
| `KeyboardLegend`     | the printed keyboard map, rendered from `keymap.ts`             |
| `keymap.ts`          | the one keyboard table: what the handler reads and the legend prints |
| `events.ts`          | `SimEvent` → one line of log text                               |
| `time.ts`            | printing virtual milliseconds                                   |
| `hooks/useSimulation`| scenario → `SimResult`, once                                    |
| `hooks/usePlayback`  | the Zustand store over `core/sim/playback.ts`, and **the** rAF loop |
| `hooks/usePlaybackKeys` | binds the keyboard map, and hands keys back to the focused element |
| `hooks/useVisibleState` | `projectAt` plus the reduced-motion policy, memoized per cursor |
| `hooks/useMediaQuery` | a media query through `useSyncExternalStore`; roles and mount points only, never layout |
| `display.ts`         | view preferences that cross the canvas: hidden addresses, dimmed nodes, and `DetailContext` (Simple or Full) |

Adding a `NodeKind` to `src/core/types/topology.ts` fails to compile until it is given an
entry in `nodes/kinds.ts` and a renderer in `nodes/index.ts`. That is deliberate.

## What a module can reach into

`SimulationView` is composed, not forked. These let a module change what it shows
without touching the layout, and all of them default to showing nothing extra:

- **The Stage slots** (`./stage.ts`) — `stories` (the scenarios, for `StoryPicker`; keep
  the choice in the URL with `useScenarioParam`), `input` (the thing a viewer types, when
  that is the module), `experiment` (knobs, in a disclosure open by default only in Full
  detail), `deeper` (tabs below the stage; only the active one's `render()` is called, and
  `advanced` ones go last) and `help` (lines for "How to use this page").
- **`inspectorExtra`** — appended to the details panel.
- **`controlPanel` / `footer`** — deprecated, and removed in UX-4.3. They still render
  where they always did, above the canvas and under the transport, while modules move
  onto the slots above.

Every slot renders inside `PlaybackContext`, so its content can call
`usePlaybackContext()` and read or seek the playhead; that is how a module builds its own
playback-aware controls without this component growing a prop per module.
- **`selection` / `onSelect`** — take ownership of what is selected. Needed whenever
  something other than a click moves the selection (a guided tour) or something outside
  the canvas has to know what it is (a details section about the selected machine).
- **`focusNodeIds`** — aim the camera at a few machines. The one imperative thing on the
  canvas, because "where the view is pointing" is genuinely not a function of virtual
  time. Emptying it hands the camera back to its mode (whole map, or following the action)
  rather than always fitting the whole diagram; the pan is skipped under reduced motion.
- **`AddressVisibilityContext` / `DimmedNodesContext`** (`display.ts`) — hide addressing
  on the node cards, or push machines into the background. Contexts rather than props
  because they cross the React Flow tree, which has no channel from a module down to an
  individual node. Neither removes anything: a hidden address is still in the `SimNode`,
  in the Details panel, and in the node's accessible name, and a dimmed machine is still
  drawn, still clickable, and still in the tab order.

## Keyboard

One map, every module, printed by `KeyboardLegend` and interpreted by `matchPlaybackKey`
— both from the same table, so a shortcut cannot exist without being documented.

| Key                 | Action                            |
| ------------------- | --------------------------------- |
| `Space`             | play / pause                      |
| `→` / `←`           | next step / back one step         |
| `Shift` + `→` / `←` | step one event                    |
| `Home` / `End`      | jump to start / end               |
| `1`–`5`             | speed 0.25× / 0.5× / 1× / 2× / 4× |
| `.`                 | replay this step                  |
| `?`                 | how to use this page (`StageHelp`; not while typing) |

`shouldIgnoreKey` hands a press back whenever the focused element already owns it: text
fields keep every key, the scrubber keeps its own arrows and `Home`/`End`, and a focused
button keeps `Space`.
