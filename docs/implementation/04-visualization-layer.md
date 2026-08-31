# 04 — Visualization layer (reusable animation components)

## Goal

The rendering half of the architecture: a set of reusable components that turn any
`SimResult` from phase 03 into an animated, inspectable, keyboard-operable
visualization. After this phase, building a new protocol module means **writing a
scenario and a scenario picker — not writing animation code.**

## Prerequisites

Phases 02 and 03.

---

## Deliverables

```
src/components/viz/
  SimulationCanvas.tsx      # React Flow surface bound to a Topology
  nodes/                    # one React Flow node type per NodeKind
    DeviceNode.tsx  ServerNode.tsx  RouterNode.tsx  DnsNode.tsx ...
  edges/
    LinkEdge.tsx            # renders latency, medium, activity
  PacketSprite.tsx          # a PDU travelling along an edge
  PacketLayerStack.tsx      # encapsulation view: nested header boxes
  HeaderTable.tsx           # header fields with bit widths + teaching notes
  Timeline.tsx              # scrubber + phase markers
  PlaybackControls.tsx      # play/pause/step/speed, fully keyboard driven
  PhaseStepper.tsx          # ordered phase list, current phase highlighted
  EventLog.tsx              # scrollable log, click to seek
  Inspector.tsx             # right panel: selected node / link / PDU details
  SimulationView.tsx        # the composed default layout
src/components/viz/hooks/
  useSimulation.ts          # scenario -> SimResult (memoized)
  usePlayback.ts            # Zustand store wrapping core playback machine
  useVisibleState.ts        # SimResult + virtualTime -> what to render now
```

---

## Design

### The projection function is the heart of this phase

```ts
// pure, testable, lives in src/core/sim/project.ts (NOT in components)
projectAt(result: SimResult, t: number): VisualState
```

`VisualState` describes **what is on screen at virtual time `t`**:

```ts
interface VisualState {
  nodeStates: Record<string, 'idle' | 'processing' | 'active' | 'error'>;
  inFlight: Array<{
    pduId: string;
    linkId: string;
    from: string;
    to: string;
    progress: number; /* 0..1 */
  }>;
  currentPhase?: PhaseSummary;
  activeAnnotations: Annotation[];
  log: SimEvent[]; // events with at <= t
}
```

Put `projectAt` in `src/core` and unit-test it. React components then become thin: they
render `VisualState`, they do not compute it. Scrubbing backwards works for free because
the state is a pure function of `t`.

### Animation strategy

- The playback loop is **one** `requestAnimationFrame` driver in `usePlayback`, advancing
  `virtualTime` by `deltaMs * speed`. Individual components never own timers.
- Packet motion is positional interpolation along the edge path, driven by `progress` —
  not CSS keyframes. That keeps scrubbing, pausing, and reverse-stepping exact.
- `motion` is used for enter/exit and emphasis (highlight pulses, panel transitions),
  where interruptible tweening is genuinely better than manual math.
- Under reduced motion: `progress` snaps to 0 or 1, packets appear at endpoints, and the
  phase stepper becomes the primary navigation.

### Node and edge components

Every `NodeKind` from phase 03 gets a node component with: an icon, a label, its
addresses, a state ring (idle/processing/active/error) that is **also** shape-differentiated,
and a click target that opens it in the `Inspector`.

`LinkEdge` shows latency, optionally the medium, and pulses while traffic is on it.

### Packet rendering — the teaching payload

`PacketSprite` is a small labeled chip colored by its outermost layer.
Selecting it opens `PacketLayerStack` in the inspector: nested boxes, outermost first,
each expandable into `HeaderTable` with field name, value, bit width, and the teaching
note. Encapsulation and decapsulation at a hop animate as a box being wrapped/unwrapped.

### Timeline and controls

`PlaybackControls` keyboard map (document it in a `Kbd` legend, reuse it in every module):

| Key                 | Action                            |
| ------------------- | --------------------------------- |
| `Space`             | play / pause                      |
| `→` / `←`           | step forward / back one phase     |
| `Shift` + `→` / `←` | step one event                    |
| `Home` / `End`      | jump to start / end               |
| `1`–`5`             | speed 0.25× / 0.5× / 1× / 2× / 4× |
| `.`                 | replay current phase              |

`Timeline` is a scrubber with phase markers; markers are focusable and labeled so the
timeline is navigable without a pointer.

### The composed layout

`SimulationView` is the default arrangement every module uses:

```
+-----------------------------------------------------+
| module header (from the (modules) layout)           |
+---------------------------+-------------------------+
|                           |  PhaseStepper           |
|     SimulationCanvas      |  Inspector              |
|                           |  (selected node/PDU)    |
+---------------------------+-------------------------+
| Timeline + PlaybackControls                          |
+-----------------------------------------------------+
| EventLog (collapsible)                               |
+-----------------------------------------------------+
```

Props: `scenario`, plus optional slots for a module-specific control panel and a
module-specific inspector tab. A module that needs something unusual overrides a slot —
it does not fork the layout.

### Responsive

Below `lg`, the inspector becomes a bottom sheet and the canvas takes full width.
The canvas must be pan/zoom-able with fit-to-view; never rely on a fixed pixel viewport.

---

## Acceptance criteria

- [ ] `projectAt` is pure, in `src/core`, and unit-tested (including reverse scrubbing)
- [ ] Exactly one rAF loop exists in the codebase
- [ ] A demo route renders the phase-03 toy scenario end-to-end: packets move, nodes
      change state, timeline scrubs both directions
- [ ] Every keyboard shortcut in the table works and is discoverable via a legend
- [ ] With reduced motion on, the same scenario is fully explorable with zero tweening
- [ ] Clicking a packet opens its layer stack with real header fields
- [ ] Canvas is usable at 1280×720 and at 390px width

---

## Prompts to execute

### Prompt 4.1 — projection function

```
Read docs/implementation/04-visualization-layer.md.

Implement projectAt(result, t) -> VisualState in src/core/sim/project.ts, exactly as
specified. It must be pure and framework-free: no React imports.

Write unit tests covering t=0, mid-transmit interpolation, phase boundaries, t beyond
the end, and scrubbing backwards producing state identical to scrubbing forwards to the
same t.
```

### Prompt 4.2 — canvas, nodes, edges

```
Implement SimulationCanvas, the node components for every NodeKind, and LinkEdge in
src/components/viz/, using @xyflow/react.

Requirements: node state is shown by both color and shape/icon (never color alone),
nodes and edges are clickable and keyboard-focusable, addresses render from the SimNode,
canvas supports pan/zoom/fit-view, and all colors come from the phase-02 layer tokens.

Do not add playback yet — render a static Topology.
```

### Prompt 4.3 — packets and inspector

```
Implement PacketSprite, PacketLayerStack, HeaderTable, and Inspector per
docs/implementation/04-visualization-layer.md.

PacketSprite positions itself along an edge from a 0..1 progress value passed in as a
prop — it must not own a timer. PacketLayerStack renders the PDU layer stack outermost
first, each expandable into a HeaderTable showing field name, value, bit width, and
teaching note. Inspector shows the selected node, link, or PDU.
```

### Prompt 4.4 — playback, timeline, composed view

```
Implement usePlayback (Zustand wrapping the core playback state machine, with exactly
one requestAnimationFrame loop), useSimulation, useVisibleState, PlaybackControls,
Timeline, PhaseStepper, EventLog, and SimulationView per
docs/implementation/04-visualization-layer.md.

Implement the full keyboard map from the phase doc plus a Kbd legend. Respect the
reduced-motion policy from phase 02. Add a temporary /demo route wiring the phase-03 toy
scenario through SimulationView, and confirm forward playback, reverse scrubbing, phase
stepping, and speed control all work.
```
