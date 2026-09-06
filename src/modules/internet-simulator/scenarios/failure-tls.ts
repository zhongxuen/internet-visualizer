/**
 * `NET::ERR_CERT_DATE_INVALID` -- the certificate expired three days ago.
 *
 * The most instructive failure in the set, because nothing *broke*. DNS resolved. The
 * connection opened. The handshake got as far as the server presenting its chain, and the
 * chain is well-formed, correctly signed, issued by a CA the client trusts, and names the
 * right host. It is simply out of date, and the browser refuses on purpose.
 *
 * That is worth making explicit, because the interstitial is the one browser error users
 * routinely click through. What it means is that the identity check the whole of HTTPS
 * rests on did not succeed -- and an attacker who can present a stale certificate can
 * usually present any certificate. The connection is torn down with a
 * `certificate_expired` alert (RFC 8446 s6.2, alert 45), and no HTTP request is ever sent:
 * the origin does not learn which page was wanted.
 *
 * All five checks are still run and all five verdicts are kept, so the detail panel can
 * show that exactly one of them is red.
 */

import type { SimulatorScenario } from '../sim/stage';

import {
  EXPIRED_CHAIN,
  SCENARIO_EPOCH,
  SITE_HOST,
  SITE_ORIGIN,
  TRUST_STORE,
} from './common';

export const FAILURE_TLS: SimulatorScenario = {
  id: 'failure-tls',
  title: 'Failure: the certificate expired',
  summary:
    'Everything works up to the certificate. The chain is valid, trusted, and for the right host -- and three days out of date, so the browser refuses the connection.',
  teaches: [
    'That a certificate interstitial is a refusal, not a breakage',
    'Which of the five validation checks failed, and that the other four passed',
    'That the alert is a real message on the wire, not a browser invention',
  ],
  url: `https://${SITE_HOST}/`,
  profileId: 'cable',
  seed: 'internet-simulator:failure-tls',
  origin: SITE_ORIGIN,
  tls: {
    version: '1.3',
    chain: EXPIRED_CHAIN,
    store: TRUST_STORE,
    validationAt: SCENARIO_EPOCH,
    alpn: 'h2',
  },
  notes: [
    {
      phase: 'tls',
      target: 'origin',
      text: 'Expiry is not a technicality. A certificate is a statement with a deadline on it, and past the deadline the issuer is no longer vouching for anything -- including whether the key has since leaked.',
    },
  ],
};
