/**
 * Addresses -- parse, validate, format, and classify the identifiers that appear on
 * the wire: IPv4, IPv6, CIDR blocks, and MAC addresses.
 *
 * Two audiences use this file, and the stricter one wins:
 *
 * 1. Scenario authors, writing trusted address literals in module code.
 * 2. Phase 12's network diagnostics, running these validators over **untrusted user
 *    input** before anything is allowed near a real network.
 *
 * So parsing is deliberately unforgiving. Rejected: surrounding whitespace, leading
 * zeros in octets (`010.0.0.1` is octal to some resolvers and decimal to others -- a
 * classic filter bypass), IPv4 shorthand (`127.1`, `0x7f.0.0.1`, `2130706433`), IPv6
 * zone identifiers (`fe80::1%eth0`), and bracketed literals (`[::1]`). Anything
 * ambiguous is refused rather than guessed at; a caller that wants leniency must
 * normalise first, deliberately.
 *
 * Nothing here performs I/O. `classifyIp` answers "what kind of address is this?" from
 * static tables -- no DNS, no sockets. Deciding whether a request may actually be made
 * is `guard.ts`'s job in phase 12; this file gives it the facts.
 */

import { fail, ok, unwrap, type ParseResult } from './result';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Internet Protocol version. The two are separate address spaces, not variants. */
export type IpVersion = 4 | 6;

/** A parsed IPv4 address: 32 bits, written as four decimal octets. */
export interface Ipv4Address {
  readonly version: 4;
  /** The four octets in network (big-endian) order, each 0-255. */
  readonly octets: readonly [number, number, number, number];
  /** Canonical dotted-quad form, e.g. `'192.168.1.10'`. */
  readonly text: string;
}

/** Eight 16-bit groups, network order -- the whole 128 bits of an IPv6 address. */
export type Ipv6Groups = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/** A parsed IPv6 address: 128 bits, written as eight colon-separated hex groups. */
export interface Ipv6Address {
  readonly version: 6;
  /** The eight groups in network order, each 0-0xffff. */
  readonly groups: Ipv6Groups;
  /**
   * Canonical form per RFC 5952: lower case, no leading zeros within a group, the
   * longest run of zero groups compressed to `::` (leftmost run on a tie), and the
   * mixed `::ffff:a.b.c.d` notation for IPv4-mapped addresses.
   */
  readonly text: string;
}

/** Either address family, discriminated by `version`. */
export type IpAddress = Ipv4Address | Ipv6Address;

/** An address plus a prefix length: the notation for "a range of addresses". */
export interface Cidr {
  /**
   * The address exactly as written, host bits included. `192.168.1.10/24` keeps the
   * `.10`, because that is how an interface address is written; use `cidrNetwork` to
   * mask it down to `192.168.1.0`.
   */
  readonly address: IpAddress;
  /** How many leading bits are fixed: 0-32 for IPv4, 0-128 for IPv6. */
  readonly prefixLength: number;
  /** Canonical `address/prefix` text, built from the canonical address form. */
  readonly text: string;
}

/** A parsed 48-bit MAC (EUI-48) address -- the link-layer identity of one interface. */
export interface MacAddress {
  /** The six octets in transmission order. */
  readonly bytes: readonly [number, number, number, number, number, number];
  /** Canonical lower-case colon form, e.g. `'aa:bb:cc:dd:ee:ff'`. */
  readonly text: string;
}

/** The three conventional ways to write a MAC address. */
export type MacFormat =
  /** `aa:bb:cc:dd:ee:ff` -- IEEE and Linux convention, the canonical form here. */
  | 'colon'
  /** `aa-bb-cc-dd-ee-ff` -- Windows convention. */
  | 'hyphen'
  /** `aabb.ccdd.eeff` -- Cisco convention. */
  | 'dot';

// ---------------------------------------------------------------------------
// IPv4
// ---------------------------------------------------------------------------

/** Four groups of 1-3 ASCII digits. `\d` is ASCII-only in JS, so Unicode digits fail. */
const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Parse a dotted-quad IPv4 address in its one unambiguous form.
 *
 * Rejects the shorthands `inet_aton` accepts (`127.1`, `0x7f.0.0.1`, `2130706433`) and
 * octets with leading zeros, because those are exactly what is reached for to smuggle
 * a loopback address past a naive allow-list.
 */
export function parseIpv4(input: string): ParseResult<Ipv4Address> {
  if (typeof input !== 'string') {
    return fail('expected a string');
  }
  const match = IPV4_PATTERN.exec(input);
  if (!match) {
    return fail(`"${input}" is not four dot-separated decimal octets`);
  }

  const parts = [match[1], match[2], match[3], match[4]];
  for (const part of parts) {
    if (part.length > 1 && part.startsWith('0')) {
      return fail(`octet "${part}" has a leading zero, which is ambiguous (octal?)`);
    }
    if (Number(part) > 255) {
      return fail(`octet "${part}" is out of range 0-255`);
    }
  }

  const octets: [number, number, number, number] = [
    Number(parts[0]),
    Number(parts[1]),
    Number(parts[2]),
    Number(parts[3]),
  ];
  return ok({ version: 4, octets, text: octets.join('.') });
}

/** Canonical dotted-quad text. */
export function formatIpv4(address: Ipv4Address): string {
  return address.octets.join('.');
}

/** The address as a single unsigned 32-bit number -- how a routing table sees it. */
export function ipv4ToNumber(address: Ipv4Address): number {
  const [a, b, c, d] = address.octets;
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

/** Inverse of {@link ipv4ToNumber}; throws on a value outside 0..2^32-1. */
export function ipv4FromNumber(value: number): Ipv4Address {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError(`${value} is not a 32-bit unsigned integer`);
  }
  return ipv4FromBytes([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function ipv4FromBytes(bytes: readonly number[]): Ipv4Address {
  const octets: [number, number, number, number] = [
    bytes[0],
    bytes[1],
    bytes[2],
    bytes[3],
  ];
  return { version: 4, octets, text: octets.join('.') };
}

// ---------------------------------------------------------------------------
// IPv6
// ---------------------------------------------------------------------------

const IPV6_GROUP_PATTERN = /^[0-9a-fA-F]{1,4}$/;

/**
 * Parse an IPv6 address in RFC 4291 textual form.
 *
 * Accepts the full form, `::` zero-compression (at most once, standing for at least
 * one zero group), and a trailing embedded IPv4 quad occupying the last 32 bits
 * (`::ffff:192.0.2.1`). Rejects zone identifiers and brackets: both are decoration
 * added by other layers, and both have been used to slip an address past a validator
 * that then strips them.
 */
export function parseIpv6(input: string): ParseResult<Ipv6Address> {
  if (typeof input !== 'string') {
    return fail('expected a string');
  }
  if (input.length === 0) {
    return fail('empty string is not an IPv6 address');
  }
  if (input.includes('%')) {
    return fail('zone identifiers ("%eth0") are not accepted');
  }
  if (input.includes('[') || input.includes(']')) {
    return fail('brackets are URL syntax, not part of the address');
  }

  const halves = input.split('::');
  if (halves.length > 2) {
    return fail('"::" may appear only once');
  }
  const compressed = halves.length === 2;
  const headText = halves[0];
  const tailText = compressed ? halves[1] : '';

  const headParts = headText === '' ? [] : headText.split(':');
  const tailParts = !compressed || tailText === '' ? [] : tailText.split(':');

  // An embedded IPv4 quad only means anything as the low 32 bits, so it may only be
  // the final component: of the tail when compressed, of the whole address otherwise.
  const head = parseIpv6Groups(headParts, !compressed);
  if (!head.ok) {
    return fail(head.error);
  }
  const tail = parseIpv6Groups(tailParts, compressed);
  if (!tail.ok) {
    return fail(tail.error);
  }

  const supplied = head.value.length + tail.value.length;
  let groups: number[];
  if (compressed) {
    if (supplied > 7) {
      return fail('"::" must stand for at least one group of zeros');
    }
    groups = [...head.value, ...new Array<number>(8 - supplied).fill(0), ...tail.value];
  } else {
    if (supplied !== 8) {
      return fail(`expected 8 groups, found ${supplied}`);
    }
    groups = head.value;
  }

  return ok(ipv6FromGroupList(groups));
}

function parseIpv6Groups(
  parts: readonly string[],
  allowEmbeddedIpv4: boolean,
): ParseResult<number[]> {
  const groups: number[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    const isLast = i === parts.length - 1;

    if (part.includes('.')) {
      if (!allowEmbeddedIpv4 || !isLast) {
        return fail(`embedded IPv4 "${part}" is only allowed as the final 32 bits`);
      }
      const embedded = parseIpv4(part);
      if (!embedded.ok) {
        return fail(`embedded IPv4: ${embedded.error}`);
      }
      const [a, b, c, d] = embedded.value.octets;
      groups.push((a << 8) | b, (c << 8) | d);
      continue;
    }

    if (part === '') {
      return fail('empty group -- check for a stray ":"');
    }
    if (!IPV6_GROUP_PATTERN.test(part)) {
      return fail(`"${part}" is not 1-4 hexadecimal digits`);
    }
    groups.push(parseInt(part, 16));
  }
  return ok(groups);
}

function asIpv6Groups(list: readonly number[]): Ipv6Groups {
  return [list[0], list[1], list[2], list[3], list[4], list[5], list[6], list[7]];
}

function ipv6FromGroupList(list: readonly number[]): Ipv6Address {
  const groups = asIpv6Groups(list);
  return { version: 6, groups, text: canonicalIpv6Text(groups) };
}

function ipv6FromBytes(bytes: readonly number[]): Ipv6Address {
  const groups: number[] = [];
  for (let i = 0; i < 16; i += 2) {
    groups.push((bytes[i] << 8) | bytes[i + 1]);
  }
  return ipv6FromGroupList(groups);
}

/** RFC 5952 canonical text: lower case, no leading zeros, longest zero run compressed. */
function canonicalIpv6Text(groups: Ipv6Groups): string {
  if (isMappedGroups(groups)) {
    const low = ipv4FromBytes([
      groups[6] >> 8,
      groups[6] & 0xff,
      groups[7] >> 8,
      groups[7] & 0xff,
    ]);
    return `::ffff:${low.text}`;
  }

  let bestStart = -1;
  let bestLength = 0;
  let runStart = -1;
  let runLength = 0;
  for (let i = 0; i < 8; i += 1) {
    if (groups[i] === 0) {
      if (runStart < 0) {
        runStart = i;
      }
      runLength += 1;
      // Strictly greater keeps the leftmost run on a tie, as RFC 5952 requires.
      if (runLength > bestLength) {
        bestLength = runLength;
        bestStart = runStart;
      }
    } else {
      runStart = -1;
      runLength = 0;
    }
  }

  const parts = groups.map((group) => group.toString(16));
  if (bestLength < 2) {
    return parts.join(':');
  }
  const head = parts.slice(0, bestStart).join(':');
  const tail = parts.slice(bestStart + bestLength).join(':');
  return `${head}::${tail}`;
}

/** Canonical (compressed) IPv6 text. */
export function formatIpv6(address: Ipv6Address): string {
  return address.text;
}

/**
 * The fully expanded 39-character form, `2001:0db8:0000:0000:0000:0000:0000:0001`.
 *
 * Never sent on the wire, but it is what makes a 128-bit address legible in a teaching
 * inspector: every group present, every leading zero shown.
 */
export function expandIpv6(address: Ipv6Address): string {
  return address.groups.map((group) => group.toString(16).padStart(4, '0')).join(':');
}

/** Is this an IPv4-mapped IPv6 address (`::ffff:0:0/96`)? */
export function isIpv4Mapped(address: IpAddress): boolean {
  return address.version === 6 && isMappedGroups(address.groups);
}

function isMappedGroups(groups: Ipv6Groups): boolean {
  return (
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0xffff
  );
}

/**
 * The IPv4 address inside an IPv4-mapped IPv6 address, or `undefined`.
 *
 * This is the unwrapping a filter must do before it decides anything: `::ffff:127.0.0.1`
 * is loopback, however IPv6 it looks.
 */
export function unwrapIpv4Mapped(address: IpAddress): Ipv4Address | undefined {
  if (address.version !== 6 || !isMappedGroups(address.groups)) {
    return undefined;
  }
  return ipv4FromBytes([
    address.groups[6] >> 8,
    address.groups[6] & 0xff,
    address.groups[7] >> 8,
    address.groups[7] & 0xff,
  ]);
}

// ---------------------------------------------------------------------------
// Either family
// ---------------------------------------------------------------------------

/** Parse an address of either family; the presence of a `:` picks IPv6. */
export function parseIp(input: string): ParseResult<IpAddress> {
  if (typeof input !== 'string') {
    return fail('expected a string');
  }
  return input.includes(':') ? parseIpv6(input) : parseIpv4(input);
}

/** Canonical text for either family. */
export function formatIp(address: IpAddress): string {
  return address.text;
}

/** True if `input` is a valid IPv4 address in strict dotted-quad form. */
export function isIpv4(input: string): boolean {
  return parseIpv4(input).ok;
}

/** True if `input` is a valid IPv6 address. */
export function isIpv6(input: string): boolean {
  return parseIpv6(input).ok;
}

/** True if `input` is a valid address of either family. */
export function isIp(input: string): boolean {
  return parseIp(input).ok;
}

/** Structural equality. Canonical text makes this exact for both families. */
export function ipEquals(a: IpAddress, b: IpAddress): boolean {
  return a.version === b.version && a.text === b.text;
}

/** The address as raw bytes -- 4 for IPv4, 16 for IPv6. Network order. */
export function ipToBytes(address: IpAddress): number[] {
  if (address.version === 4) {
    return [...address.octets];
  }
  const bytes: number[] = [];
  for (const group of address.groups) {
    bytes.push(group >> 8, group & 0xff);
  }
  return bytes;
}

/** Width of the address space for this family, in bits. */
export function addressBits(version: IpVersion): number {
  return version === 4 ? 32 : 128;
}

/**
 * Parse a trusted address literal, throwing on a typo.
 *
 * For topology and scenario files, where a bad address is a bug in the repository and
 * not a user mistake. **Never call this on user input** -- use {@link parseIp} there.
 */
export function ip(text: string): IpAddress {
  return unwrap(parseIp(text), `IP address "${text}"`);
}

// ---------------------------------------------------------------------------
// CIDR
// ---------------------------------------------------------------------------

/**
 * Parse `address/prefix`.
 *
 * The prefix must be plain decimal with no leading zero, and must fit the family of
 * the address it is attached to: `/33` is a rejected IPv4 prefix and a fine IPv6 one.
 * Host bits are preserved -- see {@link cidrNetwork} and {@link hasHostBits}.
 */
export function parseCidr(input: string): ParseResult<Cidr> {
  if (typeof input !== 'string') {
    return fail('expected a string');
  }
  const slash = input.indexOf('/');
  if (slash < 0) {
    return fail('missing "/" -- a CIDR block looks like 10.0.0.0/8');
  }
  if (input.indexOf('/', slash + 1) !== -1) {
    return fail('more than one "/"');
  }

  const address = parseIp(input.slice(0, slash));
  if (!address.ok) {
    return fail(address.error);
  }

  const prefixText = input.slice(slash + 1);
  if (!/^\d{1,3}$/.test(prefixText)) {
    return fail(`prefix "${prefixText}" is not a decimal number`);
  }
  if (prefixText.length > 1 && prefixText.startsWith('0')) {
    return fail(`prefix "${prefixText}" has a leading zero`);
  }

  const prefixLength = Number(prefixText);
  const max = addressBits(address.value.version);
  if (prefixLength > max) {
    return fail(
      `prefix /${prefixLength} is out of range for IPv${address.value.version} (0-${max})`,
    );
  }

  return ok({
    address: address.value,
    prefixLength,
    text: `${address.value.text}/${prefixLength}`,
  });
}

/** Canonical `address/prefix` text. */
export function formatCidr(block: Cidr): string {
  return block.text;
}

/** True if `input` is a valid CIDR block. */
export function isCidr(input: string): boolean {
  return parseCidr(input).ok;
}

/** Parse a trusted CIDR literal, throwing on a typo. See {@link ip}. */
export function cidr(text: string): Cidr {
  return unwrap(parseCidr(text), `CIDR block "${text}"`);
}

function maskBytes(bytes: readonly number[], prefixLength: number): number[] {
  return bytes.map((byte, index) => {
    const bitsBefore = index * 8;
    if (prefixLength >= bitsBefore + 8) {
      return byte;
    }
    if (prefixLength <= bitsBefore) {
      return 0;
    }
    return byte & ((0xff << (8 - (prefixLength - bitsBefore))) & 0xff);
  });
}

/** The block's network address -- the same prefix with every host bit cleared. */
export function cidrNetwork(block: Cidr): IpAddress {
  const masked = maskBytes(ipToBytes(block.address), block.prefixLength);
  return block.address.version === 4 ? ipv4FromBytes(masked) : ipv6FromBytes(masked);
}

/** True if the address was written with host bits set, e.g. `192.168.1.10/24`. */
export function hasHostBits(block: Cidr): boolean {
  return !ipEquals(block.address, cidrNetwork(block));
}

/**
 * The IPv4 broadcast address of the block -- every host bit set.
 *
 * IPv6 has no broadcast (it uses multicast instead), so this returns `undefined` for
 * an IPv6 block rather than inventing one.
 */
export function cidrBroadcast(block: Cidr): Ipv4Address | undefined {
  if (block.address.version !== 4) {
    return undefined;
  }
  const network = maskBytes(ipToBytes(block.address), block.prefixLength);
  const broadcast = network.map((byte, index) => {
    const bitsBefore = index * 8;
    if (block.prefixLength >= bitsBefore + 8) {
      return byte;
    }
    if (block.prefixLength <= bitsBefore) {
      return 0xff;
    }
    return byte | (0xff >>> (block.prefixLength - bitsBefore));
  });
  return ipv4FromBytes(broadcast);
}

/**
 * Does `block` contain `address`?
 *
 * Different families never match: `::ffff:10.0.0.1` is not "in" `10.0.0.0/8` as far as
 * this function is concerned. Unwrap the mapping first ({@link unwrapIpv4Mapped}) if
 * that is what you mean -- having to be explicit about it is the point.
 */
export function cidrContains(block: Cidr, address: IpAddress): boolean {
  if (block.address.version !== address.version) {
    return false;
  }
  const network = ipToBytes(block.address);
  const candidate = ipToBytes(address);
  let remaining = block.prefixLength;
  for (let i = 0; i < network.length && remaining > 0; i += 1) {
    const bits = Math.min(8, remaining);
    const mask = (0xff << (8 - bits)) & 0xff;
    if ((network[i] & mask) !== (candidate[i] & mask)) {
      return false;
    }
    remaining -= bits;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * What kind of address this is -- which is really the question "where is it allowed to
 * go, and who is allowed to answer for it?".
 *
 * Everything that is not `'public'` is special-purpose in some way, and phase 12's
 * SSRF guard refuses all of them.
 */
export type IpScope =
  /** Globally routable. The only scope a real diagnostics request may target. */
  | 'public'
  /** RFC 1918 / RFC 4193 -- routable inside one organisation, never on the Internet. */
  | 'private'
  /** The host itself (`127.0.0.0/8`, `::1`). Never reaches a wire. */
  | 'loopback'
  /** Self-assigned, valid on one link only (`169.254.0.0/16`, `fe80::/10`). */
  | 'link-local'
  /** One-to-many delivery (`224.0.0.0/4`, `ff00::/8`), never a unicast destination. */
  | 'multicast'
  /** The IPv4 limited broadcast address `255.255.255.255`. */
  | 'broadcast'
  /** "No address" (`0.0.0.0`, `::`) -- a source before DHCP, never a destination. */
  | 'unspecified'
  /** Carrier-grade NAT space (`100.64.0.0/10`), shared between ISP subscribers. */
  | 'shared'
  /** Reserved for examples and documentation (`192.0.2.0/24`, `2001:db8::/32`). */
  | 'documentation'
  /** Reserved for network device benchmarking (`198.18.0.0/15`). */
  | 'benchmarking'
  /** Reserved by IANA for another special purpose, or for future use. */
  | 'reserved';

/** The scope of an address, the block it matched, and why that block exists. */
export interface IpClassification {
  readonly scope: IpScope;
  /** The special-purpose block matched, e.g. `'10.0.0.0/8'`; absent when public. */
  readonly block?: string;
  /** One sentence explaining the block, for the inspector. */
  readonly note: string;
}

interface ScopeRule {
  readonly block: Cidr;
  readonly scope: IpScope;
  readonly note: string;
}

function rule(block: string, scope: IpScope, note: string): ScopeRule {
  return { block: cidr(block), scope, note };
}

/**
 * The IANA IPv4 special-purpose registry, ordered most-specific first: the first match
 * wins, so `255.255.255.255/32` has to precede `240.0.0.0/4`.
 */
const IPV4_SCOPE_RULES: readonly ScopeRule[] = [
  rule('0.0.0.0/32', 'unspecified', 'means "this host"; a valid source, never a target'),
  rule('0.0.0.0/8', 'reserved', '"this network" -- only valid as a source during boot'),
  rule('10.0.0.0/8', 'private', 'RFC 1918 private use; never routed on the Internet'),
  rule('100.64.0.0/10', 'shared', 'carrier-grade NAT space shared between subscribers'),
  rule('127.0.0.0/8', 'loopback', 'the host itself; packets never reach a wire'),
  rule('169.254.0.0/16', 'link-local', 'self-assigned when DHCP fails; one link only'),
  rule('172.16.0.0/12', 'private', 'RFC 1918 private use; never routed on the Internet'),
  rule('192.0.0.0/24', 'reserved', 'IETF protocol assignments'),
  rule('192.0.2.0/24', 'documentation', 'TEST-NET-1, reserved for examples'),
  rule('192.88.99.0/24', 'reserved', 'deprecated 6to4 relay anycast'),
  rule('192.168.0.0/16', 'private', 'RFC 1918 private use; the usual home network'),
  rule('198.18.0.0/15', 'benchmarking', 'reserved for network device benchmarking'),
  rule('198.51.100.0/24', 'documentation', 'TEST-NET-2, reserved for examples'),
  rule('203.0.113.0/24', 'documentation', 'TEST-NET-3, reserved for examples'),
  rule('224.0.0.0/4', 'multicast', 'one-to-many delivery, not a unicast destination'),
  rule('255.255.255.255/32', 'broadcast', 'limited broadcast; every host on the link'),
  rule('240.0.0.0/4', 'reserved', 'reserved for future use; not routed'),
];

/** The IANA IPv6 special-purpose registry, again most-specific first. */
const IPV6_SCOPE_RULES: readonly ScopeRule[] = [
  rule('::/128', 'unspecified', 'the unspecified address; a source only, never a target'),
  rule('::1/128', 'loopback', 'the host itself; packets never reach a wire'),
  rule('::/96', 'reserved', 'deprecated IPv4-compatible addresses'),
  rule('64:ff9b::/96', 'reserved', 'NAT64 translation prefix'),
  rule('100::/64', 'reserved', 'discard-only address block'),
  rule('2001::/32', 'reserved', 'Teredo tunnelling'),
  rule('2001:db8::/32', 'documentation', 'reserved for examples and documentation'),
  rule('2002::/16', 'reserved', 'deprecated 6to4 tunnelling'),
  rule('fc00::/7', 'private', 'unique local addresses -- the IPv6 answer to RFC 1918'),
  rule('fe80::/10', 'link-local', 'auto-configured; valid on one link only'),
  rule('fec0::/10', 'reserved', 'deprecated site-local addresses'),
  rule('ff00::/8', 'multicast', 'one-to-many delivery, not a unicast destination'),
];

const PUBLIC_CLASSIFICATION: IpClassification = {
  scope: 'public',
  note: 'globally routable address space',
};

/**
 * Full classification: the scope, the special-purpose block it came from, and a
 * sentence explaining that block.
 *
 * An IPv4-mapped IPv6 address is classified by the IPv4 address inside it, because
 * that is where the packet actually goes. This is the check a naive filter forgets.
 */
export function describeIp(address: IpAddress): IpClassification {
  const mapped = unwrapIpv4Mapped(address);
  if (mapped) {
    const inner = describeIp(mapped);
    return { ...inner, note: `IPv4-mapped: ${inner.note}` };
  }

  const rules = address.version === 4 ? IPV4_SCOPE_RULES : IPV6_SCOPE_RULES;
  for (const candidate of rules) {
    if (cidrContains(candidate.block, address)) {
      return {
        scope: candidate.scope,
        block: candidate.block.text,
        note: candidate.note,
      };
    }
  }
  return PUBLIC_CLASSIFICATION;
}

/** The scope of an address: private, loopback, link-local, public, and the rest. */
export function classifyIp(address: IpAddress): IpScope {
  return describeIp(address).scope;
}

/** RFC 1918 / RFC 4193 private space. */
export function isPrivateIp(address: IpAddress): boolean {
  return classifyIp(address) === 'private';
}

/** `127.0.0.0/8` or `::1` -- including their IPv4-mapped disguises. */
export function isLoopbackIp(address: IpAddress): boolean {
  return classifyIp(address) === 'loopback';
}

/** `169.254.0.0/16` or `fe80::/10`. */
export function isLinkLocalIp(address: IpAddress): boolean {
  return classifyIp(address) === 'link-local';
}

/** `224.0.0.0/4` or `ff00::/8`. */
export function isMulticastIp(address: IpAddress): boolean {
  return classifyIp(address) === 'multicast';
}

/**
 * Globally routable, and therefore the only kind of address a real diagnostics request
 * may ever target. Everything else is special-purpose in some way.
 */
export function isPublicIp(address: IpAddress): boolean {
  return classifyIp(address) === 'public';
}

// ---------------------------------------------------------------------------
// MAC
// ---------------------------------------------------------------------------

const MAC_COLON_PATTERN = /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}$/;
const MAC_HYPHEN_PATTERN = /^[0-9a-fA-F]{2}(-[0-9a-fA-F]{2}){5}$/;
const MAC_DOT_PATTERN = /^[0-9a-fA-F]{4}(\.[0-9a-fA-F]{4}){2}$/;

/**
 * Parse a 48-bit MAC address in colon, hyphen, or Cisco dotted form.
 *
 * One separator style per address: `aa:bb-cc:dd:ee:ff` is rejected, as is the
 * separator-less `aabbccddeeff`, because neither is a form any tool emits.
 */
export function parseMac(input: string): ParseResult<MacAddress> {
  if (typeof input !== 'string') {
    return fail('expected a string');
  }
  const recognised =
    MAC_COLON_PATTERN.test(input) ||
    MAC_HYPHEN_PATTERN.test(input) ||
    MAC_DOT_PATTERN.test(input);
  if (!recognised) {
    return fail(
      `"${input}" is not a MAC address (expected aa:bb:cc:dd:ee:ff, aa-bb-cc-dd-ee-ff, or aabb.ccdd.eeff)`,
    );
  }

  const digits = input.replace(/[:.-]/g, '');
  const bytes: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 6; i += 1) {
    bytes[i] = parseInt(digits.slice(i * 2, i * 2 + 2), 16);
  }
  return ok({ bytes, text: macText(bytes, 'colon') });
}

function macText(bytes: readonly number[], format: MacFormat): string {
  const pairs = bytes.map((byte) => byte.toString(16).padStart(2, '0'));
  if (format === 'dot') {
    return `${pairs[0]}${pairs[1]}.${pairs[2]}${pairs[3]}.${pairs[4]}${pairs[5]}`;
  }
  return pairs.join(format === 'hyphen' ? '-' : ':');
}

/** Render a MAC in any of the three conventional notations. Always lower case. */
export function formatMac(address: MacAddress, format: MacFormat = 'colon'): string {
  return macText(address.bytes, format);
}

/** True if `input` is a valid MAC address. */
export function isMac(input: string): boolean {
  return parseMac(input).ok;
}

/** Parse a trusted MAC literal, throwing on a typo. See {@link ip}. */
export function mac(text: string): MacAddress {
  return unwrap(parseMac(text), `MAC address "${text}"`);
}

/** `ff:ff:ff:ff:ff:ff` -- where an ARP request is addressed. */
export const BROADCAST_MAC: MacAddress = mac('ff:ff:ff:ff:ff:ff');

/** Is this the all-ones broadcast address? */
export function isBroadcastMac(address: MacAddress): boolean {
  return address.bytes.every((byte) => byte === 0xff);
}

/**
 * Is the I/G (individual/group) bit set?
 *
 * The low bit of the first octet. Set means the frame is for a group of interfaces,
 * which is why broadcast (`ff:...`) is also multicast.
 */
export function isMulticastMac(address: MacAddress): boolean {
  return (address.bytes[0] & 0x01) === 0x01;
}

/**
 * Is the U/L (universal/local) bit set?
 *
 * The second-lowest bit of the first octet. Set means the address was assigned locally
 * -- by a hypervisor, a container runtime, or a privacy-randomising Wi-Fi client --
 * rather than burned in by the manufacturer.
 */
export function isLocallyAdministeredMac(address: MacAddress): boolean {
  return (address.bytes[0] & 0x02) === 0x02;
}

/**
 * The OUI: the first three octets, which identify the hardware manufacturer.
 *
 * Meaningless for a locally administered address -- check
 * {@link isLocallyAdministeredMac} before showing it as a vendor.
 */
export function macOui(address: MacAddress): string {
  return macText(address.bytes.slice(0, 3), 'colon');
}
