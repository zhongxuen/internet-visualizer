# UI/UX restructure — prompts and run order

Paste the prompts below in the order of the run sheet. What they build against (the goal,
the principles, the data contracts, file ownership, the wave gate and the rules every
prompt follows) is in [uiux-spec.md](./uiux-spec.md); a § number in a prompt means a
section there.

## Run sheet

A step starts only when every step above it has finished. The prompts in a **parallel**
step may run at the same time, each in its own worktree, on its own branch and port. An
**alone** step runs in the main checkout, on `main`. Every prompt's first line repeats its
row, so a prompt pasted in the wrong place says so.

| Step | Paste | Runs | Branch · port |
| --- | --- | --- | --- |
| 0 | — (commit the plan, below) | alone | `main` |
| 1 | UX-0.1, UX-0.2 | **parallel** | `uiux/0-1` · 3101, `uiux/0-2` · 3102 |
| 2 | UX-W0 | alone | `main` · 3100 |
| 3 | UX-1.1, UX-1.2, UX-1.3, UX-1.4 | **parallel** | `uiux/1-1` … `uiux/1-4` · 3111 … 3114 |
| 4 | UX-W1 | alone | `main` · 3100 |
| 5 | UX-1.5 | alone | `main` · 3100 |
| 6 | UX-2.1 … UX-2.6 | **parallel** | `uiux/2-1` … `uiux/2-6` · 3121 … 3126 |
| 7 | UX-W2 | alone | `main` · 3100 |
| 8 | UX-3.1 … UX-3.10 | **parallel** | `uiux/3-1` … `uiux/3-9` · 3131 … 3139; `uiux/3-10` · 3130 |
| 9 | UX-W3 | alone | `main` · 3100 |
| 10 | UX-4.1, UX-4.2 | **parallel** | `uiux/4-1` · 3141, `uiux/4-2` · 3142 |
| 11 | UX-W4 | alone | `main` · 3100 |
| 12 | UX-4.3 | alone | `main` · 3100 |
| 13 | UX-4.4 | alone | `main` · 3100 |
| 14 | test with real beginners (uiux-spec.md §11) | — | the production URL |

**Step 0, once.** A worktree only sees what is committed, so commit the plan first, and
again whenever you edit it between steps.

```bash
git add docs/implementation/uiux.md docs/implementation/uiux-spec.md docs/implementation/00-overview.md
git commit -m "docs: add the UI/UX restructure plan"
```

**A parallel step.** Create one worktree per prompt, from `main`, outside OneDrive (each
grows its own `node_modules` and `.next`):

```powershell
$wt  = "$HOME\iv-ux"
$ids = '2-1','2-2','2-3','2-4','2-5','2-6'   # the step's ids from the table
foreach ($id in $ids) { git worktree add "$wt\$id" -b "uiux/$id" main }
```

Open one terminal per id, run `cd "$HOME\iv-ux\<id>"; npm ci; claude`, and paste that
id's prompt. Each one builds Next and runs Playwright, so on a laptop start three or four
and the rest as those finish. Once the step's merge prompt is green, stop their servers
and remove them (if `git worktree remove` refuses, check `git status` in that worktree
first):

```powershell
foreach ($id in $ids) { git worktree remove "$wt\$id"; git branch -d "uiux/$id" }
```

**Or run everything in sequence** in the main checkout, on `main`, with `/clear` between
prompts. At a merge step, paste the UX-W prompt with this line in front: "Sequential run:
there are no branches to merge; skip step 1 and do the rest."

---

## Prompts

Every prompt is pasted exactly as written.

### Wave 0 — step 1: UX-0.1 ∥ UX-0.2 (parallel), then step 2: UX-W0

#### Prompt UX-0.1 — adopt the beginner brief

```
[UX-0.1 · run sheet step 1 · parallel with UX-0.2 · branch uiux/0-1 · port 3101 (no server needed)]

Read docs/implementation/uiux.md and uiux-spec.md in full, then CLAUDE.md and
docs/CONTENT-STYLE.md. This prompt changes documentation only.

1. docs/CONTENT-STYLE.md:
   - Rewrite the audience paragraph under "Tone" for uiux-spec.md §2's primary reader,
     keeping "no simply / just / of course / obviously".
   - Add a "Plain story" row to the slots table, with the rules from uiux-spec.md §5.1.
   - Add a section "Analogies", containing §5.1.1's table and its rule: an analogy is
     marked with "like" and always paired with the real term. Explain how that differs
     from naming a thing after what it resembles, which stays forbidden.
   - Add the before/after table from §5.1.
   - Keep every other rule: colour and position, "as you can see", consistent protocol
     names, honest simplifications, safety language, the lesson shape.
   - Add two lines to "Before you commit": the plain slot is filled, and every acronym in
     it is glossed.
2. CLAUDE.md: in "UI philosophy", add four lines at most: the beginner-first audience, the
   two-voice rule (plain first, precise underneath, never one replacing the other), and a
   pointer to docs/implementation/uiux.md as the restructure in progress. Change no other
   section.
3. docs/implementation/00-overview.md: confirm the index row links uiux.md and
   uiux-spec.md.

Run npm run format:check. Commit "uiux(0.1): adopt the beginner brief".
```

#### Prompt UX-0.2 — baseline

```
[UX-0.2 · run sheet step 1 · parallel with UX-0.1 · branch uiux/0-2 · port 3102]

Read docs/implementation/uiux-spec.md §3, §8.2, §8.3 and §10, and perf/README.md. Change no
product code.

Capture the "before" picture the restructure is measured against.

1. Add scripts/uiux-screens.mjs and a package.json script
   "uiux:screens": "node scripts/uiux-screens.mjs", run as
   `npm run uiux:screens -- <label>` (label defaults to "baseline").
   - It drives Playwright against a production server that is already running. Like
     playwright.config.ts, it reads the port from PLAYWRIGHT_PORT (default 3100), and it
     exits with a clear message if nothing answers there.
   - It writes under <root>/.uiux/<label>/, where <root> is the MAIN checkout, not the
     current worktree: the parent directory of
     `git rev-parse --path-format=absolute --git-common-dir`. Every worktree then writes
     to, and compares against, the same .uiux/baseline. A UIUX_DIR variable overrides
     <root>.
   - For every route in e2e/routes.ts, at 1366x768 and 390x844, it:
     - saves a viewport screenshot (not full page) to
       .uiux/<label>/<viewport>/<route>.png;
     - on module routes, records three numbers:
       (a) whether the Play button is fully inside the first viewport;
       (b) how many interactive elements sit above the canvas;
       (c) the rendered height in CSS px of one node label on the canvas, i.e. the
           label's font size times the React Flow viewport's transform scale.
   - It writes those numbers to .uiux/<label>/metrics.json.
   Add .uiux/ to .gitignore.
2. Run `npm run build`, then `npx next start --port 3102` in the background, then
   `PLAYWRIGHT_PORT=3102 npm run uiux:screens -- baseline`. Confirm .uiux/baseline landed
   in the main checkout.
3. Write perf/uiux-baseline.md containing:
   - today's date and the commit hash;
   - the `npm run perf:bundles` table (first-load gzipped KB per route);
   - perf:vitals for / and every module route (LCP, CLS, playback fps), run with
     BASE=http://127.0.0.1:3102 and the ROUTES list from uiux-spec.md §8.2;
   - a table of the three module metrics above.
   State the ±0.5 fps noise on /packet-journey next to its number.

Stop the server. Commit "uiux(0.2): baseline numbers and screenshot script".
```

#### Prompt UX-W0 — merge wave 0

```
[UX-W0 · run sheet step 2 · alone, in the main checkout on main · port 3100 · after UX-0.1 and UX-0.2 have both committed]

Read docs/implementation/uiux.md (the run sheet) and docs/implementation/uiux-spec.md §8.

1. Merge uiux/0-1, then uiux/0-2, into main with `git merge --no-ff`. They own disjoint
   files, so expect no conflicts; if one appears, keep both sides' intent.
2. Read the "Needs from other prompts" list in each branch's last commit message
   (`git log main..uiux/0-2` before merging, or the merge's second parent after). Do the
   small items now; list the rest.
3. Check the baseline is in place: .uiux/baseline/metrics.json exists in this checkout,
   and perf/uiux-baseline.md has the four parts UX-0.2 lists. If the screenshots are
   missing, rebuild, start `npx next start --port 3100`, and run
   `npm run uiux:screens -- baseline` here.
4. Run the wave gate (uiux-spec.md §8.2) with label wave-0.

Commit anything you changed as "uiux(W0): merge wave 0". Report: merge order, conflicts
and how each was resolved, gate results, and open items. Put the open items in the commit
message body too; the next step reads them from there. Leave the worktrees and branches
alone; the person running the plan removes them.
```

### Wave 1 — step 3: UX-1.1 ∥ 1.2 ∥ 1.3 ∥ 1.4 (parallel), step 4: UX-W1, step 5: UX-1.5 (alone)

#### Prompt UX-1.1 — type scale and tokens

```
[UX-1.1 · run sheet step 3 · parallel with UX-1.2, UX-1.3, UX-1.4 · branch uiux/1-1 · port 3111]

Read docs/implementation/uiux-spec.md §3.5, §5.7, §6, §8.1 (row 1.1) and §8.3. Own only
those files.

Goal: nothing on screen smaller than 12px, one type scale in tokens, larger hit targets.

1. src/styles/tokens.css:
   - Add a type scale:
     --text-caption 0.75rem (the floor), --text-small 0.875rem, --text-body 1rem,
     --text-lead 1.125rem, --text-story 1.25rem, --text-title 1.875rem, --text-display
     2.75rem, each with a line height.
   - Add target sizes: --target-min 2.75rem, --target-floor 1.5rem.
   - Add radius and spacing tokens if the existing classes need them.
   - Expose everything through Tailwind 4's @theme, so text-caption, text-story and
     min-h-target exist.
   - Everything is in rem, so the "Large text" setting (html font-size 112.5%, a rule you
     add to globals.css under [data-text-size='large']) scales it all.
2. Codemod: replace every arbitrary font size below 0.75rem in src (text-[0.5rem] …
   text-[0.6875rem], about 530 uses) with text-caption.
   - Exclude the files UX-1.2 owns (ui/Tooltip.tsx, ui/index.ts, and the new files it is
     adding to src/components/ui/); it keeps its own sizes at the floor.
   - Don't redesign the dense panels; that is wave 3's job. Fix anything that now clips or
     overflows at 1366 wide or 390 wide: build, start `npx next start --port 3111`, run
     `PLAYWRIGHT_PORT=3111 npm run uiux:screens -- ux-1.1`, and compare against
     .uiux/baseline. Node cards on the canvas may grow; that is expected, and UX-2.5
     redesigns them.
3. Raise Badge and Kbd to the floor. Button sm to h-9, and md to h-11 (44px). Check first
   that no e2e test asserts a pixel size (STICKY_NAV_PX in e2e/modules.spec.ts is the
   nav's height and must stay 56).
4. Add tests/type-scale.test.ts. It scans src/**/*.{tsx,ts,css} for arbitrary font sizes
   under 0.75rem or 12px, and fails with file:line. No allowlist.
5. Add any new colour token to tests/tokens-contrast.test.ts.

Verify: lint, typecheck, npm test,
`PLAYWRIGHT_PORT=3111 npx playwright test e2e/a11y.spec.ts e2e/a11y-manual.spec.ts`.
Commit "uiux(1.1): type scale, target sizes, 12px floor".
```

#### Prompt UX-1.2 — new UI primitives

```
[UX-1.2 · run sheet step 3 · parallel with UX-1.1, UX-1.3, UX-1.4 · branch uiux/1-2 · port 3112]

Read docs/implementation/uiux-spec.md §5.3, §5.6, §5.7, §6 (Accessibility), §8.1 (row 1.2)
and §8.3. Add no dependencies.

Add these to src/components/ui/, token-styled, className merged with cn(), with target
sizes respecting --target-min / --target-floor. UX-1.1 is adding those tokens in parallel,
so use h-11 / h-6 and leave a `// --target-min` or `// --target-floor` comment beside
each; UX-W1 swaps them. Use no font size below 0.75rem in any file you own, including the
sizes already in Tooltip.tsx: UX-1.1's codemod skips your files, and its type-scale test
covers them once merged.

- Popover: the HTML `popover` attribute (top layer, light dismiss, Escape), plus a small
  positioning hook that flips and shifts to stay inside the viewport. It opens by click,
  tap, Enter and Space, sets aria-expanded and aria-controls, is non-modal, and returns
  focus to the trigger on close.
- Dialog: a native <dialog> with showModal(); title, description, close button, and focus
  returned to the opener.
- Drawer: a Dialog variant that slides from the side (or the bottom under sm), for the
  mobile nav and mobile panels.
- Disclosure: a styled <details>/<summary>, controllable, with onToggle, and a `lazy`
  prop that unmounts the content while closed. The event log's DOM-size win depends on
  that prop.
- Switch (role="switch", visible on/off text), SegmentedControl (a radio group with
  roving tabindex), Select (styled native <select>).
- Field: label, hint and error, wired with aria-describedby and aria-invalid. It replaces
  the three private Control shells in wave 3.
- Callout: info / tip / warning / safety tones, always icon plus text.
- StepDots: "Step 3 of 6" as dots, with the text always present.
- Tooltip: keep the API. Add tap-to-toggle on touch and viewport collision handling.
  Document at the top of the file: a Tooltip is for a label; anything with a link or more
  than one sentence is a Popover.

Each gets a test file covering roles, keyboard, Escape, and focus return. Export them from
ui/index.ts. Don't adopt them anywhere else yet.

Commit "uiux(1.2): popover, dialog, drawer, disclosure, form controls, callout, step
dots".
```

#### Prompt UX-1.3 — plain-language data model and glossary move

```
[UX-1.3 · run sheet step 3 · parallel with UX-1.1, UX-1.2, UX-1.4 · branch uiux/1-3 · port 3113]

Read docs/implementation/uiux-spec.md §5.1, §5.5, §5.6, §5.8, §7.1–§7.3, §7.6, §8.1
(row 1.3) and §8.3. Changes are additive; nothing a user sees changes in this prompt.

1. Add src/core/types/story.ts exactly as in §7.1.
2. Add the optional fields in §7.2 to events.ts, pdu.ts and topology.ts.
   - summarizePhases in src/core/sim/result.ts copies `plain`; add a test.
   - Wherever topologies are validated, a node's `zone` must name an existing zone.
   - Runs must stay deterministic, so the existing determinism guard stays green.
3. src/modules/registry.ts:
   - Add MODULE_CHAPTERS and the new ModuleMeta fields from §7.3, filled with §5.5's
     table verbatim.
   - Keep `group` and MODULE_GROUPS; the nav reads them until UX-2.1.
   - Tighten tests/registry.test.ts:
     - every module has every new field;
     - the question ends with "?";
     - plainSummary is at most 30 words;
     - exactly one module is in the 'tools' chapter, and it is the one with
       usesRealNetwork;
     - the network-diagnostics plainSummary mentions "Live mode".
     Relax nothing.
4. Move the glossary to src/core/glossary/ per §7.6.
   - Create ten empty extra/<module-id>.ts files, merged by index.ts.
   - Add a test asserting terms and aliases are unique across the base and the extras.
   - Update every learning-center import site (Term.tsx, Glossary.tsx, content tests) and
     delete content/glossary.ts.
   - Confirm eslint's boundaries config needs no change.
5. src/core/text/:
   - kinds.ts: PLAIN_KINDS for every NodeKind, using §5.1.1's analogies.
   - humanScale.ts: describeDuration, describeSize, fibreDistanceKm. Pure functions,
     table-tested at the boundaries.
   - plain.ts: wordCount, sentences, findUnglossedJargon, checkPlainStory.
     - findUnglossedJargon flags all-caps tokens of two or more letters, and a short list
       of known jargon words, whenever they don't resolve through lookupTerm.
     - Numbers, units (ms, KB, Mb/s) and the product's module names are allowed.
   - Aim for 95% coverage; the core floor is 90%.

Verify: lint, typecheck, npx vitest run --project core, npm test. Commit "uiux(1.3):
plain-language fields, chapters, glossary in core".
```

#### Prompt UX-1.4 — preferences and pause-at-steps

```
[UX-1.4 · run sheet step 3 · parallel with UX-1.1, UX-1.2, UX-1.3 · branch uiux/1-4 · port 3114]

Read docs/implementation/uiux-spec.md §5.2, §5.7, §6, §7.5, §8.1 (row 1.4) and §8.3.

1. src/components/prefs/: PreferencesProvider, usePreference(key) and useDetail(),
   following §7.5.
   - One localStorage key, iv:preferences: versioned JSON, every read and write in
     try/catch, bad data falling back to defaults.
   - A `storage` event listener, so a change in another tab applies here.
   - useSyncExternalStore with a server snapshot equal to the defaults, so a server render
     never mismatches.
   - Export renderWithPreferences(ui, prefs) for tests.
2. app/layout.tsx: an inline pre-paint script that reads the key and sets data-detail,
   data-motion and data-text-size on <html> (with suppressHydrationWarning on <html>).
   - Keep the function it inlines in a module, so a test can unit-test it.
   - e2e/security.spec.ts must stay green (run it with PLAYWRIGHT_PORT=3114): the policy
     already allows inline scripts. Add no host and no unsafe-eval.
3. Fold MotionProvider's manual override into the store. Migrate the old sessionStorage
   value once, then stop using it.
   - Keep MotionProvider's public API { reduced, scale } and what its tests mean.
   - MotionToggle keeps working until UX-2.1 replaces it.
4. src/core/sim/playback.ts: an optional pauseAtPhaseEnd.
   - When it is on, reaching a phase boundary pauses with the playhead exactly at the next
     phase's startMs, and Play continues from there.
   - It never skips a boundary at 4x, and never pauses at 0 or at the end.
   - Framework-free and unit-tested.
   - Expose it through usePlayback's options, read from the pauseAtSteps preference (null
     means on in simple, off in full).

Tests: store defaults, bad JSON, the cross-tab event, the inline-script function, and the
playback change. Commit "uiux(1.4): preferences store, pre-paint attributes, pause at
steps".
```

#### Prompt UX-W1 — merge wave 1

```
[UX-W1 · run sheet step 4 · alone, in the main checkout on main · port 3100 · after UX-1.1, UX-1.2, UX-1.3 and UX-1.4 have all committed]

Read docs/implementation/uiux.md (the run sheet) and docs/implementation/uiux-spec.md §8.

1. Merge into main with `git merge --no-ff`, in this order: uiux/1-3, uiux/1-2,
   uiux/1-4, uiux/1-1 (the codemod goes last because it touches the most lines). For
   each conflict, keep both sides' intent.
2. Read the "Needs from other prompts" list in each branch's last commit message
   (`git log main..uiux/<id>` before merging it). Do the small items now; list the rest.
3. Wave-specific follow-ups:
   - In the files UX-1.2 added, replace each h-11 / h-6 marked `// --target-min` or
     `// --target-floor` with the token utilities UX-1.1 created, and drop the comments.
   - tests/type-scale.test.ts now covers UX-1.2's files too; fix any size under the floor.
4. Fold perf/uiux/ux-1.*.md into perf/uiux-baseline.md under "Wave 1", then delete them.
5. Run the wave gate (uiux-spec.md §8.2) with label wave-1. Fix what breaks, and say which
   prompt's change caused each fix.

Commit as "uiux(W1): merge wave 1". Report: merge order, conflicts and how each was
resolved, gate results, and open items. Put the open items in the commit message body
too; the next step reads them from there. Leave the worktrees and branches alone; the
person running the plan removes them.
```

#### Prompt UX-1.5 — glossary terms everywhere

```
[UX-1.5 · run sheet step 5 · alone, in the main checkout on main · port 3100 · after UX-W1]

Read docs/implementation/uiux-spec.md §5.6, §8.1 (row 1.5) and §8.3.

1. src/components/glossary/GlossaryTerm.tsx: a dotted-underline <button> that opens the
   ui Popover.
   - The popover shows the term, its short definition, and "Read more in the glossary"
     linking to /learn/glossary#<id>. Check the glossary page's anchor ids match; each
     entry already renders id={entry.id}.
   - An unknown term renders as plain text.
   - It imports only src/core/glossary/inline.ts. Run npm run perf:bundles before and
     after: it may add less than 4 KB gzipped to a module route.
2. TermText({ text, max = 3, skip }): links the first occurrence of each glossary term or
   alias in a string.
   - Matching is case-insensitive, respects word boundaries, prefers the longest match,
     never matches inside a word, and skips terms in `skip`.
   - Memoized on the string.
3. learning-center Term.tsx becomes a thin wrapper over GlossaryTerm. Lesson MDX doesn't
   change; the lesson pipeline tests stay green.
4. Tests: keyboard, tap, the link, the unknown-term fallback, and TermText's matching rules
   (including "DNS" not matching inside "DNSSEC" when both exist).

Commit "uiux(1.5): GlossaryTerm and TermText". Then run the wave gate (uiux-spec.md §8.2)
with label ux-1.5, and put the perf:bundles before/after numbers in
perf/uiux-baseline.md. Wave 2 starts only once it is green.
```

### Wave 2 — step 6: UX-2.1 ∥ 2.2 ∥ 2.3 ∥ 2.4 ∥ 2.5 ∥ 2.6 (parallel), then step 7: UX-W2

#### Prompt UX-2.1 — shell and navigation

```
[UX-2.1 · run sheet step 6 · parallel with UX-2.2 – UX-2.6 · branch uiux/2-1 · port 3121]

Read docs/implementation/uiux-spec.md §3.1, §5.5, §5.7, §6, §8.1 (row 2.1) and §8.3. Own
only those files.

1. TopNav, following §5.5:
   - Items: logo, Start here (/start), Explore, Lessons (/learn), Glossary
     (/learn/glossary), an empty search slot (filled by UX-4.2), Settings.
   - Explore is a menu grouped by MODULE_CHAPTERS. Each item shows the title, question and
     level. Network Diagnostics keeps its compact live badge. No status badges.
   - Keep h-14 (e2e STICKY_NAV_PX = 56), the navigation landmark, and the existing menu
     keyboard behaviour.
   - Under md, a menu button opens a ui Drawer with the same items.
2. /start: a redirect to the first lesson of the First steps track (§7.7). The destination
   is derived from the track data, not typed a second time. UX-2.6 creates the track in
   parallel, so for now reference it by the slug in §7.7 behind one exported constant
   (UX-W2 replaces it with the derived value). Keep /start out of the sitemap and out of
   e2e ROUTES, and add a smoke test that it redirects.
3. SettingsMenu (a ui Popover), replacing MotionToggle:
   - Detail level: Simple / Full detail, each with a one-line explanation.
   - Animation: On / Reduced / Match my device.
   - Text size: Normal / Large.
   - Pause after each step.
   Delete MotionToggle and its test, and move the assertions that still mean something
   into SettingsMenu's test.
4. ModuleChrome:
   - A breadcrumb: Home / Explore / <chapter label> / <title>.
   - The h1 title, with the question as its subtitle.
   - A level badge and the minutes.
   - SafetyBadge, with unchanged variants and tooltips.
   - "Words you'll meet": topics rendered as GlossaryTerm chips; plain badges for topics
     not in the glossary.
   - Remove the status badge.
   - The whole header fits in 140px or less at 1366 wide.
5. Footer:
   - The plain-language safety sentence, still naming the Live-mode exception.
   - Links: Start here, Lessons, Glossary, Network Diagnostics.
6. RouteError and the error.tsx files:
   - A plain headline and the next step first.
   - The runtime message and digest stay visible below it, under "What the browser
     reported". They are not hidden.
   - global-error stays built from nothing, as CLAUDE.md requires.

Update the tests for TopNav, ModuleChrome and RouteError, plus e2e/smoke.spec.ts and
e2e/a11y.spec.ts, following §8.3 rule 3. Verify one h1 and no skipped headings on every
route (`PLAYWRIGHT_PORT=3121 npx playwright test e2e/smoke.spec.ts e2e/a11y.spec.ts`).
Commit "uiux(2.1): chapter navigation, settings, compact module header".
```

#### Prompt UX-2.2 — home page

```
[UX-2.2 · run sheet step 6 · parallel with UX-2.1, UX-2.3 – UX-2.6 · branch uiux/2-2 · port 3122]

Read docs/implementation/uiux-spec.md §2, §4, §5.4, §5.5, §8.1 (row 2.2) and §8.3.

1. HeroJourney: a server component, inline SVG plus CSS, no client JS, no React Flow.
   - Places, left to right: You (laptop), Wi-Fi, Home router, Internet provider, an ocean
     cable, the website's data centre. An envelope travels there and back on a loop.
   - Each place has a plain caption.
   - Under reduced motion (the OS query, or data-motion='reduced'): a static picture with
     numbered captions.
   - At 390 wide: a layout with no horizontal scroll.
   - A <figure> with a text caption describing the journey; the moving parts are
     aria-hidden. Add its keyframes to src/styles/motion.css.
2. The home layout from §5.5's wireframe:
   - The h1 is the question.
   - Primary CTA: "Start here", linking to /start, with "6 short steps · about N minutes".
     Both numbers come from the track data, which UX-2.6 is writing in parallel, so for
     now put them behind one exported constant (UX-W2 replaces it with the derived
     values).
   - Secondary: QuickStart, a small form that navigates to /internet-simulator?url=<value>.
     Validate its shape only. UX-3.8 makes the module read the parameter.
   - StartPath: six numbered steps with ticks from learning progress, in a client island.
     It reserves the space for the ticks, so hydrating them causes no layout shift.
   - "Explore by question": one section per MODULE_CHAPTERS entry.
   - The safety line, still naming the Live exception.
3. ModuleCard:
   - Title (still the link's accessible name; tests rely on it), question, level badge,
     minutes, glyph.
   - A compact SafetyBadge on every card (simulated or live).
   - No status badge.
   - ModuleGrid takes a chapter.
4. not-found.tsx: plain copy, with links to Start here, Explore and Lessons. Keep the h1
   text, or update the expected text in e2e/routes.ts (NOT_FOUND_ROUTES) along with it.

Performance: the home route's first-load JS may grow by 5 KB gzipped at most against
perf/uiux-baseline.md, and its LCP element stays text. Measure it with
`npm run perf:bundles` and `BASE=http://127.0.0.1:3122 ROUTES=/ npm run perf:vitals`, and
write the numbers to perf/uiux/ux-2.2.md. Commit "uiux(2.2): a home page that starts
somewhere".
```

#### Prompt UX-2.3 — the Stage: layout and playback

```
[UX-2.3 · run sheet step 6 · parallel with UX-2.1, UX-2.2, UX-2.4 – UX-2.6 · branch uiux/2-3 · port 3123]

Read docs/implementation/uiux-spec.md §3.2, §5.2, §5.3, §6, §7.4, §8.1 (row 2.3) and §8.3.
UX-2.4 (panels) and UX-2.5 (canvas) run in parallel with you: use their components
through their current props, and don't edit their files.

1. src/components/viz/stage.ts holds the types in §7.4. SimulationView gains the stories,
   input, experiment, deeper and help slots, laid out as §5.3's wireframes.
   - controlPanel and footer keep working, rendered where they are today and marked
     @deprecated. Ten modules still use them until wave 3.
2. StoryPicker, from stories.options.
   - Simple: plainTitle and level chip, with the selected story's question beneath.
   - Full: title, summary, and a "What this run teaches" disclosure.
   - If story is missing, fall back to title and summary.
   - Groups: when `group` is set, options appear under that heading.
   - Show at most 5 options, then "More stories". Below lg, use a Select.
3. useScenarioParam(ids, defaultId) reads and writes ?scenario= with replaceState (no
   navigation).
   - First read node_modules/next/dist/docs on useSearchParams in statically rendered
     routes, and pick an approach that keeps module routes server-rendered.
   - Prove LCP is unchanged with perf:vitals (BASE=http://127.0.0.1:3123).
4. StepCaption: the visible PhaseAnnouncer. It stays the view's one aria-live region;
   e2e/a11y-manual asserts exactly one main [role=status].
   - It shows "Step n of m" with the phase's plain text (Simple) or title and description
     (Full), rendered through TermText.
   - Before the first play it shows the scenario question; at the end, "Done: here is what
     happened".
   - Placement: overlaid on the lower edge of the canvas at lg and above, directly under
     the canvas below lg.
5. Transport bar:
   - Directly under the canvas, and sticky to the viewport bottom while the stage is in
     view.
   - Labelled "Back", a large "Play" / "Pause" / "Play again", and "Next step".
   - StepDots and the timeline.
   - Speed in a menu. Keep the "4x"-style accessible names e2e uses, or update e2e.
   - A "Pause after each step" switch bound to the preference.
   - Shortcuts in a Popover.
   - "Replay this step" gets an icon distinct from "Play again" (today both are
     RotateCcw).
   - The primary button is at least 44px. The visible label is always inside the
     accessible name.
6. StartOverlay: before the first play or seek, a large "▶ Watch it happen" button and the
   question.
   - Absolutely positioned inside the canvas box, so there is zero layout shift.
   - Autoplay stays off.
7. RunRecap: at the end of a run, a dismissible overlay with no layout shift.
   - "What just happened": one line per phase, plain text in Simple.
   - Buttons: "Play again", and "Next story" when stories are given.
8. StageHelp: a "?" button in the stage header, and the "?" key (ignored while typing in
   an input or textarea), open a ui Dialog containing:
   - three steps: pick a story, press Play, click anything to see what it is;
   - the `help` lines;
   - the keyboard map.
9. Below the stage:
   - "What you'll learn" and "Experiment" as ui Disclosures. Experiment is open by default
     only in Full detail.
   - `deeper` as Tabs, where only the active tab's render() is mounted. Advanced tabs are
     tagged and ordered last.
   - Then the EventLog and TopologyList, which UX-2.4 owns.
10. Below lg:
    - Canvas at 60svh.
    - Steps, Details and Go deeper as Tabs.
    - Transport sticky.
    - No horizontal scroll at 390 or 640 (a11y-manual already checks 640; add 390).
11. ModuleSkeleton and app/(modules)/loading.tsx copy the new stage heights exactly.
12. Split e2e/modules.spec.ts into e2e/modules/<module-id>.spec.ts, one per module, with
    shared helpers (STICKY_NAV_PX among them) in e2e/helpers/ (new).
    - Add setPreferences(page, prefs), which uses addInitScript.
    - Update the shared selectors.
    - Delete e2e/modules.spec.ts once every test in it has a new home.
    - UX-2.4 and UX-2.5 don't touch e2e in this wave; UX-W2 applies their selector
      changes to your split files. Wave 3 edits one file each, in parallel.
13. EmbeddedSim (learning-center) still renders compact. Make compatibility edits only.

Measure `npm run perf:bundles` and perf:vitals for every module
(BASE=http://127.0.0.1:3123, ROUTES from uiux-spec.md §8.2) against perf/uiux-baseline.md,
and write the numbers to perf/uiux/ux-2.3.md. Run
`PLAYWRIGHT_PORT=3123 npm run uiux:screens -- ux-2.3`: Play must be inside the first
viewport on every module at both sizes. Commit "uiux(2.3): the Stage".
```

#### Prompt UX-2.4 — the Stage: steps and details panels

```
[UX-2.4 · run sheet step 6 · parallel with UX-2.1 – UX-2.3, UX-2.5, UX-2.6 · branch uiux/2-4 · port 3124]

Read docs/implementation/uiux-spec.md §5.1, §5.2, §5.4, §6, §8.1 (row 2.4) and §8.3. Prop
signatures stay additive: SimulationView (UX-2.3, in parallel) and every module call
these components. Don't edit anything in e2e/: UX-2.3 is splitting e2e/modules.spec.ts
right now. List every e2e selector your renames break under "Needs from other prompts"
(file, old selector, new selector), and UX-W2 applies them.

1. PhaseStepper ("Steps"):
   - Each row shows the step number, then the plain text (Simple; fall back to the
     description) or the title and description (Full), through TermText.
   - The current row is marked with an icon and the word "Now", not by colour alone.
   - Text is at least text-small.
2. Inspector ("Details"). Rename the region and update tests; it stays a landmark.
   Simple mode shows:
   - For a machine: a large icon, the name, plainRole (node.plainRole ??
     PLAIN_KINDS[kind].plainRole) with its analogy, what it is doing now in words, and its
     links as "Connected to X, about N ms away (describeDuration)".
   - For a link: the medium in plain words, describeDuration, and fibreDistanceKm on
     fibre, prefixed "roughly".
   - For a packet: plainLabel, "from X to Y" by name, describeSize, and PacketLayerStack
     drawn as nested envelopes, outermost first.
   - Everything the panel shows today moves under a "Technical details" Disclosure, open
     by default in Full detail.
   - Annotations show `plain` when present; the technical text and the RFC reference sit
     in the disclosure.
   - The empty state reads: "Click anything on the map (a device, a cable, or a moving
     message) to see what it is." No positional or colour words.
3. EventLog ("Everything that happened"):
   - Closed by default in both modes; rows are mounted only while it is open (Disclosure
     lazy).
   - Transmit rows use plainLabel in Simple.
   - State words match the node chips (fix "processing" vs "Working").
   - Fix annotation rows being announced as "Phase".
   - Row click still seeks.
4. TopologyList ("The map as a list"): same behaviour, because it is the route in that
   needs no canvas. Plain labels and zones in the machine rows.
5. HeaderTable: a plain "What it's for" line from each field's note; bit widths only in
   Full.

Record perf:vitals for /packet-journey before and after
(`BASE=http://127.0.0.1:3124 ROUTES=/packet-journey npm run perf:vitals`, restarting
`npx next start --port 3124` after each build). CLAUDE.md's fps table shows removing the
log took it from 1.7 to 21.7 fps, so closing and lazily mounting it is the largest single
DOM change in this plan. Measure it; don't assume it. Write the result to
perf/uiux/ux-2.4.md. Commit "uiux(2.4): steps, details and a log that stays out of the
way".
```

#### Prompt UX-2.5 — the canvas: places, packets, camera

```
[UX-2.5 · run sheet step 6 · parallel with UX-2.1 – UX-2.4, UX-2.6 · branch uiux/2-5 · port 3125]

Read docs/implementation/uiux-spec.md §3.3, §5.2, §5.4, §6 (Performance), §8.1 (row 2.5)
and §8.3. Read src/components/viz/README.md and CLAUDE.md's performance section first: this
is the performance-critical prompt. Don't edit anything in e2e/: UX-2.3 is splitting
e2e/modules.spec.ts right now. List every e2e selector your changes break under "Needs
from other prompts" (file, old selector, new selector), and UX-W2 applies them.

1. Zones: render Topology.zones as labelled backdrop regions behind their nodes.
   - Each has a zone-kind icon: house, office, antenna, globe, warehouse, server room,
     cloud.
   - Zones never take focus. The zone name joins each node's accessible name ("Home
     router, in Your home").
   - Add zones and any needed plainRole to the four shared topologies in
     src/core/topologies/.
2. layout.ts: lay out by zone first (zones in topology order), then breadth-first within a
   zone.
   - A zone may wrap to two rows, so a long path makes a readable shape instead of one
     3,500-unit line.
   - Keep explicit `positions` working.
3. The camera:
   - Never fit at a zoom where a node label renders under 12px.
   - When the whole map can't fit readably, follow the action: frame the active and
     processing nodes plus the link a packet is on, using the focusNodeIds machinery.
   - Move the camera only when projectionKey changes, never per frame; instantly under
     reduced motion.
   - CameraToggle, a 44px button in the canvas corner: "Show whole map" / "Follow the
     action".
4. Nodes:
   - Simple: a 32px icon, the name, the plain role on one line, and state shown by outline
     and icon. The chip appears only when the node is not idle ("Working", "Active",
     "Problem").
   - Full: today's card.
   - In Simple, addresses and layer notes are not rendered at all. The canvas is
     client-only, so reading the preference here is SSR-safe.
5. Packets:
   - Simple: an envelope pill labelled with plainLabel. The fallback is the innermost
     layer's protocol, never the outermost.
   - Full: today's layer and protocol label.
   - Keep the direction arrow, the accessible name, and the layer colour plus its text.
6. Edges: Simple hides the latency and bandwidth pill, showing it on hover, focus or
   selection. The medium stays distinguishable without colour (dash pattern plus icon);
   tests/non-colour-signals.test.ts passes untouched or tightened.
7. CanvasLegend: a "Key" Popover in the canvas corner, listing the kinds present, what a
   packet is, the link media, and the state meanings.
8. nodes/kinds.ts takes plain roles from src/core/text/kinds.ts.
9. Add one docs/ACCURACY.md row for the human-scale and fibre-distance simplification.

Nothing new may change per frame through React. Measure perf:vitals for every module
before and after (BASE=http://127.0.0.1:3125, ROUTES from uiux-spec.md §8.2), and
perf:bundles. /packet-journey must not get worse. Write everything to
perf/uiux/ux-2.5.md, and rerun `PLAYWRIGHT_PORT=3125 npm run uiux:screens -- ux-2.5`: the
node-label metric must be at least 12px on every module. Commit "uiux(2.5): places,
envelopes and a camera that follows".
```

#### Prompt UX-2.6 — the First steps track

```
[UX-2.6 · run sheet step 6 · parallel with UX-2.1 – UX-2.5 · branch uiux/2-6 · port 3126]

Read docs/implementation/uiux-spec.md §2, §5.1, §5.5, §7.7, §8.1 (row 2.6) and §8.3,
src/modules/learning-center/README.md, and docs/CONTENT-STYLE.md (updated by UX-0.1).

Add track "first-steps", titled "First steps", level beginner, listed first, with the six
lessons in §7.7. Each lesson:
- takes 5 minutes or less;
- opens with the question;
- has at most 150 words between visual elements (content/authoring.test.ts);
- embeds exactly the listed scenario (check the ids against src/modules/scenarios.ts);
- has one "Check yourself" Quiz whose options each explain themselves;
- ends with three KeyTakeaways;
- uses no term without a <Term> on its first use.
Assume the reader has never heard any of the words, and use only the analogies in §5.1.1.
New glossary entries go in src/core/glossary/extra/learning-center.ts.

If scenarios.ts's embed type needs it, add an optional `story` passthrough to it (additive
only), so an embed can show the plain title once modules supply one in wave 3.

Update the track and navigation assertions this changes. The one count pinned today is
`expect(TRACKS).toHaveLength(7)` in content/coverage.test.ts; make it 8. No test pins
the lesson count (33 becomes 39), and the sitemap test derives its set from
allLessonParams(), so neither needs an edit. Every other assertion in coverage.test.ts,
that each spec topic is taught by some lesson, must stay green unedited. Run
`PLAYWRIGHT_PORT=3126 npx playwright test e2e/smoke.spec.ts` to see the new lesson routes
render. Commit "uiux(2.6): First steps track".
```

#### Prompt UX-W2 — merge wave 2

```
[UX-W2 · run sheet step 7 · alone, in the main checkout on main · port 3100 · after UX-2.1 – UX-2.6 have all committed]

Read docs/implementation/uiux.md (the run sheet) and docs/implementation/uiux-spec.md §8.

1. Merge into main with `git merge --no-ff`, in this order: uiux/2-1, uiux/2-2,
   uiux/2-3, uiux/2-4, uiux/2-5, uiux/2-6. For each conflict, keep both sides' intent.
   Expect one in components/shell/index.ts (2.1 and 2.2 both add exports) and some in
   unit tests that more than one branch updated.
2. Read the "Needs from other prompts" list in each branch's last commit message
   (`git log main..uiux/<id>` before merging it). Do the small items now; list the rest.
3. Wave-specific follow-ups:
   - Apply the e2e selector changes UX-2.4 and UX-2.5 listed to the split files under
     e2e/modules/ and e2e/helpers/ that UX-2.3 created.
   - Replace UX-2.1's /start constant with a value derived from the first-steps track
     data (its first lesson), and UX-2.2's step-count and minutes constant with values
     derived from the same track. Delete both constants.
   - SimulationView's tests (2.3) may still name the old "Inspector" region, which 2.4
     renamed "Details"; reconcile them.
4. Fold perf/uiux/ux-2.*.md into perf/uiux-baseline.md under "Wave 2", then delete them.
5. Run the wave gate (uiux-spec.md §8.2) with label wave-2. Fix what breaks, and say which
   prompt's change caused each fix.

Commit as "uiux(W2): merge wave 2". Report: merge order, conflicts and how each was
resolved, gate results, and open items. Put the open items in the commit message body
too; the next step reads them from there. Leave the worktrees and branches alone; the
person running the plan removes them.
```

### Wave 3 — step 8: UX-3.1 ∥ … ∥ UX-3.10 (parallel), then step 9: UX-W3

Every wave-3 prompt does the whole module pass checklist in uiux-spec.md §9. Each one
below has its module, branch and port filled in, so it can be pasted as it stands.

#### Prompt UX-3.1 — Network Map

```
[UX-3.1 · run sheet step 8 · parallel with the other wave-3 prompts · branch uiux/3-1 · port 3131]

Read docs/implementation/uiux-spec.md (§4–§8, and the module pass checklist in §9),
CLAUDE.md, and src/modules/network-map/README.md. Own only Network Map's wave-3 files
(§8.1): src/modules/network-map/**, src/app/(modules)/network-map/page.tsx,
src/core/glossary/extra/network-map.ts, e2e/modules/network-map.spec.ts, and, in this
wave only, src/core/topologies/*. Do the whole module pass checklist for Network Map,
with the specifics below. Your port is 3131 and your route is /network-map. Commit
"uiux(3.1): Network Map pass".

Specifics:
- This module's four scenarios are the ScenarioTopology objects in
  src/core/topologies/ (the module re-exports them). Add `story?: StoryMeta` to
  ScenarioTopology and `plain?: string` to TeachingNote in src/core/topologies/types.ts,
  then fill both in the four topology files. Packet Journey reads HOME_LAN and ISP_PATH
  too, so keep every change additive.
- Stories:
  - home-lan: "One home's network" (beginner)
  - small-office: "A small office" (beginner)
  - datacenter: "Inside a data centre" (intermediate)
  - isp-path: "From your home to the world" (intermediate)
- The guided tour is this module's playback. In Simple mode, pressing Play must do
  something meaningful: the tour is on by default, and Play plays it. Tour stops come from
  scenario.notes, never written a second time (README invariant). Each note's `plain`
  (above) is what the tour shows in Simple mode; UX-2.5 already added zones.
- Experiment: the layer filter ("Show one layer"), the address toggle ("Show addresses"),
  and the tour switch in Full detail. Filters still dim rather than remove.
- NodeDetailTab ("Why it is here") stays in inspectorExtra, with a plain version first.
- TopologyLegend becomes a deeper tab, "Key", or goes away if UX-2.5's CanvasLegend covers
  everything it said (check line by line first).
- Changing scenario still resets selection, layer, tour and camera.
- tour.test.ts pins node titles: keep the labels and change only plainRole.
```

#### Prompt UX-3.2 — Packet Journey

```
[UX-3.2 · run sheet step 8 · parallel with the other wave-3 prompts · branch uiux/3-2 · port 3132]

Read docs/implementation/uiux-spec.md (§4–§8, and the module pass checklist in §9),
CLAUDE.md, and src/modules/packet-journey/README.md. Own only Packet Journey's wave-3
files (§8.1): src/modules/packet-journey/**, src/app/(modules)/packet-journey/page.tsx,
src/core/glossary/extra/packet-journey.ts and e2e/modules/packet-journey.spec.ts. Do the
whole module pass checklist for Packet Journey, with the specifics below. Your port is
3132 and your route is /packet-journey. Commit "uiux(3.2): Packet Journey pass".

Specifics:
- Your topology is composed from HOME_LAN and ISP_PATH in scenarios/topology.ts. Put its
  zones and any plainRole there; src/core/topologies/ belongs to UX-3.1 in this wave.
- Stories:
  - tcp-web-request: "Loading a web page" (beginner)
  - udp-dns-query: "A quick question, no tracking" (beginner)
  - fragmented-packet: "Too big for the road" (intermediate)
  - lossy-link: "A bumpy connection" (intermediate)
- plainLabel examples:
  - SYN: "Hello? (start a connection)"; SYN-ACK: "Hello back"; ACK: "Got it"
  - GET: "Please send the page"; response: "Here's the page"; FIN: "Goodbye"
  - DNS query: "Where is example.com?"
  - fragments: "Piece 1 of 3"
  - ICMP frag-needed: "Too big: make it smaller"
- Experiment, in JourneyControls' place, using ui controls:
  - Transport: "How to send it", a SegmentedControl: TCP ("checks every piece arrives") /
    UDP ("sends and hopes").
  - Payload: "Message size", with describeSize.
  - MTU: "Biggest packet this road allows (MTU)".
  - Link loss: "Unreliable connection".
  - "As authored" becomes "the story's setting"; "Reset to the scenario" becomes "Back to
    the story's settings".
  - Knobs still reset on scenario change, and null still means "as authored".
- Deeper tabs:
  - "Envelopes inside envelopes" (EncapsulationPanel, default, beginner)
  - "Hop by hop" (HopTable, intermediate; plain column headings, technical ones in Full)
  - "Address swap at the router (NAT)" (NatTable, only when the scenario has NAT)
- Keep the ledger rules in the README: live panels read usePlayheadCursor; Encapsulation
  and NAT read virtualTime (ledger.test.ts pins this). Unreached hop rows dim, they don't
  hide.
- Performance: this is the 2 fps page. Measure perf:vitals before and after
  (`BASE=http://127.0.0.1:3132 ROUTES=/packet-journey npm run perf:vitals`, restarting
  the server after each build), and record both in perf/uiux/ux-3.2.md with what
  changed. Wave 2's tabs, lazy log and Simple node cards all reduce document size, which
  the CLAUDE.md investigation named as the cost. Report whether the number moved beyond
  the ±0.5 noise.
```

#### Prompt UX-3.3 — DNS Explorer

```
[UX-3.3 · run sheet step 8 · parallel with the other wave-3 prompts · branch uiux/3-3 · port 3133]

Read docs/implementation/uiux-spec.md (§4–§8, and the module pass checklist in §9),
CLAUDE.md, and src/modules/dns-explorer/README.md. Own only DNS Explorer's wave-3 files
(§8.1): src/modules/dns-explorer/**, src/app/(modules)/dns-explorer/page.tsx,
src/core/glossary/extra/dns-explorer.ts and e2e/modules/dns-explorer.spec.ts. Do the
whole module pass checklist for DNS Explorer, with the specifics below. Your port is 3133
and your route is /dns-explorer. Commit "uiux(3.3): DNS Explorer pass".

Specifics:
- input: DomainInput becomes the hero.
  - A "Type a website name" Field and a "Look it up" button.
  - Example chips: four in Simple, all in Full.
  - The Simulated badge and the "never sent to a real nameserver" sentence stay, verbatim
    (tests match it by regex), shown as a safety Callout under the field.
  - Validation messages stay, in plain wording.
- Experiment ("More options"):
  - Record type: "What to ask for", e.g. A = "the address (IPv4)".
  - Resolver cache: "Has the resolver looked this up before?", with Cold = "No: ask from
    scratch" and Warm = "Yes: it remembers".
  - Transport: "How the question travels". DoH and DoT only change labels.
  - DNSSEC: "Check the answer's signature".
- Stories:
  - cold-cache: "First lookup, nothing remembered" (beginner)
  - warm-cache: "Second lookup, remembered" (beginner)
  - cname-chain: "A name that points to another name" (intermediate)
  - cdn-lookup: "A site served from nearby" (intermediate)
  - nxdomain: "A name that doesn't exist" (beginner)
  - dnssec-validated: "Checking the answer is genuine" (advanced)
- Zones: Your computer, Your internet provider (the resolver), The internet's name
  servers.
- Deeper tabs:
  - "Who was asked" (ResolutionLadder, default)
  - "The answer" (RecordTable; all three sections always shown)
  - "What the resolver remembers" (CachePanel)
- Every query is still labelled iterative or recursive. The fetch-spy test is untouched.
```

#### Prompt UX-3.4 — HTTP Explorer

```
[UX-3.4 · run sheet step 8 · parallel with the other wave-3 prompts · branch uiux/3-4 · port 3134]

Read docs/implementation/uiux-spec.md (§4–§8, and the module pass checklist in §9),
CLAUDE.md, and src/modules/http-explorer/README.md. Own only HTTP Explorer's wave-3 files
(§8.1): src/modules/http-explorer/**, src/app/(modules)/http-explorer/page.tsx,
src/core/glossary/extra/http-explorer.ts and e2e/modules/http-explorer.spec.ts. Do the
whole module pass checklist for HTTP Explorer, with the specifics below. Your port is
3134 and your route is /http-explorer. Commit "uiux(3.4): HTTP Explorer pass".

Specifics:
- input in Simple: "Try a request", five or six preset buttons built from the route
  chips.
  - Examples: "Open the home page", "Send a form", "A page that moved", "A page that
    doesn't exist", "Ask only if it changed".
  - Every preset goes through parseRequestDraft (README invariant: every entry does).
  - In Full, input is the RequestBuilder.
- Experiment: "Write your own request" (the RequestBuilder in Simple), with its checkboxes
  turned into Switches with plain labels:
  - "Use HTTPS (TLS)"
  - "Send it twice"
  - "Reload the page"
  - "Follow redirects"
  - "From another website (cross-origin)"
  - "Include cookies (credentials)"
  The CRLF toggle appears in Full only. There is still no host field.
- Deeper tabs:
  - "The message itself" (WireView + HeaderExplainer, drawn as an annotated letter: the
    request line = what and where, headers = notes, the blank line, the body = the
    contents)
  - "Every exchange" (the ledger)
  - "Status codes"
  - "Caches" (CacheStatePanel; browser and CDN never merged)
  - "Cookies"
  - "Cross-origin check (CORS)" (conditional; the verdict still says the request was sent)
  - "HTTP versions" (conditional, advanced)
- Stories:
  - simple-get: "Asking for a page" (beginner)
  - post-form: "Sending a form" (beginner)
  - redirect-chain: "A page that moved" (beginner)
  - conditional-request: "Asking only if it changed" (intermediate)
  - cookie-session: "Staying logged in" (intermediate)
  - cors-preflight: "A request from another website" (advanced)
  - http2-multiplexing: "Three versions of HTTP" (advanced)
- Both fetch-spy tests are untouched. The Simulated badge and the "never sent to a real
  server" sentence stay.
```

#### Prompt UX-3.5 — HTTPS Explorer

```
[UX-3.5 · run sheet step 8 · parallel with the other wave-3 prompts · branch uiux/3-5 · port 3135]

Read docs/implementation/uiux-spec.md (§4–§8, and the module pass checklist in §9),
CLAUDE.md, and src/modules/https-explorer/README.md. Own only HTTPS Explorer's wave-3
files (§8.1): src/modules/https-explorer/**, src/app/(modules)/https-explorer/page.tsx,
src/core/glossary/extra/https-explorer.ts and e2e/modules/https-explorer.spec.ts. Do the
whole module pass checklist for HTTPS Explorer, with the specifics below. Your port is
3135 and your route is /https-explorer. Commit "uiux(3.5): HTTPS Explorer pass".

Specifics:
- input: one SegmentedControl, "See it as: You (the browser) | Someone else on the
  network". This is the module's central beginner idea.
  - It replaces both Participant/Observer toggles: the page-level one in
    HttpsExplorerModule.tsx and the one inside EncryptionOverlay.tsx. EncryptionOverlay
    reads module state instead of owning a second toggle.
  - The vantage point stays module-level state driving both the ladder and the overlay.
    HttpsExplorerModule.test.tsx checks the two toggles stay in sync; turn that into a
    check that the one control drives both views.
- Deeper tabs:
  - "What someone else can see" (EncryptionOverlay, default; still leads with what stays
    visible)
  - "The handshake" (ladder)
  - "Checking the site's ID" (CertificateChain; all five checks always shown)
  - "The secret keys" (KeyScheduleDiagram, advanced)
  - "The cipher suite" (advanced)
  - "TLS 1.2 vs 1.3" (advanced)
- Stories:
  - tls13-fresh: "Connecting securely for the first time" (beginner)
  - tls13-resumption: "Reconnecting quickly" (intermediate)
  - tls12-fresh: "The older way (TLS 1.2)" (advanced)
  - cert-expired: "An expired ID" (beginner)
  - cert-hostname-mismatch: "An ID for the wrong site" (beginner)
  - cert-untrusted-ca: "An ID nobody vouches for" (intermediate)
  - downgrade-blocked: "Someone tries to weaken the lock" (advanced)
- Analogies: the sealed envelope and the ID card (§5.1.1).
- These stay: the PLACEHOLDER_NOTICE on every placeholder value, the browser's warning
  string, the 0-RTT replay warning, and cert-* runs aborting before application data.
```

#### Prompt UX-3.6 — API Visualizer

```
[UX-3.6 · run sheet step 8 · parallel with the other wave-3 prompts · branch uiux/3-6 · port 3136]

Read docs/implementation/uiux-spec.md (§4–§8, and the module pass checklist in §9),
CLAUDE.md, and src/modules/api-visualizer/README.md. Own only API Visualizer's wave-3
files (§8.1): src/modules/api-visualizer/**, src/app/(modules)/api-visualizer/page.tsx,
src/core/glossary/extra/api-visualizer.ts and e2e/modules/api-visualizer.spec.ts. Do the
whole module pass checklist for API Visualizer, with the specifics below. Your port is
3136 and your route is /api-visualizer. Commit "uiux(3.6): API Visualizer pass".

Specifics:
- Stories:
  - rest-crud: "Adding, reading, changing, deleting" (beginner)
  - auth-bearer: "Proving who you are" (intermediate)
  - oauth-authcode-pkce: "Logging in with another account" (advanced)
  - rate-limited: "Asking too often" (beginner)
  - paginated-collection: "A long list, one page at a time" (intermediate)
  - rest-vs-graphql: "Two ways to ask (REST vs GraphQL)" (advanced)
  - webhook-delivery: "When the server calls you" (intermediate)
- The teaches chips (full sentences) appear only in Full's "What this run teaches".
- Analogy: the menu and the waiter (§5.1.1). Mark it as an analogy.
- Deeper tabs:
  - "Requests and replies" (the Requests list plus ResponseShape, default)
  - the scenario's own panel (AuthFlowDiagram / RateLimitMeter / PaginationVerdict /
    TransportBill), with a plain title
  - "Endpoints"
- Experiment: "Try it yourself" (ApiConsole). Its lowercase "simulated" Badge becomes the
  shared SafetyBadge.
- JWT_PAYLOAD_NOT_ENCRYPTED stays above every decoded token, never inside a disclosure.
  There is still no host field and no fetch; only .example hosts and 203.0.113.0/24. The
  comparison tables stay even-handed.
```

#### Prompt UX-3.7 — WebSocket Viewer

```
[UX-3.7 · run sheet step 8 · parallel with the other wave-3 prompts · branch uiux/3-7 · port 3137]

Read docs/implementation/uiux-spec.md (§4–§8, and the module pass checklist in §9),
CLAUDE.md, and src/modules/websocket-viewer/README.md (out of date; see below). Own only
WebSocket Viewer's wave-3 files (§8.1): src/modules/websocket-viewer/**,
src/app/(modules)/websocket-viewer/page.tsx, src/core/glossary/extra/websocket-viewer.ts
and e2e/modules/websocket-viewer.spec.ts. Do the whole module pass checklist for
WebSocket Viewer, with the specifics below. Your port is 3137 and your route is
/websocket-viewer. Commit "uiux(3.7): WebSocket Viewer pass".

Specifics:
- Stories:
  - handshake-and-chat: "Opening a live chat" (beginner)
  - close-handshake: "Hanging up politely" (beginner)
  - ping-pong-keepalive: "Checking the line is still there" (intermediate)
  - fragmented-message: "A big message in pieces" (intermediate)
  - reconnect-backoff: "Dropped, and reconnecting" (intermediate)
  - binary-frames: "Sending pictures and files" (advanced)
  - transport-comparison: "Four ways to get live updates" (advanced)
- Deeper tabs:
  - "The conversation" (MessageStream drawn as chat bubbles, default)
  - "Switching to a live line" (UpgradePanel)
  - "Inside a frame" (FrameInspector, advanced)
  - "Connection health"
  - "Close codes" (the "1006 is never on the wire" column stays)
  - "Four transports" (conditional)
- Analogy: a phone call left open vs posting letters (§5.1.1).
- README.md is out of date: it says only sim/ exists and the registry entry stays
  planned, but the module is `ready` with scenarios/ and components/. Rewrite it for the
  module as it is.
- The module has no module-level test (only scenario, sim and two component tests). Add
  WebSocketViewerModule.test.tsx: it mounts, switches scenario, and shows the chat tab.
```

#### Prompt UX-3.8 — Internet Simulator

```
[UX-3.8 · run sheet step 8 · parallel with the other wave-3 prompts · branch uiux/3-8 · port 3138]

Read docs/implementation/uiux-spec.md (§4–§8, and the module pass checklist in §9),
CLAUDE.md, and src/modules/internet-simulator/README.md. Own only Internet Simulator's
wave-3 files (§8.1): src/modules/internet-simulator/**,
src/app/(modules)/internet-simulator/page.tsx,
src/core/glossary/extra/internet-simulator.ts and e2e/modules/internet-simulator.spec.ts.
Do the whole module pass checklist for Internet Simulator, with the specifics below. Your
port is 3138 and your route is /internet-simulator. Commit "uiux(3.8): Internet Simulator
pass".

Specifics:
- input: the UrlBar stays the hero. Its Simulated badge "does not get quieter" (README).
  - Read ?url= on load, through exactly the same validation and coverage path as typing.
    This is the home page's QuickStart contract. An unknown host shows the existing
    "Unknown to the bundled zones" path.
  - Keep the example chips.
- StageRail plain names, with the acronym kept:
  - "Read the address (URL)"
  - "Check what's remembered (cache)"
  - "Find the server (DNS)"
  - "Connect (TCP)"
  - "Lock the line (TLS)"
  - "Ask for the page (HTTP)"
  - "Nearby copy (CDN)"
  - "Draw the page"
- Stories, using StoryOption.group:
  - normal:
    - first-visit-https: "Visiting a site for the first time" (beginner)
    - repeat-visit-cached: "Coming back" (beginner)
    - cdn-hit: "A copy nearby" (intermediate)
    - cdn-miss-origin-fetch: "No copy nearby yet" (intermediate)
    - slow-network: "On a slow connection" (beginner)
  - "When things go wrong":
    - failure-dns: "The name doesn't exist" (beginner)
    - failure-tls: "The site's ID has expired" (intermediate)
    - failure-timeout: "The server never answers" (intermediate)
- Deeper tabs:
  - "What you see" (BrowserFrame, default)
  - "Each stage" (StageRail + StageZoom)
  - "Timing" (WaterfallChart). Its segment names stay Chrome's, verbatim (README
    invariant); add GlossaryTerm for TTFB, LCP and SSL.
- Experiment: "Connection type" (NetworkProfileControls).
- StageZoom's "Open in DNS Explorer"-style links now work, because modules honour
  ?scenario= since UX-2.3. Check every link's scenario id against src/modules/scenarios.ts
  and add a test that each resolves.
- Only example.com/.net/.org hosts, and no fetch.
```

#### Prompt UX-3.9 — Network Diagnostics

```
[UX-3.9 · run sheet step 8 · parallel with the other wave-3 prompts · branch uiux/3-9 · port 3139]

Read docs/implementation/uiux-spec.md (§4–§8, and the module pass checklist in §9),
CLAUDE.md, and src/modules/network-diagnostics/README.md. Own only Network Diagnostics'
wave-3 files (§8.1): src/modules/network-diagnostics/** (except the files listed under
"Do not touch"), src/app/(modules)/network-diagnostics/page.tsx,
src/core/glossary/extra/network-diagnostics.ts and
e2e/modules/network-diagnostics.spec.ts. Do the whole module pass checklist for Network
Diagnostics, with the specifics below. Your port is 3139 and your route is
/network-diagnostics. Commit "uiux(3.9): Network Diagnostics pass".

Read the network-diagnostics README and CLAUDE.md's Network Diagnostics section twice.
This prompt changes presentation only.

Do not touch:
- the logic of ModeSwitch's gate;
- LiveConsole's mounting rule;
- live/client.ts, live/operations.ts;
- src/app/api/diagnostics/**, src/core/net/**.

Every test asserting a safety string, the gate, or the absence of "Live network" in Learn
mode stays as it is.

Specifics:
- The mode switch stays above the stage, prominent, and visually distinct in Live mode.
  Learn mode is still the default and is never persisted; a reload returns to Learn.
- Tools become a SegmentedControl (or cards) with the plain question and the tool's real
  name:
  - "Is it answering? (ping)"
  - "Which way does it go? (traceroute)"
  - "What's its address? (DNS lookup)"
  - "Who registered it? (WHOIS / RDAP)"
- Live mode's check is still "Reachability (TCP + HTTP timing)", never "ping". The "No
  live traceroute" explanation stays where a traceroute would be.
- stories, with label "Network": the six simulated paths in DIAGNOSTIC_PATHS
  (sim/paths.ts), with plain titles. Check each against what the path actually simulates
  before using it:
  - local-cdn: "A nearby server" (the default)
  - flaky-wifi: "Flaky Wi-Fi"
  - long-haul: "Across an ocean"
  - filtered-host: "A server that ignores pings"
  - prohibited-host: "Blocked by a firewall"
  - dead-host: "Nothing at that address"
  Record pickers use label "Record".
  - This module has no scenario catalogue; build StoryOptions inside the module and don't
    add it to scenarios.ts. For the checklist, the six paths are its scenarios: each one
    gets a `story`, and the plain-language test covers each.
- Each tool's four or five panels become deeper tabs, with "What this result proves"
  first.
- Live-mode copy (LiveDisclosure, refusals, rate limits) may get plainer, but never less
  specific. A refusal is never phrased as a failure (CONTENT-STYLE, Safety language).
```

#### Prompt UX-3.10 — Learning Center

```
[UX-3.10 · run sheet step 8 · parallel with the other wave-3 prompts · branch uiux/3-10 · port 3130]

Read docs/implementation/uiux-spec.md (§4–§8, and the module pass checklist in §9),
CLAUDE.md, and src/modules/learning-center/README.md. Own only the Learning Center's
wave-3 files (§8.1): src/modules/learning-center/**, src/app/learn/**,
src/app/sitemap.ts, e2e/routes.ts, src/core/glossary/extra/learning-center.ts and
e2e/modules/learning-center.spec.ts (if UX-2.3's split made one). Do the module pass
checklist for the Learning Center, with the specifics below. Your port is 3130 and your
routes are /learn, /learn/glossary, and the lesson and track pages. Commit "uiux(3.10):
Learning Center pass".

The Learning Center has no scenarios, phases or packets of its own; it embeds the other
modules' runs. So checklist items 1–5, and the plain-language test in item 9, don't
apply. Items 6–8, 10 and 11 do: for item 11, run uiux:screens on the /learn routes and
check that Play is inside the first viewport in each embedded run.

Specifics:
- /learn:
  - A "Start here" card for First steps: "Continue" once there is progress, from the
    progress store, client-only, with reserved space.
  - Track rows with level badges and progress bars. Tracks other than the current one are
    collapsible.
  - Keep the one h1.
- Track pages at /learn/[track], statically generated with dynamicParams = false.
  - The lesson breadcrumb's track link points at them instead of /learn#track-….
  - sitemap.ts and e2e/routes.ts stay derived, so add track pages through the same data.
  - Do not add a not-found.tsx under app/learn (CLAUDE.md, Edge states).
- LessonLayout:
  - Prose at text-lead, about 68ch wide.
  - "Lesson n of m" in the track.
  - GlossaryTerm popovers (Term wraps it since UX-1.5).
  - EmbeddedSim picks up the Stage's Simple look.
  - Quiz options as large buttons, each revealing its explanation.
  - A visible "Mark complete", and a prominent next-lesson link.
- Track 1 ("Internet Foundations"): add <Term> on the first use of every term a newcomer
  won't know (TTL, DNS, TCP…) within the 150-word budget. Change no teaching content.
- The glossary page: a letter index, a client-side filter box, and stable anchors.
- Progress stays in localStorage only, and never reaches a server render.
```

#### Prompt UX-W3 — merge wave 3

```
[UX-W3 · run sheet step 9 · alone, in the main checkout on main · port 3100 · after UX-3.1 – UX-3.10 have all committed]

Read docs/implementation/uiux.md (the run sheet) and docs/implementation/uiux-spec.md §8.

1. Merge into main with `git merge --no-ff`: uiux/3-1 to uiux/3-9 in any order, then
   uiux/3-10 last, because its track pages link to every module. Each branch owns its own
   module, so conflicts should be rare; where one appears (a shared unit test, a README
   both mention), keep both sides' intent.
2. Read the "Needs from other prompts" list in each branch's last commit message
   (`git log main..uiux/<id>` before merging it). Do the small items now; list the rest
   for UX-4.3.
3. Check the merged whole: every module's plain-language test passes, and
   src/core/glossary's uniqueness test passes with all ten extra/ files merged (two
   modules may have added the same term; keep one entry and alias the other).
4. Fold perf/uiux/ux-3.*.md into perf/uiux-baseline.md under "Wave 3", then delete them.
5. Run the wave gate (uiux-spec.md §8.2) with label wave-3. Fix what breaks, and say which
   prompt's change caused each fix.

Commit as "uiux(W3): merge wave 3". Report: merge order, conflicts and how each was
resolved, gate results, and open items. Put the open items in the commit message body
too; the next step reads them from there. Leave the worktrees and branches alone; the
person running the plan removes them.
```

### Wave 4 — step 10: UX-4.1 ∥ UX-4.2 (parallel), step 11: UX-W4, then steps 12–13: UX-4.3, UX-4.4 (alone, in order)

#### Prompt UX-4.1 — onboarding and continuity

```
[UX-4.1 · run sheet step 10 · parallel with UX-4.2 · branch uiux/4-1 · port 3141]

Read docs/implementation/uiux-spec.md §4, §5.3, §5.7, §6, §8.1 (row 4.1) and §8.3.

1. CoachMarks (src/components/viz/CoachMarks.tsx): on a browser's first visit to any
   Stage, three anchored ui Popovers in turn:
   - "Pick a story" (on the picker)
   - "Press Play" (on the Play button)
   - "Click anything to see what it is" (on the canvas)
   Rules:
   - "Skip" and "Next" on every one. Seen is stored in preferences as seenCoachMarks.
   - They never cause layout shift.
   - They never appear inside EmbeddedSim.
   - They can be reopened from StageHelp.
   - They don't show if the user has already pressed Play.
2. Continuity:
   - The home page shows "Continue where you left off", using the learning progress store
     and preferences.lastVisited (set by the Stage on mount). It is client-only, with
     reserved space.
3. "Keep going": an app-level component, src/app/(modules)/_components/KeepGoing.tsx,
   rendered by each module route's page.tsx below the module. It lists:
   - lessons that embed this module's scenarios (reverse lookup through the Learning
     Center's lesson data; the app layer may import both);
   - the next module in the chapter.
   No module file changes.

Tests, plus a new e2e/onboarding.spec.ts: a fresh browser sees the coach marks once, and
never again after Skip (`PLAYWRIGHT_PORT=3141 npx playwright test e2e/onboarding.spec.ts`).
Commit "uiux(4.1): coach marks and keep going".
```

#### Prompt UX-4.2 — search

```
[UX-4.2 · run sheet step 10 · parallel with UX-4.1 · branch uiux/4-2 · port 3142]

Read docs/implementation/uiux-spec.md §5.5, §6 (Performance), §8.1 (row 4.2) and §8.3.

Add a search palette, src/components/search/.
- It opens from the nav's search slot, Ctrl/Cmd+K, and "/" (ignored while typing), inside
  a ui Dialog.
- It indexes:
  - modules: title, question, plainSummary;
  - every story: plainTitle and question, from src/modules/scenarios.ts;
  - lessons: title and summary;
  - glossary terms and aliases.
- Results are grouped, the list is keyboard-navigable, and choosing a result navigates
  there. Stories open their module with ?scenario=.
- The index and the palette load only on first open, through a dynamic import. Prove with
  npm run perf:bundles that no route's first-load JS grows by more than 1 KB (the trigger
  button).
- The components layer may not import modules. Build the index where it may (in app/ or
  the registry), and pass it in through a lazily imported module in app/.
- Write the perf:bundles before/after numbers to perf/uiux/ux-4.2.md.

Tests, plus a new e2e/search.spec.ts: the palette opens by the button, Ctrl+K and "/",
and choosing a story opens its module with ?scenario=
(`PLAYWRIGHT_PORT=3142 npx playwright test e2e/search.spec.ts`). Commit "uiux(4.2):
search".
```

#### Prompt UX-W4 — merge wave 4

```
[UX-W4 · run sheet step 11 · alone, in the main checkout on main · port 3100 · after UX-4.1 and UX-4.2 have both committed]

Read docs/implementation/uiux.md (the run sheet) and docs/implementation/uiux-spec.md §8.

1. Merge uiux/4-1, then uiux/4-2, into main with `git merge --no-ff`. They own disjoint
   files; if a conflict appears (most likely components/shell/index.ts or a shared e2e
   helper), keep both sides' intent.
2. Read the "Needs from other prompts" list in each branch's last commit message
   (`git log main..uiux/<id>` before merging it). Do the small items now; list the rest
   for UX-4.3.
3. Check the two work together: the "?" key (StageHelp) and the "/" key (search) don't
   collide, and neither fires while typing in an input.
4. Fold perf/uiux/ux-4.*.md into perf/uiux-baseline.md under "Wave 4", then delete them.
5. Run the wave gate (uiux-spec.md §8.2) with label wave-4. Fix what breaks, and say which
   prompt's change caused each fix.

Commit as "uiux(W4): merge wave 4". Report: merge order, conflicts and how each was
resolved, gate results, and open items. Put the open items in the commit message body
too; the next step reads them from there. Leave the worktrees and branches alone; the
person running the plan removes them.
```

#### Prompt UX-4.3 — retire and reconcile

```
[UX-4.3 · run sheet step 12 · alone, in the main checkout on main · port 3100 · after UX-W4]

Read docs/implementation/uiux.md and uiux-spec.md in full, and the open items UX-W3 and
UX-W4 reported (in their merge commit messages, or perf/uiux-baseline.md).

1. Remove SimulationView's deprecated controlPanel and footer. Every module moved off them
   in wave 3; if one didn't, finish its move.
2. Remove `group` and MODULE_GROUPS from the registry if nothing reads them, and update
   tests/registry.test.ts without relaxing it.
3. Add tests/plain-language.test.ts. Like tests/rfc-references.test.ts, it runs every
   scenario in the codebase and fails on:
   - a missing story;
   - a phase with no plain text, or one checkPlainStory rejects;
   - a PDU with no plainLabel.
   Add tests/registry-copy.test.ts, which checks every module question and plainSummary
   with checkPlainStory.
4. Consistency sweep across the product:
   - "step", not "phase", in user-facing copy;
   - one SafetyBadge style;
   - one on/off control style;
   - no leftover private picker or Control shell;
   - no analogy outside §5.1.1;
   - no leftover "As authored";
   - no status badges.
   Fix what you find; list what you changed.
5. If the (modules)/@panel slot is still unused, delete it and its default.tsx.
6. /demo: its own file says to delete it once a real module renders a SimulationView,
   which happened in phase 05. Delete it, and update robots.ts, sitemap tests and e2e
   accordingly.

Run the full wave gate (uiux-spec.md §8.2) with label ux-4.3. Commit "uiux(4.3): retire
compatibility slots, assert plain language everywhere".
```

#### Prompt UX-4.4 — verify and document

```
[UX-4.4 · run sheet step 13 · alone, in the main checkout on main · port 3100 · after UX-4.3]

Read docs/implementation/uiux-spec.md §8.2, §8.3, §10 and §11.

1. Add e2e/beginner.spec.ts, asserting §10's automatable criteria:
   - Play is fully inside the first viewport at 1366x768 and 390x844 on every module;
   - Simple is the default, and Full detail persists across a reload;
   - a new visitor reaches a playing simulation from / in two clicks or fewer;
   - the glossary popover opens by tap and by keyboard;
   - no text renders below 12px (check computed styles on every route);
   - primary stage controls are at least 44px, and every target at least 24px;
   - in Simple mode, no more than 6 interactive controls sit above each module's canvas;
   - on the canvas at the default zoom, a node label renders at 12px or larger.
2. Run the full wave gate (uiux-spec.md §8.2) with label after. Then write a before/after
   table into perf/uiux-baseline.md, comparing .uiux/baseline with .uiux/after: every
   metric from UX-0.2, plus perf:bundles and perf:vitals.
3. Regenerate docs/media/ screenshots at 1440x1120, 2x, against a production build, as
   the README says. Update README.md: the product description and module list use the
   questions and plain summaries, and the Live exception is still named.
4. CLAUDE.md:
   - project status (the UX restructure is done);
   - "UI philosophy" (the two voices, Simple and Full);
   - the accessibility rules (add the 12px floor, the target sizes, and the step caption
     as the one live region);
   - the performance section (new rows in the Packet Journey table, with what moved it);
   - the Learning Center counts (8 tracks, 39 lessons);
   - the documentation list.
   Keep every existing warning that still holds.
5. Mark docs/implementation/uiux.md complete at the top, with the date and a link to the
   before/after table.

Commit "uiux(4.4): verified, measured, documented". After this, the restructure is done
in code; §11 (real beginners) is the last step on the run sheet and needs people, not a
prompt.
```
