import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LEGACY_MOTION_KEY, parsePreferences, PREFERENCES_KEY } from '@/components/prefs';

import { MotionProvider } from './MotionProvider';
import { useReducedMotionSafe } from './useReducedMotionSafe';

/**
 * Replaces the blanket `matchMedia` stub from tests/setup.ts with one whose
 * `prefers-reduced-motion` answer can change mid-test, so we can prove the provider
 * both reads the OS setting and keeps following it.
 */
function mockSystemReducedMotion(initial: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  let matches = initial;

  window.matchMedia = ((query: string) => ({
    get matches() {
      return query.includes('prefers-reduced-motion') ? matches : false;
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.add(listener),
    removeEventListener: (
      _type: string,
      listener: (event: MediaQueryListEvent) => void,
    ) => listeners.delete(listener),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  return {
    set(next: boolean) {
      matches = next;
      act(() => {
        for (const listener of listeners) {
          listener({ matches: next } as MediaQueryListEvent);
        }
      });
    },
  };
}

/** Durations a module would realistically hand to `scale()`. */
const FAST = 120;
const BASE = 240;
const SLOW = 600;

function Probe() {
  const { reduced, scale, preference, systemReduced, setPreference } =
    useReducedMotionSafe();

  return (
    <div>
      <span data-testid="reduced">{String(reduced)}</span>
      <span data-testid="system-reduced">{String(systemReduced)}</span>
      <span data-testid="preference">{preference}</span>
      <span data-testid="durations">
        {[FAST, BASE, SLOW].map((ms) => scale(ms)).join(',')}
      </span>
      <button onClick={() => setPreference('reduced')}>Reduced</button>
      <button onClick={() => setPreference('full')}>Full</button>
      <button onClick={() => setPreference('system')}>Follow system</button>
    </div>
  );
}

const reduced = () => screen.getByTestId('reduced').textContent;
const durations = () => screen.getByTestId('durations').textContent;

let originalMatchMedia: typeof window.matchMedia;

beforeEach(() => {
  originalMatchMedia = window.matchMedia;
  // The override is a stored preference now, so it outlives a render by design.
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  delete document.documentElement.dataset.motion;
});

describe('MotionProvider', () => {
  it('collapses every duration to zero when reduced is true', async () => {
    mockSystemReducedMotion(true);
    render(
      <MotionProvider>
        <Probe />
      </MotionProvider>,
    );

    expect(reduced()).toBe('true');
    expect(durations()).toBe('0,0,0');
  });

  it('passes durations through unchanged when motion is full', () => {
    mockSystemReducedMotion(false);
    render(
      <MotionProvider>
        <Probe />
      </MotionProvider>,
    );

    expect(reduced()).toBe('false');
    expect(durations()).toBe(`${FAST},${BASE},${SLOW}`);
  });

  it('keeps following the OS setting when it changes', () => {
    const system = mockSystemReducedMotion(false);
    render(
      <MotionProvider>
        <Probe />
      </MotionProvider>,
    );

    expect(durations()).toBe(`${FAST},${BASE},${SLOW}`);

    system.set(true);
    expect(reduced()).toBe('true');
    expect(durations()).toBe('0,0,0');
  });

  it('lets an override collapse motion the OS has not asked to reduce', async () => {
    const user = userEvent.setup();
    mockSystemReducedMotion(false);
    render(
      <MotionProvider>
        <Probe />
      </MotionProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Reduced' }));

    expect(reduced()).toBe('true');
    expect(screen.getByTestId('system-reduced')).toHaveTextContent('false');
    expect(durations()).toBe('0,0,0');
  });

  it('lets an override restore motion the OS has asked to reduce', async () => {
    const user = userEvent.setup();
    mockSystemReducedMotion(true);
    render(
      <MotionProvider>
        <Probe />
      </MotionProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Full' }));

    expect(reduced()).toBe('false');
    expect(durations()).toBe(`${FAST},${BASE},${SLOW}`);
  });

  it('returns to the OS setting when the override is cleared', async () => {
    const user = userEvent.setup();
    mockSystemReducedMotion(true);
    render(
      <MotionProvider>
        <Probe />
      </MotionProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Full' }));
    expect(reduced()).toBe('false');

    await user.click(screen.getByRole('button', { name: 'Follow system' }));
    expect(screen.getByTestId('preference')).toHaveTextContent('system');
    expect(reduced()).toBe('true');
  });

  it('restores the override on the next visit', async () => {
    const user = userEvent.setup();
    mockSystemReducedMotion(false);
    const first = render(
      <MotionProvider>
        <Probe />
      </MotionProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Reduced' }));
    first.unmount();

    render(
      <MotionProvider>
        <Probe />
      </MotionProvider>,
    );

    expect(screen.getByTestId('preference')).toHaveTextContent('reduced');
    expect(durations()).toBe('0,0,0');
  });

  it('mirrors the resolved setting onto <html> for CSS-only transitions', async () => {
    const user = userEvent.setup();
    mockSystemReducedMotion(false);
    render(
      <MotionProvider>
        <Probe />
      </MotionProvider>,
    );

    expect(document.documentElement.dataset.motion).toBe('full');

    await user.click(screen.getByRole('button', { name: 'Reduced' }));
    expect(document.documentElement.dataset.motion).toBe('reduced');
  });
});

describe('the stored override', () => {
  it('is the `motion` field of the preferences, in localStorage', async () => {
    const user = userEvent.setup();
    mockSystemReducedMotion(false);
    render(
      <MotionProvider>
        <Probe />
      </MotionProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Reduced' }));

    const stored = parsePreferences(window.localStorage.getItem(PREFERENCES_KEY));
    expect(stored.motion).toBe('reduced');
    expect(window.sessionStorage.length).toBe(0);
  });

  it('is read from the preferences a previous visit stored', () => {
    mockSystemReducedMotion(true);
    window.localStorage.setItem(
      PREFERENCES_KEY,
      JSON.stringify({ version: 1, motion: 'full' }),
    );
    render(
      <MotionProvider>
        <Probe />
      </MotionProvider>,
    );

    expect(screen.getByTestId('preference')).toHaveTextContent('full');
    expect(reduced()).toBe('false');
  });

  it('carries over the old per-tab override once, then stops reading it', () => {
    mockSystemReducedMotion(false);
    window.sessionStorage.setItem(LEGACY_MOTION_KEY, 'reduced');
    render(
      <MotionProvider>
        <Probe />
      </MotionProvider>,
    );

    expect(reduced()).toBe('true');
    expect(window.sessionStorage.getItem(LEGACY_MOTION_KEY)).toBeNull();
    expect(parsePreferences(window.localStorage.getItem(PREFERENCES_KEY)).motion).toBe(
      'reduced',
    );
  });

  it('is left alone by a provider with a pinned defaultPreference', async () => {
    const user = userEvent.setup();
    mockSystemReducedMotion(false);
    window.localStorage.setItem(
      PREFERENCES_KEY,
      JSON.stringify({ version: 1, motion: 'full' }),
    );
    render(
      <MotionProvider defaultPreference="reduced">
        <Probe />
      </MotionProvider>,
    );

    expect(reduced()).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Follow system' }));
    expect(reduced()).toBe('false');
    expect(parsePreferences(window.localStorage.getItem(PREFERENCES_KEY)).motion).toBe(
      'full',
    );
  });
});

describe('useReducedMotionSafe without a provider', () => {
  it('still honours the OS setting', () => {
    mockSystemReducedMotion(true);
    render(<Probe />);

    expect(reduced()).toBe('true');
    expect(durations()).toBe('0,0,0');
  });

  it('animates normally when the OS has no objection', () => {
    mockSystemReducedMotion(false);
    render(<Probe />);

    expect(reduced()).toBe('false');
    expect(durations()).toBe(`${FAST},${BASE},${SLOW}`);
  });
});
