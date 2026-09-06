/**
 * h1, h2, h3 -- the same requests, three different ways of getting them down a wire.
 *
 * Nothing about *what* an HTTP message means changes between the versions. A GET is a
 * GET, a 304 is a 304, and `Cache-Control` does the same job in all three; that is the
 * whole point of RFC 9110 having been split out from RFC 9112 in the first place. What
 * changes is the **framing and the multiplexing**, and those change the clock. This file
 * models only that: given a list of things a page needs and a network to fetch them
 * over, when does each one arrive, and why.
 *
 * ## The one thing to get right
 *
 * Head-of-line blocking is two different problems wearing one name, and almost every
 * explanation collapses them. They sit at different layers, and the three versions score
 * differently on each:
 *
 * |                       | HTTP/1.1    | HTTP/2         | HTTP/3   |
 * | --------------------- | ----------- | -------------- | -------- |
 * | Application-layer HOL | yes, badly  | **no**         | no       |
 * | Transport-layer HOL   | per-request | **yes, total** | **no**   |
 *
 * **Application-layer HOL** is the request queue. An HTTP/1.1 connection carries one
 * exchange at a time, so with six connections open the seventh request waits for one of
 * the first six to finish -- however small it is, and however idle the network is.
 * HTTP/2 deletes this outright: every request is its own stream on one connection, and
 * they all go at once.
 *
 * **Transport-layer HOL** is TCP's delivery guarantee. TCP hands the application one
 * ordered byte stream, so when a segment goes missing the kernel holds *every byte that
 * arrived after it* until the retransmission lands. HTTP/2 put all of its streams inside
 * that single byte stream, which means one lost segment stalls **all of them** -- h2 is
 * strictly worse than h1 here, because h1's loss stalls only the one connection it
 * happened on. This is the trade nobody mentions, and it is why h2 can lose to h1 on a
 * genuinely lossy link.
 *
 * Only HTTP/3 fixes it, and only because it left TCP behind: QUIC does loss recovery per
 * stream, so a lost packet stalls the streams whose bytes it was carrying and nothing
 * else (RFC 9000 s2.2).
 *
 * So "h2 removes head-of-line blocking" is half of a true sentence, and the half it
 * leaves out is the half that explains why h3 exists.
 *
 * ## The model
 *
 * A discrete-event scheduler with a fluid, equal-share bandwidth model: at any instant
 * the bottleneck's capacity is divided evenly between the transfers that are actually
 * moving, and a transfer stalled waiting for a retransmission is not one of them. It is
 * deliberately simple in two places, both of which flatter nothing:
 *
 * - **Capacity is shared per transfer, not per connection.** Real TCP congestion control
 *   is fair per flow, so h1's six connections would take six shares against h2's one --
 *   a real and slightly embarrassing advantage for h1 that this model does not hand it.
 * - **A version's connections are all established in parallel.** h1 pays six handshakes'
 *   worth of packets, sockets, and cold congestion windows, but not six handshakes'
 *   worth of wall-clock. Only the last of those would be on the timeline anyway.
 *
 * And one simplification that is neutral rather than generous: a loss costs a flat round
 * trip of recovery and nothing else. Real TCP also halves the congestion window, so a
 * lossy link punishes a long-lived flow well past the retransmission -- the effect this
 * models is the *stall*, which is the one that differs between the three versions, and
 * not the throughput collapse, which does not.
 *
 * ## Determinism
 *
 * Losses are drawn once **per resource**, from a stream forked on the resource id alone
 * -- deliberately not on the version. So the same packet goes missing in all three runs,
 * and the comparison shows three protocols reacting to one identical network event
 * rather than three protocols meeting three different networks. Everything else is
 * arithmetic. Two runs of one seed are deep-equal, which `versions.test.ts` asserts.
 */

import { createRng, type Rng } from '@/core/sim/rng';
import type { RfcRef } from '@/core/types/events';

import { HTTP_VERSIONS, type HttpVersion } from './message';

// ---------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------

const RFC_9112: RfcRef = { rfc: 9112, title: 'HTTP/1.1' };
const RFC_9113: RfcRef = { rfc: 9113, title: 'HTTP/2' };
const RFC_9114: RfcRef = { rfc: 9114, title: 'HTTP/3' };
const RFC_9000: RfcRef = {
  rfc: 9000,
  title: 'QUIC: A UDP-Based Multiplexed and Secure Transport',
};

/** Where each version is specified. The 723x series is obsolete; these replaced it. */
export const VERSION_RFCS: Readonly<Record<HttpVersion, RfcRef>> = {
  'HTTP/1.1': RFC_9112,
  'HTTP/2': RFC_9113,
  'HTTP/3': RFC_9114,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Connections a browser opens to one origin over HTTP/1.1.
 *
 * Six is not in any specification. RFC 2616 recommended **two**; every browser ignored
 * it, settled on six, and RFC 9112 s9.4 now says only "be conservative". The number is
 * folklore that hardened into a constant -- and it is the reason for domain sharding,
 * the practice of scattering assets across `img1.`, `img2.`, `img3.` to buy eighteen
 * connections instead of six, which HTTP/2 made pointless and then actively harmful.
 */
export const H1_MAX_CONNECTIONS_PER_ORIGIN = 6;

/**
 * Streams a server will let a client run at once before it has said otherwise.
 *
 * `SETTINGS_MAX_CONCURRENT_STREAMS` has no default limit in RFC 9113 s6.5.2, but s5.1.2
 * recommends servers advertise at least 100 and essentially all of them advertise
 * exactly 100. Above it, h2 queues -- so application-layer head-of-line blocking is
 * *raised by two orders of magnitude* rather than abolished, which matters for a page
 * with three hundred assets and for nothing else.
 */
export const H2_DEFAULT_MAX_CONCURRENT_STREAMS = 100;

/**
 * Payload bytes in one TCP segment on an Ethernet path: a 1500-byte MTU less 20 for the
 * IPv4 header and 20 for the TCP header. Loss happens in units of these, so this is the
 * unit the loss probability is counted over.
 */
export const MSS_BYTES = 1460;

/**
 * The first client-initiated stream identifier.
 *
 * Client streams are odd and server streams even (RFC 9113 s5.1.1), so both ends can
 * open streams without colliding and without negotiating. Stream 0 is the connection
 * control stream and belongs to neither.
 */
export const FIRST_CLIENT_STREAM_ID = 1;

/** Client-initiated stream ids are odd, so they advance in twos. */
export const CLIENT_STREAM_ID_STEP = 2;

/**
 * Header bytes left after HPACK/QPACK compresses a connection's **first** request.
 *
 * That request cannot use the dynamic table -- it is what fills it -- so it gets the
 * static table for the common field names and Huffman coding for the values. Roughly
 * half, measured across real request sets.
 */
export const FIRST_REQUEST_HEADER_RATIO = 0.55;

/**
 * Header bytes left on every request **after** the first on the same connection.
 *
 * By then `user-agent`, `accept`, `accept-encoding`, `cookie` and the rest are in the
 * dynamic table and each is re-sent as a one-byte index; what remains is the path and
 * whatever genuinely changed. This is the number that makes h2 cheap for many small
 * requests, and it is invisible to anyone looking only at response sizes.
 */
export const REPEAT_REQUEST_HEADER_RATIO = 0.08;

/** However well they compress, a request still costs a frame header and a few bytes. */
export const MIN_COMPRESSED_HEADER_BYTES = 24;

/** Request header bytes assumed when a resource does not say. A plausible browser GET. */
export const DEFAULT_REQUEST_HEADER_BYTES = 480;

/** Server think time assumed when a resource does not say -- a static file off disk. */
export const DEFAULT_THINK_MS = 4;

/**
 * Where in a transfer an injected loss lands, as a fraction of its bytes.
 *
 * Kept away from both ends: a loss in the first few bytes is indistinguishable from a
 * slow start, and one in the last few is invisible. The window is what makes a stall
 * legible as a gap in the middle of a bar on the timeline.
 */
const LOSS_WINDOW = { from: 0.15, to: 0.85 } as const;

/** Floating-point slack for "this transfer has no bytes left". */
const EPSILON = 1e-9;

/** A runaway-scheduler backstop. No realistic page load comes near it. */
const MAX_SCHEDULER_STEPS = 100_000;

// ---------------------------------------------------------------------------
// What each version is
// ---------------------------------------------------------------------------

/** The short name everyone actually says. */
export type VersionAlias = 'h1' | 'h2' | 'h3';

/** How a version frames its messages -- the largest single difference on the wire. */
export type Framing =
  /** Text, delimited by CRLF and a blank line. Readable, and ambiguous enough to smuggle through. */
  | 'text'
  /** Length-prefixed binary frames carrying a type and a stream id. Unambiguous by construction. */
  | 'binary';

/** Which header-compression scheme, if any. */
export type HeaderCompression = 'none' | 'HPACK' | 'QPACK';

/** The fixed facts about one version: everything true of it before a run starts. */
export interface VersionProfile {
  readonly version: HttpVersion;
  readonly alias: VersionAlias;
  /** What carries it. The root of nearly every other difference in this table. */
  readonly transport: 'TCP' | 'QUIC';
  readonly framing: Framing;
  readonly headerCompression: HeaderCompression;
  /** The compression scheme's own RFC, absent when there is no compression. */
  readonly compressionRfc?: RfcRef;
  /** Connections a client opens to one origin. */
  readonly connectionsPerOrigin: number;
  /** Exchanges one connection carries at once. */
  readonly concurrentPerConnection: number;
  /** Whether a queued request can be blocked by an earlier one at the HTTP layer. */
  readonly hasApplicationHol: boolean;
  /** Whether one lost packet stalls unrelated exchanges on the same connection. */
  readonly hasTransportHol: boolean;
  /** Whether a resumed connection can carry a request in its very first flight. */
  readonly zeroRttCapable: boolean;
  /** Round trips a *fresh* connection costs before a request byte can be sent. */
  readonly handshakeRoundTrips: {
    /** Establishing the transport: TCP's three-way handshake, or QUIC's Initial flight. */
    readonly transport: number;
    /** Establishing encryption *on top of* that. QUIC folds it into the line above. */
    readonly crypto: number;
  };
  readonly rfc: RfcRef;
  readonly transportRfc?: RfcRef;
  /** One sentence: what this version is, and what it was trying to fix. */
  readonly summary: string;
}

/** The three versions, as data. */
export const VERSION_PROFILES: Readonly<Record<HttpVersion, VersionProfile>> = {
  'HTTP/1.1': {
    version: 'HTTP/1.1',
    alias: 'h1',
    transport: 'TCP',
    framing: 'text',
    headerCompression: 'none',
    connectionsPerOrigin: H1_MAX_CONNECTIONS_PER_ORIGIN,
    concurrentPerConnection: 1,
    hasApplicationHol: true,
    hasTransportHol: true,
    zeroRttCapable: false,
    handshakeRoundTrips: { transport: 1, crypto: 1 },
    rfc: RFC_9112,
    summary:
      'Text on the wire, one exchange at a time per connection, and six connections ' +
      'open to hide that. Every request re-sends every header in full.',
  },
  'HTTP/2': {
    version: 'HTTP/2',
    alias: 'h2',
    transport: 'TCP',
    framing: 'binary',
    headerCompression: 'HPACK',
    compressionRfc: { rfc: 7541, title: 'HPACK: Header Compression for HTTP/2' },
    connectionsPerOrigin: 1,
    concurrentPerConnection: H2_DEFAULT_MAX_CONCURRENT_STREAMS,
    hasApplicationHol: false,
    hasTransportHol: true,
    zeroRttCapable: false,
    handshakeRoundTrips: { transport: 1, crypto: 1 },
    rfc: RFC_9113,
    summary:
      'The same semantics in binary frames, multiplexed as streams over one TCP ' +
      'connection, with headers compressed against a table both ends keep in step.',
  },
  'HTTP/3': {
    version: 'HTTP/3',
    alias: 'h3',
    transport: 'QUIC',
    framing: 'binary',
    headerCompression: 'QPACK',
    compressionRfc: { rfc: 9204, title: 'QPACK: Field Compression for HTTP/3' },
    connectionsPerOrigin: 1,
    concurrentPerConnection: H2_DEFAULT_MAX_CONCURRENT_STREAMS,
    hasApplicationHol: false,
    hasTransportHol: false,
    zeroRttCapable: true,
    // QUIC carries the TLS 1.3 handshake inside its own Initial packets, so there is no
    // second handshake to pay for. The crypto is not free -- it is simply not a
    // separate round trip (RFC 9001).
    handshakeRoundTrips: { transport: 1, crypto: 0 },
    rfc: RFC_9114,
    transportRfc: RFC_9000,
    summary:
      'HTTP/2 without TCP underneath it. QUIC gives every stream its own loss ' +
      'recovery, folds the TLS handshake into connection setup, and runs over UDP.',
  },
};

/** The profile for a version. */
export function versionProfile(version: HttpVersion): VersionProfile {
  return VERSION_PROFILES[version];
}

/** Look a version up by its short name, for a URL parameter or a toggle. */
export function versionFromAlias(alias: string): HttpVersion | undefined {
  return HTTP_VERSIONS.find((version) => VERSION_PROFILES[version].alias === alias);
}

// ---------------------------------------------------------------------------
// Head-of-line blocking, as a first-class teaching object
// ---------------------------------------------------------------------------

/** How one version scores on one kind of head-of-line blocking. */
export interface HolVerdict {
  /** True when this version still suffers this kind of blocking. */
  readonly blocked: boolean;
  /** What actually happens, in a sentence or two. */
  readonly text: string;
}

/** One layer at which requests can be made to wait for each other. */
export interface HolAnalysis {
  readonly id: 'application' | 'transport';
  readonly title: string;
  /** What the blocking *is*, independent of version. */
  readonly what: string;
  readonly reference: RfcRef;
  readonly verdicts: Readonly<Record<HttpVersion, HolVerdict>>;
}

/**
 * The comparison the version view is built around.
 *
 * Two rows, because there are two problems -- and reading them as one row is the
 * misconception this module exists to remove.
 */
export const HEAD_OF_LINE_BLOCKING: readonly HolAnalysis[] = [
  {
    id: 'application',
    title: 'Application-layer head-of-line blocking',
    what:
      'A request cannot be sent because an earlier request is still occupying the only ' +
      'slot it could go in. Nothing is wrong with the network: the bytes are simply ' +
      'not allowed out yet.',
    reference: RFC_9112,
    verdicts: {
      'HTTP/1.1': {
        blocked: true,
        text:
          'A connection carries one exchange at a time, so the seventh request to an ' +
          'origin waits for one of the six connections to go idle, and a slow response ' +
          'holds its whole connection hostage. Pipelining was meant to fix this and was ' +
          'disabled everywhere, because a pipelined connection blocks in exactly the ' +
          'same way and is harder to recover from.',
      },
      'HTTP/2': {
        blocked: false,
        text:
          'Every request is a stream on one connection and they are all in flight at ' +
          'once, interleaved frame by frame. This is the problem HTTP/2 was built to ' +
          'solve, and it solves it completely -- up to the concurrent-stream limit the ' +
          'server advertises, which is usually 100.',
      },
      'HTTP/3': {
        blocked: false,
        text: 'As HTTP/2: streams on one connection, all in flight together.',
      },
    },
  },
  {
    id: 'transport',
    title: 'Transport-layer head-of-line blocking',
    what:
      'A packet goes missing, and the transport withholds data that already arrived ' +
      'safely because it has to deliver bytes in order. The bytes are sitting in the ' +
      "receiver's memory; the application is not allowed to see them yet.",
    reference: RFC_9000,
    verdicts: {
      'HTTP/1.1': {
        blocked: true,
        text:
          'One TCP connection carries one exchange, so a lost segment stalls exactly ' +
          'one request; the other five connections carry on, unaware. This is the one ' +
          'dimension on which HTTP/1.1 beats HTTP/2.',
      },
      'HTTP/2': {
        blocked: true,
        text:
          'All the streams share one TCP byte stream, so a single lost segment stalls ' +
          'every stream on the connection until the retransmission arrives -- including ' +
          'streams whose own data got through untouched. HTTP/2 moved multiplexing above ' +
          'the transport, and the transport did not get the memo.',
      },
      'HTTP/3': {
        blocked: false,
        text:
          'QUIC knows about streams, so it recovers loss per stream: a lost packet ' +
          'stalls the streams whose bytes it carried and delivers everything else ' +
          'immediately. This is why HTTP/3 could not have been built on TCP, and why it ' +
          'had to be built on UDP.',
      },
    },
  },
];

// ---------------------------------------------------------------------------
// The network the comparison runs over
// ---------------------------------------------------------------------------

/** The link a page load is being fetched across. */
export interface NetworkConditions {
  /** Round-trip time in virtual milliseconds. Version differences live in this number. */
  readonly rttMs: number;
  /**
   * Bottleneck capacity in kilobits per second. Kilobits per second is also **bits per
   * millisecond**, which is why every serialization calculation below is a plain
   * `bytes * 8 / bandwidthKbps`.
   */
  readonly bandwidthKbps: number;
  /** Per-segment loss probability, `0` to `1`, compounded over a transfer's segments. */
  readonly lossRate: number;
  /**
   * Whether the connection is encrypted.
   *
   * Defaults to `true`, and should stay that way for any comparison: h2 and h3 are only
   * ever deployed over TLS in practice, and no browser has ever shipped cleartext h2.
   * Racing a cleartext h1 against an encrypted h2 would hand h1 a round trip it would
   * never have in the field.
   */
  readonly secure: boolean;
  /**
   * Whether the client has spoken to this origin before and kept the session ticket.
   *
   * This is where HTTP/3 is most visibly ahead: a resumed QUIC connection sends the
   * request in its **first** flight, at 0-RTT. TCP cannot, because TCP's own handshake
   * still has to complete before TLS has anything to resume onto.
   */
  readonly resumed: boolean;
}

/** A fast, unloaded link. Overridden per scenario. */
export const DEFAULT_CONDITIONS: NetworkConditions = {
  rttMs: 120,
  bandwidthKbps: 12_000,
  lossRate: 0,
  secure: true,
  resumed: false,
};

/** Fill in whatever a scenario left out. */
export function withDefaults(
  conditions: Partial<NetworkConditions> = {},
): NetworkConditions {
  return { ...DEFAULT_CONDITIONS, ...conditions };
}

// ---------------------------------------------------------------------------
// Connection setup
// ---------------------------------------------------------------------------

/** One flight of the handshake, as a row in the setup breakdown. */
export interface HandshakeStep {
  readonly label: string;
  readonly roundTrips: number;
  readonly ms: number;
  readonly note: string;
}

/** What it costs to be able to send the first request byte. */
export interface HandshakeCost {
  readonly roundTrips: number;
  readonly ms: number;
  readonly steps: readonly HandshakeStep[];
  readonly explanation: string;
}

/**
 * Round trips before a request can go out.
 *
 * The table this produces is the clearest single argument for HTTP/3, so it is worth
 * reading as a table:
 *
 * | Connection         | h1 / h2 | h3        |
 * | ------------------ | ------- | --------- |
 * | Fresh, encrypted   | 2 RTT   | **1 RTT** |
 * | Resumed, encrypted | 1 RTT   | **0 RTT** |
 * | Fresh, cleartext   | 1 RTT   | n/a       |
 *
 * h1 and h2 are identical here -- they run over the same TCP and the same TLS -- and
 * every row of the h3 column is a round trip cheaper for the same reason: QUIC carries
 * the TLS 1.3 handshake *inside* connection setup rather than after it, so there is
 * never a transport handshake that has to finish before the crypto one can start.
 *
 * One caveat kept here rather than in a footnote: 0-RTT data is replayable, so it is
 * only safe for idempotent requests (RFC 9001 s9.2). A server that accepts a 0-RTT POST
 * has accepted that it may be executed twice.
 */
export function handshakeCost(
  version: HttpVersion,
  conditions: NetworkConditions,
): HandshakeCost {
  const profile = VERSION_PROFILES[version];
  const rtt = conditions.rttMs;
  const steps: HandshakeStep[] = [];

  if (profile.transport === 'QUIC') {
    steps.push(
      conditions.resumed
        ? {
            label: 'QUIC 0-RTT',
            roundTrips: 0,
            ms: 0,
            note:
              'The request rides in the very first packet, encrypted under a key ' +
              'derived from the ticket kept from last time. Nothing is waited for. Only ' +
              'safe for idempotent requests: 0-RTT data can be replayed (RFC 9001 s9.2).',
          }
        : {
            label: 'QUIC handshake',
            roundTrips: 1,
            ms: rtt,
            note:
              'One flight each way, carrying the TLS 1.3 handshake inside the QUIC ' +
              'Initial packets. Transport and encryption are established together ' +
              'because in QUIC they are not separable (RFC 9001).',
          },
    );
  } else {
    steps.push({
      label: 'TCP handshake',
      roundTrips: 1,
      ms: rtt,
      note:
        'SYN, SYN-ACK, and the request rides on the ACK. Unavoidable: TCP has no way to ' +
        'carry payload before the connection exists, and TCP Fast Open never got past ' +
        'the middleboxes.',
    });
    if (conditions.secure) {
      steps.push(
        conditions.resumed
          ? {
              label: 'TLS 1.3 resumption',
              roundTrips: 0,
              ms: 0,
              note:
                'A pre-shared key from the last session, so the request goes in the ' +
                'first TLS flight -- but only once TCP has finished, which is precisely ' +
                'the round trip HTTP/3 does not pay.',
            }
          : {
              label: 'TLS 1.3 handshake',
              roundTrips: 1,
              ms: rtt,
              note:
                'ClientHello and ServerHello: one round trip. TLS 1.2 took two, and this ' +
                'is the saving TLS 1.3 exists for -- QUIC then saved the same round trip ' +
                'again by refusing to be a second handshake at all.',
            },
      );
    }
  }

  const roundTrips = steps.reduce((total, step) => total + step.roundTrips, 0);
  const ms = steps.reduce((total, step) => total + step.ms, 0);
  const which = conditions.resumed ? 'resumed' : 'fresh';
  const how = conditions.secure ? 'encrypted' : 'cleartext';

  return {
    roundTrips,
    ms,
    steps,
    explanation:
      `${profile.alias} on a ${which}, ${how} connection: ` +
      (roundTrips === 0
        ? 'no round trips at all before the first request byte'
        : `${roundTrips} round trip${roundTrips === 1 ? '' : 's'} (${ms} ms) before the first request byte`),
  };
}

// ---------------------------------------------------------------------------
// Header compression
// ---------------------------------------------------------------------------

/**
 * Bytes a request's header block actually takes on this connection.
 *
 * `indexOnConnection` is how many requests this connection has already carried, because
 * that is the whole mechanism: HPACK and QPACK are not compressors in the gzip sense but
 * **shared tables**, and their value arrives from the second request onwards. The first
 * request fills the table; every later one indexes into it.
 *
 * HTTP/1.1 is a flat pass-through, which is the honest number: a cookie re-sent on all
 * fifty requests for a page costs fifty times, every time, forever.
 */
export function compressedHeaderBytes(
  version: HttpVersion,
  indexOnConnection: number,
  rawBytes: number,
): number {
  if (VERSION_PROFILES[version].headerCompression === 'none') return rawBytes;
  const ratio =
    indexOnConnection === 0 ? FIRST_REQUEST_HEADER_RATIO : REPEAT_REQUEST_HEADER_RATIO;
  return Math.max(MIN_COMPRESSED_HEADER_BYTES, Math.round(rawBytes * ratio));
}

// ---------------------------------------------------------------------------
// What a page load asks for
// ---------------------------------------------------------------------------

/** One thing a page needs, as the scheduler sees it. */
export interface ResourceRequest {
  /** Stable id. The loss draw is forked on this, so it must not change between runs. */
  readonly id: string;
  /** What to call it on the timeline, e.g. `'app.css'`. */
  readonly label: string;
  /** The request-target, for the log line. */
  readonly target: string;
  /** Response body size in bytes. */
  readonly responseBytes: number;
  /** Uncompressed request header bytes; see {@link DEFAULT_REQUEST_HEADER_BYTES}. */
  readonly requestHeaderBytes?: number;
  /** How long the origin takes to produce the first byte. */
  readonly serverThinkMs?: number;
}

// ---------------------------------------------------------------------------
// What comes out
// ---------------------------------------------------------------------------

/** A packet that went missing, drawn once per resource and shared by all three runs. */
export interface PacketLoss {
  readonly resourceId: string;
  /** How far into the transfer the gap appears, as a fraction of its bytes. */
  readonly atFraction: number;
  /** Segments the transfer is made of -- what the loss probability was counted over. */
  readonly segments: number;
}

/** Why a transfer stopped moving for a while. */
export type StallKind =
  /** This transfer's own packet was lost. It would stall under any version. */
  | 'own-loss'
  /** Another stream on the same connection lost a packet: transport-layer HOL blocking. */
  | 'transport-hol';

/** One period a transfer spent waiting on a retransmission. */
export interface StallRecord {
  readonly kind: StallKind;
  readonly atMs: number;
  readonly ms: number;
  /** The resource whose packet was actually lost. */
  readonly causedBy: string;
  readonly explanation: string;
}

/** One request's life, from queued to last byte. */
export interface StreamTiming {
  readonly resourceId: string;
  readonly label: string;
  readonly target: string;
  readonly connectionId: string;
  /** h2 and h3 only; HTTP/1.1 has no stream identifiers to give. */
  readonly streamId?: number;
  /** When the browser wanted it. Every resource in one page load is queued together. */
  readonly queuedAt: number;
  /** When its bytes went out. Later than `queuedAt` only if something was in the way. */
  readonly startedAt: number;
  /** When the first response byte arrived. Time to first byte is this minus `startedAt`. */
  readonly firstByteAt: number;
  /** When the last response byte arrived. */
  readonly completedAt: number;
  readonly responseBytes: number;
  readonly requestHeaderBytesRaw: number;
  /** After HPACK/QPACK -- or the same number again, for HTTP/1.1. */
  readonly requestHeaderBytesOnWire: number;
  /** Time spent waiting for a connection or a stream slot: application-layer HOL. */
  readonly blockedMs: number;
  /** Time spent waiting for a retransmission of this stream's own lost packet. */
  readonly ownStallMs: number;
  /** Time spent waiting for somebody else's retransmission: transport-layer HOL. */
  readonly holStallMs: number;
  readonly stalls: readonly StallRecord[];
}

/** One connection a version opened. */
export interface ConnectionTiming {
  readonly id: string;
  readonly label: string;
  readonly transport: 'TCP' | 'QUIC';
  readonly readyAt: number;
  readonly requestsServed: number;
  readonly streamIds: readonly number[];
}

/** One version's page load, end to end. */
export interface VersionRun {
  readonly version: HttpVersion;
  readonly profile: VersionProfile;
  readonly conditions: NetworkConditions;
  readonly handshake: HandshakeCost;
  readonly connections: readonly ConnectionTiming[];
  readonly streams: readonly StreamTiming[];
  /** The losses that happened -- identical across the three versions, by construction. */
  readonly losses: readonly PacketLoss[];
  /** When the last byte of the last resource arrived: the page load time. */
  readonly completedAt: number;
  /** Total time requests spent queued behind other requests. */
  readonly applicationHolMs: number;
  /** Total time streams spent stalled by *another* stream's lost packet. */
  readonly transportHolMs: number;
  /** Total time streams spent stalled by their own lost packet. */
  readonly ownStallMs: number;
  readonly requestHeaderBytesRaw: number;
  readonly requestHeaderBytesOnWire: number;
  /** One paragraph: what this version did, in this run's own numbers. */
  readonly explanation: string;
}

// ---------------------------------------------------------------------------
// The scheduler
// ---------------------------------------------------------------------------

interface Task {
  readonly index: number;
  readonly resource: ResourceRequest;
  readonly rawHeaderBytes: number;
  readonly thinkMs: number;
  connectionIndex: number;
  streamId: number | undefined;
  headerBytesOnWire: number;
  state: 'queued' | 'waiting' | 'downloading' | 'done';
  queuedAt: number;
  startedAt: number;
  firstByteAt: number;
  completedAt: number;
  /** Response bytes still to arrive. */
  remaining: number;
  /** The `remaining` value at which this transfer's loss fires; `-1` for no loss. */
  lossAtRemaining: number;
  lossFired: boolean;
  blockedMs: number;
  ownStallMs: number;
  holStallMs: number;
  stalls: StallRecord[];
}

/** Two decimal places: enough for a timeline, few enough to read. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Which packets go missing -- drawn per resource, and deliberately not per version.
 *
 * The probability is compounded over the transfer's segments, so a 2 MB image on a 1%
 * link is all but certain to lose something while a 400-byte JSON response usually will
 * not. That is the real shape of the problem, and the reason large responses are where
 * transport head-of-line blocking hurts.
 */
export function drawLosses(
  resources: readonly ResourceRequest[],
  conditions: NetworkConditions,
  rng: Rng,
): PacketLoss[] {
  const losses: PacketLoss[] = [];
  if (conditions.lossRate <= 0) return losses;

  for (const resource of resources) {
    const segments = Math.max(1, Math.ceil(resource.responseBytes / MSS_BYTES));
    const probability = 1 - Math.pow(1 - conditions.lossRate, segments);
    // Forked on the resource id alone, so the same packet is lost in the h1, h2 and h3
    // runs and the three columns differ only in how they react to it.
    const stream = rng.fork(`loss:${resource.id}`);
    if (!stream.chance(probability)) continue;
    losses.push({
      resourceId: resource.id,
      atFraction: stream.between(LOSS_WINDOW.from, LOSS_WINDOW.to),
      segments,
    });
  }
  return losses;
}

/**
 * Run one version's page load.
 *
 * The loop is a fluid discrete-event simulation: start whatever is allowed to start,
 * jump to the next moment anything changes, drain bandwidth across the interval that
 * just passed, apply whatever happened at the new time, and repeat.
 */
export function planVersionRun(init: {
  version: HttpVersion;
  resources: readonly ResourceRequest[];
  conditions?: Partial<NetworkConditions>;
  seed: number | string;
}): VersionRun {
  const { version } = init;
  const profile = VERSION_PROFILES[version];
  const conditions = withDefaults(init.conditions);
  const handshake = handshakeCost(version, conditions);
  const losses = drawLosses(init.resources, conditions, createRng(init.seed));
  const lossByResource = new Map(losses.map((loss) => [loss.resourceId, loss]));

  const halfRtt = conditions.rttMs / 2;
  const bytesPerMs = conditions.bandwidthKbps / 8;
  const t0 = handshake.ms;

  const connectionCount =
    profile.concurrentPerConnection > 1
      ? 1
      : Math.max(1, Math.min(profile.connectionsPerOrigin, init.resources.length));

  const tasks: Task[] = init.resources.map((resource, index) => {
    const loss = lossByResource.get(resource.id);
    return {
      index,
      resource,
      rawHeaderBytes: resource.requestHeaderBytes ?? DEFAULT_REQUEST_HEADER_BYTES,
      thinkMs: resource.serverThinkMs ?? DEFAULT_THINK_MS,
      connectionIndex: -1,
      streamId: undefined,
      headerBytesOnWire: 0,
      state: 'queued',
      queuedAt: t0,
      startedAt: -1,
      firstByteAt: -1,
      completedAt: -1,
      remaining: resource.responseBytes,
      lossAtRemaining: loss ? resource.responseBytes * (1 - loss.atFraction) : -1,
      lossFired: false,
      blockedMs: 0,
      ownStallMs: 0,
      holStallMs: 0,
      stalls: [],
    };
  });

  /** Requests each connection has carried -- what the header table indexes on. */
  const requestsOnConnection = new Array<number>(connectionCount).fill(0);
  /** HTTP/1.1 only: the task occupying each connection, or `undefined` when idle. */
  const occupant = new Array<number | undefined>(connectionCount).fill(undefined);
  /** Streams opened per connection, so ids stay odd and monotonic. */
  const streamIdsByConnection: number[][] = Array.from(
    { length: connectionCount },
    () => [],
  );
  /** TCP stalls the whole connection; QUIC stalls one stream. Both are recorded here. */
  const connectionStalledUntil = new Array<number>(connectionCount).fill(0);
  const taskStalledUntil = new Array<number>(tasks.length).fill(0);

  let now = t0;
  let completed = 0;
  let steps = 0;

  const isActive = (task: Task): boolean =>
    task.state === 'downloading' &&
    now >= taskStalledUntil[task.index] - EPSILON &&
    now >= connectionStalledUntil[task.connectionIndex] - EPSILON;

  const openExchanges = (): number =>
    tasks.filter((task) => task.state === 'waiting' || task.state === 'downloading')
      .length;

  const startWhatCan = (): void => {
    for (const task of tasks) {
      if (task.state !== 'queued') continue;

      let connectionIndex: number;
      if (profile.concurrentPerConnection === 1) {
        connectionIndex = occupant.findIndex((held) => held === undefined);
        // Nothing free. Every later request is behind this one, so stop looking: that
        // queue is exactly what application-layer head-of-line blocking is.
        if (connectionIndex === -1) return;
        occupant[connectionIndex] = task.index;
      } else {
        if (openExchanges() >= profile.concurrentPerConnection) return;
        connectionIndex = 0;
      }

      task.connectionIndex = connectionIndex;
      task.headerBytesOnWire = compressedHeaderBytes(
        version,
        requestsOnConnection[connectionIndex],
        task.rawHeaderBytes,
      );
      if (profile.concurrentPerConnection > 1) {
        task.streamId =
          FIRST_CLIENT_STREAM_ID +
          CLIENT_STREAM_ID_STEP * streamIdsByConnection[connectionIndex].length;
        streamIdsByConnection[connectionIndex].push(task.streamId);
      }
      requestsOnConnection[connectionIndex] += 1;

      task.startedAt = now;
      task.blockedMs = now - task.queuedAt;
      task.state = 'waiting';
      // Out to the server, the server's own think time, and back again. The request's
      // own bytes have to be clocked onto the wire too -- negligible for a bare GET,
      // and exactly the point being made about a cookie-heavy one.
      task.firstByteAt =
        now +
        halfRtt +
        (task.headerBytesOnWire * 8) / conditions.bandwidthKbps +
        task.thinkMs +
        halfRtt;
    }
  };

  const finish = (task: Task, at: number): void => {
    task.completedAt = at;
    task.state = 'done';
    task.remaining = 0;
    if (profile.concurrentPerConnection === 1) occupant[task.connectionIndex] = undefined;
    completed += 1;
  };

  startWhatCan();

  while (completed < tasks.length) {
    steps += 1;
    if (steps > MAX_SCHEDULER_STEPS) {
      throw new Error(
        `the ${version} scheduler did not converge after ${MAX_SCHEDULER_STEPS} steps`,
      );
    }

    const active = tasks.filter(isActive);
    const share = active.length > 0 ? bytesPerMs / active.length : 0;

    // The next moment anything changes.
    let next = Infinity;
    for (const task of tasks) {
      if (task.state === 'waiting') next = Math.min(next, task.firstByteAt);
      if (task.state === 'downloading' && !isActive(task)) {
        const until = Math.max(
          taskStalledUntil[task.index],
          connectionStalledUntil[task.connectionIndex],
        );
        if (until > now) next = Math.min(next, until);
      }
    }
    for (const task of active) {
      const stopAt =
        !task.lossFired &&
        task.lossAtRemaining >= 0 &&
        task.remaining > task.lossAtRemaining
          ? task.lossAtRemaining
          : 0;
      next = Math.min(next, now + (task.remaining - stopAt) / share);
    }

    if (!Number.isFinite(next)) {
      throw new Error(`the ${version} scheduler ran out of events with work outstanding`);
    }

    const dt = Math.max(0, next - now);

    // Drain the interval that just passed, and charge the stalled time to whichever
    // kind of blocking caused it. This is where the h2/h3 difference is measured.
    if (dt > 0) {
      for (const task of active) {
        task.remaining = Math.max(0, task.remaining - share * dt);
      }
      for (const task of tasks) {
        if (task.state !== 'downloading' || isActive(task)) continue;
        if (taskStalledUntil[task.index] > now) task.ownStallMs += dt;
        else task.holStallMs += dt;
        const record = task.stalls[task.stalls.length - 1];
        if (record) {
          task.stalls[task.stalls.length - 1] = { ...record, ms: record.ms + dt };
        }
      }
    }

    now = next;

    // Requests whose first byte has arrived start transferring. A zero-length body is
    // complete the instant its headers land, which is the entire economics of a
    // conditional request: a 304 costs one round trip and no content at all.
    for (const task of tasks) {
      if (task.state !== 'waiting' || task.firstByteAt > now + EPSILON) continue;
      task.state = 'downloading';
      if (task.remaining <= EPSILON) finish(task, now);
    }

    // Losses fire before completions, so a transfer that would have finished in the
    // same instant it lost a packet waits for the retransmission like any other.
    for (const task of tasks) {
      if (task.state !== 'downloading' || task.lossFired) continue;
      if (task.lossAtRemaining < 0) continue;
      if (task.remaining > task.lossAtRemaining + EPSILON) continue;
      task.lossFired = true;

      const recoveryMs = conditions.rttMs;
      taskStalledUntil[task.index] = now + recoveryMs;

      if (profile.hasTransportHol) {
        // TCP: the connection's byte stream now has a hole in it, so everything on the
        // connection waits -- including streams whose own bytes are already here.
        connectionStalledUntil[task.connectionIndex] = now + recoveryMs;
        for (const other of tasks) {
          if (other.state !== 'downloading') continue;
          if (other.connectionIndex !== task.connectionIndex) continue;
          other.stalls.push(
            other.index === task.index
              ? {
                  kind: 'own-loss',
                  atMs: round2(now),
                  ms: 0,
                  causedBy: task.resource.id,
                  explanation: `a segment of ${task.resource.label} was lost; this transfer waits ${recoveryMs} ms for the retransmission`,
                }
              : {
                  kind: 'transport-hol',
                  atMs: round2(now),
                  ms: 0,
                  causedBy: task.resource.id,
                  explanation: `a segment of ${task.resource.label} was lost on the same TCP connection: ${other.resource.label} has its own bytes, and TCP will not deliver them out of order`,
                },
          );
        }
      } else {
        // QUIC: the loss belongs to one stream, and only that stream waits.
        task.stalls.push({
          kind: 'own-loss',
          atMs: round2(now),
          ms: 0,
          causedBy: task.resource.id,
          explanation: `a packet of ${task.resource.label} was lost; QUIC recovers it on this stream alone and delivers every other stream untouched`,
        });
      }
    }

    for (const task of tasks) {
      if (task.state === 'downloading' && task.remaining <= EPSILON) finish(task, now);
    }

    startWhatCan();
  }

  const streams: StreamTiming[] = tasks.map((task) => ({
    resourceId: task.resource.id,
    label: task.resource.label,
    target: task.resource.target,
    connectionId: `${profile.alias}-conn-${task.connectionIndex}`,
    ...(task.streamId === undefined ? {} : { streamId: task.streamId }),
    queuedAt: round2(task.queuedAt),
    startedAt: round2(task.startedAt),
    firstByteAt: round2(task.firstByteAt),
    completedAt: round2(task.completedAt),
    responseBytes: task.resource.responseBytes,
    requestHeaderBytesRaw: task.rawHeaderBytes,
    requestHeaderBytesOnWire: task.headerBytesOnWire,
    blockedMs: round2(task.blockedMs),
    ownStallMs: round2(task.ownStallMs),
    holStallMs: round2(task.holStallMs),
    stalls: task.stalls.map((stall) => ({ ...stall, ms: round2(stall.ms) })),
  }));

  const connections: ConnectionTiming[] = Array.from(
    { length: connectionCount },
    (_unused, index) => ({
      id: `${profile.alias}-conn-${index}`,
      label:
        connectionCount === 1
          ? `${profile.alias} connection`
          : `${profile.alias} connection ${index + 1} of ${connectionCount}`,
      transport: profile.transport,
      readyAt: round2(t0),
      requestsServed: requestsOnConnection[index],
      streamIds: streamIdsByConnection[index],
    }),
  );

  const sum = (pick: (stream: StreamTiming) => number): number =>
    round2(streams.reduce((total, stream) => total + pick(stream), 0));

  const completedAt = round2(
    streams.reduce((latest, stream) => Math.max(latest, stream.completedAt), t0),
  );
  const applicationHolMs = sum((stream) => stream.blockedMs);
  const transportHolMs = sum((stream) => stream.holStallMs);

  return {
    version,
    profile,
    conditions,
    handshake,
    connections,
    streams,
    losses,
    completedAt,
    applicationHolMs,
    transportHolMs,
    ownStallMs: sum((stream) => stream.ownStallMs),
    requestHeaderBytesRaw: sum((stream) => stream.requestHeaderBytesRaw),
    requestHeaderBytesOnWire: sum((stream) => stream.requestHeaderBytesOnWire),
    explanation: explain(version, {
      streams,
      connectionCount,
      handshake,
      completedAt,
      applicationHolMs,
      transportHolMs,
      losses,
    }),
  };
}

/** The paragraph under a version's bar: what it did, in this run's own numbers. */
function explain(
  version: HttpVersion,
  run: {
    streams: readonly StreamTiming[];
    connectionCount: number;
    handshake: HandshakeCost;
    completedAt: number;
    applicationHolMs: number;
    transportHolMs: number;
    losses: readonly PacketLoss[];
  },
): string {
  const profile = VERSION_PROFILES[version];
  const count = run.streams.length;
  const queued = run.streams.filter((stream) => stream.blockedMs > EPSILON).length;
  const trips = run.handshake.roundTrips;
  const parts: string[] = [
    `${trips} round trip${trips === 1 ? '' : 's'} of setup (${run.handshake.ms} ms)`,
  ];

  if (profile.concurrentPerConnection === 1) {
    parts.push(
      `${run.connectionCount} connection${run.connectionCount === 1 ? '' : 's'} carrying one request at a time`,
      queued === 0
        ? `all ${count} requests fitted at once, so nothing queued`
        : `${queued} of ${count} requests waited for a connection to free, costing ${run.applicationHolMs} ms of application-layer head-of-line blocking`,
    );
  } else {
    parts.push(
      `${count} streams multiplexed over one ${profile.transport} connection`,
      queued === 0
        ? 'no request waited for another, so there is no application-layer head-of-line blocking at all'
        : `${queued} requests exceeded the concurrent-stream limit and queued for ${run.applicationHolMs} ms`,
    );
  }

  if (run.losses.length === 0) {
    parts.push('nothing was lost, so the transport made no difference here');
  } else if (profile.hasTransportHol) {
    parts.push(
      run.transportHolMs > EPSILON
        ? `${run.losses.length} lost packet(s) stalled streams that had nothing to do with them, for ${run.transportHolMs} ms in total -- TCP delivers in order or not at all`
        : `${run.losses.length} lost packet(s), each stalling only the one connection it happened on`,
    );
  } else {
    parts.push(
      `${run.losses.length} lost packet(s), recovered per stream: no other stream waited, so transport head-of-line blocking cost ${run.transportHolMs} ms`,
    );
  }

  return `${parts.join('; ')}. Last byte at ${run.completedAt} ms.`;
}

// ---------------------------------------------------------------------------
// The race
// ---------------------------------------------------------------------------

/** Where one version came in, and why. */
export interface VersionVerdict {
  readonly version: HttpVersion;
  readonly alias: VersionAlias;
  /** 1 for the fastest. */
  readonly rank: number;
  readonly completedAt: number;
  /** Milliseconds behind the fastest; `0` for the winner. */
  readonly deltaMs: number;
  /** This version's time as a percentage of the slowest version's. */
  readonly relative: number;
  readonly because: string;
}

/** The same page load, three ways. */
export interface VersionComparison {
  readonly resources: readonly ResourceRequest[];
  readonly conditions: NetworkConditions;
  readonly seed: number | string;
  readonly runs: Readonly<Record<HttpVersion, VersionRun>>;
  /** Fastest first. */
  readonly verdicts: readonly VersionVerdict[];
  readonly fastest: HttpVersion;
  readonly slowest: HttpVersion;
  /** The losses every run met. One draw, shared, so the comparison is a fair one. */
  readonly losses: readonly PacketLoss[];
}

/**
 * Run the same resources over all three versions and rank them.
 *
 * Ties break by the order in {@link HTTP_VERSIONS}, so a lossless uncongested link -- on
 * which h2 and h3 genuinely do finish together once the handshake is discounted --
 * reports h2 ahead of h3 rather than whichever way a sort happened to fall. Determinism
 * is the point of the whole file.
 */
export function compareVersions(init: {
  resources: readonly ResourceRequest[];
  conditions?: Partial<NetworkConditions>;
  seed: number | string;
}): VersionComparison {
  const conditions = withDefaults(init.conditions);
  const runs = Object.fromEntries(
    HTTP_VERSIONS.map((version) => [
      version,
      planVersionRun({ version, resources: init.resources, conditions, seed: init.seed }),
    ]),
  ) as Record<HttpVersion, VersionRun>;

  const ordered = [...HTTP_VERSIONS].sort((a, b) => {
    const byTime = runs[a].completedAt - runs[b].completedAt;
    if (Math.abs(byTime) > EPSILON) return byTime;
    return HTTP_VERSIONS.indexOf(a) - HTTP_VERSIONS.indexOf(b);
  });

  const fastest = runs[ordered[0]].completedAt;
  const slowest = runs[ordered[ordered.length - 1]].completedAt;

  const verdicts: VersionVerdict[] = ordered.map((version, index) => ({
    version,
    alias: VERSION_PROFILES[version].alias,
    rank: index + 1,
    completedAt: runs[version].completedAt,
    deltaMs: round2(runs[version].completedAt - fastest),
    relative: slowest === 0 ? 100 : round2((runs[version].completedAt / slowest) * 100),
    because: runs[version].explanation,
  }));

  return {
    resources: init.resources,
    conditions,
    seed: init.seed,
    runs,
    verdicts,
    fastest: ordered[0],
    slowest: ordered[ordered.length - 1],
    losses: runs['HTTP/1.1'].losses,
  };
}
