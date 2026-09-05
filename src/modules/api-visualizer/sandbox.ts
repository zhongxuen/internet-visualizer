/**
 * What the console can send, and the boundary that keeps it honest.
 *
 * This file is the module's safety boundary, and like the HTTP Explorer's `builder.ts` it is
 * small on purpose so the boundary is easy to check. The rule from CLAUDE.md is that a user
 * must never be unsure whether an action touches a real network, and the way this module
 * honours it is not by being careful with a request -- it is by having no request to be
 * careful with. There is no `fetch` here, no `XMLHttpRequest`, no `Request`, no
 * `navigator.sendBeacon`, and no host name anywhere in the form.
 *
 * A draft that survives {@link parseConsoleDraft} is handed to {@link handleRest}, which is a
 * pure function over an in-memory store declared in `scenarios/common.ts`. Typing
 * `https://api.stripe.com/v1/charges` into the target field does not quietly become a real
 * request: an absolute URL is rejected with a message saying why, and the host is not an input
 * in the first place.
 *
 * ## What is validated, and why with zod
 *
 * The method and the content type arrive from `<select>` elements as strings, and the run is
 * only meaningful if what reaches the router is one of the values it knows. The target and the
 * body need real parsing, and each has a wrong answer worth naming rather than silently
 * fixing:
 *
 * - a target that is not an origin-form path (RFC 9112 s 3.2.1), or that contains a space or a
 *   control character -- the request-line is delimited by spaces, so one inside the target
 *   would split it;
 * - a body that is not JSON, which the API would answer `400` for anyway, but which is more
 *   usefully caught with the parser's own message before it is sent;
 * - a bearer token slot that is free text, because the interesting tokens are the malformed
 *   ones and refusing to send them would hide the lesson.
 *
 * One `safeParse` at the edge, and everything downstream is typed.
 */

import { z } from 'zod';

import { fail, ok, type ParseResult } from '@/core/net/result';

import { API_HOST, seedStore } from './scenarios/common';
import { applyApiKey, type ApiKeyPlacement } from './sim/auth';
import {
  header,
  HTTP_METHODS,
  parseJson,
  parseTarget,
  request as plainRequest,
  setHeader,
  type HeaderList,
  type HttpMethod,
  type JsonValue,
} from './sim/message';
import {
  handleRest,
  jsonRequest,
  resolveTarget,
  verbSemantics,
  type RestOutcome,
  type RestStore,
} from './sim/rest';

/** The API key the console's mock gateway recognises. */
export const CONSOLE_API_KEY = 'sk_live_2f9c41e0b7d8a3';

/** The media types the console offers. Two of them, and the difference matters for PATCH. */
export const CONSOLE_CONTENT_TYPES = [
  'application/json',
  'application/merge-patch+json',
  'text/plain',
] as const;

export type ConsoleContentType = (typeof CONSOLE_CONTENT_TYPES)[number];

/** How the console's request says who is calling. */
export type ConsoleCredentialKind =
  'none' | 'api-key-header' | 'api-key-query' | 'bearer';

/** What the form holds. Every field is a string or a boolean; nothing here is a host. */
export interface ConsoleDraft {
  readonly method: HttpMethod;
  readonly target: string;
  readonly contentType: ConsoleContentType;
  readonly body: string;
  readonly credential: ConsoleCredentialKind;
  /** Free text, because a malformed token is the interesting case. */
  readonly bearerToken: string;
}

/** What the console opens on: the request that shows the most for the least typing. */
export const DEFAULT_CONSOLE_DRAFT: ConsoleDraft = {
  method: 'GET',
  target: '/articles',
  contentType: 'application/json',
  body: '',
  credential: 'none',
  bearerToken: '',
};

const methodSchema = z.enum(HTTP_METHODS as readonly [HttpMethod, ...HttpMethod[]]);

/** True when a string holds a space or a control character. */
function hasSpaceOrControl(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * A request this module is willing to run.
 *
 * There is no `host` field, and that absence is the safety property: the only thing this can
 * address is the in-memory store, and nothing in the form can change that.
 */
export const consoleDraftSchema = z.object({
  method: methodSchema,
  target: z.string().superRefine((value, ctx) => {
    const trimmed = value.trim();
    if (trimmed === '') {
      ctx.addIssue({ code: 'custom', message: 'Type a path, e.g. /articles.' });
      return;
    }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Paths only. This console addresses one in-memory fixture and nothing else, so an ' +
          'absolute URL has nowhere to go: type the path part on its own.',
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
    if (hasSpaceOrControl(trimmed)) {
      ctx.addIssue({
        code: 'custom',
        message:
          'A request-target may not contain spaces or control characters — the request-line ' +
          'is delimited by spaces, so one inside the target would split it.',
      });
    }
  }),
  contentType: z.enum(CONSOLE_CONTENT_TYPES),
  body: z.string(),
  credential: z.enum(['none', 'api-key-header', 'api-key-query', 'bearer']),
  bearerToken: z.string(),
});

/** A draft whose target parses and whose body, if there is one, is JSON. */
export interface BuiltConsoleRequest extends ConsoleDraft {
  /** The body parsed, when the method carries one. */
  readonly json?: JsonValue;
}

/**
 * Validate a draft.
 *
 * Returns the same `ParseResult` shape every validator in `@/core/net` returns, so a failure
 * carries the reason and the panel can print it under the field that caused it.
 */
export function parseConsoleDraft(draft: ConsoleDraft): ParseResult<BuiltConsoleRequest> {
  const parsed = consoleDraftSchema.safeParse(draft);
  if (!parsed.success) {
    return fail(
      parsed.error.issues[0]?.message ?? 'That is not a request this console can send.',
    );
  }

  const target = parsed.data.target.trim();
  const semantics = verbSemantics(parsed.data.method);
  const body = parsed.data.body.trim();

  if (body !== '' && semantics.body === 'none') {
    return fail(
      `${parsed.data.method} carries no content, so there is nothing for this body to be. ` +
        'Clear it, or pick a method that takes one.',
    );
  }

  if (body === '' && semantics.body === 'required') {
    // Not rejected -- sending it is how a learner sees the 400, and a console that refused to
    // send a request the server has an opinion about would be teaching its own opinion.
    return ok({ ...parsed.data, target });
  }

  if (body !== '' && parsed.data.contentType !== 'text/plain') {
    const json = parseJson(body);
    if (!json.ok) {
      return fail(
        `The body is not valid JSON: ${json.error}. Send it anyway by choosing text/plain, ` +
          'which earns a 415 rather than a 400 — a different failure worth seeing.',
      );
    }
    return ok({ ...parsed.data, target, json: json.value });
  }

  return ok({ ...parsed.data, target });
}

/** What the console knows about where a target points, before anything is sent. */
export interface TargetCoverage {
  /** True when a resource is routed at this path. */
  readonly known: boolean;
  /** One paragraph naming what will happen and why. */
  readonly note: string;
}

/**
 * What the mock API will do with a target.
 *
 * The unknown case is the one that matters, and it is not an error: the simulated server
 * answers, honestly, that it has no such resource. Saying so plainly is the difference between
 * a teaching tool and one that quietly teaches something false — a `404` here is a fact about
 * three resource definitions in this repository and not a fact about anything on the Internet.
 */
export function coverageFor(
  store: RestStore,
  draft: { readonly target: string; readonly method: HttpMethod },
): TargetCoverage {
  const resolved = resolveTarget(store, draft.target);
  const path = parseTarget(draft.target).path;

  if (resolved.kind === 'unknown') {
    return {
      known: false,
      note:
        `Nothing is routed at ${path || draft.target}, so this comes back 404 Not Found. That ` +
        `is a statement about the three resources declared in this repository, and not about ` +
        `anything on the Internet: no request left this tab, and this module has no code path ` +
        `that could send one.`,
    };
  }

  const semantics = verbSemantics(draft.method);
  return {
    known: true,
    note:
      `${path} is ${resolved.kind === 'collection' ? 'a collection' : `member ${resolved.id} of ${resolved.resource?.name}`}. ` +
      `${semantics.what} ${semantics.detail}`,
  };
}

/** Build the request the console will send, credential and all. */
export function buildConsoleRequest(built: BuiltConsoleRequest) {
  const base: HeaderList = [
    header('Host', API_HOST),
    header('Accept', 'application/json'),
    header('User-Agent', 'api-visualizer-console/1.0 (simulated)'),
  ];

  const outgoing =
    built.body.trim() === ''
      ? plainRequest({ method: built.method, target: built.target, headers: base })
      : built.json === undefined
        ? {
            ...plainRequest({
              method: built.method,
              target: built.target,
              headers: [...base, header('Content-Type', built.contentType)],
            }),
            body: built.body,
          }
        : jsonRequest({
            method: built.method,
            target: built.target,
            body: built.json,
            headers: base,
            contentType: built.contentType,
          });

  switch (built.credential) {
    case 'api-key-header':
      return applyApiKey(outgoing, CONSOLE_API_KEY, 'header' satisfies ApiKeyPlacement);
    case 'api-key-query':
      return applyApiKey(outgoing, CONSOLE_API_KEY, 'query' satisfies ApiKeyPlacement);
    case 'bearer':
      return {
        ...outgoing,
        headers: setHeader(
          outgoing.headers,
          'Authorization',
          `Bearer ${built.bearerToken.trim()}`,
        ),
      };
    default:
      return outgoing;
  }
}

/**
 * Send one console request.
 *
 * "Send" is the wrong word and is used anyway because it is the word a learner has in their
 * head. What happens is a function call: the store goes in, a new store comes out, and the
 * only thing that changes anywhere is the value held in a React state hook.
 */
export function runConsoleRequest(
  store: RestStore,
  built: BuiltConsoleRequest,
): RestOutcome {
  return handleRest(store, buildConsoleRequest(built), {
    putReturnsRepresentation: true,
  });
}

/** A fresh mock API, for the console's reset button. */
export function consoleStore(): RestStore {
  return seedStore();
}
