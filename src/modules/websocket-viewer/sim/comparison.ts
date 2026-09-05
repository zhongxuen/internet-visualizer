/**
 * Four ways to find out that something changed, raced on one timeline.
 *
 * Polling, long polling, Server-Sent Events, and WebSockets all answer the same question --
 * *how does the browser learn about a thing that happened on the server?* -- and the honest
 * comparison is not "which is best" but "what does each one cost, and what does each one
 * buy". This file computes both, over the same schedule of updates, so the four can be shown
 * side by side with real numbers rather than adjectives.
 *
 * ## The numbers are derived, not asserted
 *
 * Every byte count here comes from a message this file actually builds and renders. The
 * polling overhead is `wireBytes()` of a realistic browser `GET` with the cookies and
 * `User-Agent` a real one carries; the WebSocket handshake cost is the real handshake from
 * `upgrade.ts`; the per-frame cost is `frameBytes()` from `frames.ts`, including the four
 * bytes of masking key on the client's side. That matters, because the interesting result --
 * that polling spends hundreds of bytes to say "nothing happened" -- is only convincing if
 * the hundreds of bytes were counted rather than claimed.
 *
 * ## Being fair to the other three
 *
 * A comparison that exists to make WebSockets win is not worth building, and the real
 * trade-offs are more interesting than the byte counts:
 *
 * - **Polling** is stateless, cacheable, survives any proxy, and needs no connection
 *   affinity -- so it scales horizontally with no coordination at all. Every request can
 *   land on a different server. Nothing else here can say that.
 * - **Long polling** works everywhere polling works, delivers in nearly real time, and needs
 *   no new protocol. Its cost is a held connection per client and a blind spot between the
 *   response and the next request.
 * - **SSE** is one-directional and that is frequently the *right* shape: most "live"
 *   features are a server telling clients things. It reconnects automatically, resumes with
 *   `Last-Event-ID`, is plain HTTP the whole way, and needs no framing library. Over HTTP/2
 *   it also stops being subject to the six-connections-per-origin limit that was its worst
 *   practical flaw.
 * - **WebSockets** are bidirectional and cheap per message, and pay for it with a stateful
 *   connection: sticky routing, a keepalive to maintain, reconnection logic to write, and no
 *   HTTP caching anywhere.
 *
 * ## The HTTP/2 caveat, stated once
 *
 * These figures are HTTP/1.1, where a header is bytes on the wire. Under HTTP/2, HPACK
 * compresses a repeated header set to a handful of bytes, so the polling overhead below is
 * an upper bound rather than a universal truth. It is still the right number for the
 * *first* request, and the round-trip and request-count columns do not change at all.
 */

import type { RfcRef } from '@/core/types/events';

import { frameBytes, textFrame, type MaskingKey } from './frames';
import {
  buildClientHandshake,
  handleUpgrade,
  handshakeCost,
  type HandshakeCost,
} from './upgrade';
import {
  header,
  response as makeResponse,
  request as makeRequest,
  wireBytes,
  type HttpRequest,
  type HttpResponse,
} from './message';

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

/**
 * Where Server-Sent Events is actually specified.
 *
 * Not in an RFC, which is why it gets a string rather than an {@link RfcRef}: `EventSource`
 * and the `text/event-stream` format are part of the HTML Living Standard, maintained by
 * WHATWG. That is worth saying out loud, because "there is no RFC for it" is occasionally
 * mistaken for "it is not a standard".
 */
export const SSE_SPECIFICATION =
  'HTML Living Standard, section 9.2 (Server-sent events) -- WHATWG, not an IETF RFC.';

/** The WebSocket protocol's own statement of the problem it set out to solve. */
export const RFC_6455_INTRO: RfcRef = {
  rfc: 6455,
  section: '1.1',
  title: 'The WebSocket Protocol',
};

// ---------------------------------------------------------------------------
// The four transports
// ---------------------------------------------------------------------------

/** The four strategies. */
export type Transport = 'polling' | 'long-polling' | 'sse' | 'websocket';

/** Every transport, in the order the comparison lists them: oldest idea first. */
export const TRANSPORTS: readonly Transport[] = [
  'polling',
  'long-polling',
  'sse',
  'websocket',
];

/** A human name for each. */
export const TRANSPORT_LABELS: Readonly<Record<Transport, string>> = {
  polling: 'Polling',
  'long-polling': 'Long polling',
  sse: 'Server-Sent Events',
  websocket: 'WebSocket',
};

/** What each strategy is, in one sentence. */
export const TRANSPORT_SUMMARIES: Readonly<Record<Transport, string>> = {
  polling: 'Ask again every few seconds, and usually be told nothing has changed.',
  'long-polling':
    'Ask, and let the server hold the request open until it has something to say.',
  sse: 'One request, then the server writes events down the response body for as long as it likes.',
  websocket: 'One handshake, then a two-way frame stream with no requests at all.',
};

// ---------------------------------------------------------------------------
// The scenario being raced
// ---------------------------------------------------------------------------

/** One thing that happens on the server and has to reach the client. */
export interface Update {
  /** Virtual milliseconds from the start of the run. */
  readonly at: number;
  /** The payload, as the text that would be delivered. */
  readonly text: string;
  readonly label?: string;
}

/** Everything the race needs to know. */
export interface ComparisonOptions {
  readonly updates: readonly Update[];
  /** How long the run lasts, in virtual milliseconds. */
  readonly durationMs: number;
  /** How often the polling client asks. Default 5 s. */
  readonly pollIntervalMs?: number;
  /** How long a long-poll request is held before returning empty. Default 30 s. */
  readonly longPollTimeoutMs?: number;
  /** Round trip time on the link. Default 80 ms. */
  readonly rttMs?: number;
  /** The gap between a response arriving and the client issuing the next request. */
  readonly turnaroundMs?: number;
  /** The host and path everything is aimed at, for the header sizes. */
  readonly host?: string;
  readonly path?: string;
}

interface ResolvedOptions {
  readonly updates: readonly Update[];
  readonly durationMs: number;
  readonly pollIntervalMs: number;
  readonly longPollTimeoutMs: number;
  readonly rttMs: number;
  readonly turnaroundMs: number;
  readonly host: string;
  readonly path: string;
}

function resolve(options: ComparisonOptions): ResolvedOptions {
  return {
    updates: [...options.updates].sort((a, b) => a.at - b.at),
    durationMs: options.durationMs,
    pollIntervalMs: options.pollIntervalMs ?? 5_000,
    longPollTimeoutMs: options.longPollTimeoutMs ?? 30_000,
    rttMs: options.rttMs ?? 80,
    turnaroundMs: options.turnaroundMs ?? 20,
    host: options.host ?? 'live.example.com',
    path: options.path ?? '/updates',
  };
}

// ---------------------------------------------------------------------------
// The HTTP messages the byte counts come from
// ---------------------------------------------------------------------------

/**
 * A representative browser `GET`.
 *
 * Not a minimal one. A minimal `GET` is about eighty bytes and no browser has ever sent one:
 * a real request carries a `User-Agent` of a hundred-odd characters, four `Accept*` fields,
 * a `Referer`, and whatever cookies the origin has set -- and the cookies are the part that
 * hurts, because they are re-sent in full on every single poll whether or not the server
 * needs them. This is the honest baseline, and it is why the polling column looks the way it
 * does.
 */
export function pollingRequest(options: {
  host: string;
  path: string;
  query?: string;
}): HttpRequest {
  return makeRequest({
    method: 'GET',
    target:
      options.query === undefined ? options.path : `${options.path}?${options.query}`,
    headers: [
      header('Host', options.host),
      header('Connection', 'keep-alive'),
      header(
        'User-Agent',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      ),
      header('Accept', 'application/json, text/plain, */*'),
      header('Accept-Encoding', 'gzip, deflate, br, zstd'),
      header('Accept-Language', 'en-GB,en;q=0.9'),
      header('Referer', `https://${options.host}/app`),
      header(
        'Cookie',
        'session=8f14e45fceea167a5a36dedd4bea2543; theme=dark; tz=Etc-UTC',
      ),
    ],
  });
}

/** A response carrying `body`, with the fields a real server attaches. */
export function pollingResponse(body: string): HttpResponse {
  return makeResponse({
    status: body === '' ? 204 : 200,
    reason: body === '' ? 'No Content' : 'OK',
    headers: [
      header('Date', 'Thu, 04 Sep 2026 12:00:00 GMT'),
      header('Server', 'nginx'),
      header('Content-Type', 'application/json; charset=utf-8'),
      header('Content-Length', `${body.length}`),
      header('Cache-Control', 'no-store'),
      ...(body === '' ? [] : [header('ETag', 'W/"1a2b3c4d"')]),
    ],
    ...(body === '' ? {} : { body }),
  });
}

/** The `text/event-stream` response an SSE endpoint opens with. */
export function sseResponse(): HttpResponse {
  return makeResponse({
    status: 200,
    reason: 'OK',
    headers: [
      header('Date', 'Thu, 04 Sep 2026 12:00:00 GMT'),
      header('Server', 'nginx'),
      header('Content-Type', 'text/event-stream'),
      header('Cache-Control', 'no-cache'),
      header('Connection', 'keep-alive'),
      // Without this, an intervening nginx buffers the stream and the "live" feed arrives in
      // batches minutes late. It is the single most common way an SSE deployment fails.
      header('X-Accel-Buffering', 'no'),
    ],
  });
}

/**
 * The bytes one SSE event costs on the stream.
 *
 * The framing is `data: `, the payload, and a blank line -- eight bytes of overhead, plus
 * whatever an `id:` line costs when the endpoint supports resumption. That is remarkably
 * close to a WebSocket frame header, which is the fact that makes the SSE column respectable
 * rather than an also-ran.
 */
export function sseEventBytes(text: string, options: { withId?: boolean } = {}): number {
  const data = `data: ${text}\n\n`;
  const id = options.withId === true ? `id: 000\n`.length : 0;
  return data.length + id;
}

/** The handshake this comparison charges the WebSocket column for. */
export function websocketHandshakeCost(host: string, path: string): HandshakeCost {
  const request = buildClientHandshake({
    resource: path,
    host,
    key: 'dGhlIHNhbXBsZSBub25jZQ==',
    origin: `https://${host}`,
  });
  const outcome = handleUpgrade(request);
  return handshakeCost(request, outcome.response);
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** One thing that appeared on the wire, for the timeline. */
export interface WireEvent {
  readonly at: number;
  readonly kind: 'handshake' | 'request' | 'response' | 'empty' | 'event' | 'frame';
  readonly bytes: number;
  readonly direction: 'up' | 'down';
  readonly note: string;
}

/** An update reaching the client. */
export interface Delivery {
  readonly updateIndex: number;
  readonly happenedAt: number;
  readonly deliveredAt: number;
  readonly latencyMs: number;
}

/** How one transport did. */
export interface TransportRun {
  readonly transport: Transport;
  readonly label: string;
  /** HTTP requests issued, handshake included. The headline counter. */
  readonly requests: number;
  /** Requests that returned nothing at all -- the pure waste in the polling column. */
  readonly emptyResponses: number;
  readonly bytesUp: number;
  readonly bytesDown: number;
  readonly totalBytes: number;
  /** Bytes of actual update content delivered. */
  readonly payloadBytes: number;
  /** Everything that was not payload: headers, framing, handshakes, empty replies. */
  readonly overheadBytes: number;
  /** `overheadBytes / totalBytes`. The number that makes the comparison land. */
  readonly overheadRatio: number;
  readonly deliveries: readonly Delivery[];
  readonly averageLatencyMs: number;
  readonly worstLatencyMs: number;
  /** Updates that never reached the client inside the run. */
  readonly undelivered: number;
  readonly bidirectional: boolean;
  readonly wire: readonly WireEvent[];
  /** The fair-minded paragraph: what this transport is good at, and what it costs. */
  readonly verdict: string;
}

/** All four, plus what they were racing over. */
export interface TransportComparison {
  readonly options: ResolvedOptions;
  readonly runs: readonly TransportRun[];
  /** The run with the fewest total bytes, for the panel to mark. */
  readonly leanest: Transport;
  /** The run with the lowest average delivery latency. */
  readonly fastest: Transport;
}

// ---------------------------------------------------------------------------
// The runs
// ---------------------------------------------------------------------------

function summarise(
  transport: Transport,
  wire: readonly WireEvent[],
  deliveries: readonly Delivery[],
  options: ResolvedOptions,
  extra: {
    payloadBytes: number;
    emptyResponses: number;
    requests: number;
    bidirectional: boolean;
    verdict: string;
  },
): TransportRun {
  const bytesUp = wire
    .filter((event) => event.direction === 'up')
    .reduce((sum, event) => sum + event.bytes, 0);
  const bytesDown = wire
    .filter((event) => event.direction === 'down')
    .reduce((sum, event) => sum + event.bytes, 0);
  const totalBytes = bytesUp + bytesDown;
  const latencies = deliveries.map((delivery) => delivery.latencyMs);

  return {
    transport,
    label: TRANSPORT_LABELS[transport],
    requests: extra.requests,
    emptyResponses: extra.emptyResponses,
    bytesUp,
    bytesDown,
    totalBytes,
    payloadBytes: extra.payloadBytes,
    overheadBytes: totalBytes - extra.payloadBytes,
    overheadRatio: totalBytes === 0 ? 0 : (totalBytes - extra.payloadBytes) / totalBytes,
    deliveries,
    averageLatencyMs:
      latencies.length === 0
        ? 0
        : Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length),
    worstLatencyMs: latencies.length === 0 ? 0 : Math.max(...latencies),
    undelivered: options.updates.length - deliveries.length,
    bidirectional: extra.bidirectional,
    wire,
    verdict: extra.verdict,
  };
}

/**
 * Polling: ask on a fixed timer, whatever the answer was last time.
 *
 * Two costs, and the second is the one people forget. The obvious one is that most requests
 * return nothing -- with updates arriving every twelve seconds and a five-second timer, two
 * polls in three are wasted, and each wasted poll still carries the full cookie jar and
 * `User-Agent` up and a full response header set back.
 *
 * The second cost is **latency you cannot fix by tuning**. An update that lands just after a
 * poll waits nearly the whole interval, so the average delay is half the interval no matter
 * how fast the network is. Halving the interval halves the delay and doubles the requests;
 * there is no setting that gives both. That trade is the entire reason the other three
 * strategies exist.
 */
export function runPolling(options: ComparisonOptions): TransportRun {
  const resolved = resolve(options);
  const wire: WireEvent[] = [];
  const deliveries: Delivery[] = [];
  const delivered = new Set<number>();
  let payloadBytes = 0;
  let emptyResponses = 0;
  let requests = 0;

  const half = resolved.rttMs / 2;
  for (
    let pollAt = resolved.pollIntervalMs;
    pollAt <= resolved.durationMs;
    pollAt += resolved.pollIntervalMs
  ) {
    const request = pollingRequest({ host: resolved.host, path: resolved.path });
    requests += 1;
    wire.push({
      at: pollAt,
      kind: 'request',
      bytes: wireBytes(request),
      direction: 'up',
      note: 'GET with the full cookie jar and User-Agent, whether or not anything changed.',
    });

    const servedAt = pollAt + half;
    const ready = resolved.updates
      .map((update, index) => ({ update, index }))
      .filter(({ update, index }) => update.at <= servedAt && !delivered.has(index));

    const body = ready.map(({ update }) => update.text).join('');
    const response = pollingResponse(body);
    const arrivesAt = pollAt + resolved.rttMs;
    wire.push({
      at: arrivesAt,
      kind: ready.length === 0 ? 'empty' : 'response',
      bytes: wireBytes(response),
      direction: 'down',
      note:
        ready.length === 0
          ? '204 No Content: several hundred bytes spent to say "nothing happened".'
          : `200 with ${ready.length} update(s).`,
    });

    if (ready.length === 0) {
      emptyResponses += 1;
    } else {
      payloadBytes += body.length;
      for (const { update, index } of ready) {
        delivered.add(index);
        deliveries.push({
          updateIndex: index,
          happenedAt: update.at,
          deliveredAt: arrivesAt,
          latencyMs: arrivesAt - update.at,
        });
      }
    }
  }

  return summarise('polling', wire, deliveries, resolved, {
    payloadBytes,
    emptyResponses,
    requests,
    bidirectional: true,
    verdict:
      'Stateless, cacheable, and it works through anything -- every request can land on a ' +
      'different server with no coordination at all, which nothing else here can claim. ' +
      'What it cannot do is be both cheap and prompt: the average delay is half the poll ' +
      'interval, and halving the interval doubles the requests.',
  });
}

/**
 * Long polling: ask once, and let the server sit on the request until it has news.
 *
 * The clever, awkward middle. It delivers in almost exactly the same time as a WebSocket --
 * one half round trip -- while remaining ordinary HTTP that any proxy will pass. It costs
 * roughly one full request/response cycle per update instead of one per interval, which is a
 * large saving when updates are rare and no saving at all when they are frequent.
 *
 * Two costs are structural rather than incidental:
 *
 * - **the blind spot.** Between the response arriving and the next request going out, the
 *   client is not listening. A server that does not queue what happens in that window simply
 *   loses it. This model queues, which is what a correct implementation does, and the queued
 *   update then waits for the next request -- visible in the latency column.
 * - **a held connection per client**, which is the same cost a WebSocket has, except that it
 *   is paid again from scratch after every single update.
 */
export function runLongPolling(options: ComparisonOptions): TransportRun {
  const resolved = resolve(options);
  const wire: WireEvent[] = [];
  const deliveries: Delivery[] = [];
  let payloadBytes = 0;
  let emptyResponses = 0;
  let requests = 0;

  const half = resolved.rttMs / 2;
  let nextIndex = 0;
  let clock = 0;

  while (clock < resolved.durationMs) {
    const request = pollingRequest({ host: resolved.host, path: resolved.path });
    requests += 1;
    wire.push({
      at: clock,
      kind: 'request',
      bytes: wireBytes(request),
      direction: 'up',
      note: 'The server will hold this open rather than answer it.',
    });

    const arrivesAtServer = clock + half;
    const deadline = arrivesAtServer + resolved.longPollTimeoutMs;
    const pending = resolved.updates[nextIndex];

    // An update that already happened during the turnaround gap is answered immediately --
    // the server queued it. One that has not happened yet is waited for.
    const firesAt =
      pending === undefined ? deadline : Math.max(arrivesAtServer, pending.at);

    if (pending === undefined || firesAt > deadline) {
      const timedOutAt = deadline + half;
      if (timedOutAt > resolved.durationMs) break;
      emptyResponses += 1;
      wire.push({
        at: timedOutAt,
        kind: 'empty',
        bytes: wireBytes(pollingResponse('')),
        direction: 'down',
        note: 'Timeout: the server let go before it had anything, so the client can re-ask before an intermediary kills the idle connection.',
      });
      clock = timedOutAt + resolved.turnaroundMs;
      continue;
    }

    const deliveredAt = firesAt + half;
    if (deliveredAt > resolved.durationMs) break;

    const response = pollingResponse(pending.text);
    payloadBytes += pending.text.length;
    wire.push({
      at: deliveredAt,
      kind: 'response',
      bytes: wireBytes(response),
      direction: 'down',
      note: 'The held request is answered the moment there is something to say.',
    });
    deliveries.push({
      updateIndex: nextIndex,
      happenedAt: pending.at,
      deliveredAt,
      latencyMs: deliveredAt - pending.at,
    });
    nextIndex += 1;
    // The blind spot: nothing is listening between here and the next request.
    clock = deliveredAt + resolved.turnaroundMs;
  }

  return summarise('long-polling', wire, deliveries, resolved, {
    payloadBytes,
    emptyResponses,
    requests,
    bidirectional: true,
    verdict:
      'Near-real-time delivery over plain HTTP, with no new protocol and nothing for a ' +
      'proxy to misunderstand. It costs a full request and response per update, a held ' +
      'connection per client, and a blind spot between the response and the next request ' +
      'that the server has to queue across.',
  });
}

/**
 * Server-Sent Events: one request, and the response never ends.
 *
 * The one that deserves more use than it gets. It is *just HTTP*: a `GET` whose response has
 * `Content-Type: text/event-stream` and simply keeps being written to. The browser's
 * `EventSource` reconnects on its own, resumes from `Last-Event-ID`, and needs no library at
 * all. Per event it costs about eight bytes of framing, which is within a byte or two of a
 * WebSocket frame header.
 *
 * What it cannot do is carry anything upstream. A client that needs to send as well as
 * receive makes an ordinary HTTP request for that half -- which is often completely fine,
 * because most live features are the server telling clients things, and because those
 * upstream requests are then cacheable, retryable, and routable like any other request.
 *
 * Its historical flaw was the six-connections-per-origin limit in HTTP/1.1: a held
 * `EventSource` occupied one of the six, and six tabs deadlocked the origin. HTTP/2
 * multiplexes and that problem is gone.
 */
export function runSse(options: ComparisonOptions): TransportRun {
  const resolved = resolve(options);
  const wire: WireEvent[] = [];
  const deliveries: Delivery[] = [];
  let payloadBytes = 0;

  const request = pollingRequest({
    host: resolved.host,
    path: `${resolved.path}/stream`,
  });
  wire.push({
    at: 0,
    kind: 'request',
    bytes: wireBytes(request),
    direction: 'up',
    note: 'One GET, once. Everything after this is response body.',
  });
  wire.push({
    at: resolved.rttMs,
    kind: 'response',
    bytes: wireBytes(sseResponse()),
    direction: 'down',
    note: 'text/event-stream, and the response is never finished.',
  });

  const half = resolved.rttMs / 2;
  resolved.updates.forEach((update, index) => {
    const deliveredAt = update.at + half;
    if (deliveredAt > resolved.durationMs) return;
    payloadBytes += update.text.length;
    wire.push({
      at: deliveredAt,
      kind: 'event',
      bytes: sseEventBytes(update.text, { withId: true }),
      direction: 'down',
      note: '"data: ", the payload, a blank line -- and an id: line so a reconnect can resume.',
    });
    deliveries.push({
      updateIndex: index,
      happenedAt: update.at,
      deliveredAt,
      latencyMs: deliveredAt - update.at,
    });
  });

  return summarise('sse', wire, deliveries, resolved, {
    payloadBytes,
    emptyResponses: 0,
    requests: 1,
    bidirectional: false,
    verdict:
      'Plain HTTP, one connection, about eight bytes of framing per event, automatic ' +
      'reconnection and resumption from Last-Event-ID with no library at all. It is ' +
      'one-directional, which is the right shape for most live features and the wrong shape ' +
      'for the rest. Its old six-connections-per-origin problem disappears under HTTP/2.',
  });
}

/**
 * WebSocket: one handshake, then frames in both directions.
 *
 * The handshake is genuinely expensive -- larger than an ordinary `GET`, because of the four
 * `Sec-WebSocket-*` fields -- and it is paid exactly once. After it, a server-to-client
 * update carrying twenty characters costs twenty-two bytes, because the header is two.
 *
 * The bill arrives elsewhere. The connection is stateful, so the load balancer needs sticky
 * routing and a deploy has to drain connections rather than just stop accepting requests.
 * Nothing is cacheable. A keepalive has to be maintained and reconnection with backoff has
 * to be written, because a connection that lives for hours will be interrupted. None of that
 * shows up in a byte count, which is why the byte count is not the whole comparison.
 */
export function runWebSocket(options: ComparisonOptions): TransportRun {
  const resolved = resolve(options);
  const wire: WireEvent[] = [];
  const deliveries: Delivery[] = [];
  let payloadBytes = 0;

  const cost = websocketHandshakeCost(resolved.host, resolved.path);
  wire.push({
    at: 0,
    kind: 'handshake',
    bytes: cost.requestBytes,
    direction: 'up',
    note: 'The upgrade request: an ordinary GET, plus four Sec-WebSocket-* fields.',
  });
  wire.push({
    at: resolved.rttMs,
    kind: 'handshake',
    bytes: cost.responseBytes,
    direction: 'down',
    note: '101 Switching Protocols. After the blank line, this connection is no longer HTTP.',
  });

  const half = resolved.rttMs / 2;
  resolved.updates.forEach((update, index) => {
    const deliveredAt = Math.max(update.at, resolved.rttMs) + half;
    if (deliveredAt > resolved.durationMs) return;
    // Server to client, so unmasked: a two-byte header for anything under 126 bytes.
    const value = textFrame(update.text);
    payloadBytes += update.text.length;
    wire.push({
      at: deliveredAt,
      kind: 'frame',
      bytes: frameBytes(value),
      direction: 'down',
      note: `${frameBytes(value) - update.text.length} bytes of header, ${update.text.length} of payload. Unmasked, because it is going server to client.`,
    });
    deliveries.push({
      updateIndex: index,
      happenedAt: update.at,
      deliveredAt,
      latencyMs: deliveredAt - update.at,
    });
  });

  return summarise('websocket', wire, deliveries, resolved, {
    payloadBytes,
    emptyResponses: 0,
    requests: 1,
    bidirectional: true,
    verdict:
      'One handshake, then two to fourteen bytes of header per message, in both directions, ' +
      'with no request/response pairing. The cost is state: sticky routing, connection ' +
      'draining on deploy, a keepalive to run, reconnection with backoff to write, and no ' +
      'HTTP caching anywhere. Worth it when the traffic is chatty or genuinely two-way, and ' +
      'not worth it for a notification every few minutes.',
  });
}

/** What a client-to-server message of this size costs, mask included. */
export function clientMessageBytes(text: string, maskingKey: MaskingKey): number {
  return frameBytes(textFrame(text, { maskingKey }));
}

// ---------------------------------------------------------------------------
// The race
// ---------------------------------------------------------------------------

/**
 * Run all four over the same updates.
 *
 * The runs are independent -- each is a pure function of the options -- so they can be drawn
 * on one timeline without any of them knowing the others exist.
 */
export function compareTransports(options: ComparisonOptions): TransportComparison {
  const resolved = resolve(options);
  const runs = [
    runPolling(options),
    runLongPolling(options),
    runSse(options),
    runWebSocket(options),
  ];

  const leanest = runs.reduce((best, run) =>
    run.totalBytes < best.totalBytes ? run : best,
  );
  const delivering = runs.filter((run) => run.deliveries.length > 0);
  const fastest = (delivering.length === 0 ? runs : delivering).reduce((best, run) =>
    run.averageLatencyMs < best.averageLatencyMs ? run : best,
  );

  return {
    options: resolved,
    runs,
    leanest: leanest.transport,
    fastest: fastest.transport,
  };
}

/** The counter row the comparison panel shows above each column. */
export interface TransportCounters {
  readonly transport: Transport;
  readonly label: string;
  readonly requests: number;
  readonly totalBytes: number;
  readonly overheadBytes: number;
  readonly overheadPercent: number;
  readonly averageLatencyMs: number;
  readonly bidirectional: boolean;
}

/** Reduce a run to the four numbers worth putting on screen. */
export function counters(run: TransportRun): TransportCounters {
  return {
    transport: run.transport,
    label: run.label,
    requests: run.requests,
    totalBytes: run.totalBytes,
    overheadBytes: run.overheadBytes,
    overheadPercent: Math.round(run.overheadRatio * 100),
    averageLatencyMs: run.averageLatencyMs,
    bidirectional: run.bidirectional,
  };
}
