/**
 * What the learner typed, turned into an exchange that can be run.
 *
 * This file is the module's safety boundary, and like the DNS module's `lookup.ts` it is
 * small on purpose so the boundary is easy to check. The rule from CLAUDE.md is that a
 * user must never be unsure whether an action touches a real network, and the way this
 * module honours it is not by being careful with a request -- it is by having no request
 * to be careful with. There is no `fetch` here, no `XMLHttpRequest`, no `Request`, no
 * `navigator.sendBeacon`, and no address that resolves off this machine.
 *
 * A draft that survives {@link parseRequestDraft} becomes an {@link HttpScenario} whose
 * only origin is {@link SANDBOX_ORIGIN} -- a table of routes declared a few lines below,
 * answered by a pure function in `sim/exchange.ts`, and addressed from `203.0.113.0/24`,
 * one of the ranges RFC 5737 reserves for documentation. Typing `https://example.com/`
 * into the builder does not quietly become a real request; the host is not even an input.
 * The one host it can talk to is `sandbox.example`, which is in the `.example` TLD that
 * RFC 2606 reserves precisely so it can never be registered by anybody.
 *
 * ## What is validated, and why with zod
 *
 * The method, the version, and the booleans arrive from `<select>` and `<input>` elements
 * as strings, and the run is only deterministic if what reaches `runHttpScenario` is one
 * of the values it knows. The request-target and the free-text header block need real
 * parsing, and both have a wrong answer that is worth naming rather than silently fixing:
 * a target that is not a path, and a field line whose name or value contains a byte the
 * grammar forbids. That second one is not pedantry -- a field value allowed to contain a
 * bare CR or LF is header injection, and HTTP/1.1 has no other framing to fall back on.
 * One `safeParse` at the edge, and everything downstream is typed.
 */

import { z } from 'zod';

import { fail, ok, type ParseResult } from '@/core/net/result';

import type { HttpScenario, OriginFixture, OriginRoute } from './sim/exchange';
import {
  header,
  HTTP_METHODS,
  HTTP_VERSIONS,
  isValidFieldName,
  isValidFieldValue,
  parseTarget,
  type HeaderList,
  type HttpMethod,
  type HttpVersion,
} from './sim/message';
import { methodSemantics } from './sim/semantics';

import { daysBefore, FIXTURE_ADDRESSES, HTTP_CLOCK, secondsAfter } from './scenarios';

/** The scenario id a request built in the panel runs under. */
export const BUILDER_SCENARIO_ID = 'builder-request';

/**
 * The one host the builder can address.
 *
 * `.example` is reserved by RFC 2606 §2 and can never be registered, so this name has no
 * owner anywhere and never will. It is paired with an RFC 5737 documentation address for
 * the same reason: belt and braces on a module that has no socket to begin with.
 */
export const SANDBOX_HOST = 'sandbox.example';

/** The origin a cross-origin request is declared to come *from*, for the CORS toggle. */
export const SANDBOX_PAGE_ORIGIN = 'https://app.example';

const JSON_BODY = `{
  "items": [
    { "id": 1, "name": "first" },
    { "id": 2, "name": "second" }
  ]
}
`;

const PAGE_BODY = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>sandbox.example</title></head>
  <body><h1>Sandbox</h1><p>Answered by a fixture, in this tab.</p></body>
</html>
`;

/** A route, plus the one thing pointing the builder at it is meant to show. */
export interface SandboxRoute extends OriginRoute {
  /** What a learner should watch for when they send to this path. */
  readonly note: string;
}

/**
 * What the sandbox origin serves.
 *
 * Chosen so that between them the routes reach every interesting corner of the module:
 * a cacheable page, the two directives everyone confuses, a redirect of each kind, a
 * cookie-gated resource, a CORS-enabled API, and three ways to fail. A path that is not
 * on this list gets a 404, and a method a route does not allow gets a 405 with `Allow` --
 * both of which are answers worth seeing, so neither is prevented in the UI.
 */
export const SANDBOX_ROUTES: readonly SandboxRoute[] = [
  {
    path: '/index.html',
    status: 200,
    conditional: true,
    headers: [
      header('Content-Type', 'text/html; charset=utf-8'),
      header('Cache-Control', 'max-age=60'),
      header('ETag', '"sandbox-home-v1"'),
      header('Last-Modified', daysBefore(2)),
    ],
    body: PAGE_BODY,
    note: 'Cacheable for a minute. Send it twice inside that minute for a browser HIT, and turn on Reload to watch the same copy revalidate into a 304 instead.',
  },
  {
    path: '/style.css',
    status: 200,
    conditional: true,
    headers: [
      header('Content-Type', 'text/css; charset=utf-8'),
      header('Cache-Control', 'public, max-age=60, s-maxage=600'),
      header('ETag', '"sandbox-style-v7"'),
      header('Expires', secondsAfter(600)),
    ],
    body: ':root { color-scheme: dark; }\n',
    note: 'Two lifetimes on one response: the browser obeys max-age=60, a shared cache obeys s-maxage=600 and ignores the other. The panel shows both tiers disagreeing on purpose.',
  },
  {
    path: '/config.json',
    status: 200,
    conditional: true,
    headers: [
      header('Content-Type', 'application/json'),
      header('Cache-Control', 'no-cache'),
      header('ETag', '"sandbox-config-v3"'),
    ],
    body: '{ "featureFlags": { "wireView": true } }\n',
    note: 'no-cache, which does NOT mean do not cache: the copy is stored, and every reuse revalidates into a 304 with no body. Send it twice.',
  },
  {
    path: '/statement.html',
    status: 200,
    headers: [
      header('Content-Type', 'text/html; charset=utf-8'),
      header('Cache-Control', 'no-store'),
    ],
    body: '<!doctype html><title>Statement</title><p>Nothing here is written down.</p>\n',
    note: 'no-store, which is the other one: nothing is stored at any tier, so the second send costs the whole body again. Compare it against /config.json.',
  },
  {
    path: '/login',
    methods: ['POST'],
    status: 303,
    headers: [header('Location', '/account'), header('Cache-Control', 'no-store')],
    setCookies: ['session=sandbox-8f21; Path=/; HttpOnly; SameSite=Lax'],
    note: 'A login: 303 sends the browser to /account with GET, and the Set-Cookie is what makes the next request authenticated. Watch the jar fill.',
  },
  {
    path: '/account',
    status: 200,
    requiresCookie: 'session',
    headers: [
      header('Content-Type', 'text/html; charset=utf-8'),
      header('Cache-Control', 'private, no-store'),
      header('Vary', 'Cookie'),
    ],
    body: '<!doctype html><title>Account</title><p>Signed in.</p>\n',
    denied: {
      status: 401,
      headers: [
        header('WWW-Authenticate', 'Cookie realm="sandbox"'),
        header('Content-Type', 'text/plain; charset=utf-8'),
      ],
      body: 'No session cookie.\n',
    },
    note: 'Gated on the session cookie. Send it before POSTing /login for a 401; send it after for a 200, without having typed a credential either time.',
  },
  {
    path: '/moved',
    status: 301,
    headers: [header('Location', '/index.html')],
    note: 'A permanent redirect. 301 is heuristically cacheable, which is why a mistyped one is remembered long after it is fixed.',
  },
  {
    path: '/found',
    status: 302,
    headers: [header('Location', '/index.html')],
    note: 'A temporary redirect. Specified to preserve the method and implemented by every browser to rewrite POST to GET -- which is the gap 307 exists to close.',
  },
  {
    path: '/api/items',
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    status: 200,
    headers: [
      header('Content-Type', 'application/json'),
      header('Cache-Control', 'no-store'),
    ],
    body: JSON_BODY,
    cors: {
      allowOrigins: [SANDBOX_PAGE_ORIGIN],
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
      allowHeaders: ['content-type', 'authorization', 'x-request-id'],
      allowCredentials: true,
      maxAgeSeconds: 600,
    },
    note: 'The CORS route. Turn on "from another origin" and send a PUT, or a POST with Content-Type: application/json, and watch the browser send an OPTIONS first.',
  },
  {
    path: '/api/open',
    methods: ['GET', 'HEAD', 'POST'],
    status: 200,
    headers: [header('Content-Type', 'application/json')],
    body: '{ "ok": true }\n',
    note: 'The same API with no CORS policy at all. Cross-origin, the request is still sent and still executed -- and the browser refuses to let the page read the answer.',
  },
  {
    path: '/upload',
    methods: ['POST', 'PUT'],
    status: 201,
    headers: [
      header('Location', '/uploads/1'),
      header('Content-Type', 'application/json'),
    ],
    body: '{ "id": 1 }\n',
    note: '201 Created. Location here does not mean "go somewhere else" -- it means "the thing you just made lives here".',
  },
  {
    path: '/teapot',
    status: 418,
    reason: "I'm a teapot",
    headers: [header('Content-Type', 'text/plain; charset=utf-8')],
    body: 'Short and stout.\n',
    note: 'RFC 2324, an April Fools joke from 1998 that the IETF has twice declined to reclaim. Reachable, and not registered in the real status registry.',
  },
  {
    path: '/boom',
    status: 500,
    headers: [header('Content-Type', 'text/plain; charset=utf-8')],
    body: 'The server broke.\n',
    thinkMs: 40,
    note: '5xx means the request was plausible and the server failed. Repeating it unchanged is reasonable, which is exactly what 4xx forbids.',
  },
];

/** The simulated server the builder talks to. Bundled; nothing here resolves or connects. */
export const SANDBOX_ORIGIN: OriginFixture = {
  host: SANDBOX_HOST,
  label: SANDBOX_HOST,
  ipv4: FIXTURE_ADDRESSES.sandbox,
  server: 'sandbox/1.0 (simulated)',
  thinkMs: 12,
  routes: SANDBOX_ROUTES,
};

/** The raw form state: whatever is in the panel right now, valid or not. */
export interface RequestDraft {
  readonly method: HttpMethod;
  /** The request-target. Origin-form, i.e. a path with an optional query. */
  readonly target: string;
  readonly version: HttpVersion;
  /** Whether the exchange is over TLS. `Secure` cookies need this to be true. */
  readonly secure: boolean;
  /** Extra field lines, one per line, as `Name: value`. */
  readonly headers: string;
  readonly body: string;
  /** Send it as a page on another origin would, so CORS applies. */
  readonly crossOrigin: boolean;
  /** `credentials: 'include'` -- attach cookies to the cross-origin request. */
  readonly withCredentials: boolean;
  /** Send `Cache-Control: no-cache`, as a reload does. */
  readonly reload: boolean;
  readonly followRedirects: boolean;
  /** Send the same request twice, a few seconds apart. How a cache HIT becomes visible. */
  readonly repeat: boolean;
}

/** What the builder opens on: the exchange the phase doc uses as its worked example. */
export const DEFAULT_REQUEST_DRAFT: RequestDraft = {
  method: 'GET',
  target: '/index.html',
  version: 'HTTP/1.1',
  secure: false,
  headers: '',
  body: '',
  crossOrigin: false,
  withCredentials: false,
  reload: false,
  followRedirects: true,
  repeat: false,
};

/** How long the client idles before the repeat, in virtual milliseconds. */
export const REPEAT_GAP_MS = 3000;

/**
 * Parse the free-text header block into fields.
 *
 * Order is preserved and duplicates are kept, because both are true of the wire: field
 * order is observable, and `Set-Cookie` and `Accept` legitimately repeat. Blank lines and
 * `#` comments are dropped so a learner can annotate the box.
 */
export function parseHeaderBlock(text: string): ParseResult<HeaderList> {
  const fields: HeaderList[number][] = [];

  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;

    const at = line.indexOf(':');
    if (at <= 0) {
      return fail(`Line ${index + 1}: a field line is "Name: value". "${line}" is not.`);
    }

    // No trim on the name: RFC 9112 §5.1 forbids whitespace between the field name and
    // the colon, and a server that tolerated it would be one hop of a smuggling chain.
    const name = line.slice(0, at);
    const value = line.slice(at + 1).trim();

    if (!isValidFieldName(name)) {
      return fail(
        `Line ${index + 1}: "${name}" is not a field name. Names are letters, digits, ` +
          'and a few punctuation marks -- no spaces, and no colon.',
      );
    }
    if (!isValidFieldValue(value)) {
      return fail(
        `Line ${index + 1}: that value contains a control character. A field value may ` +
          'not carry a bare CR or LF -- allowing one is header injection, because the ' +
          'blank line is the only thing separating the fields from the body.',
      );
    }
    fields.push(header(name, value));
  }

  return ok(fields);
}

/**
 * Whether a string contains a space or a control character.
 *
 * Written as a codepoint test rather than a regular expression because the class it
 * would need -- whitespace, C0, and DEL -- is exactly the class a character-range typo
 * turns into "and also the hyphen", which would quietly reject `/api/items`. Comparing
 * numbers has no such failure mode.
 */
function hasSpaceOrControl(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

const methodSchema = z.enum(HTTP_METHODS as readonly [HttpMethod, ...HttpMethod[]]);
const versionSchema = z.enum(HTTP_VERSIONS as readonly [HttpVersion, ...HttpVersion[]]);

/**
 * A request this module is willing to run.
 *
 * There is no `host` field, and that absence is the safety property: the origin is
 * {@link SANDBOX_ORIGIN} and nothing in the form can change it.
 */
export const requestSchema = z.object({
  method: methodSchema,
  target: z.string().superRefine((value, ctx) => {
    const trimmed = value.trim();
    if (trimmed === '') {
      ctx.addIssue({ code: 'custom', message: 'Type a path, e.g. /index.html.' });
      return;
    }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Paths only. This builder can address one bundled fixture server and nothing ' +
          'else, so an absolute URL has nowhere to go: type the path part on its own.',
      });
      return;
    }
    if (!trimmed.startsWith('/')) {
      ctx.addIssue({
        code: 'custom',
        message: 'A request-target in origin-form starts with "/" (RFC 9112 §3.2.1).',
      });
      return;
    }
    // Whitespace and control characters only: the hyphen, the dot, and the percent are
    // ordinary path bytes, and a class that swallowed them would reject /api/items.
    if (hasSpaceOrControl(trimmed)) {
      ctx.addIssue({
        code: 'custom',
        message:
          'A request-target may not contain spaces or control characters -- the ' +
          'request-line is delimited by spaces, so one inside the target would split it.',
      });
    }
  }),
  version: versionSchema,
  secure: z.boolean(),
  headers: z.string(),
  body: z.string(),
  crossOrigin: z.boolean(),
  withCredentials: z.boolean(),
  reload: z.boolean(),
  followRedirects: z.boolean(),
  repeat: z.boolean(),
});

/** A validated request: a {@link RequestDraft} whose target and fields are known good. */
export interface BuiltRequest extends Omit<RequestDraft, 'headers'> {
  /** The extra fields, parsed. Folded on top of the browser's own defaults. */
  readonly headers: HeaderList;
  /** The header block as typed, so the form can echo it back. */
  readonly headerText: string;
}

/**
 * Validate a draft.
 *
 * Returns the same `ParseResult` shape every validator in `@/core/net` returns, so a
 * failure carries the reason and the panel can print it under the field that caused it.
 */
export function parseRequestDraft(draft: RequestDraft): ParseResult<BuiltRequest> {
  const parsed = requestSchema.safeParse(draft);
  if (!parsed.success) {
    return fail(
      parsed.error.issues[0]?.message ?? 'That is not a request this module can send.',
    );
  }

  const fields = parseHeaderBlock(parsed.data.headers);
  if (!fields.ok) return fields;

  const semantics = methodSemantics(parsed.data.method);
  const body = parsed.data.body;
  if (body !== '' && semantics.requestContent === 'forbidden') {
    return fail(
      `${parsed.data.method} must not carry content (${semantics.rfc}), so there is ` +
        'nothing this could send. Clear the body, or pick another method.',
    );
  }

  return ok({
    ...parsed.data,
    target: parsed.data.target.trim(),
    headers: fields.value,
    headerText: parsed.data.headers,
  });
}

/** The sandbox route a target would reach, if any. `undefined` means a 404. */
export function sandboxRouteFor(target: string): SandboxRoute | undefined {
  const path = parseTarget(target).path;
  return SANDBOX_ROUTES.find((route) => route.path === path);
}

/** What the fixtures can say about a target, and how to say it. */
export interface RequestCoverage {
  /** True when a bundled route answers this path. */
  readonly known: boolean;
  readonly route?: SandboxRoute;
  /** One paragraph for the panel, naming what will happen and why. */
  readonly note: string;
}

/**
 * What the sandbox will do with a target.
 *
 * The unknown case is the one that matters, and it is not an error: the simulated server
 * answers, honestly, that it has no such resource. Saying so plainly is the difference
 * between a teaching tool and a tool that quietly teaches something false -- a 404 here
 * is a fact about a fixture table in this repository, and not a fact about any real host.
 */
export function coverageFor(draft: {
  target: string;
  method: HttpMethod;
}): RequestCoverage {
  const route = sandboxRouteFor(draft.target);
  const path = parseTarget(draft.target).path;

  if (!route) {
    return {
      known: false,
      note:
        `${SANDBOX_HOST} has no route for ${path || draft.target}, so this comes back 404 ` +
        'Not Found. That is a statement about the bundled fixture table below and not ' +
        'about anything on the Internet: no request left this tab, and this module has ' +
        'no code path that could send one.',
    };
  }

  const allowed = route.methods ?? ['GET', 'HEAD'];
  if (!allowed.includes(draft.method)) {
    return {
      known: true,
      route,
      note:
        `${path} exists but does not allow ${draft.method}, so the answer is 405 Method ` +
        `Not Allowed with Allow: ${allowed.join(', ')} -- which is a 405 doing its job, ` +
        'because it names what would have worked.',
    };
  }

  return { known: true, route, note: route.note };
}

/** The summary line for the run, phrased for whatever the draft is asking for. */
function summaryFor(request: BuiltRequest): string {
  const where = request.crossOrigin
    ? `from a page on ${SANDBOX_PAGE_ORIGIN}, so CORS applies`
    : 'from a page on the same origin';
  const twice = request.repeat
    ? ', sent twice so the caches and the cookie jar have something to show'
    : '';
  return `${request.method} ${request.target} over ${request.version}${request.secure ? ' with TLS' : ' in cleartext'}, ${where}${twice}.`;
}

/**
 * Turn a validated request into a scenario `runHttpScenario` can run.
 *
 * The repeat is two steps rather than a pre-seeded cache, for the same reason the DNS
 * module's warm lookup asks twice: a cache holding entries nobody watched arrive is a
 * claim, and two requests sharing one cache is that claim demonstrated. A CDN is always
 * declared, so the two-tier panel has both tiers to draw even when only one of them
 * stores anything -- an empty shared cache beside a full private one is itself the
 * `private` directive doing its work.
 */
export function builderScenario(request: BuiltRequest): HttpScenario {
  const initiator = {
    pageOrigin: request.crossOrigin
      ? SANDBOX_PAGE_ORIGIN
      : `${request.secure ? 'https' : 'http'}://${SANDBOX_HOST}`,
    ...(request.crossOrigin ? {} : { topLevelNavigation: true }),
    ...(request.withCredentials ? { withCredentials: true } : {}),
  };

  const step = {
    kind: 'request' as const,
    host: SANDBOX_HOST,
    method: request.method,
    target: request.target,
    ...(request.headers.length > 0 ? { headers: request.headers } : {}),
    ...(request.body !== '' ? { body: request.body } : {}),
    initiator,
    ...(request.reload ? { reload: true } : {}),
    followRedirects: request.followRedirects,
  };

  return {
    id: BUILDER_SCENARIO_ID,
    title: `${request.method} ${request.target}`,
    summary: summaryFor(request),
    teaches: [
      'What the request you described actually looks like as bytes',
      request.repeat
        ? 'What the second identical request costs, and which tier answered it'
        : 'Which fields the browser adds that you never asked for',
      ...(request.crossOrigin
        ? ['Whether the page is allowed to read what the server sent back']
        : []),
    ],
    // Every knob is in the seed: two runs that look the same must be the same run.
    seed: [
      'http:builder',
      request.method,
      request.target,
      request.version,
      String(request.secure),
      String(request.crossOrigin),
      String(request.withCredentials),
      String(request.reload),
      String(request.repeat),
      request.headerText,
    ].join('|'),
    version: request.version,
    secure: request.secure,
    clock: HTTP_CLOCK,
    conditions: { rttMs: 60, bandwidthKbps: 20_000 },
    origins: [SANDBOX_ORIGIN],
    cdn: { label: 'Edge cache (simulated)', ipv4: FIXTURE_ADDRESSES.edge },
    steps: request.repeat
      ? [
          {
            ...step,
            id: 'built-1',
            title: 'First send',
            intent:
              'The first time. Nothing is cached and the jar is empty, so this costs everything it can cost.',
          },
          {
            ...step,
            id: 'built-2',
            title: 'Second send',
            intent: `The same request ${REPEAT_GAP_MS / 1000} seconds later, by a client that has already learned whatever the first one taught it.`,
            afterMs: REPEAT_GAP_MS,
          },
        ]
      : [
          {
            ...step,
            id: 'built-1',
            title: `${request.method} ${request.target}`,
            intent:
              'The request as described in the builder, answered by a bundled fixture.',
          },
        ],
  };
}
