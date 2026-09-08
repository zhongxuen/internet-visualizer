import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

/**
 * jsdom does not implement matchMedia. Every module in this product reads
 * `prefers-reduced-motion`, so stub it here rather than in each test.
 */
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

/**
 * jsdom implements no layout, and React Flow measures everything it draws: the canvas
 * viewport, each node, and every handle on it. Without a `ResizeObserver` it never
 * records handle bounds, and an edge whose endpoints have no bounds is not rendered at
 * all — so a visualization test would silently assert against a diagram with no links in
 * it. These stubs exist to make the component tree mount, not to fake a layout engine:
 * every measured box is still zero-sized, so anything about real geometry belongs in the
 * phase-14 Playwright suite, in a browser that actually lays out.
 */
function entryFor(target: Element): ResizeObserverEntry {
  const contentRect = target.getBoundingClientRect();
  const box: readonly ResizeObserverSize[] = [
    { blockSize: contentRect.height, inlineSize: contentRect.width },
  ];

  return {
    target,
    contentRect,
    borderBoxSize: box,
    contentBoxSize: box,
    devicePixelContentBoxSize: box,
  };
}

class ResizeObserverStub implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  /**
   * Report once, on the next microtask. That single callback is what makes React Flow
   * record handle bounds -- and it has to be deferred: a real observer fires after paint,
   * by which point React Flow has stored the container element it measures against.
   * Reporting synchronously from `observe()` runs inside the node's own effect, before
   * the parent's, and the measurement is silently dropped.
   *
   * Deferred means a test asserting on edges has to `await` something; `findBy*` or
   * `waitFor` is the normal way.
   */
  observe(target: Element): void {
    queueMicrotask(() => this.callback([entryFor(target)], this));
  }

  unobserve(): void {}

  disconnect(): void {}
}

/**
 * jsdom reports every element as zero-sized, and React Flow treats a zero-sized node as
 * one it has not measured yet: it refuses to record handle bounds for it, and an edge
 * whose endpoints have no handle bounds is never rendered. Reporting the inline size the
 * canvas already asked for is enough to get past that gate.
 */
const FALLBACK_BOX = { width: 100, height: 100 };

function inlineSize(element: HTMLElement, axis: 'width' | 'height'): number {
  return parseFloat(element.style[axis]) || FALLBACK_BOX[axis];
}

Object.defineProperties(HTMLElement.prototype, {
  offsetWidth: {
    configurable: true,
    get(this: HTMLElement) {
      return inlineSize(this, 'width');
    },
  },
  offsetHeight: {
    configurable: true,
    get(this: HTMLElement) {
      return inlineSize(this, 'height');
    },
  },
});

Element.prototype.getBoundingClientRect = function getBoundingClientRect(this: Element) {
  const width = this instanceof HTMLElement ? inlineSize(this, 'width') : 0;
  const height = this instanceof HTMLElement ? inlineSize(this, 'height') : 0;

  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
};

/** React Flow reads `m22` off this to recover the current zoom from a CSS transform. */
class DOMMatrixReadOnlyStub {
  readonly m22 = 1;
  constructor(readonly transform?: string) {}
}

Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: ResizeObserverStub,
});

Object.defineProperty(window, 'DOMMatrixReadOnly', {
  writable: true,
  value: DOMMatrixReadOnlyStub,
});

/**
 * The canvas, loaded eagerly here.
 *
 * In the product `SimulationCanvas` comes through `next/dynamic` (`viz/LazyCanvas.tsx`),
 * which keeps React Flow's ~80 KB off the first load of every module and lesson route.
 * That is a *bundling* decision, and jsdom has no bundle: all it inherits is the extra
 * tick before the component exists, which under Vitest's parallel workers turns every
 * query for the diagram into a race -- the same test passing alone and timing out in a
 * full run.
 *
 * So the split is swapped out here for the real component. The tests then exercise
 * exactly what ships, minus an asynchrony that only exists to make a network request
 * cheaper. The dynamic path itself is covered where it is real: Playwright, against a
 * production build, in `e2e/`.
 *
 * `SimulationCanvasSlot` is the name `SimulationView` renders, and it is the name this
 * has to provide: the whole module is replaced, so an export the module has and this
 * object does not is a mocker error at the point of use rather than a missing component.
 * Substituting the canvas here also substitutes the error boundary the real slot wraps
 * it in, which is the right trade -- the failure that boundary exists for is a chunk
 * that never arrives, and there are no chunks in jsdom.
 */
vi.mock('@/components/viz/LazyCanvas', async () => {
  const { SimulationCanvas } = await import('@/components/viz/SimulationCanvas');
  return { SimulationCanvasSlot: SimulationCanvas };
});
