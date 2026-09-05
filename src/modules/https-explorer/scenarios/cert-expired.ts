/**
 * Scenario 4 -- the certificate expired twelve days ago.
 *
 * The first of three failures, and each one breaks exactly one of the five checks. Here it
 * is step 2, the validity period. The chain still reaches the trusted root, the SANs still
 * match the hostname, the stapled OCSP response still says the certificate was never
 * revoked, and the key usage is still correct. Four green rows and one red one, which is
 * the whole reason the module runs all five checks instead of stopping at the first
 * failure the way a real client sensibly does.
 *
 * ## Why the OCSP response still says "good"
 *
 * Because that is true, and the distinction is worth seeing. "Revoked" means the issuer
 * withdrew the certificate; "expired" means it aged out of its own window. A responder
 * will happily answer `good` for a certificate that expired last week -- it was never
 * withdrawn, it simply ran out. A certificate can be not-revoked and not-valid at the same
 * time, and a learner who thinks those two rows are the same row will not understand
 * either of them.
 *
 * ## Why this is the most common failure on the real web
 *
 * Nothing was attacked. Somebody's renewal cron stopped running. Short-lived certificates
 * -- ninety days, then forty-seven -- made this failure mode dramatically more common and
 * automated renewal the only workable answer, which is the trade the industry made
 * deliberately: expiry is what bounds the damage of a leaked key when revocation, the
 * weakest of the five checks, cannot be relied on to do it.
 */

import type { TlsScenario } from '../sim/connection';

import {
  EXPIRED_CHAIN,
  FIXTURE_ADDRESSES,
  HTTP_REQUEST,
  HTTP_RESPONSE,
  SCENARIO_EPOCH,
  TRUST_STORE,
} from './common';

/** Step 2 fails, and only step 2. `NET::ERR_CERT_DATE_INVALID`. */
export const CERT_EXPIRED: TlsScenario = {
  id: 'cert-expired',
  title: 'Expired certificate',
  summary:
    'A certificate that was correct in every respect until twelve days ago. The chain, ' +
    'the hostname, the revocation status, and the key usage all still check out; the ' +
    'validity window does not, and the connection ends there.',
  teaches: [
    'Which single check fires, and what the browser error string for it actually is',
    'Expired and revoked are different rows: a responder still answers "good" for a certificate that merely ran out',
    'The client sends a fatal alert and no application data is ever exchanged -- there is no partially-secure connection',
    'Why expiry exists at all: it bounds the damage of a leaked key when revocation cannot be relied on to',
  ],
  version: 'TLS 1.3',
  host: 'www.example.com',
  serverLabel: 'www.example.com (stale certificate)',
  serverIp: FIXTURE_ADDRESSES.www,
  chain: EXPIRED_CHAIN,
  store: TRUST_STORE,
  validateAt: SCENARIO_EPOCH,
  suite: 'TLS_AES_128_GCM_SHA256',
  group: 'x25519',
  alpn: 'http/1.1',
  request: HTTP_REQUEST,
  response: HTTP_RESPONSE,
  notes: [
    {
      phase: 'certificate-validation',
      text: 'One row is red. Compare it against the tls13-fresh run: the certificate is the same certificate, from the same issuer, for the same names, with the same key -- the notAfter date is the only field that moved. That is what makes the failing row informative. A client that stopped at the first failure would tell you the certificate was bad; this tells you which promise broke.',
      reference: { rfc: 5280, section: '4.1.2.5', title: 'Certificate Validity' },
    },
    {
      phase: 'certificate-validation',
      text: 'The revocation row is green, and that is not a bug. Revocation answers "did the issuer withdraw this?" and the answer is no -- nobody withdrew it, it expired. Responders keep answering for a while past notAfter for exactly this reason. Reading the two rows as one is the mistake this scenario exists to prevent.',
      reference: { rfc: 6960, section: '2.2', title: 'OCSP: Response Syntax' },
    },
    {
      phase: 'abort',
      text: 'The connection is over. The client sends certificate_expired(45) and stops -- it does not fetch the page and show a warning, and there is no such thing as a page loaded over a connection whose certificate failed. What a browser shows next is an interstitial rendered from nothing, generated locally, with a click-through that starts a new connection and tells the client to skip this check.',
      reference: { rfc: 8446, section: '6.2', title: 'TLS 1.3: Error Alerts' },
    },
    {
      phase: 'abort',
      target: 'observer',
      text: 'From the path, this failure is invisible. In TLS 1.3 the alert goes out under handshake keys, so the observer sees a short application_data record and a connection that stops -- indistinguishable from a client that lost interest. Under TLS 1.2 the same alert would be readable.',
      reference: {
        rfc: 8446,
        section: '5.2',
        title: 'TLS 1.3: Record Payload Protection',
      },
    },
    {
      phase: 'abort',
      text: 'Nothing here was an attack. A renewal job stopped running. Certificate lifetimes have been falling for a decade -- ninety days, then forty-seven -- because a short window is what limits the value of a stolen key given that revocation, the weakest of the five checks, mostly cannot be relied on. The cost of that trade is that this failure is now the ordinary one, and automated renewal is not optional.',
      reference: { rfc: 5280, section: '4.1.2.5', title: 'Certificate Validity' },
    },
  ],
};
