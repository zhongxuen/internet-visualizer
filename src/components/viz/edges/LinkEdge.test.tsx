import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { DetailLevel } from '@/components/prefs';
import { renderWithPreferences } from '@/components/prefs/testing';
import type { SimLink, Topology } from '@/core/types/topology';

import { SimulationCanvas } from '../SimulationCanvas';

import { LINK_MEDIA } from './media';

/**
 * Like the node tests, edges are exercised through the canvas: an edge's geometry, focus
 * behaviour, and label portal all come from React Flow.
 *
 * React Flow only draws an edge once both endpoints have been measured, which in jsdom
 * happens on the deferred `ResizeObserver` callback stubbed in `tests/setup.ts` — hence
 * the `await` in every helper here.
 *
 * The pill with the numbers is always there in Full detail, which `renderLink` pins; the
 * `in Simple detail` block covers the pill that waits to be asked for.
 */
function topologyWith(link: Partial<SimLink>): Topology {
  return {
    nodes: [
      { id: 'a', kind: 'client', label: 'Laptop' },
      { id: 'b', kind: 'router', label: 'Home router' },
    ],
    links: [{ id: 'l', from: 'a', to: 'b', latencyMs: 5, ...link }],
  };
}

async function renderLink(link: Partial<SimLink> = {}, detail: DetailLevel = 'full') {
  const result = renderWithPreferences(
    <SimulationCanvas topology={topologyWith(link)} />,
    { detail },
  );
  const edge = await screen.findByTestId('rf__edge-l');
  return { ...result, edge };
}

describe('LinkEdge', () => {
  it('always shows the latency, because it is what sets the pace of the hop', async () => {
    await renderLink();
    expect(screen.getByText('5 ms')).toBeInTheDocument();
  });

  it('shows bandwidth only when the scenario states it', async () => {
    await renderLink();
    expect(screen.queryByText(/b\/s/)).toBeNull();

    const { unmount } = await renderLink({ bandwidthMbps: 100 });
    expect(screen.getByText('100 Mb/s')).toBeInTheDocument();
    unmount();

    await renderLink({ bandwidthMbps: 10_000 });
    expect(screen.getByText('10 Gb/s')).toBeInTheDocument();
  });

  it('gives the medium a dash pattern and an icon, not just a colour', async () => {
    const { edge } = await renderLink({ medium: 'wifi' });

    expect(edge.querySelector('.react-flow__edge-path')).toHaveStyle({
      strokeDasharray: LINK_MEDIA.wifi.dash,
    });
    // The chip is too narrow for the word, so the word lives in its tooltip.
    expect(screen.getByTitle('Wi-Fi')).toBeInTheDocument();
  });

  it('draws an unstated medium solid and unlabelled', async () => {
    const { edge } = await renderLink();

    const path = edge.querySelector<SVGPathElement>('.react-flow__edge-path');
    expect(path?.style.strokeDasharray).toBe('');
    for (const token of Object.values(LINK_MEDIA)) {
      expect(screen.queryByTitle(token.label)).toBeNull();
    }
  });

  it('gives every medium a distinct stroke, so the wire type survives greyscale', () => {
    const strokes = Object.values(LINK_MEDIA).map(
      (token) => `${token.dash ?? 'solid'}/${token.width}`,
    );
    expect(new Set(strokes).size).toBe(strokes.length);
  });

  it('is a tab stop named for both its ends and the cost of the hop', async () => {
    const { edge } = await renderLink({ medium: 'fiber', bandwidthMbps: 1000 });

    expect(edge).toHaveAttribute('tabindex', '0');
    expect(edge).toHaveAccessibleName(
      'Link from Laptop to Home router. Fiber. 5 ms one-way latency. 1000 megabits per second',
    );
  });

  it('is selectable by pointer', async () => {
    const { edge } = await renderLink();

    // `fireEvent`, not `userEvent`: a full pointer sequence reaches d3-zoom's mousedown
    // handler, which dereferences the `view` jsdom leaves null. React Flow selects on
    // `click`, so the single event is what matters here.
    fireEvent.click(edge.querySelector('.react-flow__edge-interaction')!);

    await waitFor(() => expect(screen.getByTestId('rf__edge-l')).toHaveClass('selected'));
  });

  describe('in Simple detail', () => {
    it('keeps the numbers back, but always shows the medium', async () => {
      await renderLink({ medium: 'fiber', bandwidthMbps: 1000 }, 'simple');
      expect(screen.queryByText('5 ms')).toBeNull();
      expect(screen.queryByText('1 Gb/s')).toBeNull();
      // Dash pattern on the stroke, and the icon at the midpoint: never colour alone.
      expect(screen.getByTitle('Fiber')).toBeInTheDocument();
      expect(screen.getByTitle('Fiber').querySelector('svg')).not.toBeNull();
    });

    it('draws nothing at the midpoint of a link with no stated medium', async () => {
      const { container } = await renderLink({}, 'simple');
      expect(container.querySelector('[data-link-numbers]')).toBeNull();
      expect(screen.queryByText('5 ms')).toBeNull();
    });

    it('shows the numbers while the pointer is on the link', async () => {
      const { edge } = await renderLink({ medium: 'wifi', bandwidthMbps: 400 }, 'simple');
      act(() => {
        edge.dispatchEvent(new Event('pointerenter'));
      });
      expect(await screen.findByText('5 ms')).toBeInTheDocument();
      expect(screen.getByText('400 Mb/s')).toBeInTheDocument();
      act(() => {
        edge.dispatchEvent(new Event('pointerleave'));
      });
      await waitFor(() => expect(screen.queryByText('5 ms')).toBeNull());
    });

    it('shows the numbers while the link has keyboard focus', async () => {
      const { edge } = await renderLink({ medium: 'wifi' }, 'simple');
      act(() => {
        edge.focus();
      });
      expect(await screen.findByText('5 ms')).toBeInTheDocument();
      act(() => {
        edge.blur();
      });
      await waitFor(() => expect(screen.queryByText('5 ms')).toBeNull());
    });

    it('shows the numbers while the link is selected', async () => {
      const { edge } = await renderLink({ medium: 'ethernet' }, 'simple');
      fireEvent.click(edge.querySelector('.react-flow__edge-interaction')!);
      expect(await screen.findByText('5 ms')).toBeInTheDocument();
    });

    it('keeps the numbers in the accessible name either way', async () => {
      const { edge } = await renderLink(
        { medium: 'fiber', bandwidthMbps: 1000 },
        'simple',
      );
      expect(edge).toHaveAccessibleName(
        'Link from Laptop to Home router. Fiber. 5 ms one-way latency. 1000 megabits per second',
      );
    });
  });
});
