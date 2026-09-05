/**
 * Scenario 3 -- the same connection, one version older.
 *
 * Identical site, identical certificate, identical request. Everything that differs
 * between this run and scenario 1 is a difference between TLS 1.2 and TLS 1.3, which is
 * what makes the pair worth having: put the two timelines side by side and the changes
 * are visible rather than described.
 *
 * There are three of them, and they are all on screen:
 *
 * 1. **An extra round trip.** The client cannot guess the group, so the server has to name
 *    one in ServerKeyExchange and the client can only answer in the flight after that.
 * 2. **The certificate is in plaintext.** It goes past before any key exists, so anyone
 *    on the path copies the subject, every SAN, the issuer, and the public key.
 * 3. **Encryption starts a full round trip later**, and starts because of an explicit
 *    ChangeCipherSpec record rather than because the key schedule said so.
 *
 * The suite is `ECDHE_RSA_WITH_AES_128_GCM_SHA256` -- four components where the TLS 1.3
 * name has two, because 1.3 moved key exchange and authentication out of the suite name
 * and negotiates them separately. It is also forward secret, which is worth being explicit
 * about: TLS 1.2 *could* be configured this way and often was, but it could equally be
 * configured with static RSA, where a recorded session becomes readable the day the
 * server's private key leaks. TLS 1.3 removed the choice. That is the argument for
 * forward secrecy in one sentence, and this is the best moment to make it.
 */

import type { TlsScenario } from '../sim/connection';

import {
  FIXTURE_ADDRESSES,
  GOOD_CHAIN,
  HTTP_REQUEST,
  HTTP_RESPONSE,
  SCENARIO_EPOCH,
  TRUST_STORE,
} from './common';

/** The full TLS 1.2 handshake, for the comparison view. */
export const TLS12_FRESH: TlsScenario = {
  id: 'tls12-fresh',
  title: 'TLS 1.2, for comparison',
  summary:
    'The same site and the same certificate over TLS 1.2: two round trips instead of ' +
    'one, the certificate broadcast in plaintext, and encryption beginning only after an ' +
    'explicit ChangeCipherSpec.',
  teaches: [
    'Why TLS 1.2 needs two round trips: the client cannot send a key share until the server names the group',
    'The certificate chain crosses the wire in the clear, so an observer learns the identity of the site from the connection itself',
    'ChangeCipherSpec is a real message here and marks the exact moment encryption begins',
    'A four-component suite name, and what TLS 1.3 removed from it and why',
    'Forward secrecy: what ECDHE buys, and what static RSA cost',
  ],
  version: 'TLS 1.2',
  host: 'www.example.com',
  serverLabel: 'www.example.com',
  serverIp: FIXTURE_ADDRESSES.www,
  chain: GOOD_CHAIN,
  store: TRUST_STORE,
  validateAt: SCENARIO_EPOCH,
  suite: 'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
  group: 'secp256r1',
  alpn: 'http/1.1',
  request: HTTP_REQUEST,
  response: HTTP_RESPONSE,
  notes: [
    {
      phase: 'flight-1',
      text: 'No key share in this ClientHello, because there is nowhere to put one. TLS 1.2 negotiates the group first and exchanges shares afterwards, so the client has to hear from the server before it can contribute anything to the key. That single ordering decision is the entire extra round trip, and reversing it -- guess first, correct later if wrong -- is the main structural change in TLS 1.3.',
      reference: { rfc: 5246, section: '7.4.1.2', title: 'TLS 1.2: Client Hello' },
    },
    {
      phase: 'flight-2',
      target: 'observer',
      text: 'Everything in this flight is readable, and it includes the certificate. Compare the same moment in the TLS 1.3 run, where the observer gets an application_data record of some length and nothing else. Here it gets the subject, every SAN, the issuer chain, the validity window, and the public key -- enough to identify the site precisely, and enough for a passive collector to build a map of who talks to whom without decrypting a byte.',
      reference: { rfc: 5246, section: '7.4.2', title: 'TLS 1.2: Server Certificate' },
    },
    {
      phase: 'flight-2',
      text: 'ServerKeyExchange exists only because the client could not guess. The server names a curve, sends its ephemeral public share, and signs both with the certificate key so a machine in the middle cannot substitute its own. The signature is what makes ECDHE safe here; without it, an attacker who could rewrite this message would simply do the key exchange with each side separately.',
      reference: { rfc: 5246, section: '7.4.3', title: 'TLS 1.2: Server Key Exchange' },
    },
    {
      phase: 'flight-3',
      text: 'ChangeCipherSpec is the moment encryption begins, and it is a full round trip later than in TLS 1.3. It is also its own content type rather than a handshake message, which means the Finished MAC does not cover it -- a seam in the state machine that made TLS 1.2 implementations delicate to get right. TLS 1.3 removed the message entirely: keys change when the key schedule says they change, and the ChangeCipherSpec records you see in a 1.3 trace are meaningless padding for middleboxes.',
      reference: {
        rfc: 5246,
        section: '7.1',
        title: 'TLS 1.2: Change Cipher Spec Protocol',
      },
    },
    {
      phase: 'application-data',
      text: 'This suite is forward secret: the ECDHE keys existed only for this connection and are gone. Record the whole session, steal the server private key a year later, and the recording is still unreadable -- the key that opens it was never written down anywhere. The alternative TLS 1.2 allowed, static RSA key exchange, put the premaster secret under the certificate key, so one leaked key retroactively opened every session ever recorded. TLS 1.3 kept only the forward-secret option, which is why its suite names no longer mention key exchange at all.',
      reference: {
        rfc: 8446,
        section: '1.2',
        title: 'TLS 1.3: Major Differences from TLS 1.2',
      },
    },
    {
      phase: 'application-data',
      target: 'observer',
      text: 'One leak survives into the encrypted part: the TLS 1.2 record header still names the true content type even for protected records, so an observer can follow the structure of the conversation -- handshake, alert, application data -- and spot a rekey or a failure. TLS 1.3 stamps every protected record application_data(23) and hides the real type inside the encryption.',
      reference: {
        rfc: 8446,
        section: '5.2',
        title: 'TLS 1.3: Record Payload Protection',
      },
    },
  ],
};
