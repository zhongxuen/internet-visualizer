import { describe, expect, it } from 'vitest';

import { formatHttpDate, header, response } from './message';
import {
  clearSessionCookies,
  COOKIE_DEFENCES,
  cookieHeaderValue,
  cookiePrefix,
  cookiesFor,
  createJar,
  DEFAULT_SAME_SITE,
  defaultPath,
  domainMatches,
  isExpired,
  isPublicSuffix,
  parseCookieDate,
  parseCookieHeader,
  parseSetCookie,
  pathMatches,
  purgeExpired,
  sameSiteAllows,
  scriptVisibleCookies,
  setCookieFields,
  storeCookie,
  storeSetCookies,
  type Cookie,
  type CookieContext,
  type CookieJar,
  type RequestContext,
} from './cookies';

const SECOND = 1000;

function ctx(over: Partial<CookieContext> = {}): CookieContext {
  return { host: 'example.com', path: '/', secureChannel: true, now: 0, ...over };
}

function reqCtx(over: Partial<RequestContext> = {}): RequestContext {
  return {
    host: 'example.com',
    path: '/',
    secureChannel: true,
    method: 'GET',
    sameSite: true,
    topLevelNavigation: true,
    now: 0,
    ...over,
  };
}

/** Store a run of Set-Cookie fields and hand back the jar. */
function jarOf(fields: string[], context: Partial<CookieContext> = {}): CookieJar {
  let jar = createJar();
  for (const field of fields) {
    jar = storeCookie(jar, field, ctx(context)).jar;
  }
  return jar;
}

function names(cookies: readonly Cookie[]): string[] {
  return cookies.map((cookie) => cookie.name);
}

// ---------------------------------------------------------------------------

describe('parsing Set-Cookie (RFC 6265 s5.2)', () => {
  it('reads the name-value pair', () => {
    const parsed = parseSetCookie('session=abc123');
    expect(parsed).toMatchObject({
      ok: true,
      value: { name: 'session', value: 'abc123', secure: false, httpOnly: false },
    });
  });

  it('reads every attribute it understands', () => {
    const parsed = parseSetCookie(
      'id=1; Domain=.Example.COM; Path=/app; Max-Age=3600; Secure; HttpOnly; ' +
        'SameSite=Lax; Partitioned',
    );
    expect(parsed.ok && parsed.value).toMatchObject({
      domain: 'example.com',
      path: '/app',
      maxAge: 3600,
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
      partitioned: true,
    });
  });

  it('strips a leading dot from Domain -- .example.com and example.com are one thing', () => {
    const parsed = parseSetCookie('a=1; Domain=.example.com');
    expect(parsed.ok && parsed.value.domain).toBe('example.com');
  });

  it('ignores a pair with no "=" entirely', () => {
    expect(parseSetCookie('flag').ok).toBe(false);
  });

  it('ignores a pair whose name and value are both empty', () => {
    expect(parseSetCookie('=').ok).toBe(false);
    expect(parseSetCookie('=value').ok).toBe(true);
  });

  it('drops an unparseable attribute rather than the whole cookie', () => {
    const parsed = parseSetCookie('a=1; Max-Age=soon; Path=relative; SameSite=Sideways');
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.value).toMatchObject({ name: 'a', value: '1' });
    expect(parsed.ok && parsed.value.maxAge).toBeUndefined();
    expect(parsed.ok && parsed.value.path).toBeUndefined();
    expect(parsed.ok && parsed.value.sameSite).toBeUndefined();
  });

  it('keeps attributes it does not know, so the wire view can still show them', () => {
    const parsed = parseSetCookie('a=1; Priority=High');
    expect(parsed.ok && parsed.value.unknown).toEqual([
      { name: 'Priority', value: 'High' },
    ]);
  });

  it('reads every Set-Cookie separately -- they are never comma-joined', () => {
    const headers = response({
      status: 200,
      headers: [header('Set-Cookie', 'a=1'), header('Set-Cookie', 'b=2')],
    }).headers;
    expect(setCookieFields(headers)).toEqual(['a=1', 'b=2']);
  });
});

describe('cookie dates', () => {
  const EPOCH = Date.UTC(2015, 9, 21, 7, 28, 0);

  it('parses an ordinary HTTP-date', () => {
    expect(parseCookieDate('Wed, 21 Oct 2015 07:28:00 GMT')).toEqual({
      ok: true,
      value: EPOCH,
    });
  });

  it('also parses the dashed four-digit-year form servers still emit', () => {
    expect(parseCookieDate('Wed, 21-Oct-2015 07:28:00 GMT')).toEqual({
      ok: true,
      value: EPOCH,
    });
  });

  it('rejects something that is not a date at all', () => {
    expect(parseCookieDate('never').ok).toBe(false);
  });
});

describe('domain matching (RFC 6265 s5.1.3)', () => {
  it('matches a host against itself', () => {
    expect(domainMatches('example.com', 'example.com')).toBe(true);
    expect(domainMatches('EXAMPLE.com', 'example.COM')).toBe(true);
  });

  it('matches a subdomain against its parent', () => {
    expect(domainMatches('www.example.com', 'example.com')).toBe(true);
    expect(domainMatches('a.b.example.com', 'example.com')).toBe(true);
  });

  it('requires the suffix to start at a dot -- evilexample.com is not example.com', () => {
    expect(domainMatches('evilexample.com', 'example.com')).toBe(false);
    expect(domainMatches('notexample.com', 'example.com')).toBe(false);
  });

  it('does not match upwards', () => {
    expect(domainMatches('example.com', 'www.example.com')).toBe(false);
  });

  it('lets an address literal match only itself', () => {
    expect(domainMatches('192.0.2.1', '192.0.2.1')).toBe(true);
    expect(domainMatches('192.0.2.1', '0.2.1')).toBe(false);
  });
});

describe('path matching (RFC 6265 s5.1.4)', () => {
  it('matches an identical path', () => {
    expect(pathMatches('/docs', '/docs')).toBe(true);
  });

  it('matches a prefix at a segment boundary', () => {
    expect(pathMatches('/docs/api', '/docs')).toBe(true);
    expect(pathMatches('/docs/api', '/docs/')).toBe(true);
    expect(pathMatches('/anything', '/')).toBe(true);
  });

  it('does not match a prefix that stops mid-segment', () => {
    expect(pathMatches('/docsearch', '/docs')).toBe(false);
  });

  it('does not match upwards', () => {
    expect(pathMatches('/docs', '/docs/api')).toBe(false);
  });
});

describe('the default path', () => {
  it('is the directory of the request, not the request', () => {
    expect(defaultPath('/account/settings')).toBe('/account');
    expect(defaultPath('/a/b/c')).toBe('/a/b');
  });

  it('is / for anything at the root', () => {
    expect(defaultPath('/index.html')).toBe('/');
    expect(defaultPath('/')).toBe('/');
  });

  it('is / for an empty or relative path', () => {
    expect(defaultPath('')).toBe('/');
    expect(defaultPath('relative')).toBe('/');
  });
});

describe('storing a cookie', () => {
  it('defaults to host-only, so it never reaches a subdomain', () => {
    const result = storeCookie(createJar(), 'session=abc', ctx());
    expect(result.accepted).toBe(true);
    expect(result.cookie).toMatchObject({
      domain: 'example.com',
      hostOnly: true,
      path: '/',
    });
  });

  it('widens to the subdomains when a Domain attribute is sent', () => {
    const result = storeCookie(
      createJar(),
      'session=abc; Domain=example.com',
      ctx({ host: 'www.example.com' }),
    );
    expect(result.cookie).toMatchObject({ domain: 'example.com', hostOnly: false });
  });

  it('defaults the path to the directory of the request', () => {
    const result = storeCookie(createJar(), 'a=1', ctx({ path: '/account/settings' }));
    expect(result.cookie?.path).toBe('/account');
  });

  it('defaults SameSite to Lax and records that it was a default', () => {
    const result = storeCookie(createJar(), 'a=1', ctx());
    expect(result.cookie).toMatchObject({
      sameSite: DEFAULT_SAME_SITE,
      sameSiteExplicit: false,
    });
    expect(DEFAULT_SAME_SITE).toBe('Lax');
  });

  it('refuses a Domain the response host does not itself sit under', () => {
    const result = storeCookie(createJar(), 'a=1; Domain=other.com', ctx());
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain('does not cover');
  });

  it('refuses a Domain that is a public suffix', () => {
    expect(isPublicSuffix('com')).toBe(true);
    const result = storeCookie(createJar(), 'a=1; Domain=com', ctx());
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain('public suffix');
  });

  it('refuses a Secure cookie set over plaintext', () => {
    const result = storeCookie(createJar(), 'a=1; Secure', ctx({ secureChannel: false }));
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain('HTTPS');
  });

  it('refuses SameSite=None without Secure', () => {
    expect(storeCookie(createJar(), 'a=1; SameSite=None', ctx()).accepted).toBe(false);
    expect(storeCookie(createJar(), 'a=1; SameSite=None; Secure', ctx()).accepted).toBe(
      true,
    );
  });

  it('will not let script set an HttpOnly cookie', () => {
    const result = storeCookie(createJar(), 'a=1; HttpOnly', ctx({ fromHttpApi: false }));
    expect(result.accepted).toBe(false);
  });

  it('will not let script overwrite an HttpOnly cookie', () => {
    const jar = jarOf(['sid=1; HttpOnly']);
    const result = storeCookie(jar, 'sid=2', ctx({ fromHttpApi: false }));
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain('HttpOnly');
    expect(jar.cookies[0].value).toBe('1');
  });
});

describe('the cookie name prefixes', () => {
  it('recognises both prefixes', () => {
    expect(cookiePrefix('__Host-id')).toBe('__Host-');
    expect(cookiePrefix('__Secure-id')).toBe('__Secure-');
    expect(cookiePrefix('id')).toBeUndefined();
  });

  it('requires __Secure- cookies to be set with Secure, over HTTPS', () => {
    expect(storeCookie(createJar(), '__Secure-id=1', ctx()).accepted).toBe(false);
    expect(
      storeCookie(createJar(), '__Secure-id=1; Secure', ctx({ secureChannel: false }))
        .accepted,
    ).toBe(false);
    expect(storeCookie(createJar(), '__Secure-id=1; Secure', ctx()).accepted).toBe(true);
  });

  it('requires __Host- cookies to be host-only with Path=/', () => {
    expect(
      storeCookie(createJar(), '__Host-id=1; Secure; Path=/; Domain=example.com', ctx())
        .reason,
    ).toContain('Domain');
    expect(
      storeCookie(createJar(), '__Host-id=1; Secure; Path=/app', ctx()).reason,
    ).toContain('Path=/');

    const good = storeCookie(createJar(), '__Host-id=1; Secure; Path=/', ctx());
    expect(good.accepted).toBe(true);
    expect(good.cookie).toMatchObject({ hostOnly: true, path: '/' });
  });
});

describe('expiry', () => {
  it('lets Max-Age win over Expires', () => {
    const result = storeCookie(
      createJar(),
      `a=1; Max-Age=60; Expires=${formatHttpDate(10_000 * SECOND)}`,
      ctx({ now: 0 }),
    );
    expect(result.cookie?.expiresAt).toBe(60 * SECOND);
  });

  it('reads Expires as an absolute instant on the simulation clock', () => {
    const result = storeCookie(
      createJar(),
      `a=1; Expires=${formatHttpDate(10_000 * SECOND)}`,
      ctx({ now: 0 }),
    );
    expect(result.cookie?.expiresAt).toBe(10_000 * SECOND);
  });

  it('leaves a cookie with neither attribute as a session cookie', () => {
    expect(storeCookie(createJar(), 'a=1', ctx()).cookie?.expiresAt).toBeUndefined();
  });

  it('deletes a cookie via Max-Age=0 -- the logout mechanism', () => {
    const jar = jarOf(['sid=abc']);
    expect(jar.cookies).toHaveLength(1);

    const result = storeCookie(jar, 'sid=; Max-Age=0', ctx({ now: 10 * SECOND }));
    expect(result.accepted).toBe(true);
    expect(result.deleted).toBe(true);
    expect(result.jar.cookies).toHaveLength(0);
  });

  it('leaves the cookie in place when the deletion misses the Path', () => {
    const jar = jarOf(['sid=abc; Path=/app']);
    const result = storeCookie(jar, 'sid=; Max-Age=0; Path=/', ctx());
    expect(result.jar.cookies).toHaveLength(1);
    expect(result.jar.cookies[0].path).toBe('/app');
  });

  it('drops expired cookies and keeps session ones on a purge', () => {
    const jar = jarOf(['a=1; Max-Age=10', 'b=2']);
    expect(names(purgeExpired(jar, 5 * SECOND).cookies)).toEqual(['a', 'b']);
    expect(names(purgeExpired(jar, 20 * SECOND).cookies)).toEqual(['b']);
    expect(isExpired(jar.cookies[0], 20 * SECOND)).toBe(true);
    expect(isExpired(jar.cookies[1], 20 * SECOND)).toBe(false);
  });

  it('drops exactly the session cookies when the browser closes', () => {
    const jar = jarOf(['persistent=1; Max-Age=99999', 'session=2']);
    expect(names(clearSessionCookies(jar).cookies)).toEqual(['persistent']);
  });
});

describe('overwriting', () => {
  it('replaces a cookie with the same name, domain, and path', () => {
    const jar = jarOf(['a=1', 'a=2']);
    expect(jar.cookies).toHaveLength(1);
    expect(jar.cookies[0].value).toBe('2');
  });

  it('treats a different path as a different cookie', () => {
    const jar = jarOf(['a=1; Path=/', 'a=2; Path=/app']);
    expect(jar.cookies).toHaveLength(2);
  });

  it('keeps the original creation time and position on an overwrite', () => {
    let jar = storeCookie(createJar(), 'a=1', ctx({ now: 0 })).jar;
    jar = storeCookie(jar, 'b=1', ctx({ now: SECOND })).jar;
    jar = storeCookie(jar, 'a=2', ctx({ now: 5 * SECOND })).jar;

    expect(names(jar.cookies)).toEqual(['a', 'b']);
    expect(jar.cookies[0]).toMatchObject({ value: '2', createdAt: 0 });
  });
});

describe('SameSite', () => {
  const strict = jarOf(['s=1; SameSite=Strict']).cookies[0];
  const lax = jarOf(['l=1; SameSite=Lax']).cookies[0];
  const none = jarOf(['n=1; SameSite=None; Secure']).cookies[0];

  it('sends everything on a same-site request', () => {
    const same = reqCtx({ sameSite: true });
    expect([strict, lax, none].every((c) => sameSiteAllows(c, same))).toBe(true);
  });

  it('withholds Strict from every cross-site request, links included', () => {
    expect(
      sameSiteAllows(strict, reqCtx({ sameSite: false, topLevelNavigation: true })),
    ).toBe(false);
  });

  it('lets Lax through on a cross-site top-level navigation with a safe method', () => {
    expect(
      sameSiteAllows(lax, reqCtx({ sameSite: false, topLevelNavigation: true })),
    ).toBe(true);
  });

  it('withholds Lax from a cross-site POST -- this is CSRF closed', () => {
    expect(
      sameSiteAllows(
        lax,
        reqCtx({ sameSite: false, topLevelNavigation: true, method: 'POST' }),
      ),
    ).toBe(false);
  });

  it('withholds Lax from a cross-site subresource or fetch', () => {
    expect(
      sameSiteAllows(lax, reqCtx({ sameSite: false, topLevelNavigation: false })),
    ).toBe(false);
  });

  it('sends None everywhere', () => {
    expect(
      sameSiteAllows(
        none,
        reqCtx({ sameSite: false, topLevelNavigation: false, method: 'POST' }),
      ),
    ).toBe(true);
  });
});

describe('choosing what to send', () => {
  it('sends a host-only cookie to that host and to no subdomain of it', () => {
    const jar = jarOf(['a=1'], { host: 'example.com' });
    expect(names(cookiesFor(jar, reqCtx({ host: 'example.com' })).cookies)).toEqual([
      'a',
    ]);

    const missed = cookiesFor(jar, reqCtx({ host: 'www.example.com' }));
    expect(missed.cookies).toHaveLength(0);
    expect(missed.excluded[0].reason).toContain('host-only');
  });

  it('sends a Domain cookie to every subdomain under it', () => {
    const jar = jarOf(['a=1; Domain=example.com'], { host: 'example.com' });
    expect(names(cookiesFor(jar, reqCtx({ host: 'shop.example.com' })).cookies)).toEqual([
      'a',
    ]);
    expect(cookiesFor(jar, reqCtx({ host: 'evilexample.com' })).cookies).toHaveLength(0);
  });

  it('applies path matching and says which path failed', () => {
    const jar = jarOf(['a=1; Path=/app']);
    expect(names(cookiesFor(jar, reqCtx({ path: '/app/settings' })).cookies)).toEqual([
      'a',
    ]);

    const missed = cookiesFor(jar, reqCtx({ path: '/apple' }));
    expect(missed.cookies).toHaveLength(0);
    expect(missed.excluded[0].reason).toContain('/app');
  });

  it('never puts a Secure cookie on a plaintext request', () => {
    const jar = jarOf(['a=1; Secure']);
    const missed = cookiesFor(jar, reqCtx({ secureChannel: false }));
    expect(missed.cookies).toHaveLength(0);
    expect(missed.excluded[0].reason).toContain('Secure');
  });

  it('hides an HttpOnly cookie from script but still sends it on the request', () => {
    const jar = jarOf(['sid=secret; HttpOnly', 'theme=dark']);
    expect(names(cookiesFor(jar, reqCtx()).cookies)).toEqual(['sid', 'theme']);

    const visible = scriptVisibleCookies(jar, reqCtx());
    expect(names(visible.cookies)).toEqual(['theme']);
    expect(visible.excluded[0].reason).toContain('document.cookie');
  });

  it('drops an expired cookie at send time', () => {
    const jar = jarOf(['a=1; Max-Age=10']);
    const missed = cookiesFor(jar, reqCtx({ now: 30 * SECOND }));
    expect(missed.cookies).toHaveLength(0);
    expect(missed.excluded[0].reason).toBe('expired');
  });

  it('withholds a cross-site cookie and says which SameSite value did it', () => {
    const jar = jarOf(['s=1; SameSite=Strict']);
    const missed = cookiesFor(jar, reqCtx({ sameSite: false }));
    expect(missed.cookies).toHaveLength(0);
    expect(missed.excluded[0].reason).toContain('SameSite=Strict');
  });

  it('orders by longest path first, then by creation time', () => {
    let jar = createJar();
    jar = storeCookie(jar, 'root=1; Path=/', ctx({ now: 0 })).jar;
    jar = storeCookie(jar, 'deep=1; Path=/a/b', ctx({ now: SECOND })).jar;
    jar = storeCookie(jar, 'mid=1; Path=/a', ctx({ now: 2 * SECOND })).jar;
    jar = storeCookie(jar, 'later=1; Path=/', ctx({ now: 3 * SECOND })).jar;

    expect(names(cookiesFor(jar, reqCtx({ path: '/a/b' })).cookies)).toEqual([
      'deep',
      'mid',
      'root',
      'later',
    ]);
  });

  it('renders the Cookie field, and reads it back as names and values only', () => {
    const jar = jarOf(['a=1', 'b=2']);
    const value = cookieHeaderValue(cookiesFor(jar, reqCtx()).cookies);
    expect(value).toBe('a=1; b=2');
    expect(parseCookieHeader(value)).toEqual([
      { name: 'a', value: '1' },
      { name: 'b', value: '2' },
    ]);
    expect(cookieHeaderValue([])).toBe('');
  });
});

describe('a login, as the scenario runs it', () => {
  it('stores the session from the response and sends it on the next request', () => {
    const loginResponse = response({
      status: 200,
      reason: 'OK',
      headers: [
        header('Set-Cookie', 'sid=s3cr3t; Path=/; HttpOnly; Secure; SameSite=Lax'),
        header('Set-Cookie', 'theme=dark; Path=/; Max-Age=31536000'),
      ],
    });

    const { jar, results } = storeSetCookies(createJar(), loginResponse.headers, ctx());
    expect(results.every((result) => result.accepted)).toBe(true);
    expect(names(jar.cookies)).toEqual(['sid', 'theme']);

    const next = cookiesFor(jar, reqCtx({ path: '/account' }));
    expect(cookieHeaderValue(next.cookies)).toBe('sid=s3cr3t; theme=dark');

    // The session survives an XSS read and a cross-site POST; the theme cookie does not
    // need to, and does not.
    expect(names(scriptVisibleCookies(jar, reqCtx()).cookies)).toEqual(['theme']);
    expect(
      names(
        cookiesFor(jar, reqCtx({ sameSite: false, topLevelNavigation: false })).cookies,
      ),
    ).toEqual([]);
  });
});

describe('what each attribute defends against', () => {
  it('documents every attribute the parser understands', () => {
    const documented = COOKIE_DEFENCES.map((entry) => entry.attribute);
    for (const attribute of ['HttpOnly', 'SameSite', 'Secure', 'Domain', 'Path']) {
      expect(documented).toContain(attribute);
    }
    expect(documented).toContain('__Host- prefix');
  });

  it('cites the cookie RFCs, not the obsolete HTTP ones', () => {
    for (const entry of COOKIE_DEFENCES) {
      expect(entry.rfc).toMatch(/RFC 6265/);
    }
  });
});
