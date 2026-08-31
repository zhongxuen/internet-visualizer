# 13 — Module: Learning Center

## Goal

Turn the simulation modules into an actual curriculum: structured lessons that embed the
live visualizations inline, check understanding, and track progress. Without this, the
product is a toolbox; with it, it is the "interactive encyclopedia of Internet
technologies" the spec asks for.

## Prerequisites

Phase 04. Lessons embed whichever modules exist — the framework works with a subset and
grows as modules land.

---

## Deliverables

```
src/modules/learning-center/
  meta.ts
  content/
    tracks.ts                  # ordered learning paths
    lessons/
      dns-basics.mdx
      how-a-url-loads.mdx
      tcp-vs-udp.mdx
      what-https-protects.mdx
      http-caching.mdx
      cookies-and-sessions.mdx
      ...
  components/
    TrackList.tsx
    LessonLayout.tsx
    LessonNav.tsx              # prev/next, progress within track
    Quiz.tsx                   # inline knowledge check
    KeyTakeaways.tsx
    Glossary.tsx               # hover/focus any term anywhere -> definition
    EmbeddedSim.tsx            # <EmbeddedSim module="dns" scenario="cold-cache" />
  progress/
    store.ts                   # localStorage-backed, no account required
  LearningCenterModule.tsx
src/app/(modules)/learn/page.tsx
src/app/(modules)/learn/[track]/[lesson]/page.tsx
```

---

## Design

### Lessons are MDX, simulations are components

A lesson is short prose punctuated by **live, playable simulations** — not screenshots,
not video. The `EmbeddedSim` component takes a module id and scenario id and renders that
scenario in a compact `SimulationView` with playback controls, inline.

```mdx
Every DNS lookup starts at the resolver, not the root.

<EmbeddedSim module="dns-explorer" scenario="cold-cache" focus="resolver" autoplay />

Notice that the root server never returns the answer — only a referral.
```

Because scenarios are shared data (phase 03 decision #3), a lesson can never drift out of
sync with the module it teaches.

The spec's "prefer visual explanations over long text" rule applies hard here. Enforce a
soft budget: **no more than ~150 words of continuous prose between two visual elements.**

### Tracks

Ordered paths, each 4–8 lessons, each lesson 5–10 minutes:

1. **Internet Foundations** — what a network is, addressing, packets, routing
2. **How a Web Page Loads** — URL → DNS → TCP → TLS → HTTP → render (mirrors phase 11)
3. **Names and Addresses** — DNS in depth, records, caching, DNSSEC
4. **The Web Protocol Layer** — HTTP semantics, caching, cookies, sessions, CORS
5. **Security on the Wire** — TLS, certificates, what HTTPS does and does not protect
6. **Real-Time and APIs** — REST, GraphQL, webhooks, WebSockets, SSE
7. **Infrastructure** — CDN, load balancers, reverse proxies, NAT, firewalls

Every "Learning Topic" from the spec must appear in at least one lesson. Add a coverage
check: a test that asserts each topic string in the registry maps to at least one lesson.

### Quizzes

`Quiz` supports multiple-choice and "predict what happens next" — the second type is the
strong one: pause a simulation mid-flow, ask what comes next, then play the answer.
Feedback explains _why_, including why each wrong option is wrong. No scores, no
gamification pressure; the goal is a check, not a grade.

### Progress

`localStorage` only — no accounts, no backend, no PII. Track: lessons completed, quiz
attempts, last position in a track. Include an obvious "reset progress" control.
Server-rendered pages must not depend on progress state (hydration mismatch risk) —
render progress client-side only.

### Glossary

One term list, used everywhere. Any term wrapped in `<Term>` gets a focusable
definition popover, and the glossary page lists all terms with links to the lessons and
modules that cover them. Keyboard-accessible, per phase 02.

---

## Accessibility and content quality

- Lessons must be readable and complete with animations disabled — every embedded
  simulation needs a text summary of what it demonstrates
- Proper heading hierarchy in MDX; one `h1` per lesson
- Code and wire-format samples use `CodeBlock`, never images of text
- Each lesson ends with `KeyTakeaways` (3–5 bullets) and links to the relevant modules
  and RFCs

---

## Acceptance criteria

- [ ] MDX pipeline works with the App Router; lessons render at
      `/learn/[track]/[lesson]`
- [ ] `EmbeddedSim` plays a real scenario inline, with working controls
- [ ] Every spec learning topic is covered by at least one lesson (asserted by test)
- [ ] Prose budget respected — no wall of text between visuals
- [ ] Quizzes give explanatory feedback for wrong answers
- [ ] Progress persists across reloads and can be reset; no hydration warnings
- [ ] Glossary terms are keyboard-accessible everywhere they appear
- [ ] Lessons are complete and comprehensible with reduced motion on
- [ ] Registry entry `'ready'`

---

## Prompts to execute

### Prompt 13.1 — lesson framework

```
Read docs/implementation/13-module-learning-center.md.

Set up the MDX pipeline for the App Router and build the lesson framework:
LessonLayout, LessonNav, TrackList, KeyTakeaways, Quiz (multiple-choice plus
predict-what-happens-next), Glossary with a <Term> popover, and the localStorage-backed
progress store with a reset control.

Progress must render client-side only to avoid hydration mismatches. Add the routes
/learn and /learn/[track]/[lesson]. Create one placeholder lesson to prove the pipeline.
```

### Prompt 13.2 — EmbeddedSim

```
Implement EmbeddedSim per docs/implementation/13-module-learning-center.md: it takes a
module id and scenario id, resolves the scenario from that module's exported scenario
map, and renders it in a compact SimulationView with playback controls, supporting
optional `focus` and `autoplay` props.

It must reuse the phase-04 components — no new animation code. Add a fallback that
renders a clear message if a referenced module or scenario does not exist yet, so
lessons can be written ahead of modules. Also render the scenario's text summary for
reduced-motion and screen-reader users.
```

### Prompt 13.3 — tracks and lessons

```
Write the seven tracks from docs/implementation/13-module-learning-center.md in
content/tracks.ts, and author the lessons for the tracks whose modules are already
built.

Each lesson: short prose (no more than ~150 words between visual elements), at least one
EmbeddedSim, at least one quiz, KeyTakeaways of 3-5 bullets, and links to the relevant
modules and RFCs.

Then add a test asserting that every learning topic listed in the project spec appears in
at least one lesson. Flip the registry entry to 'ready'.
```
