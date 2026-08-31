import { describe, expect, it } from 'vitest';
import {
  BROADCAST_MAC,
  addressBits,
  cidr,
  cidrBroadcast,
  cidrContains,
  cidrNetwork,
  classifyIp,
  describeIp,
  expandIpv6,
  formatCidr,
  formatIp,
  formatIpv4,
  formatIpv6,
  formatMac,
  hasHostBits,
  ip,
  ipEquals,
  ipToBytes,
  ipv4FromNumber,
  ipv4ToNumber,
  isBroadcastMac,
  isCidr,
  isIp,
  isIpv4,
  isIpv4Mapped,
  isIpv6,
  isLinkLocalIp,
  isLocallyAdministeredMac,
  isLoopbackIp,
  isMac,
  isMulticastIp,
  isMulticastMac,
  isPrivateIp,
  isPublicIp,
  mac,
  macOui,
  parseCidr,
  parseIp,
  parseIpv4,
  parseIpv6,
  parseMac,
  unwrapIpv4Mapped,
  type IpScope,
} from '../address';

/** Assert a parse succeeded and hand back the value, keeping tests to one line each. */
function value<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) {
    throw new Error(`expected a successful parse, got: ${result.error}`);
  }
  return result.value;
}

/** Assert a parse failed and hand back the reason, so messages stay tested too. */
function error<T>(result: { ok: true; value: T } | { ok: false; error: string }): string {
  if (result.ok) {
    throw new Error(`expected a rejection, got: ${JSON.stringify(result.value)}`);
  }
  return result.error;
}

describe('parseIpv4', () => {
  it('parses a dotted quad into octets and canonical text', () => {
    expect(parseIpv4('192.168.1.10')).toEqual({
      ok: true,
      value: { version: 4, octets: [192, 168, 1, 10], text: '192.168.1.10' },
    });
  });

  it('accepts the boundary values of the address space', () => {
    expect(value(parseIpv4('0.0.0.0')).octets).toEqual([0, 0, 0, 0]);
    expect(value(parseIpv4('255.255.255.255')).octets).toEqual([255, 255, 255, 255]);
  });

  it.each([
    ['1.2.3', 'too few octets'],
    ['1.2.3.4.5', 'too many octets'],
    ['1.2.3.', 'trailing dot'],
    ['.1.2.3', 'leading dot'],
    ['1..2.3', 'empty octet'],
    ['', 'empty string'],
    ['1.2.3.4 ', 'trailing whitespace'],
    [' 1.2.3.4', 'leading whitespace'],
    ['1.2.3.4\n', 'trailing newline'],
    ['+1.2.3.4', 'sign'],
    ['1.2.3.-4', 'negative octet'],
    ['1.2.3.4/24', 'a CIDR block is not an address'],
    ['12.34.56.789', 'four digit octet'],
    ['１.２.３.４', 'full-width Unicode digits'],
  ])('rejects %s (%s)', (input) => {
    expect(parseIpv4(input).ok).toBe(false);
  });

  it('rejects the inet_aton shorthands a lenient resolver would accept', () => {
    // Each of these resolves to 127.0.0.1 in C's inet_aton, which is exactly how a
    // loopback address gets past a filter that only looks for the string "127.0.0.1".
    expect(parseIpv4('127.1').ok).toBe(false);
    expect(parseIpv4('127.0.1').ok).toBe(false);
    expect(parseIpv4('2130706433').ok).toBe(false);
    expect(parseIpv4('0x7f.0.0.1').ok).toBe(false);
    expect(parseIpv4('0177.0.0.1').ok).toBe(false);
  });

  it('rejects leading zeros, which are octal to some parsers and decimal to others', () => {
    expect(error(parseIpv4('010.0.0.1'))).toContain('leading zero');
    expect(error(parseIpv4('192.168.01.1'))).toContain('leading zero');
    expect(parseIpv4('0.0.0.0').ok).toBe(true);
  });

  it('reports which octet is out of range', () => {
    expect(error(parseIpv4('192.168.1.256'))).toBe('octet "256" is out of range 0-255');
  });

  it('rejects a non-string at runtime, since phase 12 parses untrusted JSON', () => {
    expect(error(parseIpv4(undefined as unknown as string))).toBe('expected a string');
  });

  it('round-trips through a 32-bit integer', () => {
    const address = value(parseIpv4('192.0.2.33'));
    expect(ipv4ToNumber(address)).toBe(3221226017);
    expect(ipv4FromNumber(3221226017)).toEqual(address);
    expect(ipv4ToNumber(value(parseIpv4('255.255.255.255')))).toBe(4294967295);
  });

  it('refuses to build an address from a value that is not 32 bits', () => {
    expect(() => ipv4FromNumber(-1)).toThrow(RangeError);
    expect(() => ipv4FromNumber(2 ** 32)).toThrow(RangeError);
    expect(() => ipv4FromNumber(1.5)).toThrow(RangeError);
  });

  it('formats back to dotted quad', () => {
    expect(formatIpv4(value(parseIpv4('10.0.0.1')))).toBe('10.0.0.1');
  });
});

describe('parseIpv6', () => {
  it('parses the full eight-group form', () => {
    expect(value(parseIpv6('2001:0db8:0000:0000:0000:ff00:0042:8329')).groups).toEqual([
      0x2001, 0x0db8, 0, 0, 0, 0xff00, 0x42, 0x8329,
    ]);
  });

  it.each([
    ['2001:0db8:0000:0000:0000:ff00:0042:8329', '2001:db8::ff00:42:8329'],
    ['2001:DB8::1', '2001:db8::1'],
    ['::', '::'],
    ['::1', '::1'],
    ['1::', '1::'],
    ['0:0:0:0:0:0:0:0', '::'],
    ['1:2:3:4:5:6:7:8', '1:2:3:4:5:6:7:8'],
    // RFC 5952: "::" may not stand in for a single zero group.
    ['1:2:3:4:5:6:7::', '1:2:3:4:5:6:7:0'],
    // RFC 5952: on a tie, the leftmost run is the one compressed.
    ['1:0:0:2:0:0:3:4', '1::2:0:0:3:4'],
    ['fe80:0:0:0:0:0:0:1', 'fe80::1'],
  ])('canonicalises %s to %s', (input, expected) => {
    expect(value(parseIpv6(input)).text).toBe(expected);
  });

  it('parses an embedded IPv4 quad as the final 32 bits', () => {
    expect(value(parseIpv6('::ffff:192.0.2.128')).groups).toEqual([
      0, 0, 0, 0, 0, 0xffff, 0xc000, 0x0280,
    ]);
    expect(value(parseIpv6('64:ff9b::192.0.2.33')).text).toBe('64:ff9b::c000:221');
    expect(value(parseIpv6('0:0:0:0:0:ffff:1.2.3.4')).text).toBe('::ffff:1.2.3.4');
  });

  it('writes IPv4-mapped addresses in the mixed notation RFC 5952 recommends', () => {
    expect(value(parseIpv6('::ffff:8.8.8.8')).text).toBe('::ffff:8.8.8.8');
  });

  it.each([
    ['1:2:3:4:5:6:7:8:9', 'nine groups'],
    ['1:2:3:4:5:6:7', 'seven groups without compression'],
    ['1::2::3', 'two compressions'],
    ['::1::', 'two compressions, one empty'],
    [':1:2:3:4:5:6:7:8', 'leading single colon'],
    ['1:2:3:4:5:6:7:8:', 'trailing single colon'],
    [':::', 'stray colon'],
    ['12345::', 'five hex digits in a group'],
    ['gggg::1', 'not hexadecimal'],
    ['1:2:3:4:5:6:7:8::', 'compression standing for nothing'],
    ['', 'empty string'],
    ['2001:db8::1 ', 'trailing whitespace'],
    ['1.2.3.4::', 'embedded IPv4 outside the low 32 bits'],
    ['::ffff:1.2.3.4:5', 'embedded IPv4 not last'],
    ['::ffff:1.2.3.4.5', 'malformed embedded IPv4'],
    ['::ffff:999.0.0.1', 'out-of-range embedded IPv4'],
  ])('rejects %s (%s)', (input) => {
    expect(parseIpv6(input).ok).toBe(false);
  });

  it('rejects zone identifiers and bracketed URL syntax', () => {
    expect(error(parseIpv6('fe80::1%eth0'))).toContain('zone identifier');
    expect(error(parseIpv6('[::1]'))).toContain('brackets');
  });

  it('rejects a non-string at runtime', () => {
    expect(error(parseIpv6(42 as unknown as string))).toBe('expected a string');
  });

  it('expands to the full 39-character form for the inspector', () => {
    expect(expandIpv6(value(parseIpv6('2001:db8::1')))).toBe(
      '2001:0db8:0000:0000:0000:0000:0000:0001',
    );
    expect(formatIpv6(value(parseIpv6('2001:db8::1')))).toBe('2001:db8::1');
  });

  it('unwraps IPv4-mapped addresses', () => {
    const mapped = value(parseIpv6('::ffff:127.0.0.1'));
    expect(isIpv4Mapped(mapped)).toBe(true);
    expect(unwrapIpv4Mapped(mapped)?.text).toBe('127.0.0.1');

    const plain = value(parseIpv6('2001:db8::1'));
    expect(isIpv4Mapped(plain)).toBe(false);
    expect(unwrapIpv4Mapped(plain)).toBeUndefined();
    expect(unwrapIpv4Mapped(value(parseIpv4('10.0.0.1')))).toBeUndefined();
  });
});

describe('parseIp and the predicates', () => {
  it('picks the family from the presence of a colon', () => {
    expect(value(parseIp('10.0.0.1')).version).toBe(4);
    expect(value(parseIp('2001:db8::1')).version).toBe(6);
    expect(parseIp('nonsense').ok).toBe(false);
    expect(error(parseIp(null as unknown as string))).toBe('expected a string');
  });

  it('answers the boolean form of the same question', () => {
    expect(isIpv4('1.2.3.4')).toBe(true);
    expect(isIpv4('::1')).toBe(false);
    expect(isIpv6('::1')).toBe(true);
    expect(isIpv6('1.2.3.4')).toBe(false);
    expect(isIp('1.2.3.4')).toBe(true);
    expect(isIp('::1')).toBe(true);
    expect(isIp('example.com')).toBe(false);
  });

  it('compares addresses by canonical value, not by how they were written', () => {
    expect(ipEquals(ip('2001:0db8::0001'), ip('2001:db8::1'))).toBe(true);
    expect(ipEquals(ip('10.0.0.1'), ip('10.0.0.2'))).toBe(false);
    expect(ipEquals(ip('::ffff:10.0.0.1'), ip('10.0.0.1'))).toBe(false);
  });

  it('renders bytes in network order', () => {
    expect(ipToBytes(ip('192.0.2.1'))).toEqual([192, 0, 2, 1]);
    expect(ipToBytes(ip('::1'))).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ]);
  });

  it('formats either family from its canonical text', () => {
    expect(formatIp(ip('10.0.0.1'))).toBe('10.0.0.1');
    expect(formatIp(ip('2001:0db8:0:0:0:0:0:1'))).toBe('2001:db8::1');
  });

  it('knows the width of each address space', () => {
    expect(addressBits(4)).toBe(32);
    expect(addressBits(6)).toBe(128);
  });

  it('throws on a bad trusted literal, because that is a bug in the repository', () => {
    expect(() => ip('999.0.0.1')).toThrow(/invalid IP address "999.0.0.1"/);
    expect(ip('8.8.8.8').text).toBe('8.8.8.8');
  });
});

describe('parseCidr', () => {
  it('parses an address and a prefix length', () => {
    expect(parseCidr('10.0.0.0/8')).toEqual({
      ok: true,
      value: {
        address: { version: 4, octets: [10, 0, 0, 0], text: '10.0.0.0' },
        prefixLength: 8,
        text: '10.0.0.0/8',
      },
    });
  });

  it('accepts the widest and narrowest prefixes of each family', () => {
    expect(value(parseCidr('0.0.0.0/0')).prefixLength).toBe(0);
    expect(value(parseCidr('1.2.3.4/32')).prefixLength).toBe(32);
    expect(value(parseCidr('::/0')).prefixLength).toBe(0);
    expect(value(parseCidr('2001:db8::1/128')).prefixLength).toBe(128);
  });

  it('holds the prefix to the family it is attached to', () => {
    expect(error(parseCidr('10.0.0.0/33'))).toContain('out of range for IPv4');
    expect(value(parseCidr('2001:db8::/33')).prefixLength).toBe(33);
    expect(error(parseCidr('2001:db8::/129'))).toContain('out of range for IPv6');
  });

  it.each([
    ['10.0.0.0', 'no slash'],
    ['10.0.0.0/', 'empty prefix'],
    ['10.0.0.0/8/8', 'two slashes'],
    ['10.0.0.0/08', 'leading zero in the prefix'],
    ['10.0.0.0/-1', 'negative prefix'],
    ['10.0.0.0/eight', 'non-numeric prefix'],
    ['10.0.0.0/1000', 'four-digit prefix'],
    ['010.0.0.0/8', 'invalid address'],
    ['/8', 'missing address'],
  ])('rejects %s (%s)', (input) => {
    expect(parseCidr(input).ok).toBe(false);
  });

  it('rejects a non-string at runtime', () => {
    expect(error(parseCidr(undefined as unknown as string))).toBe('expected a string');
  });

  it('keeps host bits as written but can mask them away', () => {
    const block = value(parseCidr('192.168.1.10/24'));
    expect(formatCidr(block)).toBe('192.168.1.10/24');
    expect(hasHostBits(block)).toBe(true);
    expect(cidrNetwork(block).text).toBe('192.168.1.0');
    expect(hasHostBits(value(parseCidr('192.168.1.0/24')))).toBe(false);
  });

  it('masks prefixes that fall inside an octet', () => {
    expect(cidrNetwork(cidr('10.11.12.13/12')).text).toBe('10.0.0.0');
    expect(cidrNetwork(cidr('10.11.12.13/0')).text).toBe('0.0.0.0');
    expect(cidrNetwork(cidr('10.11.12.13/32')).text).toBe('10.11.12.13');
    expect(cidrNetwork(cidr('2001:db8:1234::1/32')).text).toBe('2001:db8::');
  });

  it('computes the IPv4 broadcast address, and refuses to invent an IPv6 one', () => {
    expect(cidrBroadcast(cidr('192.168.1.10/24'))?.text).toBe('192.168.1.255');
    expect(cidrBroadcast(cidr('10.0.0.0/8'))?.text).toBe('10.255.255.255');
    expect(cidrBroadcast(cidr('10.0.0.0/31'))?.text).toBe('10.0.0.1');
    expect(cidrBroadcast(cidr('10.0.0.7/32'))?.text).toBe('10.0.0.7');
    expect(cidrBroadcast(cidr('0.0.0.0/0'))?.text).toBe('255.255.255.255');
    expect(cidrBroadcast(cidr('2001:db8::/32'))).toBeUndefined();
  });

  it('tests membership on bit boundaries, not on text prefixes', () => {
    const block = cidr('192.168.0.0/16');
    expect(cidrContains(block, ip('192.168.255.255'))).toBe(true);
    expect(cidrContains(block, ip('192.169.0.0'))).toBe(false);
    expect(cidrContains(cidr('172.16.0.0/12'), ip('172.31.255.255'))).toBe(true);
    expect(cidrContains(cidr('172.16.0.0/12'), ip('172.32.0.0'))).toBe(false);
    expect(cidrContains(cidr('0.0.0.0/0'), ip('8.8.8.8'))).toBe(true);
    expect(cidrContains(cidr('fc00::/7'), ip('fdff::1'))).toBe(true);
    expect(cidrContains(cidr('fc00::/7'), ip('fe00::1'))).toBe(false);
  });

  it('never matches across address families', () => {
    expect(cidrContains(cidr('10.0.0.0/8'), ip('::ffff:10.0.0.1'))).toBe(false);
    expect(cidrContains(cidr('::/0'), ip('10.0.0.1'))).toBe(false);
  });

  it('validates and throws for trusted literals', () => {
    expect(isCidr('10.0.0.0/8')).toBe(true);
    expect(isCidr('10.0.0.0')).toBe(false);
    expect(() => cidr('10.0.0.0/33')).toThrow(/invalid CIDR block/);
  });
});

describe('classifyIp', () => {
  it.each<[string, IpScope]>([
    ['0.0.0.0', 'unspecified'],
    ['0.1.2.3', 'reserved'],
    ['10.0.0.1', 'private'],
    ['10.255.255.255', 'private'],
    ['100.64.0.1', 'shared'],
    ['127.0.0.1', 'loopback'],
    ['127.255.255.254', 'loopback'],
    ['169.254.1.1', 'link-local'],
    ['172.15.255.255', 'public'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['172.32.0.1', 'public'],
    ['192.0.0.1', 'reserved'],
    ['192.0.2.1', 'documentation'],
    ['192.88.99.1', 'reserved'],
    ['192.168.1.1', 'private'],
    ['198.18.0.1', 'benchmarking'],
    ['198.51.100.1', 'documentation'],
    ['203.0.113.1', 'documentation'],
    ['224.0.0.1', 'multicast'],
    ['239.255.255.255', 'multicast'],
    ['240.0.0.1', 'reserved'],
    ['255.255.255.255', 'broadcast'],
    ['1.1.1.1', 'public'],
    ['8.8.8.8', 'public'],
  ])('classifies IPv4 %s as %s', (address, scope) => {
    expect(classifyIp(ip(address))).toBe(scope);
  });

  it.each<[string, IpScope]>([
    ['::', 'unspecified'],
    ['::1', 'loopback'],
    ['::2', 'reserved'],
    ['64:ff9b::1', 'reserved'],
    ['100::1', 'reserved'],
    ['2001::1', 'reserved'],
    ['2001:db8::1', 'documentation'],
    ['2002::1', 'reserved'],
    ['fc00::1', 'private'],
    ['fd12:3456::1', 'private'],
    ['fe80::1', 'link-local'],
    ['febf::1', 'link-local'],
    ['fec0::1', 'reserved'],
    ['ff02::1', 'multicast'],
    ['2606:4700:4700::1111', 'public'],
  ])('classifies IPv6 %s as %s', (address, scope) => {
    expect(classifyIp(ip(address))).toBe(scope);
  });

  it('classifies an IPv4-mapped address by the IPv4 address inside it', () => {
    // The check a naive filter forgets: this is loopback however IPv6 it looks.
    expect(classifyIp(ip('::ffff:127.0.0.1'))).toBe('loopback');
    expect(classifyIp(ip('::ffff:10.0.0.1'))).toBe('private');
    expect(classifyIp(ip('::ffff:169.254.0.1'))).toBe('link-local');
    expect(classifyIp(ip('::ffff:8.8.8.8'))).toBe('public');
  });

  it('reports the block that matched and why it exists', () => {
    expect(describeIp(ip('10.1.2.3'))).toEqual({
      scope: 'private',
      block: '10.0.0.0/8',
      note: 'RFC 1918 private use; never routed on the Internet',
    });
    expect(describeIp(ip('8.8.8.8'))).toEqual({
      scope: 'public',
      note: 'globally routable address space',
    });
    const mapped = describeIp(ip('::ffff:127.0.0.1'));
    expect(mapped.scope).toBe('loopback');
    expect(mapped.block).toBe('127.0.0.0/8');
    expect(mapped.note).toMatch(/^IPv4-mapped: /);
  });

  it('exposes the individual predicates the phase 12 guard is built from', () => {
    expect(isPrivateIp(ip('192.168.0.1'))).toBe(true);
    expect(isPrivateIp(ip('8.8.8.8'))).toBe(false);
    expect(isLoopbackIp(ip('::1'))).toBe(true);
    expect(isLinkLocalIp(ip('fe80::1'))).toBe(true);
    expect(isMulticastIp(ip('224.0.0.9'))).toBe(true);
    expect(isPublicIp(ip('1.1.1.1'))).toBe(true);
    expect(isPublicIp(ip('127.0.0.1'))).toBe(false);
  });

  it('treats every special-purpose address as not public', () => {
    const specials = [
      '0.0.0.0',
      '10.0.0.1',
      '100.64.0.1',
      '127.0.0.1',
      '169.254.1.1',
      '172.16.0.1',
      '192.0.2.1',
      '192.168.1.1',
      '198.18.0.1',
      '224.0.0.1',
      '240.0.0.1',
      '255.255.255.255',
      '::',
      '::1',
      '::ffff:127.0.0.1',
      '2001:db8::1',
      'fc00::1',
      'fe80::1',
      'ff02::1',
    ];
    for (const address of specials) {
      expect(isPublicIp(ip(address))).toBe(false);
    }
  });
});

describe('parseMac', () => {
  it('parses all three conventional notations to the same address', () => {
    const bytes = [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff];
    expect(value(parseMac('aa:bb:cc:dd:ee:ff')).bytes).toEqual(bytes);
    expect(value(parseMac('AA-BB-CC-DD-EE-FF')).bytes).toEqual(bytes);
    expect(value(parseMac('aabb.ccdd.eeff')).bytes).toEqual(bytes);
  });

  it('canonicalises to lower-case colon form whatever the input', () => {
    expect(value(parseMac('AA-BB-CC-DD-EE-FF')).text).toBe('aa:bb:cc:dd:ee:ff');
  });

  it.each([
    ['aa:bb:cc:dd:ee', 'five octets'],
    ['aa:bb:cc:dd:ee:ff:00', 'seven octets'],
    ['aa:bb:cc:dd:ee:gg', 'not hexadecimal'],
    ['aabbccddeeff', 'no separators'],
    ['aa:bb-cc:dd:ee:ff', 'mixed separators'],
    ['aa:b:cc:dd:ee:ff', 'a single-digit octet'],
    ['aabb.ccdd.ee', 'short Cisco form'],
    ['', 'empty string'],
    ['aa:bb:cc:dd:ee:ff ', 'trailing whitespace'],
    ['::1', 'an IPv6 address'],
  ])('rejects %s (%s)', (input) => {
    expect(parseMac(input).ok).toBe(false);
  });

  it('rejects a non-string at runtime', () => {
    expect(error(parseMac(null as unknown as string))).toBe('expected a string');
  });

  it('formats into each notation', () => {
    const address = mac('aa:bb:cc:dd:ee:ff');
    expect(formatMac(address)).toBe('aa:bb:cc:dd:ee:ff');
    expect(formatMac(address, 'colon')).toBe('aa:bb:cc:dd:ee:ff');
    expect(formatMac(address, 'hyphen')).toBe('aa-bb-cc-dd-ee-ff');
    expect(formatMac(address, 'dot')).toBe('aabb.ccdd.eeff');
  });

  it('validates and throws for trusted literals', () => {
    expect(isMac('aa:bb:cc:dd:ee:ff')).toBe(true);
    expect(isMac('nope')).toBe(false);
    expect(() => mac('nope')).toThrow(/invalid MAC address/);
  });

  it('reads the flag bits out of the first octet', () => {
    // 01:00:5e:... is the IPv4 multicast prefix: I/G set, U/L clear.
    const multicast = mac('01:00:5e:00:00:01');
    expect(isMulticastMac(multicast)).toBe(true);
    expect(isLocallyAdministeredMac(multicast)).toBe(false);

    // 02:... is what a hypervisor or a randomising Wi-Fi client hands out.
    const local = mac('02:42:ac:11:00:02');
    expect(isLocallyAdministeredMac(local)).toBe(true);
    expect(isMulticastMac(local)).toBe(false);

    const burnedIn = mac('3c:22:fb:00:11:22');
    expect(isMulticastMac(burnedIn)).toBe(false);
    expect(isLocallyAdministeredMac(burnedIn)).toBe(false);
  });

  it('treats broadcast as the all-ones address, which is also multicast', () => {
    expect(BROADCAST_MAC.text).toBe('ff:ff:ff:ff:ff:ff');
    expect(isBroadcastMac(BROADCAST_MAC)).toBe(true);
    expect(isMulticastMac(BROADCAST_MAC)).toBe(true);
    expect(isBroadcastMac(mac('ff:ff:ff:ff:ff:fe'))).toBe(false);
  });

  it('reads the vendor OUI off the front', () => {
    expect(macOui(mac('3c:22:fb:00:11:22'))).toBe('3c:22:fb');
  });
});
