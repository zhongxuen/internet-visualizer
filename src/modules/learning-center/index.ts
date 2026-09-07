/**
 * The Learning Center's public surface.
 *
 * The three routes under `src/app/learn/` import from here and from nowhere deeper.
 * Note that another *module* may not import any of this (`eslint.config.mjs`); shared
 * code belongs in `@/core` or `@/components`.
 *
 * **Nothing in this module can reach a network.** A lesson is MDX, a quiz is local
 * state, progress is `localStorage`, and from phase 13.2 an embedded simulation is the
 * same deterministic client-side scenario the module it belongs to runs. There is no
 * `fetch` anywhere under this folder and there is no reason for one to appear: the
 * Learning Center teaches the protocols, it does not speak them.
 *
 * **Progress is `localStorage` and nothing else.** No account, no backend, no PII --
 * the stored keys are lesson slugs and quiz ids, all of them public strings in this
 * repository. `resetProgress()` deletes it, and the control that calls it is on the
 * `/learn` index where anyone can find it.
 */

export { LearningCenterModule } from './LearningCenterModule';
export { LEARNING_CENTER_ID, learningCenterMeta, learningCenterRoute } from './meta';

export { EmbeddedSim, type EmbeddedSimProps } from './components/EmbeddedSim';
export { Glossary, type GlossaryProps } from './components/Glossary';
export {
  KeyTakeaways,
  MAX_TAKEAWAYS,
  MIN_TAKEAWAYS,
  type KeyTakeawaysProps,
} from './components/KeyTakeaways';
export { LessonLayout, type LessonLayoutProps } from './components/LessonLayout';
export { LessonNav, type LessonNavProps } from './components/LessonNav';
export {
  LessonScopeContext,
  useLessonScope,
  type LessonScope,
} from './components/LessonScope';
export { LESSON_COMPONENTS } from './components/lessonComponents';
export { ProgressReset, type ProgressResetProps } from './components/ProgressReset';
export { Quiz, type QuizKind, type QuizOption, type QuizProps } from './components/Quiz';
export { Term, type TermProps } from './components/Term';
export { TrackList, type TrackListProps } from './components/TrackList';

export {
  GLOSSARY,
  lookupTerm,
  sortedGlossary,
  type GlossaryTerm,
} from './content/glossary';
export {
  getLesson,
  LESSONS,
  type LessonMeta,
  type LessonReference,
} from './content/lessons';
export {
  lessonSlugsWithContent,
  loadLessonContent,
  type LessonContent,
} from './content/load';
export {
  allLessonParams,
  firstLessonOf,
  glossaryHref,
  learnHref,
  lessonHref,
  lessonPath,
  lessonPosition,
  lessonsInTrack,
  trackAnchorId,
  trackHref,
  type LessonPosition,
} from './content/navigation';
export { getTrack, TRACKS, trackOfLesson, type Track } from './content/tracks';

export {
  markLessonComplete,
  recordAnswer,
  rememberLessonPosition,
  resetProgress,
} from './progress/actions';
export {
  completedCount,
  createProgressStore,
  EMPTY_PROGRESS,
  hasAnyProgress,
  isLessonComplete,
  lessonRecord,
  parseProgress,
  progressStore,
  PROGRESS_STORAGE_KEY,
  PROGRESS_VERSION,
  quizRecord,
  recordQuizAnswer,
  rememberPosition,
  setLessonComplete,
  totalCompleted,
  type LessonRecord,
  type ProgressState,
  type ProgressStore,
  type QuizRecord,
} from './progress/store';
export {
  useLessonComplete,
  useProgress,
  useQuizRecord,
  useTrackProgress,
  type TrackProgress,
} from './progress/useProgress';
