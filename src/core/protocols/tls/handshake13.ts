/**
 * The TLS 1.3 handshake -- one round trip, and encryption almost immediately.
 *
 * ```
 * Client                                              Server
 * ClientHello                       -------->
 *   + key_share
 *   + supported_versions
 *   + server_name (SNI)
 *   + signature_algorithms
 *   + application_layer_protocol_negotiation
 *                                   <--------  ServerHello
 *                                                + key_share
 *                                                + supported_versions
 *                                              {EncryptedExtensions}
 *                                              {Certificate}
 *                                              {CertificateVerify}
 *                                              {Finished}
 * {Finished}                        -------->
 * [Application Data]                <------->  [Application Data]
 *                                   <--------  [NewSessionTicket]
 * ```
 *
 * `{}` is handshake keys, `[]` is application keys. Read the braces and the two headline
 * facts fall out on their own:
 *
 * - **One round trip.** The client can send its request in the same flight as its
 *   Finished. TLS 1.2 needs two.
 * - **Encryption starts one message into the conversation.** Only the two Hello messages
 *   are ever in the clear. The certificate -- which in TLS 1.2 is broadcast to anyone
 *   watching -- is already protected.
 *
 * Both come from the same change: TLS 1.3 made the client *guess* the key exchange group
 * and send its `key_share` in the very first message. If the guess is right, and it
 * almost always is, the server can derive handshake keys the moment it has read the
 * ClientHello. {@link buildHelloRetryRequest} models the case where the guess is wrong.
 *
 * ## What the module deliberately gets right
 *
 * - `supported_versions`, not the record version, is what selects TLS 1.3 (s 4.1.2).
 * - The certificate is sent under handshake keys, not in the clear (s 4.4.2).
 * - CertificateVerify signs a context string plus the transcript hash, not the
 *   transcript alone (s 4.4.3) -- the context string is what stops a signature made as a
 *   client being replayed as a server.
 * - `change_cipher_spec` may appear, means nothing, and is present only so middleboxes
 *   see something familiar (s D.4).
 * - 0-RTT data is replayable, and no amount of protocol design fixes that (s 2.3, s 8).
 *
 * There is no cryptography here; see `placeholder.ts`.
 */

import type { RfcRef } from '@/core/types/events';

import {
  DEFAULT_TLS13_SUITE,
  getCipherSuite,
  LEGACY_RECORD_VERSION,
  type CipherSuite,
} from './cipher';
import type { CertificateChain } from './certificates';
import { buildKeySchedule, type KeySchedule, type NamedGroup } from './keyschedule';
import { placeholderHex, placeholderKeyShare } from './placeholder';

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

const RFC_8446 = 'The Transport Layer Security (TLS) Protocol Version 1.3';

/** Cite a section of RFC 8446. */
export function rfc8446(section: string): RfcRef {
  return { rfc: 8446, section, title: RFC_8446 };
}

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

/** The `HandshakeType` values TLS 1.3 uses (RFC 8446 s B.3). */
export type HandshakeType =
  | 'client_hello'
  | 'server_hello'
  | 'new_session_ticket'
  | 'end_of_early_data'
  | 'encrypted_extensions'
  | 'certificate'
  | 'certificate_request'
  | 'certificate_verify'
  | 'finished'
  | 'key_update';

/** Registered numeric values, as a dissector prints them. */
export const HANDSHAKE_TYPE_VALUES: Readonly<Record<HandshakeType, number>> = {
  client_hello: 1,
  server_hello: 2,
  new_session_ticket: 4,
  end_of_early_data: 5,
  encrypted_extensions: 8,
  certificate: 11,
  certificate_request: 13,
  certificate_verify: 15,
  finished: 20,
  key_update: 24,
};

/**
 * What a message carries on the ladder.
 *
 * `application_data` and `change_cipher_spec` are not handshake types -- they are record
 * content types -- but the ladder shows them alongside, because a ladder that omitted the
 * application data would not show what the handshake was *for*.
 */
export type LadderMessageKind = HandshakeType | 'application_data' | 'change_cipher_spec';

/** Which key protects a message, matching `records.ts`. */
export type MessageEncryption = 'none' | 'early-data' | 'handshake' | 'application';

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

/**
 * One field inside a handshake message.
 *
 * {@link visibleToObserver} is what drives the encryption overlay. It is *not* simply the
 * inverse of the message's encryption: the record header of an encrypted message is still
 * visible, and so its length and timing are. Fields here are the contents.
 */
export interface MessageField {
  readonly name: string;
  readonly value: string;
  readonly explain: string;
  /** True only when this field really crosses the wire in the clear. */
  readonly visibleToObserver: boolean;
  readonly reference?: RfcRef;
}

/** One message on the ladder. */
export interface HandshakeMessage {
  readonly id: string;
  readonly kind: LadderMessageKind;
  /** The name as written in the RFC's ladder diagrams, e.g. `EncryptedExtensions`. */
  readonly name: string;
  readonly from: 'client' | 'server';
  readonly encryption: MessageEncryption;
  /** Which flight this belongs to. Messages in one flight travel in one direction, together. */
  readonly flight: number;
  /** Virtual milliseconds from the start of the handshake. */
  readonly at: number;
  /** A plausible size, for the overhead numbers. Not measured from real bytes. */
  readonly bytes: number;
  /** One line: what this message is for. */
  readonly summary: string;
  readonly fields: readonly MessageField[];
  readonly reference: RfcRef;
  /** Set when a message is optional and this run happened to include or omit it. */
  readonly optional?: boolean;
}

/** A group of messages sent together in one direction. */
export interface Flight {
  readonly number: number;
  readonly from: 'client' | 'server';
  readonly at: number;
  readonly messageIds: readonly string[];
  readonly summary: string;
}

// ---------------------------------------------------------------------------
// The handshake
// ---------------------------------------------------------------------------

/** Which shape of TLS 1.3 handshake a run performed. */
export type Tls13Mode =
  /** A fresh handshake with a certificate. One round trip before application data. */
  | 'full-1rtt'
  /** Resumption with a PSK, sending application data in the first flight. Zero RTT. */
  | 'psk-0rtt'
  /** Resumption with a PSK but no early data. Still one round trip, but no certificate. */
  | 'psk-1rtt'
  /** The client guessed the wrong group and had to start again. Two round trips. */
  | 'hello-retry-request';

/** A modelled TLS 1.3 handshake. */
export interface Tls13Handshake {
  readonly version: 'TLS 1.3';
  readonly mode: Tls13Mode;
  readonly suite: CipherSuite;
  readonly group: NamedGroup;
  readonly host: string;
  readonly alpn: string;
  readonly messages: readonly HandshakeMessage[];
  readonly flights: readonly Flight[];
  readonly keySchedule: KeySchedule;
  /**
   * Id of the first message that is not in the clear.
   *
   * The headline number for the comparison view. In every 1.3 mode this is the message
   * immediately after ServerHello -- or, in 0-RTT, a message the client sends before the
   * server has spoken at all.
   */
  readonly encryptionStartsAt: string;
  /** Round trips of latency before application data can be sent. 0, 1, or 2. */
  readonly roundTrips: number;
  /** Virtual ms at which the client may send application data. */
  readonly applicationDataAt: number;
  /** Virtual ms at which the handshake is complete for both sides. */
  readonly completedAt: number;
  /** Teaching notes for this run, cited. */
  readonly notes: readonly HandshakeNote[];
}

/** A cited observation about a run, surfaced beside the ladder. */
export interface HandshakeNote {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly reference: RfcRef;
  /** `warning` for things that are dangerous rather than merely interesting. */
  readonly level: 'info' | 'warning';
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

/** How long each stage of a modelled handshake takes. All virtual milliseconds. */
export interface HandshakeTiming {
  /** One-way propagation delay. A round trip is twice this. */
  readonly oneWayMs: number;
  /** How long the server spends signing and assembling its flight. */
  readonly serverThinkMs: number;
  /** How long the client spends validating the certificate chain. */
  readonly clientVerifyMs: number;
}

/** A 40 ms round trip: a plausible same-continent connection. */
export const DEFAULT_TIMING: HandshakeTiming = {
  oneWayMs: 20,
  serverThinkMs: 4,
  clientVerifyMs: 3,
};

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/** What {@link buildTls13Handshake} needs. */
export interface Tls13Input {
  readonly host: string;
  /** Leaf first. Omitted in a PSK handshake, where the ticket authenticates instead. */
  readonly chain?: CertificateChain;
  readonly suite?: string;
  readonly group?: NamedGroup;
  readonly alpn?: string;
  /** Resume from a ticket. Implies no Certificate or CertificateVerify. */
  readonly resume?: boolean;
  /** Send 0-RTT application data. Requires `resume`. */
  readonly earlyData?: boolean;
  /** The early data payload, so the participant view has something to show. */
  readonly earlyDataPayload?: string;
  /** Model a wrong group guess and a HelloRetryRequest. */
  readonly helloRetryRequest?: boolean;
  /** Emit the compatibility-mode change_cipher_spec records. Defaults to true. */
  readonly middleboxCompatibility?: boolean;
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

// ---------------------------------------------------------------------------
// HelloRetryRequest
// ---------------------------------------------------------------------------

/**
 * The special ServerHello random that marks a HelloRetryRequest (RFC 8446 s 4.1.3).
 *
 * HRR is not a separate message type -- it is a ServerHello whose `random` field is this
 * exact 32-byte constant, which is itself the SHA-256 of the string "HelloRetryRequest".
 * Reusing ServerHello was deliberate: a middlebox that had learned to expect exactly one
 * ServerHello does not choke on a new message type it has never seen.
 */
export const HELLO_RETRY_REQUEST_RANDOM =
  'CF21AD74E59A6111BE1D8C021E65B891C2A211167ABB8C5E079E09E2C8A8339C';

/**
 * When the client's guessed group is not one the server supports, the server replies with
 * a HelloRetryRequest naming a group it does support, and the client sends a second
 * ClientHello. That costs a full extra round trip -- making a "1-RTT" handshake a 2-RTT
 * one -- which is why clients guess X25519 and why guessing well matters.
 */
export function buildHelloRetryRequest(group: NamedGroup, at: number): HandshakeMessage {
  return {
    id: 'hello-retry-request',
    kind: 'server_hello',
    name: 'HelloRetryRequest',
    from: 'server',
    encryption: 'none',
    flight: 2,
    at,
    bytes: 90,
    summary: `The client offered a key_share for a group the server will not use. The server asks for ${group} and the client starts over.`,
    fields: [
      field(
        'random',
        HELLO_RETRY_REQUEST_RANDOM,
        'Not random at all: this fixed value, the SHA-256 of "HelloRetryRequest", is the only thing that distinguishes an HRR from a real ServerHello. Reusing the message type kept middleboxes from choking on something unfamiliar.',
        true,
        rfc8446('4.1.3'),
      ),
      field(
        'key_share (HelloRetryRequest)',
        `selected_group = ${group}`,
        'Names a group the server will accept. It carries no key share of its own -- the server has not committed to anything yet.',
        true,
        rfc8446('4.2.8'),
      ),
      field(
        'cookie',
        'opaque state, echoed by the client',
        'Optional. Lets a server stay stateless across the retry by handing its state to the client to carry back, rather than allocating memory for a connection that may never complete.',
        true,
        rfc8446('4.2.2'),
      ),
    ],
    reference: rfc8446('4.1.4'),
  };
}

// ---------------------------------------------------------------------------
// Downgrade protection
// ---------------------------------------------------------------------------

/**
 * The sentinel a TLS 1.3-capable server writes into the last 8 bytes of
 * `ServerHello.random` when it negotiates TLS 1.2 (RFC 8446 s 4.1.3).
 */
export const DOWNGRADE_SENTINEL_TLS12 = '444F574E47524401';

/** The same sentinel for a negotiated version of TLS 1.1 or below. */
export const DOWNGRADE_SENTINEL_TLS11 = '444F574E47524400';

/** What a client concluded from the tail of `ServerHello.random`. */
export interface DowngradeCheck {
  readonly detected: boolean;
  /** The 8-byte tail that was examined. */
  readonly sentinel?: string;
  readonly detail: string;
  readonly reference: RfcRef;
  /** The alert a client sends on detection. */
  readonly alert?: { readonly name: string; readonly code: number };
}

/**
 * Detect an active downgrade attack.
 *
 * The attack: a machine in the middle strips TLS 1.3 from the client's
 * `supported_versions` so both ends settle on TLS 1.2, where older and weaker options are
 * available. Neither endpoint can see the tampering, because at that point in the
 * handshake nothing is authenticated yet.
 *
 * The defence is delightfully cheap. A TLS 1.3-capable server that ends up negotiating
 * 1.2 writes a fixed 8-byte string into the tail of its `ServerHello.random`. A TLS
 * 1.3-capable client that sees that string, having offered 1.3, knows something removed
 * its offer -- and aborts with `illegal_parameter`. The sentinel costs nothing, needs no
 * new message, and is covered by the server's signature over the transcript, so an
 * attacker cannot strip it either.
 *
 * `ASCII("DOWNGRD")` plus a version byte -- which is why the hex reads `44 4F 57 4E 47 52
 * 44 01`.
 */
export function detectDowngrade(
  serverRandomTail: string,
  clientOfferedTls13: boolean,
  negotiatedVersion: string,
): DowngradeCheck {
  const tail = serverRandomTail.toUpperCase();
  const reference = rfc8446('4.1.3');

  if (tail !== DOWNGRADE_SENTINEL_TLS12 && tail !== DOWNGRADE_SENTINEL_TLS11) {
    return {
      detected: false,
      detail: `The tail of ServerHello.random carries no downgrade sentinel, so ${negotiatedVersion} is what both sides genuinely agreed on.`,
      reference,
    };
  }

  if (!clientOfferedTls13) {
    return {
      detected: false,
      sentinel: tail,
      detail: `The sentinel is present, but this client never offered TLS 1.3, so ${negotiatedVersion} is the correct outcome and the sentinel is simply informational.`,
      reference,
    };
  }

  const which = tail === DOWNGRADE_SENTINEL_TLS12 ? 'TLS 1.2' : 'TLS 1.1 or below';
  return {
    detected: true,
    sentinel: tail,
    detail: `The server wrote the "DOWNGRD" sentinel for ${which} into the last 8 bytes of its random, meaning it is TLS 1.3-capable and yet negotiated ${which}. This client offered TLS 1.3, so something on the path removed the offer. The client aborts.`,
    reference,
    alert: { name: 'illegal_parameter', code: 47 },
  };
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

/**
 * Build a TLS 1.3 handshake.
 *
 * Deterministic in every respect: message ids, byte counts, and timings are all functions
 * of the input, so the same scenario renders identically every time and a test can assert
 * on exact values.
 */
export function buildTls13Handshake(input: Tls13Input): Tls13Handshake {
  const timing = input.timing ?? DEFAULT_TIMING;
  const suite =
    getCipherSuite(input.suite ?? DEFAULT_TLS13_SUITE) ??
    getCipherSuite(DEFAULT_TLS13_SUITE)!;
  const group = input.group ?? 'x25519';
  const alpn = input.alpn ?? 'h2';
  const host = input.host;

  const resume = input.resume === true;
  const earlyData = resume && input.earlyData === true;
  const hrr = input.helloRetryRequest === true;
  const compat = input.middleboxCompatibility !== false;

  const mode: Tls13Mode = hrr
    ? 'hello-retry-request'
    : earlyData
      ? 'psk-0rtt'
      : resume
        ? 'psk-1rtt'
        : 'full-1rtt';

  const label = `tls13-${mode}`;
  const keySchedule = buildKeySchedule({
    suite,
    group,
    psk: resume,
    earlyData,
    label,
  });

  const messages: HandshakeMessage[] = [];
  const notes: HandshakeNote[] = [];

  let clock = 0;

  // -- Flight 1: ClientHello (and, in 0-RTT, the early data with it) ---------

  messages.push(
    clientHello({ host, suite, group, alpn, resume, earlyData, hrr, at: clock }),
  );

  if (compat) {
    messages.push(changeCipherSpec('client', 1, clock, 'ccs-client-1'));
  }

  if (earlyData) {
    messages.push({
      id: 'early-data',
      kind: 'application_data',
      name: '0-RTT Application Data',
      from: 'client',
      encryption: 'early-data',
      flight: 1,
      at: clock,
      bytes: input.earlyDataPayload ? input.earlyDataPayload.length + 22 : 240,
      summary:
        'The request, encrypted under client_early_traffic_secret and sent in the very first flight -- before the server has said a single word.',
      fields: [
        field(
          'content',
          input.earlyDataPayload ?? '<application data>',
          'Protected by a key derived from the PSK and the ClientHello alone. The server contributed nothing to it, which is exactly why it could be sent this early and exactly why it can be replayed.',
          false,
          rfc8446('2.3'),
        ),
        field(
          'record length',
          'visible',
          'The observer cannot read the contents, but sees that a substantial client record went out before any server response -- which is itself a signal that this was a resumed connection.',
          true,
        ),
      ],
      reference: rfc8446('2.3'),
    });
  }

  // -- HelloRetryRequest, when the group guess was wrong ---------------------

  if (hrr) {
    clock += timing.oneWayMs;
    messages.push(buildHelloRetryRequest(group, clock));
    clock += timing.oneWayMs;
    messages.push(
      clientHello({
        host,
        suite,
        group,
        alpn,
        resume,
        earlyData: false,
        hrr: false,
        at: clock,
        second: true,
      }),
    );
    notes.push({
      id: 'hrr-cost',
      title: 'A wrong guess costs a whole round trip',
      body: 'TLS 1.3 gets its single round trip by having the client guess which key exchange group the server wants and send a share for it in the first message. When the guess is wrong the server can only ask it to try again, and the handshake becomes a 2-RTT one -- no better than TLS 1.2. This is why clients guess X25519, and why offering shares for two groups (at the cost of a larger ClientHello) is a real trade-off operators make.',
      reference: rfc8446('4.1.4'),
      level: 'info',
    });
  }

  // -- Flight 2: the server's whole half of the handshake --------------------

  clock += timing.oneWayMs;
  const serverFlightAt = clock;

  messages.push(serverHello({ suite, group, resume, at: serverFlightAt, hrr }));

  if (compat && !hrr) {
    messages.push(changeCipherSpec('server', 2, serverFlightAt, 'ccs-server'));
  }

  clock += timing.serverThinkMs;

  messages.push(encryptedExtensions({ alpn, earlyData, at: clock }));

  if (!resume) {
    const chain = input.chain;
    messages.push(certificateMessage({ chain, host, at: clock }));
    messages.push(certificateVerifyMessage({ suite, at: clock }));
  }

  messages.push(finishedMessage('server', 2, clock, 'server-finished'));

  // -- Flight 3: the client finishes ----------------------------------------

  clock += timing.oneWayMs;
  const clientFinishAt = clock + timing.clientVerifyMs;

  if (earlyData) {
    messages.push({
      id: 'end-of-early-data',
      kind: 'end_of_early_data',
      name: 'EndOfEarlyData',
      from: 'client',
      encryption: 'handshake',
      flight: 3,
      at: clientFinishAt,
      bytes: 6,
      summary:
        'Marks the last 0-RTT record. Everything after it is under handshake keys, so the server knows when to switch.',
      fields: [
        field(
          '(empty)',
          'no body',
          'Its existence is the entire message. Sent under handshake keys, not early-data keys, so it cannot be forged by a replayer who only has the recorded 0-RTT flight.',
          false,
        ),
      ],
      reference: rfc8446('4.5'),
    });
  }

  messages.push(finishedMessage('client', 3, clientFinishAt, 'client-finished'));

  const applicationDataAt = earlyData ? 0 : clientFinishAt;
  const completedAt = clientFinishAt + timing.oneWayMs;

  // -- The ticket for next time ---------------------------------------------

  messages.push({
    id: 'new-session-ticket',
    kind: 'new_session_ticket',
    name: 'NewSessionTicket',
    from: 'server',
    encryption: 'application',
    flight: 4,
    at: completedAt,
    bytes: 200,
    summary:
      'A PSK for a future connection, encrypted under application keys. This is what makes the next handshake a resumption.',
    fields: [
      field(
        'ticket_lifetime',
        '7200 seconds',
        'How long the client may offer this ticket. Capped at 7 days by RFC 8446 s 4.6.1.',
        false,
      ),
      field(
        'ticket_age_add',
        placeholderHex('ticket-age-add', 4),
        'A random value the client adds to the ticket age before sending it, so an observer cannot correlate two connections by the age they report.',
        false,
        rfc8446('4.6.1'),
      ),
      field(
        'ticket_nonce',
        placeholderHex('ticket-nonce', 8),
        'Distinguishes multiple tickets from one session. The PSK is HKDF-Expand-Label(resumption_master_secret, "resumption", ticket_nonce, Hash.length), so each ticket yields a different key -- which is why a server issues several, one per future connection, rather than one reused key.',
        false,
        rfc8446('4.6.1'),
      ),
    ],
    reference: rfc8446('4.6.1'),
  });

  // -- Notes ----------------------------------------------------------------

  notes.push({
    id: 'encryption-starts',
    title: 'Only two messages are ever in the clear',
    body: 'ClientHello and ServerHello. Everything from EncryptedExtensions onward -- including the certificate that identifies the server -- travels under handshake keys. In TLS 1.2 the certificate is broadcast in plaintext to anyone on the path, so an observer learns who you are talking to from the certificate itself. Here, they get the SNI hostname from the ClientHello and nothing more.',
    reference: rfc8446('2'),
    level: 'info',
  });

  if (compat) {
    notes.push({
      id: 'middlebox-compat',
      title: 'The ChangeCipherSpec records mean nothing',
      body: 'TLS 1.3 has no ChangeCipherSpec; keys change when the key schedule says they do. These records exist only because middleboxes deployed in the TLS 1.2 era would drop a handshake that did not contain them, having been written to expect a specific message sequence. RFC 8446 s D.4 calls this "compatibility mode": a receiver must ignore them entirely. They are a monument to why protocol ossification is a real problem.',
      reference: rfc8446('D.4'),
      level: 'info',
    });
  }

  if (resume) {
    notes.push({
      id: 'psk-no-certificate',
      title: 'No certificate on a resumed handshake',
      body: 'The server proves who it is by demonstrating it holds the PSK from the earlier session, so Certificate and CertificateVerify are absent. That saves a few kilobytes and a signature. It also means the certificate validation you saw the first time is not repeated -- which is why clients bound ticket lifetimes, and why a revoked certificate can keep being resumed against until its tickets expire.',
      reference: rfc8446('2.2'),
      level: 'info',
    });
  }

  if (earlyData) {
    notes.push({
      id: 'zero-rtt-replay',
      title: '0-RTT data can be replayed, and the protocol cannot prevent it',
      body: 'The early data is encrypted under a key derived from the PSK and the ClientHello alone -- nothing the server contributed. That is what lets the client send it before hearing back, and it is also the flaw: an attacker who records the flight can send the identical bytes to the server again later, and the server will decrypt and accept them, because they are validly encrypted and it has no way to tell the copy from the original. RFC 8446 s 8 requires a server to add its own anti-replay -- single-use tickets, or a strike register of seen ClientHellos -- and s 2.3 is explicit that applications must only send requests they are willing to have executed more than once. In practice: GET, never POST.',
      reference: rfc8446('8'),
      level: 'warning',
    });
    notes.push({
      id: 'zero-rtt-forward-secrecy',
      title: '0-RTT data is not forward secret',
      body: 'Only the early data, and only it. The early traffic secret comes from the PSK, which is stored on both ends and can be stolen later; everything after the handshake completes is protected by the fresh (EC)DHE exchange and stays forward secret. This is the second of the two caveats RFC 8446 s 2.3 attaches to 0-RTT and it is the reason the mode is off by default in most stacks.',
      reference: rfc8446('2.3'),
      level: 'warning',
    });
  }

  const flights = groupIntoFlights(messages);
  const encryptionStartsAt =
    messages.find((message) => message.encryption !== 'none')?.id ?? 'server-finished';
  const roundTrips = earlyData ? 0 : hrr ? 2 : 1;

  return {
    version: 'TLS 1.3',
    mode,
    suite,
    group,
    host,
    alpn,
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
// Individual messages
// ---------------------------------------------------------------------------

function clientHello(args: {
  host: string;
  suite: CipherSuite;
  group: NamedGroup;
  alpn: string;
  resume: boolean;
  earlyData: boolean;
  hrr: boolean;
  at: number;
  second?: boolean;
}): HandshakeMessage {
  const fields: MessageField[] = [
    field(
      'legacy_version',
      LEGACY_RECORD_VERSION,
      'Frozen at "TLS 1.2" forever. Middleboxes rejected ClientHellos advertising anything higher, so TLS 1.3 gave up on this field entirely and moved version negotiation into an extension. Protocol ossification, in one field.',
      true,
      rfc8446('4.1.2'),
    ),
    field(
      'random',
      placeholderHex('client-random', 32),
      '32 bytes of client entropy. It goes into the transcript, so it makes each session distinct -- but unlike TLS 1.2 it is not an input to the key derivation on its own.',
      true,
    ),
    field(
      'supported_versions',
      'TLS 1.3, TLS 1.2',
      'This, not legacy_version, is how TLS 1.3 is actually selected. A server that understands the extension picks from it; one that does not ignores it and falls back to legacy_version. Version negotiation that works through middleboxes by never changing the field they inspect.',
      true,
      rfc8446('4.2.1'),
    ),
    field(
      'server_name (SNI)',
      args.host,
      'The hostname, in the clear. It has to be: the server needs it to choose which certificate to present, and that decision happens before any key exists. This is the largest single thing HTTPS does not hide, and Encrypted Client Hello exists to close it.',
      true,
      { rfc: 6066, section: '3', title: 'TLS Extensions: Extension Definitions' },
    ),
    field(
      'cipher_suites',
      `${args.suite.name}, TLS_AES_256_GCM_SHA384, TLS_CHACHA20_POLY1305_SHA256`,
      'Two components each, because TLS 1.3 moved key exchange and authentication out of the suite. The whole list fits on one line, which was not true of TLS 1.2.',
      true,
      rfc8446('B.4'),
    ),
    field(
      'supported_groups',
      `${args.group}, secp256r1, secp384r1`,
      'Which (EC)DHE groups the client will accept, in preference order.',
      true,
      rfc8446('4.2.7'),
    ),
    field(
      'key_share',
      `${args.group}: ${placeholderKeyShare(`ch-${args.group}`, 32)}`,
      'The client guesses which group the server wants and sends its public share immediately. This is the single change that makes TLS 1.3 a 1-RTT protocol: when the guess is right the server can derive keys the moment it finishes reading this message. A wrong guess costs a HelloRetryRequest and a full extra round trip.',
      true,
      rfc8446('4.2.8'),
    ),
    field(
      'signature_algorithms',
      'ecdsa_secp256r1_sha256, rsa_pss_rsae_sha256',
      'Which signatures the client will accept in CertificateVerify. In TLS 1.2 this was bundled into the cipher suite name; here it is negotiated separately.',
      true,
      rfc8446('4.2.3'),
    ),
    field(
      'application_layer_protocol_negotiation',
      `${args.alpn}, http/1.1`,
      'Which application protocol to run once the tunnel is up. Sent in the clear here; the server answer comes back inside EncryptedExtensions, so an observer sees what was offered but not what was chosen.',
      true,
      { rfc: 7301, title: 'TLS Application-Layer Protocol Negotiation Extension' },
    ),
  ];

  if (args.resume) {
    fields.push(
      field(
        'pre_shared_key',
        'identity = <ticket from the previous session>, binder = <placeholder>',
        'The ticket identity, plus a binder: a MAC over the ClientHello proving the client really holds the PSK rather than having copied a ticket from somewhere. RFC 8446 s 4.2.11 requires this extension to be last in the ClientHello, because the binder is computed over everything before it.',
        true,
        rfc8446('4.2.11'),
      ),
    );
  }

  if (args.earlyData) {
    fields.push(
      field(
        'early_data',
        '(empty)',
        'Announces that 0-RTT application data follows in this same flight. Its presence is the entire content.',
        true,
        rfc8446('4.2.10'),
      ),
    );
  }

  return {
    id: args.second ? 'client-hello-2' : 'client-hello',
    kind: 'client_hello',
    name: args.second ? 'ClientHello (second)' : 'ClientHello',
    from: 'client',
    encryption: 'none',
    flight: args.second ? 3 : 1,
    at: args.at,
    bytes: args.resume ? 620 : 512,
    summary: args.second
      ? 'Sent again with a key share for the group the server asked for.'
      : 'Everything the client can do, plus a guessed key share so the server can derive keys immediately.',
    fields,
    reference: rfc8446('4.1.2'),
  };
}

function serverHello(args: {
  suite: CipherSuite;
  group: NamedGroup;
  resume: boolean;
  at: number;
  hrr: boolean;
}): HandshakeMessage {
  const fields: MessageField[] = [
    field(
      'legacy_version',
      LEGACY_RECORD_VERSION,
      'Also frozen. The real answer is in supported_versions.',
      true,
      rfc8446('4.1.3'),
    ),
    field(
      'random',
      placeholderHex('server-random', 32),
      'The last 8 bytes are load-bearing: a TLS 1.3-capable server that ends up negotiating TLS 1.2 writes the fixed "DOWNGRD" sentinel here, so a 1.3-capable client can detect that something stripped its version offer.',
      true,
      rfc8446('4.1.3'),
    ),
    field(
      'supported_versions',
      'TLS 1.3',
      'The actual negotiated version. Covered by the server signature over the transcript, so it cannot be altered in flight.',
      true,
      rfc8446('4.2.1'),
    ),
    field(
      'cipher_suite',
      args.suite.name,
      'The server chooses, from the client list, in the server preference order -- so an operator can retire a weak suite without waiting for clients.',
      true,
    ),
    field(
      'key_share',
      `${args.group}: ${placeholderKeyShare(`sh-${args.group}`, 32)}`,
      'The server public share. The moment this is sent, both sides can compute the shared secret and the handshake keys -- which is why the very next message is already encrypted.',
      true,
      rfc8446('4.2.8'),
    ),
  ];

  if (args.resume) {
    fields.push(
      field(
        'pre_shared_key',
        'selected_identity = 0',
        'Which of the offered tickets the server accepted. Its presence means resumption succeeded and no certificate will follow.',
        true,
        rfc8446('4.2.11'),
      ),
    );
  }

  return {
    id: 'server-hello',
    kind: 'server_hello',
    name: 'ServerHello',
    from: 'server',
    encryption: 'none',
    flight: 2,
    at: args.at,
    bytes: 128,
    summary:
      'The last message in the clear. Names the suite and returns the key share; everything after this is encrypted.',
    fields,
    reference: rfc8446('4.1.3'),
  };
}

function encryptedExtensions(args: {
  alpn: string;
  earlyData: boolean;
  at: number;
}): HandshakeMessage {
  const fields: MessageField[] = [
    field(
      'application_layer_protocol_negotiation',
      args.alpn,
      'The chosen protocol. In TLS 1.2 this answer is in the cleartext ServerHello, so an observer knows whether you are speaking HTTP/2 before you send anything. Here it is already encrypted.',
      false,
      { rfc: 7301, title: 'TLS Application-Layer Protocol Negotiation Extension' },
    ),
    field(
      'server_name',
      '(acknowledged, empty)',
      'An empty acknowledgement that the SNI was understood. The hostname itself was already sent in the clear and cannot be un-sent.',
      false,
      rfc8446('4.3.1'),
    ),
  ];

  if (args.earlyData) {
    fields.push(
      field(
        'early_data',
        '(empty)',
        'The server accepting the 0-RTT data. Its absence would mean the server rejected it and the client must resend everything under handshake keys -- which is why 0-RTT is a latency optimisation and never a guarantee.',
        false,
        rfc8446('4.2.10'),
      ),
    );
  }

  return {
    id: 'encrypted-extensions',
    kind: 'encrypted_extensions',
    name: 'EncryptedExtensions',
    from: 'server',
    encryption: 'handshake',
    flight: 2,
    at: args.at,
    bytes: 30,
    summary:
      'The first encrypted message. Carries every negotiated extension that is not needed to establish keys -- so all of it can be, and is, hidden.',
    fields,
    reference: rfc8446('4.3.1'),
  };
}

function certificateMessage(args: {
  chain?: CertificateChain;
  host: string;
  at: number;
}): HandshakeMessage {
  const presented = args.chain?.presented ?? [];
  const names = presented.map((cert) => cert.subject.commonName).join(' -> ');

  return {
    id: 'certificate',
    kind: 'certificate',
    name: 'Certificate',
    from: 'server',
    encryption: 'handshake',
    flight: 2,
    at: args.at,
    bytes: 1_400 + presented.length * 900,
    summary: `The certificate chain: ${names || '(none supplied)'}. Encrypted, unlike in TLS 1.2.`,
    fields: [
      field(
        'certificate_list',
        names || '(empty)',
        'Leaf first, then intermediates. The root is deliberately not included -- or rather, it may be, and the client ignores it and uses its own copy. Trusting a root sent by the server would let anyone append a self-signed certificate and vouch for themselves.',
        false,
        rfc8446('4.4.2'),
      ),
      field(
        'certificate_request_context',
        '(empty)',
        'Empty in a server Certificate. Non-empty only when this is a client certificate answering a CertificateRequest.',
        false,
        rfc8446('4.4.2'),
      ),
      field(
        'status_request (OCSP stapling)',
        'a signed OCSP response for the leaf',
        'The revocation status, stapled as an extension on the leaf entry. This is what lets a client check revocation without a round trip to the CA, and without telling the CA which sites it visits.',
        false,
        { rfc: 6066, section: '8', title: 'TLS Extensions: Extension Definitions' },
      ),
      field(
        'record length',
        'visible',
        'An observer cannot read the certificate but can see roughly how big it is -- and certificate sizes vary enough between sites to be a weak fingerprint on their own.',
        true,
      ),
    ],
    reference: rfc8446('4.4.2'),
  };
}

function certificateVerifyMessage(args: {
  suite: CipherSuite;
  at: number;
}): HandshakeMessage {
  return {
    id: 'certificate-verify',
    kind: 'certificate_verify',
    name: 'CertificateVerify',
    from: 'server',
    encryption: 'handshake',
    flight: 2,
    at: args.at,
    bytes: 264,
    summary:
      'Proof the server holds the private key for the certificate it just sent. Without this, anyone could replay a certificate they copied.',
    fields: [
      field(
        'algorithm',
        'rsa_pss_rsae_sha256',
        'Chosen from the client signature_algorithms list.',
        false,
        rfc8446('4.2.3'),
      ),
      field(
        'signature',
        'over: 64 spaces || "TLS 1.3, server CertificateVerify" || 0x00 || Transcript-Hash',
        'The context string is not decoration. Prefixing 64 space characters and a role label means a signature made as a server can never be replayed as a client signature, or as a signature over some other protocol that also signs hashes with the same key. The transcript hash covers every handshake byte so far, so this one signature authenticates the entire conversation -- including the cipher suite and version, which is what makes downgrade attacks fail.',
        false,
        rfc8446('4.4.3'),
      ),
    ],
    reference: rfc8446('4.4.3'),
  };
}

function finishedMessage(
  from: 'client' | 'server',
  flight: number,
  at: number,
  id: string,
): HandshakeMessage {
  return {
    id,
    kind: 'finished',
    name: 'Finished',
    from,
    encryption: 'handshake',
    flight,
    at,
    bytes: 36,
    summary:
      from === 'server'
        ? 'A MAC over the whole transcript. Once the client verifies it, the handshake is authenticated end to end.'
        : 'The client half of the same proof. After this both sides switch to application keys.',
    fields: [
      field(
        'verify_data',
        'HMAC(finished_key, Transcript-Hash(ClientHello..previous message))',
        'finished_key is HKDF-Expand-Label(base_key, "finished", "", Hash.length) -- a key used for nothing else. The MAC covers every handshake byte, so if an attacker altered one bit of any earlier message the two sides compute different values and the handshake fails. This is what makes the whole handshake tamper-evident rather than needing a separate rule per attack.',
        false,
        rfc8446('4.4.4'),
      ),
    ],
    reference: rfc8446('4.4.4'),
  };
}

function changeCipherSpec(
  from: 'client' | 'server',
  flight: number,
  at: number,
  id: string,
): HandshakeMessage {
  return {
    id,
    kind: 'change_cipher_spec',
    name: 'ChangeCipherSpec',
    from,
    encryption: 'none',
    flight,
    at,
    bytes: 6,
    optional: true,
    summary:
      'Means nothing. Sent only so middleboxes see a message sequence they recognise.',
    fields: [
      field(
        'value',
        '0x01',
        'TLS 1.3 has no ChangeCipherSpec -- keys change when the key schedule says so. This record exists purely because middleboxes written for TLS 1.2 drop handshakes that lack it. A receiver must ignore it (RFC 8446 s D.4, "compatibility mode").',
        true,
        rfc8446('D.4'),
      ),
    ],
    reference: rfc8446('D.4'),
  };
}

// ---------------------------------------------------------------------------
// Flights
// ---------------------------------------------------------------------------

const FLIGHT_SUMMARIES: Readonly<Record<number, string>> = {
  1: 'Client opening: capabilities, the SNI hostname, and a guessed key share.',
  2: 'The server answers with everything at once -- and everything after ServerHello is already encrypted.',
  3: 'The client verifies the chain and finishes. It can attach its request to this same flight.',
  4: 'Post-handshake: a ticket for next time.',
};

/** Group messages into flights: consecutive messages travelling the same way. */
export function groupIntoFlights(
  messages: readonly HandshakeMessage[],
): readonly Flight[] {
  const byNumber = new Map<number, HandshakeMessage[]>();
  for (const message of messages) {
    const bucket = byNumber.get(message.flight);
    if (bucket) bucket.push(message);
    else byNumber.set(message.flight, [message]);
  }

  return [...byNumber.entries()]
    .sort(([a], [b]) => a - b)
    .map(([number, group]) => ({
      number,
      from: group[0].from,
      at: Math.min(...group.map((message) => message.at)),
      messageIds: group.map((message) => message.id),
      summary: FLIGHT_SUMMARIES[number] ?? '',
    }));
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Messages an observer can read in full. */
export function cleartextMessages(
  handshake: Tls13Handshake,
): readonly HandshakeMessage[] {
  return handshake.messages.filter((message) => message.encryption === 'none');
}

/** Look up a message by id. */
export function messageById(
  handshake: Tls13Handshake,
  id: string,
): HandshakeMessage | undefined {
  return handshake.messages.find((message) => message.id === id);
}

/** Every field an observer can read, across the whole handshake. */
export function observableFields(handshake: Tls13Handshake): readonly MessageField[] {
  return handshake.messages.flatMap((message) =>
    message.fields.filter((entry) => entry.visibleToObserver),
  );
}
