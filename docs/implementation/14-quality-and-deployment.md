# 14 — Quality, accessibility, performance & deployment

## Goal

Take the built product from "works on my machine" to "shippable portfolio piece": a
real test suite, verified accessibility, measured performance, CI, and a production
deployment on Vercel.

## Prerequisites

All prior phases. Individual sections can be run earlier — a11y and performance checks
are cheaper the sooner they happen.

---

## Deliverables

```
.github/workflows/ci.yml
playwright.config.ts
e2e/
  smoke.spec.ts
  a11y.spec.ts
  modules.spec.ts
docs/
  ACCURACY.md              # protocol claims -> RFC references
  CONTENT-STYLE.md         # how to write a lesson / annotation
README.md                  # rewritten: what it is, screenshots, run instructions
vercel.json                # headers, if needed
src/app/
  sitemap.ts  robots.ts  opengraph-image.tsx
  error.tsx  not-found.tsx  loading.tsx
```

---

## 1. Testing

**Unit (Vitest)** — the pure layers carry the coverage:

- `src/core/**` ≥ 90%
- `src/core/net/guard.ts` ≥ 95% (the security-critical file)
- Every module's `sim/` folder tested independently of its UI

**Component (Testing Library)** — playback controls, keyboard map, inspector selection,
reduced-motion behaviour.

**E2E (Playwright)**:

- `smoke` — every route in the registry loads without console errors
- `modules` — for each `ready` module: load, run a scenario to completion, step
  backwards, verify the inspector opens
- `a11y` — axe-core scan on every route; zero serious/critical violations

Add a determinism guard test: every scenario in the codebase, run twice, deep-equal.

## 2. Accessibility

Check, and fix, all of:

- [ ] Keyboard-only traversal of every module including the timeline
- [ ] Visible focus on every interactive element
- [ ] Screen reader: each simulation exposes an `aria-live` status announcing the current
      phase, and a text summary alternative to the canvas
- [ ] Reduced motion fully honoured — no vestigial animation
- [ ] Contrast: text ≥ 4.5:1, UI/graphics ≥ 3:1
- [ ] No meaning conveyed by color alone (verify with a grayscale screenshot pass)
- [ ] Heading hierarchy correct on every page; one `h1`
- [ ] Zoom to 200% without loss of function
- [ ] Respect `prefers-contrast` if cheap to add

React Flow canvases are the hard part: provide a parallel, focusable list view of nodes
and links so the topology is reachable without pointer interaction.

## 3. Performance

Budgets (measure, do not guess):

- LCP < 2.5 s, CLS < 0.1, INP < 200 ms on the home page and a representative module
- Initial JS for a module route < 250 KB gzipped
- Playback holds 60 fps with ~50 nodes and ~20 concurrent packets

Techniques, in order of payoff:

1. **Route-level code splitting** — React Flow and each module's scenarios load only on
   their route (`next/dynamic`). This is the single biggest win.
2. Memoize `projectAt` results per frame; never recompute the whole `SimResult` during
   playback.
3. Keep the rAF loop doing transform updates only — no React state churn per frame for
   packet positions (use refs / transforms).
4. `next/font` for self-hosted fonts; no layout shift.
5. Static-render everything except the diagnostics routes.
6. Profile with React DevTools before optimizing anything else.

## 4. Error handling and edge states

- `error.tsx` per route group with a useful message and a reset action
- `not-found.tsx` for unknown modules/lessons
- `loading.tsx` skeletons for module routes
- Every module handles: scenario failed to load, unsupported input, empty state
- Live diagnostics handles: blocked, rate-limited, timeout, upstream error

## 5. CI

`.github/workflows/ci.yml` on push and PR:

1. `npm ci`
2. `npm run lint` (includes the architecture boundary rules — this is what keeps the
   architecture intact over time)
3. `npx tsc --noEmit`
4. `npm run format:check`
5. `npm test -- --coverage` with the thresholds above enforced
6. `npx playwright test`

Fail the build on any step. The boundary lint rule in CI is what stops the codebase
sliding back into entangled visualization + networking logic.

## 6. Documentation

- **`README.md`** — rewrite: what the project is, a screenshot or GIF per flagship
  module, the module list, run instructions, architecture summary, and an explicit
  "everything is simulated except the clearly-marked live diagnostics" statement
- **`docs/ACCURACY.md`** — the protocol claims the product makes, each mapped to its RFC.
  This is the artifact that makes the project credible to a networking-literate reviewer
- **`docs/CONTENT-STYLE.md`** — how to write annotations and lessons: tone, length
  budget, when to cite an RFC, how to phrase a simplification honestly
- **`CLAUDE.md`** — final pass: real commands, current architecture, module status

## 7. Deployment

- Deploy to Vercel from the `main` branch; preview deployments on PRs
- Environment variables in `.env.example`, documented; no secrets committed
- Security headers via `next.config.ts` or `vercel.json`: `Content-Security-Policy`
  (start report-only, then enforce), `Strict-Transport-Security`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy` denying camera/mic/geolocation
- Rate limiting on `/api/diagnostics/*` verified in production, not just locally
- `sitemap.ts`, `robots.ts`, per-route metadata, and an OG image so shared links look
  right
- Optional: Vercel Analytics / Speed Insights to track the Core Web Vitals budgets

## 8. Final review pass

- [ ] Every registry module's status matches reality
- [ ] Exactly one module has `usesRealNetwork: true`
- [ ] No `console.log` left in shipped code
- [ ] No TODO/FIXME without an issue reference
- [ ] No hardcoded colors outside `tokens.css`
- [ ] `src/core` still imports zero framework code
- [ ] No cross-module imports

---

## Acceptance criteria

- [ ] CI is green on all six steps
- [ ] Coverage thresholds met and enforced
- [ ] Zero serious/critical axe violations on every route
- [ ] Core Web Vitals budgets met on home + one module route
- [ ] Production deployment live with security headers verified
- [ ] README, ACCURACY.md, CONTENT-STYLE.md, and CLAUDE.md all current

---

## Prompts to execute

### Prompt 14.1 — test suite completion

```
Read docs/implementation/14-quality-and-deployment.md, section 1.

Set up Playwright and write e2e/smoke.spec.ts (every registry route loads with no
console errors), e2e/modules.spec.ts (each 'ready' module loads, runs a scenario to
completion, steps backwards, and opens the inspector), and a determinism guard test that
runs every scenario in the codebase twice and asserts deep equality.

Then raise unit coverage to the thresholds in the doc: src/core >= 90%,
src/core/net/guard.ts >= 95%, and every module sim/ folder covered. Report the numbers.
```

### Prompt 14.2 — accessibility pass

```
Work through section 2 of docs/implementation/14-quality-and-deployment.md.

Add e2e/a11y.spec.ts running axe-core against every route and failing on serious or
critical violations. Then fix everything it finds, plus the manual checks in the
checklist: keyboard traversal of the timeline, aria-live phase announcements, a
focusable list-view alternative to each React Flow canvas, contrast ratios, grayscale
verification that no meaning is color-only, heading hierarchy, and 200% zoom.

Report what you fixed and anything you could not fix, with the reason.
```

### Prompt 14.3 — performance pass

```
Work through section 3 of docs/implementation/14-quality-and-deployment.md.

Measure first: report current bundle sizes per route and Core Web Vitals for the home
page and one module route. Then apply route-level code splitting for React Flow and
module scenarios, memoize projectAt per frame, move per-frame packet positioning off
React state onto refs/transforms, and set up next/font.

Re-measure and report before/after numbers against the budgets in the doc. Do not
optimize anything you have not measured.
```

### Prompt 14.4 — error states, CI, and docs

```
Implement sections 4, 5, and 6 of docs/implementation/14-quality-and-deployment.md:
error.tsx / not-found.tsx / loading.tsx for the module route group and the listed edge
states; the GitHub Actions CI workflow with all six steps failing the build on error;
and the documentation set — rewritten README.md, docs/ACCURACY.md mapping every protocol
claim to its RFC, docs/CONTENT-STYLE.md, and a final CLAUDE.md update.
```

### Prompt 14.5 — deploy and final review

```
Implement sections 7 and 8 of docs/implementation/14-quality-and-deployment.md.

Add the security headers (CSP report-only first, then enforce, HSTS, nosniff,
Referrer-Policy, Permissions-Policy), sitemap.ts, robots.ts, per-route metadata, and an
OG image. Document all env vars in .env.example.

Deploy to Vercel, then verify in production: the headers are present, /api/diagnostics/*
rate limiting works, and no live network call can be made from a simulated module.

Finally run the section-8 review checklist and report any item that fails.
```
