/**
 * What the keys in a response body mean.
 *
 * `sim/rest.ts` already describes the fields of a *resource* -- what `title` is, that `views`
 * is the server's to set -- because those are facts about the mock API's domain. This file
 * describes the other half: the keys that are not the resource. `data`, `total`,
 * `next_cursor`, `errors`, `detail`, `access_token`. They come from four different
 * specifications and a couple of conventions, they appear in every API anybody integrates
 * with, and they are exactly the keys a learner reads past.
 *
 * Kept as data next to the resource definitions rather than inside `ResponseShape.tsx` for
 * the same reason `HEADER_EXPLANATIONS` sits beside the HTTP Explorer's wire view: a
 * component that owned this text would be the only thing that could ever show it, and it
 * would drift from the sim that produces the keys.
 *
 * ## Where a key is ambiguous, it is qualified
 *
 * `status` is a number inside a problem document (RFC 9457) and a string inside the report
 * fixture; `type` is a URI in a problem document and an event name in a webhook. Lookup takes
 * the *path* rather than the bare key so those cannot be conflated -- `explainField` matches
 * on the containing document's shape where it has to.
 */

import type { RfcRef } from '@/core/types/events';

import type { JsonObject, JsonValue } from './sim/message';
import type { ResourceDefinition } from './sim/rest';

/** Which specification or convention a key comes from. */
export type FieldOrigin =
  /** RFC 9457 problem details -- the only standard error shape an API has. */
  | 'problem'
  /** A collection envelope. Convention, not a standard: no RFC says `data`. */
  | 'envelope'
  /** Pagination fields, of which only the `Link` header is actually specified. */
  | 'pagination'
  /** The GraphQL response, whose two top-level keys are in the specification. */
  | 'graphql'
  /** RFC 6749's token endpoint response. */
  | 'oauth'
  /** The webhook event envelope. No standard exists; this is the common convention. */
  | 'webhook'
  /** A field of the resource itself, taken from its `ResourceDefinition`. */
  | 'resource';

/** One key, explained. */
export interface FieldExplanation {
  readonly name: string;
  readonly origin: FieldOrigin;
  readonly what: string;
  /** The thing worth knowing that the one-liner does not carry. */
  readonly detail?: string;
  readonly reference?: RfcRef;
}

const RFC_9457: RfcRef = { rfc: 9457, title: 'Problem Details for HTTP APIs' };
const RFC_6749_TOKEN: RfcRef = {
  rfc: 6749,
  section: '5.1',
  title: 'OAuth 2.0: Successful Response',
};
const RFC_8288: RfcRef = { rfc: 8288, title: 'Web Linking' };

/**
 * Every key an API in this module can put in a body that is not a resource field.
 *
 * Ordered by origin so the list reads as "here are the four vocabularies you will meet",
 * which is more useful than alphabetical: the point is that `detail` and `next_cursor` come
 * from different worlds and only one of them is specified.
 */
export const FIELD_EXPLANATIONS: readonly FieldExplanation[] = [
  // -- RFC 9457, the one standard error shape ------------------------------
  {
    name: 'type',
    origin: 'problem',
    what: 'A URI identifying the problem type. `about:blank` means "no more specific type than the status code".',
    detail:
      'This is the field a client should branch on. Branching on the human-readable title instead is how an error handler breaks when somebody fixes a typo.',
    reference: { ...RFC_9457, section: '3.1.1' },
  },
  {
    name: 'title',
    origin: 'problem',
    what: 'A short, human-readable summary of the problem type. Does not change between occurrences.',
    detail: 'For people. RFC 9457 says clients should not parse it, and it means it.',
    reference: { ...RFC_9457, section: '3.1.2' },
  },
  {
    name: 'status',
    origin: 'problem',
    what: 'The HTTP status, repeated inside the document.',
    detail:
      'Duplicated on purpose: a document that has been logged, forwarded, or pasted into a ticket has lost its status line, and an error record that cannot say whether it was a 404 or a 500 is not much of a record.',
    reference: { ...RFC_9457, section: '3.1.3' },
  },
  {
    name: 'detail',
    origin: 'problem',
    what: 'What went wrong with *this* request, as opposed to what this class of problem is.',
    detail:
      'The one field that may name specifics. It should explain, not instruct a human to open a support ticket.',
    reference: { ...RFC_9457, section: '3.1.4' },
  },
  {
    name: 'instance',
    origin: 'problem',
    what: 'A URI identifying this particular occurrence -- usually something you can look up in a log.',
    reference: { ...RFC_9457, section: '3.1.5' },
  },

  // -- Collection envelopes: convention all the way down --------------------
  {
    name: 'data',
    origin: 'envelope',
    what: 'The payload, wrapped so the response has room for anything that is not the payload.',
    detail:
      'No specification says `data`. It is a convention, and its value is that adding pagination or metadata later does not change the shape of what is already there -- which a bare top-level array would have made a breaking change.',
  },
  {
    name: 'total',
    origin: 'pagination',
    what: 'The size of the whole collection at the moment this page was computed.',
    detail:
      'Cheap in a fixture and expensive in a database, which is why so many APIs stop reporting it. It is also the number that makes offset drift visible: watch it change between two pages of one run.',
  },
  {
    name: 'offset',
    origin: 'pagination',
    what: 'How many rows were skipped to reach this page.',
    detail:
      'A position in a list, which is only meaningful while the list holds still. `LIMIT 20 OFFSET 100000` also does not seek -- the database produces and discards a hundred thousand rows -- so deep pages get linearly slower.',
  },
  {
    name: 'limit',
    origin: 'pagination',
    what: 'How many rows this page holds at most.',
    detail:
      'Always clamped by the server. Without a ceiling, `?limit=1000000` is a denial-of-service request written by an honest client.',
  },
  {
    name: 'next_cursor',
    origin: 'pagination',
    what: 'An opaque position in the ordering. Send it back as `after` to continue.',
    detail:
      'Opaque is the point: a client that could read it would start constructing cursors, and the server could never change the encoding again. Here it is base64 of a sort value and an id -- which you should not rely on, and which is exactly why it is base64.',
    reference: { ...RFC_8288, section: '3.3' },
  },

  // -- GraphQL --------------------------------------------------------------
  {
    name: 'errors',
    origin: 'graphql',
    what: 'Everything that went wrong, each with the response path it went wrong at.',
    detail:
      'The transport still returned 200, so this array is the only failure signal. Anything watching status codes -- retries, alerting, dashboards -- sees a success.',
  },
  {
    name: 'path',
    origin: 'graphql',
    what: 'Where in `data` the error occurred, e.g. `["user", "posts", 0, "title"]`.',
    detail:
      'Partial success is ordinary in GraphQL: the failed field becomes null, everything else resolves, and the path is how a client knows which hole is which.',
  },

  // -- OAuth 2.0 ------------------------------------------------------------
  {
    name: 'access_token',
    origin: 'oauth',
    what: 'The credential. Present it in `Authorization: Bearer <token>`.',
    detail:
      'A bearer token: whoever holds it may use it, with no further proof required. That is what makes it simple and what makes leaking one so expensive.',
    reference: RFC_6749_TOKEN,
  },
  {
    name: 'token_type',
    origin: 'oauth',
    what: 'How to present the token. In practice always `Bearer`.',
    reference: RFC_6749_TOKEN,
  },
  {
    name: 'expires_in',
    origin: 'oauth',
    what: 'Lifetime in seconds from now -- a delta, not a timestamp, so client clock skew cannot matter.',
    detail:
      'Short lifetimes are the answer to a credential that cannot be revoked. Fifteen minutes plus a refresh token is the usual shape.',
    reference: RFC_6749_TOKEN,
  },
  {
    name: 'refresh_token',
    origin: 'oauth',
    what: 'Exchanged at the token endpoint for a new access token, without involving the user again.',
    detail:
      'Long-lived, and therefore the more valuable of the two. It never goes to the resource server, which is what limits where it can leak from.',
    reference: { rfc: 6749, section: '1.5', title: 'OAuth 2.0: Refresh Token' },
  },
  {
    name: 'scope',
    origin: 'oauth',
    what: 'What the token is allowed to do, space-delimited.',
    detail:
      'Granted by the authorization server, which may issue less than was asked for. A client must read what it got rather than assume it got what it requested.',
    reference: { rfc: 6749, section: '3.3', title: 'OAuth 2.0: Access Token Scope' },
  },
  {
    name: 'error',
    origin: 'oauth',
    what: 'A fixed code from a registry: `invalid_grant`, `invalid_client`, `invalid_request`.',
    detail:
      'One of the few error vocabularies that is actually specified, which is why an OAuth failure can be handled generically and a REST failure usually cannot.',
    reference: { rfc: 6749, section: '5.2', title: 'OAuth 2.0: Error Response' },
  },
  {
    name: 'error_description',
    origin: 'oauth',
    what: 'Human-readable detail. For a developer reading a log, not for a program.',
    reference: { rfc: 6749, section: '5.2', title: 'OAuth 2.0: Error Response' },
  },

  // -- Webhooks -------------------------------------------------------------
  {
    name: 'id',
    origin: 'webhook',
    what: 'The event id. Stable across every retry, and the key a receiver deduplicates on.',
    detail:
      'It has to come from the sender. A receiver that generated its own key, or hashed the body, would break on the first retry -- because the body is re-signed with a new timestamp every time.',
  },
  {
    name: 'created',
    origin: 'webhook',
    what: 'When the event happened, in seconds since the epoch. Not when it was delivered.',
    detail:
      'Deliveries can arrive out of order, so this is what a receiver should order by rather than arrival time.',
  },
];

/** Look up one key by name, optionally narrowing by which vocabulary it came from. */
export function explainField(
  name: string,
  origin?: FieldOrigin,
): FieldExplanation | undefined {
  return FIELD_EXPLANATIONS.find(
    (entry) => entry.name === name && (origin === undefined || entry.origin === origin),
  );
}

/**
 * Which vocabulary a document is written in.
 *
 * Decided from the document's own shape rather than from the status code, because a body can
 * be read out of context -- pasted into a console, logged, forwarded -- and the shape is the
 * only thing that travels with it. `type` plus `title` plus `status` is a problem document
 * (RFC 9457 is specific about the media type, and the shape is nearly as reliable); `data`
 * plus `errors` at the top level is GraphQL; `access_token` is a token response.
 */
export function originOf(document: JsonValue): FieldOrigin {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    return 'envelope';
  }
  const keys = new Set(Object.keys(document));
  if (keys.has('access_token') || keys.has('refresh_token')) return 'oauth';
  if (keys.has('error') && keys.has('error_description')) return 'oauth';
  if (keys.has('type') && keys.has('title') && keys.has('status')) return 'problem';
  if (keys.has('errors') || (keys.has('data') && keys.has('extensions')))
    return 'graphql';
  if (keys.has('next_cursor') || keys.has('offset') || keys.has('total'))
    return 'pagination';
  return 'envelope';
}

/** One row of the shape view: a key, its value, and whatever is known about it. */
export interface ShapeField {
  readonly name: string;
  readonly value: JsonValue;
  /** Absent when nothing in the catalogue or the resource describes this key. */
  readonly explanation?: FieldExplanation;
}

/**
 * Explain the keys of one object.
 *
 * A resource's own field definitions win over the catalogue, because `id` means something
 * specific inside an article and something else inside a webhook event, and the caller that
 * passed a resource knows which one it is looking at.
 */
export function describeObject(
  document: JsonObject,
  options: { readonly origin?: FieldOrigin; readonly resource?: ResourceDefinition } = {},
): readonly ShapeField[] {
  const origin = options.origin ?? originOf(document);

  return Object.entries(document).map(([name, value]) => {
    const field = options.resource?.fields.find((each) => each.name === name);
    if (field) {
      return {
        name,
        value,
        explanation: {
          name,
          origin: 'resource' as const,
          what: field.what,
          ...(field.serverOwned
            ? {
                detail: 'Set by the server. A request that sends it is refused with 422.',
              }
            : field.required
              ? { detail: 'Required when creating or replacing this resource.' }
              : {}),
        },
      };
    }
    const explanation = explainField(name, origin) ?? explainField(name);
    return { name, value, ...(explanation ? { explanation } : {}) };
  });
}
