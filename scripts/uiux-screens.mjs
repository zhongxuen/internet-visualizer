// Screenshots and three layout numbers for every route, against a production server.
//
//   npm run build
//   npx next start --port 3100                 # in another shell; restart after every build
//   npm run uiux:screens -- <label>            # label defaults to "baseline"
//   PLAYWRIGHT_PORT=3102 npm run uiux:screens -- ux-2.3
//
// The UI/UX restructure (docs/implementation/uiux.md) is measured against the "before"
// picture this takes. Every step reruns it under its own label and compares against
// .uiux/baseline, so three things here are deliberate:
//
//   - It writes under the MAIN checkout's .uiux/, not the current worktree's: the parent of
//     `git rev-parse --git-common-dir`. Every worktree then writes to, and compares
//     against, the same baseline. UIUX_DIR overrides that root.
//   - The route list is e2e/routes.ts's ROUTES, imported rather than restated, so a module
//     or lesson added later is photographed without anyone editing this file.
//   - It starts no server. Like playwright.config.ts it reads PLAYWRIGHT_PORT (default
//     3100), and it refuses to run against nothing rather than record empty metrics.
//
// For each route, at 1366x768 and 390x844, it saves a viewport screenshot (not full page)
// to .uiux/<label>/<viewport>/<route>.png. On a module route that renders a canvas it
// also records, in .uiux/<label>/metrics.json:
//
//   (a) playInFirstViewport -- whether the Play button is fully inside the first viewport;
//   (b) controlsAboveCanvas -- how many interactive elements inside <main> sit entirely
//       above the canvas (the site nav is outside <main>, and is counted separately in
//       controlsAboveCanvasWithNav so the two can't be confused);
//   (c) nodeLabelPx -- the rendered height in CSS px of one node label on the canvas: the
//       label's font size times the React Flow viewport's transform scale.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const LABEL = process.argv[2] ?? 'baseline';
if (!/^[A-Za-z0-9._-]+$/.test(LABEL)) {
  console.error(`uiux:screens: the label must be a plain folder name, got "${LABEL}".`);
  process.exit(2);
}

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const BASE = `http://127.0.0.1:${PORT}`;
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const VIEWPORTS = [
  { name: '1366x768', width: 1366, height: 768, mobile: false },
  { name: '390x844', width: 390, height: 844, mobile: true },
];

/** How many pages load at once. Enough to finish in a few minutes, few enough not to skew a laptop. */
const CONCURRENCY = Number(process.env.UIUX_CONCURRENCY ?? 3);

function git(...args) {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
}

function outputRoot() {
  if (process.env.UIUX_DIR) return resolve(process.env.UIUX_DIR);
  // In a worktree this is the main checkout's .git; its parent is the main checkout.
  return dirname(git('rev-parse', '--path-format=absolute', '--git-common-dir'));
}

/**
 * e2e/routes.ts is TypeScript with `@/` imports. jiti -- the loader Tailwind 4 already
 * installs to read its own config -- compiles it on the fly, so the list is imported
 * rather than copied. Everything it pulls in is plain data (the registry and the lesson
 * metadata), never a component or an MDX file.
 */
async function loadRoutes() {
  let createJiti;
  try {
    ({ createJiti } = await import('jiti'));
  } catch {
    console.error(
      'uiux:screens: could not load jiti, which reads e2e/routes.ts. Run `npm ci` first.',
    );
    process.exit(2);
  }
  const jiti = createJiti(import.meta.url, {
    alias: { '@': join(REPO, 'src') },
    interopDefault: true,
  });
  const routes = await jiti.import(join(REPO, 'e2e', 'routes.ts'));
  const { MODULES } = await jiti.import(join(REPO, 'src', 'modules', 'registry.ts'));
  return {
    routes: routes.ROUTES,
    moduleRoutes: new Set(MODULES.map((m) => m.route)),
  };
}

async function assertServer() {
  try {
    const res = await fetch(BASE + '/', { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (error) {
    console.error(
      [
        `uiux:screens: nothing answered on ${BASE} (${error.cause?.code ?? error.message}).`,
        'It needs a production server that is already running:',
        '',
        '  npm run build',
        `  npx next start --port ${PORT}`,
        '',
        'Set PLAYWRIGHT_PORT to use another port. Restart the server after every build.',
      ].join('\n'),
    );
    process.exit(1);
  }
}

/** '/' -> 'home', '/learn/first-steps/x' -> 'learn__first-steps__x': one flat, Windows-safe name. */
function fileName(path) {
  return path === '/' ? 'home' : path.replace(/^\/+/, '').replace(/\//g, '__');
}

/**
 * The canvas arrives as its own chunk, and React Flow fits the view only once every node
 * has been measured. Screenshots and the scale metric both mean nothing before that, so
 * wait for a node, then for the viewport transform to hold still.
 */
async function waitForCanvas(page) {
  const node = page.locator('.react-flow__node').first();
  const appeared = await node
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return false;
  await page
    .waitForFunction(
      () => {
        const vp = document.querySelector('.react-flow__viewport');
        if (!vp) return false;
        const t = getComputedStyle(vp).transform;
        const w = window;
        const now = performance.now();
        if (w.__uiuxLastT !== t) {
          w.__uiuxLastT = t;
          w.__uiuxSince = now;
          return false;
        }
        return now - w.__uiuxSince > 600;
      },
      undefined,
      { polling: 100, timeout: 10_000 },
    )
    .catch(() => {});
  return true;
}

/** Runs in the page. Everything is measured at scroll 0, before any interaction. */
function measureInPage() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const visible = (el) => {
    if (
      typeof el.checkVisibility === 'function' &&
      !el.checkVisibility({ visibilityProperty: true })
    )
      return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const canvas = document.querySelector('.react-flow');
  if (!canvas) return { canvas: false };
  const canvasTop = canvas.getBoundingClientRect().top;

  // (a) The Play button, by its accessible name. Icon-only today, so it is aria-label.
  const play = [...document.querySelectorAll('button')].find(
    (b) =>
      /^play$/i.test((b.getAttribute('aria-label') ?? b.textContent ?? '').trim()) &&
      visible(b),
  );
  let playRect = null;
  let playInFirstViewport = false;
  if (play) {
    const r = play.getBoundingClientRect();
    playRect = {
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
    playInFirstViewport = r.left >= 0 && r.top >= 0 && r.right <= vw && r.bottom <= vh;
  }

  // (b) Controls: native interactive elements and ARIA widget roles. A bare tabindex is
  // left out on purpose -- a scrollable Panel carries one (CLAUDE.md, accessibility rule
  // 2) and is a tab stop, not a control.
  const CONTROL = [
    'a[href]',
    'button',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    'summary',
    '[role="button"]',
    '[role="link"]',
    '[role="tab"]',
    '[role="switch"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="menuitem"]',
    '[role="slider"]',
    '[role="combobox"]',
  ].join(',');
  const above = (root) =>
    root
      ? [...root.querySelectorAll(CONTROL)].filter(
          (el) =>
            !canvas.contains(el) &&
            !el.closest('.sr-only') &&
            visible(el) &&
            el.getBoundingClientRect().bottom <= canvasTop + 1,
        ).length
      : null;

  // (c) The node's name is the largest text in its card; that survives a redesign of
  // what else the card shows.
  let nodeLabel = null;
  const node = document.querySelector('.react-flow__node');
  const viewport = document.querySelector('.react-flow__viewport');
  if (node && viewport) {
    let best = null;
    for (const el of node.querySelectorAll('*')) {
      const own = [...el.childNodes].some(
        (n) => n.nodeType === 3 && n.textContent.trim(),
      );
      if (!own || !visible(el)) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (!best || size > best.size) best = { size, text: el.textContent.trim() };
    }
    const scale = new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a;
    if (best) {
      nodeLabel = {
        text: best.text.slice(0, 60),
        fontPx: best.size,
        scale: +scale.toFixed(4),
        renderedPx: +(best.size * scale).toFixed(2),
      };
    }
  }

  return {
    canvas: true,
    canvasTop: Math.round(canvasTop),
    playFound: !!play,
    playRect,
    playInFirstViewport,
    controlsAboveCanvas: above(document.querySelector('main')),
    controlsAboveCanvasWithNav: above(document.body),
    nodeLabelPx: nodeLabel?.renderedPx ?? null,
    nodeLabel,
  };
}

async function shoot(browser, viewport, route, outDir, isModule) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    isMobile: viewport.mobile,
    hasTouch: viewport.mobile,
  });
  const page = await context.newPage();
  try {
    const res = await page.goto(BASE + route.path, {
      waitUntil: 'load',
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    const hasCanvas = isModule ? await waitForCanvas(page) : false;
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: join(outDir, viewport.name, `${fileName(route.path)}.png`),
      animations: 'disabled',
    });
    const metrics = isModule
      ? hasCanvas
        ? await page.evaluate(measureInPage)
        : { canvas: false }
      : undefined;
    return { status: res?.status() ?? null, metrics };
  } finally {
    await context.close();
  }
}

/** A small worker pool: CONCURRENCY pages at a time, results in input order. */
async function pool(items, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await worker(items[i], i);
      }
    }),
  );
  return results;
}

const { routes, moduleRoutes } = await loadRoutes();
await assertServer();

const outDir = join(outputRoot(), '.uiux', LABEL);
for (const v of VIEWPORTS) mkdirSync(join(outDir, v.name), { recursive: true });

let commit = null;
try {
  commit = git('rev-parse', '--short', 'HEAD');
} catch {
  // Not fatal: the numbers are still worth having without it.
}

const jobs = routes.flatMap((route) =>
  VIEWPORTS.map((viewport) => ({ route, viewport })),
);
console.log(
  `uiux:screens: ${routes.length} routes x ${VIEWPORTS.length} viewports from ${BASE}`,
);
console.log(`              -> ${outDir}`);

const browser = await chromium.launch();
const failures = [];
const results = await pool(jobs, async ({ route, viewport }) => {
  const isModule = moduleRoutes.has(route.path);
  try {
    const r = await shoot(browser, viewport, route, outDir, isModule);
    if (r.status !== 200)
      failures.push(`${route.path} @ ${viewport.name}: HTTP ${r.status}`);
    process.stdout.write('.');
    return { route, viewport, ...r };
  } catch (error) {
    failures.push(`${route.path} @ ${viewport.name}: ${error.message.split('\n')[0]}`);
    process.stdout.write('x');
    return { route, viewport, status: null, error: error.message.split('\n')[0] };
  }
});
await browser.close();
process.stdout.write('\n');

const modules = {};
for (const r of results) {
  if (!moduleRoutes.has(r.route.path)) continue;
  (modules[r.route.path] ??= {})[r.viewport.name] = r.metrics ?? { error: r.error };
}

writeFileSync(
  join(outDir, 'metrics.json'),
  JSON.stringify(
    {
      label: LABEL,
      takenAt: new Date().toISOString(),
      commit,
      base: BASE,
      viewports: VIEWPORTS.map((v) => v.name),
      screenshots: routes.length * VIEWPORTS.length - failures.length,
      definitions: {
        playInFirstViewport:
          'the button named "Play" is fully inside the viewport at scroll 0, before any interaction',
        controlsAboveCanvas:
          'visible links, buttons, inputs, selects, textareas, summaries and ARIA widgets inside <main> whose bottom edge is at or above the canvas top',
        controlsAboveCanvasWithNav:
          'the same count over the whole document, site nav included',
        nodeLabelPx:
          "the first node's largest text: computed font size x the React Flow viewport's transform scale, in CSS px",
      },
      modules,
    },
    null,
    2,
  ) + '\n',
);

// The table the plan's docs quote, so a run can be pasted without reading the JSON.
console.log(
  '\nmodule'.padEnd(24) +
    VIEWPORTS.map((v) => `| ${v.name}: play  above  label px `).join(''),
);
for (const [path, byViewport] of Object.entries(modules)) {
  const cells = VIEWPORTS.map((v) => {
    const m = byViewport[v.name] ?? {};
    if (!m.canvas) return '| (no canvas)                  ';
    return `| ${String(m.playInFirstViewport ? 'yes' : 'no').padEnd(12)}${String(m.controlsAboveCanvas).padEnd(7)}${String(m.nodeLabelPx).padEnd(10)}`;
  });
  console.log(path.padEnd(23) + cells.join(''));
}

if (failures.length) {
  console.error(`\n${failures.length} page(s) failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`\nwrote ${join(outDir, 'metrics.json')}`);
