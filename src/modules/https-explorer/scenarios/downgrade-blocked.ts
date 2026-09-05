/**
 * Scenario 7 -- an attack that fails, and costs eight bytes to defeat.
 *
 * The client offered TLS 1.3. Something on the path removed the offer, so the server --
 * which supports 1.3 perfectly well -- had nothing better to agree to and negotiated TLS
 * 1.2, where older and weaker options are available. Neither endpoint can see the
 * tampering: at that point in the handshake nothing is authenticated yet, and both sides
 * are looking at a message the other did not send.
 *
 * ## The defence
 *
 * A TLS 1.3-capable server that ends up negotiating 1.2 writes a fixed eight-byte string
 * into the tail of its `ServerHello.random`: `ASCII("DOWNGRD")` plus a version byte, which
 * is why the hex reads `44 4F 57 4E 47 52 44 01`. A client that offered 1.3 and sees that
 * string knows the server was capable and something removed its offer, and aborts with
 * `illegal_parameter(47)`.
 *
 * It costs nothing. No new message, no round trip, no negotiation -- eight bytes in a
 * field that was already there. And the attacker cannot strip the sentinel either, because
 * the server's random is covered by the signature over the transcript.
 *
 * ## Why this is the last scenario
 *
 * Every other scenario in this module shows TLS working or a certificate being wrong. This
 * one shows the shape of the thinking behind the protocol: the sentinel is not a patch
 * bolted on after an attack, it is what "the transcript is authenticated" buys you once
 * you decide to spend it. The client aborts one message into the connection, before the
 * certificate has even arrived, which is why this run is the shortest of the seven.
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

/** Version downgrade attempted, sentinel spotted, connection aborted at ServerHello. */
export const DOWNGRADE_BLOCKED: TlsScenario = {
  id: 'downgrade-blocked',
  title: 'A downgrade attack, blocked',
  summary:
    'An on-path attacker strips TLS 1.3 from the ClientHello to force the weaker ' +
    'version. The server writes the DOWNGRD sentinel into its random, the client reads ' +
    'it, and the connection ends one message in.',
  teaches: [
    'A downgrade attack works by editing an unauthenticated message: before ServerHello, nothing is signed',
    'The defence is eight bytes in a field that already existed, and costs no round trip',
    'The sentinel cannot be stripped, because the server random is covered by the signature over the transcript',
    'The client aborts at ServerHello -- before the certificate arrives, which is why this run is the shortest',
  ],
  version: 'TLS 1.2',
  host: 'www.example.com',
  serverLabel: 'www.example.com (TLS 1.3-capable)',
  serverIp: FIXTURE_ADDRESSES.www,
  chain: GOOD_CHAIN,
  store: TRUST_STORE,
  validateAt: SCENARIO_EPOCH,
  suite: 'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
  group: 'secp256r1',
  alpn: 'http/1.1',
  downgradeAttack: true,
  request: HTTP_REQUEST,
  response: HTTP_RESPONSE,
  notes: [
    {
      phase: 'flight-1',
      target: 'observer',
      text: 'This observer is not passive any more. The ClientHello that reaches the server is not the one the client sent: supported_versions has had TLS 1.3 removed from it. Nothing detects this at the time, and nothing can -- no key exists yet, so there is nothing to sign the message with and nothing to check a signature against. Every version-negotiation attack lives in that gap.',
      reference: { rfc: 8446, section: '4.2.1', title: 'TLS 1.3: Supported Versions' },
    },
    {
      phase: 'flight-2',
      text: 'The server is behaving correctly. It supports TLS 1.3, was offered only 1.2, and agreed to 1.2 -- what else could it do? But because it is 1.3-capable and ended up on 1.2, it writes ASCII("DOWNGRD") plus a version byte into the last eight bytes of its random: 44 4F 57 4E 47 52 44 01. It has no idea an attack happened. It just always does this, and that is what makes it work.',
      reference: { rfc: 8446, section: '4.1.3', title: 'TLS 1.3: Server Hello' },
    },
    {
      phase: 'flight-2',
      text: 'The client offered TLS 1.3 and is looking at a server that says it is capable and yet settled for 1.2. Those two facts cannot both be honest, so something on the path edited the offer. It aborts. Note what the defence did not need: no extra message, no round trip, no negotiation, and no agreement about which attacks exist. Eight bytes in a field that was already on the wire.',
      reference: { rfc: 8446, section: '4.1.3', title: 'TLS 1.3: Server Hello' },
    },
    {
      phase: 'flight-2',
      text: 'The attacker cannot remove the sentinel either. ServerHello.random is part of the handshake transcript, and the transcript is covered by the server’s CertificateVerify signature and by both Finished MACs -- so editing it invalidates messages the attacker cannot regenerate without the server’s private key. This is the same property that makes cipher suite and version negotiation tamper-evident in general: authenticate the whole conversation once, at the end, and every earlier message is retroactively protected.',
      reference: { rfc: 8446, section: '4.4.3', title: 'TLS 1.3: Certificate Verify' },
    },
    {
      phase: 'abort',
      text: 'illegal_parameter(47), and the connection is over one server message in -- before the certificate arrives, which is why this is the shortest of the seven runs. The user sees a connection failure rather than a certificate warning, because nothing was wrong with any certificate. Nothing was wrong with the server either. The only defective thing on this path was the path.',
      reference: { rfc: 8446, section: '6.2', title: 'TLS 1.3: Error Alerts' },
    },
  ],
};
