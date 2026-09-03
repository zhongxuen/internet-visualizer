/**
 * Records -- what DNS actually moves, and the zones this module serves it from.
 *
 * DNS is usually explained as "a phone book that turns names into IP addresses", which
 * is wrong in the two ways that matter: the answer is often not an address, and there is
 * no book. There is a **tree of zones**, each administered separately, each knowing only
 * its own contents and the names of the servers one level down. This file models both
 * halves of that -- the records themselves, and the zones that hold them -- and it is
 * the only file in the module that contains data.
 *
 * ## Names are canonical here
 *
 * Every name is lower-case with no trailing dot, and the root zone is the empty string
 * ({@link ROOT}). DNS names are case-insensitive on the wire (RFC 1035 s2.3.3), so
 * comparing them any other way is a bug waiting to happen. {@link displayName} renders
 * `''` as `'.'` and `'example.com'` as `'example.com.'` when something needs to look
 * like `dig` output.
 *
 * ## Addresses are fictional on purpose
 *
 * The server *names* here are the real ones (`a.root-servers.net`, `a.gtld-servers.net`)
 * because they are worth recognising. Every **address** comes from a block reserved for
 * documentation -- RFC 5737 (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`) and
 * RFC 3849 (`2001:db8::/32`) -- so nothing here can be mistaken for, or pointed at, a
 * real host. `records.test.ts` enforces that for every address in the fixtures.
 *
 * There are 13 root server *addresses*, `a` through `m`, not 13 machines: each address
 * is announced by anycast from hundreds of sites. See {@link ROOT_SERVER_NOTE}.
 *
 * ## The DNSSEC material is a stand-in, not cryptography
 *
 * {@link toyHash} is FNV-1a. The "signatures" and "digests" built on it are
 * deterministic and structurally correct -- the right fields, the right owner names, the
 * right original-TTL handling -- but they are **symmetric and trivially forgeable**, and
 * they exist only so the chain-of-trust walk in `dnssec.ts` has something to check.
 * Nothing here is a validator, and none of it may ever be used as one.
 */

import { fail, ok, type ParseResult } from '@/core/net/result';

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** The root zone. Written `.` when displayed, empty when compared. */
export const ROOT = '';

/** The longest a name may be in presentation form (RFC 1035 s2.3.4). */
export const MAX_NAME_LENGTH = 253;

/** The longest a single label may be (RFC 1035 s2.3.4). */
export const MAX_LABEL_LENGTH = 63;

/** Lower-case, trailing dot removed. The form every comparison in this module uses. */
export function normalizeName(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (trimmed === '.' || trimmed === '') return ROOT;
  return trimmed.endsWith('.') ? trimmed.slice(0, -1) : trimmed;
}

/** `'example.com.'`, and `'.'` for the root -- the way a resolver prints a name. */
export function displayName(name: string): string {
  return name === ROOT ? '.' : `${name}.`;
}

/** The labels of a name, left to right. The root has none. */
export function labelsOf(name: string): string[] {
  return name === ROOT ? [] : name.split('.');
}

/** The name one level up: `'www.example.com'` -> `'example.com'` -> `'com'` -> `''`. */
export function parentOf(name: string): string {
  const dot = name.indexOf('.');
  return dot === -1 ? ROOT : name.slice(dot + 1);
}

/** Every enclosing name, closest first, ending at the root. */
export function ancestorsOf(name: string): string[] {
  const out: string[] = [];
  let current = name;
  while (current !== ROOT) {
    current = parentOf(current);
    out.push(current);
  }
  return out;
}

/** True when `name` sits strictly below `ancestor`. Everything is below the root. */
export function isSubdomainOf(name: string, ancestor: string): boolean {
  if (name === ancestor) return false;
  if (ancestor === ROOT) return true;
  return name.endsWith(`.${ancestor}`);
}

/**
 * True when `name` is `zone` or lives underneath it.
 *
 * This is the *bailiwick* test, and it is why a `.com` server cannot poison a cache with
 * an answer for `example.org`: data arriving from a server is only cacheable if it falls
 * inside the zone that server is authoritative for.
 */
export function isInBailiwick(name: string, zoneName: string): boolean {
  return name === zoneName || isSubdomainOf(name, zoneName);
}

/**
 * Validate a hostname the way this module accepts one.
 *
 * Letters, digits and hyphens per RFC 1123 s2.1, plus the underscore that service labels
 * such as `_sip._tcp` use (RFC 2782) and the leading `*` of a wildcard (RFC 4592).
 * Returns the canonical form, so a caller gets validation and normalisation from one
 * call. This never touches a network: a name that passes here is looked up in the
 * fixtures below and nowhere else.
 */
export function parseDomainName(input: string): ParseResult<string> {
  const name = normalizeName(input);
  if (name === ROOT) return ok(ROOT);
  if (name.length > MAX_NAME_LENGTH) {
    return fail(`name is ${name.length} characters, over the ${MAX_NAME_LENGTH} limit`);
  }

  for (const label of labelsOf(name)) {
    if (label.length === 0) return fail('name has an empty label (two dots in a row)');
    if (label.length > MAX_LABEL_LENGTH) {
      return fail(`label "${label}" is over ${MAX_LABEL_LENGTH} characters`);
    }
    if (label === '*') continue;
    if (!/^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?$/.test(label)) {
      return fail(`label "${label}" may only use letters, digits, hyphen, underscore`);
    }
  }
  return ok(name);
}

// ---------------------------------------------------------------------------
// Record types and response codes
// ---------------------------------------------------------------------------

/**
 * The record types this module can serve.
 *
 * The last four are DNSSEC's (RFC 4034): a zone's public keys, the parent's fingerprint
 * of one of them, the signatures, and the record that proves a name does *not* exist.
 */
export type RrType =
  | 'A'
  | 'AAAA'
  | 'CNAME'
  | 'MX'
  | 'NS'
  | 'TXT'
  | 'SOA'
  | 'PTR'
  | 'CAA'
  | 'SRV'
  | 'DS'
  | 'DNSKEY'
  | 'RRSIG'
  | 'NSEC';

/** The 16-bit code each type has on the wire (IANA DNS parameters registry). */
export const RR_TYPE_CODES: Readonly<Record<RrType, number>> = {
  A: 1,
  NS: 2,
  CNAME: 5,
  SOA: 6,
  PTR: 12,
  MX: 15,
  TXT: 16,
  AAAA: 28,
  SRV: 33,
  DS: 43,
  RRSIG: 46,
  NSEC: 47,
  DNSKEY: 48,
  CAA: 257,
};

/** The types a learner picks between; DNSSEC's own records are shown, not requested. */
export const QUERYABLE_TYPES: readonly RrType[] = [
  'A',
  'AAAA',
  'CNAME',
  'MX',
  'NS',
  'TXT',
  'SOA',
  'PTR',
  'CAA',
  'SRV',
];

/** One line explaining what each type is for. */
export const RR_TYPE_NOTES: Readonly<Record<RrType, string>> = {
  A: 'An IPv4 address. The record everyone means when they say "DNS lookup".',
  AAAA: 'An IPv6 address. Four times the size, same job -- hence four As.',
  CNAME: 'An alias for another name. Resolution restarts at the target.',
  MX: 'Where mail for this domain goes; lower preference is tried first.',
  NS: 'The nameservers for a zone. At a delegation this is a referral, not an answer.',
  TXT: 'Free text, used in practice for SPF, DKIM, and domain ownership proofs.',
  SOA: 'Start of authority: who runs the zone, and the timers every secondary obeys.',
  PTR: 'The reverse direction: an address written backwards under in-addr.arpa, to a name.',
  CAA: 'Which certificate authorities may issue for this domain.',
  SRV: 'Where a named service lives: priority, weight, port, and host.',
  DS: 'The parent zone fingerprint of a child key. One link of the chain of trust.',
  DNSKEY: 'A zone public key. The KSK signs the key set; the ZSK signs everything else.',
  RRSIG: 'A signature over one RRset, by one key, valid between two timestamps.',
  NSEC: 'Proof that a name or type does not exist, by pointing at the next one that does.',
};

/** The response codes a query in this module can come back with (RFC 1035 s4.1.1). */
export type Rcode =
  'NOERROR' | 'FORMERR' | 'SERVFAIL' | 'NXDOMAIN' | 'NOTIMP' | 'REFUSED';

/** The 4-bit RCODE value behind each name. */
export const RCODE_VALUES: Readonly<Record<Rcode, number>> = {
  NOERROR: 0,
  FORMERR: 1,
  SERVFAIL: 2,
  NXDOMAIN: 3,
  NOTIMP: 4,
  REFUSED: 5,
};

// ---------------------------------------------------------------------------
// RDATA
// ---------------------------------------------------------------------------

/** The typed contents of a record -- everything after the name, TTL, class and type. */
export type RData =
  | { readonly type: 'A'; readonly address: string }
  | { readonly type: 'AAAA'; readonly address: string }
  | { readonly type: 'CNAME'; readonly target: string }
  | { readonly type: 'NS'; readonly nameserver: string }
  | { readonly type: 'PTR'; readonly target: string }
  | { readonly type: 'MX'; readonly preference: number; readonly exchange: string }
  | { readonly type: 'TXT'; readonly strings: readonly string[] }
  | {
      readonly type: 'SOA';
      /** The primary nameserver for the zone. */
      readonly mname: string;
      /** The administrator's mailbox, with the `@` written as a dot. */
      readonly rname: string;
      readonly serial: number;
      readonly refresh: number;
      readonly retry: number;
      readonly expire: number;
      /**
       * Since RFC 2308 s4 this field means exactly one thing: the ceiling on how long a
       * *negative* answer from this zone may be cached.
       */
      readonly minimum: number;
    }
  | {
      readonly type: 'CAA';
      readonly flags: number;
      readonly tag: 'issue' | 'issuewild' | 'iodef';
      readonly value: string;
    }
  | {
      readonly type: 'SRV';
      readonly priority: number;
      readonly weight: number;
      readonly port: number;
      readonly target: string;
    }
  | {
      readonly type: 'DS';
      readonly keyTag: number;
      readonly algorithm: number;
      readonly digestType: number;
      readonly digest: string;
    }
  | {
      readonly type: 'DNSKEY';
      /** 257 for a key-signing key, 256 for a zone-signing key (RFC 4034 s2.1.1). */
      readonly flags: 256 | 257;
      readonly protocol: 3;
      readonly algorithm: number;
      readonly publicKey: string;
    }
  | {
      readonly type: 'RRSIG';
      readonly typeCovered: RrType;
      readonly algorithm: number;
      readonly labels: number;
      /**
       * The TTL the covered RRset had at the authoritative server. The signature is made
       * over *this*, not over the TTL on the wire, which is what lets a cached RRset
       * have its TTL counted down and still verify (RFC 4034 s3.1.2).
       */
      readonly originalTtl: number;
      readonly expiration: number;
      readonly inception: number;
      readonly keyTag: number;
      readonly signerName: string;
      readonly signature: string;
    }
  | {
      readonly type: 'NSEC';
      readonly nextName: string;
      readonly types: readonly RrType[];
    };

/** One resource record: an owner name, a lifetime, a class, a type, and its data. */
export interface ResourceRecord<D extends RData = RData> {
  /** Canonical owner name -- lower-case, no trailing dot. */
  readonly name: string;
  /** Seconds a resolver may cache this record for (RFC 1035 s3.2.1). */
  readonly ttl: number;
  /** Always `IN`. The other classes (CH, HS) are museum pieces. */
  readonly class: 'IN';
  readonly type: D['type'];
  readonly data: D;
}

/**
 * Build a record, deriving the type from the data so the two cannot disagree.
 *
 * Every record in this module goes through here, which is why no test asserts
 * `record.type === record.data.type`: it is not expressible.
 */
export function rr<D extends RData>(
  name: string,
  ttl: number,
  data: D,
): ResourceRecord<D> {
  return { name: normalizeName(name), ttl, class: 'IN', type: data.type, data };
}

/** The same record with a different TTL -- what a cache hands back as time passes. */
export function withTtl<D extends RData>(
  record: ResourceRecord<D>,
  ttl: number,
): ResourceRecord<D> {
  return { ...record, ttl: Math.max(0, Math.trunc(ttl)) };
}

/** RDATA in zone-file presentation format, which is how `dig` prints it. */
export function rdataText(data: RData): string {
  switch (data.type) {
    case 'A':
    case 'AAAA':
      return data.address;
    case 'CNAME':
    case 'PTR':
      return displayName(data.target);
    case 'NS':
      return displayName(data.nameserver);
    case 'MX':
      return `${data.preference} ${displayName(data.exchange)}`;
    case 'TXT':
      return data.strings.map((s) => `"${s}"`).join(' ');
    case 'SOA':
      return [
        displayName(data.mname),
        displayName(data.rname),
        data.serial,
        data.refresh,
        data.retry,
        data.expire,
        data.minimum,
      ].join(' ');
    case 'CAA':
      return `${data.flags} ${data.tag} "${data.value}"`;
    case 'SRV':
      return `${data.priority} ${data.weight} ${data.port} ${displayName(data.target)}`;
    case 'DS':
      return `${data.keyTag} ${data.algorithm} ${data.digestType} ${data.digest}`;
    case 'DNSKEY':
      return `${data.flags} ${data.protocol} ${data.algorithm} ${data.publicKey}`;
    case 'RRSIG':
      return [
        data.typeCovered,
        data.algorithm,
        data.labels,
        data.originalTtl,
        data.expiration,
        data.inception,
        data.keyTag,
        displayName(data.signerName),
        data.signature,
      ].join(' ');
    case 'NSEC':
      return `${displayName(data.nextName)} ${data.types.join(' ')}`;
  }
}

/** One record as a zone-file line, e.g. `example.com. 3600 IN A 203.0.113.20`. */
export function recordText(record: ResourceRecord): string {
  const head = `${displayName(record.name)} ${record.ttl} ${record.class} ${record.type}`;
  return `${head} ${rdataText(record.data)}`;
}

/** Bytes a name occupies uncompressed: one length octet per label, plus the root. */
export function nameBytes(name: string): number {
  return labelsOf(name).reduce((total, label) => total + 1 + label.length, 0) + 1;
}

/** The RDLENGTH this record would carry on the wire -- near enough for an MTU lesson. */
export function rdataLength(data: RData): number {
  switch (data.type) {
    case 'A':
      return 4;
    case 'AAAA':
      return 16;
    case 'CNAME':
    case 'PTR':
      return nameBytes(data.target);
    case 'NS':
      return nameBytes(data.nameserver);
    case 'MX':
      return 2 + nameBytes(data.exchange);
    case 'TXT':
      // Every string is length-prefixed by one octet, which is why 255 characters is a
      // hard limit and why long TXT records arrive split into several strings.
      return data.strings.reduce((total, s) => total + 1 + s.length, 0);
    case 'SOA':
      return nameBytes(data.mname) + nameBytes(data.rname) + 20;
    case 'CAA':
      return 2 + data.tag.length + data.value.length;
    case 'SRV':
      return 6 + nameBytes(data.target);
    case 'DS':
      return 4 + Math.ceil(data.digest.length / 2);
    case 'DNSKEY':
      return 4 + Math.ceil((data.publicKey.length * 3) / 4);
    case 'RRSIG':
      return 18 + nameBytes(data.signerName) + Math.ceil((data.signature.length * 3) / 4);
    case 'NSEC':
      return nameBytes(data.nextName) + 2 + Math.ceil(data.types.length / 8);
  }
}

/** Name + TYPE + CLASS + TTL + RDLENGTH + RDATA. */
export function recordBytes(record: ResourceRecord): number {
  return nameBytes(record.name) + 10 + rdataLength(record.data);
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** What is being asked. The format allows several questions; nothing sends more than one. */
export interface DnsQuestion {
  readonly name: string;
  readonly type: RrType;
  readonly class: 'IN';
}

/** Build a question, normalising the name. */
export function question(name: string, type: RrType): DnsQuestion {
  return { name: normalizeName(name), type, class: 'IN' };
}

/**
 * The header bits, which are most of what a packet capture shows.
 *
 * `rd` and `ra` together are the entire recursive/iterative distinction: a stub sets RD
 * and a recursive resolver sets RA in reply, while the resolver's own queries to the
 * root and the TLD have RD clear -- those servers would refuse to recurse anyway.
 */
export interface DnsFlags {
  /** Query (false) or response (true). */
  readonly qr: boolean;
  readonly opcode: 'QUERY';
  /** Authoritative Answer: this server owns the zone the answer came from. */
  readonly aa: boolean;
  /** TrunCated: the response did not fit, ask again over TCP. */
  readonly tc: boolean;
  /** Recursion Desired: "do the work for me". */
  readonly rd: boolean;
  /** Recursion Available: "I am willing to". */
  readonly ra: boolean;
  /** Authentic Data: this validating resolver checked the signatures and they held. */
  readonly ad: boolean;
  /** Checking Disabled: "answer me even if validation fails". */
  readonly cd: boolean;
  /** DNSSEC OK -- an EDNS(0) bit rather than a header bit: "send the signatures too". */
  readonly do: boolean;
}

/** The default flag set: a bare query, nothing asserted. */
export const NO_FLAGS: DnsFlags = {
  qr: false,
  opcode: 'QUERY',
  aa: false,
  tc: false,
  rd: false,
  ra: false,
  ad: false,
  cd: false,
  do: false,
};

/** One DNS message, query or response, with the three sections that matter. */
export interface DnsMessage {
  /** The 16-bit transaction id that matches a response to its query. */
  readonly id: number;
  readonly flags: DnsFlags;
  readonly rcode: Rcode;
  readonly question: DnsQuestion;
  /** What was asked for. */
  readonly answer: readonly ResourceRecord[];
  /** Who to ask next (a referral), or why there is no answer (an SOA). */
  readonly authority: readonly ResourceRecord[];
  /** Addresses for the names in the other two sections -- glue. */
  readonly additional: readonly ResourceRecord[];
  /** Estimated size on the wire, which decides whether UDP can carry it. */
  readonly sizeBytes: number;
}

/** `'QR AA RD RA'` -- the set bits, in the order a capture lists them. */
export function describeFlags(flags: DnsFlags): string {
  const set: string[] = [];
  if (flags.qr) set.push('QR');
  if (flags.aa) set.push('AA');
  if (flags.tc) set.push('TC');
  if (flags.rd) set.push('RD');
  if (flags.ra) set.push('RA');
  if (flags.ad) set.push('AD');
  if (flags.cd) set.push('CD');
  if (flags.do) set.push('DO');
  return set.join(' ');
}

/** Header (12 bytes) + question + every record in every section. */
export function estimateMessageSize(
  q: DnsQuestion,
  sections: readonly (readonly ResourceRecord[])[],
): number {
  const records = sections.flat();
  return (
    12 +
    nameBytes(q.name) +
    4 +
    records.reduce((total, record) => total + recordBytes(record), 0)
  );
}

/** Assemble a message, computing its size in the one place that knows how. */
export function message(init: {
  id: number;
  flags: DnsFlags;
  rcode: Rcode;
  question: DnsQuestion;
  answer?: readonly ResourceRecord[];
  authority?: readonly ResourceRecord[];
  additional?: readonly ResourceRecord[];
}): DnsMessage {
  const answer = init.answer ?? [];
  const authority = init.authority ?? [];
  const additional = init.additional ?? [];
  return {
    id: init.id,
    flags: init.flags,
    rcode: init.rcode,
    question: init.question,
    answer,
    authority,
    additional,
    sizeBytes: estimateMessageSize(init.question, [answer, authority, additional]),
  };
}

/**
 * The largest DNS response a plain UDP datagram carries (RFC 1035 s4.2.1).
 *
 * Exceed it without EDNS(0) and the server sets TC and sends what fits; the resolver
 * throws that away and asks again over TCP. This is the whole reason DNS lists TCP as a
 * transport at all -- not zone transfers, which are merely the other reason.
 */
export const UDP_MAX_PAYLOAD = 512;

/** What a modern resolver advertises it can reassemble, via EDNS(0) (RFC 6891). */
export const EDNS_UDP_PAYLOAD = 1232;

// ---------------------------------------------------------------------------
// The DNSSEC stand-in -- deterministic, structural, and not cryptography
// ---------------------------------------------------------------------------

/** FNV-1a, 32 bits, as eight hex characters. Not a hash function for anything secret. */
export function toyHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Algorithm 13, ECDSAP256SHA256 -- what a zone signed today would most likely use. */
export const DNSSEC_ALGORITHM = 13;

/** Digest type 2, SHA-256 (RFC 4509). Named here; not actually computed here. */
export const DS_DIGEST_TYPE = 2;

/** The public half of a zone key, as it appears in a DNSKEY record. */
export type DnskeyData = Extract<RData, { type: 'DNSKEY' }>;

/**
 * The key tag: a 16-bit checksum over the DNSKEY RDATA (RFC 4034 Appendix B).
 *
 * It is neither an identifier nor unique -- it exists only to narrow which keys are
 * worth trying against a signature, which is why RRSIG carries one.
 */
export function keyTagOf(key: {
  flags: number;
  protocol: number;
  algorithm: number;
  publicKey: string;
}): number {
  const digits = `${key.flags}|${key.protocol}|${key.algorithm}|${key.publicKey}`;
  return parseInt(toyHash(digits), 16) & 0xffff;
}

/** The parent's fingerprint of a child key: a hash of the owner name plus the RDATA. */
export function dsDigest(
  owner: string,
  key: { flags: number; protocol: number; algorithm: number; publicKey: string },
): string {
  const canonical = `${owner}|${key.flags}|${key.protocol}|${key.algorithm}|${key.publicKey}`;
  const digest =
    toyHash(canonical) + toyHash(`${canonical}#2`) + toyHash(`${canonical}#3`);
  return digest.toUpperCase();
}

/**
 * The signature over one RRset.
 *
 * Computed over the canonical owner name, the type, the **original** TTL and the RDATA
 * of every record in the set in sorted order -- the same inputs RFC 4034 s3.1.8 lists,
 * minus the mathematics. Sorting matters: an RRset is a set, so two servers that list
 * the same records in different orders must produce the same signature input.
 */
export function signRrset(
  publicKey: string,
  owner: string,
  type: RrType,
  originalTtl: number,
  records: readonly ResourceRecord[],
): string {
  const rdata = records
    .map((record) => rdataText(record.data))
    .sort()
    .join(',');
  const canonical = `${publicKey}|${owner}|${type}|${originalTtl}|${rdata}`;
  return (toyHash(canonical) + toyHash(`${canonical}#sig`)).toUpperCase();
}

/** Seconds since the Unix epoch at which every fixture signature became valid. */
export const SIGNATURE_INCEPTION = 1_767_225_600; // 2026-01-01T00:00:00Z

/** Seconds since the Unix epoch at which every fixture signature expires. */
export const SIGNATURE_EXPIRATION = 1_798_761_600; // 2027-01-01T00:00:00Z

/** The moment validation is performed at, unless a caller supplies another. */
export const VALIDATION_TIME = 1_772_582_400; // 2026-03-04T00:00:00Z

/** An RRSIG timestamp as `YYYYMMDDHHMMSS`, the form zone files and `dig` both use. */
export function formatSigTime(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

/** Where a server sits in the tree, which is what the ladder view colours by. */
export type ZoneTier = 'root' | 'tld' | 'authoritative';

/** One nameserver: a name, the addresses it answers on, and how far away it is. */
export interface NameServer {
  /** The server's own domain name, as an NS record spells it. */
  readonly name: string;
  readonly ipv4: string;
  readonly ipv6?: string;
  /** Round trip in virtual milliseconds, before jitter. */
  readonly rttMs: number;
  /** One sentence for the inspector. */
  readonly note?: string;
}

/** The key pair of a signed zone. Only public halves exist; see the file header. */
export interface ZoneKeys {
  /** Key-signing key: signs the DNSKEY RRset, and is what the parent's DS points at. */
  readonly ksk: DnskeyData;
  /** Zone-signing key: signs everything else, and can be rolled without the parent. */
  readonly zsk: DnskeyData;
}

/** One zone: an origin, the servers that answer for it, and the records it holds. */
export interface DnsZone {
  readonly origin: string;
  readonly tier: ZoneTier;
  readonly nameservers: readonly NameServer[];
  readonly records: readonly ResourceRecord[];
  /** Present when the zone is signed. Absent means unsigned, which is most zones. */
  readonly keys?: ZoneKeys;
  readonly note?: string;
}

/** A DNSKEY pair for a fixture zone, with key tags derived rather than typed in. */
export function zoneKeys(label: string): ZoneKeys {
  return {
    ksk: {
      type: 'DNSKEY',
      flags: 257,
      protocol: 3,
      algorithm: DNSSEC_ALGORITHM,
      publicKey: `KSK/${label}/${toyHash(`ksk:${label}`)}`,
    },
    zsk: {
      type: 'DNSKEY',
      flags: 256,
      protocol: 3,
      algorithm: DNSSEC_ALGORITHM,
      publicKey: `ZSK/${label}/${toyHash(`zsk:${label}`)}`,
    },
  };
}

/** An RRset: every record sharing an owner name and a type. */
export interface Rrset {
  readonly name: string;
  readonly type: RrType;
  readonly records: readonly ResourceRecord[];
}

/** Group records into RRsets, preserving the order each set first appears in. */
export function groupRrsets(records: readonly ResourceRecord[]): Rrset[] {
  const order: string[] = [];
  const groups = new Map<string, ResourceRecord[]>();
  for (const record of records) {
    const key = `${record.name}|${record.type}`;
    const existing = groups.get(key);
    if (existing) {
      existing.push(record);
    } else {
      order.push(key);
      groups.set(key, [record]);
    }
  }
  return order.map((key) => {
    const set = groups.get(key) as ResourceRecord[];
    return { name: set[0].name, type: set[0].type, records: set };
  });
}

/**
 * Sign a zone: one RRSIG per RRset, by the ZSK, except the key set itself.
 *
 * Two things a signer does that diagrams usually leave out, both modelled here:
 *
 * - **The DNSKEY RRset is signed by the KSK**, everything else by the ZSK. That split is
 *   why a zone can roll its signing key without ever talking to its parent: only the KSK
 *   is fingerprinted in the parent's DS.
 * - **Delegation NS records and glue are not signed.** They are not this zone's data;
 *   they belong to the child. The DS record at the same name *is* signed, and it is the
 *   only thing the parent actually vouches for.
 */
export function signZone(
  origin: string,
  records: readonly ResourceRecord[],
  keys: ZoneKeys,
): ResourceRecord[] {
  const delegations = records
    .filter((record) => record.type === 'NS' && record.name !== origin)
    .map((record) => record.name);
  const belowDelegation = (name: string): boolean =>
    delegations.some((point) => isInBailiwick(name, point));

  const out: ResourceRecord[] = [];
  for (const set of groupRrsets(records)) {
    out.push(...set.records);
    if (set.type === 'RRSIG') continue;
    if (belowDelegation(set.name) && set.type !== 'DS' && set.type !== 'NSEC') continue;

    const key = set.type === 'DNSKEY' ? keys.ksk : keys.zsk;
    const originalTtl = set.records[0].ttl;
    out.push(
      rr(set.name, originalTtl, {
        type: 'RRSIG',
        typeCovered: set.type,
        algorithm: key.algorithm,
        labels: labelsOf(set.name).filter((label) => label !== '*').length,
        originalTtl,
        expiration: SIGNATURE_EXPIRATION,
        inception: SIGNATURE_INCEPTION,
        keyTag: keyTagOf(key),
        signerName: origin,
        signature: signRrset(key.publicKey, set.name, set.type, originalTtl, set.records),
      }),
    );
  }
  return out;
}

/** Assemble a zone, signing it when keys are supplied. */
export function zone(init: {
  origin: string;
  tier: ZoneTier;
  nameservers: readonly NameServer[];
  records: readonly ResourceRecord[];
  keys?: ZoneKeys;
  note?: string;
}): DnsZone {
  const origin = normalizeName(init.origin);
  const records = init.keys
    ? signZone(origin, init.records, init.keys)
    : [...init.records];
  return {
    origin,
    tier: init.tier,
    nameservers: init.nameservers,
    records,
    ...(init.keys ? { keys: init.keys } : {}),
    ...(init.note ? { note: init.note } : {}),
  };
}

/** The DNSKEY RRset a signed zone publishes at its apex. */
export function dnskeyRecords(
  keys: ZoneKeys,
  origin: string,
  ttl: number,
): ResourceRecord[] {
  return [rr(origin, ttl, keys.ksk), rr(origin, ttl, keys.zsk)];
}

/**
 * The DS record a parent publishes for a child's key-signing key.
 *
 * `digestOverride` exists for exactly one fixture: a delegation whose DS does not match
 * the child's key, which is what a validating resolver must call bogus rather than
 * merely unsigned.
 */
export function dsRecord(
  child: string,
  keys: ZoneKeys,
  ttl: number,
  digestOverride?: string,
): ResourceRecord {
  const owner = normalizeName(child);
  return rr(owner, ttl, {
    type: 'DS',
    keyTag: keyTagOf(keys.ksk),
    algorithm: keys.ksk.algorithm,
    digestType: DS_DIGEST_TYPE,
    digest: digestOverride ?? dsDigest(owner, keys.ksk),
  });
}

/** The apex NS RRset, built from the server list so the two cannot drift apart. */
function apexNs(
  origin: string,
  ttl: number,
  servers: readonly NameServer[],
): ResourceRecord[] {
  return servers.map((server) =>
    rr(origin, ttl, { type: 'NS', nameserver: server.name }),
  );
}

/** Delegation NS records: the parent naming the child's servers. */
function delegateTo(
  child: string,
  ttl: number,
  servers: readonly NameServer[],
): ResourceRecord[] {
  return servers.map((server) => rr(child, ttl, { type: 'NS', nameserver: server.name }));
}

/** The address records for a server, used as zone data and as glue alike. */
function serverAddresses(server: NameServer, ttl: number): ResourceRecord[] {
  const records: ResourceRecord[] = [
    rr(server.name, ttl, { type: 'A', address: server.ipv4 }),
  ];
  if (server.ipv6) {
    records.push(rr(server.name, ttl, { type: 'AAAA', address: server.ipv6 }));
  }
  return records;
}

/** The address records for several servers at once. */
function addressesOf(servers: readonly NameServer[], ttl: number): ResourceRecord[] {
  return servers.flatMap((server) => serverAddresses(server, ttl));
}

// ---------------------------------------------------------------------------
// TTLs used by the fixtures
// ---------------------------------------------------------------------------

/**
 * The TTLs the fixture zones use, named rather than typed in twice.
 *
 * The spread is the lesson: infrastructure records live for days because they almost
 * never change, an ordinary A record for an hour, and a CDN's edge addresses for half a
 * minute because they are how the CDN steers traffic. A short TTL is not a performance
 * bug; it is a control knob, paid for in queries.
 */
export const TTL = {
  /** Root and TLD delegations: two days. */
  infrastructure: 172800,
  /** A zone's own nameserver records: one day. */
  nameserver: 86400,
  /** An ordinary host record: one hour. */
  host: 3600,
  /** Aliases and anything expected to be re-pointed: five minutes. */
  alias: 300,
  /** A CDN edge: thirty seconds, so traffic can be moved almost immediately. */
  edge: 30,
} as const;

// ---------------------------------------------------------------------------
// The servers
// ---------------------------------------------------------------------------

/** The misconception this module exists to correct, in one sentence. */
export const ROOT_SERVER_NOTE =
  'There are 13 root server addresses, not 13 machines: each letter is announced by ' +
  'anycast from hundreds of sites, so the nearest one answers.';

/** `a` through `m`, the real names, with documentation addresses. */
export const ROOT_SERVERS: readonly NameServer[] = [
  'a',
  'b',
  'c',
  'd',
  'e',
  'f',
  'g',
  'h',
  'i',
  'j',
  'k',
  'l',
  'm',
].map((letter, index) => ({
  name: `${letter}.root-servers.net`,
  ipv4: `192.0.2.${index + 1}`,
  ipv6: `2001:db8:0:1::${index + 1}`,
  // Root servers are anycast and therefore close; the spread here is only so that the
  // ladder does not show thirteen identical numbers.
  rttMs: 26 + (index % 5),
  note: ROOT_SERVER_NOTE,
}));

/**
 * The gTLD servers, which serve `com` **and** `net` from the same machines.
 *
 * That is not a simplification -- one operator runs both registries, and a resolver that
 * has just walked to `com` often reaches `net` with no extra work.
 */
export const GTLD_SERVERS: readonly NameServer[] = [
  {
    name: 'a.gtld-servers.net',
    ipv4: '192.0.2.30',
    ipv6: '2001:db8:0:2::30',
    rttMs: 24,
    note: 'Serves both com and net; the two registries share an operator.',
  },
  { name: 'b.gtld-servers.net', ipv4: '192.0.2.31', rttMs: 27 },
];

/** The `org` registry's servers. */
export const ORG_SERVERS: readonly NameServer[] = [
  { name: 'a0.org.afilias-nst.info', ipv4: '192.0.2.40', rttMs: 25 },
  { name: 'b0.org.afilias-nst.info', ipv4: '192.0.2.41', rttMs: 28 },
];

/** The servers for `in-addr.arpa`, where every reverse lookup ends up. */
export const IN_ADDR_SERVERS: readonly NameServer[] = [
  { name: 'a.in-addr-servers.arpa', ipv4: '192.0.2.50', rttMs: 26 },
  { name: 'b.in-addr-servers.arpa', ipv4: '192.0.2.51', rttMs: 29 },
];

/** `example.com`'s own servers, inside the zone they serve -- so the delegation needs glue. */
export const EXAMPLE_COM_SERVERS: readonly NameServer[] = [
  {
    name: 'ns1.example.com',
    ipv4: '203.0.113.10',
    ipv6: '2001:db8:2::10',
    rttMs: 18,
    note:
      'In-zone nameserver: the com delegation must carry glue for it, or nothing ' +
      'could ever find it.',
  },
  { name: 'ns2.example.com', ipv4: '203.0.113.11', rttMs: 21 },
];

/** `example.net`'s server. */
export const EXAMPLE_NET_SERVERS: readonly NameServer[] = [
  { name: 'ns1.example.net', ipv4: '198.51.100.10', rttMs: 19 },
];

/** The CDN's own nameservers, which answer with short-lived edge addresses. */
export const CDN_SERVERS: readonly NameServer[] = [
  {
    name: 'ns1.cdn.example.net',
    ipv4: '198.51.100.30',
    rttMs: 11,
    note: 'A CDN runs its nameservers close to its users; the answer depends on who asks.',
  },
];

/**
 * A managed DNS provider, used by `example.org`.
 *
 * Its names are outside the zones it serves, so the `org` delegation carries **no glue**
 * and the resolver has to go and resolve `ns1.dns-provider.net` before it can ask it
 * anything. That side quest is invisible in every simplified diagram of DNS, and it is
 * how most of the web is actually delegated.
 */
export const PROVIDER_SERVERS: readonly NameServer[] = [
  { name: 'ns1.dns-provider.net', ipv4: '198.51.100.50', rttMs: 17 },
  { name: 'ns2.dns-provider.net', ipv4: '198.51.100.51', rttMs: 22 },
];

// ---------------------------------------------------------------------------
// The keys
// ---------------------------------------------------------------------------

const ROOT_KEYS = zoneKeys('root');
const COM_KEYS = zoneKeys('com');
const ORG_KEYS = zoneKeys('org');
const EXAMPLE_ORG_KEYS = zoneKeys('example.org');
const BROKEN_KEYS = zoneKeys('broken.example.org');

/**
 * The one key a validating resolver is configured with rather than told about.
 *
 * Everything else in DNSSEC hangs off this: the root's DS is not published anywhere it
 * could be looked up, because a lookup is exactly what it is there to secure. Real
 * resolvers ship the equivalent (`root-anchors.xml`, currently KSK-2017) and update it
 * out of band per RFC 5011.
 */
export const ROOT_TRUST_ANCHOR = dsRecord(ROOT, ROOT_KEYS, TTL.infrastructure);

// ---------------------------------------------------------------------------
// The zones
// ---------------------------------------------------------------------------

const rootZone = zone({
  origin: ROOT,
  tier: 'root',
  nameservers: ROOT_SERVERS,
  keys: ROOT_KEYS,
  note:
    'Knows every top-level domain and nothing else. It has never held the address of ' +
    'a website and it never will.',
  records: [
    rr(ROOT, TTL.infrastructure, {
      type: 'SOA',
      mname: 'a.root-servers.net',
      rname: 'nstld.verisign-grs.com',
      serial: 2026090301,
      refresh: 1800,
      retry: 900,
      expire: 604800,
      minimum: 86400,
    }),
    ...apexNs(ROOT, TTL.infrastructure, ROOT_SERVERS),
    // The root zone holds the addresses of its own servers. They are glue: not
    // authoritative data, which is why they are not signed.
    ...addressesOf(ROOT_SERVERS, TTL.infrastructure),
    ...dnskeyRecords(ROOT_KEYS, ROOT, TTL.infrastructure),

    ...delegateTo('com', TTL.infrastructure, GTLD_SERVERS),
    dsRecord('com', COM_KEYS, TTL.infrastructure),
    // Glue for the gTLD servers. Without it the com delegation names servers whose
    // addresses could only be found by following a com delegation.
    ...addressesOf(GTLD_SERVERS, TTL.infrastructure),
    ...delegateTo('net', TTL.infrastructure, GTLD_SERVERS),
    // No DS for net: the branch below it is unsigned, and a validator must be able to
    // *prove* that rather than assume it -- hence the NSEC.
    rr('net', TTL.infrastructure, {
      type: 'NSEC',
      nextName: 'org',
      types: ['NS', 'RRSIG', 'NSEC'],
    }),
    ...delegateTo('org', TTL.infrastructure, ORG_SERVERS),
    dsRecord('org', ORG_KEYS, TTL.infrastructure),
    // Sibling glue: these names live under .info, which the root has delegated away, but
    // the root publishes their addresses anyway because otherwise nobody could reach org.
    ...addressesOf(ORG_SERVERS, TTL.infrastructure),
    ...delegateTo('arpa', TTL.infrastructure, ROOT_SERVERS),
    rr('arpa', TTL.infrastructure, {
      type: 'NSEC',
      nextName: 'com',
      types: ['NS', 'RRSIG', 'NSEC'],
    }),
  ],
});

const comZone = zone({
  origin: 'com',
  tier: 'tld',
  nameservers: GTLD_SERVERS,
  keys: COM_KEYS,
  note: 'Knows which servers run each .com domain. It does not know a single web address.',
  records: [
    rr('com', TTL.infrastructure, {
      type: 'SOA',
      mname: 'a.gtld-servers.net',
      rname: 'nstld.verisign-grs.com',
      serial: 2026090301,
      refresh: 1800,
      retry: 900,
      expire: 604800,
      minimum: 900,
    }),
    ...apexNs('com', TTL.infrastructure, GTLD_SERVERS),
    ...addressesOf(GTLD_SERVERS, TTL.infrastructure),
    ...dnskeyRecords(COM_KEYS, 'com', TTL.infrastructure),

    ...delegateTo('example.com', TTL.infrastructure, EXAMPLE_COM_SERVERS),
    // example.com's nameservers live inside example.com, so without these two address
    // records the delegation would be unfollowable. That is what glue is for.
    ...addressesOf(EXAMPLE_COM_SERVERS, TTL.infrastructure),
    // example.com is unsigned. In a signed parent that has to be proven, not assumed:
    // the NSEC lists the types that exist at this name, and DS is not among them.
    rr('example.com', TTL.infrastructure, {
      type: 'NSEC',
      nextName: 'com',
      types: ['NS', 'RRSIG', 'NSEC'],
    }),
  ],
});

const netZone = zone({
  origin: 'net',
  tier: 'tld',
  nameservers: GTLD_SERVERS,
  note: 'Unsigned in these fixtures, so everything below it validates as insecure.',
  records: [
    rr('net', TTL.infrastructure, {
      type: 'SOA',
      mname: 'a.gtld-servers.net',
      rname: 'nstld.verisign-grs.com',
      serial: 2026090301,
      refresh: 1800,
      retry: 900,
      expire: 604800,
      minimum: 900,
    }),
    ...apexNs('net', TTL.infrastructure, GTLD_SERVERS),
    ...addressesOf(GTLD_SERVERS, TTL.infrastructure),

    ...delegateTo('example.net', TTL.infrastructure, EXAMPLE_NET_SERVERS),
    ...addressesOf(EXAMPLE_NET_SERVERS, TTL.infrastructure),
    ...delegateTo('dns-provider.net', TTL.infrastructure, PROVIDER_SERVERS),
    ...addressesOf(PROVIDER_SERVERS, TTL.infrastructure),
    // The zone that holds the root servers' own addresses really is delegated from net.
    ...delegateTo('root-servers.net', TTL.infrastructure, ROOT_SERVERS),
    ...addressesOf(ROOT_SERVERS, TTL.infrastructure),
  ],
});

const orgZone = zone({
  origin: 'org',
  tier: 'tld',
  nameservers: ORG_SERVERS,
  keys: ORG_KEYS,
  records: [
    rr('org', TTL.infrastructure, {
      type: 'SOA',
      mname: 'a0.org.afilias-nst.info',
      rname: 'noc.afilias-nst.info',
      serial: 2026090301,
      refresh: 1800,
      retry: 900,
      expire: 604800,
      minimum: 900,
    }),
    ...apexNs('org', TTL.infrastructure, ORG_SERVERS),
    ...addressesOf(ORG_SERVERS, TTL.infrastructure),
    ...dnskeyRecords(ORG_KEYS, 'org', TTL.infrastructure),

    // No glue here: the servers are under dns-provider.net, outside this zone, so the
    // resolver must look them up before it can follow the delegation.
    ...delegateTo('example.org', TTL.infrastructure, PROVIDER_SERVERS),
    dsRecord('example.org', EXAMPLE_ORG_KEYS, TTL.infrastructure),
  ],
});

const arpaZone = zone({
  origin: 'arpa',
  tier: 'tld',
  nameservers: ROOT_SERVERS,
  note:
    'Served by the root servers themselves, which is why a reverse lookup appears to ' +
    'skip a rung: the root server answers from the arpa zone directly.',
  records: [
    rr('arpa', TTL.infrastructure, {
      type: 'SOA',
      mname: 'a.root-servers.net',
      rname: 'nstld.verisign-grs.com',
      serial: 2026090301,
      refresh: 1800,
      retry: 900,
      expire: 604800,
      minimum: 900,
    }),
    ...apexNs('arpa', TTL.infrastructure, ROOT_SERVERS),
    ...delegateTo('in-addr.arpa', TTL.infrastructure, IN_ADDR_SERVERS),
    ...addressesOf(IN_ADDR_SERVERS, TTL.infrastructure),
  ],
});

const inAddrZone = zone({
  origin: 'in-addr.arpa',
  tier: 'tld',
  nameservers: IN_ADDR_SERVERS,
  note:
    'The reverse tree. Simplified: the real chain delegates 203.in-addr.arpa to a ' +
    'regional registry first, which then delegates the smaller blocks.',
  records: [
    rr('in-addr.arpa', TTL.infrastructure, {
      type: 'SOA',
      mname: 'a.in-addr-servers.arpa',
      rname: 'nstld.iana.org',
      serial: 2026090301,
      refresh: 1800,
      retry: 900,
      expire: 604800,
      minimum: 900,
    }),
    ...apexNs('in-addr.arpa', TTL.infrastructure, IN_ADDR_SERVERS),
    // Delegated to the address holder's own nameserver -- which lives in example.com, so
    // again there is no glue and the resolver has a side quest first.
    ...delegateTo(
      '113.0.203.in-addr.arpa',
      TTL.infrastructure,
      EXAMPLE_COM_SERVERS.slice(0, 1),
    ),
  ],
});

/** A long TXT record, in the 255-character chunks the format forces it into. */
const DKIM_KEY = [
  `v=DKIM1; k=rsa; p=${'A'.repeat(236)}`,
  'B'.repeat(255),
  `${'C'.repeat(120)}IDAQAB`,
];

const exampleComZone = zone({
  origin: 'example.com',
  tier: 'authoritative',
  nameservers: EXAMPLE_COM_SERVERS,
  note: 'Unsigned, like most of the web. The chain of trust stops at its parent.',
  records: [
    rr('example.com', TTL.host, {
      type: 'SOA',
      mname: 'ns1.example.com',
      rname: 'hostmaster.example.com',
      serial: 2026090301,
      refresh: 7200,
      retry: 3600,
      expire: 1209600,
      // Five minutes. This is the ceiling on caching a "no such name" answer from this
      // zone -- see RFC 2308 s5 and `negativeTtlSeconds` in cache.ts.
      minimum: 300,
    }),
    ...apexNs('example.com', TTL.nameserver, EXAMPLE_COM_SERVERS),
    ...addressesOf(EXAMPLE_COM_SERVERS, TTL.nameserver),

    rr('example.com', TTL.host, { type: 'A', address: '203.0.113.20' }),
    rr('example.com', TTL.host, { type: 'AAAA', address: '2001:db8:2::20' }),
    rr('example.com', TTL.host, {
      type: 'MX',
      preference: 10,
      exchange: 'mail.example.com',
    }),
    rr('example.com', TTL.host, {
      type: 'MX',
      preference: 20,
      exchange: 'mx-backup.example.net',
    }),
    rr('example.com', TTL.host, {
      type: 'TXT',
      strings: ['v=spf1 include:_spf.example.net -all'],
    }),
    rr('example.com', TTL.host, {
      type: 'CAA',
      flags: 0,
      tag: 'issue',
      value: 'ca.example.net',
    }),
    rr('example.com', TTL.host, {
      type: 'CAA',
      flags: 0,
      tag: 'iodef',
      value: 'mailto:security@example.com',
    }),

    // www is an alias for the apex; blog is an alias for www. Two hops of CNAME is
    // legal, common, and exactly one hop more than most people expect.
    rr('www.example.com', TTL.alias, { type: 'CNAME', target: 'example.com' }),
    rr('blog.example.com', TTL.alias, { type: 'CNAME', target: 'www.example.com' }),
    // An alias that leaves the zone entirely: resolution has to start again from the top
    // for a name this server knows nothing about.
    rr('shop.example.com', TTL.alias, { type: 'CNAME', target: 'edge.cdn.example.net' }),

    rr('mail.example.com', TTL.host, { type: 'A', address: '203.0.113.25' }),
    rr('sip.example.com', TTL.host, { type: 'A', address: '203.0.113.26' }),
    rr('_sip._tcp.example.com', TTL.host, {
      type: 'SRV',
      priority: 10,
      weight: 60,
      port: 5060,
      target: 'sip.example.com',
    }),
    // Big enough that a 512-byte UDP response cannot carry it, which is what forces the
    // truncation-and-retry-over-TCP path.
    rr('default._domainkey.example.com', TTL.host, { type: 'TXT', strings: DKIM_KEY }),
    // One record standing in for every name under dev.example.com (RFC 4592).
    rr('*.dev.example.com', TTL.alias, { type: 'A', address: '203.0.113.28' }),
  ],
});

const exampleNetZone = zone({
  origin: 'example.net',
  tier: 'authoritative',
  nameservers: EXAMPLE_NET_SERVERS,
  records: [
    rr('example.net', TTL.host, {
      type: 'SOA',
      mname: 'ns1.example.net',
      rname: 'hostmaster.example.net',
      serial: 2026090301,
      refresh: 7200,
      retry: 3600,
      expire: 1209600,
      minimum: 600,
    }),
    ...apexNs('example.net', TTL.nameserver, EXAMPLE_NET_SERVERS),
    ...addressesOf(EXAMPLE_NET_SERVERS, TTL.nameserver),
    rr('example.net', TTL.host, { type: 'A', address: '198.51.100.20' }),
    rr('mx-backup.example.net', TTL.host, { type: 'A', address: '198.51.100.21' }),
    rr('_spf.example.net', TTL.host, {
      type: 'TXT',
      strings: ['v=spf1 ip4:198.51.100.0/24 -all'],
    }),
    ...delegateTo('cdn.example.net', TTL.nameserver, CDN_SERVERS),
    ...addressesOf(CDN_SERVERS, TTL.nameserver),
  ],
});

const cdnZone = zone({
  origin: 'cdn.example.net',
  tier: 'authoritative',
  nameservers: CDN_SERVERS,
  note:
    'Thirty-second TTLs, and more than one address per name. That is how a CDN steers ' +
    'traffic: not by moving servers, but by changing its answers.',
  records: [
    rr('cdn.example.net', TTL.edge, {
      type: 'SOA',
      mname: 'ns1.cdn.example.net',
      rname: 'hostmaster.cdn.example.net',
      serial: 2026090301,
      refresh: 3600,
      retry: 600,
      expire: 604800,
      minimum: 60,
    }),
    ...apexNs('cdn.example.net', TTL.nameserver, CDN_SERVERS),
    ...addressesOf(CDN_SERVERS, TTL.nameserver),
    rr('edge.cdn.example.net', TTL.edge, { type: 'A', address: '198.51.100.40' }),
    rr('edge.cdn.example.net', TTL.edge, { type: 'A', address: '198.51.100.41' }),
    rr('edge.cdn.example.net', TTL.edge, { type: 'AAAA', address: '2001:db8:4::40' }),
  ],
});

const providerZone = zone({
  origin: 'dns-provider.net',
  tier: 'authoritative',
  nameservers: PROVIDER_SERVERS,
  note: 'A managed DNS operator. Its own zone is where its nameservers get their addresses.',
  records: [
    rr('dns-provider.net', TTL.host, {
      type: 'SOA',
      mname: 'ns1.dns-provider.net',
      rname: 'hostmaster.dns-provider.net',
      serial: 2026090301,
      refresh: 7200,
      retry: 3600,
      expire: 1209600,
      minimum: 600,
    }),
    ...apexNs('dns-provider.net', TTL.nameserver, PROVIDER_SERVERS),
    ...addressesOf(PROVIDER_SERVERS, TTL.nameserver),
  ],
});

const exampleOrgZone = zone({
  origin: 'example.org',
  tier: 'authoritative',
  nameservers: PROVIDER_SERVERS,
  keys: EXAMPLE_ORG_KEYS,
  note: 'Signed, and its parent publishes a matching DS -- so answers here are secure.',
  records: [
    rr('example.org', TTL.host, {
      type: 'SOA',
      mname: 'ns1.dns-provider.net',
      rname: 'hostmaster.example.org',
      serial: 2026090301,
      refresh: 7200,
      retry: 3600,
      expire: 1209600,
      minimum: 300,
    }),
    ...apexNs('example.org', TTL.nameserver, PROVIDER_SERVERS),
    ...dnskeyRecords(EXAMPLE_ORG_KEYS, 'example.org', TTL.nameserver),
    rr('example.org', TTL.host, { type: 'A', address: '203.0.113.70' }),
    rr('example.org', TTL.host, { type: 'AAAA', address: '2001:db8:3::70' }),
    rr('www.example.org', TTL.alias, { type: 'CNAME', target: 'example.org' }),

    // A zone cut inside a signed zone. The DS here matches no key the child publishes:
    // the parent says the child is signed, the child disagrees, and a validator has to
    // call that bogus rather than fall back to trusting it.
    ...delegateTo('broken.example.org', TTL.nameserver, PROVIDER_SERVERS),
    dsRecord('broken.example.org', BROKEN_KEYS, TTL.nameserver, 'DEADBEEF'.repeat(3)),
  ],
});

const brokenZone = zone({
  origin: 'broken.example.org',
  tier: 'authoritative',
  nameservers: PROVIDER_SERVERS,
  keys: BROKEN_KEYS,
  note:
    'Signed with keys its parent does not vouch for. A validating resolver must refuse ' +
    'the answer with SERVFAIL rather than hand over data it cannot trust.',
  records: [
    rr('broken.example.org', TTL.host, {
      type: 'SOA',
      mname: 'ns1.dns-provider.net',
      rname: 'hostmaster.example.org',
      serial: 2026090301,
      refresh: 7200,
      retry: 3600,
      expire: 1209600,
      minimum: 300,
    }),
    ...apexNs('broken.example.org', TTL.nameserver, PROVIDER_SERVERS),
    ...dnskeyRecords(BROKEN_KEYS, 'broken.example.org', TTL.nameserver),
    rr('broken.example.org', TTL.host, { type: 'A', address: '203.0.113.80' }),
  ],
});

const reverseZone = zone({
  origin: '113.0.203.in-addr.arpa',
  tier: 'authoritative',
  nameservers: EXAMPLE_COM_SERVERS.slice(0, 1),
  note: 'The reverse of 203.0.113.0/24, written backwards because names delegate right to left.',
  records: [
    rr('113.0.203.in-addr.arpa', TTL.host, {
      type: 'SOA',
      mname: 'ns1.example.com',
      rname: 'hostmaster.example.com',
      serial: 2026090301,
      refresh: 7200,
      retry: 3600,
      expire: 1209600,
      minimum: 300,
    }),
    ...apexNs('113.0.203.in-addr.arpa', TTL.nameserver, EXAMPLE_COM_SERVERS.slice(0, 1)),
    rr('20.113.0.203.in-addr.arpa', TTL.host, { type: 'PTR', target: 'example.com' }),
    rr('25.113.0.203.in-addr.arpa', TTL.host, {
      type: 'PTR',
      target: 'mail.example.com',
    }),
  ],
});

// ---------------------------------------------------------------------------
// The simulated Internet
// ---------------------------------------------------------------------------

/**
 * Every zone in this module, plus the indexes a resolver needs to walk them.
 *
 * The indexes are the only place the *network* is modelled: which box answers on which
 * address, and which zones that box is authoritative for. One server can serve several
 * zones -- the root servers also serve `arpa`, and the gTLD servers serve both `com` and
 * `net` -- which is real, and which the deepest-match rule in {@link zoneServing}
 * handles without any special cases.
 */
export interface SimulatedInternet {
  readonly zones: readonly DnsZone[];
  /** The addresses a resolver is born knowing; everything else it has to be told. */
  readonly rootHints: readonly NameServer[];
  readonly byOrigin: ReadonlyMap<string, DnsZone>;
  readonly zonesByAddress: ReadonlyMap<string, readonly DnsZone[]>;
  readonly serverByAddress: ReadonlyMap<string, NameServer>;
}

/** Index a set of zones into a queryable network. */
export function createInternet(
  zones: readonly DnsZone[],
  rootHints: readonly NameServer[],
): SimulatedInternet {
  const byOrigin = new Map<string, DnsZone>();
  const zonesByAddress = new Map<string, DnsZone[]>();
  const serverByAddress = new Map<string, NameServer>();

  for (const z of zones) {
    byOrigin.set(z.origin, z);
    for (const server of z.nameservers) {
      for (const address of [server.ipv4, server.ipv6]) {
        if (!address) continue;
        serverByAddress.set(address, server);
        const served = zonesByAddress.get(address);
        if (served) served.push(z);
        else zonesByAddress.set(address, [z]);
      }
    }
  }

  return { zones, rootHints, byOrigin, zonesByAddress, serverByAddress };
}

/** The fixtures, indexed. Every lookup in this module resolves against this and only this. */
export const SIMULATED_INTERNET: SimulatedInternet = createInternet(
  [
    rootZone,
    comZone,
    netZone,
    orgZone,
    arpaZone,
    inAddrZone,
    exampleComZone,
    exampleNetZone,
    cdnZone,
    providerZone,
    exampleOrgZone,
    brokenZone,
    reverseZone,
  ],
  ROOT_SERVERS,
);

/** A zone by origin. */
export function findZone(
  internet: SimulatedInternet,
  origin: string,
): DnsZone | undefined {
  return internet.byOrigin.get(normalizeName(origin));
}

/**
 * The zone a server at `address` would answer `name` from: the deepest one it holds that
 * encloses the name.
 *
 * `undefined` means this server has no business with this name at all, which is a real
 * answer -- REFUSED -- and not an error.
 */
export function zoneServing(
  internet: SimulatedInternet,
  address: string,
  name: string,
): DnsZone | undefined {
  const served = internet.zonesByAddress.get(address) ?? [];
  let best: DnsZone | undefined;
  for (const candidate of served) {
    if (!isInBailiwick(name, candidate.origin)) continue;
    if (!best || candidate.origin.length > best.origin.length) best = candidate;
  }
  return best;
}

/** The server listening on an address, for labelling the ladder. */
export function serverAt(
  internet: SimulatedInternet,
  address: string,
): NameServer | undefined {
  return internet.serverByAddress.get(address);
}

/** Suggested lookups, used as the example chips beside the input. */
export const EXAMPLE_LOOKUPS: readonly {
  name: string;
  type: RrType;
  note: string;
}[] = [
  {
    name: 'example.com',
    type: 'A',
    note: 'The full walk: root, com, then the zone itself',
  },
  { name: 'blog.example.com', type: 'A', note: 'An alias for an alias for the apex' },
  {
    name: 'shop.example.com',
    type: 'A',
    note: 'A CNAME out to a CDN, with 30-second TTLs',
  },
  { name: 'example.com', type: 'MX', note: 'Where the mail goes, in preference order' },
  {
    name: 'default._domainkey.example.com',
    type: 'TXT',
    note: 'Too big for UDP; retried over TCP',
  },
  {
    name: 'nope.example.com',
    type: 'A',
    note: 'NXDOMAIN, and how long it is remembered',
  },
  { name: 'example.org', type: 'A', note: 'Signed end to end, with no glue on the way' },
  { name: 'broken.example.org', type: 'A', note: 'A broken chain of trust: SERVFAIL' },
  {
    name: '20.113.0.203.in-addr.arpa',
    type: 'PTR',
    note: 'The reverse lookup, down the arpa tree',
  },
];

// ---------------------------------------------------------------------------
// Answering a query from a zone
// ---------------------------------------------------------------------------

/** What a zone had to say about a question. */
export type ZoneOutcome =
  /** Here is what you asked for. */
  | 'answer'
  /** Not mine -- ask these servers, one level down. This is what root and TLD do. */
  | 'referral'
  /** The name is an alias; start again at the target. */
  | 'cname'
  /** The name exists, but not with that type (RFC 2308 s2.2). */
  | 'nodata'
  /** The name does not exist, and nothing below it does either (RFC 2308 s2.1). */
  | 'nxdomain'
  /** This server is not authoritative for this name and will not recurse. */
  | 'refused';

/** A zone's reply, in the three sections a DNS message actually has. */
export interface ZoneResponse {
  readonly outcome: ZoneOutcome;
  readonly rcode: Rcode;
  /** The AA bit. False for a referral -- the referring server is not authoritative. */
  readonly authoritative: boolean;
  readonly answer: readonly ResourceRecord[];
  readonly authority: readonly ResourceRecord[];
  readonly additional: readonly ResourceRecord[];
  /** Referrals only: the name the delegation is at, i.e. the child zone's origin. */
  readonly delegation?: string;
  /** CNAMEs only: the name resolution must continue with. */
  readonly target?: string;
  /** Negative answers only: the SOA whose MINIMUM caps how long this may be cached. */
  readonly soa?: ResourceRecord;
  /** One sentence naming what just happened, for the event log. */
  readonly note: string;
}

/** Options a query carries into a zone. */
export interface ZoneLookupOptions {
  /** The DO bit: include RRSIG, DS and NSEC records in the response. */
  readonly dnssec?: boolean;
}

function recordsAt(
  zoneData: DnsZone,
  name: string,
  type: RrType,
): readonly ResourceRecord[] {
  return zoneData.records.filter(
    (record) => record.name === name && record.type === type,
  );
}

/** The RRSIGs covering one RRset, which are separate records with their own owner name. */
function signaturesFor(
  zoneData: DnsZone,
  name: string,
  type: RrType,
): readonly ResourceRecord[] {
  return zoneData.records.filter(
    (record) =>
      record.name === name &&
      record.type === 'RRSIG' &&
      record.data.type === 'RRSIG' &&
      record.data.typeCovered === type,
  );
}

/** An RRset plus its signatures when the asker set DO, or just the RRset when it did not. */
function withSignatures(
  zoneData: DnsZone,
  name: string,
  type: RrType,
  records: readonly ResourceRecord[],
  dnssec: boolean,
): readonly ResourceRecord[] {
  if (!dnssec || records.length === 0) return records;
  return [...records, ...signaturesFor(zoneData, name, type)];
}

/** The deepest delegation point in this zone that encloses `name`, if there is one. */
function deepestDelegation(zoneData: DnsZone, name: string): string | undefined {
  let best: string | undefined;
  for (const record of zoneData.records) {
    if (record.type !== 'NS') continue;
    if (record.name === zoneData.origin) continue;
    if (!isInBailiwick(name, record.name)) continue;
    if (!best || record.name.length > best.length) best = record.name;
  }
  return best;
}

/** Addresses this zone happens to hold for the given names -- the additional section. */
function addressGlue(
  zoneData: DnsZone,
  names: readonly string[],
): readonly ResourceRecord[] {
  return zoneData.records.filter(
    (record) =>
      (record.type === 'A' || record.type === 'AAAA') && names.includes(record.name),
  );
}

/** True when any record in the zone is at, or below, this name (RFC 1034 s4.3.2). */
function nameExists(zoneData: DnsZone, name: string): boolean {
  return zoneData.records.some(
    (record) => record.name === name || isSubdomainOf(record.name, name),
  );
}

/** The wildcard that would cover `name`, if the zone publishes one (RFC 4592). */
function wildcardFor(zoneData: DnsZone, name: string, type: RrType): ResourceRecord[] {
  const wildcard = `*.${parentOf(name)}`;
  return zoneData.records
    .filter((record) => record.name === wildcard && record.type === type)
    .map((record) => ({ ...record, name }));
}

/**
 * Answer one question from one zone -- the search algorithm of RFC 1034 s4.3.2.
 *
 * The order of the checks is the whole lesson, and it is not the order people expect:
 *
 * 1. **Is the name below a delegation?** Then this server does not answer it, however
 *    much it might know. It refers. A root server asked for `www.example.com` returns
 *    the `.com` nameservers -- never an address, not even when the answer is famous.
 * 2. **Does the name exist here?** Then either the type is present (an answer), or a
 *    CNAME is (an alias to follow), or neither (NODATA -- the name is fine, the type is
 *    not, and the RCODE is still NOERROR).
 * 3. **Does a wildcard cover it?** Then the answer is synthesised at the queried name.
 * 4. **Otherwise NXDOMAIN**, with the SOA in the authority section so the asker knows
 *    how long it may remember the bad news (RFC 2308).
 */
export function lookupInZone(
  zoneData: DnsZone,
  q: DnsQuestion,
  options: ZoneLookupOptions = {},
): ZoneResponse {
  const dnssec = options.dnssec ?? false;
  const name = q.name;
  const soaRecords = recordsAt(zoneData, zoneData.origin, 'SOA');
  const soa = soaRecords[0];
  const negativeAuthority = withSignatures(
    zoneData,
    zoneData.origin,
    'SOA',
    soaRecords,
    dnssec,
  );

  // 1. Delegation. A DS query is the one exception: DS lives on the parent's side of the
  // cut, so the parent answers it authoritatively instead of referring (RFC 4035 s3.1.4).
  const delegation = deepestDelegation(zoneData, name);
  if (delegation !== undefined && !(q.type === 'DS' && name === delegation)) {
    const ns = recordsAt(zoneData, delegation, 'NS');
    const nsNames = ns.map((record) =>
      record.data.type === 'NS' ? record.data.nameserver : '',
    );
    // DS and NSEC are DNSSEC records, so a resolver that did not set DO does not get
    // them: a referral to someone who is not validating is NS records and glue, nothing
    // else. That is why DNSSEC could be deployed at all without breaking older clients.
    const ds = dnssec
      ? withSignatures(
          zoneData,
          delegation,
          'DS',
          recordsAt(zoneData, delegation, 'DS'),
          true,
        )
      : [];
    const nsec = dnssec
      ? withSignatures(
          zoneData,
          delegation,
          'NSEC',
          recordsAt(zoneData, delegation, 'NSEC'),
          true,
        )
      : [];
    const glue = addressGlue(zoneData, nsNames);

    return {
      outcome: 'referral',
      rcode: 'NOERROR',
      // Not authoritative: this zone is being asked about someone else's data.
      authoritative: false,
      answer: [],
      authority: [...ns, ...ds, ...nsec],
      additional: glue,
      delegation,
      note:
        glue.length > 0
          ? `referral to ${delegation || '.'} with glue for ${nsNames.length} nameservers`
          : `referral to ${delegation || '.'} with no glue -- the nameservers must be resolved first`,
    };
  }

  // 2. Exact name match.
  const exact = recordsAt(zoneData, name, q.type);
  if (exact.length > 0) {
    return {
      outcome: 'answer',
      rcode: 'NOERROR',
      authoritative: true,
      answer: withSignatures(zoneData, name, q.type, exact, dnssec),
      authority: [],
      additional: [],
      note: `authoritative answer: ${exact.length} ${q.type} record(s)`,
    };
  }

  const cname = recordsAt(zoneData, name, 'CNAME')[0];
  if (cname && q.type !== 'CNAME') {
    const target = cname.data.type === 'CNAME' ? cname.data.target : name;
    const answer = [...withSignatures(zoneData, name, 'CNAME', [cname], dnssec)];

    // A server chases a CNAME as far as its own zone reaches, and no further. Everything
    // it can answer comes back in one message; the rest is the resolver's problem.
    let current = target;
    const seen = new Set<string>([name]);
    while (isInBailiwick(current, zoneData.origin) && !seen.has(current)) {
      seen.add(current);
      const found = recordsAt(zoneData, current, q.type);
      if (found.length > 0) {
        answer.push(...withSignatures(zoneData, current, q.type, found, dnssec));
        return {
          outcome: 'answer',
          rcode: 'NOERROR',
          authoritative: true,
          answer,
          authority: [],
          additional: [],
          note: `alias followed inside the zone, ending at ${current}`,
        };
      }
      const next = recordsAt(zoneData, current, 'CNAME')[0];
      if (!next || next.data.type !== 'CNAME') break;
      answer.push(...withSignatures(zoneData, current, 'CNAME', [next], dnssec));
      current = next.data.target;
    }

    return {
      outcome: 'cname',
      rcode: 'NOERROR',
      authoritative: true,
      answer,
      authority: [],
      additional: [],
      target: current,
      note: `alias to ${current}, which this zone cannot answer for`,
    };
  }

  if (nameExists(zoneData, name)) {
    return {
      outcome: 'nodata',
      rcode: 'NOERROR',
      authoritative: true,
      answer: [],
      authority: negativeAuthority,
      additional: [],
      ...(soa ? { soa } : {}),
      note: `the name exists but has no ${q.type} record -- NODATA, and the RCODE is still NOERROR`,
    };
  }

  // 3. Wildcard.
  const synthesised = wildcardFor(zoneData, name, q.type);
  if (synthesised.length > 0) {
    return {
      outcome: 'answer',
      rcode: 'NOERROR',
      authoritative: true,
      answer: synthesised,
      authority: [],
      additional: [],
      note: `synthesised from the wildcard *.${parentOf(name)}`,
    };
  }

  // 4. No such name.
  return {
    outcome: 'nxdomain',
    rcode: 'NXDOMAIN',
    authoritative: true,
    answer: [],
    authority: negativeAuthority,
    additional: [],
    ...(soa ? { soa } : {}),
    note: `no such name in ${zoneData.origin || '.'} -- NXDOMAIN`,
  };
}

/**
 * Send a question to a server at an address, and get back what that server would say.
 *
 * If the server holds no zone that encloses the name, it refuses. Authoritative servers
 * do not recurse on anyone's behalf; that is the recursive resolver's job, and asking
 * one to do it is how open resolvers become amplification weapons.
 */
export function answerFrom(
  internet: SimulatedInternet,
  address: string,
  q: DnsQuestion,
  options: ZoneLookupOptions = {},
): ZoneResponse {
  const served = zoneServing(internet, address, q.name);
  if (!served) {
    return {
      outcome: 'refused',
      rcode: 'REFUSED',
      authoritative: false,
      answer: [],
      authority: [],
      additional: [],
      note: 'this server is not authoritative for that name and will not recurse',
    };
  }
  return lookupInZone(served, q, options);
}
