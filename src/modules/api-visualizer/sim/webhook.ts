/**
 * Webhooks -- the arrow turns around, and every assumption turns with it.
 *
 * In every other file here, your code is the client: it decides when to call, it retries, and
 * a failure is its problem. A webhook inverts all three. The provider calls **you**, on its
 * schedule, and now you are the server -- which means three questions that a client never has
 * to answer become yours:
 *
 * 1. **Who sent this?** The request arrives at a public URL from an address you do not
 *    control. Anyone who learns the URL can post to it, and a body claiming `"paid": true`
 *    is worth exactly as much as the proof attached to it. That proof is an HMAC signature.
 * 2. **Have I seen it before?** Delivery is *at-least-once*, universally. A receiver that
 *    responded successfully but slowly, or whose response was lost, will be called again with
 *    the same event -- so processing must be idempotent, or the customer is charged twice.
 * 3. **What does my response mean?** A non-2xx tells the sender to try again later. That makes
 *    your status code a control signal for somebody else's retry queue, and a receiver that
 *    returns `500` on a malformed event it will never accept has asked to be retried forever.
 *
 * ## Signing covers the raw bytes, and this is where integrations break
 *
 * The signature is computed over the body **as received**, byte for byte. A receiver that
 * parses JSON and re-serialises it before verifying will fail on nothing more than a
 * difference in key order or whitespace -- and will fail *intermittently*, only for the
 * payloads where the serialisers happen to disagree. Frameworks that helpfully parse the body
 * before your handler runs are the usual culprit; the fix is to capture the raw body first.
 * {@link verifyWebhookSignature} takes a string and never parses it, which is the shape a
 * correct implementation has.
 *
 * ## Signing covers the timestamp too
 *
 * A signature alone proves origin and not freshness. An attacker who captured one valid
 * delivery can send those exact bytes again a year later and the signature still verifies.
 * Binding a timestamp into the signed string and refusing anything outside a tolerance window
 * is what closes that, and it is why the signed payload is `t.body` rather than just `body`.
 *
 * The HMAC here is real -- see `digest.ts`.
 */

import type { Rng } from '@/core/sim/rng';
import { fail, ok, type ParseResult } from '@/core/net/result';
import type { RfcRef } from '@/core/types/events';

import { constantTimeEqual, hmacSha256Hex } from './digest';
import {
  byteLength,
  header,
  jsonText,
  type HttpRequest,
  type JsonObject,
} from './message';
import { backoffDelayMs, type BackoffOptions } from './ratelimit';

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

/** RFC 2104 -- HMAC, the construction the signature uses. */
export const RFC_2104: RfcRef = {
  rfc: 2104,
  title: 'HMAC: Keyed-Hashing for Message Authentication',
};

/**
 * RFC 9421 -- HTTP Message Signatures.
 *
 * Worth citing precisely because almost nobody uses it. There *is* a standard for signing
 * HTTP messages, covering which fields are signed and how, and the webhook ecosystem grew up
 * before it and settled on a per-provider header instead. So every integration re-learns a
 * slightly different scheme: different header name, different signed string, hex or base64,
 * timestamp inside or outside. The mechanism below follows the most widely copied convention
 * and is not a specification.
 */
export const RFC_9421: RfcRef = { rfc: 9421, title: 'HTTP Message Signatures' };

/** Why the same event may arrive twice, stated where a receiver author will read it. */
export const AT_LEAST_ONCE_NOTE =
  'Webhook delivery is at-least-once, never exactly-once. A receiver that processed an event but whose 200 was lost to a timeout will be called again with the same event -- the sender cannot tell the two cases apart. Exactly-once delivery is not something a sender can offer; exactly-once *processing* is something a receiver achieves by keying on the event id.';

// ---------------------------------------------------------------------------
// The event
// ---------------------------------------------------------------------------

/** An event as it goes on the wire. */
export interface WebhookEvent {
  /** Stable across every retry of this event. The key a receiver deduplicates on. */
  readonly id: string;
  readonly type: string;
  /** Virtual seconds since the epoch at which the event occurred. */
  readonly createdAt: number;
  readonly data: JsonObject;
}

/** The event as a JSON body. This exact string is what gets signed. */
export function eventBody(event: WebhookEvent): string {
  return jsonText({
    id: event.id,
    type: event.type,
    created: event.createdAt,
    data: event.data,
  });
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/** The header name the convention below uses. */
export const SIGNATURE_HEADER = 'X-Webhook-Signature';

/**
 * The string that actually gets hashed: `<timestamp>.<raw body>`.
 *
 * Concatenating with a separator rather than hashing the two independently is what binds them
 * together. A signature over the body alone can be replayed with any timestamp; a signature
 * over this cannot, because changing either half changes the digest.
 */
export function signingPayload(timestampSeconds: number, body: string): string {
  return `${timestampSeconds}.${body}`;
}

/**
 * Build the signature header value.
 *
 * The format -- `t=<seconds>,v1=<hex>` -- carries the timestamp in the clear beside the
 * digest, which is necessary: the receiver must reconstruct the signed string, and it cannot
 * do that without knowing which timestamp was used.
 *
 * `v1` is a scheme version. Its presence is what makes it possible to ever change the
 * algorithm: a sender emits `v1` and `v2` for a transition period, receivers accept either,
 * and one day `v1` stops. A header with a bare digest and no version has no way out.
 */
export function signWebhook(init: {
  readonly secret: string;
  readonly body: string;
  readonly timestampSeconds: number;
}): string {
  const digest = hmacSha256Hex(
    init.secret,
    signingPayload(init.timestampSeconds, init.body),
  );
  return `t=${init.timestampSeconds},v1=${digest}`;
}

/**
 * Sign with several secrets at once, emitting one `v1` per key.
 *
 * This is how a secret is rotated without downtime. During the overlap the sender signs with
 * both the old and the new key, receivers accept a match against either, and only once every
 * receiver has the new secret does the old one stop being used. A scheme that allowed exactly
 * one signature would force every integration to change at the same instant.
 */
export function signWebhookWithKeys(init: {
  readonly secrets: readonly string[];
  readonly body: string;
  readonly timestampSeconds: number;
}): string {
  const payload = signingPayload(init.timestampSeconds, init.body);
  const parts = init.secrets.map((secret) => `v1=${hmacSha256Hex(secret, payload)}`);
  return [`t=${init.timestampSeconds}`, ...parts].join(',');
}

/** A parsed signature header. */
export interface ParsedSignature {
  readonly timestampSeconds: number;
  /** Every `v1` digest present, in order. More than one means a rotation is in progress. */
  readonly signatures: readonly string[];
}

/** Take the header apart, rejecting anything that is not the expected shape. */
export function parseSignatureHeader(value: string): ParseResult<ParsedSignature> {
  const parts = value.split(',').map((part) => part.trim());
  let timestamp: number | undefined;
  const signatures: string[] = [];

  for (const part of parts) {
    const equals = part.indexOf('=');
    if (equals === -1) return fail(`"${part}" is not a key=value pair`);
    const key = part.slice(0, equals);
    const raw = part.slice(equals + 1);
    if (key === 't') {
      const seconds = Number(raw);
      if (!Number.isFinite(seconds)) return fail(`"${raw}" is not a timestamp`);
      timestamp = seconds;
    } else if (key === 'v1') {
      if (!/^[0-9a-f]{64}$/.test(raw)) {
        return fail('a v1 signature is 64 lower-case hex digits (HMAC-SHA256)');
      }
      signatures.push(raw);
    }
    // Unknown schemes are ignored rather than rejected: that is how a v2 rolls out without
    // breaking receivers that only understand v1.
  }

  if (timestamp === undefined) return fail('the signature header has no t= timestamp');
  if (signatures.length === 0) return fail('the signature header has no v1= signature');
  return ok({ timestampSeconds: timestamp, signatures });
}

/** One thing the receiver checked. */
export interface SignatureCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly what: string;
  readonly detail?: string;
}

/** The verdict on one delivery. */
export interface SignatureVerdict {
  readonly valid: boolean;
  readonly checks: readonly SignatureCheck[];
  /** The digest the receiver computed, for showing beside the one presented. */
  readonly expected?: string;
}

/**
 * Verify a delivery: shape, freshness, then the digest itself.
 *
 * The order is deliberate and cheap-first. The timestamp check is arithmetic; the HMAC is a
 * hash over the whole body. Refusing a stale delivery before hashing it is the difference
 * between a replay flood costing microseconds and costing real CPU.
 *
 * The tolerance window should be small -- five minutes is the usual choice -- and it is a
 * *window*, not a maximum age: a delivery timestamped in the future by more than the tolerance
 * is refused too, because a sender's clock running ahead is indistinguishable from an attacker
 * post-dating a capture.
 *
 * As everywhere else in this module, the digest comparison is constant-time. This is the
 * comparison where it matters most: a receiver is a public endpoint an attacker can call as
 * often as they like, which is exactly the condition a timing attack needs.
 */
export function verifyWebhookSignature(options: {
  /** The raw body **as received**. Never re-serialise before calling this. */
  readonly body: string;
  readonly headerValue: string;
  /** Every secret the receiver currently accepts. More than one during a rotation. */
  readonly secrets: readonly string[];
  /** Virtual seconds since the epoch, at the receiver. */
  readonly nowSeconds: number;
  /** How far from `now` a timestamp may be, in seconds. Five minutes is conventional. */
  readonly toleranceSeconds?: number;
}): SignatureVerdict {
  const tolerance = options.toleranceSeconds ?? 300;
  const parsed = parseSignatureHeader(options.headerValue);
  if (!parsed.ok) {
    return {
      valid: false,
      checks: [
        {
          name: 'header',
          passed: false,
          what: 'The signature header parses into a timestamp and at least one digest.',
          detail: parsed.error,
        },
      ],
    };
  }

  const checks: SignatureCheck[] = [
    {
      name: 'header',
      passed: true,
      what: 'The signature header parses into a timestamp and at least one digest.',
      detail: `${parsed.value.signatures.length} v1 signature${parsed.value.signatures.length === 1 ? '' : 's'} present`,
    },
  ];

  const drift = options.nowSeconds - parsed.value.timestampSeconds;
  const fresh = Math.abs(drift) <= tolerance;
  checks.push({
    name: 'freshness',
    passed: fresh,
    what: `The timestamp is within ${tolerance} seconds of now, so a captured delivery cannot be replayed later.`,
    detail: `signed at ${parsed.value.timestampSeconds}, received at ${options.nowSeconds} (${drift >= 0 ? '+' : ''}${drift}s)`,
  });

  const payload = signingPayload(parsed.value.timestampSeconds, options.body);
  const expectedDigests = options.secrets.map((secret) => hmacSha256Hex(secret, payload));
  const matched = expectedDigests.some((expected) =>
    parsed.value.signatures.some((presented) => constantTimeEqual(expected, presented)),
  );
  checks.push({
    name: 'signature',
    passed: matched,
    what: 'HMAC-SHA256 over "timestamp.body", recomputed with each accepted secret and compared in constant time.',
    detail: matched
      ? 'a presented signature matched'
      : `presented ${parsed.value.signatures[0].slice(0, 16)}..., computed ${expectedDigests[0]?.slice(0, 16) ?? '(no secret)'}...`,
  });

  return {
    valid: checks.every((check) => check.passed),
    checks,
    ...(expectedDigests[0] === undefined ? {} : { expected: expectedDigests[0] }),
  };
}

/** The delivery request, signed and ready to send. */
export function webhookRequest(init: {
  readonly endpoint: string;
  readonly event: WebhookEvent;
  readonly secret: string;
  readonly timestampSeconds: number;
  /** Which attempt this is, counting from 1. Sent so the receiver can log it. */
  readonly attempt?: number;
}): HttpRequest {
  const body = eventBody(init.event);
  return {
    method: 'POST',
    target: init.endpoint,
    headers: [
      header('Content-Type', 'application/json'),
      header('Content-Length', `${byteLength(body)}`),
      header('User-Agent', 'ExampleAPI-Webhooks/1.0'),
      header('X-Webhook-Id', init.event.id),
      header('X-Webhook-Event', init.event.type),
      ...(init.attempt === undefined
        ? []
        : [header('X-Webhook-Attempt', `${init.attempt}`)]),
      header(
        SIGNATURE_HEADER,
        signWebhook({
          secret: init.secret,
          body,
          timestampSeconds: init.timestampSeconds,
        }),
      ),
    ],
    body,
  };
}

// ---------------------------------------------------------------------------
// Delivery and retry
// ---------------------------------------------------------------------------

/** What the receiver did, as the sender saw it. */
export type ReceiverReply =
  | {
      readonly kind: 'status';
      readonly status: number;
      readonly retryAfterSeconds?: number;
    }
  /** No reply at all. Indistinguishable, from the sender, from a success whose reply was lost. */
  | { readonly kind: 'timeout' };

/** What the sender decided after one attempt. */
export type AttemptOutcome =
  /** 2xx. Done. */
  | 'delivered'
  /** Failed, and worth trying again. */
  | 'retry'
  /** Failed in a way retrying cannot fix. */
  | 'permanent'
  /** Failed, retriable, and out of attempts. */
  | 'exhausted'
  /** The receiver said the endpoint is gone; stop and disable it. */
  | 'endpoint-gone';

/** One attempt. */
export interface DeliveryAttempt {
  /** Counting from 1, as the `X-Webhook-Attempt` header reports it. */
  readonly attempt: number;
  readonly atMs: number;
  readonly request: HttpRequest;
  readonly reply: ReceiverReply;
  readonly outcome: AttemptOutcome;
  /** Why the sender decided that. */
  readonly why: string;
  /** How long before the next attempt. Zero when there is none. */
  readonly waitMs: number;
  /** Whether that wait came from the receiver's Retry-After or the sender's own curve. */
  readonly waitSource: 'retry-after' | 'backoff' | 'none';
}

/** A whole delivery, however many attempts it took. */
export interface WebhookDelivery {
  readonly event: WebhookEvent;
  readonly attempts: readonly DeliveryAttempt[];
  readonly delivered: boolean;
  readonly finalOutcome: AttemptOutcome;
  readonly endedAtMs: number;
}

/**
 * Whether a reply is worth retrying.
 *
 * The rule is about *who can fix it*. A `500` is the receiver's problem and may be transient,
 * so retrying is polite and usually works. A `400` means the receiver looked at the payload
 * and rejected it; the payload will be identical next time, so retrying is a promise to fail
 * on a schedule.
 *
 * Two 4xx codes are exceptions and both are the receiver asking for exactly that: `408
 * Request Timeout` and `429 Too Many Requests` say "not now", not "not ever".
 *
 * `410 Gone` gets its own answer. It is the receiver saying the endpoint no longer exists,
 * and a sender that keeps a queue should disable the endpoint rather than retry -- which is
 * why senders eventually turn off webhook endpoints that fail for days.
 */
export function classifyReply(reply: ReceiverReply): {
  readonly outcome: AttemptOutcome;
  readonly why: string;
} {
  if (reply.kind === 'timeout') {
    return {
      outcome: 'retry',
      why: 'No reply arrived. The sender cannot tell whether the event was processed, so it retries -- which is precisely why the receiver must be idempotent.',
    };
  }
  const { status } = reply;
  if (status >= 200 && status < 300) {
    return {
      outcome: 'delivered',
      why: 'A 2xx means "I have taken responsibility for this event". Send it before doing slow work, not after.',
    };
  }
  if (status === 410) {
    return {
      outcome: 'endpoint-gone',
      why: '410 Gone: the receiver says this endpoint is permanently retired. Retrying is pointless and the endpoint should be disabled.',
    };
  }
  if (status === 408 || status === 429 || status >= 500) {
    return {
      outcome: 'retry',
      why:
        status === 429
          ? '429 asks for a slower pace, not a different payload. Retry, honouring Retry-After.'
          : status === 408
            ? '408 says the receiver ran out of time reading the request. The same payload may well succeed next time.'
            : 'A 5xx is the receiver failing, not the payload being wrong. It may be transient.',
    };
  }
  return {
    outcome: 'permanent',
    why: `A ${status} means the receiver read the payload and rejected it. The payload will be identical on every retry, so retrying only fails on a schedule.`,
  };
}

/** Everything a delivery run needs pinned down. */
export interface DeliveryOptions {
  readonly event: WebhookEvent;
  readonly endpoint: string;
  readonly secret: string;
  /** What the receiver does on each attempt, in order. */
  readonly replies: readonly ReceiverReply[];
  readonly backoff: BackoffOptions;
  readonly maxAttempts?: number;
  readonly startMs?: number;
  /** Virtual seconds since the epoch at `startMs`, for the signature timestamp. */
  readonly startSeconds?: number;
  /** Jitter source, when the backoff options ask for jitter. */
  readonly rng?: Rng;
}

/**
 * Deliver an event, retrying according to the policy above.
 *
 * Each attempt is signed **afresh**, with the timestamp of that attempt. Reusing the first
 * attempt's signature would mean a delivery retried beyond the receiver's tolerance window
 * arrives correctly signed and stale -- rejected for being a replay of itself. Re-signing is
 * not an optimisation; it is what makes retry and replay protection coexist.
 *
 * The event **id does not change** across attempts, which is the other half of the same
 * bargain: the receiver needs the signature to differ and the identity to stay put.
 */
export function deliverWebhook(options: DeliveryOptions): WebhookDelivery {
  const maxAttempts = options.maxAttempts ?? 5;
  const startMs = options.startMs ?? 0;
  const startSeconds = options.startSeconds ?? 0;
  const attempts: DeliveryAttempt[] = [];

  let now = startMs;
  let finalOutcome: AttemptOutcome = 'exhausted';

  for (let index = 0; index < maxAttempts; index += 1) {
    const reply = options.replies[index] ?? { kind: 'timeout' };
    const timestampSeconds = startSeconds + Math.floor((now - startMs) / 1000);
    const request = webhookRequest({
      endpoint: options.endpoint,
      event: options.event,
      secret: options.secret,
      timestampSeconds,
      attempt: index + 1,
    });

    const classified = classifyReply(reply);
    const isLast = index + 1 >= maxAttempts;
    const outcome: AttemptOutcome =
      classified.outcome === 'retry' && isLast ? 'exhausted' : classified.outcome;

    const retryAfterSeconds =
      reply.kind === 'status' ? reply.retryAfterSeconds : undefined;
    const shouldWait = outcome === 'retry';
    const waitMs = !shouldWait
      ? 0
      : retryAfterSeconds !== undefined
        ? retryAfterSeconds * 1000
        : backoffDelayMs(index, {
            ...options.backoff,
            rng: options.rng ?? options.backoff.rng,
          });

    attempts.push({
      attempt: index + 1,
      atMs: now,
      request,
      reply,
      outcome,
      why:
        outcome === 'exhausted'
          ? `${classified.why} No attempts remain, so the event is parked for manual replay rather than dropped.`
          : classified.why,
      waitMs,
      waitSource: !shouldWait
        ? 'none'
        : retryAfterSeconds !== undefined
          ? 'retry-after'
          : 'backoff',
    });

    finalOutcome = outcome;
    if (outcome !== 'retry') break;
    now += waitMs;
  }

  return {
    event: options.event,
    attempts,
    delivered: finalOutcome === 'delivered',
    finalOutcome,
    endedAtMs: now,
  };
}

// ---------------------------------------------------------------------------
// Idempotent receiving
// ---------------------------------------------------------------------------

/** What the receiver has already handled. Keyed by event id. */
export interface IdempotencyStore {
  /** Event ids already processed, with the result recorded for each. */
  readonly processed: Readonly<Record<string, JsonObject>>;
}

/** An empty store. */
export function createIdempotencyStore(): IdempotencyStore {
  return { processed: {} };
}

/** What happened when an event arrived. */
export interface ReceiveOutcome {
  readonly store: IdempotencyStore;
  /** True when the work ran; false when this was a duplicate and was skipped. */
  readonly processed: boolean;
  /** The result -- the recorded one on a duplicate, so both answers are identical. */
  readonly result: JsonObject;
  readonly why: string;
}

/**
 * Handle an event exactly once, however many times it is delivered.
 *
 * The pattern is three lines and is the entire answer to at-least-once delivery: look the
 * event id up, do the work only if it is new, record the result, and **return the recorded
 * result either way**. That last part is what makes the duplicate harmless from the sender's
 * side too -- it gets the same `200` and the same body, so nothing downstream can tell which
 * delivery did the work.
 *
 * The id must come from the sender and be stable across retries. A receiver that generated
 * its own key, or hashed the body, would break the moment the sender re-signed with a new
 * timestamp -- which, per {@link deliverWebhook}, is on every single retry.
 *
 * In production the store is a database row with a unique constraint on the event id, and the
 * insert and the work happen in one transaction. A `Map` consulted before the work is a race:
 * two concurrent deliveries of the same event both find nothing and both proceed.
 */
export function receiveEvent(
  store: IdempotencyStore,
  event: WebhookEvent,
  apply: (event: WebhookEvent) => JsonObject,
): ReceiveOutcome {
  const seen = store.processed[event.id];
  if (seen !== undefined) {
    return {
      store,
      processed: false,
      result: seen,
      why: `Event ${event.id} was already handled. The recorded result is returned unchanged, so the sender cannot tell this delivery from the first.`,
    };
  }
  const result = apply(event);
  return {
    store: { processed: { ...store.processed, [event.id]: result } },
    processed: true,
    result,
    why: `Event ${event.id} is new. The work runs once and the result is recorded against the id.`,
  };
}

/** What a receiver ought to do, in order. Rendered as a checklist. */
export interface ReceiverRule {
  readonly title: string;
  readonly what: string;
  /** What goes wrong when this step is skipped. */
  readonly otherwise: string;
}

/**
 * The receiver's checklist.
 *
 * Ordered as the handler should be written, and the order is load-bearing: verifying before
 * parsing is what keeps the raw bytes intact, and responding before doing slow work is what
 * keeps the sender from timing out and delivering the event a second time.
 */
export const RECEIVER_RULES: readonly ReceiverRule[] = [
  {
    title: 'Capture the raw body before anything parses it',
    what: 'The signature covers the exact bytes received. Take them first, verify, and parse afterwards.',
    otherwise:
      'A framework that parses and re-serialises the body changes key order or whitespace, and the signature fails -- intermittently, only for some payloads, which is the worst way for it to fail.',
  },
  {
    title: 'Verify the signature in constant time',
    what: 'Recompute the HMAC over "timestamp.body" and compare without short-circuiting.',
    otherwise:
      'A public endpoint an attacker can call repeatedly is exactly the setting a timing attack needs to recover a signature byte by byte.',
  },
  {
    title: 'Reject deliveries outside the tolerance window',
    what: 'A signature proves origin, not freshness. Refuse anything more than a few minutes old or in the future.',
    otherwise:
      'A captured delivery can be replayed verbatim, forever, and every signature check will pass.',
  },
  {
    title: 'Deduplicate on the event id',
    what: 'Insert the id with a unique constraint, in the same transaction as the work.',
    otherwise:
      'At-least-once delivery means duplicates are normal, not exceptional -- and the second copy of "payment succeeded" ships the order twice.',
  },
  {
    title: 'Respond 2xx quickly, then do the work',
    what: 'Acknowledge, enqueue, and return. Keep the handler under the sender’s timeout.',
    otherwise:
      'A slow handler times out, the sender retries an event that is already being processed, and load rises exactly when the receiver is already struggling.',
  },
  {
    title: 'Return 4xx for payloads you will never accept',
    what: 'A permanent rejection stops the retry queue. Reserve 5xx for failures that might pass next time.',
    otherwise:
      'A 500 on a malformed event asks the sender to redeliver it on a backoff curve for hours or days.',
  },
];
