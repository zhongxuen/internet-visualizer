/**
 * The record layer -- the envelope everything else travels in.
 *
 * HTTPS is not a protocol. It is HTTP, unchanged, handed to TLS in five-byte-headed
 * chunks. Every handshake message, every alert, and every byte of the request and
 * response in this layer goes through the same small structure:
 *
 * ```
 *  0      1      3            5
 *  +------+------+------------+-------------------------------+
 *  | type | legacy_version    | length (uint16) | fragment    |
 *  +------+------+------------+-------------------------------+
 *   1 byte   2 bytes            2 bytes           <= 2^14 bytes
 * ```
 *
 * That is the entire framing mechanism, and understanding it answers most of what people
 * find mysterious about HTTPS -- including why an observer can still see so much.
 *
 * ## The one clever bit: the content type moves inside
 *
 * In TLS 1.2, `type` on the wire tells you honestly what a record holds -- handshake,
 * alert, or application data -- even when the payload is encrypted. That leaks the shape
 * of the conversation.
 *
 * TLS 1.3 changed it (RFC 8446 s 5.2). The real type is appended to the *plaintext*, as
 * `TLSInnerPlaintext.type`, and encrypted along with it. The outer `opaque_type` is then
 * hardcoded to `application_data(23)` on every protected record, whatever it actually
 * holds. So a TLS 1.3 capture shows a stream of records all claiming to be application
 * data, and an observer cannot tell a Finished from a POST body from an alert. That is
 * modelled here as the {@link TlsRecord.innerType} / {@link TlsRecord.outerType} pair,
 * and it is what makes {@link observerView} so much emptier for 1.3 than for 1.2.
 *
 * ## Deliberately not typed to HTTP
 *
 * {@link recordsForPlaintext} takes a **string of bytes**, not an `HttpRequest`. Partly
 * that is the architecture boundary -- `eslint.config.mjs` forbids `src/core` from
 * importing a module, so this layer cannot reach for an `HttpRequest` even if it wanted
 * one -- but mostly it is that the boundary is real. The record layer genuinely does not
 * know or care what is inside; it frames opaque bytes. A record layer that had to know
 * about HTTP to encrypt it would be modelling something that does not exist.
 *
 * ## No encryption happens here
 *
 * {@link TlsRecord.ciphertext} is a placeholder string. Byte *counts* are computed
 * honestly -- header, padding, AEAD tag, the extra inner type byte -- because those are
 * observable and worth teaching. The bytes themselves are fake. See `placeholder.ts`.
 */

import type { RfcRef } from '@/core/types/events';

import { LEGACY_RECORD_VERSION, type CipherSuite, type TlsVersion } from './cipher';
import { placeholderCiphertext } from './placeholder';

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

/** RFC 8446 s 5.1 -- record layer framing. */
export const RFC_8446_RECORDS: RfcRef = {
  rfc: 8446,
  section: '5.1',
  title: 'The Transport Layer Security (TLS) Protocol Version 1.3',
};

/** RFC 8446 s 5.2 -- record payload protection and TLSInnerPlaintext. */
export const RFC_8446_PROTECTION: RfcRef = { ...RFC_8446_RECORDS, section: '5.2' };

/** RFC 8446 s 5.3 -- per-record nonce construction. */
export const RFC_8446_NONCE: RfcRef = { ...RFC_8446_RECORDS, section: '5.3' };

/** RFC 8446 s 5.4 -- record padding. */
export const RFC_8446_PADDING: RfcRef = { ...RFC_8446_RECORDS, section: '5.4' };

/** RFC 8446 s 6 -- the alert protocol. */
export const RFC_8446_ALERT: RfcRef = { ...RFC_8446_RECORDS, section: '6' };

// ---------------------------------------------------------------------------
// Content types
// ---------------------------------------------------------------------------

/** The `ContentType` enum (RFC 8446 s 5.1). */
export type ContentType =
  'invalid' | 'change_cipher_spec' | 'alert' | 'handshake' | 'application_data';

/** The registered numeric value of each content type. */
export const CONTENT_TYPE_VALUES: Readonly<Record<ContentType, number>> = {
  invalid: 0,
  change_cipher_spec: 20,
  alert: 21,
  handshake: 22,
  application_data: 23,
};

/** `handshake(22)`, formatted the way a packet dissector prints it. */
export function formatContentType(type: ContentType): string {
  return `${type}(${CONTENT_TYPE_VALUES[type]})`;
}

// ---------------------------------------------------------------------------
// Limits (RFC 8446 s 5.1, s 5.2)
// ---------------------------------------------------------------------------

/** The five-byte record header: 1 type + 2 legacy_record_version + 2 length. */
export const RECORD_HEADER_BYTES = 5;

/** `TLSPlaintext.fragment` may not exceed 2^14 bytes. */
export const MAX_PLAINTEXT_FRAGMENT = 2 ** 14;

/**
 * `TLSCiphertext.length` may not exceed 2^14 + 256.
 *
 * The 256 is the allowance for AEAD expansion plus the inner content type plus padding. A
 * record larger than this must be rejected with a `record_overflow` alert -- a bound that
 * exists so a peer cannot be made to buffer arbitrary amounts before it can authenticate
 * anything.
 */
export const MAX_CIPHERTEXT_LENGTH = 2 ** 14 + 256;

/** The one byte of `TLSInnerPlaintext.type` appended before encryption (RFC 8446 s 5.2). */
export const INNER_TYPE_BYTES = 1;

// ---------------------------------------------------------------------------
// Protection level
// ---------------------------------------------------------------------------

/**
 * Which key a record is protected under, or none.
 *
 * The whole "when does encryption begin" question reduces to where the first non-`none`
 * record appears in the stream. In TLS 1.3 that is the record immediately after
 * ServerHello; in TLS 1.2 it is after ChangeCipherSpec, a full round trip later.
 */
export type ProtectionLevel = 'none' | 'early-data' | 'handshake' | 'application';

/** Human labels for the record list. */
export const PROTECTION_LABELS: Readonly<Record<ProtectionLevel, string>> = {
  none: 'Plaintext',
  'early-data': '0-RTT (client_early_traffic_secret)',
  handshake: 'Handshake keys',
  application: 'Application keys',
};

/** Whether a record's payload is encrypted at all. */
export function isProtected(level: ProtectionLevel): boolean {
  return level !== 'none';
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

/** One TLS record. */
export interface TlsRecord {
  readonly id: string;
  /** Which direction it travels. */
  readonly from: 'client' | 'server';
  /**
   * What the record really holds. In a protected TLS 1.3 record this lives inside the
   * encryption as `TLSInnerPlaintext.type` and an observer cannot see it.
   */
  readonly innerType: ContentType;
  /**
   * What the record header says. Equal to {@link innerType} when unprotected or under
   * TLS 1.2; always `application_data` on a protected TLS 1.3 record (RFC 8446 s 5.2).
   */
  readonly outerType: ContentType;
  /** Always `0x0303`, whatever version is really in use. See `cipher.ts`. */
  readonly legacyVersion: string;
  readonly protection: ProtectionLevel;
  /**
   * The payload before protection. Present so the participant view can show it; it is
   * what the sender had, not what an observer sees.
   */
  readonly plaintext?: string;
  /** Length of {@link plaintext} in bytes. */
  readonly plaintextBytes: number;
  /** Padding added before encryption (RFC 8446 s 5.4). */
  readonly paddingBytes: number;
  /** AEAD tag plus, on TLS 1.3, the inner type byte. Zero when unprotected. */
  readonly expansionBytes: number;
  /** The `length` field in the header: everything after the five-byte header. */
  readonly length: number;
  /** Header plus payload -- what the TCP segment carries. */
  readonly totalBytes: number;
  /** Opaque placeholder bytes. Not ciphertext. */
  readonly ciphertext?: string;
  /**
   * The record sequence number.
   *
   * Not transmitted in TLS 1.3: both sides count records under the current key and XOR
   * the counter into the static IV to form the per-record nonce (RFC 8446 s 5.3). A
   * dropped or reordered record therefore fails to authenticate, which is how the record
   * layer detects tampering with the *order* of a conversation, not just its contents.
   */
  readonly sequenceNumber: number;
  /** A short label for the record list, e.g. `ServerHello`. */
  readonly label: string;
}

// ---------------------------------------------------------------------------
// Framing
// ---------------------------------------------------------------------------

/** Byte length of a string, counting UTF-8 code units the way the wire does. */
export function byteLength(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** Everything {@link makeRecord} needs that it cannot compute. */
export interface RecordInit {
  readonly id: string;
  readonly from: 'client' | 'server';
  readonly innerType: ContentType;
  readonly protection: ProtectionLevel;
  readonly label: string;
  readonly version: TlsVersion;
  readonly suite: CipherSuite;
  readonly sequenceNumber: number;
  /** The payload, when there is text to show. */
  readonly plaintext?: string;
  /** Payload size, when there is no text -- a handshake message, say. */
  readonly plaintextBytes?: number;
  /** Padding to add before encryption. Defaults to none. */
  readonly paddingBytes?: number;
}

/**
 * Build one record and compute its honest byte accounting.
 *
 * The overhead numbers are the point of this function. A 40-byte HTTP request line
 * becomes a 62-byte record under AES-128-GCM: 5 header + 40 payload + 1 inner type + 16
 * tag. Small records are mostly overhead, which is why TLS implementations coalesce
 * writes, and why an observer counting bytes learns less than a naive reading suggests --
 * but still learns something, which is what padding is for.
 */
export function makeRecord(init: RecordInit): TlsRecord {
  const protectedRecord = isProtected(init.protection);
  const tls13 = init.version === 'TLS 1.3';

  const plaintextBytes =
    init.plaintextBytes ??
    (init.plaintext !== undefined ? byteLength(init.plaintext) : 0);
  const paddingBytes = protectedRecord ? (init.paddingBytes ?? 0) : 0;

  // TLS 1.3 appends the real content type inside the encryption; TLS 1.2 does not.
  const expansionBytes = protectedRecord
    ? init.suite.tagBytes + (tls13 ? INNER_TYPE_BYTES : 0)
    : 0;

  const length = plaintextBytes + paddingBytes + expansionBytes;

  // Only TLS 1.3 disguises the outer type. Under TLS 1.2 the header stays honest even
  // when the payload is encrypted, which is exactly the leak 1.3 closed.
  const outerType =
    protectedRecord && tls13 ? ('application_data' as const) : init.innerType;

  return {
    id: init.id,
    from: init.from,
    innerType: init.innerType,
    outerType,
    legacyVersion: LEGACY_RECORD_VERSION,
    protection: init.protection,
    plaintext: init.plaintext,
    plaintextBytes,
    paddingBytes,
    expansionBytes,
    length,
    totalBytes: RECORD_HEADER_BYTES + length,
    ciphertext: protectedRecord
      ? placeholderCiphertext(`${init.id}-ciphertext`, length)
      : undefined,
    sequenceNumber: init.sequenceNumber,
    label: init.label,
  };
}

/** Whether a record exceeds the limit its protection level is bound by. */
export function exceedsLimit(record: TlsRecord): boolean {
  return isProtected(record.protection)
    ? record.length > MAX_CIPHERTEXT_LENGTH
    : record.length > MAX_PLAINTEXT_FRAGMENT;
}

// ---------------------------------------------------------------------------
// Wrapping application bytes -- the HTTPS part of HTTPS
// ---------------------------------------------------------------------------

/** Options for {@link recordsForPlaintext}. */
export interface WrapOptions {
  readonly from: 'client' | 'server';
  readonly version: TlsVersion;
  readonly suite: CipherSuite;
  /** Which keys protect these records. Defaults to `application`. */
  readonly protection?: ProtectionLevel;
  /** Sequence number of the first record produced. Defaults to 0. */
  readonly startSequence?: number;
  /** Prefix for generated record ids. */
  readonly idPrefix: string;
  /** Label for the record list, e.g. `HTTP request`. */
  readonly label: string;
  /**
   * Bytes of padding to add to each record (RFC 8446 s 5.4).
   *
   * Padding exists because record *lengths* are visible and leak. A 312-byte response and
   * a 4,096-byte response are distinguishable through the encryption, and for a small,
   * known set of possible responses -- which page of a site, which of a few search terms
   * -- that can be enough to identify the plaintext. Padding to a fixed block costs
   * bandwidth and buys back some of that. Almost nothing does it, which is itself worth
   * saying out loud.
   */
  readonly paddingBytes?: number;
}

/**
 * Fragment application bytes into records.
 *
 * The input is a plain string because the record layer has no idea what it is carrying;
 * pass a serialized HTTP message, a WebSocket frame, or anything else. Records are capped
 * at {@link MAX_PLAINTEXT_FRAGMENT}, so a large response really does become several
 * records -- which is visible to an observer as a burst of similarly sized records, one
 * of the signals traffic analysis uses.
 */
export function recordsForPlaintext(
  plaintext: string,
  options: WrapOptions,
): readonly TlsRecord[] {
  const protection = options.protection ?? 'application';
  const start = options.startSequence ?? 0;

  const fragments = fragmentByBytes(plaintext, MAX_PLAINTEXT_FRAGMENT);
  return fragments.map((fragment, index) =>
    makeRecord({
      id: `${options.idPrefix}-${index}`,
      from: options.from,
      innerType: 'application_data',
      protection,
      label:
        fragments.length === 1
          ? options.label
          : `${options.label} (fragment ${index + 1} of ${fragments.length})`,
      version: options.version,
      suite: options.suite,
      sequenceNumber: start + index,
      plaintext: fragment,
      paddingBytes: options.paddingBytes,
    }),
  );
}

/** Split text into chunks of at most `limit` bytes, never splitting a code point. */
function fragmentByBytes(text: string, limit: number): string[] {
  if (byteLength(text) <= limit) return [text];
  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const character of text) {
    const size = byteLength(character);
    if (currentBytes + size > limit) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }
    current += character;
    currentBytes += size;
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Total bytes a run of records puts on the wire, overhead included. */
export function totalWireBytes(records: readonly TlsRecord[]): number {
  return records.reduce((sum, record) => sum + record.totalBytes, 0);
}

/** Bytes of actual payload in a run of records. */
export function totalPayloadBytes(records: readonly TlsRecord[]): number {
  return records.reduce((sum, record) => sum + record.plaintextBytes, 0);
}

/**
 * The proportion of a run that is framing rather than content.
 *
 * Worth surfacing: for one small request it is substantial, and for a megabyte response
 * it rounds to nothing. Both facts matter -- the first explains why chatty protocols hurt
 * over TLS, the second explains why nobody worries about TLS overhead on bulk transfer.
 */
export function overheadRatio(records: readonly TlsRecord[]): number {
  const total = totalWireBytes(records);
  if (total === 0) return 0;
  return (total - totalPayloadBytes(records)) / total;
}

// ---------------------------------------------------------------------------
// The nonce
// ---------------------------------------------------------------------------

/** How the per-record nonce is built (RFC 8446 s 5.3). Structure only; no values. */
export interface NonceConstruction {
  readonly sequenceNumber: number;
  /** The static per-connection IV from the key schedule. */
  readonly staticIv: string;
  /** How the two combine. */
  readonly formula: string;
  readonly explain: string;
}

/** Describe the nonce for one record. */
export function nonceFor(record: TlsRecord, staticIv: string): NonceConstruction {
  return {
    sequenceNumber: record.sequenceNumber,
    staticIv,
    formula: `nonce = static_iv XOR left-pad(sequence_number = ${record.sequenceNumber})`,
    explain:
      'The sequence number is never transmitted -- both sides count records under the current key and reconstruct the same nonce. That is why a replayed, reordered, or dropped record fails to authenticate: it would be decrypted under the wrong nonce. It is also why the record layer must be reset on a key change, and why KeyUpdate exists rather than letting the counter run forever.',
  };
}

// ---------------------------------------------------------------------------
// The observer view -- what HTTPS does not hide
// ---------------------------------------------------------------------------

/**
 * Everything a passive eavesdropper can read off one record.
 *
 * This is the honest half of the encryption overlay. HTTPS hides contents; it does not
 * hide that a conversation is happening, with whom, how big it is, or when. Building the
 * observer view by *deleting* fields from the real record -- rather than writing a
 * separate hand-authored fiction -- is what keeps the overlay accurate: a field is
 * visible here only if the model says it is on the wire in the clear.
 */
export interface ObservedRecord {
  readonly id: string;
  readonly from: 'client' | 'server';
  /** The outer header type. On TLS 1.3 this is `application_data` for everything. */
  readonly type: string;
  readonly legacyVersion: string;
  /** Visible, always. Lengths are the main leak that survives encryption. */
  readonly length: number;
  readonly totalBytes: number;
  /** The opaque payload. */
  readonly payload: string;
  /** Present only when the record really was in the clear. */
  readonly plaintext?: string;
  /** Whether an observer can tell what kind of message this is. */
  readonly typeIsHonest: boolean;
}

/** Reduce a record to what an eavesdropper actually sees. */
export function observerView(record: TlsRecord): ObservedRecord {
  const encrypted = isProtected(record.protection);
  return {
    id: record.id,
    from: record.from,
    type: formatContentType(record.outerType),
    legacyVersion: record.legacyVersion,
    length: record.length,
    totalBytes: record.totalBytes,
    payload: encrypted
      ? (record.ciphertext ?? placeholderCiphertext(`${record.id}-opaque`, record.length))
      : (record.plaintext ?? `<${record.plaintextBytes} bytes>`),
    plaintext: encrypted ? undefined : record.plaintext,
    typeIsHonest: !encrypted || record.outerType === record.innerType,
  };
}

/** One thing an observer learns, and whether encryption took it away. */
export interface ObserverFact {
  readonly label: string;
  readonly visible: boolean;
  readonly value?: string;
  readonly detail: string;
}

/** What {@link observerFacts} needs to know about the connection around the records. */
export interface ObserverContext {
  readonly version: TlsVersion;
  /** The destination address the TCP connection went to. */
  readonly serverIp: string;
  /** The hostname in the SNI extension, if one was sent unencrypted. */
  readonly sni?: string;
  /** True when Encrypted Client Hello concealed the SNI. */
  readonly echUsed?: boolean;
  /** The negotiated ALPN protocol, if visible. */
  readonly alpn?: string;
  readonly suite?: string;
}

/**
 * The full answer to "what does HTTPS actually hide?"
 *
 * The `visible: true` entries are the important half. A learner who comes away thinking
 * HTTPS makes them anonymous has learned something worse than nothing, and the honest
 * list is short enough to state plainly: the address, the hostname, the timing, and the
 * sizes all survive.
 */
export function observerFacts(
  records: readonly TlsRecord[],
  context: ObserverContext,
): readonly ObserverFact[] {
  const tls13 = context.version === 'TLS 1.3';
  const sniVisible = Boolean(context.sni) && context.echUsed !== true;
  const payloadBytes = totalWireBytes(records);

  return [
    {
      label: 'Destination IP address',
      visible: true,
      value: context.serverIp,
      detail:
        'In the IP header, outside TLS entirely. TLS protects the payload of a connection; it cannot hide who the connection is to. Reverse-resolving this address is often enough to identify the site on its own.',
    },
    {
      label: 'Hostname (SNI)',
      visible: sniVisible,
      value: sniVisible ? context.sni : 'concealed by Encrypted Client Hello',
      detail: sniVisible
        ? 'Sent in the clear in the ClientHello, because the server needs it to choose which certificate to present -- before any keys exist. This is the single largest thing HTTPS does not hide, and the reason SNI-based filtering works. Encrypted Client Hello (ECH) closes it, but is not yet widely deployed.'
        : 'Encrypted Client Hello wraps the real ClientHello, including SNI, under a key published in DNS. The observer sees only the outer, public-facing name.',
    },
    {
      label: 'Timing and traffic pattern',
      visible: true,
      value: `${records.length} record${records.length === 1 ? '' : 's'}`,
      detail:
        'When each record was sent, and the gaps between them. Enough on its own to distinguish a page load from a video stream from an idle connection, and enough for website fingerprinting against a known set of candidate pages.',
    },
    {
      label: 'Sizes',
      visible: true,
      value: `${payloadBytes} bytes on the wire`,
      detail:
        'Record lengths are in the cleartext header and cannot be hidden, only obscured. Padding (RFC 8446 s 5.4) exists precisely for this and is almost never used, because it costs real bandwidth to defeat an attack most operators do not model.',
    },
    {
      label: 'Negotiated version and cipher suite',
      visible: true,
      value: context.suite,
      detail:
        'Both Hello messages are in the clear, so the suite, the supported_versions choice, and both key shares are all readable. None of that helps decrypt anything -- but it does fingerprint the client, and a ClientHello is distinctive enough to identify the browser and often its version.',
    },
    {
      label: 'ALPN protocol (h2 / http/1.1)',
      visible: !tls13,
      value: tls13 ? 'inside EncryptedExtensions' : context.alpn,
      detail: tls13
        ? 'TLS 1.3 moved ALPN into EncryptedExtensions, under handshake keys, so the observer cannot see which application protocol was chosen. In TLS 1.2 it is in the cleartext ServerHello.'
        : 'Negotiated in the clear in TLS 1.2. An observer can tell HTTP/2 from HTTP/1.1 before any request is sent.',
    },
    {
      label: 'Server certificate and identity',
      visible: !tls13,
      detail: tls13
        ? 'TLS 1.3 sends Certificate under handshake keys, one flight after ServerHello. An observer sees a record of some length and nothing more.'
        : 'TLS 1.2 sends the full certificate chain in plaintext, before any keys exist. Every SAN, the issuer, the validity window, and the public key are all copied by anyone watching.',
    },
    {
      label: 'Which kind of message each record holds',
      visible: !tls13,
      detail: tls13
        ? 'TLS 1.3 encrypts the real content type as TLSInnerPlaintext.type and stamps every protected record application_data(23). A Finished, an alert, and a POST body are indistinguishable (RFC 8446 s 5.2).'
        : 'The TLS 1.2 record header names the real content type even for encrypted records, so an observer can follow the structure of the conversation and spot alerts and rekeys.',
    },
    {
      label: 'URL path, headers, cookies, and body',
      visible: false,
      detail:
        'All of it is inside the application-data records. This is what HTTPS actually protects, and it is the part people worry about least.',
    },
  ];
}

/** Just the things HTTPS fails to hide -- the list the overlay leads with. */
export function stillVisible(
  records: readonly TlsRecord[],
  context: ObserverContext,
): readonly ObserverFact[] {
  return observerFacts(records, context).filter((fact) => fact.visible);
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

/** An alert record's two bytes (RFC 8446 s 6). */
export interface AlertRecord {
  /** `warning(1)` or `fatal(2)`. Every alert in TLS 1.3 but `close_notify` is fatal. */
  readonly level: 'warning' | 'fatal';
  readonly description: string;
  readonly code: number;
  readonly explain: string;
}

/** Build an alert, defaulting to fatal as TLS 1.3 requires for everything but closure. */
export function alert(
  description: string,
  code: number,
  explain: string,
  level: 'warning' | 'fatal' = 'fatal',
): AlertRecord {
  return { level, description, code, explain };
}

/** `close_notify(0)` -- the orderly shutdown that distinguishes EOF from truncation. */
export const CLOSE_NOTIFY: AlertRecord = alert(
  'close_notify',
  0,
  'Says the sender is done writing. Without it a receiver cannot tell a finished response from a connection an attacker cut short -- the truncation attack that made HTTP/1.0 over TLS unsafe to length-guess.',
  'warning',
);
