import { describe, expect, it, vi } from 'vitest';

import { ip } from '../address';
import {
  allow,
  ALLOWED_METHODS,
  ALLOWED_PORTS,
  ALLOWED_SCHEMES,
  BLOCKED_HOSTNAME_SUFFIXES,
  checkAddress,
  checkContentLength,
  checkHostname,
  checkResolvedAddresses,
  DEFAULT_GUARD_POLICY,
  deny,
  describeTarget,
  FORWARDABLE_HEADERS,
  guardRedirect,
  guardTarget,
  guardedRequestInit,
  GuardTimeoutError,
  inspectUrl,
  isAllowed,
  MAX_RESOLVED_ADDRESSES,
  MAX_RESPONSE_BYTES,
  MAX_TIMEOUT_MS,
  METADATA_ENDPOINTS,
  metadataEndpointFor,
  parseLookupTarget,
  readCapped,
  readCappedText,
  resolvePolicy,
  sanitizeOutboundHeaders,
  timeoutSignal,
  unwrapGuard,
  withTimeout,
  type ByteSource,
  type GuardDenial,
  type GuardResult,
  type GuardedTarget,
  type HostResolver,
} from '../guard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Assert the guard approved, and hand back the value. */
function approved<T>(result: GuardResult<T>): T {
  if (!result.allowed) {
    throw new Error(`expected the guard to allow this, got: ${result.detail}`);
  }
  return result.value;
}

/** Assert the guard refused, and hand back the denial so the reason stays tested. */
function refused<T>(result: GuardResult<T>): GuardDenial {
  if (result.allowed) {
    throw new Error(
      `expected the guard to refuse this, got: ${JSON.stringify(result.value)}`,
    );
  }
  return result;
}

/** A public address, used wherever a test needs a target that is allowed to pass. */
const PUBLIC_V4 = '93.184.216.34';
const PUBLIC_V6 = '2606:2800:220:1:248:1893:25c8:1946';

/** A resolver that always answers with the same addresses, and counts its calls. */
function resolverFor(...addresses: string[]): HostResolver & { calls: string[] } {
  const calls: string[] = [];
  const resolve = vi.fn(async (hostname: string) => {
    calls.push(hostname);
    return addresses;
  }) as unknown as HostResolver & { calls: string[] };
  (resolve as { calls: string[] }).calls = calls;
  return resolve;
}

/** The everyday case: a name that resolves to one ordinary public address. */
const publicResolver = () => resolverFor(PUBLIC_V4);

/** Guard a target with a resolver, the way a route handler would. */
async function guard(url: string, resolve: HostResolver = publicResolver()) {
  return guardTarget(url, { resolve });
}

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

describe('guard results', () => {
  it('wraps an approved value', () => {
    expect(allow(7)).toEqual({ allowed: true, value: 7 });
  });

  it('carries the reason, the detail, and the offending address on a refusal', () => {
    expect(
      deny('blocked-address', 'nope', { address: '10.0.0.1', scope: 'private' }),
    ).toEqual({
      allowed: false,
      reason: 'blocked-address',
      detail: 'nope',
      address: '10.0.0.1',
      scope: 'private',
    });
  });

  it('defaults the extras to nothing', () => {
    expect(deny('timeout', 'slow')).toEqual({
      allowed: false,
      reason: 'timeout',
      detail: 'slow',
    });
  });

  it('narrows with isAllowed', () => {
    expect(isAllowed(allow('x'))).toBe(true);
    expect(isAllowed(deny('timeout', 'slow'))).toBe(false);
  });

  it('unwraps an approval and throws on a refusal', () => {
    expect(unwrapGuard(allow('x'))).toBe('x');
    expect(() => unwrapGuard(deny('blocked-port', 'port 22 is not allowed'))).toThrow(
      'blocked target: port 22 is not allowed',
    );
    expect(() => unwrapGuard(deny('blocked-port', 'nope'), 'redirect')).toThrow(
      'blocked redirect: nope',
    );
  });
});

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

describe('resolvePolicy', () => {
  it('returns the default policy when given nothing', () => {
    expect(resolvePolicy()).toEqual(DEFAULT_GUARD_POLICY);
  });

  it('allows only http and https, and only ports 80 and 443, by default', () => {
    expect(DEFAULT_GUARD_POLICY.schemes).toEqual(['http:', 'https:']);
    expect(DEFAULT_GUARD_POLICY.ports).toEqual([80, 443]);
    expect(DEFAULT_GUARD_POLICY.methods).toEqual(['GET', 'HEAD']);
    expect(DEFAULT_GUARD_POLICY.maxRedirects).toBe(0);
  });

  it('lets a caller narrow the scheme, port and method lists', () => {
    const policy = resolvePolicy({
      schemes: ['https:'],
      ports: [443],
      methods: ['HEAD'],
    });
    expect(policy.schemes).toEqual(['https:']);
    expect(policy.ports).toEqual([443]);
    expect(policy.methods).toEqual(['HEAD']);
  });

  it('refuses to let a caller widen them -- an unknown port is dropped, not added', () => {
    const policy = resolvePolicy({
      schemes: ['gopher:', 'https:'],
      ports: [22, 8080, 80],
      methods: ['POST', 'GET'],
    });
    expect(policy.schemes).toEqual(['https:']);
    expect(policy.ports).toEqual([80]);
    expect(policy.methods).toEqual(['GET']);
  });

  it('leaves a policy that widened everything with nothing at all', () => {
    const policy = resolvePolicy({ ports: [8080], schemes: ['ftp:'] });
    expect(policy.ports).toEqual([]);
    expect(policy.schemes).toEqual([]);
  });

  it('clamps the timeout to the 5 s ceiling from section 3', () => {
    expect(resolvePolicy({ timeoutMs: 30_000 }).timeoutMs).toBe(MAX_TIMEOUT_MS);
    expect(resolvePolicy({ timeoutMs: 250 }).timeoutMs).toBe(250);
    expect(resolvePolicy({ timeoutMs: 0 }).timeoutMs).toBe(1);
    expect(resolvePolicy({ timeoutMs: -1 }).timeoutMs).toBe(1);
    expect(resolvePolicy({ timeoutMs: Number.NaN }).timeoutMs).toBe(1);
    expect(resolvePolicy({ timeoutMs: Number.POSITIVE_INFINITY }).timeoutMs).toBe(1);
  });

  it('clamps the response cap', () => {
    expect(resolvePolicy({ maxResponseBytes: 10 ** 9 }).maxResponseBytes).toBe(
      MAX_RESPONSE_BYTES,
    );
    expect(resolvePolicy({ maxResponseBytes: 512 }).maxResponseBytes).toBe(512);
    expect(resolvePolicy({ maxResponseBytes: -5 }).maxResponseBytes).toBe(1);
  });

  it('clamps the redirect budget and the URL length', () => {
    expect(resolvePolicy({ maxRedirects: 99 }).maxRedirects).toBe(5);
    expect(resolvePolicy({ maxRedirects: -1 }).maxRedirects).toBe(0);
    expect(resolvePolicy({ maxRedirects: 2 }).maxRedirects).toBe(2);
    expect(resolvePolicy({ maxUrlLength: 10 ** 6 }).maxUrlLength).toBe(2048);
    expect(resolvePolicy({ maxUrlLength: 64 }).maxUrlLength).toBe(64);
  });

  it('exports the ceilings the policy is intersected against', () => {
    expect(ALLOWED_SCHEMES).toEqual(['http:', 'https:']);
    expect(ALLOWED_PORTS).toEqual([80, 443]);
    expect(ALLOWED_METHODS).toEqual(['GET', 'HEAD']);
    expect(MAX_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
  });
});

// ---------------------------------------------------------------------------
// Step 2: the IP block list
// ---------------------------------------------------------------------------

describe('checkAddress', () => {
  it('allows a globally routable IPv4 address', () => {
    const checked = approved(checkAddress(PUBLIC_V4));
    expect(checked.text).toBe(PUBLIC_V4);
    expect(checked.classification.scope).toBe('public');
  });

  it('allows a globally routable IPv6 address', () => {
    expect(approved(checkAddress(PUBLIC_V6)).classification.scope).toBe('public');
  });

  it('accepts an already-parsed address as well as a string', () => {
    expect(approved(checkAddress(ip(PUBLIC_V4))).text).toBe(PUBLIC_V4);
    expect(refused(checkAddress(ip('10.0.0.1'))).scope).toBe('private');
  });

  const blocked: ReadonlyArray<readonly [string, string]> = [
    ['10.0.0.1', 'private'],
    ['172.16.31.4', 'private'],
    ['172.31.255.254', 'private'],
    ['192.168.1.1', 'private'],
    ['fd00::1', 'private'],
    ['fc00::1', 'private'],
    ['127.0.0.1', 'loopback'],
    ['127.255.255.254', 'loopback'],
    ['::1', 'loopback'],
    ['169.254.1.1', 'link-local'],
    ['fe80::1', 'link-local'],
    ['224.0.0.1', 'multicast'],
    ['239.255.255.250', 'multicast'],
    ['ff02::1', 'multicast'],
    ['255.255.255.255', 'broadcast'],
    ['0.0.0.0', 'unspecified'],
    ['::', 'unspecified'],
    ['100.64.0.1', 'shared'],
    ['192.0.2.1', 'documentation'],
    ['198.51.100.1', 'documentation'],
    ['203.0.113.1', 'documentation'],
    ['2001:db8::1', 'documentation'],
    ['198.18.0.1', 'benchmarking'],
    ['240.0.0.1', 'reserved'],
    ['192.0.0.1', 'reserved'],
    ['192.88.99.1', 'reserved'],
    ['0.1.2.3', 'reserved'],
    ['2001::1', 'reserved'],
    ['2002::1', 'reserved'],
    ['64:ff9b::1', 'reserved'],
    ['100::1', 'reserved'],
    ['fec0::1', 'reserved'],
  ];

  it.each(blocked)('blocks %s (%s)', (address, scope) => {
    const denial = refused(checkAddress(address));
    expect(denial.reason).toBe('blocked-address');
    expect(denial.scope).toBe(scope);
    expect(denial.address).toBe(ip(address).text);
    // The refusal explains itself: the block, and why that block exists.
    expect(denial.detail).toContain(scope);
  });

  it('blocks IPv4-mapped IPv6 -- the disguise a naive filter misses', () => {
    expect(refused(checkAddress('::ffff:127.0.0.1')).scope).toBe('loopback');
    expect(refused(checkAddress('::ffff:10.0.0.1')).scope).toBe('private');
    expect(refused(checkAddress('::ffff:192.168.0.1')).scope).toBe('private');
    expect(refused(checkAddress('::ffff:169.254.169.254')).metadataEndpoint).toContain(
      'instance metadata',
    );
  });

  it('blocks 169.254.169.254 by name, and says which endpoint it is', () => {
    const denial = refused(checkAddress('169.254.169.254'));
    expect(denial.reason).toBe('blocked-address');
    expect(denial.address).toBe('169.254.169.254');
    expect(denial.scope).toBe('link-local');
    expect(denial.metadataEndpoint).toBe('AWS/GCP/Azure/DigitalOcean instance metadata');
    expect(denial.detail).toContain('169.254.169.254');
    expect(denial.detail).toContain('instance metadata');
  });

  it.each(Object.entries(METADATA_ENDPOINTS))(
    'blocks the cloud metadata endpoint %s',
    (address, name) => {
      const denial = refused(checkAddress(address));
      expect(denial.reason).toBe('blocked-address');
      expect(denial.metadataEndpoint).toBe(name);
    },
  );

  it('names a metadata endpoint only when the address is one', () => {
    expect(metadataEndpointFor(ip('169.254.169.254'))).toBe(
      METADATA_ENDPOINTS['169.254.169.254'],
    );
    expect(metadataEndpointFor(ip(PUBLIC_V4))).toBeUndefined();
  });

  it('refuses anything that is not an address at all', () => {
    const denial = refused(checkAddress('not-an-address'));
    expect(denial.reason).toBe('malformed-input');
    expect(denial.detail).toContain('not a valid IP address');
  });

  it('refuses the ambiguous IPv4 spellings that address.ts already rejects', () => {
    for (const text of ['2130706433', '127.1', '0x7f.0.0.1', '010.0.0.1', '127.0.0.01']) {
      expect(refused(checkAddress(text)).reason).toBe('malformed-input');
    }
  });
});

// ---------------------------------------------------------------------------
// Hostnames
// ---------------------------------------------------------------------------

describe('checkHostname', () => {
  it('accepts an ordinary fully qualified name', () => {
    expect(approved(checkHostname('example.com'))).toBe('example.com');
    expect(approved(checkHostname('a.b.c.example.co.uk'))).toBe('a.b.c.example.co.uk');
    expect(approved(checkHostname('my-host1.example.com'))).toBe('my-host1.example.com');
  });

  it('lower-cases the name and drops one trailing root dot', () => {
    expect(approved(checkHostname('EXAMPLE.Com.'))).toBe('example.com');
  });

  it('accepts an IDN A-label', () => {
    expect(approved(checkHostname('xn--e1afmkfd.xn--p1ai'))).toBe(
      'xn--e1afmkfd.xn--p1ai',
    );
  });

  it('refuses a single label, which could only be an intranet name', () => {
    const denial = refused(checkHostname('wiki'));
    expect(denial.reason).toBe('malformed-host');
    expect(denial.detail).toContain('fully qualified');
  });

  it('refuses an empty name', () => {
    expect(refused(checkHostname('.')).detail).toContain('empty');
  });

  it.each([
    ['exam_ple.com', 'underscore'],
    ['-lead.example.com', 'leading hyphen'],
    ['trail-.example.com', 'trailing hyphen'],
    ['example..com', 'empty label'],
    [`${'a'.repeat(64)}.example.com`, 'over-long label'],
    ['exa mple.com', 'space'],
    ['ex@mple.com', 'at sign'],
  ])('refuses %s (%s)', (name) => {
    expect(refused(checkHostname(name)).allowed).toBe(false);
  });

  it('refuses a numeric top-level domain, which would be an address in disguise', () => {
    const denial = refused(checkHostname('example.123'));
    expect(denial.reason).toBe('malformed-host');
    expect(denial.detail).toContain('top-level domain');
  });

  it('refuses localhost by name', () => {
    const denial = refused(checkHostname('localhost'));
    expect(denial.reason).toBe('blocked-hostname');
    expect(denial.detail).toContain('reserved local name');
  });

  it('refuses the cloud metadata names', () => {
    expect(refused(checkHostname('metadata.google.internal')).reason).toBe(
      'blocked-hostname',
    );
    expect(refused(checkHostname('instance-data.ec2.internal')).reason).toBe(
      'blocked-hostname',
    );
  });

  it.each(BLOCKED_HOSTNAME_SUFFIXES)('refuses a name ending in %s', (suffix) => {
    const denial = refused(checkHostname(`printer${suffix}`));
    expect(denial.reason).toBe('blocked-hostname');
    expect(denial.detail).toContain(suffix);
  });

  it('refuses a CIDR block, a list, and a range -- one host, one request', () => {
    expect(refused(checkHostname('10.0.0.0/8')).detail).toContain('CIDR');
    expect(refused(checkHostname('a.example.com,b.example.com')).detail).toContain(
      'a list',
    );
    expect(refused(checkHostname('10.0.0.1-10.0.0.9')).detail).toContain('range');
  });

  it('refuses whitespace, control characters, and a non-string', () => {
    expect(refused(checkHostname(' example.com')).reason).toBe('malformed-input');
    expect(refused(checkHostname('example.com\n')).reason).toBe('malformed-input');
    expect(refused(checkHostname('exam ple.com')).reason).toBe('malformed-input');
    expect(refused(checkHostname('')).detail).toContain('empty');
    expect(refused(checkHostname('a'.repeat(254))).detail).toContain('longer than');
  });
});

describe('parseLookupTarget', () => {
  it('accepts a hostname', () => {
    expect(approved(parseLookupTarget('example.com'))).toEqual({
      kind: 'hostname',
      name: 'example.com',
    });
  });

  it('accepts a public IP literal, classified', () => {
    const target = approved(parseLookupTarget(PUBLIC_V4));
    expect(target.kind).toBe('ip');
    expect(target.kind === 'ip' && target.text).toBe(PUBLIC_V4);
  });

  it('accepts a public IPv6 literal', () => {
    expect(approved(parseLookupTarget(PUBLIC_V6)).kind).toBe('ip');
  });

  it('blocks a private or metadata literal', () => {
    expect(refused(parseLookupTarget('10.0.0.1')).reason).toBe('blocked-address');
    expect(refused(parseLookupTarget('169.254.169.254')).metadataEndpoint).toBeDefined();
    expect(refused(parseLookupTarget('::1')).scope).toBe('loopback');
  });

  it('refuses a decimal or octal address rather than guessing which one it means', () => {
    // Not an address by the strict parser, and not a hostname either.
    expect(refused(parseLookupTarget('2130706433')).reason).toBe('malformed-host');
    expect(refused(parseLookupTarget('010.0.0.1')).reason).toBe('malformed-host');
  });

  it('refuses a non-string, a CIDR, and a list', () => {
    expect(refused(parseLookupTarget(42)).reason).toBe('malformed-input');
    expect(refused(parseLookupTarget(['a.com', 'b.com'])).reason).toBe('malformed-input');
    expect(refused(parseLookupTarget(null)).reason).toBe('malformed-input');
    expect(refused(parseLookupTarget('192.168.0.0/16')).detail).toContain('CIDR');
  });
});

// ---------------------------------------------------------------------------
// Steps 1, 2, 4: the URL before resolution
// ---------------------------------------------------------------------------

describe('inspectUrl', () => {
  it('accepts an ordinary https target and fills in the implicit port', () => {
    const target = approved(inspectUrl('https://example.com/status?x=1'));
    expect(target.url).toBe('https://example.com/status?x=1');
    expect(target.scheme).toBe('https:');
    expect(target.hostname).toBe('example.com');
    expect(target.port).toBe(443);
    expect(target.host).toEqual({ kind: 'hostname', name: 'example.com' });
  });

  it('fills in port 80 for http', () => {
    expect(approved(inspectUrl('http://example.com/')).port).toBe(80);
  });

  it('accepts an explicit port when it is 80 or 443', () => {
    expect(approved(inspectUrl('http://example.com:80/')).port).toBe(80);
    expect(approved(inspectUrl('https://example.com:443/')).port).toBe(443);
    expect(approved(inspectUrl('http://example.com:443/')).port).toBe(443);
  });

  it.each(['8080', '22', '0', '3306', '25', '65535'])('blocks port %s', (port) => {
    const denial = refused(inspectUrl(`http://example.com:${port}/`));
    expect(denial.reason).toBe('blocked-port');
    expect(denial.detail).toContain(port);
  });

  it.each([
    'ftp://example.com/',
    'file:///etc/passwd',
    'gopher://example.com/',
    'data:text/plain,hello',
    'javascript:alert(1)',
    'ws://example.com/',
  ])('blocks the scheme in %s', (url) => {
    expect(refused(inspectUrl(url)).reason).toBe('blocked-scheme');
  });

  it('blocks a scheme the policy narrowed away', () => {
    expect(
      refused(inspectUrl('http://example.com/', { schemes: ['https:'] })).reason,
    ).toBe('blocked-scheme');
    expect(
      approved(inspectUrl('https://example.com/', { schemes: ['https:'] })).port,
    ).toBe(443);
  });

  it('refuses credentials in the URL, because none are ever forwarded', () => {
    const denial = refused(inspectUrl('https://user:secret@example.com/'));
    expect(denial.reason).toBe('credentials-in-url');
    expect(refused(inspectUrl('https://user@example.com/')).reason).toBe(
      'credentials-in-url',
    );
  });

  it('refuses input that is not a string, or is empty, or is not a URL', () => {
    expect(refused(inspectUrl(undefined)).reason).toBe('malformed-input');
    expect(refused(inspectUrl(['https://example.com/'])).reason).toBe('malformed-input');
    expect(refused(inspectUrl('')).detail).toContain('empty');
    expect(refused(inspectUrl('notaurl')).detail).toContain('http://');
  });

  it('refuses whitespace and control characters before the URL parser can strip them', () => {
    // `new URL` silently removes tabs and newlines and trims spaces, which is exactly
    // how a host gets smuggled past a filter that looked at the string first.
    expect(refused(inspectUrl(' https://example.com/')).reason).toBe('malformed-input');
    expect(refused(inspectUrl('https://exa\tmple.com/')).reason).toBe('malformed-input');
    expect(refused(inspectUrl('https://example.com/\n')).reason).toBe('malformed-input');
    expect(refused(inspectUrl('http://127.0.0.1 .example.com/')).reason).toBe(
      'malformed-input',
    );
  });

  it.each([
    0x0b, 0x7f, 0x9f, 0xa0, 0x1680, 0x2000, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f,
    0x3000, 0xfeff,
  ])('refuses a target carrying the invisible character U+%s', (code) => {
    // Built from its code point rather than typed, because half of these are
    // invisible in a diff -- which is exactly why they are worth refusing.
    const sneaky = `https://exam${String.fromCodePoint(code)}ple.com/`;
    expect(refused(inspectUrl(sneaky)).reason).toBe('malformed-input');
  });

  it('refuses a URL longer than the policy allows', () => {
    const long = `https://example.com/${'a'.repeat(3000)}`;
    expect(refused(inspectUrl(long)).detail).toContain('longer than');
    expect(
      refused(inspectUrl('https://example.com/aaaa', { maxUrlLength: 10 })).detail,
    ).toContain('longer than 10');
  });

  it('accepts a public IP literal target and reports it as one', () => {
    const target = approved(inspectUrl(`http://${PUBLIC_V4}/`));
    expect(target.host.kind).toBe('ip');
    expect(target.hostname).toBe(PUBLIC_V4);
  });

  it('reads the typed host out of a bare authority, with or without a port or path', () => {
    // The check that the address was written canonically works on the raw input, so it
    // has to find the host whether or not a path or an explicit port follows it.
    expect(approved(inspectUrl(`http://${PUBLIC_V4}`)).hostname).toBe(PUBLIC_V4);
    expect(approved(inspectUrl(`http://${PUBLIC_V4}:80`)).port).toBe(80);
    expect(approved(inspectUrl(`http://${PUBLIC_V4}?q=1`)).hostname).toBe(PUBLIC_V4);
    expect(approved(inspectUrl(`http://${PUBLIC_V4}#frag`)).hostname).toBe(PUBLIC_V4);
    expect(approved(inspectUrl(`https://[${PUBLIC_V6}]:443/x`)).hostname).toBe(PUBLIC_V6);
  });

  it('accepts a bracketed public IPv6 literal and unbrackets the hostname', () => {
    const target = approved(inspectUrl(`https://[${PUBLIC_V6}]/`));
    expect(target.hostname).toBe(PUBLIC_V6);
    expect(target.host.kind).toBe('ip');
  });

  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
  ])('blocks the IP literal %s', (address) => {
    const denial = refused(inspectUrl(`http://${address}/`));
    expect(denial.reason).toBe('blocked-address');
    expect(denial.address).toBe(address);
  });

  it('blocks a bracketed loopback and a bracketed IPv4-mapped private address', () => {
    expect(refused(inspectUrl('http://[::1]/')).scope).toBe('loopback');
    expect(refused(inspectUrl('http://[::ffff:10.0.0.1]/')).scope).toBe('private');
    expect(
      refused(inspectUrl('http://[::ffff:169.254.169.254]/')).metadataEndpoint,
    ).toBeDefined();
  });

  it.each([
    ['http://2130706433/', 'decimal'],
    ['http://0x7f.0.0.1/', 'hex'],
    ['http://127.1/', 'shorthand'],
    ['http://010.0.0.1/', 'octal'],
    ['http:127.0.0.1/', 'scheme-relative'],
  ])('refuses %s as an ambiguous host (%s)', (url) => {
    const denial = refused(inspectUrl(url));
    expect(denial.reason).toBe('ambiguous-host');
    expect(denial.detail).toContain('canonical');
  });

  it('refuses the octal form even though the URL parser makes it a public address', () => {
    // `new URL('http://010.0.0.1/')` reads the leading zero as octal and produces
    // 8.0.0.1 -- a public address. Agreeing with one parser's guess is the bug.
    expect(new URL('http://010.0.0.1/').hostname).toBe('8.0.0.1');
    expect(refused(inspectUrl('http://010.0.0.1/')).reason).toBe('ambiguous-host');
  });

  it('accepts an IPv4-mapped address written canonically, then judges what is inside', () => {
    // The URL parser rewrites `::ffff:127.0.0.1` to `::ffff:7f00:1`; both spellings are
    // the same 128 bits, so this is not ambiguity -- and it is still loopback.
    expect(refused(inspectUrl('http://[::ffff:127.0.0.1]/')).scope).toBe('loopback');
  });

  it('applies the hostname rules to the host component of a URL', () => {
    expect(refused(inspectUrl('http://localhost/')).reason).toBe('blocked-hostname');
    expect(refused(inspectUrl('http://printer.local/')).reason).toBe('blocked-hostname');
    expect(refused(inspectUrl('http://metadata.google.internal/')).reason).toBe(
      'blocked-hostname',
    );
    expect(refused(inspectUrl('http://wiki/')).reason).toBe('malformed-host');
    expect(refused(inspectUrl('http://exam_ple.com/')).reason).toBe('malformed-host');
  });

  it('normalises the host case and keeps the normalised URL as the thing to request', () => {
    const target = approved(inspectUrl('https://EXAMPLE.com/Path'));
    expect(target.hostname).toBe('example.com');
    expect(target.url).toBe('https://example.com/Path');
  });

  it('carries the resolved policy along, so later steps cannot disagree with it', () => {
    const target = approved(inspectUrl('https://example.com/', { timeoutMs: 1_000 }));
    expect(target.policy.timeoutMs).toBe(1_000);
    expect(target.policy.ports).toEqual([80, 443]);
  });
});

// ---------------------------------------------------------------------------
// Step 3: resolution, and the rebinding defence
// ---------------------------------------------------------------------------

describe('checkResolvedAddresses', () => {
  it('accepts a set of public addresses', () => {
    const checked = approved(checkResolvedAddresses([PUBLIC_V4, PUBLIC_V6]));
    expect(checked.map((entry) => entry.text)).toEqual([PUBLIC_V4, PUBLIC_V6]);
  });

  it('refuses an empty answer', () => {
    const denial = refused(checkResolvedAddresses([]));
    expect(denial.reason).toBe('no-addresses');
    expect(denial.detail).toContain('the hostname');
    expect(refused(checkResolvedAddresses([], 'shop.example.com')).detail).toContain(
      'shop.example.com',
    );
  });

  it('refuses the whole set when any single address is blocked', () => {
    const denial = refused(
      checkResolvedAddresses([PUBLIC_V4, '169.254.169.254'], 'evil.example.com'),
    );
    expect(denial.reason).toBe('blocked-resolved-address');
    expect(denial.address).toBe('169.254.169.254');
    expect(denial.metadataEndpoint).toBeDefined();
    expect(denial.detail).toContain('evil.example.com');
  });

  it('reports an unparseable answer as a resolution failure, not a blocked address', () => {
    const denial = refused(checkResolvedAddresses(['definitely-not-an-address']));
    expect(denial.reason).toBe('resolution-failed');
  });

  it('refuses an answer with more addresses than the cap', () => {
    const many = Array.from({ length: MAX_RESOLVED_ADDRESSES + 1 }, () => PUBLIC_V4);
    const denial = refused(checkResolvedAddresses(many, 'many.example.com'));
    expect(denial.reason).toBe('blocked-resolved-address');
    expect(denial.detail).toContain(String(MAX_RESOLVED_ADDRESSES));
  });
});

describe('guardTarget', () => {
  it('allows a name that resolves to public addresses, and reports where it will go', async () => {
    const resolve = resolverFor(PUBLIC_V4, PUBLIC_V6);
    const target = approved(await guard('https://example.com/health', resolve));
    expect(target.resolved).toBe(true);
    expect(target.addresses.map((entry) => entry.text)).toEqual([PUBLIC_V4, PUBLIC_V6]);
    expect((resolve as unknown as { calls: string[] }).calls).toEqual(['example.com']);
  });

  it('blocks a hostname that resolves to a private address -- the DNS rebinding case', async () => {
    // Nothing about `internal-tools.example.com` looks wrong. The name is fine, the
    // scheme is fine, the port is fine. Only the answer is hostile, and only a
    // post-resolution re-check can see it.
    const denial = refused(
      await guard('https://internal-tools.example.com/', resolverFor('10.0.0.5')),
    );
    expect(denial.reason).toBe('blocked-resolved-address');
    expect(denial.address).toBe('10.0.0.5');
    expect(denial.scope).toBe('private');
    expect(denial.detail).toContain('internal-tools.example.com');
    expect(denial.detail).toContain('10.0.0.5');
  });

  it('blocks a rebinding answer to the metadata endpoint, and names it', async () => {
    const denial = refused(
      await guard('http://harmless.example.com/', resolverFor('169.254.169.254')),
    );
    expect(denial.reason).toBe('blocked-resolved-address');
    expect(denial.metadataEndpoint).toBe('AWS/GCP/Azure/DigitalOcean instance metadata');
  });

  it.each([
    '127.0.0.1',
    '::1',
    '192.168.0.7',
    '172.20.1.1',
    'fd00::1',
    '::ffff:127.0.0.1',
    '100.64.0.9',
    '0.0.0.0',
  ])('blocks a hostname that resolves to %s', async (address) => {
    expect(
      refused(await guard('https://example.com/', resolverFor(address))).reason,
    ).toBe('blocked-resolved-address');
  });

  it('blocks a split answer where only one address is hostile', async () => {
    const denial = refused(
      await guard('https://example.com/', resolverFor(PUBLIC_V4, '127.0.0.1')),
    );
    expect(denial.reason).toBe('blocked-resolved-address');
    expect(denial.address).toBe('127.0.0.1');
  });

  it('refuses a name that resolves to nothing', async () => {
    expect(refused(await guard('https://example.com/', resolverFor())).reason).toBe(
      'no-addresses',
    );
  });

  it('reports a resolver that throws as a resolution failure', async () => {
    const denial = refused(
      await guard('https://example.com/', async () => {
        throw new Error('ENOTFOUND');
      }),
    );
    expect(denial.reason).toBe('resolution-failed');
    expect(denial.detail).toContain('ENOTFOUND');
  });

  it('survives a resolver that throws something that is not an Error', async () => {
    const denial = refused(
      await guard('https://example.com/', async () => {
        throw 'nope';
      }),
    );
    expect(denial.reason).toBe('resolution-failed');
    expect(denial.detail).toContain('nope');
  });

  it('refuses a resolver that does not return a list', async () => {
    const denial = refused(
      await guard(
        'https://example.com/',
        (async () => PUBLIC_V4) as unknown as HostResolver,
      ),
    );
    expect(denial.reason).toBe('resolution-failed');
    expect(denial.detail).toContain('list of addresses');
  });

  it('gives up on a resolver that never answers', async () => {
    const denial = refused(
      await guardTarget('https://example.com/', {
        resolve: () => new Promise<string[]>(() => {}),
        policy: { timeoutMs: 20 },
      }),
    );
    expect(denial.reason).toBe('timeout');
    expect(denial.detail).toContain('20ms');
  });

  it('does not resolve an IP literal, because there is nothing to resolve', async () => {
    const resolve = publicResolver();
    const target = approved(await guard(`http://${PUBLIC_V4}/`, resolve));
    expect(target.resolved).toBe(false);
    expect(target.addresses.map((entry) => entry.text)).toEqual([PUBLIC_V4]);
    expect((resolve as unknown as { calls: string[] }).calls).toEqual([]);
  });

  it('never reaches the resolver when the URL itself is refused', async () => {
    const resolve = publicResolver();
    expect(refused(await guard('ftp://example.com/', resolve)).reason).toBe(
      'blocked-scheme',
    );
    expect(refused(await guard('http://10.0.0.1/', resolve)).reason).toBe(
      'blocked-address',
    );
    expect((resolve as unknown as { calls: string[] }).calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// withTimeout
// ---------------------------------------------------------------------------

describe('withTimeout', () => {
  it('passes a value through when the work finishes first', async () => {
    await expect(withTimeout(Promise.resolve('done'), 1_000)).resolves.toBe('done');
  });

  it('passes a rejection through unchanged', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1_000)).rejects.toThrow(
      'boom',
    );
  });

  it('rejects with a GuardTimeoutError when the work is too slow', async () => {
    const never = new Promise<string>(() => {});
    await expect(withTimeout(never, 10)).rejects.toBeInstanceOf(GuardTimeoutError);
    const error = await withTimeout(never, 10).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ name: 'GuardTimeoutError', timeoutMs: 10 });
    expect((error as Error).message).toBe('timed out after 10ms');
  });
});

// ---------------------------------------------------------------------------
// Step 6: redirects
// ---------------------------------------------------------------------------

describe('guardRedirect', () => {
  async function target(
    url = 'https://example.com/',
    policy = {},
  ): Promise<GuardedTarget> {
    return approved(await guardTarget(url, { resolve: publicResolver(), policy }));
  }

  it('refuses to follow a redirect at all under the default policy', async () => {
    const denial = refused(
      await guardRedirect('https://elsewhere.example.com/', await target(), {
        resolve: publicResolver(),
      }),
    );
    expect(denial.reason).toBe('too-many-redirects');
    expect(denial.detail).toContain('not followed');
  });

  it('re-runs the whole pipeline on a redirect the policy does allow', async () => {
    const from = await target('https://example.com/', { maxRedirects: 1 });
    const next = approved(
      await guardRedirect('https://other.example.com/x', from, {
        resolve: publicResolver(),
        policy: { maxRedirects: 1 },
      }),
    );
    expect(next.hostname).toBe('other.example.com');
    expect(next.url).toBe('https://other.example.com/x');
  });

  it('resolves a relative Location against the URL it came from', async () => {
    const from = await target('https://example.com/a/b', { maxRedirects: 1 });
    const next = approved(
      await guardRedirect('../c', from, {
        resolve: publicResolver(),
        policy: { maxRedirects: 1 },
      }),
    );
    expect(next.url).toBe('https://example.com/c');
  });

  it('blocks a redirect to a host that resolves privately', async () => {
    const from = await target('https://example.com/', { maxRedirects: 1 });
    const denial = refused(
      await guardRedirect('https://rebind.example.com/', from, {
        resolve: resolverFor('169.254.169.254'),
        policy: { maxRedirects: 1 },
      }),
    );
    expect(denial.reason).toBe('blocked-resolved-address');
  });

  it('blocks a redirect that changes scheme or port', async () => {
    const from = await target('https://example.com/', { maxRedirects: 1 });
    const deps = { resolve: publicResolver(), policy: { maxRedirects: 1 } };
    expect(refused(await guardRedirect('file:///etc/passwd', from, deps)).reason).toBe(
      'blocked-scheme',
    );
    expect(
      refused(await guardRedirect('http://example.com:8080/', from, deps)).reason,
    ).toBe('blocked-port');
  });

  it('stops once the hop budget is spent', async () => {
    const from = await target('https://example.com/', { maxRedirects: 2 });
    const denial = refused(
      await guardRedirect(
        'https://example.com/x',
        from,
        { resolve: publicResolver() },
        3,
      ),
    );
    expect(denial.reason).toBe('too-many-redirects');
    expect(denial.detail).toContain('more than 2');
  });

  it('refuses a Location header that is not a URL', async () => {
    const from = await target('https://example.com/', { maxRedirects: 1 });
    const denial = refused(
      await guardRedirect('http://[unterminated', from, { resolve: publicResolver() }),
    );
    expect(denial.reason).toBe('malformed-input');
    expect(denial.detail).toContain('not a URL');
  });
});

// ---------------------------------------------------------------------------
// Step 5: the outbound request, its headers, and the response cap
// ---------------------------------------------------------------------------

describe('sanitizeOutboundHeaders', () => {
  it('keeps only the forwardable headers, lower-cased and trimmed', () => {
    const { headers, dropped } = sanitizeOutboundHeaders({
      Accept: ' application/json ',
      'User-Agent': 'internet-visualizer/1.0',
      Cookie: 'session=abc',
      Authorization: 'Bearer secret',
      'X-Api-Key': 'secret',
      'Proxy-Authorization': 'Basic secret',
    });
    expect(headers).toEqual({
      accept: 'application/json',
      'user-agent': 'internet-visualizer/1.0',
    });
    expect(dropped).toEqual([
      'cookie',
      'authorization',
      'x-api-key',
      'proxy-authorization',
    ]);
  });

  it('drops a forwardable header whose value carries a control character', () => {
    const { headers, dropped } = sanitizeOutboundHeaders({
      accept: 'text/html\r\nCookie: x',
    });
    expect(headers).toEqual({});
    expect(dropped).toEqual(['accept']);
  });

  it('defaults to no headers at all', () => {
    expect(sanitizeOutboundHeaders()).toEqual({ headers: {}, dropped: [] });
    expect(FORWARDABLE_HEADERS).not.toContain('cookie');
  });
});

describe('guardedRequestInit', () => {
  async function cleared(policy = {}): Promise<GuardedTarget> {
    return approved(
      await guardTarget('https://example.com/', { resolve: publicResolver(), policy }),
    );
  }

  it('produces a read-only, credential-free, non-following request', async () => {
    const init = approved(guardedRequestInit(await cleared(), 'HEAD'));
    expect(init.method).toBe('HEAD');
    expect(init.redirect).toBe('manual');
    expect(init.credentials).toBe('omit');
    expect(init.referrerPolicy).toBe('no-referrer');
    expect(init.cache).toBe('no-store');
    expect(init.headers).toEqual({});
    expect(init.signal.aborted).toBe(false);
    init.cancel();
  });

  it('defaults to HEAD and upper-cases what it is given', async () => {
    const target = await cleared();
    expect(approved(guardedRequestInit(target)).method).toBe('HEAD');
    const get = approved(guardedRequestInit(target, 'get'));
    expect(get.method).toBe('GET');
    get.cancel();
  });

  it('sanitises the headers it is handed', async () => {
    const init = approved(
      guardedRequestInit(await cleared(), 'GET', { accept: 'text/html', cookie: 'a=b' }),
    );
    expect(init.headers).toEqual({ accept: 'text/html' });
    init.cancel();
  });

  it('refuses any method that is not read-only', async () => {
    const target = await cleared();
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'CONNECT']) {
      const denial = refused(guardedRequestInit(target, method));
      expect(denial.reason).toBe('malformed-input');
      expect(denial.detail).toContain(method);
    }
  });

  it('refuses a method the policy narrowed away', async () => {
    const target = await cleared({ methods: ['HEAD'] });
    expect(refused(guardedRequestInit(target, 'GET')).reason).toBe('malformed-input');
  });

  it('aborts the signal once the timeout passes', async () => {
    const init = approved(guardedRequestInit(await cleared({ timeoutMs: 5 }), 'HEAD'));
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(init.signal.aborted).toBe(true);
    expect(init.signal.reason).toBeInstanceOf(GuardTimeoutError);
  });
});

describe('timeoutSignal', () => {
  it('aborts after the delay, and cancel stops it from aborting at all', async () => {
    const early = timeoutSignal(5);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(early.signal.aborted).toBe(true);

    const cancelled = timeoutSignal(5);
    cancelled.cancel();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(cancelled.signal.aborted).toBe(false);
  });
});

describe('checkContentLength', () => {
  it('accepts a body that fits, and reports its declared size', () => {
    expect(approved(checkContentLength('1024', 65_536))).toBe(1024);
    expect(approved(checkContentLength('0'))).toBe(0);
  });

  it('is silent when there is no usable Content-Length', () => {
    expect(approved(checkContentLength(null))).toBeUndefined();
    expect(approved(checkContentLength(undefined))).toBeUndefined();
    expect(approved(checkContentLength('  '))).toBeUndefined();
    expect(approved(checkContentLength('chunked'))).toBeUndefined();
    expect(approved(checkContentLength('-5'))).toBeUndefined();
    expect(approved(checkContentLength('1.5'))).toBeUndefined();
  });

  it('refuses a body the server has already declared too large', () => {
    const denial = refused(checkContentLength('999999', 1_024));
    expect(denial.reason).toBe('response-too-large');
    expect(denial.detail).toContain('999999');
    expect(denial.detail).toContain('1024');
  });

  it('uses the default cap when none is given', () => {
    expect(refused(checkContentLength(String(MAX_RESPONSE_BYTES))).reason).toBe(
      'response-too-large',
    );
  });
});

describe('readCapped', () => {
  const bytes = (text: string) => new TextEncoder().encode(text);

  /** An async iterable body, which is what `fetch` gives you in Node. */
  async function* iterable(...chunks: string[]): AsyncGenerator<Uint8Array> {
    for (const chunk of chunks) yield bytes(chunk);
  }

  /**
   * A reader-only body. Safari's `ReadableStream` is not async-iterable, so the guard
   * keeps a `getReader()` path; this exercises it, including a chunk with no value.
   */
  function readerOnly(...chunks: (string | undefined)[]): ByteSource {
    let index = 0;
    let released = false;
    return {
      getReader: () => ({
        read: async () => {
          if (index >= chunks.length) return { done: true, value: undefined };
          const chunk = chunks[index++];
          return { done: false, value: chunk === undefined ? undefined : bytes(chunk) };
        },
        releaseLock: () => {
          released = true;
        },
        get released() {
          return released;
        },
      }),
    } as unknown as ByteSource;
  }

  it('reads an empty or absent body', async () => {
    expect(approved(await readCapped(null))).toEqual(new Uint8Array(0));
    expect(approved(await readCapped(undefined))).toEqual(new Uint8Array(0));
  });

  it('concatenates the chunks of an async iterable body', async () => {
    const body = approved(await readCapped(iterable('hello ', 'world')));
    expect(new TextDecoder().decode(body)).toBe('hello world');
  });

  it('reads a reader-only body, skipping a chunk that carries no bytes', async () => {
    const body = approved(await readCapped(readerOnly('a', undefined, 'b')));
    expect(new TextDecoder().decode(body)).toBe('ab');
  });

  it('reads a real ReadableStream', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes('ok'));
        controller.close();
      },
    });
    expect(new TextDecoder().decode(approved(await readCapped(stream)))).toBe('ok');
  });

  it('accepts a body exactly at the cap', async () => {
    expect(approved(await readCapped(iterable('12345'), 5)).byteLength).toBe(5);
  });

  it('refuses as soon as the body passes the cap, rather than after reading it all', async () => {
    let produced = 0;
    async function* endless(): AsyncGenerator<Uint8Array> {
      for (;;) {
        produced += 1;
        yield bytes('0123456789');
      }
    }
    const denial = refused(await readCapped(endless(), 25));
    expect(denial.reason).toBe('response-too-large');
    expect(denial.detail).toContain('25');
    // Three chunks of ten is the first total over twenty-five; it stopped there.
    expect(produced).toBe(3);
  });

  it('refuses an over-cap reader-only body too', async () => {
    expect(refused(await readCapped(readerOnly('aaaa', 'bbbb'), 4)).reason).toBe(
      'response-too-large',
    );
  });
});

describe('readCappedText', () => {
  async function* utf8(): AsyncGenerator<Uint8Array> {
    yield new TextEncoder().encode('{"status":"ok"}');
  }

  it('decodes what it read', async () => {
    expect(approved(await readCappedText(utf8()))).toBe('{"status":"ok"}');
    expect(approved(await readCappedText(null))).toBe('');
  });

  it('passes a refusal straight through', async () => {
    expect(refused(await readCappedText(utf8(), 4)).reason).toBe('response-too-large');
  });
});

// ---------------------------------------------------------------------------
// Disclosure
// ---------------------------------------------------------------------------

describe('describeTarget', () => {
  it('states exactly what will happen, for the live-mode disclosure panel', async () => {
    const target = approved(
      await guardTarget('https://example.com/health', {
        resolve: resolverFor(PUBLIC_V4),
      }),
    );
    const sentence = describeTarget(target, 'HEAD');
    expect(sentence).toContain('HEAD https://example.com/health');
    expect(sentence).toContain(PUBLIC_V4);
    expect(sentence).toContain('port 443');
    expect(sentence).toContain('no cookies or credentials');
    expect(sentence).toContain('5000ms timeout');
    expect(sentence).toContain('redirects not followed');
  });

  it('leaves out the resolved addresses when the target was an IP literal', async () => {
    const target = approved(
      await guardTarget(`http://${PUBLIC_V4}/`, { resolve: publicResolver() }),
    );
    expect(describeTarget(target)).toContain(`HEAD http://${PUBLIC_V4}/`);
    expect(describeTarget(target)).not.toContain('(');
  });
});
