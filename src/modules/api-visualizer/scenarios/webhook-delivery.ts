/**
 * Scenario 7 -- the arrow points the other way.
 *
 * Every other scenario in this module is a client calling an API. This one is the API calling
 * the client, and the reversal is the whole subject: the roles swap, so the thing that was
 * your server becomes somebody else's client, and your endpoint becomes a public URL that
 * anybody on the Internet can POST to.
 *
 * Four properties follow from that, and this run demonstrates each.
 *
 * **The signature is the only thing separating an event from the API from an event from
 * whoever found the URL.** The last delivery here is forged: correctly shaped, plausible
 * payload, signed with a secret the receiver has never heard of. It is refused before the
 * payload is parsed, let alone acted on. Verification is not a validation step you do after
 * reading the body -- it is what earns you the right to read the body.
 *
 * **The signature covers the timestamp as well as the body.** The signed string is
 * `<timestamp>.<raw body>`, concatenated with a separator so neither half can be changed
 * independently. A signature over the body alone can be replayed with any timestamp forever;
 * this one cannot, and the receiver refuses anything outside a five-minute window.
 *
 * **Each retry is signed afresh, and the event id does not change.** Those are two halves of
 * one bargain. Re-using the first attempt's signature would mean a delivery retried beyond
 * the tolerance window arrives correctly signed and stale -- rejected as a replay of itself.
 * Keeping the id fixed is what lets the receiver notice it has seen this event before.
 *
 * **The second attempt times out, and that is the interesting one.** No reply came back. From
 * the sender's side, a lost response and a receiver that never ran are indistinguishable, so
 * it retries -- and the receiver may now handle the same event twice. That ambiguity is not a
 * flaw in the delivery system; it is the reason at-least-once is the only guarantee anybody
 * offers, and the reason the receiver has to be idempotent. The run ends by handling the same
 * event twice and returning the same answer both times.
 *
 * Webhook signing has no de facto standard: RFC 9421 exists and the ecosystem predates it, so
 * every provider invented a slightly different header. What is shown here is the most widely
 * copied convention, and `webhook.ts` says so rather than dressing it as a specification.
 */

import type { ApiScenario } from '../sim/exchange';

import { SCENARIO_EPOCH_SECONDS } from './common';

/** The current signing secret, and the one being rotated out. */
const SIGNING_SECRET = 'whsec_2f9c41e0b7d8a3f6';
const RETIRED_SECRET = 'whsec_0a71bc45e9d21308';

/** The secret an attacker has, which is to say: not one of the above. */
const ATTACKER_SECRET = 'whsec_attacker_guess';

/** A payload nobody should act on, shaped exactly like one they should. */
const FORGED_BODY =
  '{"id":"evt_forged_0001","type":"invoice.paid","created":' +
  `${SCENARIO_EPOCH_SECONDS + 40}` +
  ',"data":{"invoice":"in_9931","amount":9999900,"currency":"usd","customer":"cus_314"}}';

/** Four attempts, an idempotent receiver, and one forgery. */
export const WEBHOOK_DELIVERY: ApiScenario = {
  id: 'webhook-delivery',
  title: 'Webhooks: delivery, retries, and signatures',
  summary:
    'The API POSTs an event to a subscriber that fails, then goes silent, then asks for time, ' +
    'then accepts. Each attempt is re-signed and carries the same event id; the receiver ' +
    'handles it exactly once and refuses a forgery sent to the same URL.',
  teaches: [
    'A webhook reverses the roles: the API is the client and your endpoint is the server',
    'The signature covers <timestamp>.<body>, so it cannot be replayed with a new timestamp',
    'Every retry is signed afresh; the event id never changes, which is what makes dedup possible',
    'Retry only what the receiver could plausibly fix: 5xx yes, 400 no, 408 and 429 yes, 410 stop',
    'A timeout is indistinguishable from a lost reply, which is why at-least-once is the only guarantee',
    'The receiver must be idempotent, keyed on the sender’s event id and not on anything it computes',
    'Verify the signature in constant time, before parsing the payload',
  ],
  conditions: { rttMs: 100 },
  plan: {
    kind: 'webhook',
    endpoint: 'https://hooks.example/billing',
    secret: SIGNING_SECRET,
    startSeconds: SCENARIO_EPOCH_SECONDS,
    // Two secrets accepted at once: what a rotation looks like from the receiving side. The
    // sender switches when it is ready and nothing is dropped in between.
    receiverSecrets: [SIGNING_SECRET, RETIRED_SECRET],
    toleranceSeconds: 300,
    event: {
      id: 'evt_9f2c41e0b7d8',
      type: 'invoice.paid',
      createdAt: SCENARIO_EPOCH_SECONDS,
      data: {
        invoice: 'in_4471',
        amount: 4_900,
        currency: 'usd',
        customer: 'cus_314',
        paidAt: SCENARIO_EPOCH_SECONDS,
      },
    },
    replies: [
      // The receiver's own database was down. Its problem, plausibly transient, worth retrying.
      { kind: 'status', status: 500 },
      // Nothing at all. The sender learns nothing except that it sent bytes.
      { kind: 'timeout' },
      // "Not now" rather than "not ever" -- one of the two 4xx codes worth retrying.
      { kind: 'status', status: 429, retryAfterSeconds: 5 },
      { kind: 'status', status: 200 },
    ],
    backoff: { baseMs: 1_000, capMs: 30_000, jitter: 'none' },
    maxAttempts: 5,
    forgery: {
      body: FORGED_BODY,
      secret: ATTACKER_SECRET,
      title: 'Somebody else POSTs to the same URL',
      intent:
        'A webhook endpoint is a public URL and anybody can call it. This request is shaped correctly, carries a plausible payment, and is signed with a secret the receiver has never seen.',
    },
  },
  notes: [
    {
      phase: 'attempt-1',
      target: 'api',
      text: 'Read the signature header: t=<seconds>,v1=<hex>. The timestamp travels in the clear beside the digest because the receiver has to reconstruct the signed string and cannot do that without knowing which timestamp was used. The v1 is a scheme version, and it is what makes it possible to ever change the algorithm -- a sender emits v1 and v2 for a transition period, receivers accept either, and one day v1 stops. A header carrying a bare digest has no way out.',
      reference: { rfc: 2104, title: 'HMAC: Keyed-Hashing for Message Authentication' },
    },
    {
      phase: 'attempt-1',
      target: 'receiver',
      text: 'A 500 is the receiver saying its own machinery failed, which may well be transient -- so retrying is polite and usually works. Compare a 400: that means the receiver read the payload and rejected it, and the payload will be byte-identical next time, so retrying is a promise to fail on a schedule. The rule is about who can fix it. 410 Gone gets its own answer again: stop, and disable the endpoint.',
    },
    {
      phase: 'attempt-2',
      target: 'api',
      text: 'Nothing came back. This is the case that shapes the whole design: the sender cannot tell a receiver that never ran from one that ran, committed, and had its reply lost on the way home. So it retries -- and if the first delivery did commit, the receiver is about to be handed the same event a second time. That is not a bug in anything. It is why at-least-once is the strongest guarantee anybody offers, and why the last chapter of this run exists.',
    },
    {
      phase: 'attempt-3',
      target: 'api',
      text: 'The receiver sent Retry-After, so the sender uses it instead of its own exponential curve -- the same rule the rate-limiting scenario draws out, in the opposite direction. Note also the signature on this attempt: it is a different digest from attempt one, because it covers this attempt’s timestamp. Re-signing is not an optimisation; it is what lets retry and replay protection coexist.',
    },
    {
      phase: 'idempotent-receipt',
      target: 'receiver',
      text: 'Three lines, and the entire answer to at-least-once delivery: look the event id up, do the work only if it is new, record the result against the id, and return the recorded result either way. That last clause is what makes the duplicate harmless from the sender’s side too -- it gets the same 200 and the same body, so nothing downstream can tell which delivery did the work. The id has to come from the sender: a receiver that hashed the body would break on the first retry, because the body’s signature changed.',
    },
    {
      phase: 'forged-delivery',
      target: 'receiver',
      text: 'Nothing about this request is malformed. It is well-shaped JSON, the header parses, the timestamp is current, and the amount is nine hundred and ninety-nine dollars in the attacker’s favour. The only thing wrong with it is the digest, and the only reason that is checked before the body is read is that somebody decided verification comes first. Note that the comparison is constant-time -- this is the comparison where that matters most, because a webhook endpoint is one an attacker can call as often as they like, which is exactly the condition a timing attack needs.',
      reference: { rfc: 9421, title: 'HTTP Message Signatures' },
    },
  ],
};
