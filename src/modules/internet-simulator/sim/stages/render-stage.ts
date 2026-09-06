/**
 * Stage 8 -- the document arrives, and the page load starts over again.
 *
 * The most common misconception about page loads is that they end when the HTML arrives.
 * They begin there. The parser walks the document, finds a stylesheet and three scripts
 * and an image, and every one of those is another request -- on the same connection if the
 * protocol allows it, on one of six connections if it does not.
 *
 * The scheduling of those requests is not this module's invention. `planVersionRun` in
 * `@/core/protocols/http/versions` already models it: HTTP/1.1's six-connections-per-origin
 * limit and the application-layer head-of-line blocking that follows from it, HTTP/2's
 * single multiplexed connection and the *transport*-layer head-of-line blocking that
 * replaces it, and HTTP/3's independent streams. It was written for the HTTP Explorer's
 * version comparison; here it is doing exactly the same job for the tail of a real page
 * load, which is what promoting it to `core` was for.
 *
 * Two adjustments are made to what it returns, and both are stated here rather than buried:
 *
 * 1. **The handshake is subtracted.** `planVersionRun` starts its clock with a connection
 *    setup, because a version comparison has to pay for one. This stage already has an open
 *    connection -- the TCP and TLS stages paid for it -- so every stream time is shifted
 *    back by `handshake.ms`. Reusing a connection is the single biggest thing HTTP/1.1
 *    keep-alive bought, and pretending to pay for it twice would hide that.
 * 2. **Cached subresources never reach the planner.** Anything the browser's own cache can
 *    serve is answered locally in about a millisecond and is not scheduled at all, which is
 *    why a repeat visit's waterfall is mostly empty.
 *
 * ## First paint and LCP
 *
 * First paint waits for every render-blocking resource. A stylesheet in `<head>` is
 * render-blocking because painting text in the wrong font and then re-painting it is worse
 * than painting nothing -- so the browser holds the frame. That single fact is the most
 * commonly useful performance lesson there is, and this stage marks it on the timeline
 * rather than explaining it in a paragraph.
 *
 * Largest contentful paint is when the biggest thing above the fold has arrived. It is
 * usually an image, it is usually the last thing to finish, and it is the metric users
 * actually feel.
 */

import {
  isShared,
  lookupCache,
  serveFromCache,
  storeResponse,
  type HttpCache,
} from '@/core/protocols/http/caching';
import {
  planVersionRun,
  type StreamTiming,
  type VersionRun,
} from '@/core/protocols/http/versions';
import type { HttpVersion } from '@/core/protocols/http/message';
import type { RfcRef, SimEvent } from '@/core/types/events';
import type { PDU } from '@/core/types/pdu';

import { MEMORY_CACHE_MS, requestFor, type PageResource } from '../page';
import {
  BROWSER_NODE,
  linkId,
  requireState,
  round2,
  type Stage,
  type StageOutput,
} from '../stage';

/** How long the parser takes per kilobyte of HTML before it can ask for anything. */
export const PARSE_MS_PER_KB = 0.08;

/** The frame itself, once everything blocking it has arrived. */
export const PAINT_MS = 8;

/** A tail after the last byte, so the timeline does not end mid-animation. */
export const RENDER_TAIL_MS = 60;

const RFC_9110_LINK: RfcRef = { rfc: 9110, section: '8.3', title: 'HTTP Semantics' };

/** How each subresource was obtained. */
export type FetchSource = 'network' | 'browser-cache';

/** One subresource, placed on the timeline. */
export interface RenderFetch {
  readonly resource: PageResource;
  readonly source: FetchSource;
  /** Local virtual millisecond the browser wanted it. */
  readonly queuedAt: number;
  /** Local virtual millisecond its first byte arrived. */
  readonly firstByteAt: number;
  /** Local virtual millisecond it finished. */
  readonly completedAt: number;
  /** Bytes that crossed the client's link. Zero when it came from the local cache. */
  readonly transferredBytes: number;
  /** Time spent waiting for a connection or a stream slot: application-layer blocking. */
  readonly blockedMs: number;
  /** The planner's own row, when this one was fetched. */
  readonly stream?: StreamTiming;
  readonly renderBlocking: boolean;
}

/** What the render stage established. */
export interface RenderResult {
  /** Local virtual millisecond the parser finished the document. */
  readonly parsedAt: number;
  readonly fetches: readonly RenderFetch[];
  /** The planner's whole run, when anything at all was fetched. */
  readonly plan?: VersionRun;
  /** Local virtual millisecond the first frame is painted. */
  readonly firstPaintAt: number;
  /** Local virtual millisecond the largest contentful element finishes painting. */
  readonly largestContentfulPaintAt: number;
  /** Local virtual millisecond the last subresource finished. */
  readonly loadAt: number;
  /** What held the first frame back, named. */
  readonly blockedFirstPaintBy: readonly string[];
  readonly browserCache: HttpCache;
  /** Total bytes the client's link carried for the subresources. */
  readonly transferredBytes: number;
}

/** Paint the page. */
export const renderStage: Stage = (context): StageOutput => {
  const page = requireState(context.state, 'page', 'render');
  const check = requireState(context.state, 'cache', 'render');
  const version: HttpVersion = context.state.tls?.httpVersion ?? 'HTTP/1.1';
  // The document's size, whether the bytes came off the wire or out of the store. A 304
  // saves the transfer, not the parse: the browser still has the same HTML to walk.
  const documentBytes = page.document.bytes;

  let browserCache = context.state.browserCache ?? check.browserCache;

  const events: SimEvent[] = [];
  const pdus: Record<string, PDU> = {};

  const parsedAt = round2((documentBytes / 1024) * PARSE_MS_PER_KB);

  events.push({
    kind: 'phase',
    at: 0,
    id: 'render',
    title: 'Parse, fetch what the page needs, paint',
    description:
      'The document is the beginning of the page load, not the end of it. Every stylesheet, script, font, and image it names is another request -- and the first frame cannot be painted until the ones that block it have arrived.',
  });
  events.push({ kind: 'node-state', at: 0, nodeId: BROWSER_NODE, state: 'processing' });
  events.push({
    kind: 'log',
    at: 0,
    level: 'info',
    text: `Parsing ${documentBytes} bytes of HTML.`,
  });

  // --- What the parser found -------------------------------------------------
  const wanted = page.subresources;
  const fromCache: PageResource[] = [];
  const toFetch: PageResource[] = [];

  for (const resource of wanted) {
    const lookup = lookupCache(
      browserCache,
      requestFor(resource, page.host, version),
      parsedAt,
      context.clock,
    );
    if (lookup.kind === 'hit' && lookup.entry) {
      fromCache.push(resource);
    } else {
      toFetch.push(resource);
    }
  }

  events.push({
    kind: 'log',
    at: parsedAt,
    level: 'info',
    text:
      wanted.length === 0
        ? 'The document names nothing else. This page is one request.'
        : `Parser found ${wanted.length} subresources: ${toFetch.length} to fetch, ${fromCache.length} already in the cache.`,
  });

  const fetches: RenderFetch[] = [];

  // Cached subresources are answered locally, in the order the parser found them.
  fromCache.forEach((resource, index) => {
    const at = round2(parsedAt + MEMORY_CACHE_MS * (index + 1));
    const lookup = lookupCache(
      browserCache,
      requestFor(resource, page.host, version),
      at,
      context.clock,
    );
    if (lookup.entry) {
      serveFromCache(lookup.entry, at, {
        shared: isShared(browserCache.tier),
        clock: context.clock,
      });
    }
    fetches.push({
      resource,
      source: 'browser-cache',
      queuedAt: parsedAt,
      firstByteAt: at,
      completedAt: at,
      transferredBytes: 0,
      blockedMs: 0,
      renderBlocking: resource.renderBlocking,
    });
    events.push({
      kind: 'log',
      at,
      level: 'info',
      text: `${resource.label}: served from the browser cache in ${MEMORY_CACHE_MS} ms. Nothing was sent.`,
    });
  });

  // --- What has to be fetched ------------------------------------------------
  let plan: VersionRun | undefined;
  const peerNode = context.state.tcp?.peerNode ?? BROWSER_NODE;
  const link = linkId(BROWSER_NODE, peerNode);

  if (toFetch.length > 0 && peerNode === BROWSER_NODE) {
    // Nothing opened a connection, because the document never needed one. A subresource
    // that is not also cached would open one here; saying so is better than quietly
    // producing a page-load time that assumed it was free.
    events.push({
      kind: 'log',
      at: parsedAt,
      level: 'warn',
      text: `${toFetch.map((resource) => resource.label).join(', ')} ${toFetch.length === 1 ? 'is' : 'are'} not in the cache, so a connection would have to be opened for ${toFetch.length === 1 ? 'it' : 'them'}. This run answered the document locally and stops here.`,
    });
  }

  if (toFetch.length > 0 && peerNode !== BROWSER_NODE) {
    plan = planVersionRun({
      version,
      resources: toFetch.map((resource) => ({
        id: resource.id,
        label: resource.label,
        target: resource.target,
        responseBytes: resource.bytes,
        serverThinkMs: resource.serverThinkMs,
      })),
      conditions: {
        rttMs: context.profile.rttMs,
        bandwidthKbps: context.profile.bandwidthKbps,
        lossRate: context.profile.lossRate,
        secure: context.state.tls !== undefined,
        resumed: true,
      },
      seed: `${context.scenario.id}:render`,
    });

    // The connection is already open; the planner charged for one, so take it back off.
    const shift = plan.handshake.ms;

    for (const stream of plan.streams) {
      const resource = toFetch.find((candidate) => candidate.id === stream.resourceId);
      if (!resource) continue;

      const queuedAt = round2(parsedAt + Math.max(0, stream.queuedAt - shift));
      const startedAt = round2(parsedAt + Math.max(0, stream.startedAt - shift));
      const firstByteAt = round2(parsedAt + Math.max(0, stream.firstByteAt - shift));
      const completedAt = round2(parsedAt + Math.max(0, stream.completedAt - shift));

      const id = `render-${resource.id}`;
      const pdu: PDU = {
        id,
        layers: [
          {
            layer: 'application',
            protocol: version,
            fields: [
              { name: 'Method', value: 'GET' },
              { name: 'Target', value: resource.target },
              ...(stream.streamId === undefined
                ? []
                : [{ name: 'Stream ID', value: `${stream.streamId}`, bits: 31 }]),
              {
                name: 'Header bytes',
                value: `${stream.requestHeaderBytesOnWire} of ${stream.requestHeaderBytesRaw}`,
              },
              {
                name: 'Blocked',
                value: `${stream.blockedMs} ms`,
                note:
                  stream.blockedMs > 0
                    ? 'Waiting for a connection or a stream slot, not for the network. This is application-layer head-of-line blocking.'
                    : 'Went out immediately.',
              },
              { name: 'Connection', value: stream.connectionId },
            ],
            payloadPreview: `GET ${resource.target}`,
          },
        ],
        sizeBytes: resource.bytes + stream.requestHeaderBytesOnWire,
        summary: `${resource.label} (${resource.bytes} bytes)`,
      };
      pdus[id] = pdu;

      events.push({ kind: 'pdu-created', at: startedAt, pdu, atNode: BROWSER_NODE });
      events.push({
        kind: 'transmit',
        at: startedAt,
        pduId: id,
        from: BROWSER_NODE,
        to: peerNode,
        durationMs: round2(Math.max(0.1, completedAt - startedAt)),
        linkId: link,
      });
      events.push({
        kind: 'log',
        at: completedAt,
        level: 'info',
        text: `${resource.label}: ${resource.bytes} bytes, first byte at ${firstByteAt} ms, done at ${completedAt} ms${
          stream.blockedMs > 0 ? `, after ${stream.blockedMs} ms blocked` : ''
        }.`,
      });

      const stored = storeResponse(browserCache, {
        request: requestFor(resource, page.host, version),
        response: { ...resource.response, version },
        requestedAt: startedAt,
        receivedAt: completedAt,
      });
      browserCache = stored.cache;

      fetches.push({
        resource,
        source: 'network',
        queuedAt,
        firstByteAt,
        completedAt,
        transferredBytes: resource.bytes + stream.requestHeaderBytesOnWire,
        blockedMs: stream.blockedMs,
        stream,
        renderBlocking: resource.renderBlocking,
      });
    }

    if (plan.applicationHolMs > 0) {
      events.push({
        kind: 'annotate',
        at: parsedAt,
        targetId: BROWSER_NODE,
        text: `${round2(plan.applicationHolMs)} ms of this stage is requests waiting for a free connection. HTTP/1.1 allows six per origin and no more, so the seventh file waits for one of the first six to finish -- which is what HTTP/2's single multiplexed connection removed.`,
        reference: RFC_9110_LINK,
      });
    }
  }

  // --- Paint ------------------------------------------------------------------
  const ordered = [...fetches].sort((a, b) => a.completedAt - b.completedAt);
  const blocking = ordered.filter((entry) => entry.renderBlocking);
  const blockedUntil = blocking.reduce(
    (latest, entry) => Math.max(latest, entry.completedAt),
    parsedAt,
  );
  const firstPaintAt = round2(blockedUntil + PAINT_MS);

  const lcpFetch = ordered.find((entry) => entry.resource.lcpCandidate);
  const largestContentfulPaintAt = lcpFetch
    ? round2(Math.max(lcpFetch.completedAt, firstPaintAt) + PAINT_MS)
    : firstPaintAt;

  const loadAt = ordered.reduce(
    (latest, entry) => Math.max(latest, entry.completedAt),
    parsedAt,
  );

  events.push({
    kind: 'log',
    at: firstPaintAt,
    level: 'info',
    text: `First Paint at ${firstPaintAt} ms.`,
  });
  events.push({
    kind: 'annotate',
    at: firstPaintAt,
    targetId: BROWSER_NODE,
    text:
      blocking.length === 0
        ? 'Nothing blocked the first frame, so it was painted as soon as the document was parsed.'
        : `The first frame waited for ${blocking
            .map((entry) => entry.resource.label)
            .join(
              ' and ',
            )}. A stylesheet in the head blocks rendering on purpose: painting unstyled text and then re-painting it looks worse than painting nothing, so the browser holds the frame.`,
  });

  if (lcpFetch) {
    events.push({
      kind: 'log',
      at: largestContentfulPaintAt,
      level: 'info',
      text: `Largest Contentful Paint at ${largestContentfulPaintAt} ms (${lcpFetch.resource.label}).`,
    });
    events.push({
      kind: 'annotate',
      at: largestContentfulPaintAt,
      targetId: BROWSER_NODE,
      text: `${lcpFetch.resource.label} is the largest thing above the fold, so its arrival is the moment the page looks loaded to a person. Everything the earlier stages spent -- DNS, the handshakes, the round trip to the origin -- is in this number.`,
    });
  }

  const finishedAt = round2(Math.max(loadAt, largestContentfulPaintAt));
  events.push({
    kind: 'node-state',
    at: finishedAt,
    nodeId: BROWSER_NODE,
    state: 'idle',
  });
  events.push({
    kind: 'log',
    at: finishedAt,
    level: 'info',
    text: `Page loaded: ${fetches.length} subresources, ${fetches.filter((entry) => entry.source === 'browser-cache').length} from cache.`,
  });

  const transferredBytes = fetches.reduce(
    (total, entry) => total + entry.transferredBytes,
    0,
  );

  const result: RenderResult = {
    parsedAt,
    fetches,
    ...(plan ? { plan } : {}),
    firstPaintAt,
    largestContentfulPaintAt,
    loadAt,
    blockedFirstPaintBy: blocking.map((entry) => entry.resource.label),
    browserCache,
    transferredBytes,
  };

  return {
    events,
    pdus,
    durationMs: round2(finishedAt + RENDER_TAIL_MS),
    summary: `First Paint ${firstPaintAt} ms, LCP ${largestContentfulPaintAt} ms`,
    state: { render: result, browserCache },
  };
};
