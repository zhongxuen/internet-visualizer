# `src/core/text` — plain-language helpers

Pure functions and data for the plain voice (docs/implementation/uiux.md §5.1): the
sentences a beginner reads beside the technical text, never instead of it.

- `kinds.ts` — `PLAIN_KINDS`, one plain role per `NodeKind`, with the product's single
  agreed analogy where §5.1.1 gives one. `plainRoleOf(node)` prefers a node's own
  `plainRole`.
- `humanScale.ts` — `describeDuration`, `describeSize`, `fibreDistanceKm`: a delay, a
  size or a distance as something a person can picture. Each comparison is a
  simplification and gets a `docs/ACCURACY.md` row when a screen first shows it.
- `plain.ts` — `wordCount`, `sentences`, `findUnglossedJargon` and `checkPlainStory`, the
  countable half of the plain-language rules. A test calls `checkPlainStory` on a `plain`
  field and expects `[]`.

Nothing here decides how text is shown; that is the viz layer's business. The only
import outside this folder is the glossary, which is how jargon is known to be defined.
