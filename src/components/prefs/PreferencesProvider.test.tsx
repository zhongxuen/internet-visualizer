import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useReducedMotionSafe } from '@/components/motion';

import { PREFERENCES_KEY } from './preferences';
import {
  PreferencesProvider,
  useDetail,
  usePauseAtSteps,
  usePreference,
} from './PreferencesProvider';
import { renderWithPreferences } from './testing';

function Probe() {
  const detail = useDetail();
  const pauseAtSteps = usePauseAtSteps();
  const [textSize, setTextSize] = usePreference('textSize');
  const [, setDetail] = usePreference('detail');
  const { reduced } = useReducedMotionSafe();

  return (
    <div>
      <span data-testid="detail">{detail}</span>
      <span data-testid="pause">{String(pauseAtSteps)}</span>
      <span data-testid="text-size">{textSize}</span>
      <span data-testid="reduced">{String(reduced)}</span>
      <button onClick={() => setDetail('full')}>Full detail</button>
      <button onClick={() => setTextSize('large')}>Large text</button>
    </div>
  );
}

const text = (id: string) => screen.getByTestId(id).textContent;

function storeFull() {
  window.localStorage.setItem(
    PREFERENCES_KEY,
    JSON.stringify({ version: 1, detail: 'full', textSize: 'large' }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  delete document.documentElement.dataset.detail;
  delete document.documentElement.dataset.textSize;
  delete document.documentElement.dataset.motion;
  vi.restoreAllMocks();
});

describe('the hooks', () => {
  it('default to Simple, normal text and pausing at steps', () => {
    render(<Probe />);
    expect(text('detail')).toBe('simple');
    expect(text('text-size')).toBe('normal');
    expect(text('pause')).toBe('true');
  });

  it('read what is stored, with or without a provider above them', () => {
    storeFull();
    render(<Probe />);
    expect(text('detail')).toBe('full');
    expect(text('text-size')).toBe('large');
    expect(text('pause')).toBe('false');
  });

  it('fall back to the defaults over bad JSON', () => {
    window.localStorage.setItem(PREFERENCES_KEY, 'full');
    render(
      <PreferencesProvider>
        <Probe />
      </PreferencesProvider>,
    );
    expect(text('detail')).toBe('simple');
  });

  it('write through to storage and re-render', async () => {
    const user = userEvent.setup();
    render(
      <PreferencesProvider>
        <Probe />
      </PreferencesProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Full detail' }));
    expect(text('detail')).toBe('full');
    expect(text('pause')).toBe('false');
    expect(JSON.parse(window.localStorage.getItem(PREFERENCES_KEY)!)).toMatchObject({
      version: 1,
      detail: 'full',
    });
  });

  it('apply a change made in another tab', () => {
    render(
      <PreferencesProvider>
        <Probe />
      </PreferencesProvider>,
    );
    expect(text('detail')).toBe('simple');

    act(() => {
      storeFull();
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: PREFERENCES_KEY,
          storageArea: window.localStorage,
        }),
      );
    });

    expect(text('detail')).toBe('full');
    expect(text('text-size')).toBe('large');
    expect(document.documentElement.dataset.detail).toBe('full');
  });
});

describe('PreferencesProvider', () => {
  it('mirrors detail and text size onto <html>, and follows changes', async () => {
    const user = userEvent.setup();
    render(
      <PreferencesProvider>
        <Probe />
      </PreferencesProvider>,
    );

    expect(document.documentElement.dataset.detail).toBe('simple');
    expect(document.documentElement.dataset.textSize).toBe('normal');

    await user.click(screen.getByRole('button', { name: 'Large text' }));
    expect(document.documentElement.dataset.textSize).toBe('large');
  });

  it('renders the defaults on the server, and hydrates without a mismatch', async () => {
    storeFull();

    // The server cannot see storage: whatever this browser holds, the HTML is Simple.
    const html = renderToString(
      <PreferencesProvider>
        <Probe />
      </PreferencesProvider>,
    );
    expect(html).toContain('>simple<');
    expect(html).toContain('>normal<');

    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);

    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const recoverable = vi.fn();
    const root = await act(async () =>
      hydrateRoot(
        container,
        <PreferencesProvider>
          <Probe />
        </PreferencesProvider>,
        { onRecoverableError: recoverable },
      ),
    );

    expect(recoverable).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    // ...and then shows what storage holds.
    expect(container.querySelector('[data-testid="detail"]')?.textContent).toBe('full');
    expect(document.documentElement.dataset.detail).toBe('full');

    act(() => root.unmount());
    container.remove();
  });
});

describe('renderWithPreferences', () => {
  it('pins the given preferences without touching storage', () => {
    renderWithPreferences(<Probe />, { detail: 'full', motion: 'reduced' });

    expect(text('detail')).toBe('full');
    expect(text('reduced')).toBe('true');
    expect(window.localStorage.length).toBe(0);
  });

  it('starts from the defaults when given nothing', () => {
    renderWithPreferences(<Probe />);
    expect(text('detail')).toBe('simple');
    expect(text('pause')).toBe('true');
  });

  it('ignores what storage holds', () => {
    storeFull();
    renderWithPreferences(<Probe />);
    expect(text('detail')).toBe('simple');
  });

  it('returns the store, so a test can change a preference mid-run', () => {
    const { preferences } = renderWithPreferences(<Probe />);
    act(() => preferences.set({ pauseAtSteps: false }));
    expect(text('pause')).toBe('false');
  });
});
