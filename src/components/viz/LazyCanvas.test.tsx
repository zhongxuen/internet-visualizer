import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * `tests/setup.ts` replaces this module for every other test in the suite -- the split
 * is a bundling decision and jsdom has no bundle, so the mock swaps the lazy canvas for
 * the real one and every module test renders a diagram synchronously. This file is the
 * one that needs the module itself, so it opts out.
 */
vi.unmock('@/components/viz/LazyCanvas');

const { CanvasBoundary } = await import('./LazyCanvas');

/**
 * The claim being checked is the one in `viz/README.md` and in CLAUDE.md: a canvas that
 * cannot load costs the picture and not the module. `TopologyList` and the event log
 * carry the same run as text, so the diagram is the one part of a `SimulationView` that
 * may be lost on its own -- and without a boundary a failed chunk would instead reach
 * the route's `error.tsx` and take the whole module down with it.
 */
function Thrower(): never {
  throw new Error('Loading chunk 7 failed');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CanvasBoundary', () => {
  it('renders its child when nothing goes wrong', () => {
    render(
      <CanvasBoundary>
        <p>the diagram</p>
      </CanvasBoundary>,
    );

    expect(screen.getByText('the diagram')).toBeInTheDocument();
  });

  it('replaces a child that throws with a note, and does not rethrow', () => {
    // React logs the caught error itself; silenced so a passing run stays readable.
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() =>
      render(
        <CanvasBoundary>
          <Thrower />
        </CanvasBoundary>,
      ),
    ).not.toThrow();

    expect(screen.getByRole('status')).toHaveTextContent(/diagram could not be loaded/i);
  });

  it('points at the two places the same run is still readable', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <CanvasBoundary>
        <Thrower />
      </CanvasBoundary>,
    );

    // Not decoration: the fallback has to say where the information went, because a
    // reader who cannot see the diagram has no other way to know it is still there.
    expect(screen.getByRole('status')).toHaveTextContent(/topology list/i);
    expect(screen.getByRole('status')).toHaveTextContent(/event log/i);
  });
});
