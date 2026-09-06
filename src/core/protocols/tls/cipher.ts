/**
 * Cipher suites -- the negotiated algorithms, and why the name got shorter.
 *
 * A cipher suite name looks like line noise until you learn that it is a list of the
 * algorithm choices a connection made, concatenated with underscores. Once it parses,
 * `TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256` stops being a string and becomes a sentence:
 * *ephemeral elliptic-curve Diffie-Hellman for key exchange, RSA for authentication, AES
 * with a 128-bit key in GCM mode for record protection, SHA-256 for the PRF.*
 *
 * ## The headline change in TLS 1.3
 *
 * TLS 1.3 suites have **two** components, not four:
 *
 * ```
 * TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256   <- TLS 1.2: kx _ auth _WITH_ cipher _ hash
 * TLS_AES_128_GCM_SHA256                  <- TLS 1.3: cipher _ hash
 * ```
 *
 * This is not cosmetic. RFC 8446 s B.4 separated the key-exchange and authentication
 * mechanisms out of the suite: they are negotiated independently, through the
 * `supported_groups` / `key_share` extensions and `signature_algorithms` respectively.
 * The suite now names only the AEAD algorithm and the hash used by both the
 * key-derivation function and the handshake MAC. The combinatorial explosion of TLS 1.2
 * -- hundreds of registered suites, most of them a bad idea -- collapses to the five in
 * {@link TLS13_SUITES}.
 *
 * ## Forward secrecy is a property of the key exchange, not the cipher
 *
 * {@link CipherSuite.forwardSecrecy} is the most consequential field here, and it depends
 * entirely on the `keyExchange` component. A static-RSA suite (`TLS_RSA_WITH_...`) has
 * the client encrypt the premaster secret to the server's long-lived certificate key.
 * Anyone who records that traffic and later obtains that key -- by subpoena, theft, or a
 * bug like Heartbleed -- decrypts every past session. An ephemeral suite (`ECDHE`) throws
 * its key-exchange private values away when the connection ends, so there is nothing left
 * to seize. Every TLS 1.3 suite has forward secrecy because TLS 1.3 removed static key
 * exchange entirely; there is no way to configure it off.
 *
 * ## No cryptography here
 *
 * This file describes algorithms; it does not contain any. `keyBits`, `ivBytes` and
 * `tagBytes` are the parameter *sizes* the real algorithms use, carried so `records.ts`
 * can compute honest overhead numbers. Nothing in this layer encrypts anything -- see
 * the notice in `keyschedule.ts`.
 */

import type { RfcRef } from '@/core/types/events';

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

/** RFC 8446 s B.4 -- the TLS 1.3 cipher suite registry entries. */
export const RFC_8446_SUITES: RfcRef = {
  rfc: 8446,
  section: 'B.4',
  title: 'The Transport Layer Security (TLS) Protocol Version 1.3',
};

/** RFC 5246 s A.5 -- the TLS 1.2 cipher suite naming scheme. */
export const RFC_5246_SUITES: RfcRef = {
  rfc: 5246,
  section: 'A.5',
  title: 'The Transport Layer Security (TLS) Protocol Version 1.2',
};

/** RFC 8996 -- TLS 1.0 and TLS 1.1 are formally deprecated. */
export const RFC_8996: RfcRef = {
  rfc: 8996,
  title: 'Deprecating TLS 1.0 and TLS 1.1',
};

// ---------------------------------------------------------------------------
// Protocol versions
// ---------------------------------------------------------------------------

/** The two versions this layer models end to end. */
export type TlsVersion = 'TLS 1.2' | 'TLS 1.3';

/**
 * The `legacy_record_version` every TLS 1.3 record carries.
 *
 * TLS 1.3 records are stamped `0x0303` -- "TLS 1.2" -- and TLS 1.3 is signalled by the
 * `supported_versions` extension instead (RFC 8446 s 4.1.2, s 5.1). The version field on
 * the wire is a fossil, kept for middleboxes that would drop anything unfamiliar. A
 * packet capture of a TLS 1.3 connection therefore *says* TLS 1.2 in every record header,
 * which is the most common misreading of a tcpdump there is.
 */
export const LEGACY_RECORD_VERSION = '0x0303';

// ---------------------------------------------------------------------------
// The parts of a name
// ---------------------------------------------------------------------------

/** How the record-protection algorithm is built. */
export type CipherMode =
  /** Galois/Counter Mode -- an AEAD: encryption and authentication in one pass. */
  | 'GCM'
  /** Poly1305 authenticating a ChaCha20 keystream -- also an AEAD. */
  | 'Poly1305'
  /** Counter with CBC-MAC -- an AEAD, used where AES hardware is absent. */
  | 'CCM'
  /**
   * Cipher Block Chaining with a separate HMAC. Not an AEAD: TLS 1.2 composed these
   * MAC-then-encrypt, the ordering behind Lucky 13 and the padding-oracle family. TLS 1.3
   * removed CBC suites entirely.
   */
  | 'CBC';

/** The key-agreement half of a TLS 1.2 suite name. */
export type KeyExchange =
  /** Ephemeral ECDH: a fresh key pair per connection, discarded afterwards. */
  | 'ECDHE'
  /** Ephemeral finite-field DH. Same property, much larger parameters. */
  | 'DHE'
  /**
   * Static RSA. The client encrypts the premaster secret to the certificate's public key.
   * No forward secrecy, and removed in TLS 1.3.
   */
  | 'RSA';

/** The authentication half of a TLS 1.2 suite name: which key signs the handshake. */
export type Authentication = 'RSA' | 'ECDSA';

/**
 * One cipher suite, decomposed.
 *
 * `keyExchange` and `authentication` are `undefined` for TLS 1.3 suites -- not because
 * TLS 1.3 lacks them, but because they are no longer part of the suite. That absence is
 * the thing `CipherSuiteBreakdown` should draw attention to.
 */
export interface CipherSuite {
  /** The IANA registered name, e.g. `TLS_AES_128_GCM_SHA256`. */
  readonly name: string;
  /** The two-octet code point as it appears in a ClientHello, e.g. `0x13,0x01`. */
  readonly codePoint: string;
  /** The version whose naming scheme this suite belongs to. */
  readonly version: TlsVersion;
  /** Key agreement. `undefined` on TLS 1.3 -- negotiated by `supported_groups`. */
  readonly keyExchange?: KeyExchange;
  /** Server authentication. `undefined` on TLS 1.3 -- by `signature_algorithms`. */
  readonly authentication?: Authentication;
  /** The bulk cipher, e.g. `AES` or `ChaCha20`. */
  readonly cipher: string;
  /** Symmetric key size in bits. */
  readonly keyBits: number;
  /** How the cipher is used. */
  readonly mode: CipherMode;
  /** The hash for HKDF and the Finished MAC, e.g. `SHA-256`. */
  readonly hash: string;
  /** Output size of `hash` in bytes -- the width of every secret in the key schedule. */
  readonly hashBytes: number;
  /** Nonce/IV length in bytes. 12 for every AEAD TLS 1.3 uses (RFC 8446 s 5.3). */
  readonly ivBytes: number;
  /** Authentication tag length in bytes -- pure per-record overhead. */
  readonly tagBytes: number;
  /** Whether a later compromise of the server's long-term key exposes past sessions. */
  readonly forwardSecrecy: boolean;
  /** Whether this suite is one a modern configuration should still offer. */
  readonly recommended: boolean;
  /** One sentence on what this suite is for, or why it is no longer acceptable. */
  readonly note: string;
}

// ---------------------------------------------------------------------------
// The TLS 1.3 catalogue -- RFC 8446 s B.4, in registry order
// ---------------------------------------------------------------------------

/**
 * All five suites TLS 1.3 defines. There are no others, and that is the point.
 *
 * Two matter in practice: `TLS_AES_128_GCM_SHA256`, which RFC 8446 s 9.1 makes
 * mandatory to implement, and `TLS_CHACHA20_POLY1305_SHA256`, the software fallback for
 * hardware without AES instructions, where constant-time AES is both slow and hard to
 * get right.
 */
export const TLS13_SUITES: readonly CipherSuite[] = [
  {
    name: 'TLS_AES_128_GCM_SHA256',
    codePoint: '0x13,0x01',
    version: 'TLS 1.3',
    cipher: 'AES',
    keyBits: 128,
    mode: 'GCM',
    hash: 'SHA-256',
    hashBytes: 32,
    ivBytes: 12,
    tagBytes: 16,
    forwardSecrecy: true,
    recommended: true,
    note: 'The default nearly everywhere, and the one suite RFC 8446 s 9.1 requires an implementation to support.',
  },
  {
    name: 'TLS_AES_256_GCM_SHA384',
    codePoint: '0x13,0x02',
    version: 'TLS 1.3',
    cipher: 'AES',
    keyBits: 256,
    mode: 'GCM',
    hash: 'SHA-384',
    hashBytes: 48,
    ivBytes: 12,
    tagBytes: 16,
    forwardSecrecy: true,
    recommended: true,
    note: 'A larger key and a wider hash. Chosen where policy asks for 256-bit symmetric strength; not otherwise stronger in practice.',
  },
  {
    name: 'TLS_CHACHA20_POLY1305_SHA256',
    codePoint: '0x13,0x03',
    version: 'TLS 1.3',
    cipher: 'ChaCha20',
    keyBits: 256,
    mode: 'Poly1305',
    hash: 'SHA-256',
    hashBytes: 32,
    ivBytes: 12,
    tagBytes: 16,
    forwardSecrecy: true,
    recommended: true,
    note: 'A stream cipher that is fast and constant-time in plain software. Preferred by mobile clients on CPUs without AES instructions.',
  },
  {
    name: 'TLS_AES_128_CCM_SHA256',
    codePoint: '0x13,0x04',
    version: 'TLS 1.3',
    cipher: 'AES',
    keyBits: 128,
    mode: 'CCM',
    hash: 'SHA-256',
    hashBytes: 32,
    ivBytes: 12,
    tagBytes: 16,
    forwardSecrecy: true,
    recommended: false,
    note: 'For constrained devices that already implement CCM for 802.15.4. Rare on the web.',
  },
  {
    name: 'TLS_AES_128_CCM_8_SHA256',
    codePoint: '0x13,0x05',
    version: 'TLS 1.3',
    cipher: 'AES',
    keyBits: 128,
    mode: 'CCM',
    hash: 'SHA-256',
    hashBytes: 32,
    ivBytes: 12,
    tagBytes: 8,
    forwardSecrecy: true,
    recommended: false,
    note: 'CCM with the tag truncated to 8 bytes to save bandwidth on constrained links. The shorter tag is a real reduction in forgery resistance.',
  },
];

// ---------------------------------------------------------------------------
// The TLS 1.2 catalogue -- enough to make the comparison honest
// ---------------------------------------------------------------------------

/**
 * A working subset of the TLS 1.2 registry: the suites a modern server still offers, and
 * the ones it must not.
 *
 * The registry has hundreds of entries. The interesting split is not among the good ones
 * -- it is between `ECDHE` and `RSA` in the first position, because that one word decides
 * whether a recorded session stays confidential after the server key leaks.
 */
export const TLS12_SUITES: readonly CipherSuite[] = [
  {
    name: 'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
    codePoint: '0xC0,0x2F',
    version: 'TLS 1.2',
    keyExchange: 'ECDHE',
    authentication: 'RSA',
    cipher: 'AES',
    keyBits: 128,
    mode: 'GCM',
    hash: 'SHA-256',
    hashBytes: 32,
    ivBytes: 12,
    tagBytes: 16,
    forwardSecrecy: true,
    recommended: true,
    note: 'The suite TLS 1.3 distilled into TLS_AES_128_GCM_SHA256: same record protection, with the key exchange and signature still spelled out in the name.',
  },
  {
    name: 'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256',
    codePoint: '0xC0,0x2B',
    version: 'TLS 1.2',
    keyExchange: 'ECDHE',
    authentication: 'ECDSA',
    cipher: 'AES',
    keyBits: 128,
    mode: 'GCM',
    hash: 'SHA-256',
    hashBytes: 32,
    ivBytes: 12,
    tagBytes: 16,
    forwardSecrecy: true,
    recommended: true,
    note: 'The same thing with an elliptic-curve certificate: a much smaller signature, and a much smaller Certificate message.',
  },
  {
    name: 'TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256',
    codePoint: '0xCC,0xA8',
    version: 'TLS 1.2',
    keyExchange: 'ECDHE',
    authentication: 'RSA',
    cipher: 'ChaCha20',
    keyBits: 256,
    mode: 'Poly1305',
    hash: 'SHA-256',
    hashBytes: 32,
    ivBytes: 12,
    tagBytes: 16,
    forwardSecrecy: true,
    recommended: true,
    note: 'The TLS 1.2 spelling of TLS_CHACHA20_POLY1305_SHA256 (RFC 7905).',
  },
  {
    name: 'TLS_RSA_WITH_AES_128_GCM_SHA256',
    codePoint: '0x00,0x9C',
    version: 'TLS 1.2',
    keyExchange: 'RSA',
    authentication: 'RSA',
    cipher: 'AES',
    keyBits: 128,
    mode: 'GCM',
    hash: 'SHA-256',
    hashBytes: 32,
    ivBytes: 12,
    tagBytes: 16,
    forwardSecrecy: false,
    recommended: false,
    note: 'Modern record protection with no forward secrecy: the client encrypts the premaster secret to the certificate key, so that one key decrypts every recorded session. Removed in TLS 1.3.',
  },
  {
    name: 'TLS_RSA_WITH_AES_128_CBC_SHA',
    codePoint: '0x00,0x2F',
    version: 'TLS 1.2',
    keyExchange: 'RSA',
    authentication: 'RSA',
    cipher: 'AES',
    keyBits: 128,
    mode: 'CBC',
    hash: 'SHA-1',
    hashBytes: 20,
    ivBytes: 16,
    tagBytes: 20,
    forwardSecrecy: false,
    recommended: false,
    note: 'No forward secrecy, MAC-then-encrypt CBC (the Lucky 13 and padding-oracle family), and SHA-1. Unacceptable on all three counts.',
  },
  {
    name: 'TLS_RSA_WITH_3DES_EDE_CBC_SHA',
    codePoint: '0x00,0x0A',
    version: 'TLS 1.2',
    keyExchange: 'RSA',
    authentication: 'RSA',
    cipher: '3DES',
    keyBits: 112,
    mode: 'CBC',
    hash: 'SHA-1',
    hashBytes: 20,
    ivBytes: 8,
    tagBytes: 20,
    forwardSecrecy: false,
    recommended: false,
    note: 'A 64-bit block cipher, which is what Sweet32 exploits: block collisions become likely inside a single long-lived connection. Retired.',
  },
];

/** Every suite this layer knows, TLS 1.3 first. */
export const ALL_SUITES: readonly CipherSuite[] = [...TLS13_SUITES, ...TLS12_SUITES];

/** The suite the TLS 1.3 scenarios negotiate unless told otherwise. */
export const DEFAULT_TLS13_SUITE = 'TLS_AES_128_GCM_SHA256';

/** The suite the TLS 1.2 comparison negotiates unless told otherwise. */
export const DEFAULT_TLS12_SUITE = 'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256';

/** Look up a suite by its registered name. */
export function getCipherSuite(name: string): CipherSuite | undefined {
  return ALL_SUITES.find((suite) => suite.name === name);
}

/** The suites belonging to one version's naming scheme. */
export function suitesForVersion(version: TlsVersion): readonly CipherSuite[] {
  return version === 'TLS 1.3' ? TLS13_SUITES : TLS12_SUITES;
}

// ---------------------------------------------------------------------------
// Decomposition -- what CipherSuiteBreakdown draws
// ---------------------------------------------------------------------------

/** One labelled piece of a suite name, with the substring it came from. */
export interface SuiteComponent {
  /** What this piece decides, e.g. `Key exchange`. */
  readonly role: string;
  /** The literal token in the name, e.g. `ECDHE`. `undefined` when absent in TLS 1.3. */
  readonly token?: string;
  /** The expanded value, e.g. `Ephemeral elliptic-curve Diffie-Hellman`. */
  readonly value: string;
  /** Why this piece matters. */
  readonly explain: string;
  /**
   * True when TLS 1.3 moved this decision out of the suite name. The breakdown should
   * still render the row -- greyed, with `negotiatedBy` -- rather than omit it, because
   * "where did ECDHE go?" is the question the view exists to answer.
   */
  readonly movedOutOfSuiteName: boolean;
  /** For moved components, the extension that now carries the decision. */
  readonly negotiatedBy?: string;
}

const KEY_EXCHANGE_TEXT: Readonly<Record<KeyExchange, string>> = {
  ECDHE: 'Ephemeral elliptic-curve Diffie-Hellman',
  DHE: 'Ephemeral finite-field Diffie-Hellman',
  RSA: 'Static RSA key transport',
};

const AUTHENTICATION_TEXT: Readonly<Record<Authentication, string>> = {
  RSA: 'RSA signature over the handshake transcript',
  ECDSA: 'ECDSA signature over the handshake transcript',
};

const MODE_TEXT: Readonly<Record<CipherMode, string>> = {
  GCM: 'Galois/Counter Mode -- an AEAD, so encryption and authentication are one operation over one key',
  Poly1305: 'Poly1305 authenticating a ChaCha20 keystream -- also an AEAD',
  CCM: 'Counter with CBC-MAC -- an AEAD aimed at constrained devices',
  CBC: 'Cipher Block Chaining with a bolted-on HMAC -- not an AEAD, and gone in TLS 1.3',
};

/** Reassemble the record-protection tokens the way the registered name spells them. */
function protectionToken(suite: CipherSuite): string {
  if (suite.cipher === 'ChaCha20') return 'CHACHA20_POLY1305';
  return `${suite.cipher.toUpperCase()}_${suite.keyBits}_${suite.mode}`;
}

/**
 * Break a suite into the rows `CipherSuiteBreakdown` renders.
 *
 * Always returns the same four roles in the same order regardless of version, so the 1.2
 * and 1.3 breakdowns line up row for row and the two empty rows in the 1.3 column read as
 * a deliberate absence rather than as a shorter list.
 */
export function decomposeSuite(suite: CipherSuite): readonly SuiteComponent[] {
  const tls13 = suite.version === 'TLS 1.3';
  return [
    {
      role: 'Key exchange',
      token: suite.keyExchange,
      value: suite.keyExchange
        ? KEY_EXCHANGE_TEXT[suite.keyExchange]
        : 'Not in the name -- (EC)DHE, always ephemeral',
      explain: tls13
        ? 'TLS 1.3 does only ephemeral key exchange, so there was nothing left to choose between here. The group (X25519, P-256, ...) is offered in supported_groups and key_share.'
        : suite.forwardSecrecy
          ? 'A fresh key pair per connection, thrown away at the end. Recording the traffic today buys nothing if the server key leaks tomorrow.'
          : 'The client encrypts the premaster secret to the long-term certificate key. That one key decrypts every session ever recorded -- no forward secrecy.',
      movedOutOfSuiteName: tls13,
      negotiatedBy: tls13
        ? 'supported_groups / key_share extensions (RFC 8446 s 4.2.7, s 4.2.8)'
        : undefined,
    },
    {
      role: 'Authentication',
      token: suite.authentication,
      value: suite.authentication
        ? AUTHENTICATION_TEXT[suite.authentication]
        : 'Not in the name -- whatever key the certificate holds',
      explain: tls13
        ? 'The signature algorithm is offered in signature_algorithms and used in CertificateVerify, so it no longer constrains suite selection.'
        : 'Which key type the server certificate must hold. An ECDSA certificate cannot satisfy an RSA suite, which is why dual-certificate servers offer both.',
      movedOutOfSuiteName: tls13,
      negotiatedBy: tls13
        ? 'signature_algorithms extension (RFC 8446 s 4.2.3)'
        : undefined,
    },
    {
      role: 'Record protection',
      token: protectionToken(suite),
      value: `${suite.cipher}, ${suite.keyBits}-bit key, ${suite.mode}`,
      explain: MODE_TEXT[suite.mode],
      movedOutOfSuiteName: false,
    },
    {
      role: 'Hash',
      token: suite.hash.replace('-', ''),
      value: `${suite.hash} (${suite.hashBytes}-byte output)`,
      explain: tls13
        ? 'Used by HKDF throughout the key schedule and by the Finished MAC. It sets the width of every secret in keyschedule.ts.'
        : 'Used by the TLS 1.2 PRF and the Finished MAC. SHA-1 here is a red flag; SHA-256 or better is the baseline.',
      movedOutOfSuiteName: false,
    },
  ];
}

/** How many components a version's naming scheme spells out. Two for 1.3, four for 1.2. */
export function namedComponentCount(version: TlsVersion): number {
  return version === 'TLS 1.3' ? 2 : 4;
}

// ---------------------------------------------------------------------------
// Parsing a name that is not in the catalogue
// ---------------------------------------------------------------------------

/** What {@link parseCipherSuiteName} could recover from a name it does not know. */
export interface ParsedSuiteName {
  readonly name: string;
  /** Inferred from whether the name contains `_WITH_`. */
  readonly version: TlsVersion;
  readonly keyExchange?: KeyExchange;
  readonly authentication?: Authentication;
  readonly cipher?: string;
  readonly keyBits?: number;
  readonly mode?: CipherMode;
  readonly hash?: string;
  /** True when the name did not parse into a shape either scheme allows. */
  readonly malformed: boolean;
}

/**
 * Split a suite name into its parts by the naming grammar alone.
 *
 * The `_WITH_` separator is the discriminator: TLS 1.2 names have it and TLS 1.3 names do
 * not (RFC 8446 s B.4). Prefer {@link getCipherSuite} for suites in the catalogue -- this
 * exists so the breakdown view can still say something useful about a suite pasted in
 * from a packet capture.
 */
export function parseCipherSuiteName(name: string): ParsedSuiteName {
  const known = getCipherSuite(name);
  if (known) {
    return {
      name,
      version: known.version,
      keyExchange: known.keyExchange,
      authentication: known.authentication,
      cipher: known.cipher,
      keyBits: known.keyBits,
      mode: known.mode,
      hash: known.hash,
      malformed: false,
    };
  }

  if (!name.startsWith('TLS_')) {
    return { name, version: 'TLS 1.3', malformed: true };
  }

  const body = name.slice('TLS_'.length);
  const withIndex = body.indexOf('_WITH_');
  const version: TlsVersion = withIndex === -1 ? 'TLS 1.3' : 'TLS 1.2';

  const protectionPart =
    withIndex === -1 ? body : body.slice(withIndex + '_WITH_'.length);
  const protection = parseProtection(protectionPart);
  if (!protection) {
    return { name, version, malformed: true };
  }

  if (withIndex === -1) {
    return { name, version, ...protection, malformed: false };
  }

  const exchange = parseExchange(body.slice(0, withIndex));
  if (!exchange) {
    return { name, version, ...protection, malformed: true };
  }
  return { name, version, ...exchange, ...protection, malformed: false };
}

function parseExchange(
  part: string,
): { keyExchange: KeyExchange; authentication: Authentication } | undefined {
  const tokens = part.split('_');
  if (tokens.length === 1 && tokens[0] === 'RSA') {
    // `TLS_RSA_WITH_...`: one token doing both jobs -- key transport and authentication.
    return { keyExchange: 'RSA', authentication: 'RSA' };
  }
  if (tokens.length !== 2) return undefined;
  const [kx, auth] = tokens;
  if (kx !== 'ECDHE' && kx !== 'DHE' && kx !== 'RSA') return undefined;
  if (auth !== 'RSA' && auth !== 'ECDSA') return undefined;
  return { keyExchange: kx, authentication: auth };
}

function parseProtection(
  part: string,
): { cipher: string; keyBits: number; mode: CipherMode; hash: string } | undefined {
  const tokens = part.split('_');
  const hashMatch = /^SHA(\d*)$/.exec(tokens[tokens.length - 1] ?? '');
  if (!hashMatch) return undefined;
  const hash = hashMatch[1] ? `SHA-${hashMatch[1]}` : 'SHA-1';

  const rest = tokens.slice(0, -1);
  if (rest[0] === 'CHACHA20' && rest[1] === 'POLY1305') {
    return { cipher: 'ChaCha20', keyBits: 256, mode: 'Poly1305', hash };
  }

  const modeToken = rest[rest.length - 1];
  const mode =
    modeToken === 'GCM' || modeToken === 'CBC' || modeToken === 'CCM'
      ? modeToken
      : undefined;
  if (!mode) return undefined;

  const keyBits = Number(rest[rest.length - 2]);
  if (!Number.isInteger(keyBits) || keyBits <= 0) return undefined;

  const cipher = rest.slice(0, -2).join('_');
  return { cipher: cipher || 'AES', keyBits, mode, hash };
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * Pick the suite a server would negotiate.
 *
 * The **server** chooses, from the client's offered list, in the *server's* preference
 * order -- not the client's. That is deliberate: it lets an operator retire a weak suite
 * unilaterally, without waiting for every client on the Internet to stop offering it.
 */
export function negotiateSuite(
  clientOffers: readonly string[],
  serverPreference: readonly string[],
): CipherSuite | undefined {
  for (const candidate of serverPreference) {
    if (clientOffers.includes(candidate)) {
      const suite = getCipherSuite(candidate);
      if (suite) return suite;
    }
  }
  return undefined;
}

/**
 * Per-record byte cost a TLS 1.3 AEAD adds to the plaintext.
 *
 * The tag, plus the one byte of `TLSInnerPlaintext.type` that TLS 1.3 appends to the
 * content before encrypting it (RFC 8446 s 5.2). Padding is separate and optional.
 */
export function recordExpansionBytes(suite: CipherSuite): number {
  return suite.tagBytes + 1;
}
