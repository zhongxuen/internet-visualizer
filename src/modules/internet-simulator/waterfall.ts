/**
 * The finished run, re-shaped into the rows a browser's Network panel would draw.
 *
 * Pure, and separate from `WaterfallChart.tsx` on purpose: the chart's job is to put a bar
 * on screen, and everything interesting about a waterfall happens before that -- deciding
 * which spans of the timeline belong to which named segment. Keeping the decision here
 * makes it testable, and makes the one rule this file exists to enforce checkable in a
 * single place.
 *
 * ## The rule: devtools' vocabulary, exactly
 *
 * The phase doc asks for the standard segment names, and the reason is that reading a real
 * waterfall is a transferable skill. A learner who has read `Waiting (TTFB)` here should
 * find the identical words in Chrome's Network panel, hover the identical tooltip, and be
 * looking at the identical thing. So the names in {@link WATERFALL_SEGMENTS} are Chrome's,
 * spelled Chrome's way -- `Initial connection` and not `TCP connect`, `SSL` and not `TLS`,
 * even though this codebase says TLS everywhere else -- and any renaming is a regression
 * whatever it does for internal consistency.
 *
 * ## Where the spans come from
 *
 * The document's row is the stage rail, re-cut. Each of the first six stages is exactly one
 * devtools segment, which is not a coincidence: devtools is showing the same page load and
 * had to name the same boundaries. The CDN stage is the one that splits, because the time
 * between the request leaving and the first byte arriving is `Waiting (TTFB)` and the time
 * after that is `Content Download`, and conflating them hides the single most useful
 * distinction on the chart -- a slow server and a big response look identical in a total.
 *
 * Subresource rows come from the render stage's own fetches, which are already timed
 * against the connection that the document opened. That is why they have no `DNS Lookup`,
 * `Initial connection`, or `SSL` segment: those were paid once, by the document, and a
 * waterfall that charged every row for them would teach the opposite of connection reuse.
 */

import type { StageId } from './sim/stage';
import { round2 } from './sim/stage';
import type { PageLoadRun } from './sim/pipeline';
import { stageOf } from './sim/pipeline';
import type { ResourceKind } from './sim/stage';

/**
 * Chrome's segment names, verbatim.
 *
 * `Stalled` is present and rarely drawn: it is time a request spent waiting on the browser
 * rather than on the network, which in this simulator only happens when HTTP/1.1's
 * six-connections-per-origin limit makes a request queue. That is exactly what the name
 * means in a real profile too.
 */
export const WATERFALL_SEGMENTS = [
  'Queueing',
  'Stalled',
  'DNS Lookup',
  'Initial connection',
  'SSL',
  'Request sent',
  'Waiting (TTFB)',
  'Content Download',
] as const;

/** One of the eight names above. */
export type WaterfallSegmentName = (typeof WATERFALL_SEGMENTS)[number];

/**
 * What each name means, in the words a learner needs to carry to a real profile.
 *
 * Shown as the tooltip on every bar, so the vocabulary is learned by using it rather than
 * by being listed somewhere.
 */
export const SEGMENT_NOTES: Readonly<Record<WaterfallSegmentName, string>> = {
  Queueing:
    'Before the request existed: the browser deciding what to ask for, and whether it needed to ask at all.',
  Stalled:
    'The request was ready and waiting on the browser, not the network -- usually for a free connection to the origin.',
  'DNS Lookup':
    'Turning the host name into an address. Paid once per name, then cached for the TTL.',
  'Initial connection':
    'The TCP handshake, and any retransmission of it. One round trip on a healthy link.',
  SSL: 'The TLS handshake: key agreement and certificate verification. Extra round trips, before any HTTP exists.',
  'Request sent':
    'Clocking the request bytes onto the link. Almost always tiny -- a request is small.',
  'Waiting (TTFB)':
    'Request delivered, nothing back yet: one propagation delay plus however long the server took to think.',
  'Content Download':
    'The response body arriving. This is the part that bandwidth changes and round trips do not.',
};

/** One named span of one row. */
export interface WaterfallSegment {
  readonly name: WaterfallSegmentName;
  /** Absolute virtual millisecond the span begins. */
  readonly startMs: number;
  readonly durationMs: number;
}

/** One request, as a row of the chart. */
export interface WaterfallRow {
  readonly id: string;
  /** What devtools' Name column would show: `www.example.com`, `app.css`. */
  readonly label: string;
  readonly kind: ResourceKind | 'document';
  /** Absolute virtual millisecond the row begins. */
  readonly startMs: number;
  readonly endMs: number;
  readonly durationMs: number;
  /** Bytes over the client's link, headers included. Zero when nothing was sent. */
  readonly transferredBytes: number;
  /** True when the row never touched the network. */
  readonly fromCache: boolean;
  /** The response status, when there was a response. */
  readonly status?: number;
  /** The stage that owns this row, so clicking it can open the matching rail entry. */
  readonly stage: StageId;
  readonly segments: readonly WaterfallSegment[];
}

/** Every row, plus the scale they are drawn against. */
export interface Waterfall {
  readonly rows: readonly WaterfallRow[];
  /** The width of the chart, in virtual milliseconds. Never zero. */
  readonly durationMs: number;
}

/** A span, dropped if it is not long enough to be worth a name. */
function span(
  name: WaterfallSegmentName,
  startMs: number,
  durationMs: number,
): WaterfallSegment | undefined {
  if (!(durationMs > 0)) return undefined;
  return { name, startMs: round2(startMs), durationMs: round2(durationMs) };
}

/** The stage-to-segment mapping for the document, in pipeline order. */
const DOCUMENT_SEGMENTS: readonly {
  readonly stage: StageId;
  readonly name: WaterfallSegmentName;
}[] = [
  { stage: 'url-parse', name: 'Queueing' },
  { stage: 'cache-check', name: 'Queueing' },
  { stage: 'dns', name: 'DNS Lookup' },
  { stage: 'tcp', name: 'Initial connection' },
  { stage: 'tls', name: 'SSL' },
  { stage: 'http', name: 'Request sent' },
];

/**
 * The document's row.
 *
 * Built from the stages rather than from the HTTP result, because the whole point of the
 * document row is that the request is the last thing that happens: four stages of
 * preparation, and only then a byte of HTML. A row that started at the request would hide
 * the cost this module exists to show.
 */
function documentRow(run: PageLoadRun): WaterfallRow {
  const segments: WaterfallSegment[] = [];

  for (const entry of DOCUMENT_SEGMENTS) {
    const stage = stageOf(run, entry.stage);
    if (!stage || stage.status !== 'ran') continue;
    const piece = span(entry.name, stage.startMs, stage.durationMs);
    if (piece) segments.push(piece);
  }

  // The CDN stage is the response, and it is the one stage that splits: everything up to
  // the first byte is waiting, everything after it is transfer.
  const cdn = stageOf(run, 'cdn');
  const result = run.state.cdn;
  if (cdn && cdn.status === 'ran' && result) {
    const waiting = span('Waiting (TTFB)', cdn.startMs, result.firstByteAt);
    if (waiting) segments.push(waiting);
    const download = span(
      'Content Download',
      cdn.startMs + result.firstByteAt,
      result.completedAt - result.firstByteAt,
    );
    if (download) segments.push(download);
  }

  const first = segments[0];
  const last = segments[segments.length - 1];
  const startMs = first?.startMs ?? 0;
  const endMs = last ? round2(last.startMs + last.durationMs) : 0;
  const served = run.state.cdn?.response ?? run.state.cache?.served;
  const fromCache = run.state.cache?.skipsNetwork ?? false;

  return {
    id: 'document',
    label: run.page.host,
    kind: 'document',
    startMs,
    endMs,
    durationMs: round2(endMs - startMs),
    transferredBytes: run.state.cdn?.transferredBytes ?? 0,
    fromCache,
    ...(served ? { status: served.status } : {}),
    stage: 'cdn',
    segments,
  };
}

/**
 * The subresource rows.
 *
 * Timed by the render stage against the connection the document already opened, so they
 * carry no connection segments -- see the note at the top of this file. A row served out of
 * the browser's own store keeps its place in the order and gets a single hairline
 * `Content Download`, which is what devtools draws for a cache hit and is the visual
 * argument for caching all by itself.
 */
function subresourceRows(run: PageLoadRun): WaterfallRow[] {
  const render = stageOf(run, 'render');
  const result = run.state.render;
  if (!render || !result) return [];

  const base = render.startMs;

  return result.fetches.map((fetch): WaterfallRow => {
    const segments: WaterfallSegment[] = [];
    const startedAt = fetch.queuedAt + fetch.blockedMs;

    const stalled = span('Stalled', base + fetch.queuedAt, fetch.blockedMs);
    if (stalled) segments.push(stalled);

    const waiting = span(
      'Waiting (TTFB)',
      base + startedAt,
      fetch.firstByteAt - startedAt,
    );
    if (waiting) segments.push(waiting);

    const download = span(
      'Content Download',
      base + fetch.firstByteAt,
      fetch.completedAt - fetch.firstByteAt,
    );
    if (download) segments.push(download);

    // A cache hit is instantaneous by construction, so every span above rounds to nothing.
    // Give it a visible sliver rather than an empty row: the row is the point.
    if (segments.length === 0) {
      segments.push({
        name: 'Content Download',
        startMs: round2(base + fetch.queuedAt),
        durationMs: round2(Math.max(0.5, fetch.completedAt - fetch.queuedAt)),
      });
    }

    const first = segments[0]!;
    const last = segments[segments.length - 1]!;
    const startMs = first.startMs;
    const endMs = round2(last.startMs + last.durationMs);

    return {
      id: fetch.resource.id,
      label: fetch.resource.label,
      kind: fetch.resource.kind,
      startMs,
      endMs,
      durationMs: round2(endMs - startMs),
      transferredBytes: fetch.transferredBytes,
      fromCache: fetch.source === 'browser-cache',
      status: fetch.resource.response.status,
      stage: 'render',
      segments,
    };
  });
}

/**
 * Every request this run made, in start order, ready to draw.
 *
 * The document is always first even when a subresource technically starts on the same
 * millisecond, because nothing else could have been discovered before it arrived.
 */
export function buildWaterfall(run: PageLoadRun): Waterfall {
  const rows = [documentRow(run), ...subresourceRows(run)];
  const widest = rows.reduce((latest, row) => Math.max(latest, row.endMs), 0);

  return {
    rows,
    durationMs: Math.max(1, round2(Math.max(widest, run.metrics.loadMs))),
  };
}
