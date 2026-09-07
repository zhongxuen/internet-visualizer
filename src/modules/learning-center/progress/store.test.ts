import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  completedCount,
  createProgressStore,
  EMPTY_PROGRESS,
  hasAnyProgress,
  isLessonComplete,
  parseProgress,
  PROGRESS_VERSION,
  quizRecord,
  recordQuizAnswer,
  rememberPosition,
  setLessonComplete,
  totalCompleted,
  type ProgressState,
} from './store';

const KEY = 'iv:test-progress';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('progress reducers', () => {
  it('marks a lesson complete and back again', () => {
    const done = setLessonComplete(EMPTY_PROGRESS, 'dns-basics', true, 1_000);
    expect(isLessonComplete(done, 'dns-basics')).toBe(true);
    expect(done.lessons['dns-basics'].completedAt).toBe(1_000);

    const undone = setLessonComplete(done, 'dns-basics', false, 2_000);
    expect(isLessonComplete(undone, 'dns-basics')).toBe(false);
  });

  /**
   * Identity, not just equality. `update()` skips the write when the reducer returns
   * the same object, so "no change" has to be expressible as "same reference" or every
   * idempotent action costs a `localStorage` write and a re-render.
   */
  it('returns the same state when nothing would change', () => {
    const done = setLessonComplete(EMPTY_PROGRESS, 'dns-basics', true, 1_000);
    expect(setLessonComplete(done, 'dns-basics', true, 9_999)).toBe(done);

    const placed = rememberPosition(EMPTY_PROGRESS, 'foundations', 'dns-basics');
    expect(rememberPosition(placed, 'foundations', 'dns-basics')).toBe(placed);
  });

  it('never mutates the state it was given', () => {
    const before = JSON.stringify(EMPTY_PROGRESS);
    setLessonComplete(EMPTY_PROGRESS, 'a', true, 1);
    recordQuizAnswer(EMPTY_PROGRESS, 'a', 'q1', true);
    rememberPosition(EMPTY_PROGRESS, 't', 'a');
    expect(JSON.stringify(EMPTY_PROGRESS)).toBe(before);
  });

  it('counts attempts up and replaces the verdict', () => {
    let state = recordQuizAnswer(EMPTY_PROGRESS, 'dns-basics', 'q1', false);
    expect(quizRecord(state, 'dns-basics', 'q1')).toEqual({
      attempts: 1,
      correct: false,
    });

    state = recordQuizAnswer(state, 'dns-basics', 'q1', true);
    expect(quizRecord(state, 'dns-basics', 'q1')).toEqual({ attempts: 2, correct: true });

    // A quiz nobody has answered is absent, not a zeroed record.
    expect(quizRecord(state, 'dns-basics', 'q2')).toBeUndefined();
  });

  it('summarises a set of lessons and the whole state', () => {
    let state = setLessonComplete(EMPTY_PROGRESS, 'a', true, 1);
    state = setLessonComplete(state, 'c', true, 2);

    expect(completedCount(state, ['a', 'b', 'c'])).toBe(2);
    expect(completedCount(state, ['b'])).toBe(0);
    expect(totalCompleted(state)).toBe(2);
  });

  /** An answered quiz is a record of the reader even with no lesson ticked. */
  it('counts a bare quiz answer as progress worth offering to delete', () => {
    expect(hasAnyProgress(EMPTY_PROGRESS)).toBe(false);
    expect(hasAnyProgress(recordQuizAnswer(EMPTY_PROGRESS, 'a', 'q1', true))).toBe(true);
    expect(hasAnyProgress(rememberPosition(EMPTY_PROGRESS, 't', 'a'))).toBe(true);
    expect(totalCompleted(recordQuizAnswer(EMPTY_PROGRESS, 'a', 'q1', true))).toBe(0);
  });
});

/**
 * The input to `parseProgress` is a string that any tab, extension, or older release of
 * this app could have written. Every shape below has to produce a usable state rather
 * than an exception, because the page that would crash is also the page carrying the
 * reset button.
 */
describe('parsing what is in storage', () => {
  it.each([
    ['nothing stored', null],
    ['not JSON', '{oops'],
    ['not an object', '"a string"'],
    ['an array', '[]'],
    ['a future version', JSON.stringify({ version: 99, lessons: { a: {} } })],
    ['a missing version', JSON.stringify({ lessons: {} })],
  ])('falls back to empty for %s', (_label, raw) => {
    expect(parseProgress(raw)).toEqual(EMPTY_PROGRESS);
  });

  it('keeps the fields it recognises and drops the ones it does not', () => {
    const state = parseProgress(
      JSON.stringify({
        version: PROGRESS_VERSION,
        lessons: {
          good: { completedAt: 5, quizzes: { q1: { attempts: 2, correct: true } } },
          partial: { completedAt: 'yesterday', quizzes: { q1: 'nope' } },
          broken: 42,
        },
        lastLesson: { foundations: 'good', bad: 7 },
        somethingElse: true,
      }),
    );

    expect(state.lessons.good).toEqual({
      completedAt: 5,
      quizzes: { q1: { attempts: 2, correct: true } },
    });
    // A field of the wrong type reverts to the default rather than taking the record
    // down with it.
    expect(state.lessons.partial).toEqual({ completedAt: null, quizzes: {} });
    expect(state.lessons.broken).toBeUndefined();
    expect(state.lastLesson).toEqual({ foundations: 'good' });
    expect(state).not.toHaveProperty('somethingElse');
  });
});

describe('the store', () => {
  it('shows the server no progress at all, whatever is in storage', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify(setLessonComplete(EMPTY_PROGRESS, 'a', true, 1)),
    );
    const store = createProgressStore(KEY);

    // The whole hydration-safety story: there is no value for a server render to draw
    // a tick from, so the server markup and the hydration markup cannot disagree.
    expect(store.getServerSnapshot()).toBeNull();
    expect(store.getSnapshot()).not.toBeNull();
  });

  it('returns a stable snapshot until something changes', () => {
    const store = createProgressStore(KEY);
    const first = store.getSnapshot();

    // Required by useSyncExternalStore: re-reading and re-parsing per call would hand
    // React a new object every render and loop forever.
    expect(store.getSnapshot()).toBe(first);

    store.update((state) => setLessonComplete(state, 'a', true, 1));
    expect(store.getSnapshot()).not.toBe(first);
  });

  it('persists across stores, which is what surviving a reload means', () => {
    const store = createProgressStore(KEY);
    store.update((state) => setLessonComplete(state, 'a', true, 1));
    store.update((state) => recordQuizAnswer(state, 'a', 'q1', true));

    const reloaded = createProgressStore(KEY);
    const state = reloaded.getSnapshot() as ProgressState;
    expect(isLessonComplete(state, 'a')).toBe(true);
    expect(quizRecord(state, 'a', 'q1')).toEqual({ attempts: 1, correct: true });
  });

  it('notifies subscribers, and only while they are subscribed', () => {
    const store = createProgressStore(KEY);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.update((state) => setLessonComplete(state, 'a', true, 1));
    expect(listener).toHaveBeenCalledTimes(1);

    // No change, no notification -- see the identity test above.
    store.update((state) => setLessonComplete(state, 'a', true, 2));
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.update((state) => setLessonComplete(state, 'b', true, 3));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('clears everything, leaving nothing behind in storage', () => {
    const store = createProgressStore(KEY);
    store.update((state) => setLessonComplete(state, 'a', true, 1));
    expect(window.localStorage.getItem(KEY)).not.toBeNull();

    store.clear();
    expect(store.getSnapshot()).toEqual(EMPTY_PROGRESS);
    // Deleted, not tombstoned: afterwards there is nothing stored.
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('picks up a write from another tab', () => {
    const store = createProgressStore(KEY);
    const listener = vi.fn();
    store.subscribe(listener);

    window.localStorage.setItem(
      KEY,
      JSON.stringify(setLessonComplete(EMPTY_PROGRESS, 'elsewhere', true, 1)),
    );
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));

    expect(listener).toHaveBeenCalled();
    expect(isLessonComplete(store.getSnapshot() as ProgressState, 'elsewhere')).toBe(
      true,
    );
  });

  /**
   * Private mode, a blocked origin, a full quota. Progress is a nicety; a lesson that
   * will not render because storage threw is a broken product.
   */
  it('keeps working when storage throws on read and on write', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    const store = createProgressStore(KEY);
    expect(store.getSnapshot()).toEqual(EMPTY_PROGRESS);

    expect(() =>
      store.update((state) => setLessonComplete(state, 'a', true, 1)),
    ).not.toThrow();
    // The session keeps its progress in memory; only durability was lost.
    expect(isLessonComplete(store.getSnapshot() as ProgressState, 'a')).toBe(true);
  });
});
