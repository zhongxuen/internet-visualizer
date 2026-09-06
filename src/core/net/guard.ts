/**
 * `guard.ts` -- the SSRF guard.
 *
 * Every live request the phase-12 diagnostics module is allowed to make passes through
 * this file first. It is the single highest-risk file in the project, so it is written
 * to a few deliberate rules:
 *
 * - **It decides, it does not act.** Nothing here opens a socket or resolves a name.
 *   DNS resolution is injected as a {@link HostResolver}, which is what makes the
 *   rebinding case testable without a network.
 * - **Deny by default.** Every entry point returns a {@link GuardResult}; there is no
 *   boolean-returning shortcut a caller can forget to check, and no "allow unless"
 *   branch. A rejection always carries the reason, because the UI shows it and the
 *   tests assert on it.
 * - **A policy may only narrow, never widen.** {@link resolvePolicy} intersects any
 *   caller-supplied policy with the hard-coded ceilings below, so a future route
 *   handler cannot accidentally re-open port 8080 or a 30-second timeout.
 *
 * The order of the checks is the whole point, and it is the order from
 * `docs/implementation/12-module-network-diagnostics.md` section 3:
 *
 *   1. validate the input string (zod, then the strict parsers in `address.ts`)
 *   2. reject IP literals in private, loopback, link-local, multicast, reserved and
 *      IPv4-mapped-IPv6 space
 *   3. resolve the hostname, then **re-check every resolved address** -- this, and
 *      only this, is what stops DNS rebinding
 *   4. reject non-http(s) schemes and any port outside {80, 443}
 *   5. short timeout, small response cap
 *   6. never follow a redirect without re-running 1-4 on the new URL
 *   7. internal metadata endpoints (`169.254.169.254` and friends) blocked explicitly
 *
 * Steps 2 and 3 call the same function ({@link checkAddress}) on purpose: an address
 * that arrived from a resolver gets exactly the treatment a typed one does.
 */

import { z } from 'zod';

import {
  describeIp,
  formatIp,
  ipEquals,
  parseIp,
  unwrapIpv4Mapped,
  type IpAddress,
  type IpClassification,
  type IpScope,
} from './address';

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/**
 * Why a target was refused.
 *
 * A closed union rather than free text: route handlers map these onto status codes,
 * the UI maps them onto an explanation, and tests assert on them without depending on
 * the exact wording of `detail`.
 */
export type GuardDenialReason =
  /** Not a string, empty, too long, or carrying whitespace or control characters. */
  | 'malformed-input'
  /** Parsed as a URL, but not with an `http:` or `https:` scheme. */
  | 'blocked-scheme'
  /** An explicit port outside {80, 443}. */
  | 'blocked-port'
  /** `http://user:pass@host/` -- credentials are never forwarded, so never accepted. */
  | 'credentials-in-url'
  /**
   * The host is an IP written in a form that means different things to different
   * parsers (`2130706433`, `010.0.0.1`, `127.1`). Refused, not normalised.
   */
  | 'ambiguous-host'
  /** Not a usable DNS hostname: bad label, bad length, bad characters. */
  | 'malformed-host'
  /** A hostname reserved for local or internal use (`localhost`, `*.internal`). */
  | 'blocked-hostname'
  /** An IP literal outside globally routable space. */
  | 'blocked-address'
  /** The resolver threw, or was cancelled. */
  | 'resolution-failed'
  /** The resolver did not answer inside the policy timeout. */
  | 'timeout'
  /** The hostname resolved to nothing at all. */
  | 'no-addresses'
  /** The hostname resolved to an address outside public space -- the rebinding case. */
  | 'blocked-resolved-address'
  /** A redirect chain longer than the policy allows. */
  | 'too-many-redirects'
  /** A body larger than the policy cap, whether declared or actual. */
  | 'response-too-large';

/** A refusal: the reason, a sentence for the UI, and the address that caused it. */
export interface GuardDenial {
  readonly allowed: false;
  readonly reason: GuardDenialReason;
  /**
   * A lower-case fragment written to read well on its own under a form field, matching
   * the convention `ParseResult` uses for `error` in `result.ts`.
   */
  readonly detail: string;
  /** The offending address in canonical form, when a specific one was to blame. */
  readonly address?: string;
  /** Its scope, when it was an address that was blocked. */
  readonly scope?: IpScope;
  /** The name of the cloud metadata endpoint hit, when that is what it was. */
  readonly metadataEndpoint?: string;
}

/** Either an approved `value`, or a {@link GuardDenial} explaining the refusal. */
export type GuardResult<T> = { readonly allowed: true; readonly value: T } | GuardDenial;

/** Approve a value. */
export function allow<T>(value: T): GuardResult<T> {
  return { allowed: true, value };
}

/** Refuse, with a reason and optionally the address that triggered it. */
export function deny(
  reason: GuardDenialReason,
  detail: string,
  extra: Omit<GuardDenial, 'allowed' | 'reason' | 'detail'> = {},
): GuardDenial {
  return { allowed: false, reason, detail, ...extra };
}

/** Narrowing helper, for call sites that only need the boolean. */
export function isAllowed<T>(
  result: GuardResult<T>,
): result is { allowed: true; value: T } {
  return result.allowed;
}

/**
 * The approved value, or a thrown `Error`.
 *
 * For tests and trusted literals only. A route handler must hand the denial back to
 * the user, never throw it.
 */
export function unwrapGuard<T>(result: GuardResult<T>, context = 'target'): T {
  if (!result.allowed) {
    throw new Error(`blocked ${context}: ${result.detail}`);
  }
  return result.value;
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

/** The only schemes any live diagnostics request may use. */
export const ALLOWED_SCHEMES = ['http:', 'https:'] as const;

/** The only ports any live diagnostics request may use. */
export const ALLOWED_PORTS = [80, 443] as const;

/** The only methods: read-only, per the security rules in CLAUDE.md. */
export const ALLOWED_METHODS = ['GET', 'HEAD'] as const;

/** Section 3 step 5: "a short timeout (<= 5 s)". A ceiling, not a suggestion. */
export const MAX_TIMEOUT_MS = 5_000;

/** Nothing this module fetches is large; a megabyte is already generous. */
export const MAX_RESPONSE_BYTES = 1_048_576;

/** Longer than any legitimate diagnostics target, short enough to bound the parsers. */
export const MAX_URL_LENGTH = 2_048;

/** RFC 1035: a fully qualified name is at most 253 characters. */
export const MAX_HOSTNAME_LENGTH = 253;

/** A resolver returning more than this is misbehaving. Every address is still checked. */
export const MAX_RESOLVED_ADDRESSES = 64;

/** The knobs a caller may turn, every one of which may only narrow the ceilings above. */
export interface GuardPolicy {
  readonly schemes: readonly string[];
  readonly ports: readonly number[];
  readonly methods: readonly string[];
  /** Wall-clock budget for one outbound step, resolution included. */
  readonly timeoutMs: number;
  /** Hard cap on a response body, enforced while reading it rather than after. */
  readonly maxResponseBytes: number;
  /** 0 means "report the redirect, do not follow it" -- the default. */
  readonly maxRedirects: number;
  readonly maxUrlLength: number;
}

/** The policy every route handler gets unless it deliberately narrows it further. */
export const DEFAULT_GUARD_POLICY: GuardPolicy = {
  schemes: ALLOWED_SCHEMES,
  ports: ALLOWED_PORTS,
  methods: ALLOWED_METHODS,
  timeoutMs: MAX_TIMEOUT_MS,
  maxResponseBytes: 65_536,
  maxRedirects: 0,
  maxUrlLength: MAX_URL_LENGTH,
};

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.min(high, Math.max(low, Math.floor(value)));
}

/**
 * Fold an override into the default policy, intersecting rather than replacing.
 *
 * A caller asking for `{ ports: [8080] }` gets `[]` -- and therefore a guard that
 * refuses everything -- not port 8080. Widening has to be a deliberate edit to the
 * constants above, where it shows up in a diff and is covered by a test.
 */
export function resolvePolicy(overrides: Partial<GuardPolicy> = {}): GuardPolicy {
  const narrow = <T>(allowed: readonly T[], asked: readonly T[] | undefined): T[] =>
    asked === undefined ? [...allowed] : asked.filter((item) => allowed.includes(item));

  return {
    schemes: narrow(ALLOWED_SCHEMES, overrides.schemes),
    ports: narrow(ALLOWED_PORTS, overrides.ports),
    methods: narrow(ALLOWED_METHODS, overrides.methods),
    timeoutMs: clamp(
      overrides.timeoutMs ?? DEFAULT_GUARD_POLICY.timeoutMs,
      1,
      MAX_TIMEOUT_MS,
    ),
    maxResponseBytes: clamp(
      overrides.maxResponseBytes ?? DEFAULT_GUARD_POLICY.maxResponseBytes,
      1,
      MAX_RESPONSE_BYTES,
    ),
    maxRedirects: clamp(
      overrides.maxRedirects ?? DEFAULT_GUARD_POLICY.maxRedirects,
      0,
      5,
    ),
    maxUrlLength: clamp(
      overrides.maxUrlLength ?? DEFAULT_GUARD_POLICY.maxUrlLength,
      1,
      MAX_URL_LENGTH,
    ),
  };
}

// ---------------------------------------------------------------------------
// Named blocks (section 3, step 7)
// ---------------------------------------------------------------------------

/**
 * The addresses cloud providers answer instance credentials on.
 *
 * Every one of these is already refused by {@link checkAddress} on scope alone -- they
 * are link-local, shared, reserved, or unique-local. The table exists anyway for two
 * reasons: a denial can then name the endpoint, which is the teaching moment; and the
 * acceptance criteria require `169.254.169.254` to be asserted *by name* in a test,
 * which needs a name to assert against.
 */
export const METADATA_ENDPOINTS: Readonly<Record<string, string>> = {
  '169.254.169.254': 'AWS/GCP/Azure/DigitalOcean instance metadata',
  '169.254.170.2': 'AWS ECS task metadata',
  '169.254.169.253': 'AWS VPC DNS',
  '169.254.169.123': 'AWS time sync',
  '100.100.100.200': 'Alibaba Cloud instance metadata',
  '192.0.0.192': 'Oracle Cloud instance metadata',
  'fd00:ec2::254': 'AWS IPv6 instance metadata',
};

/**
 * The name of the metadata service at this address, if it is one.
 *
 * The lookup is done on the unwrapped address, so `::ffff:169.254.169.254` is
 * recognised as the same endpoint `169.254.169.254` is.
 */
export function metadataEndpointFor(address: IpAddress): string | undefined {
  return METADATA_ENDPOINTS[formatIp(unwrapIpv4Mapped(address) ?? address)];
}

/**
 * Hostnames that must never be looked up, whatever DNS would say about them.
 *
 * Resolution is the real defence -- these would be caught at step 3 anyway -- but
 * refusing them by name gives a far better error message than "resolved to a loopback
 * address", and it costs no round trip.
 */
export const BLOCKED_HOSTNAMES: readonly string[] = [
  'localhost',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'instance-data.ec2.internal',
];

/** Suffixes reserved for local, internal, or non-DNS use (RFC 6761, RFC 8375). */
export const BLOCKED_HOSTNAME_SUFFIXES: readonly string[] = [
  '.local',
  '.localhost',
  '.localdomain',
  '.internal',
  '.intranet',
  '.private',
  '.corp',
  '.home',
  '.home.arpa',
  '.lan',
  '.in-addr.arpa',
  '.ip6.arpa',
  '.onion',
  '.i2p',
  '.test',
  '.example',
  '.invalid',
];

// ---------------------------------------------------------------------------
// Step 1: input validation
// ---------------------------------------------------------------------------

/**
 * A control character anywhere in a header value.
 *
 * CR and LF are the ones that matter: a header value carrying them splits one request
 * into two. Spaces are fine here -- `Accept: text/html, application/xml` has them.
 */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/**
 * Any control character, plus every kind of space -- ASCII or Unicode.
 *
 * The WHATWG URL parser silently strips tabs and newlines from a URL and trims ASCII
 * whitespace from both ends, which is a well-worn way to smuggle a host past a filter
 * that looked at the string first. So a target carrying any of it is refused before it
 * is ever parsed, in keeping with the "unforgiving on purpose" rule the rest of
 * `src/core/net` follows.
 *
 * Written as a scan over code points rather than a regular expression because a regex
 * carrying literal control characters is unreadable in a diff, which is the last thing
 * this particular check should be.
 */
function hasForbiddenCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
    if (code === 0x00a0 || code === 0x1680 || (code >= 0x2000 && code <= 0x200a))
      return true;
    if (code === 0x2028 || code === 0x2029 || code === 0x202f || code === 0x205f)
      return true;
    if (code === 0x3000 || code === 0xfeff) return true;
  }
  return false;
}

/** A single URL target: one string, http(s), no whitespace, bounded length. */
export const targetUrlSchema = z
  .string({ error: 'target must be a single string' })
  .min(1, { error: 'target is empty' })
  .max(MAX_URL_LENGTH, { error: `target is longer than ${MAX_URL_LENGTH} characters` })
  .refine((value) => !hasForbiddenCharacter(value), {
    error: 'target contains whitespace or control characters',
  });

/** A single hostname or IP literal: what the DNS and RDAP lookups take. */
export const lookupTargetSchema = z
  .string({ error: 'target must be a single string' })
  .min(1, { error: 'target is empty' })
  .max(MAX_HOSTNAME_LENGTH, {
    error: `target is longer than ${MAX_HOSTNAME_LENGTH} characters`,
  })
  .refine((value) => !hasForbiddenCharacter(value), {
    error: 'target contains whitespace or control characters',
  })
  .refine((value) => !value.includes('/'), {
    error: 'target must be one host, not a CIDR block or a path',
  })
  .refine((value) => !value.includes(','), {
    error: 'target must be one host, not a list',
  })
  .refine((value) => !/^[\d.]+-[\d.]+$/.test(value), {
    error: 'target must be one host, not an address range',
  });

/** The first zod issue, or a fallback -- zod messages go straight to the user. */
function firstIssue(error: z.ZodError, fallback: string): string {
  return error.issues[0]?.message ?? fallback;
}

// ---------------------------------------------------------------------------
// Step 2: addresses
// ---------------------------------------------------------------------------

/** An address that passed the block list, with the classification that cleared it. */
export interface CheckedAddress {
  readonly address: IpAddress;
  /** Canonical text, so a denial and a log line agree on how to spell it. */
  readonly text: string;
  readonly classification: IpClassification;
}

/**
 * Step 2, and again step 3: is this address one a live request may target?
 *
 * The rule is an allow-list of exactly one scope. `describeIp` already unwraps
 * IPv4-mapped IPv6 (`::ffff:169.254.169.254` classifies as the link-local IPv4 address
 * inside it) and already knows the IANA special-purpose registries, so this function
 * stays a single comparison rather than a list of ranges that would drift from
 * `address.ts`.
 */
export function checkAddress(input: IpAddress | string): GuardResult<CheckedAddress> {
  let address: IpAddress;
  if (typeof input === 'string') {
    const parsed = parseIp(input);
    if (!parsed.ok) {
      return deny('malformed-input', `not a valid IP address: ${parsed.error}`);
    }
    address = parsed.value;
  } else {
    address = input;
  }

  const text = formatIp(address);
  const classification = describeIp(address);
  const metadataEndpoint = metadataEndpointFor(address);

  if (metadataEndpoint) {
    return deny(
      'blocked-address',
      `${text} is the ${metadataEndpoint} endpoint, which must never be reached from a server`,
      { address: text, scope: classification.scope, metadataEndpoint },
    );
  }

  if (classification.scope !== 'public') {
    const block = classification.block ? ` (${classification.block})` : '';
    return deny(
      'blocked-address',
      `${text} is ${classification.scope}${block}: ${classification.note}`,
      { address: text, scope: classification.scope },
    );
  }

  return allow({ address, text, classification });
}

// ---------------------------------------------------------------------------
// Hostnames
// ---------------------------------------------------------------------------

/** One DNS label: letters, digits, hyphens, never leading or trailing hyphen. */
const LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** A TLD is alphabetic, or an IDN A-label. Never all digits -- that would be an IP. */
const TLD_PATTERN = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/;

/**
 * Strict RFC 1123 hostname validation over an already lower-cased name.
 *
 * Stricter than a resolver would be: at least two labels (so a bare intranet name like
 * `wiki` can never be tried), no underscores (legal in a `_dmarc` TXT owner name, never
 * in an authority component), and a TLD that cannot be mistaken for an octet.
 */
export function checkHostname(input: string): GuardResult<string> {
  const parsed = lookupTargetSchema.safeParse(input);
  if (!parsed.success) {
    return deny('malformed-input', firstIssue(parsed.error, 'invalid hostname'));
  }

  // One trailing dot is the legal way to write a fully qualified name; drop it, and
  // refuse anything more decorative than that.
  const name = parsed.data.toLowerCase().replace(/\.$/, '');

  if (name.length === 0) {
    return deny('malformed-host', 'hostname is empty');
  }

  // Before the structural checks, so that `localhost` -- much the most common way to
  // aim a server at itself -- is reported as the reserved name it is rather than as a
  // single label that happens to be malformed. The overall length is already bounded
  // by `lookupTargetSchema`.
  if (BLOCKED_HOSTNAMES.includes(name)) {
    return deny('blocked-hostname', `"${name}" is a reserved local name`);
  }
  const suffix = BLOCKED_HOSTNAME_SUFFIXES.find((candidate) => name.endsWith(candidate));
  if (suffix) {
    return deny(
      'blocked-hostname',
      `"${suffix}" names are reserved for local or internal use and never resolve publicly`,
    );
  }

  const labels = name.split('.');
  if (labels.length < 2) {
    return deny(
      'malformed-host',
      `"${name}" is a single label; a live lookup needs a fully qualified name`,
    );
  }
  for (const label of labels) {
    if (!LABEL_PATTERN.test(label)) {
      return deny('malformed-host', `"${label}" is not a valid DNS label`);
    }
  }
  const tld = labels[labels.length - 1] as string;
  if (!TLD_PATTERN.test(tld)) {
    return deny('malformed-host', `"${tld}" is not a valid top-level domain`);
  }

  return allow(name);
}

/** What the authority component of a validated target turned out to be. */
export type HostTarget =
  | {
      readonly kind: 'ip';
      readonly address: IpAddress;
      readonly text: string;
      readonly classification: IpClassification;
    }
  | { readonly kind: 'hostname'; readonly name: string };

/**
 * A single hostname-or-IP target, validated and block-listed but not yet resolved.
 *
 * This is what `dns/route.ts` and `rdap/route.ts` take: they are given a name, not a
 * URL. A hostname still has to go through {@link checkResolvedAddresses} before
 * anything is fetched *from* it; for those two routes the request goes to the
 * allow-listed resolver or registry instead, and the name is only ever a parameter.
 */
export function parseLookupTarget(input: unknown): GuardResult<HostTarget> {
  const parsed = lookupTargetSchema.safeParse(input);
  if (!parsed.success) {
    return deny('malformed-input', firstIssue(parsed.error, 'invalid target'));
  }
  const text = parsed.data;

  // An IP literal is judged as an address; anything else must be a hostname. Note that
  // `parseIp` is the strict parser: `010.0.0.1` and `2130706433` fail here and then
  // fail hostname validation too, so neither can slip through as "just a name".
  const asIp = parseIp(text);
  if (asIp.ok) {
    const checked = checkAddress(asIp.value);
    if (!checked.allowed) return checked;
    return allow({
      kind: 'ip',
      address: checked.value.address,
      text: checked.value.text,
      classification: checked.value.classification,
    });
  }

  const hostname = checkHostname(text);
  if (!hostname.allowed) return hostname;
  return allow({ kind: 'hostname', name: hostname.value });
}

// ---------------------------------------------------------------------------
// Steps 1, 2 and 4: the URL, before resolution
// ---------------------------------------------------------------------------

/** A URL that passed every check that can be made without asking DNS anything. */
export interface InspectedTarget {
  /** The normalised URL, which is the exact string that will be requested. */
  readonly url: string;
  readonly scheme: string;
  /** Lower-cased, brackets stripped from an IPv6 literal. */
  readonly hostname: string;
  /** The effective port -- 80 or 443 filled in when the URL left it implicit. */
  readonly port: number;
  readonly host: HostTarget;
  readonly policy: GuardPolicy;
}

/**
 * The host as it was actually typed, before the URL parser rewrote it.
 *
 * `new URL()` implements the WHATWG host parser, which happily turns `2130706433`,
 * `0x7f.0.0.1` and `127.1` into `127.0.0.1` -- and, worse, `010.0.0.1` into the
 * *public* address `8.0.0.1`, because it reads the leading zero as octal. Comparing
 * what was typed against what was produced is how {@link inspectUrl} refuses those
 * forms instead of silently agreeing with one interpretation of them.
 */
function rawHostOf(input: string): string | undefined {
  const schemeEnd = input.indexOf('://');
  if (schemeEnd < 0) return undefined;

  const rest = input.slice(schemeEnd + 3);
  const pathStart = rest.search(/[/?#]/);
  const authority = pathStart === -1 ? rest : rest.slice(0, pathStart);

  // No userinfo to strip: a URL carrying credentials was refused before this ran.
  const hostPort = authority;

  // An IPv6 literal is bracketed, and only then may contain colons of its own. The URL
  // parser refuses an unterminated bracket outright, so a match here is always closed.
  const bracketed = /^\[([^\]]*)\]/.exec(hostPort);
  if (bracketed) return bracketed[1];

  const colon = hostPort.indexOf(':');
  return colon === -1 ? hostPort : hostPort.slice(0, colon);
}

/** Strip the brackets the URL parser puts back around an IPv6 host. */
function unbracket(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

/**
 * Steps 1, 2 and 4: everything that can be decided from the URL string alone.
 *
 * Split out from {@link guardTarget} because it is synchronous and total -- the UI can
 * run it on every keystroke to show why a target will be refused, without resolving
 * anything and without a network round trip.
 */
export function inspectUrl(
  input: unknown,
  overrides: Partial<GuardPolicy> = {},
): GuardResult<InspectedTarget> {
  const policy = resolvePolicy(overrides);

  const parsed = targetUrlSchema.safeParse(input);
  if (!parsed.success) {
    return deny('malformed-input', firstIssue(parsed.error, 'invalid target'));
  }
  const text = parsed.data;
  if (text.length > policy.maxUrlLength) {
    return deny(
      'malformed-input',
      `target is longer than ${policy.maxUrlLength} characters`,
    );
  }

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return deny(
      'malformed-input',
      'target is not a URL; it must start with http:// or https://',
    );
  }

  // Step 4a: scheme. `javascript:`, `file:`, `gopher:` and `data:` all parse happily.
  if (!policy.schemes.includes(url.protocol)) {
    return deny(
      'blocked-scheme',
      `scheme "${url.protocol}" is not allowed; only ${policy.schemes.join(' and ')} are`,
    );
  }

  // No credentials are ever forwarded, so a URL carrying them is a mistake worth
  // naming rather than quietly dropping.
  if (url.username !== '' || url.password !== '') {
    return deny(
      'credentials-in-url',
      'the target must not contain a username or password',
    );
  }

  // Step 4b: port. An implicit port is the scheme default; an explicit one must be in
  // the list. `http://host:80/` normalises to an empty port, which is the same thing.
  const port =
    url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port);
  if (!policy.ports.includes(port)) {
    return deny(
      'blocked-port',
      `port ${port} is not allowed; only ${policy.ports.join(' and ')} are`,
    );
  }

  // A special scheme always has a host -- `new URL('http://')` throws -- so there is no
  // empty-host case to handle here; `checkHostname` would refuse one anyway.
  const hostname = unbracket(url.hostname);

  const asIp = parseIp(hostname);
  if (asIp.ok) {
    // The host is an IP literal. Insist it was *written* as one, unambiguously: the
    // strict parser must agree with the URL parser about which address this is.
    const raw = rawHostOf(text);
    const rawIp = raw === undefined ? undefined : parseIp(unbracket(raw));
    if (!rawIp?.ok || !ipEquals(rawIp.value, asIp.value)) {
      return deny(
        'ambiguous-host',
        `"${raw ?? hostname}" is not a canonical IP address; write it as ${formatIp(asIp.value)}`,
      );
    }

    const checked = checkAddress(asIp.value);
    if (!checked.allowed) return checked;

    return allow({
      url: url.toString(),
      scheme: url.protocol,
      hostname,
      port,
      host: {
        kind: 'ip',
        address: checked.value.address,
        text: checked.value.text,
        classification: checked.value.classification,
      },
      policy,
    });
  }

  const name = checkHostname(hostname);
  if (!name.allowed) return name;

  return allow({
    url: url.toString(),
    scheme: url.protocol,
    hostname: name.value,
    port,
    host: { kind: 'hostname', name: name.value },
    policy,
  });
}

// ---------------------------------------------------------------------------
// Step 3: resolution, and the re-check that defeats rebinding
// ---------------------------------------------------------------------------

/**
 * How the guard asks what a hostname resolves to.
 *
 * Injected rather than imported so that this file performs no I/O and the rebinding
 * case is testable: a test supplies a resolver that returns `10.0.0.1` for a name that
 * looks entirely ordinary, which is precisely what an attacker's authoritative server
 * does. The route handlers pass `dns.promises.resolve4`/`resolve6` (or a lookup that
 * returns both families); the guard does not care which, as long as it is handed
 * *every* address the request could end up connecting to.
 */
export type HostResolver = (hostname: string) => Promise<readonly string[]>;

/** Everything {@link guardTarget} needs from the outside world. */
export interface GuardDeps {
  readonly resolve: HostResolver;
  readonly policy?: Partial<GuardPolicy>;
}

/** A target cleared for a single request, with the addresses that cleared it. */
export interface GuardedTarget extends InspectedTarget {
  /**
   * Every address the hostname resolves to, each individually re-checked. For an IP
   * literal target this is the literal itself.
   *
   * A caller that can pin the connection to one of these should: between this check
   * and the connection there is a window in which the name could be re-answered, and
   * pinning is the only thing that closes it completely.
   */
  readonly addresses: readonly CheckedAddress[];
  /** False when the host was an IP literal and no resolution was needed. */
  readonly resolved: boolean;
}

/**
 * Step 3: re-check every address a name resolved to.
 *
 * *Every* one, and refuse the whole set if any single address is blocked. Checking
 * only the first would leave the obvious attack -- an A record set answering both
 * `93.184.216.34` and `169.254.169.254`, where the connect picks whichever it likes.
 */
export function checkResolvedAddresses(
  addresses: readonly string[],
  hostname = 'the hostname',
): GuardResult<readonly CheckedAddress[]> {
  if (addresses.length === 0) {
    return deny('no-addresses', `${hostname} does not resolve to any address`);
  }
  if (addresses.length > MAX_RESOLVED_ADDRESSES) {
    return deny(
      'blocked-resolved-address',
      `${hostname} resolves to ${addresses.length} addresses, which is more than the ${MAX_RESOLVED_ADDRESSES} allowed`,
    );
  }

  const checked: CheckedAddress[] = [];
  for (const candidate of addresses) {
    const result = checkAddress(candidate);
    if (!result.allowed) {
      return deny(
        result.reason === 'malformed-input'
          ? 'resolution-failed'
          : 'blocked-resolved-address',
        `${hostname} resolves to ${result.address ?? candidate}, and ${result.detail}`,
        {
          address: result.address ?? candidate,
          scope: result.scope,
          metadataEndpoint: result.metadataEndpoint,
        },
      );
    }
    checked.push(result.value);
  }
  return allow(checked);
}

/** Raised by {@link withTimeout} so a slow resolver is distinguishable from a broken one. */
export class GuardTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`timed out after ${timeoutMs}ms`);
    this.name = 'GuardTimeoutError';
  }
}

/**
 * Race a promise against the clock.
 *
 * The timer is always cleared, including on the happy path: a dangling handle keeps a
 * serverless function -- and a test runner -- alive past the work it was doing.
 */
export function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  // Definitely assigned: the executor runs synchronously inside the constructor.
  let timer!: ReturnType<typeof setTimeout>;
  const clock = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new GuardTimeoutError(timeoutMs)), timeoutMs);
    // Node only; harmless where it is absent.
    (timer as unknown as { unref?: () => void }).unref?.();
  });
  return Promise.race([work, clock]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/**
 * The whole pipeline: steps 1-4 in order, for one URL.
 *
 * Returns the addresses it cleared, so the caller can pin the connection to them and
 * so the `LiveDisclosure` panel can show the user exactly where the request will go
 * before it is made.
 */
export async function guardTarget(
  input: unknown,
  deps: GuardDeps,
): Promise<GuardResult<GuardedTarget>> {
  const inspected = inspectUrl(input, deps.policy);
  if (!inspected.allowed) return inspected;

  const target = inspected.value;

  // An IP literal was already checked as an address; there is nothing to resolve, and
  // nothing a resolver could later change its mind about.
  if (target.host.kind === 'ip') {
    return allow({
      ...target,
      resolved: false,
      addresses: [
        {
          address: target.host.address,
          text: target.host.text,
          classification: target.host.classification,
        },
      ],
    });
  }

  let addresses: readonly string[];
  try {
    addresses = await withTimeout(
      Promise.resolve(deps.resolve(target.host.name)),
      target.policy.timeoutMs,
    );
  } catch (error) {
    if (error instanceof GuardTimeoutError) {
      return deny(
        'timeout',
        `resolving ${target.hostname} took longer than ${target.policy.timeoutMs}ms`,
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    return deny(
      'resolution-failed',
      `${target.hostname} could not be resolved: ${message}`,
    );
  }

  if (!Array.isArray(addresses)) {
    return deny('resolution-failed', `the resolver did not return a list of addresses`);
  }

  const checked = checkResolvedAddresses(addresses, target.hostname);
  if (!checked.allowed) return checked;

  return allow({ ...target, resolved: true, addresses: checked.value });
}

// ---------------------------------------------------------------------------
// Step 6: redirects
// ---------------------------------------------------------------------------

/**
 * Step 6: a redirect is a brand new target, and gets the whole pipeline again.
 *
 * The default policy sets `maxRedirects: 0`, so the normal answer is "report the
 * `Location` header and stop". When a caller does opt into following one, resolution
 * happens again from scratch -- a redirect to a name that resolves privately is the
 * same attack as a first request to one.
 */
export async function guardRedirect(
  location: string,
  from: GuardedTarget,
  deps: GuardDeps,
  hop = 1,
): Promise<GuardResult<GuardedTarget>> {
  if (hop > from.policy.maxRedirects) {
    return deny(
      'too-many-redirects',
      from.policy.maxRedirects === 0
        ? 'redirects are not followed; the target must answer directly'
        : `more than ${from.policy.maxRedirects} redirects were followed`,
    );
  }

  let next: string;
  try {
    next = new URL(location, from.url).toString();
  } catch {
    return deny('malformed-input', `redirect target "${location}" is not a URL`);
  }

  return guardTarget(next, deps);
}

// ---------------------------------------------------------------------------
// Step 5: outbound request shape, timeouts, and the response cap
// ---------------------------------------------------------------------------

/**
 * The only request headers that go out.
 *
 * An allow-list, not a block-list: the failure mode of a block-list is a header nobody
 * thought of (`X-Api-Key`, `Proxy-Authorization`, a platform-injected identity token)
 * being forwarded to a third party the user typed the address of.
 */
export const FORWARDABLE_HEADERS: readonly string[] = [
  'accept',
  'accept-language',
  'user-agent',
];

/** Keep only the forwardable headers, and report what was dropped. */
export function sanitizeOutboundHeaders(headers: Readonly<Record<string, string>> = {}): {
  readonly headers: Record<string, string>;
  readonly dropped: readonly string[];
} {
  const kept: Record<string, string> = {};
  const dropped: string[] = [];
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (FORWARDABLE_HEADERS.includes(lower) && !hasControlCharacter(value.trim())) {
      kept[lower] = value.trim();
    } else {
      dropped.push(lower);
    }
  }
  return { headers: kept, dropped };
}

/** The subset of `RequestInit` this module ever sets, spelled out so it is auditable. */
export interface GuardedRequestInit {
  readonly method: string;
  /** Never `follow`: step 6 re-validates instead. */
  readonly redirect: 'manual';
  /** No cookies, no client certificates, no platform identity. */
  readonly credentials: 'omit';
  readonly referrerPolicy: 'no-referrer';
  readonly cache: 'no-store';
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}

/** An `AbortSignal` that fires after `ms`, plus the `cancel` that tidies its timer. */
export function timeoutSignal(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new GuardTimeoutError(ms)), ms);
  (timer as unknown as { unref?: () => void }).unref?.();
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

/**
 * The `fetch` options for a cleared target: read-only method, no credentials, no
 * redirect following, no cookies, and a timeout.
 *
 * Returned rather than applied, because this file does not make requests.
 */
export function guardedRequestInit(
  target: GuardedTarget,
  method = 'HEAD',
  headers: Readonly<Record<string, string>> = {},
): GuardResult<GuardedRequestInit & { cancel: () => void }> {
  const upper = method.toUpperCase();
  if (!target.policy.methods.includes(upper)) {
    return deny(
      'malformed-input',
      `method ${upper} is not allowed; only ${target.policy.methods.join(' and ')} are`,
    );
  }
  const { signal, cancel } = timeoutSignal(target.policy.timeoutMs);
  return allow({
    method: upper,
    redirect: 'manual',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
    headers: sanitizeOutboundHeaders(headers).headers,
    signal,
    cancel,
  });
}

/**
 * Refuse a body the server has already declared too large, before reading a byte.
 *
 * A missing or unparseable `Content-Length` is not an error -- chunked responses have
 * none -- it just means {@link readCapped} is the one doing the enforcing.
 */
export function checkContentLength(
  header: string | null | undefined,
  maxBytes = DEFAULT_GUARD_POLICY.maxResponseBytes,
): GuardResult<number | undefined> {
  if (header === null || header === undefined || header.trim() === '') {
    return allow(undefined);
  }
  const declared = Number(header.trim());
  if (!Number.isInteger(declared) || declared < 0) {
    return allow(undefined);
  }
  if (declared > maxBytes) {
    return deny(
      'response-too-large',
      `the response declares ${declared} bytes, over the ${maxBytes}-byte cap`,
    );
  }
  return allow(declared);
}

/** Anything a body can arrive as: a web stream, an async iterable, or nothing. */
export type ByteSource =
  ReadableStream<Uint8Array> | AsyncIterable<Uint8Array> | null | undefined;

async function* chunksOf(source: ByteSource): AsyncGenerator<Uint8Array> {
  if (!source) return;
  if (Symbol.asyncIterator in source) {
    yield* source as AsyncIterable<Uint8Array>;
    return;
  }
  const reader = (source as ReadableStream<Uint8Array>).getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Step 5: read a body, refusing as soon as it passes the cap.
 *
 * Enforced *during* the read, not after: `await response.text()` on a target that
 * streams for as long as you let it is the whole point of the cap.
 */
export async function readCapped(
  source: ByteSource,
  maxBytes = DEFAULT_GUARD_POLICY.maxResponseBytes,
): Promise<GuardResult<Uint8Array>> {
  const chunks: Uint8Array[] = [];
  let total = 0;

  for await (const chunk of chunksOf(source)) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      return deny(
        'response-too-large',
        `the response is larger than the ${maxBytes}-byte cap`,
      );
    }
    chunks.push(chunk);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return allow(body);
}

/** {@link readCapped}, decoded as UTF-8. */
export async function readCappedText(
  source: ByteSource,
  maxBytes = DEFAULT_GUARD_POLICY.maxResponseBytes,
): Promise<GuardResult<string>> {
  const bytes = await readCapped(source, maxBytes);
  if (!bytes.allowed) return bytes;
  return allow(new TextDecoder().decode(bytes.value));
}

/**
 * A one-line summary of what a cleared target means, for `LiveDisclosure`.
 *
 * The UI must be able to say, before the request is made, exactly what will happen --
 * so the sentence is built here, from the decision, rather than assembled separately
 * in a component where it could drift from what the guard actually approved.
 */
export function describeTarget(target: GuardedTarget, method = 'HEAD'): string {
  const where = target.resolved
    ? `${target.hostname} (${target.addresses.map((entry) => entry.text).join(', ')})`
    : target.hostname;
  return `${method} ${target.url} -- one request, from the server, to ${where} on port ${target.port}, with no cookies or credentials, a ${target.policy.timeoutMs}ms timeout, and redirects not followed`;
}
