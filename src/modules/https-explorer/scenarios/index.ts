/**
 * The HTTPS Explorer scenario catalogue.
 *
 * Seven connections to bundled fixture servers, ordered so that each is the previous
 * picture with one thing changed:
 *
 * 1. `tls13-fresh` -- a correct TLS 1.3 handshake. Everything else is a variation on it,
 *    so it goes first and establishes where encryption begins.
 * 2. `tls13-resumption` -- add a ticket. Change: the request goes out before the server
 *    has spoken, and can be replayed by anyone who recorded it.
 * 3. `tls12-fresh` -- subtract a version. Change: an extra round trip, and the
 *    certificate broadcast in the clear.
 * 4. `cert-expired` -- break one date. Change: check 2 fails and the connection ends.
 * 5. `cert-hostname-mismatch` -- break one name. Change: check 3 fails, with a Common
 *    Name that matches perfectly and is not consulted.
 * 6. `cert-untrusted-ca` -- break one signature path. Change: check 1 fails, though
 *    nothing about the certificate itself is wrong.
 * 7. `downgrade-blocked` -- attack the negotiation. Change: the protocol notices, at a
 *    cost of eight bytes, and the connection ends one message in.
 *
 * Scenarios 4 through 6 each break **exactly one** of the five validation steps, which is
 * the property the phase doc asks for and `scenarios.test.ts` asserts for each of them
 * individually. Scenario 2 carries the 0-RTT replay caveat, which the same suite checks is
 * present and cites RFC 8446 s 8 -- omitting it would teach something dangerous.
 *
 * The scenario picker, the route, and the tests all read this list; nothing else
 * hardcodes a scenario id.
 *
 * Every host, address, and certificate here is a fixture in the repository, and there is
 * no cryptography anywhere in this module. There is no code path from any of these files
 * to a real network.
 */

import type { TlsScenario } from '../sim/connection';

import { CERT_EXPIRED } from './cert-expired';
import { CERT_HOSTNAME_MISMATCH } from './cert-hostname-mismatch';
import { CERT_UNTRUSTED_CA } from './cert-untrusted-ca';
import { DOWNGRADE_BLOCKED } from './downgrade-blocked';
import { TLS12_FRESH } from './tls12-fresh';
import { TLS13_FRESH } from './tls13-fresh';
import { TLS13_RESUMPTION } from './tls13-resumption';

export {
  TLS13_FRESH,
  TLS13_RESUMPTION,
  TLS12_FRESH,
  CERT_EXPIRED,
  CERT_HOSTNAME_MISMATCH,
  CERT_UNTRUSTED_CA,
  DOWNGRADE_BLOCKED,
};

export {
  EXAMPLE_INTERMEDIATE,
  EXAMPLE_ROOT,
  EXPIRED_CHAIN,
  EXPIRED_LEAF,
  FIXTURE_ADDRESSES,
  GOOD_CHAIN,
  HTTP_REQUEST,
  HTTP_RESPONSE,
  INTERNAL_INTERMEDIATE,
  INTERNAL_LEAF,
  INTERNAL_ROOT,
  MISMATCHED_LEAF,
  MISMATCH_CHAIN,
  SCENARIO_EPOCH,
  TRUST_STORE,
  UNTRUSTED_CHAIN,
  WWW_LEAF,
  daysAfter,
  daysBefore,
} from './common';

/** The ids this module offers, so a route param can be narrowed to one of them. */
export type TlsScenarioId =
  | 'tls13-fresh'
  | 'tls13-resumption'
  | 'tls12-fresh'
  | 'cert-expired'
  | 'cert-hostname-mismatch'
  | 'cert-untrusted-ca'
  | 'downgrade-blocked';

/** Every scenario, in teaching order. */
export const TLS_SCENARIOS: readonly TlsScenario[] = [
  TLS13_FRESH,
  TLS13_RESUMPTION,
  TLS12_FRESH,
  CERT_EXPIRED,
  CERT_HOSTNAME_MISMATCH,
  CERT_UNTRUSTED_CA,
  DOWNGRADE_BLOCKED,
];

/** The three that break one certificate check each, in validation-step order. */
export const CERTIFICATE_FAILURE_SCENARIOS: readonly TlsScenario[] = [
  CERT_UNTRUSTED_CA,
  CERT_EXPIRED,
  CERT_HOSTNAME_MISMATCH,
];

/** The scenario the module opens on. */
export const DEFAULT_TLS_SCENARIO_ID: TlsScenarioId = 'tls13-fresh';

/** Look a scenario up by id; `undefined` for anything this module does not offer. */
export function getTlsScenario(id: string): TlsScenario | undefined {
  return TLS_SCENARIOS.find((scenario) => scenario.id === id);
}
