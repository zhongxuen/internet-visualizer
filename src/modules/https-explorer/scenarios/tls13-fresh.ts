/**
 * Scenario 1 -- a TLS 1.3 handshake with nothing wrong with it.
 *
 * Everything else in this module is a variation on this picture, so it goes first and it
 * does one thing: put a complete, correct handshake on screen with the moment encryption
 * begins marked in it.
 *
 * That moment is the headline. There are exactly two cleartext messages in a TLS 1.3
 * connection -- ClientHello and ServerHello -- and everything after the second one,
 * including the certificate that says who the server is, is already encrypted. In TLS 1.2
 * the certificate goes past in the clear and encryption starts a full round trip later.
 * Scenario 3 shows that side by side; this one establishes what it is being compared to.
 *
 * The second thing it exists to say is what the handshake does *not* hide, which is the
 * honest half of the encryption overlay: the destination address, the SNI hostname, the
 * record lengths, and the timings all cross the wire in the clear, and the observer node
 * on the diagram has all four before the server has finished its first sentence.
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

/** One round trip, one certificate, five checks passed, and one encrypted exchange. */
export const TLS13_FRESH: TlsScenario = {
  id: 'tls13-fresh',
  title: 'TLS 1.3, from cold',
  summary:
    'A full 1-RTT handshake to a site the client has never spoken to: key shares in the ' +
    'first message, the certificate already encrypted in the second, and an HTTP ' +
    'exchange nobody on the path can read.',
  teaches: [
    'Only ClientHello and ServerHello are ever in the clear',
    'The client guesses the key exchange group and sends a share with its first message, which is where the saved round trip comes from',
    'Both sides derive the same secret from an (EC)DHE exchange the observer watched in full and cannot reproduce',
    'The five certificate checks, and what the padlock is and is not a statement about',
    'What survives the encryption: the address, the hostname, the sizes, and the timings',
  ],
  version: 'TLS 1.3',
  host: 'www.example.com',
  serverLabel: 'www.example.com',
  serverIp: FIXTURE_ADDRESSES.www,
  chain: GOOD_CHAIN,
  store: TRUST_STORE,
  validateAt: SCENARIO_EPOCH,
  suite: 'TLS_AES_128_GCM_SHA256',
  group: 'x25519',
  alpn: 'http/1.1',
  request: HTTP_REQUEST,
  response: HTTP_RESPONSE,
  notes: [
    {
      phase: 'flight-1',
      text: 'The client guesses. It picks a key exchange group, generates an ephemeral key pair for it, and sends the public share in the very first message -- before it has any idea what the server supports. That guess is the whole of how TLS 1.3 got to one round trip: TLS 1.2 had to ask the server which group to use and wait for the answer. When the guess is wrong the server sends a HelloRetryRequest and the saving is gone, which is why every client guesses X25519.',
      reference: { rfc: 8446, section: '4.1.2', title: 'TLS 1.3: ClientHello' },
    },
    {
      phase: 'flight-1',
      target: 'observer',
      text: 'The hostname is here, in the clear, and it is the single largest thing HTTPS does not hide. It has to be: the server may host a thousand sites on this address and cannot choose which certificate to send until it knows which one was asked for -- and that decision happens before any key exists. SNI-based blocking works for exactly this reason. Encrypted Client Hello closes the hole by wrapping the real ClientHello under a key published in DNS, and is not yet widely deployed.',
      reference: {
        rfc: 6066,
        section: '3',
        title: 'TLS Extensions: Server Name Indication',
      },
    },
    {
      phase: 'flight-2',
      text: 'Both sides now hold the same shared secret, and the observer -- who has both public shares, having read both Hello messages in full -- does not. That is not a trick of the protocol; it is the whole content of Diffie-Hellman, and the key schedule panel shows the arithmetic on a deliberately breakable toy group so it can be checked by hand. From this secret HKDF expands the handshake traffic keys, which is why the very next record is already unreadable.',
      reference: { rfc: 8446, section: '7.1', title: 'TLS 1.3: Key Schedule' },
    },
    {
      phase: 'certificate-validation',
      text: 'Five checks, and the client runs all five even though a real one would stop at the first failure. Stopping is correct behaviour and wrong teaching: one red row says "the certificate was bad", where four green rows and one red row say which promise broke. The three cert-* scenarios each break exactly one.',
      reference: { rfc: 5280, section: '6.1', title: 'Certificate Path Validation' },
    },
    {
      phase: 'application-data',
      target: 'observer',
      text: 'Every record from here is application_data(23) of some length, in one direction or the other, and that is all this observer will ever get. Note what it still has: it knows a browser at this address fetched something from www.example.com at this moment, how many bytes went each way, and how long the server took to think. It does not know the path, the cookie, or a single byte of the page.',
      reference: {
        rfc: 8446,
        section: '5.2',
        title: 'TLS 1.3: Record Payload Protection',
      },
    },
    {
      phase: 'close',
      text: 'The exchange was HTTP/1.1 text because it is readable, and ALPN was set to match. Over h2 the same request would be HPACK-compressed binary frames inside these same records: the record layer would not notice, because it does not know what it carries. That indifference is why the same TLS carries HTTP, SMTP, and everything else.',
      reference: { rfc: 8446, section: '5.1', title: 'TLS 1.3: Record Layer' },
    },
  ],
};
