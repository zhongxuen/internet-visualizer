/**
 * The fixtures every scenario is written against.
 *
 * Three things live here because more than one scenario needs them and a second copy would be
 * a second thing to keep true: the instant the module's clock starts at, the mock API's
 * resource definitions and seed rows, and the host name everything is addressed to.
 *
 * ## Why the epoch is a constant
 *
 * JWTs carry `exp`, `iat`, and `nbf` in seconds since the Unix epoch; webhook signatures
 * carry a timestamp; OAuth tokens expire. A simulation whose timeline starts at zero has to
 * map those onto something, and that something must not be the machine's clock -- a scenario
 * that called `Date.now()` would produce a different token, a different signature, and a
 * different `SimResult` every second, and the determinism the whole module rests on would be
 * gone before the first assertion.
 *
 * So virtual millisecond zero is a constant, chosen and written down. `Date.UTC` is
 * arithmetic on its arguments and reads no clock, so the line below is a literal in
 * everything but syntax.
 *
 * ## Why every name is under `.example`
 *
 * RFC 2606 s 2 reserves `.example` so it can never be registered by anybody. Paired with the
 * RFC 5737 documentation addresses in `sim/exchange.ts`, that is belt and braces on a module
 * that has no socket to begin with: there is no `fetch` here, and no host parameter anywhere
 * in this folder to be given one.
 */

import { createStore, type ResourceDefinition, type RestStore } from '../sim/rest';

/** Virtual time zero: 2026-03-01T12:00:00Z, as seconds since the Unix epoch. */
export const SCENARIO_EPOCH_SECONDS = Math.floor(Date.UTC(2026, 2, 1, 12, 0, 0) / 1000);

/** The host the mock API answers on. */
export const API_HOST = 'api.example';

/** The issuer of every token in this module. */
export const ISSUER = 'https://auth.example';

/** What the access tokens are minted *for* -- the `aud` claim the API checks. */
export const AUDIENCE = 'https://api.example';

/**
 * The signing secret.
 *
 * A string literal in a public repository, which is the correct place for it: every value in
 * this module is a teaching fixture, nothing it protects exists, and a secret that had to be
 * kept would make the scenarios impossible to replay. Real signing keys are 256 bits of
 * randomness from a key manager and are never seen by the code that uses them.
 */
export const SIGNING_SECRET = 'not-a-real-secret-2f9c41e0b7d8a3-teaching-fixture';

// ---------------------------------------------------------------------------
// The mock API
// ---------------------------------------------------------------------------

/**
 * The resources, as nouns.
 *
 * Plural paths are not decoration. The convention is what makes the **method** the only verb
 * in a request, and that is what lets an intermediary that knows nothing else about a request
 * reason about it: a cache can serve a `GET`, a proxy can retry a `PUT`, a load balancer can
 * refuse a `DELETE` from an unauthenticated caller. `/getArticle` is a remote procedure call
 * wearing HTTP as a costume -- there is nothing wrong with RPC, but none of that machinery
 * can help you, because the method no longer says whether the request is safe.
 */
export const RESOURCES: readonly ResourceDefinition[] = [
  {
    name: 'articles',
    singular: 'article',
    collectionPath: '/articles',
    summary:
      'Published writing. The resource every verb in this module is demonstrated on.',
    collectionMethods: ['GET', 'POST'],
    itemMethods: ['GET', 'PUT', 'PATCH', 'DELETE'],
    fields: [
      {
        name: 'id',
        type: 'id',
        what: 'The server picks it. A client that chose ids would have to coordinate with every other client.',
      },
      { name: 'title', type: 'string', what: 'The headline.', required: true },
      { name: 'body', type: 'string', what: 'The article itself.', required: true },
      {
        name: 'subtitle',
        type: 'string',
        what: 'Optional standfirst. The field a merge patch can delete by sending null.',
      },
      {
        name: 'published',
        type: 'boolean',
        what: 'Whether it is visible. A boolean, not a string -- "false" is true.',
      },
      {
        name: 'views',
        type: 'number',
        what: 'Counted by the server, and absent until it has counted something. A client that sent this would be telling the server how popular its own article is.',
        serverOwned: true,
      },
    ],
  },
  {
    name: 'comments',
    singular: 'comment',
    collectionPath: '/comments',
    summary:
      'Replies to articles. Present so the explorer has a second resource to compare against.',
    collectionMethods: ['GET', 'POST'],
    itemMethods: ['GET', 'DELETE'],
    fields: [
      { name: 'id', type: 'id', what: 'Server-assigned.' },
      {
        name: 'articleId',
        type: 'id',
        what: 'Which article this replies to.',
        required: true,
      },
      { name: 'author', type: 'string', what: 'Who wrote it.', required: true },
      { name: 'text', type: 'string', what: 'The comment.', required: true },
    ],
  },
  {
    name: 'reports',
    singular: 'report',
    collectionPath: '/reports',
    summary:
      'Long-running exports. Creating one is asynchronous, which is why it answers 202 and not 201.',
    collectionMethods: ['GET', 'POST'],
    itemMethods: ['GET'],
    asynchronousCreate: true,
    fields: [
      { name: 'id', type: 'id', what: 'Server-assigned.' },
      { name: 'range', type: 'string', what: 'The period to report on.', required: true },
      { name: 'format', type: 'string', what: 'csv or json.' },
    ],
  },
];

/**
 * A fresh store.
 *
 * A function rather than a constant because every scenario mutates its own copy -- `RestStore`
 * is immutable and `handleRest` returns a new one, but the *seed* must be identical for every
 * run or two scenarios would silently share a starting point and neither would replay.
 */
export function seedStore(): RestStore {
  return createStore(RESOURCES, {
    articles: [
      {
        id: '1',
        attributes: {
          title: 'What a status code is for',
          subtitle: 'Semantics, not decoration',
          body: 'A status code is the one part of a response every intermediary understands.',
          published: true,
        },
      },
      {
        id: '2',
        attributes: {
          title: 'Idempotency in one sentence',
          body: 'The state after one identical request and after five is the same state.',
          published: true,
        },
      },
    ],
    comments: [
      {
        id: '1',
        attributes: {
          articleId: '1',
          author: 'grace',
          text: 'The 405 example finally landed for me.',
        },
      },
      {
        id: '2',
        attributes: {
          articleId: '2',
          author: 'ada',
          text: 'Note that this says nothing about the status returned.',
        },
      },
    ],
    reports: [],
  });
}
