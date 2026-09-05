/**
 * Scenario 6 -- a flawless chain that ends nowhere.
 *
 * The third failure, breaking step 1 and nothing else. There is nothing wrong with any of
 * these certificates. The leaf names the right host, the dates are current, the OCSP
 * response is fresh and says good, the usages are correct, and each certificate really was
 * signed by the one above it. The chain terminates at a root the client has never heard
 * of, and that is the end of it.
 *
 * ## Trust is a list, not a discovery process
 *
 * This is the check people find hardest, because every other one is about a property of
 * the certificate and this one is not. Nothing in the presented chain is defective. The
 * client ships with a fixed set of roots, and a chain is worth exactly nothing unless it
 * ends in one of them -- there is no mechanism by which a client learns to trust a new CA
 * during a handshake, and if there were, the whole system would be decorative.
 *
 * ## Four different situations produce this one screen
 *
 * A corporate CA the machine was never told about; a self-signed certificate on a staging
 * box; a server that forgot to send its intermediate; and an active attacker terminating
 * the connection with a CA they made up. From the client's side all four are identical:
 * "the chain does not reach anything I trust". That ambiguity is real, and it is why the
 * warning cannot be worded more helpfully than it is -- and why click-through exists,
 * which is the part with the teeth, since the first three are so common that users learn
 * to click through the fourth.
 */

import type { TlsScenario } from '../sim/connection';

import {
  FIXTURE_ADDRESSES,
  HTTP_REQUEST,
  HTTP_RESPONSE,
  SCENARIO_EPOCH,
  TRUST_STORE,
  UNTRUSTED_CHAIN,
} from './common';

/** Step 1 fails, and only step 1. `NET::ERR_CERT_AUTHORITY_INVALID`. */
export const CERT_UNTRUSTED_CA: TlsScenario = {
  id: 'cert-untrusted-ca',
  title: 'Untrusted certificate authority',
  summary:
    'A well-formed chain for the right hostname, with current dates and a good ' +
    'revocation status, signed by a certificate authority the client’s trust store has ' +
    'never heard of. Everything checks out except who vouched for it.',
  teaches: [
    'Trust in the web PKI is a fixed list shipped with the client, not something discovered during a handshake',
    'A chain can be internally perfect and still worth nothing',
    'A server presents its leaf and intermediates but never its root -- the client is supposed to already have that',
    'A corporate CA, a self-signed box, a missing intermediate, and an active attacker are indistinguishable from here',
  ],
  version: 'TLS 1.3',
  host: 'www.example.com',
  serverLabel: 'www.example.com (internally issued)',
  serverIp: FIXTURE_ADDRESSES.internal,
  chain: UNTRUSTED_CHAIN,
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
      text: 'Four rows are green, and they are green honestly: the hostname matches a SAN entry, the dates are current, the stapled OCSP response is fresh and says good, and the usages are exactly what they should be. Step 1 is the only failure, and it is not a statement about the certificate at all -- it is a statement about who signed it, and whether the client was told in advance to believe them.',
      reference: { rfc: 5280, section: '6.1', title: 'Certificate Path Validation' },
    },
    {
      phase: 'certificate-validation',
      text: 'Walk the chain in the panel: leaf, issued by Example Internal Issuing CA; that intermediate, issued by Example Internal Root CA; and then nothing, because the walk has run out of certificates without reaching anything in the store. The root is not in the presented chain and should not be -- a server sends its leaf and its intermediates, never its root, because sending a root would prove nothing to a client that does not already have it.',
      reference: { rfc: 5280, section: '6.1', title: 'Certificate Path Validation' },
    },
    {
      phase: 'certificate-validation',
      text: 'There is no way for the client to fix this on its own. Nothing in TLS lets a server say "also, please trust my CA" -- if there were, an attacker would use it, and the trust store would be a formality. Adding the root to the store is an administrative act performed out of band, which is exactly what installing a corporate CA on a managed laptop is.',
      reference: {
        rfc: 8446,
        section: '4.4.2.4',
        title: 'TLS 1.3: Receiving a Certificate Message',
      },
    },
    {
      phase: 'abort',
      text: 'unknown_ca(48), fatal. The interstitial that follows cannot be more specific than it is, because the client genuinely cannot tell whether it is looking at a corporate CA it was never given, a staging server with a self-signed certificate, an origin that forgot to send its intermediate, or an attacker. The first three are common enough that users learn the gesture for clicking past them, which is what makes the fourth work.',
      reference: { rfc: 8446, section: '6.2', title: 'TLS 1.3: Error Alerts' },
    },
  ],
};
