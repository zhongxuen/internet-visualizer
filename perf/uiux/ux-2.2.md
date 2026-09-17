# UX-2.2 — a home page that starts somewhere

- **Taken:** 2026-09-17, branch `uiux/2-2` (worktree `iv-ux/2-2`), on top of `219e54e`.
- **Build:** `npm ci && npm run build`, served by `npx next start --port 3122`, started
  after the build.
- **Load on the machine:** the full vitest run in this worktree was going at the same time
  as the vitals pass, and at least one other wave-2 session was active. Read INP and long
  tasks with that in mind; LCP, CLS and bundle sizes do not depend on it.

## First-load JS — `npm run perf:bundles`

| Route         | Before (`219e54e`) | After    | Change  |
| ------------- | -----------------: | -------: | ------: |
| `/` (`index`) | 9 · 154.6 KB       | 10 · 158.1 KB | **+3.5 KB** |
| `/_not-found` | 9 · 154.6 KB       | 9 · 154.6 KB  | 0       |

"Before" is a build of `219e54e` in the main checkout, which matches the latest `/` figure in
`perf/uiux-baseline.md` (154.4 KB at the wave-1 gate, then +0.1–0.2 KB from UX-1.5). The
budget for this prompt is +5 KB, so the home page is inside it with 1.5 KB to spare. Against
the pre-restructure table at the top of the baseline (151.7 KB) it is +6.4 KB, of which
2.9 KB came from wave 1.

The added 3.5 KB is one chunk (3.7 KB gzip, 9.5 KB raw) holding the two client islands and
nothing else: `QuickStart` with `Field` and its shape check, and `StartPathProgress` with
`StartPath` and the progress store. `HeroJourney` is a server component and adds no JS. No
new dependency, and no zod: the address check is a hand-written `URL` parse. The progress hook
is imported from its own file, not from `@/modules/learning-center`, because that index pulls
in the lesson layout and the MDX loader. The 404 no longer renders the module grid, and its JS
did not change.

## Core Web Vitals — `BASE=http://127.0.0.1:3122 ROUTES=/ npm run perf:vitals`

4x CPU throttle, median of three runs.

| Route | LCP ms | LCP element | CLS | INP ms | Long tasks | JS KB |
| ----- | -----: | ----------- | --: | -----: | ---------: | ----: |
| `/`   |    492 | `H1` (text) |   0 |    336 | 5 / 609 ms | 158.1 |

- **The LCP element is still text:** the `h1`, "How does the internet actually work?". The
  hero is inline SVG and HTML, and none of it is an LCP candidate.
- **CLS is 0.** A separate browser check with two First steps lessons marked complete in
  `localStorage` recorded no `layout-shift` entries: the tick boxes are always in the layout,
  and hydrating progress changes only their visibility.
- **INP fails the 200 ms budget, as it has on every route since the baseline** (`/` was
  216 / 232 there and 840 / 464 at the UX-1.5 gate). This pass ran under a saturated CPU and
  is not evidence either way.

## Rebuilt after the SafetyBadge fix

The compact `SafetyBadge` change (a visually hidden label instead of `aria-label`) was built
and measured again: `/` 10 · 158.1 KB and `/_not-found` 9 · 154.6 KB, the same as above.
