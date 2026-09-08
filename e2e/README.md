# `e2e/` — Playwright

Browser tests, run against a **production build** (`next build && next start`), never the
dev server. See the comment at the top of `../playwright.config.ts` for why.

```bash
npm run test:e2e              # everything, building first
npm run test:e2e -- smoke     # one spec
npm run test:e2e:ui           # the Playwright UI runner
```

Outside CI the server is reused if one is already listening on port 3100, so
`npx next build && npx next start --port 3100` once makes every subsequent run fast.

`security.spec.ts` can also be pointed at a deployment, which is the one thing here that
a local build cannot answer -- whether a platform strips or rewrites a header on the way
out:

```bash
PLAYWRIGHT_BASE_URL=https://internet-visualizer.vercel.app npx playwright test e2e/security.spec.ts
```

No server is started when that variable is set. It is also the middle step of the CSP
rollout in `.env.example`: deploy a preview with `CSP_MODE=report-only`, run this
against it, then enforce.

## What belongs here

Only what a browser can answer and jsdom cannot. `tests/setup.ts` stubs
`ResizeObserver` and `getBoundingClientRect` so React Flow will mount in jsdom at all,
and every box it measures there is zero-sized — so layout, real clicks on a node, rAF
playback and anything that depends on a page actually being assembled by Next belong in
this folder. Logic belongs in a unit test, and a module's own controls belong in that
module's Testing Library suite.

## What must not

A route list, a module list, or a lesson list written out by hand. `routes.ts` derives
all three from `src/modules/registry.ts` and `allLessonParams()`, which is what makes
"every route loads" true of the routes that exist rather than of the routes someone
remembered.

## Files

| File                   | Asks                                                                 |
| ---------------------- | -------------------------------------------------------------------- |
| `routes.ts`            | not a spec — the derived route list and the console-error watcher     |
| `smoke.spec.ts`        | does every URL serve a 200, one `h1`, and no console errors?          |
| `modules.spec.ts`      | does each simulating module play, step back, and open its inspector?  |
| `a11y.spec.ts`         | is every route free of serious/critical axe violations, with a sane heading hierarchy? |
| `a11y-manual.spec.ts`  | the section-2 checklist items axe cannot see: keyboard, live regions, the list view, 200% zoom |
| `security.spec.ts`     | do the security headers arrive on every response, and does anything violate the CSP? |

## The two accessibility specs

They are split because they answer different questions and fail for different reasons.

`a11y.spec.ts` is the **static** scan: axe-core on every URL, failing on `serious` and
`critical` only. That severity floor is the phase-14 acceptance criterion, and it is
deliberate — `moderate` and `minor` are largely conventions, and gating on them turns the
suite into a style checker that the first legitimate exception switches off. Heading
hierarchy rides along in the same page load because axe will not check it at this
severity (`heading-order` is `moderate`, `page-has-heading-one` is best-practice rather
than WCAG) and the checklist asks for it anyway.

`a11y-manual.spec.ts` is the **behavioural** half. No static scan can tell you that the
timeline is drivable from the keyboard, that a phase change is announced rather than
merely drawn, that the topology has a non-pointer alternative that actually selects
something, or that the layout reflows at 200% zoom without scrolling sideways. Those are
assertions about using the product, so they are written against `SimulationView` — nine
modules render it, so a regression there is a regression in all nine.

Both specs get their route list from `routes.ts`, so a lesson added tomorrow is scanned
tomorrow.
