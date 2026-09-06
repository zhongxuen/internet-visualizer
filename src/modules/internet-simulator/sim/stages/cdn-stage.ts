/**
 * Stage 7 -- somebody answers, and the answer comes back.
 *
 * This is where the "waiting (TTFB)" and "content download" segments of a devtools
 * waterfall actually live, and it is deliberately a separate stage from the request,
 * because the two numbers answer different questions. Time-to-first-byte is *whose fault*
 * -- a distant origin, a slow database, a cold edge. Download time is *how big*. A page
 * that is slow because of the first is fixed by moving the bytes closer; a page that is
 * slow because of the second is fixed by having fewer of them. Conflating them is why so
 * much performance work goes into the wrong half.
 *
 * ## The edge is not a special case of the origin
 *
 * A CDN edge is a shared HTTP cache, and it is modelled with the same
 * `@/core/protocols/http/caching` that models the browser's private one -- the same
 * freshness arithmetic, the same storability rules, the same `Age` field. What differs is
 * one boolean: a shared cache obeys `s-maxage`, refuses `private`, and will not store a
 * response to a request carrying `Authorization` unless the response explicitly allows it.
 * That difference is the entire reason a CDN can serve one user's response to the next
 * visitor without serving one user's *account page* to the next visitor.
 *
 * When a scenario declares no CDN, the browser's connection terminates at the origin and
 * this stage is the origin's think time plus the response coming back. The stage does not
 * disappear -- the time still has to be spent somewhere, and putting it here keeps the
 * rail's proportions honest across scenarios that do and do not have an edge.
 *
 * ## What is not modelled, and why it is said out loud
 *
 * The download is `bytes * 8 / bandwidth`, which assumes the connection is already running
 * at the link's capacity. A real TCP connection starts at roughly ten segments and doubles
 * each round trip, so the first ~14 KB of a response arrives at one round trip's cost
 * regardless of bandwidth. Modelling slow start honestly would need a congestion window,
 * which belongs in `@/core/protocols/tcp` and is not there; asserting a number this module
 * cannot derive would be worse than stating the gap.
 */

import {
  applyRevalidation,
  evaluateConditional,
  isShared,
  lookupCache,
  notModifiedResponse,
  serveFromCache,
  storeResponse,
  type CacheLookup,
  type CacheOutcome,
  type HttpCache,
} from '@/core/protocols/http/caching';
import {
  headerValue,
  setHeader,
  statusLine,
  type HttpResponse,
} from '@/core/protocols/http/message';
import { describeStatus } from '@/core/protocols/http/semantics';
import { sendSegment, deliverSegment, peerOf, tcpPdu } from '@/core/protocols/tcp/tcp';
import type { ProtocolLayer, PDU } from '@/core/types/pdu';
import type { RfcRef, SimEvent } from '@/core/types/events';

import { requestFor, resourceFor, warmCache } from '../page';
import {
  BROWSER_NODE,
  EDGE_NODE,
  linkId,
  ORIGIN_NODE,
  requireState,
  round2,
  serializeMs,
  type Stage,
  type StageOutput,
} from '../stage';

/** How long a shared cache takes to decide whether it holds something. */
export const EDGE_LOOKUP_MS = 2;

/**
 * The edge-to-origin link, in kilobits per second.
 *
 * A backbone, not an access link: fast enough that the origin fetch's cost is the round
 * trip and the origin's own think time, which is the point being made.
 */
export const BACKBONE_KBPS = 1_000_000;

/** Response header bytes, roughly, for the bytes-on-the-wire figures. */
export const RESPONSE_HEADER_BYTES = 320;

const RFC_9111_SHARED: RfcRef = { rfc: 9111, section: '3.5', title: 'HTTP Caching' };
const RFC_9111_AGE: RfcRef = { rfc: 9111, section: '5.1', title: 'HTTP Caching' };
const RFC_9110_304: RfcRef = { rfc: 9110, section: '15.4.5', title: 'HTTP Semantics' };

/** Where the bytes the user is shown actually came from. */
export type ResponseSource =
  /** The edge's shared cache, without asking the origin. */
  | 'edge-cache'
  /** The origin, through the edge. */
  | 'origin-via-edge'
  /** The origin, directly. */
  | 'origin'
  /** The browser's own store, confirmed by a 304. */
  | 'browser-cache';

/** What the CDN stage established. */
export interface CdnResult {
  readonly source: ResponseSource;
  /** The response the browser ends up with. */
  readonly response: HttpResponse;
  /** What the panel prints against this exchange. */
  readonly outcome: CacheOutcome;
  /** The edge's verdict, when there is an edge. */
  readonly edgeLookup?: CacheLookup;
  /** The edge's cache afterwards. */
  readonly edgeCache?: HttpCache;
  /** True when the origin was contacted at all. */
  readonly originFetched: boolean;
  /** Local virtual millisecond the first response byte reaches the browser. */
  readonly firstByteAt: number;
  /** Local virtual millisecond the last response byte reaches the browser. */
  readonly completedAt: number;
  /** Body bytes actually transferred over the client's link. Zero on a 304. */
  readonly bodyBytes: number;
  /** Every byte the client's link carried for this exchange, headers included. */
  readonly transferredBytes: number;
  /** The browser's cache afterwards. */
  readonly browserCache: HttpCache;
  /** One sentence for the badge, naming what happened and why. */
  readonly reason: string;
}

/** The application layer of the response, as the inspector shows it. */
function responseLayer(message: HttpResponse, source: ResponseSource): ProtocolLayer {
  return {
    layer: 'application',
    protocol: message.version,
    fields: [
      { name: 'Status', value: `${message.status} ${message.reason}` },
      ...message.headers.map((field) => ({ name: field.name, value: field.value })),
      {
        name: 'Served by',
        value: source,
        note: describeStatus(message.status),
      },
    ],
    payloadPreview: statusLine(message),
  };
}

/** Answer the request, and get the answer back to the browser. */
export const cdnStage: Stage = (context): StageOutput => {
  const url = requireState(context.state, 'url', 'cdn');
  const page = requireState(context.state, 'page', 'cdn');
  const check = requireState(context.state, 'cache', 'cdn');
  const http = requireState(context.state, 'http', 'cdn');
  const tcp = requireState(context.state, 'tcp', 'cdn');

  const cdn = context.scenario.cdn;
  const peerNode = tcp.peerNode;
  const clientLink = linkId(BROWSER_NODE, peerNode);
  const oneWay = round2(context.profile.rttMs / 2);
  const resource = resourceFor(page, url.target) ?? page.document;

  const events: SimEvent[] = [];
  const pdus: Record<string, PDU> = {};
  let clock = 0;

  /** The representation whoever answers is comparing the client's validators against. */
  let current: HttpResponse = { ...resource.response, version: http.version };
  let source: ResponseSource = cdn ? 'origin-via-edge' : 'origin';
  let originFetched = false;
  let edgeLookup: CacheLookup | undefined;
  let edgeCache: HttpCache | undefined;

  events.push({
    kind: 'phase',
    at: 0,
    id: 'cdn',
    title: cdn ? 'The edge decides' : 'The origin answers',
    description: cdn
      ? 'The connection ends at a machine near the user, not at the origin. Whether it can answer by itself is the difference between one round trip and three.'
      : 'The origin has the request. Everything from here until the first byte arrives is the server’s own time.',
  });

  // --- The edge --------------------------------------------------------------
  if (cdn) {
    const lookupMs = cdn.lookupMs ?? EDGE_LOOKUP_MS;
    const warm = warmCache(
      'cdn',
      page,
      cdn.warm
        ? [{ target: resource.target, storedSecondsAgo: cdn.warm.storedSecondsAgo }]
        : [],
      http.version,
      cdn.originRttMs,
    );
    edgeCache = warm;

    clock = round2(clock + lookupMs);
    edgeLookup = lookupCache(
      warm,
      requestFor(resource, page.host, http.version),
      clock,
      context.clock,
    );

    events.push({
      kind: 'log',
      at: clock,
      level: 'info',
      text: `Edge cache: ${edgeLookup.kind.toUpperCase()} -- ${edgeLookup.reason}.`,
    });

    if (edgeLookup.kind === 'hit' && edgeLookup.entry) {
      source = 'edge-cache';
      const fromStore = serveFromCache(edgeLookup.entry, clock, {
        shared: isShared(warm.tier),
        clock: context.clock,
      });
      current = {
        ...fromStore,
        version: http.version,
        headers: setHeader(fromStore.headers, 'X-Cache', 'HIT'),
      };
      events.push({
        kind: 'annotate',
        at: clock,
        targetId: EDGE_NODE,
        text: `Answered without asking the origin. The Age field says ${headerValue(current.headers, 'Age') ?? '0'} seconds -- that is how long this copy has been sitting here, and it is the only visible difference between this and a fresh response.`,
        reference: RFC_9111_AGE,
      });
    } else {
      // --- The origin fetch ---------------------------------------------------
      originFetched = true;
      const originOneWay = round2(cdn.originRttMs / 2);
      const think = resource.serverThinkMs;
      const originLink = linkId(EDGE_NODE, ORIGIN_NODE);

      const upId = 'cdn-origin-request';
      const upPdu: PDU = {
        id: upId,
        layers: [
          {
            layer: 'application',
            protocol: http.version,
            fields: [
              { name: 'Method', value: 'GET' },
              { name: 'Target', value: resource.target },
              { name: 'Host', value: page.host },
              {
                name: 'Via',
                value: 'the edge, on the client’s behalf',
                note: 'The client never sees this exchange. As far as it is concerned it made one request and got one answer.',
              },
            ],
            payloadPreview: `GET ${resource.target} ${http.version}`,
          },
        ],
        sizeBytes: RESPONSE_HEADER_BYTES,
        summary: `GET ${resource.target} (edge -> origin)`,
      };
      pdus[upId] = upPdu;

      events.push({ kind: 'pdu-created', at: clock, pdu: upPdu, atNode: EDGE_NODE });
      events.push({
        kind: 'transmit',
        at: clock,
        pduId: upId,
        from: EDGE_NODE,
        to: ORIGIN_NODE,
        durationMs: originOneWay,
        linkId: originLink,
      });
      events.push({
        kind: 'node-state',
        at: round2(clock + originOneWay),
        nodeId: ORIGIN_NODE,
        state: 'processing',
        note: 'generating the response',
      });

      clock = round2(clock + originOneWay + think);

      const downId = 'cdn-origin-response';
      const downPdu: PDU = {
        id: downId,
        layers: [responseLayer({ ...current, version: http.version }, 'origin')],
        sizeBytes: resource.bytes + RESPONSE_HEADER_BYTES,
        summary: `${current.status} ${current.reason} (origin -> edge, ${resource.bytes} bytes)`,
      };
      pdus[downId] = downPdu;

      const backboneMs = round2(
        ((resource.bytes + RESPONSE_HEADER_BYTES) * 8) / BACKBONE_KBPS,
      );
      events.push({ kind: 'pdu-created', at: clock, pdu: downPdu, atNode: ORIGIN_NODE });
      events.push({
        kind: 'transmit',
        at: clock,
        pduId: downId,
        from: ORIGIN_NODE,
        to: EDGE_NODE,
        durationMs: round2(originOneWay + backboneMs),
        linkId: originLink,
      });

      clock = round2(clock + originOneWay + backboneMs);

      const stored = storeResponse(warm, {
        request: requestFor(resource, page.host, http.version),
        response: current,
        requestedAt: 0,
        receivedAt: clock,
      });
      edgeCache = stored.cache;

      current = {
        ...current,
        version: http.version,
        headers: setHeader(current.headers, 'X-Cache', 'MISS'),
      };

      events.push({
        kind: 'log',
        at: clock,
        level: 'info',
        text: stored.stored.storable
          ? `Origin answered in ${round2(cdn.originRttMs + think)} ms. The edge stored it: ${stored.stored.reason}.`
          : `Origin answered in ${round2(cdn.originRttMs + think)} ms. The edge did not store it: ${stored.stored.reason}.`,
      });
      events.push({
        kind: 'annotate',
        at: clock,
        targetId: EDGE_NODE,
        text: `A miss costs the origin round trip on top of everything else -- ${cdn.originRttMs} ms here -- and the client waits through all of it. The next visitor does not, which is the whole trade a CDN makes.`,
        reference: RFC_9111_SHARED,
      });
      events.push({
        kind: 'node-state',
        at: clock,
        nodeId: ORIGIN_NODE,
        state: 'idle',
      });
    }
  } else {
    // --- No edge: the origin is the far end ---------------------------------
    const think = resource.serverThinkMs;
    clock = round2(clock + think);
    events.push({
      kind: 'log',
      at: clock,
      level: 'info',
      text: `Origin spent ${think} ms producing the response. Nothing was on the wire for that time; it is pure server work, and it is the part a faster network cannot fix.`,
    });
  }

  // --- Conditional requests: the 304 path ------------------------------------
  const verdict = http.conditional
    ? evaluateConditional(check.request, current, context.clock)
    : undefined;

  let onTheWire: HttpResponse = current;
  if (verdict?.status === 304) {
    onTheWire = { ...notModifiedResponse(current), version: http.version };
    events.push({
      kind: 'log',
      at: clock,
      level: 'info',
      text: `Preconditions: 304 -- ${verdict.reason}. No body will be sent.`,
    });
    events.push({
      kind: 'annotate',
      at: clock,
      targetId: peerNode,
      text: `A 304 is a full round trip and almost no bytes. The browser already has the body; all that came back is "your copy is still current", and the stored copy is served instead.`,
      reference: RFC_9110_304,
    });
  }

  // --- The response crosses the client's link --------------------------------
  const bodyBytes = onTheWire.status === 304 ? 0 : resource.bytes;
  const transferredBytes = bodyBytes + RESPONSE_HEADER_BYTES;
  const downloadMs = serializeMs(transferredBytes, context.profile);

  const responseId = 'http-response';
  const sent = sendSegment(tcp.connection, 'server', {
    ack: true,
    psh: true,
    bytes: transferredBytes,
    preview: statusLine(onTheWire),
  });
  const delivered = deliverSegment(sent.connection, peerOf('server'), sent.segment);
  const responsePdu: PDU = {
    ...tcpPdu(responseId, sent.segment, responseLayer(onTheWire, source)),
    summary: `${onTheWire.status} ${onTheWire.reason} (${transferredBytes} bytes)`,
  };
  pdus[responseId] = responsePdu;

  events.push({ kind: 'pdu-created', at: clock, pdu: responsePdu, atNode: peerNode });
  events.push({
    kind: 'transmit',
    at: clock,
    pduId: responseId,
    from: peerNode,
    to: BROWSER_NODE,
    durationMs: round2(oneWay + downloadMs),
    linkId: clientLink,
  });

  const firstByteAt = round2(clock + oneWay);
  const completedAt = round2(firstByteAt + downloadMs);

  events.push({
    kind: 'log',
    at: firstByteAt,
    level: 'info',
    text: `First byte: ${statusLine(onTheWire)}. ${downloadMs === 0 ? 'There is no body to download.' : `${transferredBytes} bytes will take ${downloadMs} ms to arrive.`}`,
  });
  events.push({
    kind: 'node-state',
    at: completedAt,
    nodeId: peerNode,
    state: 'idle',
  });

  // --- What the browser does with it -----------------------------------------
  let browserCache = check.browserCache;
  let outcome: CacheOutcome;
  let reason: string;
  let served: HttpResponse = onTheWire;

  if (verdict?.status === 304 && check.lookup.entry) {
    const revalidated = applyRevalidation(browserCache, {
      entry: check.lookup.entry,
      request: check.request,
      response: onTheWire,
      requestedAt: 0,
      receivedAt: completedAt,
      now: completedAt,
      clock: context.clock,
    });
    browserCache = revalidated.cache;
    outcome = revalidated.outcome;
    reason = revalidated.reason;
    served = revalidated.response;
    source = 'browser-cache';
  } else {
    const stored = storeResponse(browserCache, {
      request: check.request,
      response: onTheWire,
      requestedAt: 0,
      receivedAt: completedAt,
    });
    browserCache = stored.cache;
    outcome = stored.stored.storable ? 'MISS' : 'BYPASS';
    reason = stored.stored.reason;
  }

  events.push({
    kind: 'log',
    at: completedAt,
    level: 'info',
    text: `${outcome}: ${reason}.`,
  });

  const result: CdnResult = {
    source,
    response: served,
    outcome,
    ...(edgeLookup ? { edgeLookup } : {}),
    ...(edgeCache ? { edgeCache } : {}),
    originFetched,
    firstByteAt,
    completedAt,
    bodyBytes,
    transferredBytes,
    browserCache,
    reason,
  };

  const summary =
    source === 'edge-cache'
      ? `Edge HIT, ${completedAt} ms`
      : source === 'browser-cache'
        ? `304, body reused (${transferredBytes} B)`
        : originFetched
          ? `Edge MISS -> origin, ${completedAt} ms`
          : `${onTheWire.status} in ${completedAt} ms`;

  return {
    events,
    pdus,
    durationMs: completedAt,
    summary,
    state: {
      cdn: result,
      browserCache,
      tcp: { ...tcp, connection: delivered.connection },
    },
  };
};
