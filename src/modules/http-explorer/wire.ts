/**
 * What actually crossed the wire, which is not always what the client ended up with.
 *
 * `HttpExchange.response` is documented as the response *as the client finally saw it*,
 * and for a revalidation those are two different messages. The origin sent a 304 with no
 * body; the cache then merged its fields into the stored copy and handed the client a
 * complete 200. Both are true, and a view that only had the second one could never show
 * the first -- which would lose the single most useful thing about conditional requests,
 * that the interesting answer is the one with nothing in it.
 *
 * So `WireView` renders {@link wireMessages} rather than the exchange's own fields, and
 * this file is the one place the distinction is drawn. It is pure and has its own tests,
 * because "these are the literal bytes" is a claim worth being able to check.
 */

import {
  serializeRequest,
  serializeResponse,
  requestWireSegments,
  responseWireSegments,
  wireSize,
  type HttpRequest,
  type HttpResponse,
  type WireSegment,
} from './sim/message';
import { notModifiedResponse } from './sim/caching';
import type { HttpExchange } from './sim/exchange';

/**
 * The response the origin or the cache put on the wire.
 *
 * Reconstructed rather than recorded, and exactly reconstructible: a revalidated entry
 * holds the stored body under the 304's own fields (RFC 9111 §4.3.4 updates the stored
 * headers from the 304), so narrowing that merged message back down with the same
 * function the simulation used -- {@link notModifiedResponse}, which keeps only the six
 * fields RFC 9110 §15.4.5 permits -- returns the 304 itself.
 *
 * Every other outcome sends what the client got, so it is returned unchanged.
 */
export function wireResponse(exchange: HttpExchange): HttpResponse {
  const revalidated =
    exchange.browserCache === 'REVALIDATED' || exchange.cdnCache === 'REVALIDATED';
  return revalidated ? notModifiedResponse(exchange.response) : exchange.response;
}

/** One direction of an exchange, as bytes and as addressable lines. */
export interface WireMessage {
  readonly direction: 'request' | 'response';
  /** What the header bar calls it, e.g. `GET /index.html` or `304 Not Modified`. */
  readonly label: string;
  /** The literal serialisation, CRLF terminators and all. */
  readonly wire: string;
  /** The same message split so one field line can be focused without re-parsing. */
  readonly segments: readonly WireSegment[];
  readonly bytes: number;
  /** True when the message structurally has no body, which is the 304's whole point. */
  readonly bodyless: boolean;
}

/** The request as it went out. */
export function requestWire(request: HttpRequest): WireMessage {
  return {
    direction: 'request',
    label: `${request.method} ${request.target}`,
    wire: serializeRequest(request),
    segments: requestWireSegments(request),
    bytes: wireSize(request),
    bodyless: request.body === undefined || request.body === '',
  };
}

/** The response as it came back. */
export function responseWire(response: HttpResponse): WireMessage {
  return {
    direction: 'response',
    label: `${response.status} ${response.reason}`,
    wire: serializeResponse(response),
    segments: responseWireSegments(response),
    bytes: wireSize(response),
    bodyless: response.body === undefined || response.body === '',
  };
}

/** Both halves of one exchange, as they were on the wire. */
export function wireMessages(exchange: HttpExchange): {
  readonly request: WireMessage;
  readonly response: WireMessage;
  /** Set when the client was handed something other than what arrived. */
  readonly reconstructedNote?: string;
} {
  const onWire = wireResponse(exchange);
  const differs = onWire !== exchange.response;

  return {
    request: requestWire(exchange.request),
    response: responseWire(onWire),
    ...(differs
      ? {
          reconstructedNote:
            `The origin sent ${onWire.status} ${onWire.reason} with no body. The cache ` +
            `merged those fields into the copy it already held and handed the client a ` +
            `complete ${exchange.response.status} -- so the bytes below are what crossed ` +
            `the network, and the bytes the page rendered never crossed it at all.`,
        }
      : {}),
  };
}
