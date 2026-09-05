/**
 * The key schedule -- how both sides end up holding the same keys without sending them.
 *
 * This is the part of TLS that sounds like magic and is not. Two strangers, on a wire
 * somebody is recording, agree on a secret. Everything the recorder captured is
 * insufficient to reconstruct it. There is no trick and no trusted third party; there is
 * one asymmetry, applied once, and then a lot of careful bookkeeping.
 *
 * The module splits it in two, because they are genuinely two different ideas:
 *
 * 1. **{@link dheExchange}** -- the asymmetry. Both sides send a public value, keep a
 *    private one, and combine them to reach the same shared secret. The observer sees
 *    both public values and cannot get there. This is the only step where mathematics
 *    does any work.
 * 2. **{@link buildKeySchedule}** -- the bookkeeping. That one shared secret is fed
 *    through HKDF, mixed with the transcript of everything said so far, and expanded into
 *    a dozen named secrets and then into actual record keys (RFC 8446 s 7.1, s 7.3).
 *    No cleverness, just discipline: every key is bound to the exact conversation that
 *    produced it, so a message replayed into a different conversation will not decrypt.
 *
 * ## The observer column is the point
 *
 * Every {@link KeyScheduleStep} carries three knowledge sets -- client, server, observer
 * -- and `KeyScheduleDiagram` renders them as three columns. The story they tell is that
 * the observer's column is *never empty*: an eavesdropper sees a great deal, including
 * both public key shares and the entire handshake transcript up to ServerHello. What it
 * never acquires is either private value, and that is enough. Showing the observer as
 * knowing nothing would be a comforting lie and would make the design look arbitrary.
 *
 * ## Why the transcript is mixed into every secret
 *
 * `Derive-Secret` takes a hash of every handshake message so far. That is what makes the
 * handshake *authenticated*: if an attacker altered any byte of any message, both sides
 * compute different transcript hashes, derive different `finished` keys, and the Finished
 * messages fail to verify. Downgrade attacks that rewrite the ClientHello die here rather
 * than needing a special rule.
 *
 * ## NOT REAL CRYPTOGRAPHY
 *
 * Every secret below is {@link placeholderSecret} -- a labelled FNV-1a hash. See
 * `placeholder.ts` and {@link PLACEHOLDER_NOTICE}. {@link TOY_DH_GROUP} is a five-bit
 * group you can break in your head; it exists so the arithmetic of Diffie-Hellman is
 * *visible*, and it is kept rigorously separate from {@link NamedGroup}, which is what a
 * real connection negotiates. Nothing here protects anything.
 */

import type { RfcRef } from '@/core/types/events';

import type { CipherSuite } from './cipher';
import {
  PLACEHOLDER_NOTICE,
  placeholderKeyShare,
  placeholderSecret,
} from './placeholder';

export { PLACEHOLDER_NOTICE };

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

/** RFC 8446 s 7.1 -- the key schedule. */
export const RFC_8446_KEY_SCHEDULE: RfcRef = {
  rfc: 8446,
  section: '7.1',
  title: 'The Transport Layer Security (TLS) Protocol Version 1.3',
};

/** RFC 8446 s 7.3 -- traffic key calculation. */
export const RFC_8446_TRAFFIC_KEYS: RfcRef = { ...RFC_8446_KEY_SCHEDULE, section: '7.3' };

/** RFC 8446 s 4.2.8 -- the key_share extension. */
export const RFC_8446_KEY_SHARE: RfcRef = { ...RFC_8446_KEY_SCHEDULE, section: '4.2.8' };

/** RFC 5869 -- HKDF, the extract-then-expand construction TLS 1.3 uses throughout. */
export const RFC_5869: RfcRef = {
  rfc: 5869,
  title: 'HMAC-based Extract-and-Expand Key Derivation Function (HKDF)',
};

/** RFC 5246 s 8.1 -- the TLS 1.2 master secret and PRF. */
export const RFC_5246_MASTER_SECRET: RfcRef = {
  rfc: 5246,
  section: '8.1',
  title: 'The Transport Layer Security (TLS) Protocol Version 1.2',
};

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

/** The (EC)DHE groups a modern ClientHello offers (RFC 8446 s 4.2.7). */
export type NamedGroup = 'x25519' | 'secp256r1' | 'secp384r1' | 'ffdhe2048';

/** What a group is and why a client would pick it. */
export interface GroupInfo {
  readonly name: NamedGroup;
  readonly label: string;
  /** Size of the public key share on the wire, in bytes. */
  readonly shareBytes: number;
  readonly note: string;
}

/** The groups this module knows, in the order a browser offers them. */
export const NAMED_GROUPS: readonly GroupInfo[] = [
  {
    name: 'x25519',
    label: 'X25519',
    shareBytes: 32,
    note: 'The default nearly everywhere: a 32-byte share, fast, and with no invalid-curve or point-format footguns to get wrong.',
  },
  {
    name: 'secp256r1',
    label: 'NIST P-256',
    shareBytes: 65,
    note: 'The older elliptic curve, still ubiquitous. An uncompressed point is 65 bytes.',
  },
  {
    name: 'secp384r1',
    label: 'NIST P-384',
    shareBytes: 97,
    note: 'P-256 with a larger field, where policy asks for it.',
  },
  {
    name: 'ffdhe2048',
    label: 'Finite-field DHE 2048',
    shareBytes: 256,
    note: 'Classic Diffie-Hellman over integers. Eight times the bytes of X25519 for comparable strength, which is why elliptic curves won.',
  },
];

/** Look up a group. */
export function getGroup(name: NamedGroup): GroupInfo {
  return NAMED_GROUPS.find((group) => group.name === name) ?? NAMED_GROUPS[0];
}

// ---------------------------------------------------------------------------
// The toy Diffie-Hellman illustration
// ---------------------------------------------------------------------------

/**
 * A five-bit Diffie-Hellman group, provided so the arithmetic can be shown.
 *
 * **This is not, and is not intended to be, secure.** A 5-bit modulus has 23 possible
 * values; you can recover the private exponent by trying all of them on paper in under a
 * minute. It exists for exactly one reason: `KeyScheduleDiagram` can print
 * `5^6 mod 23 = 8` and a learner can check it, which turns "both sides compute the same
 * secret" from an assertion into something they verified themselves.
 *
 * A real connection uses {@link NamedGroup} -- X25519 and friends, with 256-bit private
 * values. The two are kept in separate types on purpose so no code path can confuse them.
 */
export const TOY_DH_GROUP = {
  /** A 5-bit prime modulus. Real groups are 256 bits and up. */
  p: 23,
  /** A generator of the group. */
  g: 5,
} as const;

/** One side's toy Diffie-Hellman values. */
export interface ToyDhSide {
  /** The private exponent. Never sent. In a real connection this is 256 random bits. */
  readonly privateValue: number;
  /** `g^private mod p` -- the public share, which really does go on the wire. */
  readonly publicValue: number;
}

/** `base^exponent mod modulus`, by repeated squaring, on numbers small enough to trust. */
function modPow(base: number, exponent: number, modulus: number): number {
  let result = 1;
  let b = base % modulus;
  let e = exponent;
  while (e > 0) {
    if (e % 2 === 1) result = (result * b) % modulus;
    b = (b * b) % modulus;
    e = Math.floor(e / 2);
  }
  return result;
}

/** Derive a toy side's public value from its private exponent. */
export function toySide(privateValue: number): ToyDhSide {
  return {
    privateValue,
    publicValue: modPow(TOY_DH_GROUP.g, privateValue, TOY_DH_GROUP.p),
  };
}

/**
 * The illustration in full: two sides, and the fact that both routes reach the same number.
 *
 * `(g^a)^b` and `(g^b)^a` are both `g^ab`, which is why the client computing
 * `serverPublic^clientPrivate` and the server computing `clientPublic^serverPrivate`
 * agree. The observer holds `g^a` and `g^b` and would need a discrete logarithm to get
 * either exponent -- easy at `p = 23`, believed infeasible at 256 bits.
 */
export interface ToyDhIllustration {
  readonly group: typeof TOY_DH_GROUP;
  readonly client: ToyDhSide;
  readonly server: ToyDhSide;
  /** What the client computes: `serverPublic ^ clientPrivate mod p`. */
  readonly clientComputes: number;
  /** What the server computes: `clientPublic ^ serverPrivate mod p`. */
  readonly serverComputes: number;
  /** True whenever the arithmetic is right, which is always. Asserted by the tests. */
  readonly agree: boolean;
  /** Renderable lines, in the order the diagram should reveal them. */
  readonly lines: readonly string[];
  readonly caveat: string;
}

/** Default private exponents for the illustration. Fixed, so the numbers never move. */
export const TOY_CLIENT_PRIVATE = 6;

/** Default server private exponent for the illustration. */
export const TOY_SERVER_PRIVATE = 15;

/** Build the toy illustration. Deterministic. */
export function toyDhIllustration(
  clientPrivate: number = TOY_CLIENT_PRIVATE,
  serverPrivate: number = TOY_SERVER_PRIVATE,
): ToyDhIllustration {
  const { p, g } = TOY_DH_GROUP;
  const client = toySide(clientPrivate);
  const server = toySide(serverPrivate);
  const clientComputes = modPow(server.publicValue, clientPrivate, p);
  const serverComputes = modPow(client.publicValue, serverPrivate, p);

  return {
    group: TOY_DH_GROUP,
    client,
    server,
    clientComputes,
    serverComputes,
    agree: clientComputes === serverComputes,
    lines: [
      `Public parameters, sent in the clear: p = ${p}, g = ${g}`,
      `Client picks a = ${clientPrivate} and keeps it. Sends g^a mod p = ${g}^${clientPrivate} mod ${p} = ${client.publicValue}`,
      `Server picks b = ${serverPrivate} and keeps it. Sends g^b mod p = ${g}^${serverPrivate} mod ${p} = ${server.publicValue}`,
      `Client computes ${server.publicValue}^${clientPrivate} mod ${p} = ${clientComputes}`,
      `Server computes ${client.publicValue}^${serverPrivate} mod ${p} = ${serverComputes}`,
      `Both reached ${clientComputes}. The observer holds ${client.publicValue} and ${server.publicValue} and neither exponent.`,
    ],
    caveat: `A 5-bit group, breakable by trying all ${p} values by hand. It is here so the arithmetic is checkable, not because it protects anything -- a real connection uses X25519 with 256-bit exponents.`,
  };
}

// ---------------------------------------------------------------------------
// The real exchange (modelled)
// ---------------------------------------------------------------------------

/** The result of the (EC)DHE exchange as the handshake models it. */
export interface DheExchange {
  readonly group: GroupInfo;
  /** The client's `key_share`, sent in ClientHello. Public, and on the wire. */
  readonly clientShare: string;
  /** The server's `key_share`, sent in ServerHello. Public, and on the wire. */
  readonly serverShare: string;
  /**
   * The shared secret both sides compute and neither sends. A placeholder value; the
   * modelled fact is that both sides have it and the observer does not.
   */
  readonly sharedSecret: string;
  /** The toy arithmetic, for the diagram. */
  readonly illustration: ToyDhIllustration;
  /** What the observer holds after watching the exchange. */
  readonly observerHolds: readonly string[];
  /** Why holding those is not enough. */
  readonly whyObserverFails: string;
}

/**
 * Model one (EC)DHE exchange.
 *
 * `label` distinguishes one connection's exchange from another's so the placeholder
 * values differ between, say, a fresh handshake and a resumed one -- which matters,
 * because "the resumed connection still does a fresh key exchange" is the reason 0-RTT
 * resumption keeps forward secrecy for everything after the early data.
 */
export function dheExchange(group: NamedGroup, label: string): DheExchange {
  const info = getGroup(group);
  return {
    group: info,
    clientShare: placeholderKeyShare(`${label}-client-${group}`, info.shareBytes),
    serverShare: placeholderKeyShare(`${label}-server-${group}`, info.shareBytes),
    sharedSecret: placeholderSecret(`${label}-shared-secret`, 32),
    illustration: toyDhIllustration(),
    observerHolds: [
      `Client key_share (${info.label}, ${info.shareBytes} bytes) -- sent in the clear`,
      `Server key_share (${info.label}, ${info.shareBytes} bytes) -- sent in the clear`,
      'The chosen group, the cipher suite, and every byte of both Hello messages',
    ],
    whyObserverFails:
      'Deriving the shared secret from the two public shares is the Diffie-Hellman problem. There is no known way to do it for X25519 in less than astronomically long -- and, crucially, no amount of *recording* helps, because the private values were never transmitted and are discarded when the connection ends.',
  };
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

/** Which stage of the schedule a secret belongs to. */
export type SecretStage = 'early' | 'handshake' | 'application' | 'resumption';

/** One derived secret. */
export interface DerivedSecret {
  /** The name RFC 8446 s 7.1 gives it, e.g. `client_handshake_traffic_secret`. */
  readonly name: string;
  /** The `Derive-Secret` label, e.g. `"c hs traffic"`. */
  readonly label: string;
  /** The placeholder value. Not a secret. */
  readonly value: string;
  /** Width in bytes -- the negotiated hash's output length. */
  readonly bytes: number;
  readonly stage: SecretStage;
  /** The derivation written out, e.g. `Derive-Secret(Handshake Secret, "c hs traffic", ClientHello..ServerHello)`. */
  readonly derivation: string;
  /** The transcript this secret is bound to, or `""` where the label takes none. */
  readonly transcript: string;
  /** What it is for. */
  readonly purpose: string;
}

/**
 * A pair of record-protection keys derived from one traffic secret (RFC 8446 s 7.3).
 *
 * The `iv` is not a nonce. It is a static value XORed with the record sequence number to
 * produce the per-record nonce, which is how TLS 1.3 avoids putting an explicit nonce in
 * every record header -- the sequence number is implicit, because both sides count.
 */
export interface TrafficKeys {
  /** The traffic secret these were expanded from. */
  readonly from: string;
  /** `HKDF-Expand-Label(secret, "key", "", key_length)`. Placeholder. */
  readonly key: string;
  /** `HKDF-Expand-Label(secret, "iv", "", iv_length)`. Placeholder. */
  readonly iv: string;
  readonly keyBytes: number;
  readonly ivBytes: number;
  readonly whoWrites: 'client' | 'server';
}

/** `HKDF-Expand-Label(secret, "key"|"iv", "", length)` -- structure only. */
export function trafficKeysFrom(
  secret: DerivedSecret,
  suite: CipherSuite,
  whoWrites: 'client' | 'server',
): TrafficKeys {
  return {
    from: secret.name,
    key: placeholderSecret(`${secret.label}-key`, suite.keyBits / 8),
    iv: placeholderSecret(`${secret.label}-iv`, suite.ivBytes),
    keyBytes: suite.keyBits / 8,
    ivBytes: suite.ivBytes,
    whoWrites,
  };
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/** The three parties whose knowledge the diagram tracks. */
export type Party = 'client' | 'server' | 'observer';

/**
 * One moment in the derivation, with what each party holds at that moment.
 *
 * The three arrays are the whole payload of `KeyScheduleDiagram`. They must be written so
 * that reading down the observer column tells an honest story: it starts nearly as full
 * as the others and then stops growing, at exactly the step where the private values
 * enter.
 */
export interface KeyScheduleStep {
  readonly id: string;
  readonly title: string;
  /** What happens here, in a sentence or two. */
  readonly explain: string;
  readonly clientKnows: readonly string[];
  readonly serverKnows: readonly string[];
  readonly observerKnows: readonly string[];
  /** The secret this step produces, if it produces one. */
  readonly output?: DerivedSecret;
  /** Traffic keys this step expands, if any. */
  readonly keys?: readonly TrafficKeys[];
  readonly reference: RfcRef;
}

/** The full schedule for one connection. */
export interface KeySchedule {
  readonly suite: CipherSuite;
  readonly exchange?: DheExchange;
  /** True when a pre-shared key seeded the Early Secret (resumption). */
  readonly usedPsk: boolean;
  /** True when 0-RTT early data was protected under `client_early_traffic_secret`. */
  readonly usedEarlyData: boolean;
  readonly steps: readonly KeyScheduleStep[];
  readonly secrets: readonly DerivedSecret[];
  /** Every stand-in value on screen is fake; this is the sentence that says so. */
  readonly notice: string;
}

// ---------------------------------------------------------------------------
// Building the schedule -- RFC 8446 s 7.1
// ---------------------------------------------------------------------------

/** What {@link buildKeySchedule} needs to know about the connection. */
export interface KeyScheduleInput {
  readonly suite: CipherSuite;
  /** The group, when a fresh (EC)DHE exchange happens. Omit for PSK-only resumption. */
  readonly group?: NamedGroup;
  /** True when a ticket supplied a pre-shared key. */
  readonly psk?: boolean;
  /** True when the client sent 0-RTT data. Requires `psk`. */
  readonly earlyData?: boolean;
  /** Distinguishes one connection's placeholder values from another's. */
  readonly label?: string;
}

const HKDF_EXTRACT_NOTE =
  'HKDF-Extract(salt, input) concentrates whatever entropy its input has into one uniform value of the hash width. HKDF-Expand-Label then stretches that into as many named, independent secrets as are needed (RFC 5869; RFC 8446 s 7.1).';

function secret(
  name: string,
  label: string,
  stage: SecretStage,
  transcript: string,
  purpose: string,
  bytes: number,
  connection: string,
): DerivedSecret {
  return {
    name,
    label,
    value: placeholderSecret(`${connection}-${label}`, bytes),
    bytes,
    stage,
    derivation: `Derive-Secret(., "${label}", ${transcript || '""'})`,
    transcript,
    purpose,
  };
}

/**
 * Build the TLS 1.3 key schedule.
 *
 * Follows RFC 8446 s 7.1 exactly in shape: three `HKDF-Extract` stages chained through
 * `Derive-Secret(., "derived", "")`, each one salted by the previous stage's output.
 *
 * ```
 *              0
 *              |
 *    PSK ->  Extract  = Early Secret          <- resumption enters here
 *              |
 *      Derive-Secret(., "derived", "")
 *              |
 * (EC)DHE -> Extract  = Handshake Secret      <- forward secrecy enters here
 *              |
 *      Derive-Secret(., "derived", "")
 *              |
 *      0 -> Extract   = Master Secret
 * ```
 *
 * The two inputs on the left are what make the two properties independent. A resumed
 * connection with no fresh key exchange gets its Handshake Secret from a PSK alone and
 * has **no forward secrecy** for that connection; the same resumption *with* a key_share
 * -- which is what clients actually do -- restores it. That is why the 0-RTT caveat is
 * about the early data specifically and not about the whole session.
 */
export function buildKeySchedule(input: KeyScheduleInput): KeySchedule {
  const { suite } = input;
  const width = suite.hashBytes;
  const connection = input.label ?? 'tls13';
  const usedPsk = input.psk === true;
  const usedEarlyData = usedPsk && input.earlyData === true;
  const exchange = input.group ? dheExchange(input.group, connection) : undefined;

  const steps: KeyScheduleStep[] = [];
  const secrets: DerivedSecret[] = [];

  const transcriptToServerHello = 'ClientHello..ServerHello';
  const transcriptToServerFinished = 'ClientHello..server Finished';
  const transcriptToClientFinished = 'ClientHello..client Finished';

  // -- Stage 1: Early Secret ------------------------------------------------

  const earlySecret = secret(
    'Early Secret',
    'early secret',
    'early',
    '',
    usedPsk
      ? 'Seeded by the pre-shared key from a previous session ticket. Everything 0-RTT depends on hangs off this.'
      : 'Seeded with zeros, because there is no PSK. It exists so the schedule has the same shape whether or not resumption is in play.',
    width,
    connection,
  );
  secrets.push(earlySecret);

  steps.push({
    id: 'early-secret',
    title: 'Early Secret',
    explain: usedPsk
      ? `HKDF-Extract(salt = 0, IKM = PSK). The pre-shared key came from a NewSessionTicket on an earlier connection, so both sides already had it before this one started -- which is exactly why 0-RTT can send data before hearing back. ${HKDF_EXTRACT_NOTE}`
      : `HKDF-Extract(salt = 0, IKM = ${width} zero bytes). With no PSK the input is all zeros, so this secret carries no entropy at all. It is a placeholder in the real protocol too, kept so the schedule has one shape rather than two. ${HKDF_EXTRACT_NOTE}`,
    clientKnows: usedPsk
      ? ['The PSK, from a ticket it stored earlier', 'Early Secret']
      : [
          'Nothing secret yet -- the input is all zeros',
          'Early Secret (carries no entropy)',
        ],
    serverKnows: usedPsk
      ? ['The PSK, recovered from the ticket the client echoed', 'Early Secret']
      : [
          'Nothing secret yet -- the input is all zeros',
          'Early Secret (carries no entropy)',
        ],
    observerKnows: usedPsk
      ? [
          'The ticket identity and the obfuscated ticket age from the ClientHello',
          'Not the PSK itself -- it was never transmitted, only referenced',
        ]
      : [
          'That there was no PSK extension',
          'The Early Secret, in fact -- it is a hash of zeros, and public',
        ],
    output: earlySecret,
    reference: RFC_8446_KEY_SCHEDULE,
  });

  if (usedEarlyData) {
    const earlyTraffic = secret(
      'client_early_traffic_secret',
      'c e traffic',
      'early',
      'ClientHello',
      'Protects 0-RTT application data, sent before the server has said anything at all.',
      width,
      connection,
    );
    secrets.push(earlyTraffic);

    steps.push({
      id: 'early-traffic',
      title: 'client_early_traffic_secret -- the 0-RTT keys',
      explain:
        'Derived from the Early Secret and the ClientHello alone. That is the whole trick of 0-RTT and also its whole problem: because it depends on nothing the server contributed, the client can encrypt with it immediately -- and because it depends on nothing the server contributed, the server cannot tell a fresh request from a recorded one replayed an hour later. RFC 8446 s 8 and s 2.3 spell out the anti-replay measures a server must add itself.',
      clientKnows: ['Early Secret', 'client_early_traffic_secret', '0-RTT write keys'],
      serverKnows: [
        'Nothing yet -- it has not received the ClientHello',
        '(after receiving it: the same secret, and the ability to decrypt the early data)',
      ],
      observerKnows: [
        'That early data records exist, and their sizes and timing',
        'Not their contents',
        'That replaying this whole flight verbatim may cause the server to act twice',
      ],
      output: earlyTraffic,
      keys: [trafficKeysFrom(earlyTraffic, suite, 'client')],
      reference: { ...RFC_8446_KEY_SCHEDULE, section: '2.3' },
    });
  }

  // -- The key exchange itself ----------------------------------------------

  if (exchange) {
    steps.push({
      id: 'dhe',
      title: '(EC)DHE key exchange',
      explain: `Each side generates a key pair for ${exchange.group.label}, sends the public half in a key_share extension, and keeps the private half. Both then combine their own private value with the other side's public value and arrive at the same shared secret. ${exchange.whyObserverFails}`,
      clientKnows: [
        'Its own private value (never sent, discarded when the connection ends)',
        'The server key_share',
        'The shared secret',
      ],
      serverKnows: [
        'Its own private value (never sent, discarded when the connection ends)',
        'The client key_share',
        'The shared secret',
      ],
      observerKnows: [
        ...exchange.observerHolds,
        'Neither private value, and therefore not the shared secret',
      ],
      reference: RFC_8446_KEY_SHARE,
    });
  }

  // -- Stage 2: Handshake Secret --------------------------------------------

  const handshakeSecret = secret(
    'Handshake Secret',
    'handshake secret',
    'handshake',
    '',
    'The first secret in the schedule an observer cannot compute. Everything after it is protected.',
    width,
    connection,
  );
  secrets.push(handshakeSecret);

  steps.push({
    id: 'handshake-secret',
    title: 'Handshake Secret',
    explain: exchange
      ? 'HKDF-Extract(salt = Derive-Secret(Early Secret, "derived", ""), IKM = the (EC)DHE shared secret). This is the moment the schedule stops being public. Note the salt: the previous stage is not discarded but folded in, so a resumed connection binds its new keys to the PSK as well as to the fresh exchange.'
      : 'HKDF-Extract(salt = Derive-Secret(Early Secret, "derived", ""), IKM = zeros). With no fresh key exchange, everything downstream rests on the PSK alone -- so this connection has no forward secrecy. Clients avoid this by sending a key_share alongside the PSK.',
    clientKnows: ['Handshake Secret'],
    serverKnows: ['Handshake Secret'],
    observerKnows: exchange
      ? [
          'The transcript so far, in the clear',
          'Neither input to this extraction, and so not the Handshake Secret',
          'Everything from here on is opaque',
        ]
      : [
          'The transcript so far, in the clear',
          'Not the PSK, and so not the Handshake Secret',
          'But: anyone who later obtains the PSK can derive this retroactively',
        ],
    output: handshakeSecret,
    reference: RFC_8446_KEY_SCHEDULE,
  });

  const clientHandshake = secret(
    'client_handshake_traffic_secret',
    'c hs traffic',
    'handshake',
    transcriptToServerHello,
    'Protects the rest of the client half of the handshake -- its Finished, and EndOfEarlyData if there was any.',
    width,
    connection,
  );
  const serverHandshake = secret(
    'server_handshake_traffic_secret',
    's hs traffic',
    'handshake',
    transcriptToServerHello,
    'Protects EncryptedExtensions, Certificate, CertificateVerify and Finished -- everything the server says after ServerHello.',
    width,
    connection,
  );
  secrets.push(clientHandshake, serverHandshake);

  steps.push({
    id: 'handshake-traffic',
    title: 'Handshake traffic keys -- encryption starts here',
    explain:
      'Both secrets are bound to the transcript ClientHello..ServerHello, so they exist only after both Hello messages have been exchanged -- and immediately after, which is why TLS 1.3 can encrypt the server certificate. In TLS 1.2 the certificate crosses the wire in the clear; here everything from EncryptedExtensions onwards is already protected.',
    clientKnows: [
      'client_handshake_traffic_secret and its key/iv',
      'server_handshake_traffic_secret and its key/iv',
    ],
    serverKnows: [
      'server_handshake_traffic_secret and its key/iv',
      'client_handshake_traffic_secret and its key/iv',
    ],
    observerKnows: [
      'Both Hello messages in full: the SNI hostname, the cipher suite, the ALPN protocol, both key shares',
      'From here on, only record types, lengths, and timing',
      'Not the certificate, not the negotiated extensions, not the identity of the server',
    ],
    output: serverHandshake,
    keys: [
      trafficKeysFrom(clientHandshake, suite, 'client'),
      trafficKeysFrom(serverHandshake, suite, 'server'),
    ],
    reference: RFC_8446_TRAFFIC_KEYS,
  });

  // -- Stage 3: Master Secret -----------------------------------------------

  const masterSecret = secret(
    'Master Secret',
    'master secret',
    'application',
    '',
    'The root of the application-data keys and the resumption secret.',
    width,
    connection,
  );
  secrets.push(masterSecret);

  steps.push({
    id: 'master-secret',
    title: 'Master Secret',
    explain:
      'HKDF-Extract(salt = Derive-Secret(Handshake Secret, "derived", ""), IKM = zeros). No new entropy enters -- this stage exists to give the application keys a root that is one derivation removed from the handshake keys, so compromising a handshake key does not hand over the application keys.',
    clientKnows: ['Master Secret'],
    serverKnows: ['Master Secret'],
    observerKnows: ['Still nothing beyond the cleartext Hellos'],
    output: masterSecret,
    reference: RFC_8446_KEY_SCHEDULE,
  });

  const clientApp = secret(
    'client_application_traffic_secret_0',
    'c ap traffic',
    'application',
    transcriptToServerFinished,
    'Protects everything the client sends after the handshake -- the HTTP request, in this module.',
    width,
    connection,
  );
  const serverApp = secret(
    'server_application_traffic_secret_0',
    's ap traffic',
    'application',
    transcriptToServerFinished,
    'Protects everything the server sends after the handshake -- the HTTP response.',
    width,
    connection,
  );
  const exporter = secret(
    'exporter_master_secret',
    'exp master',
    'application',
    transcriptToServerFinished,
    'Lets an application derive its own keys bound to this TLS session, without TLS knowing what for.',
    width,
    connection,
  );
  const resumption = secret(
    'resumption_master_secret',
    'res master',
    'resumption',
    transcriptToClientFinished,
    'The seed for any NewSessionTicket. The PSK in a future resumed handshake comes from here.',
    width,
    connection,
  );
  secrets.push(clientApp, serverApp, exporter, resumption);

  steps.push({
    id: 'application-traffic',
    title: 'Application traffic keys',
    explain:
      'Bound to the transcript through the server Finished, so they cannot be computed until the entire handshake -- including the certificate and the signature over it -- has been seen and accepted. The trailing `_0` is not decoration: KeyUpdate (RFC 8446 s 4.6.3) ratchets to `_1`, `_2`, and so on, and the old key cannot be recovered from the new one.',
    clientKnows: [
      'client_application_traffic_secret_0 and its key/iv',
      'server_application_traffic_secret_0 and its key/iv',
      'exporter_master_secret',
    ],
    serverKnows: [
      'server_application_traffic_secret_0 and its key/iv',
      'client_application_traffic_secret_0 and its key/iv',
      'exporter_master_secret',
    ],
    observerKnows: [
      'That application data is flowing',
      'How much, in which direction, and when',
      'The destination IP address and the SNI hostname it saw earlier',
      'Nothing about the contents',
    ],
    output: clientApp,
    keys: [
      trafficKeysFrom(clientApp, suite, 'client'),
      trafficKeysFrom(serverApp, suite, 'server'),
    ],
    reference: RFC_8446_TRAFFIC_KEYS,
  });

  steps.push({
    id: 'resumption',
    title: 'resumption_master_secret',
    explain:
      'Bound to the transcript through the *client* Finished -- the last message of the handshake -- so a ticket can only be issued by a party that saw the handshake completed. A NewSessionTicket carries a nonce, and the PSK for the next connection is HKDF-Expand-Label(resumption_master_secret, "resumption", ticket_nonce, Hash.length), so several tickets from one session yield different PSKs (RFC 8446 s 4.6.1).',
    clientKnows: ['resumption_master_secret', 'Any tickets the server issues'],
    serverKnows: ['resumption_master_secret', 'The tickets it issued'],
    observerKnows: [
      'That a NewSessionTicket record was sent, and its size',
      'Not the ticket contents, which are already under application keys',
    ],
    output: resumption,
    reference: { ...RFC_8446_KEY_SCHEDULE, section: '4.6.1' },
  });

  return {
    suite,
    exchange,
    usedPsk,
    usedEarlyData,
    steps,
    secrets,
    notice: PLACEHOLDER_NOTICE,
  };
}

// ---------------------------------------------------------------------------
// TLS 1.2, for the comparison view
// ---------------------------------------------------------------------------

/**
 * The TLS 1.2 derivation, which is the same idea with far less structure.
 *
 * One `master_secret`, one `key_block`, both from a custom PRF rather than HKDF, and --
 * the part that matters for the comparison -- the master secret depends only on the
 * premaster secret and the two random values, **not** on the handshake transcript. That
 * omission is what made the triple-handshake attack possible and why RFC 7627 had to bolt
 * the transcript on afterwards as the extended_master_secret extension. TLS 1.3 binds
 * every secret to a transcript by construction, so there is nothing to bolt on.
 */
export function buildTls12KeySchedule(suite: CipherSuite, label = 'tls12'): KeySchedule {
  const forwardSecret = suite.forwardSecrecy;
  const width = 48; // TLS 1.2's master_secret is fixed at 48 bytes, whatever the hash.

  const premaster: DerivedSecret = {
    name: 'pre_master_secret',
    label: 'premaster',
    value: placeholderSecret(`${label}-premaster`, 48),
    bytes: 48,
    stage: 'handshake',
    transcript: '',
    derivation: forwardSecret
      ? 'ECDHE(client_key_share, server_key_share)'
      : 'RSA-encrypt(server_certificate_public_key, client-chosen 48 bytes)',
    purpose: forwardSecret
      ? 'Agreed by an ephemeral exchange, so nothing recorded reveals it later.'
      : 'Chosen by the client and encrypted to the certificate key. Anyone who ever obtains that key decrypts every recorded session.',
  };

  const master: DerivedSecret = {
    name: 'master_secret',
    label: 'master secret',
    value: placeholderSecret(`${label}-master`, width),
    bytes: width,
    stage: 'application',
    transcript: 'client_random + server_random (NOT the transcript)',
    derivation:
      'PRF(pre_master_secret, "master secret", client_random + server_random)[0..47]',
    purpose:
      'The single root of every key in the connection. Note what it is not bound to: the handshake messages. RFC 7627 added extended_master_secret to fix exactly that.',
  };

  const keyBlock: DerivedSecret = {
    name: 'key_block',
    label: 'key expansion',
    value: placeholderSecret(`${label}-key-block`, 128),
    bytes: 128,
    stage: 'application',
    transcript: 'server_random + client_random',
    derivation: 'PRF(master_secret, "key expansion", server_random + client_random)',
    purpose:
      'One long block, sliced into client and server write keys and IVs. TLS 1.3 replaced this with separately labelled HKDF expansions, so no two keys come from splitting one string.',
  };

  const steps: KeyScheduleStep[] = [
    {
      id: 'tls12-premaster',
      title: 'pre_master_secret',
      explain: forwardSecret
        ? 'ECDHE, the same idea as TLS 1.3: both sides contribute an ephemeral public value, the private ones never leave. The server signs its value in ServerKeyExchange so the client knows it came from the certificate holder.'
        : 'Static RSA key transport. The client picks 48 bytes, encrypts them under the public key in the server certificate, and sends the result in ClientKeyExchange. There is no ephemeral value anywhere: the server certificate private key is the only thing standing between a recording and the plaintext, forever.',
      clientKnows: ['pre_master_secret'],
      serverKnows: ['pre_master_secret'],
      observerKnows: forwardSecret
        ? ['Both public shares, and neither private value']
        : [
            'The encrypted premaster secret, recorded verbatim',
            'A copy of it that becomes readable the day the server private key leaks -- this is what "no forward secrecy" means, concretely',
          ],
      output: premaster,
      reference: RFC_5246_MASTER_SECRET,
    },
    {
      id: 'tls12-master',
      title: 'master_secret',
      explain:
        'PRF(pre_master_secret, "master secret", client_random + server_random), truncated to 48 bytes. The two randoms make each session distinct, but the handshake transcript is not an input -- so two different handshakes can, under the right conditions, end up with the same master secret. RFC 7627 added extended_master_secret to close that.',
      clientKnows: ['master_secret'],
      serverKnows: ['master_secret'],
      observerKnows: ['Both random values, in the clear', 'Not the master secret'],
      output: master,
      reference: RFC_5246_MASTER_SECRET,
    },
    {
      id: 'tls12-key-block',
      title: 'key_block -- and only now does encryption start',
      explain:
        'The key block is sliced into write keys and IVs for both directions. Nothing before this point was encrypted, which is the visible difference on the ladder: the server certificate crossed the wire in plaintext, and any observer copied it. In TLS 1.3 the equivalent keys exist one flight earlier.',
      clientKnows: [
        'client_write_key, client_write_IV',
        'server_write_key, server_write_IV',
      ],
      serverKnows: [
        'server_write_key, server_write_IV',
        'client_write_key, client_write_IV',
      ],
      observerKnows: [
        'The full server certificate chain, in plaintext -- who the site is, its SANs, its issuer',
        'The cipher suite and both randoms',
        'From ChangeCipherSpec onwards, nothing further',
      ],
      output: keyBlock,
      keys: [
        trafficKeysFrom(keyBlock, suite, 'client'),
        trafficKeysFrom(keyBlock, suite, 'server'),
      ],
      reference: { ...RFC_5246_MASTER_SECRET, section: '6.3' },
    },
  ];

  return {
    suite,
    usedPsk: false,
    usedEarlyData: false,
    steps,
    secrets: [premaster, master, keyBlock],
    notice: PLACEHOLDER_NOTICE,
  };
}

// ---------------------------------------------------------------------------
// Queries the diagram needs
// ---------------------------------------------------------------------------

/** What one party knows at one step -- the cell `KeyScheduleDiagram` renders. */
export function knowledgeOf(step: KeyScheduleStep, party: Party): readonly string[] {
  if (party === 'client') return step.clientKnows;
  if (party === 'server') return step.serverKnows;
  return step.observerKnows;
}

/**
 * The step at which the observer stops being able to follow.
 *
 * Everything before it is public; everything after it is opaque. In TLS 1.3 this lands on
 * `handshake-secret`, one flight into the conversation. In TLS 1.2 it lands on
 * `tls12-key-block`, a full round trip later and after the certificate has already gone
 * past in the clear.
 */
export function observerLosesTrackAt(schedule: KeySchedule): KeyScheduleStep | undefined {
  return schedule.steps.find(
    (step) => step.id === 'handshake-secret' || step.id === 'tls12-key-block',
  );
}

/** Find a secret by its RFC name. */
export function secretByName(
  schedule: KeySchedule,
  name: string,
): DerivedSecret | undefined {
  return schedule.secrets.find((entry) => entry.name === name);
}
