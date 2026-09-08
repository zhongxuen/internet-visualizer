// Core Web Vitals and playback smoothness, against a production build on :3100.
//
//   node perf/vitals.mjs [cpuThrottle] [runs]
//   ROUTES=/,/packet-journey node perf/vitals.mjs 4 3
//
// See ./README.md for what the numbers mean and how they are meant to be read.
//
// Two things here are not optional. The collector is installed with `addInitScript`, so
// it is running before the first byte of the document is parsed -- LCP and layout-shift
// entries cannot be trusted when the observer is added afterwards, and a page loaded into
// a background tab records neither. And bytes are counted before any interaction, because
// Next prefetches every `<Link>` in view once it has hydrated.
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3100';
const CPU = Number(process.argv[2] ?? 4);
const RUNS = Number(process.argv[3] ?? 3);

const ROUTES = (process.env.ROUTES ?? '/,/packet-journey,/internet-simulator')
  .split(',')
  .map((path) => ({ path, label: path }));

const COLLECTOR = () => {
  const s = {
    lcp: 0,
    lcpEl: '',
    cls: 0,
    shifts: [],
    events: [],
    longTasks: 0,
    longTaskMs: 0,
  };
  window.__vitals = s;
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      s.lcp = e.startTime;
      s.lcpEl = e.element
        ? e.element.tagName +
          (e.element.className ? '.' + String(e.element.className).slice(0, 30) : '')
        : '(text)';
    }
  }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      if (e.hadRecentInput) continue;
      s.cls += e.value;
      if (e.value > 0.0005)
        s.shifts.push({ v: +e.value.toFixed(4), t: Math.round(e.startTime) });
    }
  }).observe({ type: 'layout-shift', buffered: true });
  // INP is the worst interaction, so every event over a frame is kept and the max taken.
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) s.events.push({ name: e.name, dur: e.duration });
  }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      s.longTasks++;
      s.longTaskMs += e.duration;
    }
  }).observe({ type: 'longtask', buffered: true });
};

/**
 * Press the playback controls, so INP measures the hot path rather than a nav link.
 *
 * Deliberately never clicks an `<a href>`: a client-side navigation would pull in the
 * next route's chunks and inflate the first-load JS figure for the route under test.
 */
async function interact(page) {
  const el = page.locator('button:not([aria-haspopup])').first();
  if (await el.count()) {
    await el.click({ timeout: 2000, noWaitAfter: true }).catch(() => {});
    await page.waitForTimeout(350);
  }
  // The timeline is keyboard-driven: space toggles playback, the arrows step.
  for (const key of ['Space', 'ArrowRight', 'ArrowRight', 'Space']) {
    await page.keyboard.press(key).catch(() => {});
    await page.waitForTimeout(250);
  }
}

/**
 * Frames actually painted while a run plays, which is the doc's third budget.
 *
 * Counted with rAF from inside the page: under CPU throttling the browser still fires
 * rAF once per display frame, so a loop that misses frames shows up directly as a lower
 * count. Playback is started from the keyboard because that is the one control every
 * module's `SimulationView` shares.
 */
async function measurePlayback(page, ms = 4000) {
  const play = page.locator('button[aria-label="Play"]').first();
  if ((await play.count()) === 0) return null;

  // The canvas is code-split, so it arrives after the rest of the page. Measuring
  // through its chunk landing would report module loading as playback jank.
  await page
    .locator('.react-flow__node')
    .first()
    .waitFor({ state: 'visible', timeout: 15000 })
    .catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(500);
  await play.click({ timeout: 3000, noWaitAfter: true }).catch(() => {});
  // The button flips to Pause only if the store actually entered `playing`; without
  // this the numbers below would describe a stationary page.
  const playing = await page
    .locator('button[aria-label="Pause"]')
    .first()
    .waitFor({ state: 'visible', timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  if (!playing) return { playing: false };

  const stats = await page.evaluate(
    (duration) =>
      new Promise((resolve) => {
        // Long Animation Frame reports every frame the renderer took over ~50 ms,
        // with the scripting time inside it. A run that holds 60 fps produces none.
        const loaf = [];
        const obs = new PerformanceObserver((l) => {
          for (const e of l.getEntries())
            loaf.push({ d: e.duration, b: e.blockingDuration });
        });
        obs.observe({ type: 'long-animation-frame' });
        let frames = 0;
        let worst = 0;
        let last = performance.now();
        const start = last;
        const tick = (now) => {
          frames++;
          worst = Math.max(worst, now - last);
          last = now;
          if (now - start < duration) requestAnimationFrame(tick);
          else {
            obs.disconnect();
            resolve({
              elapsed: now - start,
              frames,
              worstFrameMs: worst,
              loafCount: loaf.length,
              loafTotalMs: loaf.reduce((a, x) => a + x.d, 0),
              loafWorstMs: loaf.reduce((a, x) => Math.max(a, x.d), 0),
              blockingMs: loaf.reduce((a, x) => a + x.b, 0),
            });
          }
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
  await page
    .locator('button[aria-label="Pause"]')
    .first()
    .click({ timeout: 2000, noWaitAfter: true })
    .catch(() => {});
  return {
    playing: true,
    fps: +((stats.frames * 1000) / stats.elapsed).toFixed(1),
    worstFrameMs: Math.round(stats.worstFrameMs),
    loafCount: stats.loafCount,
    loafTotalMs: Math.round(stats.loafTotalMs),
    loafWorstMs: Math.round(stats.loafWorstMs),
    blockingMs: Math.round(stats.blockingMs),
  };
}

const median = (xs) => {
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
};

const browser = await chromium.launch();
const results = [];

for (const route of ROUTES) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(COLLECTOR);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });

    await page.goto(BASE + route.path, { waitUntil: 'load' });
    await page.waitForTimeout(1200);

    // Bytes are read before any interaction: anything fetched afterwards is by
    // definition not part of the route's first load.
    const bytes = await page.evaluate(() => {
      // Only what the document itself pulled in. Next prefetches every <Link> in view
      // once it has hydrated, and counting those would charge the home page for all ten
      // module routes.
      const loadEnd = performance.getEntriesByType('navigation')[0].loadEventEnd;
      const js = performance
        .getEntriesByType('resource')
        .filter((r) => r.name.endsWith('.js') && r.startTime <= loadEnd);
      const fonts = performance
        .getEntriesByType('resource')
        .filter((r) => /\.woff2?(\?|$)/.test(r.name));
      return {
        jsCount: js.length,
        jsKB: js.reduce((a, r) => a + (r.encodedBodySize || 0), 0) / 1024,
        fontCount: fonts.length,
        fontKB: fonts.reduce((a, r) => a + (r.encodedBodySize || 0), 0) / 1024,
        bodyFont: getComputedStyle(document.body).fontFamily.split(',')[0],
      };
    });

    const playback = await measurePlayback(page);
    await interact(page);
    await page.waitForTimeout(600);

    const v = await page.evaluate(() => {
      const s = window.__vitals;
      const nav = performance.getEntriesByType('navigation')[0];
      const fcp = performance.getEntriesByName('first-contentful-paint')[0];
      return {
        lcp: s.lcp,
        lcpEl: s.lcpEl,
        cls: s.cls,
        shifts: s.shifts,
        inp: s.events.reduce((m, e) => Math.max(m, e.dur), 0),
        longTasks: s.longTasks,
        longTaskMs: s.longTaskMs,
        fcp: fcp ? fcp.startTime : 0,
        ttfb: nav.responseStart,
      };
    });
    runs.push({ ...v, ...bytes, playback });
    await context.close();
  }

  results.push({
    route: route.path,
    label: route.label,
    LCP_ms: Math.round(median(runs.map((r) => r.lcp))),
    FCP_ms: Math.round(median(runs.map((r) => r.fcp))),
    CLS: +median(runs.map((r) => r.cls)).toFixed(4),
    INP_ms: Math.round(median(runs.map((r) => r.inp))),
    longTasks: Math.round(median(runs.map((r) => r.longTasks))),
    longTaskTotal_ms: Math.round(median(runs.map((r) => r.longTaskMs))),
    firstLoadJS_KB: +median(runs.map((r) => r.jsKB)).toFixed(1),
    jsRequests: runs[0].jsCount,
    fonts_KB: +median(runs.map((r) => r.fontKB)).toFixed(1),
    fontRequests: runs[0].fontCount,
    playback: (() => {
      const ok = runs.map((r) => r.playback).filter((p) => p && p.playing);
      if (!ok.length) return null;
      const med = (k) => median(ok.map((p) => p[k]));
      return {
        fps: +med('fps').toFixed(1),
        worstFrameMs: med('worstFrameMs'),
        loafCount: med('loafCount'),
        loafTotalMs: med('loafTotalMs'),
        loafWorstMs: med('loafWorstMs'),
        blockingMs: med('blockingMs'),
      };
    })(),
    bodyFont: runs[0].bodyFont,
    lcpElement: runs[0].lcpEl,
    worstShift: runs[0].shifts.sort((a, b) => b.v - a.v)[0] ?? null,
  });
}

await browser.close();

console.log(
  `\nCore Web Vitals -- production build, ${CPU}x CPU throttle, median of ${RUNS} runs`,
);
console.log('='.repeat(96));
for (const r of results) {
  const ok = (v, budget) => (v <= budget ? 'PASS' : 'FAIL');
  console.log(`\n${r.route}  (${r.label})`);
  console.log(
    `  LCP ${String(r.LCP_ms).padStart(5)} ms  budget 2500   ${ok(r.LCP_ms, 2500)}   element: ${r.lcpElement}`,
  );
  console.log(
    `  CLS ${String(r.CLS).padStart(5)}     budget 0.1    ${ok(r.CLS, 0.1)}   worst shift: ${JSON.stringify(r.worstShift)}`,
  );
  console.log(
    `  INP ${String(r.INP_ms).padStart(5)} ms  budget 200    ${ok(r.INP_ms, 200)}`,
  );
  console.log(`  FCP ${String(r.FCP_ms).padStart(5)} ms`);
  console.log(
    `  first-load JS ${r.firstLoadJS_KB} KB over ${r.jsRequests} requests   budget 250 KB   ${ok(r.firstLoadJS_KB, 250)}`,
  );
  console.log(
    `  fonts ${r.fonts_KB} KB over ${r.fontRequests} requests   body font resolves to: ${r.bodyFont}`,
  );
  console.log(`  long tasks ${r.longTasks} totalling ${r.longTaskTotal_ms} ms`);
  if (r.playback) {
    const p = r.playback;
    console.log(
      `  playback ${p.fps} fps over 4 s   budget 60   ${p.fps >= 55 ? 'PASS' : 'FAIL'}`,
    );
    console.log(
      `    long animation frames: ${p.loafCount}, totalling ${p.loafTotalMs} ms (worst ${p.loafWorstMs} ms, blocking ${p.blockingMs} ms)`,
    );
  } else {
    console.log(
      '  playback: not measured (no Play control, or it never entered playing)',
    );
  }
}
console.log('\n' + JSON.stringify(results));
