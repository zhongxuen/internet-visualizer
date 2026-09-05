/**
 * Scenario 1 -- the five verbs, and the statuses they earn.
 *
 * Everything else in this module is HTTP with something added, so this goes first and adds
 * nothing. What it does is refuse to state any of the three claims people repeat about REST
 * and instead makes the store demonstrate them:
 *
 * - **`POST` is not idempotent and `PUT` is.** Both are sent twice, byte-identically. Two
 *   articles, or one. There is no sentence that lands the way the collection count does.
 * - **A `404` from `DELETE` does not mean the delete failed.** The second `DELETE` gets `404`
 *   and leaves exactly the store the `204` left. Idempotency is a claim about the state
 *   afterwards, not about the status returned, and that is the distinction the second call
 *   makes visible.
 * - **`202` is a weaker promise than `201`.** "The request succeeded" and "the thing exists"
 *   are two different statements, and only one status makes the weaker one.
 *
 * The last step is the one worth watching for a different reason: `DELETE /articles` gets
 * `405` and not `404`, and the `405` carries `Allow`. A `404` there would be a lie -- the
 * collection plainly exists, the client just asked it to do something it does not do -- and
 * `Allow` is what turns the refusal into something a client can act on.
 */

import type { ApiScenario } from '../sim/exchange';

import { seedStore } from './common';

/** Every verb once, and each one twice where repeating it is the lesson. */
export const REST_CRUD: ApiScenario = {
  id: 'rest-crud',
  title: 'REST, verb by verb',
  summary:
    'The five methods against one collection, with the store shown after each. POST and PUT ' +
    'are each sent twice so idempotency is demonstrated rather than asserted, and the last ' +
    'request is refused with the one status that names what would have worked.',
  teaches: [
    'Resources are nouns; the method is the only verb, which is what lets caches and proxies reason about a request',
    '201 carries Location; 204 carries nothing at all, not even {}',
    'Sending the same POST twice makes two resources; sending the same PUT twice makes one',
    'DELETE answering 404 the second time is still idempotent -- idempotency is about the state left behind',
    '202 means accepted, not done, and its Location points at progress rather than at the resource',
    '422 rather than 400 when the JSON parsed cleanly and then said something unusable',
    '405 rather than 404 when the target exists, and 405 obliges the server to send Allow',
  ],
  plan: {
    kind: 'rest',
    store: seedStore(),
    steps: [
      {
        id: 'list',
        title: 'GET /articles',
        intent:
          'Read the collection. A collection always exists, even when it is empty -- an empty one is 200 with an empty list, never 404.',
        method: 'GET',
        target: '/articles',
      },
      {
        id: 'create',
        title: 'POST /articles, twice',
        intent:
          'Create an article, then send the byte-identical request again. Watch the id in Location change.',
        method: 'POST',
        target: '/articles',
        times: 2,
        afterMs: 300,
        body: {
          title: 'Cursors, and why offsets drift',
          body: 'An offset counts rows in a list that is not the list it was a moment ago.',
          published: false,
        },
      },
      {
        id: 'read',
        title: 'GET /articles/3',
        intent:
          'Follow the Location the first create returned. The representation is what was stored, plus the id the server chose.',
        method: 'GET',
        target: '/articles/3',
        afterMs: 200,
      },
      {
        id: 'replace',
        title: 'PUT /articles/3, twice',
        intent:
          'Replace the whole resource, then send the identical request again. Nothing about the store differs between the two.',
        method: 'PUT',
        target: '/articles/3',
        times: 2,
        afterMs: 200,
        body: {
          title: 'Cursors, and why offsets drift',
          body: 'An offset counts rows in a list that is not the list it was a moment ago. Revised.',
          published: true,
        },
      },
      {
        id: 'patch',
        title: 'PATCH /articles/1',
        intent:
          'A JSON Merge Patch: change one field, and delete another by sending null. The 200 carries the whole patched representation, because after a partial change the client does not know the whole state.',
        method: 'PATCH',
        target: '/articles/1',
        afterMs: 250,
        contentType: 'application/merge-patch+json',
        body: { title: 'What a status code is for (revised)', subtitle: null },
      },
      {
        id: 'delete',
        title: 'DELETE /articles/3, twice',
        intent:
          'Delete it, then delete it again. 204, then 404 -- and an identical store both times.',
        method: 'DELETE',
        target: '/articles/3',
        times: 2,
        afterMs: 250,
      },
      {
        id: 'report',
        title: 'POST /reports',
        intent:
          'Ask for something that takes minutes. The server accepts the work and answers before doing it.',
        method: 'POST',
        target: '/reports',
        afterMs: 250,
        body: { range: '2026-02', format: 'csv' },
      },
      {
        id: 'server-owned',
        title: 'POST /articles with a field the server owns',
        intent:
          'The body sets views, which the server counts. The JSON parsed perfectly well and then said something the resource cannot accept -- which is a different failure from a malformed body, and gets a different status.',
        method: 'POST',
        target: '/articles',
        afterMs: 200,
        body: { title: 'Very popular already', body: 'Trust me.', views: 999_999 },
      },
      {
        id: 'refused',
        title: 'DELETE /articles',
        intent:
          'Ask the collection to delete itself. It exists, so this is not a 404 -- and the refusal has to say what would have worked.',
        method: 'DELETE',
        target: '/articles',
        afterMs: 200,
      },
    ],
  },
  notes: [
    {
      phase: 'create',
      text: 'The two responses differ only in the id, and that is the whole problem. A client that sends a POST, times out waiting for the answer, and retries has no way to know whether the first one landed -- so it either duplicates the resource or drops it. The fix is an idempotency key: a client-generated id sent in a header, which the server records against the result so a retry returns the original answer instead of doing the work again.',
      reference: {
        rfc: 9110,
        section: '9.2.2',
        title: 'HTTP Semantics: Idempotent Methods',
      },
    },
    {
      phase: 'replace',
      text: 'PUT replaces. Every field the body omits is gone afterwards -- this is not a merge, and a client that sends three fields of a six-field resource has silently deleted the other three. That is also exactly why it is idempotent: the request describes the whole final state, so applying it twice reaches the same place.',
      reference: { rfc: 9110, section: '9.3.4', title: 'HTTP Semantics: PUT' },
    },
    {
      phase: 'patch',
      text: 'JSON Merge Patch reads null as "delete this field", which means it cannot express "set this field to null" at all. That is the price of a format simple enough to fit in a paragraph, and it is why JSON Patch (RFC 6902), with its explicit operation list, exists alongside it. Note also that the format is idempotent even though the PATCH method is not: the method cannot promise what an arbitrary patch format does not, so it promises nothing and each format speaks for itself.',
      reference: { rfc: 7396, title: 'JSON Merge Patch' },
    },
    {
      phase: 'delete',
      text: 'The 404 on the second call reports the state the client found; it does not mean the delete failed. Compare the store after each: identical. This is what idempotency actually claims -- something about the state left behind, and nothing at all about the status returned.',
      reference: { rfc: 9110, section: '9.3.5', title: 'HTTP Semantics: DELETE' },
    },
    {
      phase: 'report',
      text: '202 Accepted is the honest answer when the work has not been done yet. Its Location points at something that reports progress, not at a finished resource -- a client that follows it expecting the report is following the wrong promise. Answering 201 here would claim a resource exists that does not, and the client would go and ask for it.',
      reference: { rfc: 9110, section: '15.3.3', title: 'HTTP Semantics: 202 Accepted' },
    },
    {
      phase: 'refused',
      text: 'Both 404 and 405 are refusals, and they say different things. 404 means "nothing is here"; 405 means "something is here and it does not do that". The distinction matters because it changes what the client should try next, and the Allow field spells that out. RFC 9110 makes Allow mandatory on a 405 for exactly this reason.',
      reference: {
        rfc: 9110,
        section: '15.5.6',
        title: 'HTTP Semantics: 405 Method Not Allowed',
      },
    },
    {
      phase: 'server-owned',
      text: '422 and not 400. The bytes were fine and the JSON parsed; what it said was unusable. 400 means the server could not read the request at all, and a client told 400 for a semantic problem will go looking for a serialisation bug that is not there. Note also that the answer is a problem document -- type, title, status, detail -- rather than whatever error shape this API felt like inventing, which is the point of RFC 9457.',
      reference: { rfc: 9457, title: 'Problem Details for HTTP APIs' },
    },
  ],
};
