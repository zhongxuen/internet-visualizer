import { describe, expect, it } from 'vitest';

import { createRng } from '@/core/sim/rng';
import type { SimEvent } from '@/core/types/events';

import { SITE_HOST, SITE_ORIGIN } from '../../scenarios/common';
import {
  SIM_CLOCK,
  networkProfile,
  type SimulatorScenario,
  type StageContext,
} from '../stage';
import { buildTopology } from '../topology';
import { DEFAULT_PORTS, URL_PARSE_MS, parseUrl, urlParseStage } from './url-parse';

/**
 * Stage 1: the string somebody typed, taken apart before anything exists.
 *
 * Two claims are worth a test of their own, because both are things people are
 * consistently wrong about:
 *
 *  - **The fragment never leaves the browser.** It is parsed, it is shown, and it is not
 *    in the request-target -- so a server cannot log it or route on it.
 *  - **A bare host defaults to `https`.** That default changed some years ago, and it is
 *    the reason typing `example.com` no longer sends a cleartext request first.
 *
 * The rest is the failure surface. Every rejection here happens before a packet exists,
 * which is exactly why it is worth covering: a URL that survives this stage is handed to
 * a resolver, and the parse is the last place a nonsense host can be stopped cheaply.
 */

const PROFILE = networkProfile('cable');

function contextFor(url: string): StageContext {
  const scenario: SimulatorScenario = {
    id: 'url-parse-fixture',
    title: 'URL parse fixture',
    summary: 'Exists to drive the first stage.',
    teaches: [],
    url,
    origin: SITE_ORIGIN,
  };

  return {
    stage: 'url-parse',
    scenario,
    profile: PROFILE,
    clock: SIM_CLOCK,
    topology: buildTopology(scenario, PROFILE),
    rng: createRng('url-parse draws nothing'),
    state: {},
  };
}

function logs(events: readonly SimEvent[]): string[] {
  return events.filter((event) => event.kind === 'log').map((event) => event.text);
}

/** Unwrap a parse that is expected to succeed, failing the test loudly if it did not. */
function parsed(raw: string) {
  const result = parseUrl(raw);
  if (!result.ok) throw new Error(`expected ${raw} to parse, got: ${result.error}`);
  return result.value;
}

describe('parseUrl: the components', () => {
  it('splits a full URL into every piece a later stage needs', () => {
    const url = parsed('https://www.example.com:8443/docs/intro?q=tls#pricing');

    expect(url).toMatchObject({
      scheme: 'https',
      host: 'www.example.com',
      port: 8443,
      defaultPort: false,
      path: '/docs/intro',
      query: 'q=tls',
      fragment: 'pricing',
      origin: 'https://www.example.com:8443',
      target: '/docs/intro?q=tls',
      hostIsAddress: false,
    });
  });

  /**
   * The default stopped being `http` some years ago. That is not a detail: it is why a
   * bare host no longer produces a cleartext request that something on the path could
   * have intercepted and rewritten.
   */
  it('fills in https for a bare host, not http', () => {
    expect(parsed('example.com').scheme).toBe('https');
    expect(parsed('example.com').port).toBe(DEFAULT_PORTS.https);
    expect(parsed('http://example.com').port).toBe(DEFAULT_PORTS.http);
  });

  it('marks a port that came from the scheme as implied, and leaves it out of the origin', () => {
    expect(parsed('https://example.com').defaultPort).toBe(true);
    expect(parsed('https://example.com').origin).toBe('https://example.com');

    // 443 written out is still the default -- it is the value that decides, not the syntax.
    expect(parsed('https://example.com:443').defaultPort).toBe(true);
    expect(parsed('https://example.com:8443').origin).toBe('https://example.com:8443');
  });

  it('defaults an empty path to /', () => {
    expect(parsed('https://example.com').path).toBe('/');
    expect(parsed('https://example.com?q=1').path).toBe('/');
    expect(parsed('https://example.com?q=1').target).toBe('/?q=1');
  });

  it('lower-cases the host, because DNS and the Host field are case-insensitive', () => {
    expect(parsed('https://WWW.Example.COM/').host).toBe('www.example.com');
  });

  /**
   * Userinfo is deprecated (RFC 3986 s3.2.1) and browsers strip it before sending
   * anything. Dropping it during the parse is what keeps it out of the `Host` field too.
   */
  it('strips userinfo rather than carrying it into the Host field', () => {
    const url = parsed('https://alice:secret@example.com/account');

    expect(url.host).toBe('example.com');
    expect(url.href).not.toContain('alice');
    expect(url.href).not.toContain('secret');
  });

  it('recognises a literal address, so there is nothing for DNS to do', () => {
    const url = parsed('http://192.0.2.10:8080/status');

    expect(url.hostIsAddress).toBe(true);
    expect(url.host).toBe('192.0.2.10');
    expect(url.parts.find((part) => part.name === 'Host')?.note).toMatch(
      /nothing for DNS/i,
    );
  });

  it('re-assembles an href that round-trips through the address bar', () => {
    expect(parsed('https://example.com/docs?q=1#top').href).toBe(
      'https://example.com/docs?q=1#top',
    );
    // No trailing root dot: legal in DNS, not what anyone types.
    expect(parsed('https://example.com./').href).toBe('https://example.com/');
  });
});

describe('parseUrl: what is sent and what is not', () => {
  /** The claim the stage exists to make. Four parts are local; two travel. */
  it('marks exactly the host, path, and query as sent', () => {
    const parts = parsed('https://example.com/docs?q=tls#pricing').parts;

    expect(parts.filter((part) => part.sent).map((part) => part.name)).toEqual([
      'Host',
      'Path',
      'Query',
    ]);
    expect(parts.filter((part) => !part.sent).map((part) => part.name)).toEqual([
      'Scheme',
      'Port',
      'Fragment',
    ]);
  });

  it('keeps the fragment out of the request-target entirely', () => {
    const url = parsed('https://example.com/docs?q=tls#pricing');

    expect(url.fragment).toBe('pricing');
    expect(url.target).toBe('/docs?q=tls');
    expect(url.path).not.toContain('pricing');
    expect(url.query).not.toContain('pricing');
  });

  it('says the fragment is never sent, citing the RFC', () => {
    const fragment = parsed('https://example.com/#top').parts.find(
      (part) => part.name === 'Fragment',
    );

    expect(fragment?.note).toMatch(/never sent/i);
    expect(fragment?.note).toMatch(/3986/);
  });

  it('shows an absent query and fragment as "(none)" rather than blank', () => {
    const parts = parsed('https://example.com/').parts;

    expect(parts.find((part) => part.name === 'Query')?.value).toBe('(none)');
    expect(parts.find((part) => part.name === 'Fragment')?.value).toBe('(none)');
  });

  it('warns that http is readable by anything on the path', () => {
    expect(
      parsed('http://example.com/').parts.find((part) => part.name === 'Scheme')?.note,
    ).toMatch(/cleartext/i);
  });
});

describe('parseUrl: rejections', () => {
  it.each([
    ['an empty string', '   ', /Type a URL/],
    ['a scheme this simulator does not load', 'ftp://example.com/', /understands http/],
    ['nothing to look up', 'https:///docs', /needs a host/],
    ['a port outside the range', 'https://example.com:70000/', /70000|port/i],
    ['a port that is not a number', 'https://example.com:/', /port/i],
    ['a host that is not a name', 'https://-example-.com/', /./],
  ])('rejects %s', (_label, raw, pattern) => {
    const result = parseUrl(raw);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(pattern);
    // Every message is a sentence: it is shown to a person, not logged.
    expect(result.error).toMatch(/[.!?]$/);
  });
});

describe('urlParseStage', () => {
  /**
   * The rail's label uses the fully-qualified form, root dot and all, while `ParsedUrl.host`
   * keeps the form that goes in the address bar and the `Host` field. Two readers, two
   * spellings, on purpose -- so this asserts both rather than letting one drift into the
   * other.
   */
  it('opens with its phase and labels the rail with the fully-qualified host', () => {
    const output = urlParseStage(contextFor(`https://${SITE_HOST}/docs?q=1`));

    expect(output.events[0]).toMatchObject({ kind: 'phase', at: 0, id: 'url-parse' });
    expect(output.summary).toBe(`https://${SITE_HOST}./docs?q=1`);
    expect(output.durationMs).toBe(URL_PARSE_MS);
    expect(output.state?.url?.host).toBe(SITE_HOST);
    expect(output.state?.url?.href).toBe(`https://${SITE_HOST}/docs?q=1`);
  });

  it('pins a note to the fragment, and none when there is not one', () => {
    const withFragment = urlParseStage(contextFor(`https://${SITE_HOST}/#pricing`));
    const without = urlParseStage(contextFor(`https://${SITE_HOST}/`));

    expect(withFragment.events.some((event) => event.kind === 'annotate')).toBe(true);
    expect(without.events.some((event) => event.kind === 'annotate')).toBe(false);
  });

  /** An address in the URL makes the next stage unnecessary before it is reached. */
  it('skips DNS when the URL already names an address', () => {
    const output = urlParseStage(contextFor('http://192.0.2.10/status'));

    expect(output.skipAhead).toEqual({
      dns: 'The URL names an address, so there is no name to resolve.',
    });
    expect(logs(output.events).join(' ')).toMatch(/DNS has nothing to do/);
  });

  it('does not skip DNS for a name', () => {
    expect(urlParseStage(contextFor(`https://${SITE_HOST}/`)).skipAhead).toBeUndefined();
    expect(
      logs(urlParseStage(contextFor(`https://${SITE_HOST}/`)).events).join(' '),
    ).toMatch(/Next: turn/);
  });

  /**
   * The one failure that happens before a packet could have existed. It is worth showing
   * as a browser error page rather than as an exception, because that is what a user sees
   * -- and the explanation has to say that nothing was sent, since nothing was.
   */
  it('ends the run with ERR_INVALID_URL, having sent nothing', () => {
    const output = urlParseStage(contextFor('ftp://example.com/files'));

    expect(output.failure?.code).toBe('ERR_INVALID_URL');
    expect(output.failure?.explanation).toMatch(/Nothing was sent/i);
    expect(output.failure?.reference?.rfc).toBe(3986);
    expect(output.summary).toBe('Not a URL');
    expect(output.state).toBeUndefined();
    expect(
      output.events.some(
        (event) => event.kind === 'node-state' && event.state === 'error',
      ),
    ).toBe(true);
  });

  it('is deterministic', () => {
    expect(urlParseStage(contextFor(`https://${SITE_HOST}/a?b=c#d`))).toStrictEqual(
      urlParseStage(contextFor(`https://${SITE_HOST}/a?b=c#d`)),
    );
  });
});
