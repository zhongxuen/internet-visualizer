# Learning Center

The curriculum. Lessons are MDX; the simulations inside them are the same scenarios the
modules run, so a lesson cannot drift out of sync with the thing it teaches.

Phase 13.1 built the framework and one lesson, 13.2 added `EmbeddedSim`, and 13.3 wrote
the seven tracks and the thirty-three lessons in them and flipped the registry entry to
`'ready'`.

Two tests guard the content, and they ask different questions. `content/coverage.test.ts`
asks whether the curriculum teaches what the spec promised -- every string in
`SPEC_LEARNING_TOPICS` must appear in some lesson's `topics`, and no lesson may invent a
topic no module declares. `content/authoring.test.ts` asks whether each lesson is shaped
the way the phase requires: one `h1`, at least one `EmbeddedSim` naming a scenario that
really exists, at least one `Quiz`, three to five takeaways last, and no more than 150
words of prose between two visual elements.

## Where things live

```
content/
  tracks.ts        # the seven paths. TRACKS[].lessons IS the ordering.
  lessons.ts       # per-lesson metadata. No .mdx import -- see below.
  navigation.ts    # every URL this module emits, and prev/next
  glossary.ts      # one term list, read by <Term> and by /learn/glossary
  load.ts          # the ONLY file that imports a .mdx
  lessons/*.mdx    # the prose
components/        # LessonLayout, LessonNav, TrackList, Quiz, KeyTakeaways, Term,
                   # EmbeddedSim, ...
progress/
  store.ts         # pure reducers + the localStorage-backed external store
  actions.ts       # the four things a reader can do to their own progress
  useProgress.ts   # the React side. Returns null until the browser has been read.
```

## Rules

- **Lesson metadata never imports MDX.** `lessons.ts` is plain data so the track list,
  the navigation and the coverage test can all run without compiling a lesson. `load.ts`
  holds the slug-to-import map, written out by hand rather than built from a template
  literal, so a missing file is a build error and a stray file is a test failure.
- **Ordering lives in `tracks.ts` and nowhere else.** A lesson does not name its track;
  `trackOfLesson()` derives it. One direction of reference, so the two cannot disagree.
- **Progress must not reach a server render.** `progressStore.getServerSnapshot()`
  returns `null`, and so does `getSnapshot()` until the client has read storage. Every
  consumer therefore has to say what it renders while the answer is unknown, and the
  hydration mismatch this guards against is unreachable rather than merely unlikely.
  Do not "simplify" this into `useState(() => localStorage.getItem(...))`.
- **`localStorage` only.** No account, no backend, no PII. The keys are lesson slugs and
  quiz ids. The reset control on `/learn` deletes all of it, for real.
- **One `h1` per lesson, and it is in the MDX.** `LessonLayout` draws everything around
  the prose and never the title, which is why these routes sit at `app/learn/` rather
  than inside the `(modules)` group whose shared chrome would add a second one.
- **An embedded simulation is the module's own run, never a copy of it.**
  `EmbeddedSim` resolves `module`/`scenario` through `@/modules/scenarios` and renders
  the result in a `compact` `SimulationView`. It contains no animation code and must
  not grow any: the reason a lesson embeds a live scenario rather than a screenshot is
  that it then cannot be wrong about one. A module or scenario that does not exist yet
  renders a message naming what is missing, so lessons can be written ahead of modules.
- **Every embed is complete with the animation off.** The caption under the diagram
  carries the scenario's summary, what it teaches, and every phase of the run in order,
  always rendered and never inside a `<details>` — collapsed disclosure content is not
  in the accessibility tree, and a screen-reader user is half of who that text is for.
- **A lesson imports nothing.** Capitalised tags come from `LESSON_COMPONENTS`, which
  the route passes to the compiled MDX; element styling comes from the root
  `src/mdx-components.tsx`. Adding to a lesson's vocabulary is one edit, in
  `components/lessonComponents.ts`.
- **Every option in a `Quiz` explains itself**, right and wrong alike. A quiz that only
  says "wrong" has taught nothing.
- **Authoring notes in an `.mdx` file go one per line.** Prettier's markdown printer
  escapes the `*` inside a multi-line `{/* ... */}` and turns it into a syntax error;
  consecutive single-line comments survive untouched.
- **Prose budget: ~150 words between two visual elements.** From the spec. The product
  prefers showing to telling, and a lesson is where that is hardest to hold to.
