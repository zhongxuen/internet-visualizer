/**
 * Cookies -- the jar, and the attributes that decide what goes in and what comes out.
 *
 * HTTP is stateless, so a cookie is the whole of how a server recognises you on the next
 * request. It arrives as one `Set-Cookie` field, is filed in a **jar** under a domain and
 * a path, and is sent back on every request those two rules match -- automatically,
 * whether or not the page meant to send it. That last word is where cookie security
 * lives: the browser attaches your session to a cross-site request just as readily as to
 * one you meant to make, and every attribute modelled here exists to narrow that down.
 *
 * ## The matching rules are the security model
 *
 * `Domain` and `Path` decide *where* a cookie goes; `Secure`, `HttpOnly`, and `SameSite`
 * decide *whether* it goes at all. Get one of the five wrong and the cookie leaks --
 * which is why {@link domainMatches}, {@link pathMatches}, and {@link sameSiteAllows} are
 * separate, exported, and tested one rule at a time rather than folded into the lookup.
 *
 * | Attribute  | The attack it blocks                                                  |
 * | ---------- | --------------------------------------------------------------------- |
 * | `HttpOnly` | Script reading the session (`document.cookie` after an XSS)            |
 * | `SameSite` | Another site's page silently using your session (CSRF)                 |
 * | `Secure`   | The cookie riding a plaintext request where anyone on the path sees it |
 * | `__Host-`  | A cookie planted by a sibling subdomain (session fixation)             |
 *
 * See {@link COOKIE_DEFENCES} for the same table as data.
 *
 * ## Parsing and storing are separate, as in the spec
 *
 * {@link parseSetCookie} is the syntax (RFC 6265 s5.2): it reads attributes and applies
 * none of them. {@link storeCookie} is the policy (s5.3 and RFC 6265bis s5.5): defaults,
 * the domain check, the prefix rules, and the decision to keep or reject. Keeping them
 * apart is what lets the UI show a cookie that was *parsed fine and rejected anyway*, and
 * say which rule rejected it.
 *
 * ## Time
 *
 * The jar runs on virtual milliseconds like the rest of the simulation. `Max-Age` is
 * seconds and needs no conversion; `Expires` is an absolute date and is converted through
 * {@link HttpClock}, so a scenario pins its clock origin and gets the same jar every run.
 */

import { fail, ok, type ParseResult } from '@/core/net/result';

import {
  EPOCH_CLOCK,
  headerValues,
  parseHttpDate,
  toVirtual,
  type HeaderList,
  type HttpClock,
  type HttpMethod,
} from './message';
import { isSafe } from './semantics';

// ---------------------------------------------------------------------------
// Attributes
// ---------------------------------------------------------------------------

/** When a cookie may accompany a cross-site request (RFC 6265bis s5.4.7). */
export type SameSite = 'Strict' | 'Lax' | 'None';

/**
 * The default when `SameSite` is absent.
 *
 * Browsers changed this from `None` to `Lax` around 2020, which turned a decade of
 * implicit CSRF exposure into an opt-in. A cookie that genuinely needs to travel
 * cross-site must now say `SameSite=None` **and** `Secure`, and saying one without the
 * other is rejected outright -- see {@link storeCookie}.
 */
export const DEFAULT_SAME_SITE: SameSite = 'Lax';

/** A `Set-Cookie` field as parsed -- attributes as given, no defaults applied. */
export interface SetCookieAttributes {
  readonly name: string;
  readonly value: string;
  /** `Expires`, as an epoch millisecond. Absolute, so it needs a clock to be useful. */
  readonly expires?: number;
  /** `Max-Age` in seconds. May be zero or negative, which means "delete this now". */
  readonly maxAge?: number;
  /** Lower-cased, leading dot stripped -- `.example.com` and `example.com` are one thing. */
  readonly domain?: string;
  readonly path?: string;
  readonly secure: boolean;
  readonly httpOnly: boolean;
  readonly sameSite?: SameSite;
  /** CHIPS: partition the cookie by top-level site (RFC 6265bis, cookie partitioning). */
  readonly partitioned: boolean;
  /** Anything the parser did not recognise, kept so the wire view can show it. */
  readonly unknown: readonly { readonly name: string; readonly value: string }[];
  /** The field value exactly as received. */
  readonly raw: string;
}

/**
 * A cookie in the jar: the attributes plus the defaults that were resolved for it.
 *
 * `lastAccessedAt` from RFC 6265 s5.3 is deliberately absent. It exists only to order
 * eviction when a jar is full, this jar has no size limit, and tracking it would mean a
 * *read* mutated the jar -- which would make the simulation's history depend on how many
 * times the UI happened to render it.
 */
export interface Cookie {
  readonly name: string;
  readonly value: string;
  /** Never carries a leading dot, whatever the `Set-Cookie` said. */
  readonly domain: string;
  /**
   * True when no `Domain` attribute was sent: the cookie goes to that exact host and to
   * no subdomain of it. This is the **safer** default, and omitting `Domain` is how you
   * get it -- sending `Domain=example.com` widens the cookie rather than narrowing it,
   * which is the reverse of what most people expect the attribute to do.
   */
  readonly hostOnly: boolean;
  readonly path: string;
  /** Virtual millisecond it expires. Absent means a **session** cookie. */
  readonly expiresAt?: number;
  readonly secure: boolean;
  readonly httpOnly: boolean;
  readonly sameSite: SameSite;
  /** False when `SameSite` was absent and {@link DEFAULT_SAME_SITE} was applied. */
  readonly sameSiteExplicit: boolean;
  readonly partitioned: boolean;
  /** Virtual millisecond it was first stored; kept across overwrites (s5.3 step 11.3). */
  readonly createdAt: number;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * Parse a cookie `Expires` value to an epoch millisecond.
 *
 * RFC 6265 s5.1.1 defines a parsing algorithm looser than HTTP-date because servers have
 * emitted every variant imaginable. The one still common in the wild is the dashed form
 * with a four-digit year -- `Wed, 21-Oct-2015 07:28:00 GMT` -- which is not an HTTP-date
 * at all, so it is normalised here before the strict parser sees it. A cookie whose date
 * fails to parse is treated as a session cookie rather than dropped (s5.2.1).
 */
export function parseCookieDate(value: string): ParseResult<number> {
  const direct = parseHttpDate(value);
  if (direct.ok) return direct;

  const dashed = /^([A-Za-z]+,\s*)(\d{1,2})-([A-Za-z]{3})-(\d{4})(\s.*)$/.exec(
    value.trim(),
  );
  if (dashed) {
    const day = dashed[2].padStart(2, '0');
    return parseHttpDate(
      `${dashed[1].trim()} ${day} ${dashed[3]} ${dashed[4]}${dashed[5]}`,
    );
  }
  return fail(`"${value}" is not a cookie date`);
}

// ---------------------------------------------------------------------------
// Parsing -- RFC 6265 s5.2
// ---------------------------------------------------------------------------

function parseSameSite(value: string): SameSite | undefined {
  switch (value.trim().toLowerCase()) {
    case 'strict':
      return 'Strict';
    case 'lax':
      return 'Lax';
    case 'none':
      return 'None';
    default:
      return undefined;
  }
}

/**
 * Parse one `Set-Cookie` field value.
 *
 * The algorithm is RFC 6265 s5.2, and its two rejections are worth knowing:
 *
 * - The name-value pair must contain a `=`. `Set-Cookie: flag` is not a cookie named
 *   `flag` with an empty value -- it is ignored entirely.
 * - A pair whose name *and* value are both empty is ignored.
 *
 * Everything else is forgiving by design: an unparseable attribute is skipped, not fatal,
 * because a cookie is too important to a session to throw away over a typo in `Path`.
 * Unrecognised attributes are collected in `unknown` so the wire view can still show them.
 */
export function parseSetCookie(field: string): ParseResult<SetCookieAttributes> {
  const semicolon = field.indexOf(';');
  const pair = (semicolon === -1 ? field : field.slice(0, semicolon)).trim();
  const rest = semicolon === -1 ? '' : field.slice(semicolon + 1);

  const equals = pair.indexOf('=');
  if (equals === -1) {
    return fail('a Set-Cookie name-value pair must contain "="');
  }
  const name = pair.slice(0, equals).trim();
  const value = pair.slice(equals + 1).trim();
  if (name === '' && value === '') {
    return fail('the cookie name and value are both empty');
  }

  let expires: number | undefined;
  let maxAge: number | undefined;
  let domain: string | undefined;
  let path: string | undefined;
  let secure = false;
  let httpOnly = false;
  let sameSite: SameSite | undefined;
  let partitioned = false;
  const unknown: { name: string; value: string }[] = [];

  for (const raw of rest.split(';')) {
    const attribute = raw.trim();
    if (attribute === '') continue;
    const split = attribute.indexOf('=');
    const attributeName = (split === -1 ? attribute : attribute.slice(0, split)).trim();
    const attributeValue = split === -1 ? '' : attribute.slice(split + 1).trim();

    switch (attributeName.toLowerCase()) {
      case 'expires': {
        const parsed = parseCookieDate(attributeValue);
        if (parsed.ok) expires = parsed.value;
        break;
      }
      case 'max-age': {
        // s5.2.2: the value must be a number, optionally negative. Anything else and the
        // attribute is ignored -- not read as zero, which would delete the cookie.
        if (/^-?\d+$/.test(attributeValue)) maxAge = Number(attributeValue);
        break;
      }
      case 'domain': {
        // s5.2.3: a leading dot is dropped. `.example.com` and `example.com` have meant
        // the same thing since RFC 6265 replaced the Netscape rules.
        const cleaned = attributeValue.replace(/^\./, '').toLowerCase();
        if (cleaned !== '') domain = cleaned;
        break;
      }
      case 'path': {
        // s5.2.4: a Path that is not absolute is ignored, and the default-path is used.
        if (attributeValue.startsWith('/')) path = attributeValue;
        break;
      }
      case 'secure':
        secure = true;
        break;
      case 'httponly':
        httpOnly = true;
        break;
      case 'samesite': {
        const parsed = parseSameSite(attributeValue);
        if (parsed !== undefined) sameSite = parsed;
        break;
      }
      case 'partitioned':
        partitioned = true;
        break;
      default:
        unknown.push({ name: attributeName, value: attributeValue });
    }
  }

  return ok({
    name,
    value,
    ...(expires === undefined ? {} : { expires }),
    ...(maxAge === undefined ? {} : { maxAge }),
    ...(domain === undefined ? {} : { domain }),
    ...(path === undefined ? {} : { path }),
    secure,
    httpOnly,
    ...(sameSite === undefined ? {} : { sameSite }),
    partitioned,
    unknown,
    raw: field,
  });
}

/** Every `Set-Cookie` on a response, in order -- never comma-joined (RFC 9110 s5.3). */
export function setCookieFields(headers: HeaderList): string[] {
  return headerValues(headers, 'Set-Cookie');
}

// ---------------------------------------------------------------------------
// Matching -- RFC 6265 s5.1
// ---------------------------------------------------------------------------

/** Whether a host looks like a literal address rather than a name. */
function isAddressLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

/**
 * Domain matching, RFC 6265 s5.1.3.
 *
 * `host` matches `domain` when they are equal, or when `domain` is a **dot-aligned
 * suffix** of `host`. The alignment is the rule that does the work: `evilexample.com`
 * does not match `example.com`, because the character before the suffix is `e` and not a
 * dot. Without that check, registering one domain would hand you every domain ending in
 * the same letters.
 *
 * An IP address only ever matches itself -- there is no hierarchy to walk up.
 */
export function domainMatches(host: string, domain: string): boolean {
  const lowerHost = host.toLowerCase();
  const lowerDomain = domain.toLowerCase();
  if (lowerHost === lowerDomain) return true;
  if (isAddressLiteral(lowerHost)) return false;
  if (!lowerHost.endsWith(lowerDomain)) return false;
  return lowerHost[lowerHost.length - lowerDomain.length - 1] === '.';
}

/**
 * Path matching, RFC 6265 s5.1.4.
 *
 * The cookie path must be a prefix of the request path *at a segment boundary*: either
 * the cookie path already ends in `/`, or the request path continues with one. So a
 * cookie on `/docs` reaches `/docs/api` and `/docs`, and does **not** reach `/docsearch`.
 */
export function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  if (cookiePath.endsWith('/')) return true;
  return requestPath[cookiePath.length] === '/';
}

/**
 * The default-path, RFC 6265 s5.1.4 -- the directory of the request, not the request.
 *
 * A cookie set by `/account/settings` with no `Path` defaults to `/account`, so it is
 * sent to the rest of the account pages and not to `/`. People assume the default is `/`
 * and are then surprised when the cookie vanishes one directory over.
 */
export function defaultPath(requestPath: string): string {
  if (requestPath === '' || !requestPath.startsWith('/')) return '/';
  const lastSlash = requestPath.lastIndexOf('/');
  if (lastSlash === 0) return '/';
  return requestPath.slice(0, lastSlash);
}

/**
 * A deliberately tiny stand-in for the Public Suffix List.
 *
 * The real list has thousands of entries and is a downloaded artefact; this covers the
 * suffixes the simulated origins use. Its job is to demonstrate the rule -- **no site may
 * set a cookie on a registry suffix** -- because without it, one page on `example.com`
 * could set a cookie with `Domain=com` and hand it to every other site on the internet.
 */
export const PUBLIC_SUFFIXES: readonly string[] = [
  'com',
  'net',
  'org',
  'edu',
  'gov',
  'io',
  'dev',
  'co.uk',
  'org.uk',
  'com.au',
];

/** Whether a domain is a registry suffix no one may set a cookie on. */
export function isPublicSuffix(domain: string): boolean {
  return PUBLIC_SUFFIXES.includes(domain.toLowerCase());
}

// ---------------------------------------------------------------------------
// Prefixes -- RFC 6265bis s4.1.3
// ---------------------------------------------------------------------------

/**
 * The two name prefixes that make a cookie's own attributes verifiable.
 *
 * A server receiving `Cookie: session=abc` cannot see which host set it, over which
 * scheme, or with what `Path` -- the request carries the name and value and nothing else.
 * A subdomain, or anyone who can write a plaintext response, can therefore plant a cookie
 * the real site will read as its own. The prefixes fix that by moving the guarantee into
 * the name, which *is* sent back:
 *
 * - **`__Secure-`** -- must be set with `Secure`, over a secure channel.
 * - **`__Host-`** -- must be set with `Secure`, over a secure channel, with **no
 *   `Domain`** (so it is host-only) and `Path=/`. This is the one that stops
 *   `evil.example.com` writing a session cookie for `example.com`.
 */
export type CookiePrefix = '__Secure-' | '__Host-';

/** Which prefix a cookie name carries, if any. */
export function cookiePrefix(name: string): CookiePrefix | undefined {
  if (name.startsWith('__Host-')) return '__Host-';
  if (name.startsWith('__Secure-')) return '__Secure-';
  return undefined;
}

// ---------------------------------------------------------------------------
// The jar
// ---------------------------------------------------------------------------

/** The jar: cookies, in the order they were first stored. Immutable, like every store. */
export interface CookieJar {
  readonly cookies: readonly Cookie[];
}

/** An empty jar -- a fresh browser profile. */
export function createJar(): CookieJar {
  return { cookies: [] };
}

/** Where a `Set-Cookie` arrived from, which is most of what decides whether it is kept. */
export interface CookieContext {
  /** The host the response came from. */
  readonly host: string;
  /** The path of the request that produced it. */
  readonly path: string;
  /** Whether the exchange was over HTTPS. `Secure` cookies need this. */
  readonly secureChannel: boolean;
  /** Virtual millisecond the response arrived. */
  readonly now: number;
  /**
   * False when the cookie is being set by script (`document.cookie`) rather than by a
   * response. Script may not set `HttpOnly`, and may not overwrite a cookie that has it.
   */
  readonly fromHttpApi?: boolean;
  readonly clock?: HttpClock;
}

/** What the jar did with a `Set-Cookie`, and why. */
export interface CookieStoreResult {
  readonly jar: CookieJar;
  readonly accepted: boolean;
  /** The cookie as stored, when it was. */
  readonly cookie?: Cookie;
  /** The rule that decided it, phrased for either answer. */
  readonly reason: string;
  /** True when the cookie was accepted *and* immediately removed by a past expiry. */
  readonly deleted: boolean;
}

function sameCookie(a: Cookie, b: Cookie): boolean {
  return a.name === b.name && a.domain === b.domain && a.path === b.path;
}

/**
 * Apply one `Set-Cookie` to the jar.
 *
 * This is the storage model of RFC 6265 s5.3 with the RFC 6265bis additions, in order.
 * The checks that reject rather than default are the interesting ones:
 *
 * - a `Domain` the response's own host does not domain-match (**a site may narrow a
 *   cookie's scope, never widen it to someone else's**);
 * - a `Domain` that is a public suffix;
 * - `Secure` set over a plaintext channel;
 * - `SameSite=None` without `Secure`;
 * - a `__Secure-` or `__Host-` name whose attributes do not back the promise;
 * - `HttpOnly` from script, or script overwriting an `HttpOnly` cookie.
 *
 * **Deleting a cookie is not a separate operation.** A `Set-Cookie` with `Max-Age=0` or a
 * past `Expires` is accepted, stored, and then removed for having already expired -- so
 * `Set-Cookie: session=; Max-Age=0` is how a logout works, and why a logout that forgets
 * to match the original `Path` and `Domain` leaves the session cookie sitting there.
 */
export function storeCookie(
  jar: CookieJar,
  field: string,
  context: CookieContext,
): CookieStoreResult {
  const clock = context.clock ?? EPOCH_CLOCK;
  const fromHttpApi = context.fromHttpApi ?? true;
  const reject = (reason: string): CookieStoreResult => ({
    jar,
    accepted: false,
    reason,
    deleted: false,
  });

  const parsed = parseSetCookie(field);
  if (!parsed.ok) return reject(parsed.error);
  const attributes = parsed.value;

  if (!fromHttpApi && attributes.httpOnly) {
    return reject('script may not set an HttpOnly cookie');
  }

  // s5.3 step 3: Max-Age wins over Expires wherever both are present.
  let expiresAt: number | undefined;
  if (attributes.maxAge !== undefined) {
    expiresAt = context.now + attributes.maxAge * 1000;
  } else if (attributes.expires !== undefined) {
    expiresAt = toVirtual(clock, attributes.expires);
  }

  const host = context.host.toLowerCase();
  let domain = host;
  let hostOnly = true;
  if (attributes.domain !== undefined) {
    if (isPublicSuffix(attributes.domain)) {
      return reject(
        `Domain=${attributes.domain} is a public suffix -- no site may set a cookie there`,
      );
    }
    if (!domainMatches(host, attributes.domain)) {
      return reject(
        `Domain=${attributes.domain} does not cover ${host}: a response may narrow a ` +
          'cookie to its own domain, never widen it to another',
      );
    }
    domain = attributes.domain;
    hostOnly = false;
  }

  const path = attributes.path ?? defaultPath(context.path);

  if (attributes.secure && !context.secureChannel) {
    return reject('a Secure cookie may only be set over HTTPS');
  }
  if (attributes.sameSite === 'None' && !attributes.secure) {
    return reject('SameSite=None requires Secure');
  }

  const prefix = cookiePrefix(attributes.name);
  if (prefix !== undefined) {
    if (!attributes.secure || !context.secureChannel) {
      return reject(`${prefix} cookies must be set with Secure, over HTTPS`);
    }
    if (prefix === '__Host-') {
      if (!hostOnly) {
        return reject('__Host- cookies must not carry a Domain attribute');
      }
      if (path !== '/') {
        return reject('__Host- cookies must be set with Path=/');
      }
    }
  }

  const existing = jar.cookies.find(
    (candidate) =>
      candidate.name === attributes.name &&
      candidate.domain === domain &&
      candidate.path === path,
  );
  if (existing?.httpOnly && !fromHttpApi) {
    return reject('script may not overwrite an HttpOnly cookie');
  }

  const cookie: Cookie = {
    name: attributes.name,
    value: attributes.value,
    domain,
    hostOnly,
    path,
    ...(expiresAt === undefined ? {} : { expiresAt }),
    secure: attributes.secure,
    httpOnly: attributes.httpOnly,
    sameSite: attributes.sameSite ?? DEFAULT_SAME_SITE,
    sameSiteExplicit: attributes.sameSite !== undefined,
    partitioned: attributes.partitioned,
    // s5.3 step 11.3: an overwrite keeps the original creation time, so the send order
    // in s5.4 does not shuffle every time a session cookie is refreshed.
    createdAt: existing?.createdAt ?? context.now,
  };

  const withoutOld = jar.cookies.filter((candidate) => !sameCookie(candidate, cookie));
  const alreadyExpired = expiresAt !== undefined && expiresAt <= context.now;

  if (alreadyExpired) {
    return {
      jar: { cookies: withoutOld },
      accepted: true,
      cookie,
      reason:
        'the expiry is in the past, so the cookie is stored and immediately removed -- ' +
        'this is how a cookie is deleted',
      deleted: true,
    };
  }

  // Position is kept on an overwrite so the jar panel does not reorder under the reader.
  const index = jar.cookies.findIndex((candidate) => sameCookie(candidate, cookie));
  const cookies =
    index === -1
      ? [...jar.cookies, cookie]
      : jar.cookies.map((candidate, i) => (i === index ? cookie : candidate));

  return {
    jar: { cookies },
    accepted: true,
    cookie,
    reason: hostOnly
      ? `stored for ${domain} only (host-only), path ${path}`
      : `stored for ${domain} and its subdomains, path ${path}`,
    deleted: false,
  };
}

/** Apply every `Set-Cookie` on a response, in order. */
export function storeSetCookies(
  jar: CookieJar,
  headers: HeaderList,
  context: CookieContext,
): { jar: CookieJar; results: CookieStoreResult[] } {
  let current = jar;
  const results: CookieStoreResult[] = [];
  for (const field of setCookieFields(headers)) {
    const result = storeCookie(current, field, context);
    current = result.jar;
    results.push(result);
  }
  return { jar: current, results };
}

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------

/** Whether a cookie's expiry has passed. Session cookies never expire on the clock. */
export function isExpired(cookie: Cookie, now: number): boolean {
  return cookie.expiresAt !== undefined && cookie.expiresAt <= now;
}

/** Drop everything that has expired. */
export function purgeExpired(jar: CookieJar, now: number): CookieJar {
  const cookies = jar.cookies.filter((cookie) => !isExpired(cookie, now));
  return cookies.length === jar.cookies.length ? jar : { cookies };
}

/**
 * Drop the session cookies -- what closing the browser does.
 *
 * A cookie with neither `Expires` nor `Max-Age` lives only as long as the browser
 * session. That is the difference between "remember me" and not, and it is expressed by
 * the *absence* of two attributes rather than the presence of any.
 */
export function clearSessionCookies(jar: CookieJar): CookieJar {
  return { cookies: jar.cookies.filter((cookie) => cookie.expiresAt !== undefined) };
}

// ---------------------------------------------------------------------------
// SameSite
// ---------------------------------------------------------------------------

/** How a request relates to the site whose cookies are being considered. */
export interface RequestContext {
  readonly host: string;
  readonly path: string;
  readonly secureChannel: boolean;
  readonly method: HttpMethod;
  /** Whether the initiating page is on the same site as the target. */
  readonly sameSite: boolean;
  /**
   * Whether this request is the browser navigating the top-level window -- clicking a
   * link -- rather than a subresource load, a form post, or `fetch`.
   */
  readonly topLevelNavigation: boolean;
  /** False for `document.cookie`; `HttpOnly` cookies are invisible to it. */
  readonly fromHttpApi?: boolean;
  readonly now: number;
}

/**
 * Whether `SameSite` lets this cookie travel on this request (RFC 6265bis s5.4.7).
 *
 * - **`Strict`** -- same-site only. Even following a link from another site arrives
 *   logged out, which is correct and is also why few sites use it for the session cookie.
 * - **`Lax`** -- same-site, plus cross-site **top-level navigation with a safe method**.
 *   Clicking a link brings the cookie; a cross-site form POST or a background `fetch`
 *   does not. That is CSRF's main path closed, with links still working.
 * - **`None`** -- always, and only legal with `Secure`.
 */
export function sameSiteAllows(cookie: Cookie, context: RequestContext): boolean {
  if (context.sameSite) return true;
  switch (cookie.sameSite) {
    case 'None':
      return true;
    case 'Strict':
      return false;
    case 'Lax':
      return context.topLevelNavigation && isSafe(context.method);
  }
}

// ---------------------------------------------------------------------------
// Retrieval -- RFC 6265 s5.4
// ---------------------------------------------------------------------------

/** A cookie the jar declined to send, with the rule that stopped it. */
export interface CookieExclusion {
  readonly cookie: Cookie;
  readonly reason: string;
}

/** What the jar would attach to a request, and what it held back. */
export interface CookieSelection {
  readonly cookies: readonly Cookie[];
  readonly excluded: readonly CookieExclusion[];
}

/**
 * Which cookies go on this request, in the order the `Cookie` field lists them.
 *
 * Every rule in this module meets here. The exclusions are returned alongside the matches
 * rather than discarded, because "why was my cookie not sent?" is the question the jar
 * panel exists to answer, and the answer is always one of these lines.
 *
 * The order is RFC 6265 s5.4 step 2: **longer paths first**, and among equal-length paths
 * the older cookie first. Servers should not depend on it -- but they do, and a jar that
 * ordered differently would produce a different `Cookie` field for the same state.
 */
export function cookiesFor(jar: CookieJar, context: RequestContext): CookieSelection {
  const fromHttpApi = context.fromHttpApi ?? true;
  const host = context.host.toLowerCase();
  const cookies: Cookie[] = [];
  const excluded: CookieExclusion[] = [];

  for (const cookie of jar.cookies) {
    const skip = (reason: string) => excluded.push({ cookie, reason });

    if (isExpired(cookie, context.now)) {
      skip('expired');
      continue;
    }
    const domainOk = cookie.hostOnly
      ? host === cookie.domain
      : domainMatches(host, cookie.domain);
    if (!domainOk) {
      skip(
        cookie.hostOnly
          ? `host-only cookie for ${cookie.domain}; this request went to ${host}`
          : `domain ${cookie.domain} does not cover ${host}`,
      );
      continue;
    }
    if (!pathMatches(context.path, cookie.path)) {
      skip(`path ${cookie.path} does not cover ${context.path}`);
      continue;
    }
    if (cookie.secure && !context.secureChannel) {
      skip('Secure: never sent over plaintext HTTP');
      continue;
    }
    if (cookie.httpOnly && !fromHttpApi) {
      skip('HttpOnly: invisible to document.cookie, so script cannot read or steal it');
      continue;
    }
    if (!sameSiteAllows(cookie, context)) {
      skip(
        `SameSite=${cookie.sameSite}: withheld from a cross-site ` +
          (context.topLevelNavigation ? 'navigation' : 'subresource request'),
      );
      continue;
    }
    cookies.push(cookie);
  }

  cookies.sort((a, b) =>
    b.path.length !== a.path.length
      ? b.path.length - a.path.length
      : a.createdAt - b.createdAt,
  );

  return { cookies, excluded };
}

/** The `Cookie` field value: `a=1; b=2`. Empty when nothing matched. */
export function cookieHeaderValue(cookies: readonly Cookie[]): string {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

/**
 * Parse a `Cookie` request field back into pairs.
 *
 * Note what is *not* here: no domain, no path, no `Secure`, no `SameSite`. The request
 * carries names and values and nothing else, which is exactly why {@link cookiePrefix}
 * had to be invented -- the only attribute a server can verify is the one written into
 * the name.
 */
export function parseCookieHeader(value: string): { name: string; value: string }[] {
  return value
    .split(';')
    .map((pair) => pair.trim())
    .filter((pair) => pair !== '')
    .map((pair) => {
      const equals = pair.indexOf('=');
      return equals === -1
        ? { name: pair, value: '' }
        : { name: pair.slice(0, equals).trim(), value: pair.slice(equals + 1).trim() };
    });
}

/** What script would see in `document.cookie` -- the same jar minus the HttpOnly ones. */
export function scriptVisibleCookies(
  jar: CookieJar,
  context: RequestContext,
): CookieSelection {
  return cookiesFor(jar, { ...context, fromHttpApi: false });
}

// ---------------------------------------------------------------------------
// What each attribute is for
// ---------------------------------------------------------------------------

/**
 * The attribute-to-attack table, as data.
 *
 * Exported rather than written into a component so the cookie panel, the header
 * explainer, and the learning centre all cite the same sentences, and so a test can hold
 * every attribute the parser understands to having an entry here.
 */
export const COOKIE_DEFENCES: readonly {
  readonly attribute: string;
  readonly stops: string;
  readonly how: string;
  readonly withoutIt: string;
  readonly rfc: string;
}[] = [
  {
    attribute: 'HttpOnly',
    stops: 'Session theft via XSS',
    how: 'The cookie is invisible to document.cookie; only the browser attaches it.',
    withoutIt:
      'One injected script reads the session cookie and posts it to an attacker, who is ' +
      'then logged in as the user from anywhere.',
    rfc: 'RFC 6265 s4.1.2.6',
  },
  {
    attribute: 'SameSite',
    stops: 'Cross-site request forgery',
    how: 'The cookie is withheld from cross-site requests -- entirely for Strict, and for everything but a safe top-level navigation for Lax.',
    withoutIt:
      "Another site's page can make an authenticated request with the user's session " +
      'simply by causing the browser to send one.',
    rfc: 'RFC 6265bis s5.4.7',
  },
  {
    attribute: 'Secure',
    stops: 'The cookie leaking in plaintext',
    how: 'The browser refuses to send it over http:// at all.',
    withoutIt:
      'A single plaintext request -- one http:// link, one downgraded redirect -- puts ' +
      'the session on the wire for anyone on the path to read.',
    rfc: 'RFC 6265 s4.1.2.5',
  },
  {
    attribute: 'Domain',
    stops: 'Over-sharing between subdomains',
    how: 'Omitting it makes the cookie host-only. Setting it widens the cookie to every subdomain.',
    withoutIt:
      'Domain=example.com sends the session to every subdomain, including whichever one ' +
      'is running someone else "just a static site".',
    rfc: 'RFC 6265 s5.1.3',
  },
  {
    attribute: 'Path',
    stops: 'Nothing, on its own',
    how: 'It scopes where the cookie is sent, but same-origin script can read across paths anyway.',
    withoutIt:
      'Worth knowing so it is not mistaken for a boundary: Path is organisation, not ' +
      'isolation.',
    rfc: 'RFC 6265 s5.1.4',
  },
  {
    attribute: '__Host- prefix',
    stops: 'Session fixation from a sibling subdomain',
    how: 'Forces Secure, host-only, and Path=/, and the guarantee travels in the name, which is the only part the server gets back.',
    withoutIt:
      'evil.example.com can set a cookie that www.example.com reads as its own, and the ' +
      'server cannot tell the difference.',
    rfc: 'RFC 6265bis s4.1.3',
  },
];
