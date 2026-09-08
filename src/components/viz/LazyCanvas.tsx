'use client';

import dynamic from 'next/dynamic';
import { Component, type ReactNode } from 'react';

import type { SimulationCanvasProps } from './SimulationCanvas';

/**
 * `SimulationCanvas`, fetched only once a diagram is actually being drawn.
 *
 * React Flow and the node and edge components built on it are ~80 KB gzipped -- a third
 * of the phase-14 budget for a whole module route, on every module route and every
 * lesson page, whether or not the visitor ever reaches the diagram. It is the single
 * largest thing in the bundle and the only one that is genuinely optional at first
 * paint, so it is the one thing split out.
 *
 * `ssr: false` because the canvas measures itself: React Flow fits the viewport to the
 * nodes once it knows how big they are, which cannot happen during a static render. The
 * prerendered HTML held a canvas that was going to be thrown away and rebuilt on the
 * client anyway.
 *
 * ## Why this does not shift the layout
 *
 * The placeholder fills the same box. `SimulationView` gives the slot its height, the
 * canvas fills it with `h-full`, and so does the placeholder -- so the diagram arrives
 * into a space that was already the right size, and CLS stays where the measurements
 * want it. Nothing else on the page depends on the canvas having a size.
 *
 * ## What is still reachable while it loads
 *
 * Everything except the picture. The phase stepper, the timeline, the playback controls,
 * the inspector, the topology list and the event log are all server-rendered as before,
 * and `TopologyList` is the tab-through equivalent of the diagram (see `SimulationView`).
 * A visitor on a slow connection, or one who never gets the chunk at all, still has a
 * complete and operable account of the run.
 */

/** The box the canvas will fill, drawn while its chunk is on the way. */
function CanvasPlaceholder() {
  return (
    <div
      // Announced by nothing: the canvas it stands in for is itself redundant with
      // `TopologyList`, so there is no content here to promise a screen reader.
      aria-hidden="true"
      className="bg-surface border-border h-full min-h-0 w-full animate-pulse rounded-xl border"
    />
  );
}

const LazySimulationCanvas = dynamic<SimulationCanvasProps>(
  () => import('./SimulationCanvas').then((module) => module.SimulationCanvas),
  { ssr: false, loading: CanvasPlaceholder },
);

/** Shown in place of the diagram when its chunk never arrives. */
function CanvasUnavailable() {
  return (
    <div
      className="border-border bg-surface text-fg-muted flex h-full min-h-0 w-full items-center justify-center rounded-xl border border-dashed px-6 text-center text-xs leading-relaxed"
      role="status"
    >
      The diagram could not be loaded. Everything it shows is also in the topology list
      and the event log below, and the run itself is unaffected.
    </div>
  );
}

/**
 * The boundary that makes the paragraph above true.
 *
 * `next/dynamic` resolves a chunk, and a chunk can fail to arrive -- a dropped
 * connection, a proxy, a deploy that rotated the filenames under a tab left open
 * overnight. Without a boundary that rejection propagates to the route's `error.tsx` and
 * takes the whole module with it, which would be the wrong trade by a wide margin: the
 * canvas is the one part of `SimulationView` that is *redundant*, because `TopologyList`
 * renders the same topology as tab-through buttons and the log renders the same run as
 * text. Losing the picture should cost the picture.
 *
 * A class, because an error boundary can only be a class -- there is no hook for
 * `getDerivedStateFromError`. It holds one boolean, has no lifecycle beyond that, and
 * adds nothing to the render path: the per-frame work described in CLAUDE.md happens
 * below it, in `PacketSprite`, and is untouched by a component that re-renders only when
 * its children throw.
 *
 * Exported only so it can be tested. `tests/setup.ts` replaces this whole module in
 * jsdom, so the only way to reach the real boundary from a unit test is to import it by
 * name after unmocking -- see `LazyCanvas.test.tsx`. Nothing in `src/` should render it
 * directly; render {@link SimulationCanvasSlot}.
 */
export class CanvasBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? <CanvasUnavailable /> : this.props.children;
  }
}

/**
 * The canvas as every caller should use it: lazy, placeheld, and survivable.
 *
 * `SimulationView` renders this rather than `LazySimulationCanvas` directly, so no
 * module has to remember either half.
 */
export function SimulationCanvasSlot(props: SimulationCanvasProps) {
  return (
    <CanvasBoundary>
      <LazySimulationCanvas {...props} />
    </CanvasBoundary>
  );
}
