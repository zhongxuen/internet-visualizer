/**
 * Scenario 2 -- resumption, 0-RTT, and the caveat that has to travel with it.
 *
 * The client has been here before. It kept the ticket the server issued at the end of
 * scenario 1, and this time it can skip the certificate, skip the signature, and -- with
 * 0-RTT -- send its request in the very first flight, before the server has said anything
 * at all. Zero round trips of TLS. It is the fastest thing in the protocol.
 *
 * ## And it is replayable, which is why this file is longer than the others
 *
 * The early data is encrypted under a key derived from the pre-shared key and the
 * ClientHello alone. Nothing the server contributed goes into it -- that is exactly what
 * lets the client encrypt before hearing back, and it is exactly why the server cannot
 * tell a fresh request from one an attacker recorded and sent again an hour later. Both
 * decrypt. Both are valid. RFC 8446 s 8 puts the burden on the server to add its own
 * anti-replay (single-use tickets, or a strike register of seen ClientHellos), and s 2.3
 * is explicit that an application must only put a request in early data if it is willing
 * to have that request executed more than once.
 *
 * There is a second caveat, and it is not the same one: early data is **not forward
 * secret**. It comes from the PSK, which is stored at both ends and can be stolen later.
 * Everything after the handshake completes is protected by the fresh (EC)DHE exchange and
 * stays forward secret.
 *
 * The phase doc says to state the replay caveat explicitly, and it is right to: teaching
 * 0-RTT as "the fast one" and stopping there produces developers who put a payment POST
 * in early data. The request in this scenario is a GET for that reason, and the annotation
 * saying so is not optional decoration -- `scenarios.test.ts` asserts it is present, cites
 * RFC 8446 s 8, and names replay.
 */

import type { TlsScenario } from '../sim/connection';

import {
  FIXTURE_ADDRESSES,
  HTTP_REQUEST,
  HTTP_RESPONSE,
  SCENARIO_EPOCH,
  TRUST_STORE,
} from './common';

/** A PSK handshake carrying 0-RTT data, and the two caveats that come with it. */
export const TLS13_RESUMPTION: TlsScenario = {
  id: 'tls13-resumption',
  title: 'Resumption and 0-RTT',
  summary:
    'The client resumes with a ticket from an earlier connection and sends its request ' +
    'in the first flight, before the server has spoken. No certificate, no signature, no ' +
    'round trip -- and data that an attacker can replay.',
  teaches: [
    'A ticket replaces the certificate: the server proves who it is by holding the PSK, so Certificate and CertificateVerify are absent',
    '0-RTT data is encrypted from the PSK and the ClientHello alone, which is why it can be sent immediately',
    'That same property makes it replayable, and no protocol change can fix it -- the server has to add anti-replay itself',
    'Only requests safe to execute more than once belong in early data: GET, never POST',
    'Early data is not forward secret; everything after the handshake completes is',
  ],
  version: 'TLS 1.3',
  host: 'www.example.com',
  serverLabel: 'www.example.com',
  serverIp: FIXTURE_ADDRESSES.www,
  // No chain: a resumed handshake presents no certificate at all, which is itself a
  // teaching point rather than an omission.
  store: TRUST_STORE,
  validateAt: SCENARIO_EPOCH,
  suite: 'TLS_AES_128_GCM_SHA256',
  group: 'x25519',
  alpn: 'http/1.1',
  resume: true,
  earlyData: true,
  request: HTTP_REQUEST,
  response: HTTP_RESPONSE,
  notes: [
    {
      phase: 'flight-1',
      text: 'The request is already on the wire. It went out with the ClientHello, encrypted under client_early_traffic_secret -- a key the client derived from the ticket and its own first message, with no input from the server whatsoever. That is what makes zero round trips possible, and it is the same sentence that explains the danger below.',
      reference: { rfc: 8446, section: '2.3', title: 'TLS 1.3: 0-RTT Data' },
    },
    {
      phase: 'flight-1',
      text: 'REPLAY CAVEAT. Because nothing the server contributed went into the early-data key, the server cannot distinguish this flight from a recording of it. An attacker who copies these bytes off the wire can send the identical flight again an hour later; it decrypts, it authenticates, and the server acts on it a second time. The protocol cannot prevent this, and RFC 8446 s 8 says so plainly: anti-replay is the server’s job -- single-use tickets, or a strike register of ClientHellos already seen -- and RFC 8446 s 2.3 requires that applications only send early data for requests they are willing to have executed more than once. That is why the request here is a GET. A payment POST in early data is a duplicate charge waiting for someone with a packet capture.',
      reference: { rfc: 8446, section: '8', title: 'TLS 1.3: 0-RTT and Anti-Replay' },
    },
    {
      phase: 'flight-1',
      text: 'Second caveat, and a different one: early data is not forward secret. Its key comes from the PSK, which both ends have stored on disk; steal the ticket later and this one record becomes readable. Everything from the handshake completing onward is keyed by the fresh (EC)DHE exchange in this connection and stays forward secret regardless. The two caveats are why 0-RTT is off by default in most stacks and enabled per-route when it is enabled at all.',
      reference: { rfc: 8446, section: '2.3', title: 'TLS 1.3: 0-RTT Data' },
    },
    {
      phase: 'flight-2',
      text: 'No Certificate, and no CertificateVerify. The server proves it is the same server by being able to use the PSK the earlier session left behind, which saves several kilobytes and a signature. It also means the certificate checks from the first connection are not repeated here -- so a certificate revoked five minutes ago keeps working against outstanding tickets until they expire. That is what bounds ticket lifetimes, not politeness.',
      reference: { rfc: 8446, section: '2.2', title: 'TLS 1.3: Resumption and PSK' },
    },
    {
      phase: 'flight-2',
      target: 'observer',
      text: 'The observer can tell this was a resumption without reading anything. A substantial client record went out in the first flight, before any server response -- a shape that only happens with 0-RTT -- and the server’s flight is thousands of bytes shorter than a fresh one because it carries no certificate. Neither fact needed a single decrypted byte.',
      reference: { rfc: 8446, section: '5.1', title: 'TLS 1.3: Record Layer' },
    },
    {
      phase: 'application-data',
      text: 'EndOfEarlyData marks the boundary and is sent under handshake keys, not early-data keys -- so a replayer holding only the recorded 0-RTT flight cannot forge it. From here the connection is an ordinary TLS 1.3 connection, with all the forward secrecy that implies.',
      reference: { rfc: 8446, section: '4.5', title: 'TLS 1.3: End of Early Data' },
    },
  ],
};
