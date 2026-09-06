/**
 * Stage 6 -- the request finally goes out.
 *
 * Four stages and one or two round trips have been spent getting to the point where the
 * browser is allowed to say what it wants. This stage is where it says it, and it ends the
 * moment the far end has the request in its hands. What the far end *does* with it -- look
 * in a shared cache, go and ask the origin -- is the next stage, because that is where the
 * time goes and separating them is what makes the waterfall's "waiting (TTFB)" segment
 * mean something.
 *
 * The message model, the header handling, and the exact HTTP/1.1 wire bytes are all
 * `@/core/protocols/http/message`. The header compression figures are
 * `@/core/protocols/http/versions`, which knows that HPACK on a first request gets about
 * 55% and on a repeat request about 8% -- the second number being why HTTP/2 made a page
 * of a hundred small requests cheap.
 *
 * Two teaching points are pinned here:
 *
 * - **The request is tiny and it still costs a round trip.** A 500-byte GET takes 0.08 ms
 *   to clock onto a 50 Mbit/s link and 12.5 ms to reach the far end. Size is not the cost;
 *   distance is.
 * - **A conditional request looks the same as any other.** The only difference is two
 *   extra header fields, and the saving is the entire response body.
 */

import { compressedHeaderBytes, versionProfile } from '@/core/protocols/http/versions';
import {
  headerValue,
  requestLine,
  serializeRequest,
  wireSize,
  type HttpRequest,
  type HttpVersion,
} from '@/core/protocols/http/message';
import { sendSegment, deliverSegment, peerOf, tcpPdu } from '@/core/protocols/tcp/tcp';
import type { ProtocolLayer, PDU } from '@/core/types/pdu';
import type { RfcRef, SimEvent } from '@/core/types/events';

import {
  BROWSER_NODE,
  linkId,
  requireState,
  round2,
  serializeMs,
  type Stage,
  type StageOutput,
} from '../stage';

const RFC_9110: RfcRef = { rfc: 9110, section: '9', title: 'HTTP Semantics' };
const RFC_9112: RfcRef = { rfc: 9112, section: '3', title: 'HTTP/1.1' };

/** What the HTTP stage established. */
export interface HttpResult {
  readonly request: HttpRequest;
  readonly version: HttpVersion;
  /** The exact HTTP/1.1 bytes, when the version has a text wire format. */
  readonly wire?: string;
  /** Header bytes as written. */
  readonly headerBytesRaw: number;
  /** Header bytes actually sent, after HPACK or QPACK. The same number for HTTP/1.1. */
  readonly headerBytesOnWire: number;
  /** Local virtual millisecond the first request byte leaves. */
  readonly sentAt: number;
  /** Local virtual millisecond the far end has the whole request. */
  readonly arrivedAt: number;
  /** True when this request carries validators and may come back as a 304. */
  readonly conditional: boolean;
  /** The node the request was sent to. */
  readonly peerNode: string;
}

/** The application layer of the request, as the inspector shows it. */
function requestLayer(
  request: HttpRequest,
  version: HttpVersion,
  headerBytesOnWire: number,
): ProtocolLayer {
  const profile = versionProfile(version);
  return {
    layer: 'application',
    protocol: version,
    fields: [
      { name: 'Method', value: request.method },
      { name: 'Target', value: request.target },
      ...(profile.framing === 'binary'
        ? [
            {
              name: 'Frame',
              value: 'HEADERS (END_STREAM)',
              note: `No blank line and no CRLF: the length is in the frame header, and the fields are ${profile.headerCompression}-compressed against a table both ends keep in step.`,
            },
            { name: 'Stream ID', value: '1', bits: 31 },
          ]
        : []),
      ...request.headers.map((field) => ({ name: field.name, value: field.value })),
      {
        name: 'Header bytes on the wire',
        value: `${headerBytesOnWire}`,
        note:
          profile.headerCompression === 'none'
            ? 'Sent in full, in text, on this request and on every request after it.'
            : `${profile.headerCompression} indexes repeated fields, so the second request on this connection is a fraction of the first.`,
      },
    ],
    payloadPreview: requestLine(request),
  };
}

/** Send the request. */
export const httpStage: Stage = (context): StageOutput => {
  const url = requireState(context.state, 'url', 'http');
  const check = requireState(context.state, 'cache', 'http');
  const tcp = requireState(context.state, 'tcp', 'http');
  const tls = context.state.tls;

  const version: HttpVersion = tls?.httpVersion ?? 'HTTP/1.1';
  const profile = versionProfile(version);
  const request: HttpRequest = { ...check.request, version };

  const headerBytesRaw = wireSize(request);
  const headerBytesOnWire = compressedHeaderBytes(version, 0, headerBytesRaw);
  const uploadMs = serializeMs(headerBytesOnWire, context.profile);
  const oneWay = round2(context.profile.rttMs / 2);

  const peerNode = tcp.peerNode;
  const link = linkId(BROWSER_NODE, peerNode);

  // The request rides in a TCP segment on the connection the TCP stage opened. Using
  // `sendSegment` + `deliverSegment` rather than inventing a segment keeps the sequence
  // numbers continuous with the handshake -- the request's Seq really is the client's ISN
  // plus one, which is what makes the inspector's numbers checkable.
  const sent = sendSegment(tcp.connection, 'client', {
    ack: true,
    psh: true,
    bytes: headerBytesOnWire,
    preview: requestLine(request),
  });
  const delivered = deliverSegment(sent.connection, peerOf('client'), sent.segment);

  const pduId = 'http-request';
  const pdu: PDU = {
    ...tcpPdu(pduId, sent.segment, requestLayer(request, version, headerBytesOnWire)),
    summary: `${request.method} ${request.target} ${version}`,
  };

  const events: SimEvent[] = [
    {
      kind: 'phase',
      at: 0,
      id: 'http',
      title: 'Send the request',
      description: `${headerBytesOnWire} bytes, ${uploadMs} ms to clock onto the wire, and ${oneWay} ms to get there. Everything before this stage was preparation.`,
    },
    { kind: 'node-state', at: 0, nodeId: BROWSER_NODE, state: 'active' },
    { kind: 'pdu-created', at: 0, pdu, atNode: BROWSER_NODE },
    {
      kind: 'transmit',
      at: 0,
      pduId,
      from: BROWSER_NODE,
      to: peerNode,
      durationMs: round2(uploadMs + oneWay),
      linkId: link,
    },
    {
      kind: 'log',
      at: 0,
      level: 'info',
      text: `${requestLine(request)} -- Host: ${headerValue(request.headers, 'Host') ?? url.host}`,
    },
  ];

  if (check.validators.length > 0) {
    events.push({
      kind: 'annotate',
      at: 0,
      targetId: BROWSER_NODE,
      text: `This request carries ${check.validators
        .map((field) => `${field.name}: ${field.value}`)
        .join(
          ' and ',
        )}. It is an ordinary GET with two extra fields, and if nothing has changed the answer is a 304 with no body -- the same saving as a cache hit, one round trip later.`,
      reference: RFC_9110,
    });
  } else if (profile.headerCompression !== 'none') {
    events.push({
      kind: 'annotate',
      at: 0,
      targetId: BROWSER_NODE,
      text: `${headerBytesRaw} bytes of header fields went out as ${headerBytesOnWire}: ${profile.headerCompression} indexes them against a table both ends maintain. The next request on this connection will be a fraction of this one.`,
      reference: RFC_9112,
    });
  }

  const arrivedAt = round2(uploadMs + oneWay);

  events.push({
    kind: 'node-state',
    at: arrivedAt,
    nodeId: peerNode,
    state: 'processing',
    note: 'request received',
  });
  events.push({
    kind: 'log',
    at: arrivedAt,
    level: 'info',
    text: `Request delivered after ${arrivedAt} ms. Time to first byte starts counting here, and the clock now belongs to whoever has to answer.`,
  });

  const result: HttpResult = {
    request,
    version,
    ...(profile.framing === 'text' ? { wire: serializeRequest(request) } : {}),
    headerBytesRaw,
    headerBytesOnWire,
    sentAt: 0,
    arrivedAt,
    conditional: check.validators.length > 0,
    peerNode,
  };

  return {
    events,
    pdus: { [pduId]: pdu },
    durationMs: arrivedAt,
    summary: `${request.method} ${request.target} (${headerBytesOnWire} B, ${version})`,
    state: {
      http: result,
      tcp: { ...tcp, connection: delivered.connection },
    },
  };
};
