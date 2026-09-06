/**
 * Stage 5 -- the second handshake, and the one people forget about.
 *
 * `@/core/protocols/tls` builds the whole handshake: the flights, the key schedule, which
 * fields an observer can still read, and the five checks a certificate has to pass. This
 * stage runs it against this scenario's chain and puts the flights on the page-load clock.
 *
 * The thing worth watching is where this stage *ends*. It is not when the handshake is
 * complete -- it is when the client is allowed to send application data, which is earlier.
 * In TLS 1.3 the client sends its Finished and the HTTP request in the same flight, so the
 * server's own completion happens while the request is already in the air. Modelling that
 * honestly is the difference between "TLS 1.3 is one round trip" as a slogan and as
 * something visible on a timeline. In the 0-RTT case the stage's duration is literally
 * zero: the request rides in the very first packet, and the rail shows a stage that cost
 * nothing.
 *
 * ## Certificate failures end the run here
 *
 * `validateChain` returns all five verdicts, and `primaryFailure` picks the one a browser
 * would actually show -- browsers show one interstitial even when several checks fail, and
 * they show the first in validation order. The alert number and the `NET::ERR_CERT_*`
 * string both come from core, so the interstitial this stage produces says the same thing
 * the HTTPS Explorer says about the same chain.
 */

import {
  buildTls12Handshake,
  type Tls12Handshake,
} from '@/core/protocols/tls/handshake12';
import {
  buildTls13Handshake,
  groupIntoFlights,
  type Flight,
  type HandshakeMessage,
  type Tls13Handshake,
} from '@/core/protocols/tls/handshake13';
import {
  primaryFailure,
  validateChain,
  type ChainValidation,
} from '@/core/protocols/tls/certificates';
import type { HttpVersion } from '@/core/protocols/http/message';
import type { RfcRef, SimEvent } from '@/core/types/events';
import type { PDU } from '@/core/types/pdu';

import {
  BROWSER_NODE,
  linkId,
  PAGE_LOAD_EPOCH,
  requireState,
  round2,
  type Stage,
  type StageOutput,
} from '../stage';

/** How long the server spends signing and assembling its flight. */
export const SERVER_THINK_MS = 4;

/** How long the client spends walking the chain and checking the five conditions. */
export const CLIENT_VERIFY_MS = 3;

const RFC_8446: RfcRef = {
  rfc: 8446,
  section: '2',
  title: 'The Transport Layer Security (TLS) Protocol Version 1.3',
};
const RFC_8446_0RTT: RfcRef = {
  rfc: 8446,
  section: '2.3',
  title: 'The Transport Layer Security (TLS) Protocol Version 1.3',
};

/** What the TLS stage established. */
export interface TlsResult {
  readonly version: 'TLS 1.2' | 'TLS 1.3';
  /** The 1.3 handshake, when this run negotiated 1.3. */
  readonly handshake13?: Tls13Handshake;
  /** The 1.2 handshake, when this run negotiated 1.2. */
  readonly handshake12?: Tls12Handshake;
  readonly messages: readonly HandshakeMessage[];
  readonly flights: readonly Flight[];
  /** All five certificate verdicts, kept whole. */
  readonly validation: ChainValidation;
  /** Round trips paid before a request byte may be sent. 0, 1, or 2. */
  readonly roundTrips: number;
  /** Local virtual millisecond the client may send application data. */
  readonly applicationDataAt: number;
  /** Local virtual millisecond the handshake finishes for both ends. */
  readonly completedAt: number;
  /** The application protocol both ends agreed on, e.g. `h2`. */
  readonly alpn: string;
  /** The HTTP version that ALPN selected, for the stages below. */
  readonly httpVersion: HttpVersion;
  /** True when the request will ride in the first flight as early data. */
  readonly earlyData: boolean;
}

/** ALPN identifiers, and the HTTP version each one selects. */
const ALPN_VERSIONS: Readonly<Record<string, HttpVersion>> = {
  h2: 'HTTP/2',
  h3: 'HTTP/3',
  'http/1.1': 'HTTP/1.1',
};

/** One flight of handshake messages, as a single thing on the wire. */
function flightPdu(
  id: string,
  flight: Flight,
  messages: readonly HandshakeMessage[],
): PDU {
  const inFlight = messages.filter((message) => flight.messageIds.includes(message.id));
  const bytes = inFlight.reduce((total, message) => total + message.bytes, 0);
  const encrypted = inFlight.filter((message) => message.encryption !== 'none');

  return {
    id,
    layers: [
      {
        layer: 'session',
        protocol: 'TLS',
        fields: [
          {
            name: 'Content Type',
            value: encrypted.length > 0 ? 'application_data (23)' : 'handshake (22)',
            bits: 8,
          },
          {
            name: 'Version',
            value: '0x0303 (legacy)',
            bits: 16,
            note: 'Frozen at "TLS 1.2" on the record layer forever, because middleboxes reject anything else. The real version is in an extension.',
          },
          { name: 'Length', value: `${bytes} bytes`, bits: 16 },
          {
            name: 'Messages',
            value: inFlight.map((message) => message.name).join(', '),
            note:
              encrypted.length === 0
                ? 'In the clear: an observer reads all of this, including which host was asked for.'
                : `${encrypted.length} of these are encrypted. An observer sees only the record header, so it learns the size and the timing and nothing else.`,
          },
        ],
        payloadPreview: flight.summary,
      },
    ],
    sizeBytes: bytes,
    summary: `TLS ${inFlight.map((message) => message.name).join(' + ')}`,
  };
}

/** Negotiate the connection, or refuse it. */
export const tlsStage: Stage = (context): StageOutput => {
  const url = requireState(context.state, 'url', 'tls');
  const tcp = requireState(context.state, 'tcp', 'tls');
  const spec = context.scenario.tls;

  if (url.scheme !== 'https' || !spec) {
    return {
      events: [],
      durationMs: 0,
      summary: 'Cleartext',
      skipped:
        'This is an http:// request. There is no handshake, no certificate, and no key -- every byte below is readable by anything on the path.',
    };
  }

  const peerNode = tcp.peerNode;
  const link = linkId(BROWSER_NODE, peerNode);
  const oneWay = round2(context.profile.rttMs / 2);
  const timing = {
    oneWayMs: oneWay,
    serverThinkMs: SERVER_THINK_MS,
    clientVerifyMs: CLIENT_VERIFY_MS,
  };
  const alpn = spec.alpn ?? 'h2';

  const validation = validateChain(spec.chain, {
    host: url.host,
    now: spec.validationAt ?? PAGE_LOAD_EPOCH,
    store: spec.store,
  });

  const events: SimEvent[] = [
    {
      kind: 'phase',
      at: 0,
      id: 'tls',
      title: 'Agree on keys, and check who is on the other end',
      description:
        'Two questions at once: what key protects this connection, and is the far end really the host that was typed. The second is the certificate’s whole job.',
    },
    { kind: 'node-state', at: 0, nodeId: peerNode, state: 'processing' },
  ];
  const pdus: Record<string, PDU> = {};

  const use12 = spec.version === '1.2';
  const handshake13 = use12
    ? undefined
    : buildTls13Handshake({
        host: url.host,
        ...(spec.resume ? {} : { chain: spec.chain }),
        alpn,
        timing,
        ...(spec.resume ? { resume: true } : {}),
        ...(spec.earlyData ? { earlyData: true } : {}),
      });
  // TLS 1.2 has no ALPN in this model: the extension exists, but the 1.2 builder does not
  // take one, and inventing a field it does not have would be a lie about what core knows.
  const handshake12 = use12
    ? buildTls12Handshake({
        host: url.host,
        chain: spec.chain,
        timing,
        ...(spec.resume ? { resume: true } : {}),
      })
    : undefined;

  const messages = handshake13?.messages ?? handshake12?.messages ?? [];
  const flights =
    handshake13?.flights ?? handshake12?.flights ?? groupIntoFlights(messages);
  const roundTrips = handshake13?.roundTrips ?? handshake12?.roundTrips ?? 2;
  const applicationDataAt =
    handshake13?.applicationDataAt ?? handshake12?.applicationDataAt ?? 0;
  const completedAt = handshake13?.completedAt ?? handshake12?.completedAt ?? 0;

  flights.forEach((flight, index) => {
    const id = `tls-flight-${index}`;
    const pdu = flightPdu(id, flight, messages);
    pdus[id] = pdu;
    const from = flight.from === 'client' ? BROWSER_NODE : peerNode;
    const to = flight.from === 'client' ? peerNode : BROWSER_NODE;

    events.push({ kind: 'pdu-created', at: round2(flight.at), pdu, atNode: from });
    events.push({
      kind: 'transmit',
      at: round2(flight.at),
      pduId: id,
      from,
      to,
      durationMs: oneWay,
      linkId: link,
    });
    events.push({
      kind: 'log',
      at: round2(flight.at),
      level: 'info',
      text: `Flight ${flight.number} (${flight.from}): ${flight.summary}`,
    });
  });

  // The moment the wire stops being readable is the single most useful thing to point at
  // in a handshake, so it gets an annotation of its own rather than a log line.
  const firstEncrypted = messages.find((message) => message.encryption !== 'none');
  if (firstEncrypted) {
    events.push({
      kind: 'annotate',
      at: round2(firstEncrypted.at),
      targetId: peerNode,
      text: `Everything from ${firstEncrypted.name} onwards is encrypted. Before it, an observer read the host name in the ClientHello in plain text -- the handshake protects the connection, not the fact that it happened.`,
      reference: RFC_8446,
    });
  }

  if (spec.earlyData && handshake13?.mode === 'psk-0rtt') {
    events.push({
      kind: 'annotate',
      at: 0,
      targetId: BROWSER_NODE,
      text: '0-RTT: the request goes out in the very first packet, encrypted under a key kept from the last visit. Nothing is waited for -- and nothing can be, which is why 0-RTT data is replayable and is only safe for requests that can be executed twice.',
      reference: RFC_8446_0RTT,
    });
  }

  // --- The certificate --------------------------------------------------------
  const failure = primaryFailure(validation);
  const verifyAt = round2(Math.min(applicationDataAt, completedAt));

  events.push({
    kind: 'log',
    at: verifyAt,
    level: validation.trusted ? 'info' : 'error',
    text: validation.trusted
      ? `Certificate verified: all five checks passed against ${validation.anchor?.subject.commonName ?? 'the trust store'}.`
      : `Certificate rejected at "${failure?.title}": ${failure?.detail}`,
  });

  if (!validation.trusted && failure) {
    events.push({ kind: 'node-state', at: verifyAt, nodeId: peerNode, state: 'error' });
    events.push({
      kind: 'node-state',
      at: verifyAt,
      nodeId: BROWSER_NODE,
      state: 'error',
    });
    events.push({
      kind: 'log',
      at: verifyAt,
      level: 'error',
      text: `Sending alert ${failure.alert?.name} (${failure.alert?.code}) and closing the connection. No HTTP request was ever sent.`,
    });

    return {
      events,
      pdus,
      durationMs: verifyAt,
      summary: `Rejected: ${failure.browserError ?? 'bad certificate'}`,
      state: {
        tls: {
          version: use12 ? 'TLS 1.2' : 'TLS 1.3',
          ...(handshake13 ? { handshake13 } : {}),
          ...(handshake12 ? { handshake12 } : {}),
          messages,
          flights,
          validation,
          roundTrips,
          applicationDataAt,
          completedAt,
          alpn,
          httpVersion: ALPN_VERSIONS[alpn] ?? 'HTTP/1.1',
          earlyData: false,
        },
      },
      failure: {
        code: failure.browserError ?? 'NET::ERR_CERT_INVALID',
        title: 'Your connection is not private',
        message:
          failure.userFacing ??
          'This site’s certificate could not be verified, so the browser cannot be sure who is on the other end.',
        explanation: `${failure.detail} ${failure.explain} The connection had already been opened -- TCP succeeded, and the handshake got as far as the server presenting its chain -- and it is torn down here with a ${failure.alert?.name} alert (${failure.alert?.code}). No HTTP request was sent, so the origin never learned what page was wanted. This is the one failure in the pipeline that is a *refusal* rather than a breakage: everything worked, and the browser decided the far end could not be identified.`,
        reference: failure.reference,
      },
    };
  }

  events.push({
    kind: 'annotate',
    at: verifyAt,
    targetId: BROWSER_NODE,
    text:
      roundTrips === 0
        ? 'Zero round trips of TLS. The stage rail below shows this as a stage that cost nothing -- which is exactly what resumption buys.'
        : `${roundTrips} round ${roundTrips === 1 ? 'trip' : 'trips'} of handshake, on top of the one TCP already cost. The client may send its request at ${applicationDataAt} ms; the server's own Finished is still in flight while it does.`,
    reference: RFC_8446,
  });

  const result: TlsResult = {
    version: use12 ? 'TLS 1.2' : 'TLS 1.3',
    ...(handshake13 ? { handshake13 } : {}),
    ...(handshake12 ? { handshake12 } : {}),
    messages,
    flights,
    validation,
    roundTrips,
    applicationDataAt,
    completedAt,
    alpn,
    httpVersion: ALPN_VERSIONS[alpn] ?? 'HTTP/1.1',
    earlyData: handshake13?.mode === 'psk-0rtt',
  };

  return {
    events,
    pdus,
    durationMs: round2(applicationDataAt),
    summary:
      handshake13?.mode === 'psk-0rtt'
        ? '0-RTT resumption'
        : `${result.version}, ${roundTrips} RTT, ALPN ${alpn}`,
    state: { tls: result },
  };
};
