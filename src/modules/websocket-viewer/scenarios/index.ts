/**
 * The WebSocket Viewer scenario catalogue.
 *
 * Seven runs, ordered so each is the previous picture with one thing added or one assumption
 * removed:
 *
 * 1. `handshake-and-chat` -- the `101`, and the two-way stream on the far side of it.
 *    Everything else happens after this moment, so this moment has to be understood first.
 * 2. `ping-pong-keepalive` -- add time. Change: an open connection turns out not to be a
 *    working one, and liveness has to be asked for.
 * 3. `binary-frames` -- add size. Change: the header stops being a fixed two bytes, and all
 *    three payload-length encodings appear.
 * 4. `fragmented-message` -- add a message longer than one frame. Change: a message stops
 *    being a frame, and control frames turn out to be interleavable for a reason.
 * 5. `close-handshake` -- add an ending. Change: closing is a handshake, and four of the
 *    close codes turn out never to appear on the wire at all.
 * 6. `reconnect-backoff` -- remove the ending. Change: the connection vanishes with no code,
 *    and everything about recovery becomes the application's problem.
 * 7. `transport-comparison` -- remove the WebSocket. Change: the three older strategies get
 *    to make their case, with the byte bill counted rather than asserted.
 *
 * The scenario picker, the module, and the tests all read this list; nothing else hardcodes a
 * scenario id.
 *
 * Every one of these is a bundled fixture. There is no code path from any file in this folder
 * to a real network -- no `fetch`, no `WebSocket`, no host parameter, and no address outside
 * the ranges RFC 5737 and RFC 2606 reserve so an example can never be mistaken for a real
 * host.
 */

import type { WebSocketScenario } from '../sim/exchange';

import { BINARY_FRAMES } from './binary-frames';
import { CLOSE_HANDSHAKE } from './close-handshake';
import { FRAGMENTED_MESSAGE } from './fragmented-message';
import { HANDSHAKE_AND_CHAT } from './handshake-and-chat';
import { PING_PONG_KEEPALIVE } from './ping-pong-keepalive';
import { RECONNECT_BACKOFF } from './reconnect-backoff';
import { TRANSPORT_COMPARISON } from './transport-comparison';

export {
  BINARY_FRAMES,
  CLOSE_HANDSHAKE,
  FRAGMENTED_MESSAGE,
  HANDSHAKE_AND_CHAT,
  PING_PONG_KEEPALIVE,
  RECONNECT_BACKOFF,
  TRANSPORT_COMPARISON,
};

export {
  base64Overhead,
  CLIENT_SUBPROTOCOLS,
  PAGE_ORIGIN,
  RFC_EXAMPLE_ACCEPT,
  RFC_EXAMPLE_KEY,
  sampleBytes,
  SERVER_SUBPROTOCOLS,
  WS_HOST,
} from './common';

/** The ids this module offers, so a route param can be narrowed to one of them. */
export type WebSocketScenarioId =
  | 'handshake-and-chat'
  | 'ping-pong-keepalive'
  | 'binary-frames'
  | 'fragmented-message'
  | 'close-handshake'
  | 'reconnect-backoff'
  | 'transport-comparison';

/** Every scenario, in teaching order. */
export const WEBSOCKET_SCENARIOS: readonly WebSocketScenario[] = [
  HANDSHAKE_AND_CHAT,
  PING_PONG_KEEPALIVE,
  BINARY_FRAMES,
  FRAGMENTED_MESSAGE,
  CLOSE_HANDSHAKE,
  RECONNECT_BACKOFF,
  TRANSPORT_COMPARISON,
];

/** The scenario the module opens on. */
export const DEFAULT_WEBSOCKET_SCENARIO_ID: WebSocketScenarioId = 'handshake-and-chat';

/** Look a scenario up by id; `undefined` for anything this module does not offer. */
export function getWebSocketScenario(id: string): WebSocketScenario | undefined {
  return WEBSOCKET_SCENARIOS.find((scenario) => scenario.id === id);
}
