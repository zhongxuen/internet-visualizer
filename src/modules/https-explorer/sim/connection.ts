/**
 * Running a connection -- turning a declared scenario into something that can be drawn.
 *
 * The other seven files in `sim/` each answer one question and answer it as data.
 * `cipher.ts` says what a suite name means, `certificates.ts` whether a chain proves
 * anything, `keyschedule.ts` where the keys come from, `records.ts` what goes on the
 * wire, `handshake13.ts` and `handshake12.ts` what is said and when. None of them knows
 * that anything will ever be *shown*. This file is the one-way bridge from all of them to
 * the `SimResult` the visualization layer consumes -- one-way on purpose, because the
 * rule the project is arranged around is that networking logic never learns about
 * rendering.
 *
 * So the split is:
 *
 * - **the other `sim/*.ts`** decide what TLS does.
 * - **this file** decides what a learner sees while it happens: which chapter of the
 *   story they are in, which machine lights up, which note is pinned to it, and which RFC
 *   section that note cites.
 * - **the seven scenario files** decide only *what connection takes place* -- a screenful
 *   of data each, and no logic at all.
 *
 * ## Three nodes, and the third one is the point
 *
 * Every run draws `client -- observer -- server`, and the observer is not decoration. It
 * is a passive machine on the path -- an ISP router, a cafe access point, a national tap
 * -- that receives every byte in both directions and is never addressed by either end.
 * Modelling it as a real node on two real links is what lets the encryption overlay be
 * *derived* rather than asserted: the observer's view is the same record list with the
 * fields TLS actually conceals removed, so the overlay cannot drift from the protocol
 * model, and the honest half of the answer -- the destination address, the SNI hostname,
 * the timings, the sizes -- falls out of the model rather than being written down twice.
 *
 * ## The certificate failures abort, because that is what happens
 *
 * A client that cannot validate the chain does not carry on with a warning triangle in
 * the corner. It sends a fatal alert and tears the connection down, and no application
 * data is ever exchanged. The three `cert-*` scenarios therefore produce a strictly
 * shorter run than the good ones: the record list stops at the client's alert, and the
 * phase list has an `abort` chapter where the others have `application-data`. Which
 * single check fired is on `TlsRun.validation`, with all five verdicts kept.
 *
 * ## Where time comes from
 *
 * Every timestamp is a virtual millisecond derived from the handshake models, which in
 * turn derive theirs from {@link HandshakeTiming}. Nothing here reads a clock. The one
 * wall-clock instant in the whole module is `TlsScenario.validateAt`, which certificate
 * validity windows are compared against, and it is a written-down constant.
 *
 * ## Determinism
 *
 * No `Date.now()`, no `Math.random()`, no iteration over an unordered structure. Two runs
 * of one scenario are deep-equal, which `scenarios.test.ts` asserts by running each one
 * ten times and comparing whole. That is what makes a run linkable, screenshottable, and
 * describable in a sentence the next reader will recognise.
 *
 * > **Safety:** every host, address, and certificate here is a bundled fixture, and there
 * > is no cryptography anywhere in this module. Nothing in it can reach a network.
 */

import { summarizePhases, type SimResult } from '@/core/sim/result';
import type { RfcRef, SimEvent } from '@/core/types/events';
import type { HeaderField, PDU, ProtocolLayer } from '@/core/types/pdu';
import type { Topology } from '@/core/types/topology';

import {
  leafOf,
  primaryFailure,
  validateChain,
  type CertificateChain,
  type ChainValidation,
  type TrustStore,
} from './certificates';
import type { CipherSuite, TlsVersion } from './cipher';
import { buildTls12Handshake, type Tls12Handshake } from './handshake12';
import {
  DEFAULT_TIMING,
  DOWNGRADE_SENTINEL_TLS12,
  buildTls13Handshake,
  detectDowngrade,
  groupIntoFlights,
  type DowngradeCheck,
  type Flight,
  type HandshakeMessage,
  type HandshakeTiming,
  type Tls13Handshake,
} from './handshake13';
import type { KeySchedule, NamedGroup } from './keyschedule';
import {
  CLOSE_NOTIFY,
  alert as buildAlert,
  formatContentType,
  isProtected,
  makeRecord,
  observerFacts,
  observerView,
  recordsForPlaintext,
  totalWireBytes,
  type AlertRecord,
  type ContentType,
  type ObservedRecord,
  type ObserverFact,
  type ProtectionLevel,
  type TlsRecord,
} from './records';

// ---------------------------------------------------------------------------
// The cast
// ---------------------------------------------------------------------------

/** The browser. Holds the trust store and makes every decision that matters. */
export const CLIENT_NODE = 'client';

/**
 * The eavesdropper. On the path, addressed by nobody, and never absent.
 *
 * Drawn as a router because that is usually what it is: TLS does not assume an exotic
 * attacker, it assumes the ordinary machines that already forward your packets can read
 * them -- which every machine between you and a server can.
 */
export const OBSERVER_NODE = 'observer';

/** The origin server. A bundled fixture; nothing here opens a socket. */
export const SERVER_NODE = 'server';

/** The near half of the path: client to the machine watching it. */
export const CLIENT_LINK = 'client-observer';

/** The far half: the watcher to the server. */
export const SERVER_LINK = 'observer-server';

/**
 * The client's address.
 *
 * From `198.51.100.0/24`, one of the three ranges RFC 5737 reserves for documentation so
 * that an example address cannot be mistaken for, or routed to, a real host. Server
 * addresses come from `203.0.113.0/24` for the same reason.
 */
export const CLIENT_IP = '198.51.100.20';

/** The observer's own address, which never appears in any packet it forwards. */
export const OBSERVER_IP = '198.51.100.1';

/** An ephemeral source port, fixed so two runs produce identical packets. */
export const CLIENT_PORT = 49_152;

/** Where HTTPS lives, and the second thing an observer learns after the address. */
export const HTTPS_PORT = 443;

/** IPv4 header bytes added to every record's wire size. */
const IPV4_HEADER_BYTES = 20;

/** TCP header bytes, no options. */
const TCP_HEADER_BYTES = 20;

/**
 * Virtual milliseconds left on the timeline after the last byte lands.
 *
 * The closing chapter needs somewhere to live: with no tail it would start and end at the
 * same instant and the stepper would land on a phase of zero duration.
 */
export const TLS_TAIL_MS = 40;

/** How long the connection idles before the client closes it. */
const CLOSE_DELAY_MS = 10;

// ---------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------

/** A section of RFC 8446, the TLS 1.3 specification. */
export function rfc8446(section: string): RfcRef {
  return {
    rfc: 8446,
    section,
    title: 'The Transport Layer Security (TLS) Protocol Version 1.3',
  };
}

/** Where SNI is defined, and why it has to travel in the clear. */
const RFC_6066_SNI: RfcRef = {
  rfc: 6066,
  section: '3',
  title: 'TLS Extensions: Extension Definitions',
};

/** The TLS 1.2 Certificate message, which is sent before any key exists. */
const RFC_5246_CERTIFICATE: RfcRef = {
  rfc: 5246,
  section: '7.4.2',
  title: 'The Transport Layer Security (TLS) Protocol Version 1.2',
};

/** What the padlock is actually a statement about. */
const RFC_9525_OUTCOME: RfcRef = {
  rfc: 9525,
  section: '6.6',
  title: 'Service Identity in TLS',
};

// ---------------------------------------------------------------------------
// What a scenario declares
// ---------------------------------------------------------------------------

/** A teaching note a scenario pins to one of its phases. */
export interface TlsScenarioNote {
  /** The phase id it belongs to. */
  readonly phase: string;
  /** What it explains: a node id. Defaults to the client, which is always present. */
  readonly target?: string;
  readonly text: string;
  readonly reference?: RfcRef;
}

/**
 * One run of the HTTPS Explorer.
 *
 * Data only. Everything derived -- the messages, the keys, the records, the validation
 * verdicts, the observer's view -- is computed by {@link runTlsScenario} from these
 * fields, so a scenario file stays a screenful of declarations that reads as prose.
 */
export interface TlsScenario {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  /** What a learner should be able to say afterwards. */
  readonly teaches: readonly string[];
  /** The version actually negotiated -- in `downgrade-blocked`, not the one offered. */
  readonly version: TlsVersion;
  /** The name the client asked for, and the name the certificate has to match. */
  readonly host: string;
  /** Label for the server node on the diagram. Defaults to {@link TlsScenario.host}. */
  readonly serverLabel?: string;
  /** The address the connection went to. An observer reads this whatever TLS does. */
  readonly serverIp: string;
  /** Leaf first. Absent on a resumed handshake, where the ticket authenticates instead. */
  readonly chain?: CertificateChain;
  /** The roots the client shipped with. */
  readonly store: TrustStore;
  /**
   * The wall-clock instant, in epoch milliseconds, that certificate validity is judged
   * against. Written down per scenario; never `Date.now()`.
   */
  readonly validateAt: number;
  /** Cipher suite name. Defaults to the version's usual choice. */
  readonly suite?: string;
  /** The (EC)DHE group. Ignored by a static-RSA suite, which has no ephemeral share. */
  readonly group?: NamedGroup;
  /** The application protocol ALPN settles on. */
  readonly alpn?: string;
  /** Resume from a ticket rather than doing a full handshake. */
  readonly resume?: boolean;
  /** Send the request as 0-RTT early data. Requires `resume`. */
  readonly earlyData?: boolean;
  /** Model a wrong group guess, and the extra round trip it costs. */
  readonly helloRetryRequest?: boolean;
  /** Refuse to connect when revocation status is unavailable, rather than soft-failing. */
  readonly hardFailRevocation?: boolean;
  /**
   * Model an on-path attacker stripping TLS 1.3 from the ClientHello.
   *
   * The server is 1.3-capable, ends up negotiating 1.2, and writes the `DOWNGRD` sentinel
   * into the tail of its `ServerHello.random`. A client that offered 1.3 and sees the
   * sentinel knows its offer was removed, and aborts.
   */
  readonly downgradeAttack?: boolean;
  /** The HTTP request the connection exists to carry, as literal bytes. */
  readonly request: string;
  /** The response it gets back, as literal bytes. */
  readonly response: string;
  /** Padding on each application record (RFC 8446 s 5.4). Almost nobody does this. */
  readonly paddingBytes?: number;
  readonly timing?: HandshakeTiming;
  readonly notes?: readonly TlsScenarioNote[];
}

// ---------------------------------------------------------------------------
// What comes out
// ---------------------------------------------------------------------------

/** Why a connection ended early. */
export type AbortReason =
  /** A certificate check failed. Which one is on {@link TlsRun.validation}. */
  | 'certificate'
  /** The `DOWNGRD` sentinel said version negotiation had been tampered with. */
  | 'downgrade';

/** The moment a client gave up, and what it said on the way out. */
export interface ConnectionAbort {
  readonly reason: AbortReason;
  /** Virtual millisecond the alert was sent. */
  readonly at: number;
  /** The last handshake message that was allowed to happen. */
  readonly afterMessageId: string;
  readonly alert: AlertRecord;
  /** The browser error string a user would actually see, when there is one. */
  readonly browserError?: string;
  /** The interstitial, in plain language. */
  readonly userFacing?: string;
  /** One sentence naming what the client noticed. */
  readonly detail: string;
}

/** One record on the wire, with the moment it left and the chapter it belongs to. */
export interface WireRecord {
  readonly record: TlsRecord;
  /** Virtual millisecond the first byte left the sender. */
  readonly at: number;
  /** Virtual millisecond it reached the far end. */
  readonly arrivesAt: number;
  /** The phase this record belongs to. */
  readonly phase: string;
  /** The handshake message inside it, when it holds one. */
  readonly message?: HandshakeMessage;
  /** The PDU the timeline animates for it. */
  readonly pdu: PDU;
}

/** A finished run. */
export interface TlsRun {
  readonly scenario: TlsScenario;
  readonly topology: Topology;
  readonly result: SimResult;
  /** The handshake model the run was built from, untruncated. */
  readonly handshake: Tls13Handshake | Tls12Handshake;
  /** The messages that actually happened. Shorter than `handshake.messages` on an abort. */
  readonly messages: readonly HandshakeMessage[];
  readonly flights: readonly Flight[];
  readonly suite: CipherSuite;
  readonly keySchedule: KeySchedule;
  /** All five verdicts, always. Absent only when no certificate was presented. */
  readonly validation?: ChainValidation;
  /** What the client concluded from `ServerHello.random`. */
  readonly downgrade?: DowngradeCheck;
  /** Present when the connection was torn down instead of completing. */
  readonly abort?: ConnectionAbort;
  /** Every record, in the order it went on the wire. */
  readonly wire: readonly WireRecord[];
  /** The same records with everything TLS conceals removed. The observer's whole view. */
  readonly observed: readonly ObservedRecord[];
  /** What an eavesdropper learns and what it does not, the honest half first. */
  readonly observerFacts: readonly ObserverFact[];
  /** The records carrying the HTTP request. Empty on an aborted run. */
  readonly requestRecords: readonly TlsRecord[];
  /** The records carrying the HTTP response. Empty on an aborted run. */
  readonly responseRecords: readonly TlsRecord[];
  /** Total bytes the connection put on the wire, framing included. */
  readonly wireBytes: number;
}

// ---------------------------------------------------------------------------
// Where each handshake note is pinned
// ---------------------------------------------------------------------------

/**
 * Which phase each handshake note belongs to.
 *
 * The handshake models emit their notes as a flat list because they have no idea what a
 * phase is -- that is this file's business. Anything unlisted lands on the server's
 * flight, which is where most of what is surprising about a handshake happens.
 */
const NOTE_PHASE: Readonly<Record<string, string>> = {
  'encryption-starts': 'flight-2',
  'middlebox-compat': 'flight-1',
  'psk-no-certificate': 'flight-2',
  'zero-rtt-replay': 'flight-1',
  'zero-rtt-forward-secrecy': 'flight-1',
  'hrr-cost': 'flight-1',
  'tls12-abbreviated': 'flight-2',
  'tls12-plaintext-certificate': 'flight-2',
  'tls12-round-trips': 'flight-3',
  'tls12-no-forward-secrecy': 'flight-2',
  'tls12-change-cipher-spec': 'flight-3',
};

// ---------------------------------------------------------------------------
// Event ordering
// ---------------------------------------------------------------------------

/**
 * Tie-break for events at the same virtual millisecond.
 *
 * `at` alone does not order a stream in which a phase begins, a node lights up, a packet
 * is created, and the packet is sent, all at the same instant. Without a rank the sort
 * would be free to put a `transmit` before the `pdu-created` that introduces its PDU, and
 * a renderer would be asked to animate a packet it has never seen.
 */
const EVENT_RANK: Readonly<Record<SimEvent['kind'], number>> = {
  phase: 0,
  'node-state': 1,
  'pdu-created': 2,
  transmit: 3,
  'pdu-transform': 4,
  drop: 5,
  annotate: 6,
  log: 7,
};

/** Sort by time, then by rank, keeping insertion order within a tie. */
function sortEvents(events: readonly SimEvent[]): SimEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort(
      (a, b) =>
        a.event.at - b.event.at ||
        EVENT_RANK[a.event.kind] - EVENT_RANK[b.event.kind] ||
        a.index - b.index,
    )
    .map((entry) => entry.event);
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

interface PhasePlan {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly at: number;
}

/**
 * Drop any phase that would start where an earlier one already did.
 *
 * Two chapters at the same instant would make one of them zero-length, and the stepper
 * treats phases as a half-open tiling of the timeline. When it happens the later chapter
 * genuinely is part of the earlier one -- in TLS 1.3 the client's request rides the same
 * flight as its Finished -- so the fix is to fold it in and remember the alias, so a note
 * addressed to the dropped id still lands somewhere real.
 */
function resolvePhases(plans: readonly PhasePlan[]): {
  readonly phases: readonly PhasePlan[];
  readonly aliases: ReadonlyMap<string, string>;
} {
  const ordered = [...plans].sort((a, b) => a.at - b.at);
  const phases: PhasePlan[] = [];
  const aliases = new Map<string, string>();

  for (const plan of ordered) {
    const clash = phases.find((kept) => kept.at === plan.at);
    if (clash) aliases.set(plan.id, clash.id);
    else phases.push(plan);
  }

  return { phases, aliases };
}

// ---------------------------------------------------------------------------
// PDUs
// ---------------------------------------------------------------------------

function field(name: string, value: string, bits?: number, note?: string): HeaderField {
  return {
    name,
    value,
    ...(bits === undefined ? {} : { bits }),
    ...(note ? { note } : {}),
  };
}

/**
 * One TLS record, as an encapsulated PDU.
 *
 * The stack is what is genuinely on the wire, and the layers stop where the encryption
 * does. A protected record gets an IPv4 header, a TCP header, and a TLS record header --
 * and then nothing, because there is nothing more to see. The message inside is added as
 * a layer only when it really is readable, which makes the packet inspector state the
 * module's central point without a word of commentary: what is four expandable layers
 * deep in TLS 1.2 is a length and a shrug in TLS 1.3.
 */
function recordPdu(
  record: TlsRecord,
  scenario: TlsScenario,
  message: HandshakeMessage | undefined,
): PDU {
  const toServer = record.from === 'client';
  const encrypted = isProtected(record.protection);

  const network: ProtocolLayer = {
    layer: 'network',
    protocol: 'IPv4',
    fields: [
      field('Source Address', toServer ? CLIENT_IP : scenario.serverIp, 32),
      field('Destination Address', toServer ? scenario.serverIp : CLIENT_IP, 32),
      field('Protocol', '6 (TCP)', 8),
      field(
        'Total Length',
        String(IPV4_HEADER_BYTES + TCP_HEADER_BYTES + record.totalBytes),
        16,
        'Outside TLS entirely. Every byte of this header is readable by every machine on the path, which is why HTTPS cannot hide who you are talking to.',
      ),
    ],
  };

  const transport: ProtocolLayer = {
    layer: 'transport',
    protocol: 'TCP',
    fields: [
      field('Source Port', String(toServer ? CLIENT_PORT : HTTPS_PORT), 16),
      field(
        'Destination Port',
        String(toServer ? HTTPS_PORT : CLIENT_PORT),
        16,
        'Port 443 says this is HTTPS before a single TLS byte has been parsed.',
      ),
      field('Flags', 'ACK, PSH', 9),
    ],
  };

  const session: ProtocolLayer = {
    layer: 'session',
    protocol: `TLS ${scenario.version === 'TLS 1.3' ? '1.3' : '1.2'} record`,
    fields: [
      field(
        'ContentType',
        formatContentType(record.outerType),
        8,
        encrypted && record.outerType !== record.innerType
          ? 'The real type is inside the encryption: every protected TLS 1.3 record claims application_data(23) whatever it holds (RFC 8446 s 5.2).'
          : 'The header names the real type, so an observer can follow the structure of the conversation.',
      ),
      field(
        'legacy_record_version',
        record.legacyVersion,
        16,
        'Frozen at 0x0303 -- TLS 1.2 -- forever, because middleboxes drop records carrying a version they have not seen. The real version is negotiated in supported_versions.',
      ),
      field(
        'length',
        String(record.length),
        16,
        'Cleartext, always, and the main thing that survives encryption. Record lengths are what traffic analysis is made of.',
      ),
    ],
    payloadPreview: encrypted
      ? (record.ciphertext ?? `<${record.length} opaque bytes>`)
      : (record.plaintext ?? `<${record.plaintextBytes} bytes>`),
  };

  const layers: ProtocolLayer[] = [network, transport, session];

  if (!encrypted && message) {
    layers.push({
      layer: 'session',
      protocol: `TLS Handshake: ${message.name}`,
      fields: message.fields.map((entry) =>
        field(entry.name, entry.value, undefined, entry.explain),
      ),
      payloadPreview: message.summary,
    });
  } else if (!encrypted && record.plaintext !== undefined) {
    layers.push({
      layer: 'application',
      protocol: 'HTTP',
      fields: [],
      payloadPreview: record.plaintext.split('\r\n')[0],
    });
  }

  return {
    id: record.id,
    layers,
    sizeBytes: IPV4_HEADER_BYTES + TCP_HEADER_BYTES + record.totalBytes,
    summary: `${record.label} -- ${formatContentType(record.outerType)}, ${record.length} bytes`,
  };
}

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

/** Sequence numbers restart whenever the keys do, per direction (RFC 8446 s 5.3). */
class SequenceCounters {
  private readonly counts = new Map<string, number>();

  next(from: 'client' | 'server', protection: ProtectionLevel): number {
    const key = `${from}:${protection}`;
    const current = this.counts.get(key) ?? 0;
    this.counts.set(key, current + 1);
    return current;
  }
}

/** The content type a handshake message's record carries. */
function innerTypeOf(message: HandshakeMessage): ContentType {
  if (message.kind === 'change_cipher_spec') return 'change_cipher_spec';
  if (message.kind === 'application_data') return 'application_data';
  return 'handshake';
}

/**
 * When the client has the whole flight the certificate came in, and which message ended it.
 *
 * Not "the last message with the same flight number": TLS 1.2 reuses a flight number for
 * the server's ChangeCipherSpec two round trips later, and pinning validation to that
 * would have the client checking a certificate it had already answered. What the client
 * actually waits for is the end of the *burst* -- every server message from the
 * certificate up to the point it next has to speak -- which is the same thing in TLS 1.3
 * and the right thing in TLS 1.2.
 */
function certificateBurst(
  messages: readonly HandshakeMessage[],
): { readonly endsAt: number; readonly lastId: string } | undefined {
  const start = messages.findIndex((message) => message.kind === 'certificate');
  if (start === -1) return undefined;

  const rest = messages.slice(start);
  const nextClient = rest.findIndex((message) => message.from === 'client');
  const burst = (nextClient === -1 ? rest : rest.slice(0, nextClient)).filter(
    (message) => message.from === 'server',
  );
  const last = burst[burst.length - 1] ?? messages[start];

  return {
    endsAt: burst.reduce((latest, message) => Math.max(latest, message.at), last.at),
    lastId: last.id,
  };
}

/**
 * Run a scenario.
 *
 * Pure: same input, deep-equal output, every time. The only wall-clock instant involved
 * is `scenario.validateAt`, and it is supplied rather than read.
 */
export function runTlsScenario(scenario: TlsScenario): TlsRun {
  const timing = scenario.timing ?? DEFAULT_TIMING;
  const oneWay = timing.oneWayMs;
  const half = oneWay / 2;

  // --- The handshake -------------------------------------------------------

  const handshake: Tls13Handshake | Tls12Handshake =
    scenario.version === 'TLS 1.3'
      ? buildTls13Handshake({
          host: scenario.host,
          chain: scenario.chain,
          suite: scenario.suite,
          group: scenario.group,
          alpn: scenario.alpn,
          resume: scenario.resume,
          earlyData: scenario.earlyData,
          earlyDataPayload: scenario.earlyData ? scenario.request : undefined,
          helloRetryRequest: scenario.helloRetryRequest,
          timing,
        })
      : buildTls12Handshake({
          host: scenario.host,
          chain: scenario.chain,
          suite: scenario.suite,
          group: scenario.group,
          resume: scenario.resume,
          timing,
        });

  const suite = handshake.suite;
  const earlyData =
    scenario.version === 'TLS 1.3' &&
    scenario.resume === true &&
    scenario.earlyData === true;

  // --- The certificate, and the downgrade sentinel -------------------------

  const validation = scenario.chain
    ? validateChain(scenario.chain, {
        host: scenario.host,
        now: scenario.validateAt,
        store: scenario.store,
        hardFailRevocation: scenario.hardFailRevocation,
      })
    : undefined;

  const downgrade = scenario.downgradeAttack
    ? detectDowngrade(DOWNGRADE_SENTINEL_TLS12, true, scenario.version)
    : undefined;

  // --- Where the connection stops ------------------------------------------

  const abort = planAbort(handshake.messages, { validation, downgrade, timing });
  const cutoff = abort
    ? handshake.messages.findIndex((message) => message.id === abort.afterMessageId)
    : -1;
  const messages =
    abort && cutoff >= 0
      ? handshake.messages.slice(0, cutoff + 1)
      : [...handshake.messages];
  const flights = groupIntoFlights(messages);

  // --- The instants the application data hangs off -------------------------

  const serverHandshakeEnd = messages
    .filter(
      (message) => message.from === 'server' && message.kind !== 'new_session_ticket',
    )
    .reduce((latest, message) => Math.max(latest, message.at), 0);

  const burst = certificateBurst(messages);
  const validatedAt = burst ? burst.endsAt + oneWay : undefined;

  const requestAt = earlyData ? 0 : handshake.applicationDataAt;
  const responseAt =
    Math.max(requestAt + oneWay, serverHandshakeEnd) + timing.serverThinkMs;

  // The client does not close a connection it has not finished opening. On a 0-RTT run
  // the response can arrive before the client's own Finished, so the shutdown has to wait
  // for the later of the two -- and for the post-handshake ticket, which comes after both.
  const lastMessageAt = messages.reduce(
    (latest, message) => Math.max(latest, message.at),
    0,
  );
  const closeAt =
    Math.max(responseAt + oneWay, handshake.completedAt, lastMessageAt) + CLOSE_DELAY_MS;

  // --- Phases --------------------------------------------------------------

  const plans: PhasePlan[] = flights.map((flight) => ({
    id: `flight-${flight.number}`,
    title: `Flight ${flight.number} -- ${flight.from}`,
    description: flight.summary,
    at: flight.at,
  }));

  if (validation && validatedAt !== undefined) {
    plans.push({
      id: 'certificate-validation',
      title: 'The client checks the certificate',
      description: validation.trusted
        ? 'All five checks pass: the chain reaches a root the client shipped with, the dates are current, a SAN entry matches the name that was asked for, the stapled OCSP response says good, and nothing claims powers it should not have.'
        : `${
            validation.failures.length === 1
              ? 'One check fails'
              : `${validation.failures.length} checks fail`
          }, and the connection ends here. The other verdicts are kept, so it is obvious which promise broke.`,
      at: validatedAt,
    });
  }

  if (abort) {
    plans.push({
      id: 'abort',
      title: 'The client tears the connection down',
      description: `${abort.detail} No application data is ever sent.`,
      at: abort.at,
    });
  } else {
    plans.push({
      id: 'application-data',
      title: 'Application data',
      description: earlyData
        ? 'The server answers a request that arrived before it had said anything at all. Both directions are opaque to anyone watching: same records, same lengths, no readable content.'
        : 'The HTTP exchange the connection existed for, inside application-keyed records. This is the only part of the conversation HTTPS actually hides.',
      at: responseAt,
    });
    plans.push({
      id: 'close',
      title: 'Orderly shutdown',
      description:
        'close_notify, in both directions. Without it a receiver cannot tell a finished response from a connection an attacker cut short.',
      at: closeAt,
    });
  }

  const { phases, aliases } = resolvePhases(plans);
  const phaseAt = new Map(phases.map((phase) => [phase.id, phase.at]));
  const resolvePhaseId = (id: string): string => aliases.get(id) ?? id;

  /**
   * The chapter a record belongs to is the one that was current when it was sent.
   *
   * Derived from the clock rather than from the message's flight number, because the two
   * disagree: TLS 1.2 labels the server's second ChangeCipherSpec as flight 2, which is
   * where it belongs in the protocol's own accounting and two round trips away from where
   * it appears on a timeline.
   */
  const phaseFor = (at: number): string => {
    let current = phases[0]?.id ?? 'flight-1';
    for (const phase of phases) {
      if (phase.at <= at) current = phase.id;
      else break;
    }
    return current;
  };

  // --- Records -------------------------------------------------------------

  const sequences = new SequenceCounters();
  const wire: WireRecord[] = [];

  const push = (record: TlsRecord, at: number, message?: HandshakeMessage): void => {
    wire.push({
      record,
      at,
      arrivesAt: at + oneWay,
      phase: phaseFor(at),
      message,
      pdu: recordPdu(record, scenario, message),
    });
  };

  for (const message of messages) {
    const protection = message.encryption as ProtectionLevel;
    const innerType = innerTypeOf(message);
    push(
      makeRecord({
        id: `rec-${message.id}`,
        from: message.from,
        innerType,
        protection,
        label: message.name,
        version: scenario.version,
        suite,
        sequenceNumber: sequences.next(message.from, protection),
        // The 0-RTT message is the request, so its record carries the real bytes.
        ...(innerType === 'application_data'
          ? { plaintext: scenario.request, paddingBytes: scenario.paddingBytes }
          : { plaintextBytes: message.bytes }),
      }),
      message.at,
      message,
    );
  }

  let requestRecords: readonly TlsRecord[] = [];
  let responseRecords: readonly TlsRecord[] = [];

  if (abort) {
    const protection = alertProtection(scenario.version, abort.reason);
    push(
      makeRecord({
        id: 'rec-alert',
        from: 'client',
        innerType: 'alert',
        protection,
        label: `Alert: ${abort.alert.description}`,
        version: scenario.version,
        suite,
        sequenceNumber: sequences.next('client', protection),
        plaintextBytes: 2,
      }),
      abort.at,
    );
  } else {
    if (earlyData) {
      // Already on the wire as the early-data message; wrapping the same bytes again
      // would put the request on the timeline twice.
      requestRecords = wire
        .filter((entry) => entry.record.innerType === 'application_data')
        .map((entry) => entry.record);
    } else {
      requestRecords = recordsForPlaintext(scenario.request, {
        from: 'client',
        version: scenario.version,
        suite,
        idPrefix: 'req',
        label: 'HTTP request',
        startSequence: sequences.next('client', 'application'),
        paddingBytes: scenario.paddingBytes,
      });
      for (const record of requestRecords) push(record, requestAt);
    }

    responseRecords = recordsForPlaintext(scenario.response, {
      from: 'server',
      version: scenario.version,
      suite,
      idPrefix: 'resp',
      label: 'HTTP response',
      startSequence: sequences.next('server', 'application'),
      paddingBytes: scenario.paddingBytes,
    });
    for (const record of responseRecords) push(record, responseAt);

    for (const [index, from] of (['client', 'server'] as const).entries()) {
      push(
        makeRecord({
          id: `rec-close-${from}`,
          from,
          innerType: 'alert',
          protection: 'application',
          label: 'Alert: close_notify',
          version: scenario.version,
          suite,
          sequenceNumber: sequences.next(from, 'application'),
          plaintextBytes: 2,
        }),
        closeAt + index * oneWay,
      );
    }
  }

  wire.sort(
    (a, b) =>
      a.at - b.at ||
      (a.record.from === b.record.from ? 0 : a.record.from === 'client' ? -1 : 1),
  );

  // --- Events --------------------------------------------------------------

  const events: SimEvent[] = [];
  const pdus: Record<string, PDU> = {};

  for (const phase of phases) {
    events.push({
      kind: 'phase',
      at: phase.at,
      id: phase.id,
      title: phase.title,
      description: phase.description,
    });
  }

  for (const entry of wire) {
    const sender = entry.record.from === 'client' ? CLIENT_NODE : SERVER_NODE;
    const receiver = entry.record.from === 'client' ? SERVER_NODE : CLIENT_NODE;
    const nearLink = entry.record.from === 'client' ? CLIENT_LINK : SERVER_LINK;
    const farLink = entry.record.from === 'client' ? SERVER_LINK : CLIENT_LINK;
    pdus[entry.pdu.id] = entry.pdu;

    events.push({ kind: 'pdu-created', at: entry.at, pdu: entry.pdu, atNode: sender });
    events.push({
      kind: 'transmit',
      at: entry.at,
      pduId: entry.pdu.id,
      from: sender,
      to: OBSERVER_NODE,
      durationMs: half,
      linkId: nearLink,
    });
    events.push({
      kind: 'transmit',
      at: entry.at + half,
      pduId: entry.pdu.id,
      from: OBSERVER_NODE,
      to: receiver,
      durationMs: half,
      linkId: farLink,
    });
    events.push({
      kind: 'log',
      at: entry.at,
      level: 'info',
      text: `${entry.record.from === 'client' ? 'client -> server' : 'server -> client'}  ${
        entry.record.label
      } (${entry.record.totalBytes} bytes on the wire, ${
        isProtected(entry.record.protection)
          ? `${entry.record.protection} keys`
          : 'plaintext'
      })`,
    });
  }

  events.push(
    ...activityEvents({
      timing,
      oneWay,
      abort,
      responseAt,
      closeAt,
      validatedAt,
    }),
  );
  events.push(
    ...annotationEvents({
      scenario,
      handshake,
      validation,
      downgrade,
      abort,
      wire,
      phaseAt,
      resolvePhaseId,
    }),
  );

  const lastArrival = wire.reduce(
    (latest, entry) => Math.max(latest, entry.arrivesAt),
    0,
  );
  const durationMs = lastArrival + TLS_TAIL_MS;

  const sorted = sortEvents(events);
  const result: SimResult = {
    events: sorted,
    phases: summarizePhases(sorted, durationMs),
    durationMs,
    pdus,
  };

  const records = wire.map((entry) => entry.record);

  return {
    scenario,
    topology: topologyFor(scenario, timing),
    result,
    handshake,
    messages,
    flights,
    suite,
    keySchedule: handshake.keySchedule,
    validation,
    downgrade,
    abort,
    wire,
    observed: records.map(observerView),
    observerFacts: observerFacts(records, {
      version: scenario.version,
      serverIp: scenario.serverIp,
      sni: scenario.host,
      alpn: scenario.alpn ?? 'h2',
      suite: suite.name,
    }),
    requestRecords,
    responseRecords,
    wireBytes: totalWireBytes(records),
  };
}

// ---------------------------------------------------------------------------
// Pieces of the runner
// ---------------------------------------------------------------------------

/**
 * Which keys the abort alert is sent under.
 *
 * A downgrade is spotted on reading ServerHello, before any key exists, so that alert
 * goes out in the clear. A certificate failure is spotted a flight later, by which point
 * TLS 1.3 has handshake keys and the alert is encrypted like everything else -- so an
 * observer sees a short record and cannot tell a rejection from a Finished. In TLS 1.2
 * the handshake is still in the clear at that point, and the alert is readable.
 */
function alertProtection(version: TlsVersion, reason: AbortReason): ProtectionLevel {
  if (reason === 'downgrade') return 'none';
  return version === 'TLS 1.3' ? 'handshake' : 'none';
}

/** Decide whether, and where, the client gives up. */
function planAbort(
  messages: readonly HandshakeMessage[],
  context: {
    readonly validation?: ChainValidation;
    readonly downgrade?: DowngradeCheck;
    readonly timing: HandshakeTiming;
  },
): ConnectionAbort | undefined {
  const { validation, downgrade, timing } = context;

  // A downgrade is checked first because it is *caught* first: the sentinel is in
  // ServerHello, a whole flight before the certificate arrives.
  if (downgrade?.detected && downgrade.alert) {
    const serverHello = messages.find((message) => message.id === 'server-hello');
    if (serverHello) {
      return {
        reason: 'downgrade',
        at: serverHello.at + timing.oneWayMs,
        afterMessageId: serverHello.id,
        alert: buildAlert(downgrade.alert.name, downgrade.alert.code, downgrade.detail),
        detail: downgrade.detail,
        userFacing:
          'The connection was tampered with in transit: something removed this client’s offer of the newer protocol version, to force an older one.',
      };
    }
  }

  if (!validation || validation.trusted) return undefined;

  const failure = primaryFailure(validation);
  const burst = certificateBurst(messages);
  if (!failure?.alert || !burst) return undefined;

  // The client validates once it holds the server's whole flight, and answers with an
  // alert instead of its own Finished.
  return {
    reason: 'certificate',
    at: burst.endsAt + timing.oneWayMs + timing.clientVerifyMs,
    afterMessageId: burst.lastId,
    alert: buildAlert(failure.alert.name, failure.alert.code, failure.detail),
    browserError: failure.browserError,
    userFacing: failure.userFacing,
    detail: failure.detail,
  };
}

/** Node highlighting: who is busy, who has failed, and when. */
function activityEvents(context: {
  readonly timing: HandshakeTiming;
  readonly oneWay: number;
  readonly abort?: ConnectionAbort;
  readonly responseAt: number;
  readonly closeAt: number;
  /** When the client had the certificate flight in hand, or absent if none was sent. */
  readonly validatedAt?: number;
}): SimEvent[] {
  const { timing, oneWay, abort, responseAt, closeAt, validatedAt } = context;
  const events: SimEvent[] = [];

  events.push({ kind: 'node-state', at: 0, nodeId: CLIENT_NODE, state: 'active' });
  events.push({
    kind: 'node-state',
    at: 0,
    nodeId: OBSERVER_NODE,
    state: 'processing',
    note: 'reading every byte in both directions',
  });

  // The server assembling its flight: a certificate looked up by SNI, and a signature.
  events.push({
    kind: 'node-state',
    at: oneWay,
    nodeId: SERVER_NODE,
    state: 'processing',
    note: 'choosing a certificate by SNI and signing the transcript',
  });
  events.push({
    kind: 'node-state',
    at: oneWay + timing.serverThinkMs,
    nodeId: SERVER_NODE,
    state: 'active',
  });

  if (validatedAt !== undefined) {
    events.push({
      kind: 'node-state',
      at: validatedAt,
      nodeId: CLIENT_NODE,
      state: 'processing',
      note: 'validating the certificate chain',
    });
  }

  if (abort) {
    events.push({
      kind: 'node-state',
      at: abort.at,
      nodeId: CLIENT_NODE,
      state: 'error',
    });
    events.push({
      kind: 'node-state',
      at: abort.at + oneWay,
      nodeId: SERVER_NODE,
      state: 'error',
      note: 'connection torn down by the client',
    });
    return events;
  }

  if (validatedAt !== undefined) {
    events.push({
      kind: 'node-state',
      at: validatedAt + timing.clientVerifyMs,
      nodeId: CLIENT_NODE,
      state: 'active',
    });
  }
  events.push({
    kind: 'node-state',
    at: responseAt,
    nodeId: SERVER_NODE,
    state: 'active',
  });
  events.push({
    kind: 'node-state',
    at: closeAt + oneWay,
    nodeId: CLIENT_NODE,
    state: 'idle',
  });
  events.push({
    kind: 'node-state',
    at: closeAt + oneWay,
    nodeId: SERVER_NODE,
    state: 'idle',
  });
  events.push({
    kind: 'node-state',
    at: closeAt + oneWay,
    nodeId: OBSERVER_NODE,
    state: 'idle',
  });

  return events;
}

/** Every teaching note: from the handshake model, the validation, and the scenario. */
function annotationEvents(context: {
  readonly scenario: TlsScenario;
  readonly handshake: Tls13Handshake | Tls12Handshake;
  readonly validation?: ChainValidation;
  readonly downgrade?: DowngradeCheck;
  readonly abort?: ConnectionAbort;
  readonly wire: readonly WireRecord[];
  readonly phaseAt: ReadonlyMap<string, number>;
  readonly resolvePhaseId: (id: string) => string;
}): SimEvent[] {
  const {
    scenario,
    handshake,
    validation,
    downgrade,
    abort,
    wire,
    phaseAt,
    resolvePhaseId,
  } = context;
  const events: SimEvent[] = [];

  const first = wire.length > 0 ? wire[0].at : 0;
  const timeOf = (phase: string): number => phaseAt.get(resolvePhaseId(phase)) ?? first;

  const annotate = (
    phase: string,
    targetId: string,
    text: string,
    reference?: RfcRef,
  ): void => {
    events.push({
      kind: 'annotate',
      at: timeOf(phase),
      targetId,
      text,
      ...(reference ? { reference } : {}),
    });
  };

  // --- What the observer learns, chapter by chapter ------------------------

  annotate(
    'flight-1',
    OBSERVER_NODE,
    `The first message is in the clear, and has to be: the server cannot choose a certificate until it knows which site was asked for. This observer already has the destination address ${scenario.serverIp}, the port, and the SNI hostname "${scenario.host}" -- all of it before a single key exists.`,
    RFC_6066_SNI,
  );

  if (scenario.version === 'TLS 1.3') {
    annotate(
      'flight-2',
      OBSERVER_NODE,
      'From the record after ServerHello onward the observer sees only application_data(23) records of some length. The extensions, the certificate, the Finished -- all under handshake keys, and all stamped with the same content type, so a rejection and a success look identical from here.',
      rfc8446('5.2'),
    );
  } else {
    annotate(
      'flight-2',
      OBSERVER_NODE,
      'The whole certificate chain has just gone past in plaintext: subject, every SAN, issuer, validity window, public key. An observer who somehow missed the SNI has now learned exactly which site this connection is to, and a passive collector can map who talks to whom without decrypting anything.',
      RFC_5246_CERTIFICATE,
    );
  }

  if (!abort) {
    annotate(
      'application-data',
      OBSERVER_NODE,
      'The request and the response are in here, and this is the part HTTPS genuinely hides: the method, the path, the headers, the cookies, the body. What survives is the shape -- when each record was sent, how big it was, and which way it went. That is enough to tell a page load from a video stream, and against a known set of candidate pages it is often enough to tell which page.',
      rfc8446('5.4'),
    );
  }

  // --- The handshake model's own notes -------------------------------------

  for (const note of handshake.notes) {
    annotate(
      NOTE_PHASE[note.id] ?? 'flight-2',
      CLIENT_NODE,
      `${note.title}. ${note.body}`,
      note.reference,
    );
  }

  // --- Certificate verdicts ------------------------------------------------

  if (validation) {
    for (const step of validation.steps) {
      annotate(
        'certificate-validation',
        step.passed ? SERVER_NODE : CLIENT_NODE,
        `${step.passed ? 'PASS' : 'FAIL'}  ${step.title}. ${step.detail}`,
        step.reference,
      );
    }

    const leaf = leafOf(scenario.chain ?? { presented: [] });
    if (leaf && validation.trusted) {
      annotate(
        'certificate-validation',
        SERVER_NODE,
        `All five checks passed for ${leaf.subject.commonName}. The padlock means exactly this and nothing more: the name matched a certificate some trusted CA signed. It is not a statement about who runs the site, or about what they do with what you send them.`,
        RFC_9525_OUTCOME,
      );
    }
  }

  // --- How it ended --------------------------------------------------------

  if (downgrade) {
    annotate('flight-2', CLIENT_NODE, downgrade.detail, downgrade.reference);
  }

  if (abort) {
    annotate(
      'abort',
      CLIENT_NODE,
      `${abort.alert.description}(${abort.alert.code}), fatal. ${abort.alert.explain}${
        abort.browserError ? ` The browser shows ${abort.browserError}.` : ''
      }`,
      rfc8446('6.2'),
    );
    if (abort.userFacing) {
      annotate('abort', CLIENT_NODE, `What the user is told: "${abort.userFacing}"`);
    }
  } else {
    annotate('close', CLIENT_NODE, CLOSE_NOTIFY.explain, rfc8446('6.1'));
  }

  // --- The scenario's own notes, last, so they read as the closing word -----

  for (const note of scenario.notes ?? []) {
    annotate(note.phase, note.target ?? CLIENT_NODE, note.text, note.reference);
  }

  return events;
}

/** Client, eavesdropper, server -- and the two halves of the path between them. */
function topologyFor(scenario: TlsScenario, timing: HandshakeTiming): Topology {
  const half = timing.oneWayMs / 2;

  return {
    nodes: [
      {
        id: CLIENT_NODE,
        kind: 'client',
        label: 'Browser',
        ipv4: CLIENT_IP,
        detail: {
          role: 'holds the trust store and makes every validation decision',
          'trust store': scenario.store.name,
          offers: scenario.version === 'TLS 1.3' ? 'TLS 1.3, TLS 1.2' : 'TLS 1.2',
        },
      },
      {
        id: OBSERVER_NODE,
        kind: 'router',
        label: 'On-path observer',
        ipv4: OBSERVER_IP,
        detail: {
          role: 'a machine on the path -- ISP router, cafe access point, national tap',
          reads: 'every byte in both directions',
          'addressed by': 'neither end; it never has to be',
        },
      },
      {
        id: SERVER_NODE,
        kind: 'server',
        label: scenario.serverLabel ?? scenario.host,
        ipv4: scenario.serverIp,
        detail: {
          role: 'simulated origin server -- bundled fixture, never contacted',
          'serves name': scenario.host,
          'negotiated version': scenario.version,
        },
      },
    ],
    links: [
      {
        id: CLIENT_LINK,
        from: CLIENT_NODE,
        to: OBSERVER_NODE,
        latencyMs: half,
        bandwidthMbps: 100,
        medium: 'wifi',
      },
      {
        id: SERVER_LINK,
        from: OBSERVER_NODE,
        to: SERVER_NODE,
        latencyMs: half,
        bandwidthMbps: 1_000,
        medium: 'fiber',
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** The records an observer can read in full -- the plaintext ones, and only those. */
export function readableRecords(run: TlsRun): readonly WireRecord[] {
  return run.wire.filter((entry) => !isProtected(entry.record.protection));
}

/** The first protected record: the moment encryption begins, as it is on the wire. */
export function encryptionBeginsAt(run: TlsRun): WireRecord | undefined {
  return run.wire.find((entry) => isProtected(entry.record.protection));
}

/** Just the things HTTPS fails to hide -- the list the overlay leads with. */
export function stillVisibleFacts(run: TlsRun): readonly ObserverFact[] {
  return run.observerFacts.filter((fact) => fact.visible);
}
