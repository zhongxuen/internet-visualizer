import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PREFERENCES,
  parsePreferences,
  resolvePauseAtSteps,
  serializePreferences,
  withValues,
} from './preferences';

describe('the defaults', () => {
  it('are what uiux.md §7.5 and §5.2 specify: Simple, following the OS, normal text', () => {
    expect(DEFAULT_PREFERENCES).toEqual({
      version: 1,
      detail: 'simple',
      motion: 'system',
      textSize: 'normal',
      pauseAtSteps: null,
      seenCoachMarks: false,
    });
  });

  it('hold no route until one is visited', () => {
    expect(DEFAULT_PREFERENCES).not.toHaveProperty('lastVisited');
  });

  it('cannot be changed by the caller they are handed to', () => {
    expect(Object.isFrozen(DEFAULT_PREFERENCES)).toBe(true);
  });
});

describe('parsePreferences', () => {
  it('reads back what it wrote', () => {
    const stored = withValues(DEFAULT_PREFERENCES, {
      detail: 'full',
      motion: 'reduced',
      textSize: 'large',
      pauseAtSteps: false,
      seenCoachMarks: true,
      lastVisited: '/packet-journey',
    });
    expect(parsePreferences(serializePreferences(stored))).toEqual(stored);
  });

  it.each([
    ['missing', null],
    ['empty', ''],
    ['not JSON', '{detail: full'],
    ['truncated', '{"version":1,"detail":"fu'],
    ['a string', '"full"'],
    ['a number', '42'],
    ['null', 'null'],
    ['an array', '[1,"full"]'],
    ['unversioned', '{"detail":"full"}'],
    ['a future version', '{"version":2,"detail":"full"}'],
    ['a stringly version', '{"version":"1","detail":"full"}'],
  ])('falls back to the defaults, by identity, when storage is %s', (_label, raw) => {
    expect(parsePreferences(raw)).toBe(DEFAULT_PREFERENCES);
  });

  it('keeps every valid field and replaces each invalid one with its default', () => {
    const raw = JSON.stringify({
      version: 1,
      detail: 'expert',
      motion: 'reduced',
      textSize: 22,
      pauseAtSteps: 'yes',
      seenCoachMarks: true,
    });
    expect(parsePreferences(raw)).toEqual({
      ...DEFAULT_PREFERENCES,
      motion: 'reduced',
      seenCoachMarks: true,
    });
  });

  it('ignores fields it does not know, including Live mode', () => {
    const raw = JSON.stringify({
      version: 1,
      detail: 'full',
      liveMode: true,
      email: 'x',
    });
    const parsed = parsePreferences(raw);
    expect(parsed).toEqual({ ...DEFAULT_PREFERENCES, detail: 'full' });
    expect(parsed).not.toHaveProperty('liveMode');
    expect(parsed).not.toHaveProperty('email');
  });

  it.each([
    'https://example.com/packet-journey',
    '/packet-journey?q=my-house',
    '/packet-journey#step-3',
    '/learn/what-is-a-network',
    'packet-journey',
    '/Packet-Journey',
    '/',
  ])('refuses %s as lastVisited: a module route and nothing else', (route) => {
    const raw = JSON.stringify({ version: 1, lastVisited: route });
    expect(parsePreferences(raw)).not.toHaveProperty('lastVisited');
  });
});

describe('withValues', () => {
  it('returns the same object when nothing changes', () => {
    expect(withValues(DEFAULT_PREFERENCES, { detail: 'simple' })).toBe(
      DEFAULT_PREFERENCES,
    );
    expect(withValues(DEFAULT_PREFERENCES, {})).toBe(DEFAULT_PREFERENCES);
  });

  it('ignores an invalid value rather than storing it', () => {
    expect(withValues(DEFAULT_PREFERENCES, { detail: 'beginner' })).toBe(
      DEFAULT_PREFERENCES,
    );
  });

  it('never lets a caller change the version', () => {
    expect(withValues(DEFAULT_PREFERENCES, { version: 7 }).version).toBe(1);
  });

  it('does not mutate the base', () => {
    const next = withValues(DEFAULT_PREFERENCES, { detail: 'full' });
    expect(next).not.toBe(DEFAULT_PREFERENCES);
    expect(DEFAULT_PREFERENCES.detail).toBe('simple');
  });
});

describe('resolvePauseAtSteps', () => {
  it('follows the detail level when unset: on in Simple, off in Full detail', () => {
    expect(resolvePauseAtSteps({ detail: 'simple', pauseAtSteps: null })).toBe(true);
    expect(resolvePauseAtSteps({ detail: 'full', pauseAtSteps: null })).toBe(false);
  });

  it('lets an explicit choice win in either mode', () => {
    expect(resolvePauseAtSteps({ detail: 'simple', pauseAtSteps: false })).toBe(false);
    expect(resolvePauseAtSteps({ detail: 'full', pauseAtSteps: true })).toBe(true);
  });

  it('is on for a new visitor', () => {
    expect(resolvePauseAtSteps(DEFAULT_PREFERENCES)).toBe(true);
  });
});
