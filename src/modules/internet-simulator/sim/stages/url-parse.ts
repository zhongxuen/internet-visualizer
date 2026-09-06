/**
 * Stage 1 -- the URL, taken apart.
 *
 * Nothing has happened yet. No packet has been sent, no name has been looked up, and the
 * only thing in existence is a string somebody typed. Taking it apart first is worth a
 * stage of its own because every later stage is driven by one of the pieces, and because
 * two of the pieces behave in ways people are consistently surprised by:
 *
 * - **The fragment never leaves the browser.** `#pricing` is resolved locally against
 *   the document that comes back; it is not in the request, so a server cannot see it,
 *   log it, or route on it (RFC 3986 s3.5).
 * - **The host travels twice.** It decides which address DNS returns *and* it is sent
 *   again in the `Host` field, because one address can serve thousands of sites. That
 *   second copy is what makes name-based virtual hosting possible, and it is why HTTP/1.1
 *   made the field mandatory.
 *
 * The parse itself is textual and local: `parseDomainName` from the DNS layer applies
 * RFC 1123's label rules, `parsePort` from the port table applies RFC 6335's range, and
 * neither reaches anything. A name that survives this stage is handed to a resolver that
 * reads bundled zone fixtures, so there is no code path from a typed URL to a real host.
 */

import { parsePort, serviceName } from '@/core/net/ports';
import { fail, ok, type ParseResult } from '@/core/net/result';
import { parseIpv4 } from '@/core/net/address';
import { displayName, parseDomainName } from '@/core/protocols/dns/records';
import type { SimEvent } from '@/core/types/events';

import { BROWSER_NODE, round2, type Stage, type StageOutput } from '../stage';

/** How long a browser spends splitting a string on punctuation. Effectively nothing. */
export const URL_PARSE_MS = 0.2;

/** The two schemes this module models. */
export type UrlScheme = 'http' | 'https';

/** The default port for each, from the well-known port table. */
export const DEFAULT_PORTS: Readonly<Record<UrlScheme, number>> = {
  http: 80,
  https: 443,
};

/** One component of the URL, ready to be shown as a row. */
export interface UrlPart {
  readonly name: string;
  readonly value: string;
  /** What this component decides. */
  readonly note: string;
  /** Whether this component is sent to the server at all. */
  readonly sent: boolean;
}

/** A URL taken apart. */
export interface ParsedUrl {
  /** The URL as re-assembled from the parts -- normalised, and with the port implicit. */
  readonly href: string;
  readonly scheme: UrlScheme;
  /** Lower-cased, trailing dot removed. This is what DNS is asked for. */
  readonly host: string;
  readonly port: number;
  /** True when the port came from the scheme rather than from the URL. */
  readonly defaultPort: boolean;
  /** Always begins with `/`; `/` when the URL had no path. */
  readonly path: string;
  /** Without the `?`. Empty when there was no query. */
  readonly query: string;
  /** Without the `#`. Empty when there was none. Never sent. */
  readonly fragment: string;
  /** `scheme://host[:port]` -- the origin, which is what a connection is made to. */
  readonly origin: string;
  /** `path[?query]` -- the request-target that goes in the request line. */
  readonly target: string;
  /** True when the host is a literal address, so there is nothing for DNS to do. */
  readonly hostIsAddress: boolean;
  readonly parts: readonly UrlPart[];
}

/** First letter up, terminated, so a parser fragment reads as a sentence. */
function sentence(fragment: string): string {
  const trimmed = fragment.trim();
  const text = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * Split a URL into its components, or say why it cannot be one.
 *
 * A missing scheme is filled in as `https`, which is what every current browser does and
 * is itself a teaching point: the default stopped being `http` some years ago, and that
 * change is the reason typing a bare host no longer sends a cleartext request first.
 */
export function parseUrl(raw: string): ParseResult<ParsedUrl> {
  const trimmed = raw.trim();
  if (trimmed === '') return fail('Type a URL, or pick one of the scenarios.');

  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(trimmed);
  const rest = schemeMatch ? trimmed.slice(schemeMatch[0].length) : trimmed;
  const schemeText = (schemeMatch?.[1] ?? 'https').toLowerCase();
  if (schemeText !== 'http' && schemeText !== 'https') {
    return fail(
      `This simulator loads pages, so it understands http and https; "${schemeText}" is something else.`,
    );
  }
  const scheme = schemeText;

  // Userinfo in a URL is deprecated (RFC 3986 s3.2.1) and browsers strip it before
  // sending anything; dropping it here keeps it out of the `Host` field too.
  const withoutUserinfo = rest.replace(/^[^/?#@]*@/, '');

  const authorityEnd = withoutUserinfo.search(/[/?#]/);
  const authority =
    authorityEnd === -1 ? withoutUserinfo : withoutUserinfo.slice(0, authorityEnd);
  const remainder = authorityEnd === -1 ? '' : withoutUserinfo.slice(authorityEnd);

  if (authority === '') return fail('A URL needs a host: there is nothing to look up.');

  const portMatch = /:(\d*)$/.exec(authority);
  const hostText = portMatch ? authority.slice(0, portMatch.index) : authority;
  let port = DEFAULT_PORTS[scheme];
  let defaultPort = true;
  if (portMatch) {
    const parsedPort = parsePort(portMatch[1]);
    if (!parsedPort.ok) return fail(sentence(parsedPort.error));
    port = parsedPort.value;
    defaultPort = port === DEFAULT_PORTS[scheme];
  }

  const address = parseIpv4(hostText);
  const hostIsAddress = address.ok;
  let host: string;
  if (hostIsAddress) {
    host = hostText;
  } else {
    const parsedHost = parseDomainName(hostText);
    if (!parsedHost.ok) return fail(sentence(parsedHost.error));
    host = parsedHost.value;
  }

  const hashAt = remainder.indexOf('#');
  const beforeFragment = hashAt === -1 ? remainder : remainder.slice(0, hashAt);
  const fragment = hashAt === -1 ? '' : remainder.slice(hashAt + 1);

  const questionAt = beforeFragment.indexOf('?');
  const pathText =
    questionAt === -1 ? beforeFragment : beforeFragment.slice(0, questionAt);
  const query = questionAt === -1 ? '' : beforeFragment.slice(questionAt + 1);
  const path = pathText === '' ? '/' : pathText;

  // The URL forms use the host exactly as it will appear in the address bar and in the
  // `Host` field -- no trailing root dot. `displayName`'s fully-qualified form belongs to
  // the resolver, which is a different reader: a URL carrying `example.com.` is legal and
  // is not what anyone types, and this string is round-tripped through the address bar.
  const origin = defaultPort ? `${scheme}://${host}` : `${scheme}://${host}:${port}`;
  const target = query === '' ? path : `${path}?${query}`;

  const parts: UrlPart[] = [
    {
      name: 'Scheme',
      value: scheme,
      note:
        scheme === 'https'
          ? 'Decides the default port and that a TLS handshake happens before any HTTP is sent.'
          : 'Cleartext. Every byte below is readable by anything on the path.',
      sent: false,
    },
    {
      name: 'Host',
      value: host,
      note: hostIsAddress
        ? 'A literal address, so there is nothing for DNS to resolve.'
        : 'Resolved to an address by DNS, and then sent again in the Host field so one address can serve many sites.',
      sent: true,
    },
    {
      name: 'Port',
      value: `${port}${defaultPort ? ' (implied by the scheme)' : ''}`,
      note: `${serviceName(port) ?? 'the port'} is where the connection is made; it is not part of the request.`,
      sent: false,
    },
    {
      name: 'Path',
      value: path,
      note: 'Goes in the request line, and is what a cache keys on together with the host.',
      sent: true,
    },
    {
      name: 'Query',
      value: query === '' ? '(none)' : `?${query}`,
      note: 'Part of the request-target, so it is sent, logged, and cached with the path.',
      sent: true,
    },
    {
      name: 'Fragment',
      value: fragment === '' ? '(none)' : `#${fragment}`,
      note: 'Resolved locally against the document that comes back. It is never sent (RFC 3986 s3.5).',
      sent: false,
    },
  ];

  return ok({
    href: `${origin}${target}${fragment === '' ? '' : `#${fragment}`}`,
    scheme,
    host,
    port,
    defaultPort,
    path,
    query,
    fragment,
    origin,
    target,
    hostIsAddress,
    parts,
  });
}

const RFC_3986 = {
  rfc: 3986,
  section: '3.5',
  title: 'Uniform Resource Identifier (URI): Generic Syntax',
} as const;

/** Take the URL apart, or end the run before anything has been sent. */
export const urlParseStage: Stage = (context): StageOutput => {
  const parsed = parseUrl(context.scenario.url);

  if (!parsed.ok) {
    return {
      events: [
        {
          kind: 'phase',
          at: 0,
          id: 'url-parse',
          title: 'Parse the URL',
          description: 'Split what was typed into scheme, host, port, path, and query.',
        },
        { kind: 'node-state', at: 0, nodeId: BROWSER_NODE, state: 'error' },
        { kind: 'log', at: 0, level: 'error', text: parsed.error },
      ],
      durationMs: URL_PARSE_MS,
      summary: 'Not a URL',
      failure: {
        code: 'ERR_INVALID_URL',
        title: 'This site can’t be reached',
        message: `${context.scenario.url} does not look like a URL.`,
        explanation:
          'Nothing was sent. The address never became a scheme, a host, and a path, so there was no name to resolve and no connection to open. A browser would treat this as a search term instead.',
        reference: RFC_3986,
      },
    };
  }

  const url = parsed.value;
  const shownHost = url.hostIsAddress ? url.host : displayName(url.host);

  const events: SimEvent[] = [
    {
      kind: 'phase',
      at: 0,
      id: 'url-parse',
      title: 'Parse the URL',
      description:
        'Before anything is sent, the browser splits the address into the pieces each later stage needs: the host for DNS, the port for the connection, and the path for the request.',
    },
    { kind: 'node-state', at: 0, nodeId: BROWSER_NODE, state: 'processing' },
    {
      kind: 'log',
      at: 0,
      level: 'info',
      text: `Parsing ${url.href}`,
    },
    {
      kind: 'log',
      at: round2(URL_PARSE_MS / 2),
      level: 'info',
      text: `scheme=${url.scheme} host=${shownHost} port=${url.port}${url.defaultPort ? ' (implied)' : ''} target=${url.target}`,
    },
  ];

  if (url.fragment !== '') {
    events.push({
      kind: 'annotate',
      at: round2(URL_PARSE_MS / 2),
      targetId: BROWSER_NODE,
      text: `#${url.fragment} stops here. The fragment is resolved against the document once it arrives, and is not part of the request -- the server never learns it exists.`,
      reference: RFC_3986,
    });
  }

  events.push({
    kind: 'log',
    at: URL_PARSE_MS,
    level: 'info',
    text: url.hostIsAddress
      ? `${shownHost} is already an address, so DNS has nothing to do.`
      : `Next: turn ${shownHost} into an address.`,
  });

  return {
    events,
    durationMs: URL_PARSE_MS,
    summary: `${url.scheme}://${shownHost}${url.target}`,
    state: { url },
    ...(url.hostIsAddress
      ? {
          skipAhead: { dns: 'The URL names an address, so there is no name to resolve.' },
        }
      : {}),
  };
};
