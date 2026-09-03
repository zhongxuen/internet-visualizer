/**
 * The fixed instant every scenario's dates are written against.
 *
 * HTTP is full of absolute dates -- `Date`, `Expires`, `Last-Modified`, `If-Modified-Since`
 * -- and a simulation whose timeline starts at zero has to map them onto something. That
 * something must not be the machine's clock: a scenario that formatted `Date.now()` would
 * produce a different `SimResult` every second, and the determinism the whole module
 * rests on would be gone before the first assertion.
 *
 * So virtual millisecond zero is a constant, chosen and written down. Every date in every
 * scenario is derived from it, which is why two runs a week apart are byte-identical and
 * why a screenshot of one stays true.
 */

import { formatHttpDate, type HttpClock } from '../sim/message';

/**
 * Virtual time zero: 2026-03-01T12:00:00Z, as an epoch millisecond.
 *
 * `Date.UTC` is arithmetic on its arguments and reads no clock, so this is a literal in
 * everything but syntax. `Date.now()` would not be, and appears nowhere in the module.
 */
export const SCENARIO_EPOCH = Date.UTC(2026, 2, 1, 12, 0, 0);

/** The clock every scenario runs on. */
export const HTTP_CLOCK: HttpClock = { origin: SCENARIO_EPOCH };

const DAY_MS = 86_400_000;

/** An HTTP-date this many days before virtual time zero, for `Last-Modified` and friends. */
export function daysBefore(days: number): string {
  return formatHttpDate(SCENARIO_EPOCH - days * DAY_MS);
}

/** An HTTP-date this many seconds after virtual time zero, for `Expires`. */
export function secondsAfter(seconds: number): string {
  return formatHttpDate(SCENARIO_EPOCH + seconds * 1000);
}

/**
 * Addresses for the simulated origins.
 *
 * All from `203.0.113.0/24` -- one of the three ranges RFC 5737 reserves for
 * documentation, precisely so that an example address cannot be mistaken for, or routed
 * to, a real host. Nothing in this module opens a socket, and the addresses are chosen so
 * that would still be safe if something one day did.
 */
export const FIXTURE_ADDRESSES = {
  example: '203.0.113.10',
  www: '203.0.113.11',
  assets: '203.0.113.12',
  shop: '203.0.113.13',
  api: '203.0.113.14',
  /** The origin the request builder in `builder.ts` sends to. */
  sandbox: '203.0.113.20',
  edge: '203.0.113.200',
} as const;
