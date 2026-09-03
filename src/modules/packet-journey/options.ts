/**
 * The four knobs, and what they mean to the engine.
 *
 * `JourneyControls` turns transport, payload size, MTU, and loss; `runJourney` takes a
 * `JourneyOverrides`. This file is the translation between them, kept out of the
 * component because two of the four are not the one-line assignments they look like and
 * both deserve a test rather than a comment.
 *
 * ## "As authored" is a value, not an absence
 *
 * Every knob starts at `null`, meaning *leave the scenario alone*. That is not the same
 * as setting it to whatever the scenario happens to say: a scenario is a designed lesson,
 * and a UI that silently re-stated its defaults as user choices would make "reset" a
 * guess. `null` is passed through as no override at all, so the run is byte-for-byte the
 * authored one -- which is what `scenarios.test.ts` pins.
 */

import {
  resolveJourneyPath,
  type JourneyOverrides,
  type JourneyScenario,
  type JourneyTransport,
} from './sim/journey';

/** The state of the control panel. `null` on a knob means "as the scenario authored it". */
export interface JourneyOptions {
  readonly transport: JourneyTransport | null;
  /** Bytes each application write sends. Applies to every write in the run. */
  readonly payloadBytes: number | null;
  /** The largest frame any link on the path will carry. */
  readonly mtu: number | null;
  readonly lossy: boolean | null;
}

/** Nothing overridden: the scenario exactly as written. */
export const AUTHORED_OPTIONS: JourneyOptions = {
  transport: null,
  payloadBytes: null,
  mtu: null,
  lossy: null,
};

/** True when no knob has been turned, so "reset" has nothing to do. */
export function isAuthored(options: JourneyOptions): boolean {
  return (
    options.transport === null &&
    options.payloadBytes === null &&
    options.mtu === null &&
    options.lossy === null
  );
}

/** The payload slider's range. The top end is comfortably past any MTU on offer. */
export const MIN_PAYLOAD_BYTES = 32;
export const MAX_PAYLOAD_BYTES = 4096;
export const PAYLOAD_STEP_BYTES = 32;

/**
 * The MTUs on offer, and why each one exists in the world.
 *
 * Real numbers rather than a slider: an MTU is not a continuum a network engineer picks
 * from, it is a handful of values that each come from a specific piece of history, and
 * the reason 1492 exists is more useful than the ability to choose 1493.
 */
export const MTU_CHOICES: readonly { bytes: number; label: string }[] = [
  { bytes: 1500, label: '1500 — Ethernet' },
  { bytes: 1492, label: '1492 — PPPoE over fibre' },
  { bytes: 1400, label: '1400 — typical VPN tunnel' },
  { bytes: 1280, label: '1280 — IPv6 minimum' },
  { bytes: 576, label: '576 — IPv4 legacy minimum' },
];

/**
 * How often the unreliable link drops a packet when loss is switched on by hand.
 *
 * The same rate `lossy-link` was authored with. Bad, but not absurd -- see that
 * scenario's note on why a worse link teaches less rather than more.
 */
export const DEFAULT_LOSS_RATE = 0.08;

/** The transports the protocol switch offers. */
export const TRANSPORT_CHOICES: readonly { value: JourneyTransport; label: string }[] = [
  { value: 'tcp', label: 'TCP' },
  { value: 'udp', label: 'UDP' },
];

/**
 * The link a hand-thrown loss switch should be applied to: the longest hop on the path.
 *
 * Loss has to land on a link the packet actually crosses, or the switch would do nothing
 * and look broken. Among those, the slowest is both the most realistic (a 13 000 km
 * backbone hop is where packets really go missing) and the most watchable, because the
 * retransmission timer that follows is measured in round trips across it.
 */
export function lossiestLink(scenario: JourneyScenario): string {
  const path = resolveJourneyPath(scenario.topology, scenario.path);
  const steps = path.hops.flatMap((hop) => hop.steps);
  return steps.reduce((worst, step) => (step.latencyMs > worst.latencyMs ? step : worst))
    .linkId;
}

/** The biggest thing the scenario sends, which is where the payload slider starts. */
export function authoredPayload(scenario: JourneyScenario): number {
  return scenario.writes.reduce((largest, write) => Math.max(largest, write.bytes), 0);
}

/** The scenario's own default MTU, which is Ethernet's unless it says otherwise. */
export function authoredMtu(scenario: JourneyScenario): number {
  return scenario.mtu ?? 1500;
}

/**
 * The smallest MTU on the path, which is the one that actually constrains a packet.
 *
 * A scenario may pin one link lower than the rest -- `fragmented-packet` is built on the
 * access line's 1492 -- so the number worth printing beside the control is not the
 * default but the narrowest link the packet has to fit through.
 */
export function narrowestMtu(scenario: JourneyScenario, chosen: number | null): number {
  const base = chosen ?? authoredMtu(scenario);
  const perLink = Object.values(scenario.linkMtu ?? {}).map((mtu) => Math.min(mtu, base));
  return Math.min(base, ...perLink);
}

/**
 * The knobs, as the engine takes them.
 *
 * Two of the four are more than an assignment:
 *
 * - **MTU** also caps the scenario's per-link overrides. Without that, dragging the
 *   control down to 576 would leave `fragmented-packet`'s access line pinned at 1492 and
 *   the control would appear to have been ignored on the one hop the scenario is about.
 *   Capping rather than replacing keeps a link that was authored *narrower* than the new
 *   default narrow, which is the honest reading of "no link carries more than this".
 * - **Loss off** is a rate of zero on a named link, not the absence of a loss spec.
 *   `runJourney` merges overrides by dropping `undefined` values, so there is no way to
 *   *remove* a scenario's own `loss` -- and a zero rate never draws from the RNG
 *   (`rng.chance` short-circuits at `0`), so switching loss off leaves the rest of the
 *   run identical rather than shifting every later random decision.
 */
export function journeyOverrides(
  scenario: JourneyScenario,
  options: JourneyOptions,
): JourneyOverrides {
  const { transport, payloadBytes, mtu, lossy } = options;
  const authoredLoss = scenario.loss;

  return {
    ...(transport === null ? {} : { transport }),

    ...(payloadBytes === null
      ? {}
      : { writes: scenario.writes.map((write) => ({ ...write, bytes: payloadBytes })) }),

    ...(mtu === null
      ? {}
      : {
          mtu,
          linkMtu: Object.fromEntries(
            Object.entries(scenario.linkMtu ?? {}).map(([linkId, value]) => [
              linkId,
              Math.min(value, mtu),
            ]),
          ),
        }),

    ...(lossy === null
      ? {}
      : {
          loss: {
            linkId: authoredLoss?.linkId ?? lossiestLink(scenario),
            rate: lossy ? (authoredLoss?.rate ?? DEFAULT_LOSS_RATE) : 0,
            ...(authoredLoss?.maxRetransmissions === undefined
              ? {}
              : { maxRetransmissions: authoredLoss.maxRetransmissions }),
          },
        }),
  };
}
