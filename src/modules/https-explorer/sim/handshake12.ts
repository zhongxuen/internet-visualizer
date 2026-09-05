/**
 * The TLS 1.2 handshake -- two round trips, and the certificate in the clear.
 *
 * This exists for the comparison view. Reading it beside `handshake13.ts` is the fastest
 * way to see what TLS 1.3 actually changed, because the changes are structural and
 * visible on a ladder rather than buried in algorithm choices.
 *
 * ```
 * Client                                              Server
 * ClientHello                       -------->
 *                                                     ServerHello
 *                                                     Certificate          <- in the clear
 *                                                     ServerKeyExchange
 *                                   <--------         ServerHelloDone
 * ClientKeyExchange
 * [ChangeCipherSpec]
 * Finished                          -------->
 *                                                    [ChangeCipherSpec]
 *                                   <--------         Finished
 * Application Data                  <------->         Application Data
 * ```
 *
 * Three differences matter, and each is visible above:
 *
 * 1. **Two round trips before any application data.** The server cannot derive keys from
 *    the first flight because the client did not send a key share -- it did not know
 *    which group the server would pick. So the server proposes (ServerKeyExchange), the
 *    client answers (ClientKeyExchange), and only then does either side have a secret.
 * 2. **The certificate crosses the wire in plaintext.** Anyone on the path copies the
 *    full chain, with every SAN in it. In TLS 1.3 it is under handshake keys one flight
 *    after ServerHello.
 * 3. **`ChangeCipherSpec` is a real message** that really does switch the record layer to
 *    the new keys. TLS 1.3 keeps a hollow version of it purely to placate middleboxes;
 *    here it does its actual job.
 *
 * ## Session resumption in TLS 1.2
 *
 * {@link buildTls12Handshake} also models the abbreviated handshake: the client offers a
 * session id or a ticket, the server accepts, and both sides skip straight to
 * ChangeCipherSpec. That is 1-RTT -- the same as a *fresh* TLS 1.3 handshake, which is
 * the comparison worth drawing. TLS 1.3 made its full handshake as fast as TLS 1.2's
 * resumed one, and its resumed handshake faster still.
 *
 * ## Not deprecated, but superseded
 *
 * TLS 1.2 is still correct and widely deployed; RFC 8996 deprecated 1.0 and 1.1, not 1.2.
 * What is unacceptable is a *badly configured* TLS 1.2 -- static RSA key exchange, CBC
 * suites, SHA-1. {@link buildTls12Handshake} models the static-RSA variant so
 * `KeyScheduleDiagram` can show what "no forward secrecy" concretely means.
 *
 * There is no cryptography here; see `placeholder.ts`.
 */

import type { RfcRef } from '@/core/types/events';

import type { CertificateChain } from './certificates';
import {
  DEFAULT_TLS12_SUITE,
  getCipherSuite,
  LEGACY_RECORD_VERSION,
  type CipherSuite,
} from './cipher';
import { buildTls12KeySchedule, type KeySchedule, type NamedGroup } from './keyschedule';
import type {
  Flight,
  HandshakeMessage,
  HandshakeNote,
  HandshakeTiming,
  MessageEncryption,
  MessageField,
} from './handshake13';
import { DEFAULT_TIMING, groupIntoFlights } from './handshake13';
import { placeholderHex, placeholderKeyShare } from './placeholder';

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

const RFC_5246 = 'The Transport Layer Security (TLS) Protocol Version 1.2';

/** Cite a section of RFC 5246. */
export function rfc5246(section: string): RfcRef {
  return { rfc: 5246, section, title: RFC_5246 };
}

/** RFC 5077 -- session resumption without server-side state. */
export const RFC_5077: RfcRef = {
  rfc: 5077,
  title: 'TLS Session Resumption without Server-Side State',
};

/** RFC 7627 -- the extended master secret extension. */
export const RFC_7627: RfcRef = {
  rfc: 7627,
  title: 'TLS Session Hash and Extended Master Secret Extension',
};

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

/** The `HandshakeType` values TLS 1.2 uses (RFC 5246 s 7.4), plus RFC 5077's ticket. */
export type Tls12HandshakeType =
  | 'hello_request'
  | 'client_hello'
  | 'server_hello'
  | 'new_session_ticket'
  | 'certificate'
  | 'server_key_exchange'
  | 'certificate_request'
  | 'server_hello_done'
  | 'certificate_verify'
  | 'client_key_exchange'
  | 'finished';

/** Registered numeric values. */
export const TLS12_HANDSHAKE_TYPE_VALUES: Readonly<Record<Tls12HandshakeType, number>> = {
  hello_request: 0,
  client_hello: 1,
  server_hello: 2,
  new_session_ticket: 4,
  certificate: 11,
  server_key_exchange: 12,
  certificate_request: 13,
  server_hello_done: 14,
  certificate_verify: 15,
  client_key_exchange: 16,
  finished: 20,
};

// ---------------------------------------------------------------------------
// The handshake
// ---------------------------------------------------------------------------

/** Which shape of TLS 1.2 handshake a run performed. */
export type Tls12Mode =
  /** The full handshake: two round trips before application data. */
  | 'full'
  /** Abbreviated resumption from a session id or ticket: one round trip. */
  | 'abbreviated';

/** A modelled TLS 1.2 handshake. */
export interface Tls12Handshake {
  readonly version: 'TLS 1.2';
  readonly mode: Tls12Mode;
  readonly suite: CipherSuite;
  /** The (EC)DHE group, or `undefined` for a static-RSA key exchange. */
  readonly group?: NamedGroup;
  readonly host: string;
  readonly messages: readonly HandshakeMessage[];
  readonly flights: readonly Flight[];
  readonly keySchedule: KeySchedule;
  /** Id of the first message not sent in the clear. Always after ChangeCipherSpec here. */
  readonly encryptionStartsAt: string;
  /** Round trips before application data. 2 for a full handshake, 1 for a resumed one. */
  readonly roundTrips: number;
  readonly applicationDataAt: number;
  readonly completedAt: number;
  readonly notes: readonly HandshakeNote[];
}

/** What {@link buildTls12Handshake} needs. */
export interface Tls12Input {
  readonly host: string;
  readonly chain?: CertificateChain;
  readonly suite?: string;
  /** The (EC)DHE group. Ignored when the suite uses static RSA key exchange. */
  readonly group?: NamedGroup;
  /** Resume an earlier session, producing the abbreviated handshake. */
  readonly resume?: boolean;
  /** Resume via an RFC 5077 ticket rather than a server-side session id. */
  readonly useSessionTicket?: boolean;
  /** Request a client certificate. Off by default -- the web almost never does this. */
  readonly requestClientCertificate?: boolean;
  readonly timing?: HandshakeTiming;
}

function field(
  name: string,
  value: string,
  explain: string,
  visibleToObserver: boolean,
  reference?: RfcRef,
): MessageField {
  return { name, value, explain, visibleToObserver, reference };
}

function message(init: {
  id: string;
  kind: HandshakeMessage['kind'];
  name: string;
  from: 'client' | 'server';
  encryption: MessageEncryption;
  flight: number;
  at: number;
  bytes: number;
  summary: string;
  fields: readonly MessageField[];
  reference: RfcRef;
  optional?: boolean;
}): HandshakeMessage {
  return init;
}

/**
 * Build a TLS 1.2 handshake.
 *
 * Deterministic, like its 1.3 counterpart: ids, byte counts, and timings are all pure
 * functions of the input.
 */
export function buildTls12Handshake(input: Tls12Input): Tls12Handshake {
  const timing = input.timing ?? DEFAULT_TIMING;
  const suite =
    getCipherSuite(input.suite ?? DEFAULT_TLS12_SUITE) ??
    getCipherSuite(DEFAULT_TLS12_SUITE)!;
  const ephemeral = suite.keyExchange === 'ECDHE' || suite.keyExchange === 'DHE';
  const group = ephemeral ? (input.group ?? 'secp256r1') : undefined;
  const resume = input.resume === true;
  const mode: Tls12Mode = resume ? 'abbreviated' : 'full';

  const keySchedule = buildTls12KeySchedule(suite, `tls12-${mode}`);
  const messages: HandshakeMessage[] = [];
  const notes: HandshakeNote[] = [];

  let clock = 0;

  // -- Flight 1: ClientHello ------------------------------------------------

  messages.push(
    message({
      id: 'client-hello',
      kind: 'client_hello',
      name: 'ClientHello',
      from: 'client',
      encryption: 'none',
      flight: 1,
      at: clock,
      bytes: 220,
      summary: resume
        ? 'Offers the previous session, hoping the server still has it.'
        : 'Capabilities only. No key share -- the client does not yet know which group the server wants, which is why this handshake needs a second round trip.',
      fields: [
        field(
          'client_version',
          LEGACY_RECORD_VERSION,
          'Here this really is the negotiated version, unlike TLS 1.3 where it is a fossil and supported_versions does the work.',
          true,
          rfc5246('7.4.1.2'),
        ),
        field(
          'random',
          placeholderHex('tls12-client-random', 32),
          'A direct input to the master secret, alongside the server random. In TLS 1.3 the randoms only enter through the transcript.',
          true,
        ),
        field(
          'session_id',
          resume && !input.useSessionTicket
            ? placeholderHex('tls12-session-id', 32)
            : '(empty)',
          resume && !input.useSessionTicket
            ? 'The id of a session the client had before. The server has to have kept the matching state in memory for this to work, which does not scale across a fleet -- hence RFC 5077 tickets.'
            : 'Empty on a fresh handshake.',
          true,
          rfc5246('7.4.1.2'),
        ),
        field(
          'cipher_suites',
          `${suite.name}, ...`,
          'Four components each. A TLS 1.2 ClientHello commonly offers dozens of these, and the list is distinctive enough to fingerprint the client.',
          true,
          rfc5246('A.5'),
        ),
        field(
          'server_name (SNI)',
          input.host,
          'In the clear, for the same reason as in TLS 1.3: the server needs it to choose a certificate before any keys exist.',
          true,
          { rfc: 6066, section: '3', title: 'TLS Extensions: Extension Definitions' },
        ),
        ...(resume && input.useSessionTicket
          ? [
              field(
                'SessionTicket',
                '<opaque ticket from the previous session>',
                'The session state, encrypted under a key only the server knows, stored by the client. Lets any server in a fleet resume a session none of them kept state for.',
                true,
                RFC_5077,
              ),
            ]
          : []),
        field(
          'extended_master_secret',
          '(empty)',
          'Asks that the master secret be bound to the handshake transcript. Without it, two different handshakes can produce the same master secret -- the triple-handshake attack. TLS 1.3 binds every secret to a transcript by construction, so this extension does not exist there.',
          true,
          RFC_7627,
        ),
      ],
      reference: rfc5246('7.4.1.2'),
    }),
  );

  clock += timing.oneWayMs;
  const serverFlightAt = clock;

  // -- Flight 2 -------------------------------------------------------------

  messages.push(
    message({
      id: 'server-hello',
      kind: 'server_hello',
      name: 'ServerHello',
      from: 'server',
      encryption: 'none',
      flight: 2,
      at: serverFlightAt,
      bytes: 90,
      summary: resume
        ? 'Accepts the session. Everything the full handshake would do next is skipped.'
        : 'Picks the suite and returns a random. No key material yet.',
      fields: [
        field(
          'server_version',
          LEGACY_RECORD_VERSION,
          'The negotiated version.',
          true,
          rfc5246('7.4.1.3'),
        ),
        field(
          'random',
          placeholderHex('tls12-server-random', 32),
          'The second direct input to the master secret. A TLS 1.3-capable server negotiating 1.2 would write the "DOWNGRD" sentinel into the last 8 bytes here.',
          true,
          { rfc: 8446, section: '4.1.3', title: 'TLS 1.3' },
        ),
        field(
          'cipher_suite',
          suite.name,
          suite.forwardSecrecy
            ? 'An ECDHE suite: forward secret.'
            : 'A static-RSA suite. No forward secrecy -- a recorded session becomes readable the day the certificate private key leaks. This is the configuration TLS 1.3 made impossible.',
          true,
        ),
        field(
          'session_id',
          placeholderHex('tls12-new-session-id', 32),
          resume
            ? 'Echoing the offered id means the server accepted the resumption.'
            : 'A new id, so a later connection can try to resume.',
          true,
          rfc5246('7.4.1.3'),
        ),
      ],
      reference: rfc5246('7.4.1.3'),
    }),
  );

  if (!resume) {
    messages.push(
      message({
        id: 'certificate',
        kind: 'certificate',
        name: 'Certificate',
        from: 'server',
        encryption: 'none',
        flight: 2,
        at: serverFlightAt,
        bytes: 2_600,
        summary:
          'The full chain, in plaintext. This is the single most visible difference from TLS 1.3.',
        fields: [
          field(
            'certificate_list',
            (input.chain?.presented ?? [])
              .map((cert) => cert.subject.commonName)
              .join(' -> ') || '(none supplied)',
            'Read in full by anyone on the path: the subject, every SAN, the issuer, the validity window, and the public key. An observer who missed the SNI still learns exactly which site this connection is to, and a passive collector can build a map of who talks to whom without decrypting anything.',
            true,
            rfc5246('7.4.2'),
          ),
        ],
        reference: rfc5246('7.4.2'),
      }),
    );

    if (ephemeral) {
      messages.push(
        message({
          id: 'server-key-exchange',
          kind: 'server_hello',
          name: 'ServerKeyExchange',
          from: 'server',
          encryption: 'none',
          flight: 2,
          at: serverFlightAt,
          bytes: 300,
          summary:
            'The server ephemeral public share, signed. This message exists only because the client could not guess the group.',
          fields: [
            field(
              'curve / params',
              group ?? 'secp256r1',
              'The server names the group here. In TLS 1.3 the client guesses it and sends a share in the first message, and that single change is what removes a round trip.',
              true,
              rfc5246('7.4.3'),
            ),
            field(
              'public key',
              placeholderKeyShare('tls12-server-share', 65),
              'The ephemeral public value. Discarded when the connection ends, which is where forward secrecy comes from.',
              true,
            ),
            field(
              'signature',
              'over client_random + server_random + params',
              'Signed with the certificate key, so the client knows the share came from the certificate holder. Note what it does not cover: the rest of the handshake. TLS 1.3 signs the whole transcript in CertificateVerify instead, which is strictly stronger.',
              true,
              rfc5246('7.4.3'),
            ),
          ],
          reference: rfc5246('7.4.3'),
        }),
      );
    }

    if (input.requestClientCertificate) {
      messages.push(
        message({
          id: 'certificate-request',
          kind: 'certificate_request',
          name: 'CertificateRequest',
          from: 'server',
          encryption: 'none',
          flight: 2,
          at: serverFlightAt,
          bytes: 60,
          optional: true,
          summary: 'Asks the client to authenticate too. Rare on the public web.',
          fields: [
            field(
              'certificate_authorities',
              'the CAs this server will accept',
              'Sent in the clear, so an observer learns which organisation issues this server client certificates -- a privacy leak TLS 1.3 closed by moving the whole message under handshake keys.',
              true,
              rfc5246('7.4.4'),
            ),
          ],
          reference: rfc5246('7.4.4'),
        }),
      );
    }

    messages.push(
      message({
        id: 'server-hello-done',
        kind: 'server_hello',
        name: 'ServerHelloDone',
        from: 'server',
        encryption: 'none',
        flight: 2,
        at: serverFlightAt,
        bytes: 4,
        summary: 'An empty message meaning "your turn". TLS 1.3 has no equivalent.',
        fields: [
          field(
            '(empty)',
            'no body',
            'Needed because the server flight has a variable number of messages and the client must know when it has all of them. In TLS 1.3 the server Finished plays that role and also authenticates the flight.',
            true,
            rfc5246('7.4.5'),
          ),
        ],
        reference: rfc5246('7.4.5'),
      }),
    );

    // -- Flight 3: the client's key exchange and switch --------------------

    clock += timing.oneWayMs + timing.clientVerifyMs;
    const clientFlightAt = clock;

    messages.push(
      message({
        id: 'client-key-exchange',
        kind: 'client_hello',
        name: 'ClientKeyExchange',
        from: 'client',
        encryption: 'none',
        flight: 3,
        at: clientFlightAt,
        bytes: ephemeral ? 70 : 262,
        summary: ephemeral
          ? 'The client ephemeral public share. Both sides can now compute the premaster secret.'
          : 'The premaster secret itself, encrypted to the certificate public key.',
        fields: [
          ephemeral
            ? field(
                'public key',
                placeholderKeyShare('tls12-client-share', 65),
                'The client half of the ECDHE exchange. Only now -- a full round trip in -- does either side have a shared secret.',
                true,
                rfc5246('7.4.7'),
              )
            : field(
                'encrypted_pre_master_secret',
                'RSA-encrypt(server public key, 48 bytes chosen by the client)',
                'The client picks the premaster secret itself and encrypts it to the certificate key. An observer records this verbatim; the day that private key leaks, every session ever recorded becomes readable. There is no ephemeral value anywhere, and that is exactly what "no forward secrecy" means.',
                true,
                rfc5246('7.4.7.1'),
              ),
        ],
        reference: rfc5246('7.4.7'),
      }),
    );

    messages.push(clientChangeCipherSpec(clientFlightAt));
    messages.push(
      finishedMessage('client', 3, clientFlightAt, 'client-finished', 'application'),
    );

    // -- Flight 4 ---------------------------------------------------------

    clock += timing.oneWayMs + timing.serverThinkMs;
    const serverFinishAt = clock;

    if (input.useSessionTicket) {
      messages.push(
        message({
          id: 'new-session-ticket',
          kind: 'new_session_ticket',
          name: 'NewSessionTicket',
          from: 'server',
          encryption: 'none',
          flight: 4,
          at: serverFinishAt,
          bytes: 200,
          optional: true,
          summary:
            'Session state encrypted under a server-only key, for the client to store and present later.',
          fields: [
            field(
              'ticket',
              '<opaque>',
              'Sent before ChangeCipherSpec in TLS 1.2, so it crosses the wire in the clear -- an observer can tell that a resumable session was established and can correlate the same ticket appearing later. In TLS 1.3 the ticket goes out under application keys.',
              true,
              RFC_5077,
            ),
          ],
          reference: RFC_5077,
        }),
      );
    }

    messages.push(serverChangeCipherSpec(serverFinishAt));
    messages.push(
      finishedMessage('server', 4, serverFinishAt, 'server-finished', 'application'),
    );

    clock += timing.oneWayMs;
  } else {
    // -- Abbreviated: the server switches immediately ----------------------

    messages.push(serverChangeCipherSpec(serverFlightAt));
    messages.push(
      finishedMessage('server', 2, serverFlightAt, 'server-finished', 'application'),
    );

    clock += timing.oneWayMs;
    const clientFlightAt = clock;

    messages.push(clientChangeCipherSpec(clientFlightAt));
    messages.push(
      finishedMessage('client', 3, clientFlightAt, 'client-finished', 'application'),
    );

    notes.push({
      id: 'tls12-abbreviated',
      title: 'A resumed TLS 1.2 handshake costs the same as a fresh TLS 1.3 one',
      body: 'Both are one round trip. That is the fairest way to state what TLS 1.3 achieved: it made the *full* handshake as cheap as TLS 1.2 resumption -- no cached state, no certificate skipped, full forward secrecy -- and then made its own resumption cheaper still with 0-RTT. Note also that no certificate is sent here, so nothing is re-validated; a certificate revoked since the original handshake keeps working until the session expires.',
      reference: rfc5246('7.3'),
      level: 'info',
    });
  }

  const roundTrips = resume ? 1 : 2;
  const applicationDataAt = clock;
  const completedAt = clock;

  // -- Notes ----------------------------------------------------------------

  notes.push({
    id: 'tls12-plaintext-certificate',
    title: 'The certificate is public',
    body: 'Everything up to ChangeCipherSpec is in the clear, and that includes the entire certificate chain. An observer who missed the SNI still learns exactly which site the connection is for, along with every other name on the certificate. TLS 1.3 moved Certificate under handshake keys, which is why its ladder shows encryption starting one message after ServerHello rather than a round trip later.',
    reference: rfc5246('7.4.2'),
    level: 'info',
  });

  notes.push({
    id: 'tls12-round-trips',
    title: 'Two round trips, and the reason is one missing message',
    body: 'TLS 1.2 has no way for the client to send a key share in the first flight, because it does not know which group the server will choose -- the group is announced in ServerKeyExchange. So the exchange must be server-proposes, client-answers, and that costs a round trip that TLS 1.3 removes by having the client guess. On a 40 ms link this is 80 ms before the first byte of the request, against 40 ms for TLS 1.3 and none at all for 0-RTT.',
    reference: rfc5246('7.3'),
    level: 'info',
  });

  if (!suite.forwardSecrecy) {
    notes.push({
      id: 'tls12-no-forward-secrecy',
      title: 'This suite has no forward secrecy',
      body: `${suite.name} uses static RSA key transport: the client encrypts the premaster secret to the public key in the server certificate. Every session ever established with that certificate can be decrypted by whoever ends up holding its private key -- a future breach, a legal demand, or a bug like Heartbleed retroactively exposes years of recorded traffic. An ECDHE suite discards its key-exchange private values when the connection closes, so there is nothing left to seize. TLS 1.3 removed static key exchange entirely rather than leaving it as a configuration mistake anyone could make.`,
      reference: rfc5246('7.4.7.1'),
      level: 'warning',
    });
  }

  notes.push({
    id: 'tls12-change-cipher-spec',
    title: 'ChangeCipherSpec is a real message here',
    body: 'It is its own record content type (20), not a handshake message, and it genuinely tells the record layer to start using the new keys. TLS 1.3 removed it -- keys change when the key schedule says so -- but kept sending a hollow copy so that middleboxes written against TLS 1.2 do not drop the handshake. The message you see in a TLS 1.3 capture is a fossil; this one does its job.',
    reference: rfc5246('7.1'),
    level: 'info',
  });

  const flights = groupIntoFlights(messages);
  const encryptionStartsAt =
    messages.find((entry) => entry.encryption !== 'none')?.id ?? 'client-finished';

  return {
    version: 'TLS 1.2',
    mode,
    suite,
    group,
    host: input.host,
    messages,
    flights,
    keySchedule,
    encryptionStartsAt,
    roundTrips,
    applicationDataAt,
    completedAt,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Shared messages
// ---------------------------------------------------------------------------

function changeCipherSpec(
  from: 'client' | 'server',
  flight: number,
  at: number,
  id: string,
): HandshakeMessage {
  return message({
    id,
    kind: 'change_cipher_spec',
    name: 'ChangeCipherSpec',
    from,
    encryption: 'none',
    flight,
    at,
    bytes: 6,
    summary: `Everything ${from === 'client' ? 'the client' : 'the server'} sends after this record is encrypted.`,
    fields: [
      field(
        'value',
        '0x01',
        'Its own record content type (20), not a handshake message -- which is why it is not covered by the Finished MAC and why the boundary it marks had to be handled so carefully. This is the exact moment encryption begins, a full round trip later than in TLS 1.3.',
        true,
        rfc5246('7.1'),
      ),
    ],
    reference: rfc5246('7.1'),
  });
}

function clientChangeCipherSpec(at: number): HandshakeMessage {
  return changeCipherSpec('client', 3, at, 'ccs-client');
}

function serverChangeCipherSpec(at: number): HandshakeMessage {
  return changeCipherSpec('server', 2, at, 'ccs-server');
}

function finishedMessage(
  from: 'client' | 'server',
  flight: number,
  at: number,
  id: string,
  encryption: MessageEncryption,
): HandshakeMessage {
  return message({
    id,
    kind: 'finished',
    name: 'Finished',
    from,
    encryption,
    flight,
    at,
    bytes: 40,
    summary:
      'The first encrypted message, and a MAC over every handshake message so far.',
    fields: [
      field(
        'verify_data',
        `PRF(master_secret, "${from} finished", Hash(handshake_messages))[0..11]`,
        'Twelve bytes, against the full hash width in TLS 1.3. It covers the handshake messages -- but not the ChangeCipherSpec records, which are a different content type, and that gap is part of what made the TLS 1.2 state machine delicate to implement correctly.',
        false,
        rfc5246('7.4.9'),
      ),
    ],
    reference: rfc5246('7.4.9'),
  });
}

// ---------------------------------------------------------------------------
// The comparison
// ---------------------------------------------------------------------------

/** One row of the 1.2-versus-1.3 table. */
export interface VersionComparisonRow {
  readonly aspect: string;
  readonly tls12: string;
  readonly tls13: string;
  /** True when TLS 1.3 is meaningfully better, not merely different. */
  readonly improved: boolean;
  readonly reference: RfcRef;
}

/**
 * The comparison the phase doc asks the module to draw.
 *
 * Deliberately includes the rows where TLS 1.3 *removed* something, because "what got
 * taken away" is most of what happened: renegotiation, compression, static RSA, custom
 * DH groups, CBC, and every hash weaker than SHA-256. TLS 1.3 is a smaller protocol, and
 * that is the security argument for it.
 */
export const VERSION_COMPARISON: readonly VersionComparisonRow[] = [
  {
    aspect: 'Round trips before application data',
    tls12: '2 (1 when resuming)',
    tls13: '1 (0 when resuming with early data)',
    improved: true,
    reference: { rfc: 8446, section: '2', title: 'TLS 1.3' },
  },
  {
    aspect: 'Where encryption begins',
    tls12: 'After ChangeCipherSpec, a full round trip in',
    tls13: 'Immediately after ServerHello',
    improved: true,
    reference: { rfc: 8446, section: '2', title: 'TLS 1.3' },
  },
  {
    aspect: 'Server certificate',
    tls12: 'Plaintext, readable by anyone on the path',
    tls13: 'Encrypted under handshake keys',
    improved: true,
    reference: { rfc: 8446, section: '4.4.2', title: 'TLS 1.3' },
  },
  {
    aspect: 'Key exchange',
    tls12: 'ECDHE, DHE, or static RSA -- configurable, and often misconfigured',
    tls13: '(EC)DHE only; forward secrecy is not optional',
    improved: true,
    reference: { rfc: 8446, section: '1.2', title: 'TLS 1.3' },
  },
  {
    aspect: 'Cipher suite name',
    tls12: 'Four components; hundreds of registered suites',
    tls13: 'Two components; five suites total',
    improved: true,
    reference: { rfc: 8446, section: 'B.4', title: 'TLS 1.3' },
  },
  {
    aspect: 'Record content type',
    tls12: 'Honest in the header, so an observer can follow the conversation structure',
    tls13: 'Encrypted inside; every protected record claims application_data(23)',
    improved: true,
    reference: { rfc: 8446, section: '5.2', title: 'TLS 1.3' },
  },
  {
    aspect: 'ChangeCipherSpec',
    tls12: 'A real message that switches the record layer',
    tls13: 'Removed; sent only as a hollow record to placate middleboxes',
    improved: true,
    reference: { rfc: 8446, section: 'D.4', title: 'TLS 1.3' },
  },
  {
    aspect: 'Key derivation',
    tls12: 'A custom PRF; master secret not bound to the transcript without RFC 7627',
    tls13: 'HKDF throughout; every secret bound to a transcript by construction',
    improved: true,
    reference: { rfc: 8446, section: '7.1', title: 'TLS 1.3' },
  },
  {
    aspect: 'Record protection',
    tls12: 'AEAD or CBC-with-HMAC (MAC-then-encrypt), plus optional compression',
    tls13: 'AEAD only; CBC and compression removed',
    improved: true,
    reference: { rfc: 8446, section: '1.2', title: 'TLS 1.3' },
  },
  {
    aspect: 'Renegotiation',
    tls12: 'Supported, and the source of a decade of vulnerabilities',
    tls13: 'Removed; KeyUpdate and post-handshake authentication replace it',
    improved: true,
    reference: { rfc: 8446, section: '1.2', title: 'TLS 1.3' },
  },
  {
    aspect: 'Replay risk',
    tls12: 'None -- there is no 0-RTT mode',
    tls13: '0-RTT early data is replayable and needs server-side anti-replay',
    improved: false,
    reference: { rfc: 8446, section: '8', title: 'TLS 1.3' },
  },
];

/** The rows where TLS 1.3 is not simply better. Currently one: 0-RTT replay. */
export function tradeOffs(): readonly VersionComparisonRow[] {
  return VERSION_COMPARISON.filter((row) => !row.improved);
}
