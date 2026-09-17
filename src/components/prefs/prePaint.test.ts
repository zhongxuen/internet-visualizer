import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PREFERENCES_KEY, parsePreferences } from './preferences';
import { applyPreferenceAttributes, PRE_PAINT_SCRIPT } from './prePaint';

const root = document.documentElement;

function attributes() {
  return {
    detail: root.getAttribute('data-detail'),
    motion: root.getAttribute('data-motion'),
    textSize: root.getAttribute('data-text-size'),
  };
}

function osReducesMotion(reduce: boolean) {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? reduce : false,
    media: query,
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

let restoreMatchMedia: (() => void) | undefined;

beforeEach(() => {
  window.localStorage.clear();
  root.removeAttribute('data-detail');
  root.removeAttribute('data-motion');
  root.removeAttribute('data-text-size');
});

afterEach(() => {
  restoreMatchMedia?.();
  restoreMatchMedia = undefined;
  vi.restoreAllMocks();
});

function store(value: unknown) {
  window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(value));
}

describe('applyPreferenceAttributes', () => {
  it('writes the defaults for a first visit', () => {
    applyPreferenceAttributes(PREFERENCES_KEY);
    expect(attributes()).toEqual({
      detail: 'simple',
      motion: 'full',
      textSize: 'normal',
    });
  });

  it('writes what is stored', () => {
    store({ version: 1, detail: 'full', motion: 'reduced', textSize: 'large' });
    applyPreferenceAttributes(PREFERENCES_KEY);
    expect(attributes()).toEqual({
      detail: 'full',
      motion: 'reduced',
      textSize: 'large',
    });
  });

  it('writes the defaults over bad JSON, without throwing', () => {
    window.localStorage.setItem(PREFERENCES_KEY, '{"version":1,');
    expect(() => applyPreferenceAttributes(PREFERENCES_KEY)).not.toThrow();
    expect(attributes()).toEqual({
      detail: 'simple',
      motion: 'full',
      textSize: 'normal',
    });
  });

  it('writes the defaults when storage cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    applyPreferenceAttributes(PREFERENCES_KEY);
    expect(attributes()).toEqual({
      detail: 'simple',
      motion: 'full',
      textSize: 'normal',
    });
  });

  it('resolves "system" motion against the OS, as MotionProvider does', () => {
    restoreMatchMedia = osReducesMotion(true);
    applyPreferenceAttributes(PREFERENCES_KEY);
    expect(attributes().motion).toBe('reduced');

    store({ version: 1, motion: 'full' });
    applyPreferenceAttributes(PREFERENCES_KEY);
    expect(attributes().motion).toBe('full');
  });

  it('treats a missing matchMedia as no request to reduce', () => {
    restoreMatchMedia = osReducesMotion(false);
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    applyPreferenceAttributes(PREFERENCES_KEY);
    expect(attributes().motion).toBe('full');
  });

  /*
   * The function repeats `parsePreferences`'s rules for three fields because it cannot
   * call it (see its header). This table is what keeps the two copies the same.
   */
  it.each([
    ['nothing', null],
    ['bad JSON', '{'],
    ['an array', '[]'],
    ['a future version', JSON.stringify({ version: 2, detail: 'full' })],
    ['an unversioned object', JSON.stringify({ detail: 'full' })],
    [
      'every field valid',
      JSON.stringify({
        version: 1,
        detail: 'full',
        motion: 'reduced',
        textSize: 'large',
      }),
    ],
    [
      'every field invalid',
      JSON.stringify({ version: 1, detail: 'pro', motion: 'fast', textSize: 'huge' }),
    ],
    [
      'a mix',
      JSON.stringify({ version: 1, detail: 'full', motion: 1, textSize: 'large' }),
    ],
    ['motion set to follow the OS', JSON.stringify({ version: 1, motion: 'system' })],
  ])('agrees with parsePreferences for %s', (_label, raw) => {
    if (raw !== null) window.localStorage.setItem(PREFERENCES_KEY, raw);
    applyPreferenceAttributes(PREFERENCES_KEY);

    const parsed = parsePreferences(raw);
    expect(attributes()).toEqual({
      detail: parsed.detail,
      // The OS stub in tests/setup.ts never asks for reduced motion.
      motion: parsed.motion === 'reduced' ? 'reduced' : 'full',
      textSize: parsed.textSize,
    });
  });
});

describe('PRE_PAINT_SCRIPT', () => {
  /** Run the text the way the browser will: as a script with no module around it. */
  function runInline() {
    new Function(PRE_PAINT_SCRIPT)();
  }

  it('is self-contained: it runs with nothing from this module in scope', () => {
    store({ version: 1, detail: 'full', motion: 'reduced', textSize: 'large' });
    runInline();
    expect(attributes()).toEqual({
      detail: 'full',
      motion: 'reduced',
      textSize: 'large',
    });
  });

  it('reads the product key', () => {
    expect(PRE_PAINT_SCRIPT).toContain(JSON.stringify(PREFERENCES_KEY));
  });

  it('cannot throw into the page, whatever the environment', () => {
    const setAttribute = vi
      .spyOn(Element.prototype, 'setAttribute')
      .mockImplementation(() => {
        throw new Error('no document yet');
      });
    expect(runInline).not.toThrow();
    setAttribute.mockRestore();
  });

  it('cannot close the <script> element it is inlined into', () => {
    expect(PRE_PAINT_SCRIPT.toLowerCase()).not.toContain('</script');
  });

  it('writes only the three attributes, and nothing to storage', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const before = [...root.attributes].map((attribute) => attribute.name);
    runInline();
    const added = [...root.attributes]
      .map((attribute) => attribute.name)
      .filter((name) => !before.includes(name));

    expect(added.sort()).toEqual(['data-detail', 'data-motion', 'data-text-size']);
    expect(setItem).not.toHaveBeenCalled();
  });
});
