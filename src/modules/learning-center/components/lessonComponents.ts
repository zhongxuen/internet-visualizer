import { EmbeddedSim } from './EmbeddedSim';
import { KeyTakeaways } from './KeyTakeaways';
import { Quiz } from './Quiz';
import { Term } from './Term';

/**
 * The vocabulary a lesson may use without importing anything.
 *
 * MDX resolves a capitalised tag against the `components` prop, so this map is what
 * makes `<Quiz>` legal in a `.mdx` file. The route passes it in; the lesson has no
 * import statements at all, which is the point -- an author writes prose and drops in
 * a quiz, and never has to know where any of this lives.
 *
 * Three reasons it is here rather than in the root `mdx-components.tsx`:
 *
 *  - that file is global to every MDX surface in the app, and `<Quiz>` writing to
 *    lesson progress has no business being available outside a lesson;
 *  - a component missing from the map is a build-time failure in the file that uses
 *    it, whereas a global provider fails at render;
 *  - this is a module's public vocabulary, and modules own their own.
 *
 * Not a `'use client'` file: it is imported by the server component that renders the
 * lesson, and what it hands over are references to client components. Phase 13.2 added
 * `EmbeddedSim` to exactly this object and nothing else changed.
 */
export const LESSON_COMPONENTS = {
  EmbeddedSim,
  KeyTakeaways,
  Quiz,
  Term,
} as const;
