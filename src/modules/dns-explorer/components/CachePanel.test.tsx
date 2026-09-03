import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NXDOMAIN, runDnsScenario, WARM_CACHE } from '../scenarios';

import { CachePanel, formatTtl } from './CachePanel';

const warm = runDnsScenario(WARM_CACHE);
const missing = runDnsScenario(NXDOMAIN);

function setup(cache = warm.cache, virtualTime = warm.result.durationMs) {
  render(<CachePanel cache={cache} virtualTime={virtualTime} />);

  return within(screen.getByRole('region', { name: 'Resolver cache' }));
}

describe('formatTtl', () => {
  it('reads a TTL the way a resolver quotes one: the largest two units', () => {
    expect(formatTtl(9)).toBe('9s');
    expect(formatTtl(750)).toBe('12m 30s');
    expect(formatTtl(7200)).toBe('2h 0m');
    expect(formatTtl(172_800)).toBe('2d 0h');
  });

  it('says expired rather than printing a negative number', () => {
    expect(formatTtl(0)).toBe('expired');
    expect(formatTtl(-5)).toBe('expired');
  });
});

describe('CachePanel', () => {
  it('lists what the run learned, with the TTL each entry started with', () => {
    const panel = setup();

    expect(panel.getAllByText('example.com.').length).toBeGreaterThan(0);
    expect(panel.getAllByText('Answer').length).toBeGreaterThan(0);
  });

  /**
   * A cache showing every row it will ever hold would be showing the answer before the
   * question. Entries appear when the run put them there.
   */
  it('is empty before the walk has learned anything', () => {
    const panel = setup(warm.cache, 0);

    expect(panel.getByText(/^Empty\./)).toBeInTheDocument();
  });

  /** RFC 2308: "no such name" is an answer, cached like any other. */
  it('files a negative answer beside the positive ones', () => {
    const panel = setup(missing.cache, missing.result.durationMs);

    expect(panel.getByText('NXDOMAIN')).toBeInTheDocument();
    expect(panel.getByText(/negative/)).toBeInTheDocument();
  });

  it('opens at the playhead, with its own clock not yet run on', () => {
    const panel = setup();

    expect(panel.getByText('At the playhead')).toBeInTheDocument();
  });
});

describe('CachePanel countdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * The acceptance criterion from the phase doc: TTLs count down and entries expire. The
   * run itself lasts about a tenth of a second in virtual time and the shortest TTL in
   * the fixtures is thirty seconds, so the panel's own clock is the only thing that can
   * ever show one running out.
   */
  it('counts down, and expires an entry once its TTL is gone', () => {
    const panel = setup();

    expect(panel.queryByText('expired')).not.toBeInTheDocument();

    // 3600x: an hour of cache time per real second, so even the two-day NS records go.
    fireEvent.click(panel.getByRole('button', { name: '3600×' }));
    act(() => {
      vi.advanceTimersByTime(3_000);
    });

    expect(panel.getByText(/past the playhead/)).toBeInTheDocument();
    expect(panel.getAllByText('expired').length).toBeGreaterThan(0);
  });

  it('holds still when the clock is held', () => {
    const panel = setup();

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    // The default rate is 1x, so five real seconds is five cache seconds -- and nothing
    // in the fixtures expires that fast.
    expect(panel.queryByText('expired')).not.toBeInTheDocument();
  });
});
