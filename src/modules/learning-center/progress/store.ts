/**
 * Learning progress: what the reader has finished, how the quizzes went, and where
 * they were.
 *
 * ## Constraints this file exists to satisfy
 *
 * **No accounts, no backend, no PII.** Progress is `localStorage` and nothing else.
 * The keys are lesson slugs and quiz ids, all of which are already public strings in
 * this repository; there is no field here in which a name, an address or anything else
 * about a person could be recorded, and that is deliberate rather than incidental.
 *
 * **Nothing here may reach a render on the server.** `getServerSnapshot()` returns
 * `null` -- not an empty state, `null` -- and so does `getSnapshot()` until the client
 * has actually read storage. A component therefore *cannot* render a tick, a count or
 * a bar during SSR or during hydration, because it has no value to render one from,
 * and the class of hydration mismatch this whole design is guarding against becomes
 * unreachable rather than merely unlikely. `null` means "not known on this render",
 * and every consumer has to say what it shows in that state.
 *
 * **Storage can fail.** Private mode, blocked cookies, a full quota, another tab
 * writing garbage under the same key. Every read is tolerant and every write is
 * swallowed: losing progress is a disappointment, but a lesson that will not render
 * because storage threw is a broken product.
 *
 * The reducers below are pure and exported so they can be tested without a DOM; the
 * store underneath them is the only stateful thing in the file.
 */

/** Bumped when the stored shape changes. A different version is discarded, not migrated. */
export const PROGRESS_VERSION = 1;

/** Namespaced like the motion preference, so one product owns one prefix. */
export const PROGRESS_STORAGE_KEY = 'iv:learning-progress';

export interface QuizRecord {
  /** How many answers the reader has submitted for this quiz. */
  attempts: number;
  /** Whether the most recent answer was the right one. */
  correct: boolean;
}

export interface LessonRecord {
  /** Epoch ms when the lesson was marked complete; `null` once it is un-marked. */
  completedAt: number | null;
  /** Keyed by the `id` the lesson gave the quiz. */
  quizzes: Record<string, QuizRecord>;
}

export interface ProgressState {
  version: number;
  lessons: Record<string, LessonRecord>;
  /** The last lesson opened in each track, keyed by track id. */
  lastLesson: Record<string, string>;
}

/** The state of a reader who has done nothing yet. Frozen: it is shared by reference. */
export const EMPTY_PROGRESS: ProgressState = Object.freeze({
  version: PROGRESS_VERSION,
  lessons: {},
  lastLesson: {},
});

const EMPTY_LESSON: LessonRecord = Object.freeze({ completedAt: null, quizzes: {} });

// --- Reading -----------------------------------------------------------------

export function lessonRecord(state: ProgressState, slug: string): LessonRecord {
  return state.lessons[slug] ?? EMPTY_LESSON;
}

export function isLessonComplete(state: ProgressState, slug: string): boolean {
  return lessonRecord(state, slug).completedAt !== null;
}

export function quizRecord(
  state: ProgressState,
  slug: string,
  quizId: string,
): QuizRecord | undefined {
  return lessonRecord(state, slug).quizzes[quizId];
}

/** How many of a given set of lessons are done. The caller supplies the track's order. */
export function completedCount(state: ProgressState, slugs: readonly string[]): number {
  return slugs.reduce(
    (total, slug) => total + (isLessonComplete(state, slug) ? 1 : 0),
    0,
  );
}

/** How many lessons are recorded as complete overall -- what the reset control reports. */
export function totalCompleted(state: ProgressState): number {
  return Object.values(state.lessons).filter((entry) => entry.completedAt !== null)
    .length;
}

/**
 * Whether there is anything stored at all.
 *
 * Deliberately broader than `totalCompleted() > 0`: a quiz answered but no lesson
 * ticked, or a track opened and left, are both records of the reader. The reset
 * control is offered whenever *any* of it exists, because "you have nothing to delete"
 * has to be true when it is said.
 */
export function hasAnyProgress(state: ProgressState): boolean {
  return (
    Object.keys(state.lessons).length > 0 || Object.keys(state.lastLesson).length > 0
  );
}

// --- Writing (pure) ----------------------------------------------------------

function withLesson(
  state: ProgressState,
  slug: string,
  update: (record: LessonRecord) => LessonRecord,
): ProgressState {
  return {
    ...state,
    lessons: { ...state.lessons, [slug]: update(lessonRecord(state, slug)) },
  };
}

/**
 * Mark a lesson done, or undo that.
 *
 * `now` is a parameter rather than a `Date.now()` call so the reducer stays pure and
 * the tests do not have to fake a clock.
 */
export function setLessonComplete(
  state: ProgressState,
  slug: string,
  complete: boolean,
  now: number,
): ProgressState {
  if (isLessonComplete(state, slug) === complete) return state;
  return withLesson(state, slug, (record) => ({
    ...record,
    completedAt: complete ? now : null,
  }));
}

/**
 * Record an answer.
 *
 * Attempts accumulate and the latest verdict replaces the previous one: this is a
 * check on understanding, not a score, so what matters is whether the reader has got
 * there *now*. Nothing in the product reads `attempts` to judge anybody -- it exists
 * so a lesson can tell "answered once" from "never opened".
 */
export function recordQuizAnswer(
  state: ProgressState,
  slug: string,
  quizId: string,
  correct: boolean,
): ProgressState {
  return withLesson(state, slug, (record) => ({
    ...record,
    quizzes: {
      ...record.quizzes,
      [quizId]: {
        attempts: (record.quizzes[quizId]?.attempts ?? 0) + 1,
        correct,
      },
    },
  }));
}

/** Remember where the reader was in a track, so the track card can offer to resume. */
export function rememberPosition(
  state: ProgressState,
  trackId: string,
  slug: string,
): ProgressState {
  if (state.lastLesson[trackId] === slug) return state;
  return { ...state, lastLesson: { ...state.lastLesson, [trackId]: slug } };
}

// --- Serialisation -----------------------------------------------------------

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseLesson(value: unknown): LessonRecord | undefined {
  if (!isRecordObject(value)) return undefined;

  const completedAt = typeof value.completedAt === 'number' ? value.completedAt : null;
  const quizzes: Record<string, QuizRecord> = {};

  if (isRecordObject(value.quizzes)) {
    for (const [quizId, entry] of Object.entries(value.quizzes)) {
      if (!isRecordObject(entry)) continue;
      quizzes[quizId] = {
        attempts: typeof entry.attempts === 'number' ? entry.attempts : 0,
        correct: entry.correct === true,
      };
    }
  }

  return { completedAt, quizzes };
}

/**
 * Turn whatever is in storage into a `ProgressState`.
 *
 * Field by field rather than a cast, and every unrecognised shape falls back to empty.
 * The input is a string any tab, extension or previous release of this app could have
 * written; trusting it would mean a stale key from an older version can crash a page
 * the reader cannot then get back to in order to clear it.
 */
export function parseProgress(raw: string | null): ProgressState {
  if (!raw) return EMPTY_PROGRESS;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_PROGRESS;
  }

  if (!isRecordObject(parsed)) return EMPTY_PROGRESS;
  // A different version is discarded rather than migrated: this is derived,
  // reproducible data, and a migration path is a liability nobody would exercise.
  if (parsed.version !== PROGRESS_VERSION) return EMPTY_PROGRESS;

  const lessons: Record<string, LessonRecord> = {};
  if (isRecordObject(parsed.lessons)) {
    for (const [slug, entry] of Object.entries(parsed.lessons)) {
      const lesson = parseLesson(entry);
      if (lesson) lessons[slug] = lesson;
    }
  }

  const lastLesson: Record<string, string> = {};
  if (isRecordObject(parsed.lastLesson)) {
    for (const [trackId, slug] of Object.entries(parsed.lastLesson)) {
      if (typeof slug === 'string') lastLesson[trackId] = slug;
    }
  }

  return { version: PROGRESS_VERSION, lessons, lastLesson };
}

// --- The store ---------------------------------------------------------------

export interface ProgressStore {
  subscribe: (listener: () => void) => () => void;
  /** `null` until the client has read storage. See the note at the top of the file. */
  getSnapshot: () => ProgressState | null;
  /** Always `null`: the server has no reader and must render no progress. */
  getServerSnapshot: () => null;
  /** Apply a pure reducer and persist the result. */
  update: (reducer: (state: ProgressState) => ProgressState) => void;
  /** Forget everything. What the reset control calls. */
  clear: () => void;
}

export function createProgressStore(storageKey = PROGRESS_STORAGE_KEY): ProgressStore {
  const listeners = new Set<() => void>();

  // Cached because `useSyncExternalStore` requires `getSnapshot` to return an
  // identical value until something actually changes -- re-reading and re-parsing on
  // every call would hand React a new object each render and loop forever.
  let cached: ProgressState | null = null;

  function emit(): void {
    for (const listener of listeners) listener();
  }

  function read(): ProgressState {
    try {
      return parseProgress(window.localStorage.getItem(storageKey));
    } catch {
      return EMPTY_PROGRESS;
    }
  }

  function current(): ProgressState {
    cached ??= read();
    return cached;
  }

  // Another tab wrote progress. Drop the cache and let the next snapshot re-read;
  // doing the parse here would run it once per open tab for a value nobody asked for.
  function onStorage(event: StorageEvent): void {
    if (event.key !== null && event.key !== storageKey) return;
    cached = null;
    emit();
  }

  function persist(next: ProgressState): void {
    cached = next;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Quota, private mode, blocked storage. The session keeps its progress in
      // `cached`; only durability is lost, and silently is the right way to lose it.
    }
    emit();
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) window.addEventListener('storage', onStorage);

      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) window.removeEventListener('storage', onStorage);
      };
    },

    getSnapshot() {
      // Guards the render that happens before `subscribe` -- and any future use of
      // this store from a non-DOM context.
      if (typeof window === 'undefined') return null;
      return current();
    },

    getServerSnapshot() {
      return null;
    },

    update(reducer) {
      const next = reducer(current());
      if (next === current()) return;
      persist(next);
    },

    clear() {
      cached = EMPTY_PROGRESS;
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        /* see persist */
      }
      emit();
    },
  };
}

/**
 * The one store the app uses.
 *
 * A module-level singleton rather than a context, because progress is genuinely global
 * to the browser tab: a tick in the track list and the same tick in the lesson footer
 * are the same fact, and threading a provider through the MDX boundary to say so would
 * buy nothing. Tests build their own with `createProgressStore()`.
 */
export const progressStore = createProgressStore();
