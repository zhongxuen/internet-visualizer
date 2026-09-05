import { describe, expect, it } from 'vitest';

import { hmacSha256Hex } from './digest';
import { headerValue, type JsonObject } from './message';
import {
  AT_LEAST_ONCE_NOTE,
  classifyReply,
  createIdempotencyStore,
  deliverWebhook,
  eventBody,
  parseSignatureHeader,
  receiveEvent,
  RECEIVER_RULES,
  signingPayload,
  signWebhook,
  signWebhookWithKeys,
  SIGNATURE_HEADER,
  verifyWebhookSignature,
  webhookRequest,
  type ReceiverReply,
  type WebhookEvent,
} from './webhook';

const SECRET = 'whsec_a_scenario_literal';
const NOW = 1_700_000_000;

const event: WebhookEvent = {
  id: 'evt_7f3a',
  type: 'payment.succeeded',
  createdAt: NOW,
  data: { amount: 4999, currency: 'usd', customer: 'cus_1' },
};

const body = eventBody(event);
const signed = signWebhook({ secret: SECRET, body, timestampSeconds: NOW });

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

describe('signing', () => {
  it('binds the timestamp into the signed string', () => {
    expect(signingPayload(NOW, body)).toBe(`${NOW}.${body}`);
  });

  it('produces a t= and a v1= part', () => {
    expect(signed).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });

  it('is a real HMAC over "timestamp.body"', () => {
    expect(signed).toContain(hmacSha256Hex(SECRET, `${NOW}.${body}`));
  });

  it('changes when the timestamp changes, even for identical bytes', () => {
    // This is what makes replay detectable: the same body signed a second later is a
    // different signature, so a captured delivery cannot be re-sent as-is.
    expect(signWebhook({ secret: SECRET, body, timestampSeconds: NOW + 1 })).not.toBe(
      signed,
    );
  });

  it('emits one v1 per key during a rotation', () => {
    const rotating = signWebhookWithKeys({
      secrets: [SECRET, 'whsec_the_new_one'],
      body,
      timestampSeconds: NOW,
    });
    const parsed = parseSignatureHeader(rotating);
    expect(parsed.ok && parsed.value.signatures).toHaveLength(2);
  });
});

describe('parseSignatureHeader', () => {
  it('reads the timestamp and every signature', () => {
    expect(parseSignatureHeader(signed)).toEqual({
      ok: true,
      value: {
        timestampSeconds: NOW,
        signatures: [hmacSha256Hex(SECRET, `${NOW}.${body}`)],
      },
    });
  });

  it('ignores an unknown scheme, so a v2 can roll out without breaking v1 receivers', () => {
    const parsed = parseSignatureHeader(`${signed},v2=whatever`);
    expect(parsed.ok && parsed.value.signatures).toHaveLength(1);
  });

  it.each([
    ['no timestamp', 'v1=' + 'a'.repeat(64)],
    ['no signature', `t=${NOW}`],
    ['a signature of the wrong width', `t=${NOW},v1=abc`],
    ['an unparseable timestamp', `t=soon,v1=${'a'.repeat(64)}`],
    ['nonsense', 'hello'],
  ])('rejects a header with %s', (_label, value) => {
    expect(parseSignatureHeader(value).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Verifying
// ---------------------------------------------------------------------------

describe('verifyWebhookSignature', () => {
  const verify = (
    overrides: Partial<Parameters<typeof verifyWebhookSignature>[0]> = {},
  ) =>
    verifyWebhookSignature({
      body,
      headerValue: signed,
      secrets: [SECRET],
      nowSeconds: NOW,
      ...overrides,
    });

  it('accepts a genuine delivery', () => {
    const verdict = verify();
    expect(verdict.valid).toBe(true);
    expect(verdict.checks.every((check) => check.passed)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const tampered = body.replace('4999', '1');
    const verdict = verify({ body: tampered });
    expect(verdict.valid).toBe(false);
    expect(verdict.checks.find((check) => check.name === 'signature')?.passed).toBe(
      false,
    );
  });

  it('rejects the wrong secret', () => {
    expect(verify({ secrets: ['whsec_wrong'] }).valid).toBe(false);
  });

  it('rejects a re-serialised body, which is how real integrations break', () => {
    // Same JSON, different bytes: the keys are in the same order but the indentation is gone.
    const reserialised = JSON.stringify(JSON.parse(body));
    expect(reserialised).not.toBe(body);
    expect(verify({ body: reserialised }).valid).toBe(false);
  });

  it('rejects a replay from outside the tolerance window', () => {
    const verdict = verify({ nowSeconds: NOW + 301 });
    expect(verdict.valid).toBe(false);
    expect(verdict.checks.find((check) => check.name === 'freshness')?.passed).toBe(
      false,
    );
  });

  it('accepts a delivery inside the window', () => {
    expect(verify({ nowSeconds: NOW + 299 }).valid).toBe(true);
  });

  it('rejects a timestamp too far in the future as well as too far in the past', () => {
    // A sender's clock running ahead is indistinguishable from an attacker post-dating a
    // capture, so the tolerance is a window rather than a maximum age.
    expect(verify({ nowSeconds: NOW - 400 }).valid).toBe(false);
  });

  it('honours a custom tolerance', () => {
    expect(verify({ nowSeconds: NOW + 400, toleranceSeconds: 600 }).valid).toBe(true);
  });

  it('accepts either key during a rotation', () => {
    const rotating = signWebhookWithKeys({
      secrets: ['whsec_old', 'whsec_new'],
      body,
      timestampSeconds: NOW,
    });
    expect(verify({ headerValue: rotating, secrets: ['whsec_old'] }).valid).toBe(true);
    expect(verify({ headerValue: rotating, secrets: ['whsec_new'] }).valid).toBe(true);
    expect(verify({ headerValue: rotating, secrets: ['whsec_other'] }).valid).toBe(false);
  });

  it('reports the malformed header without pretending to check further', () => {
    const verdict = verify({ headerValue: 'garbage' });
    expect(verdict.valid).toBe(false);
    expect(verdict.checks).toHaveLength(1);
  });
});

describe('webhookRequest', () => {
  const delivery = webhookRequest({
    endpoint: 'https://app.example.com/hooks',
    event,
    secret: SECRET,
    timestampSeconds: NOW,
    attempt: 1,
  });

  it('is a POST carrying the event as JSON', () => {
    expect(delivery.method).toBe('POST');
    expect(headerValue(delivery.headers, 'Content-Type')).toBe('application/json');
    expect(delivery.body).toBe(body);
  });

  it('carries the signature and the stable event id', () => {
    expect(headerValue(delivery.headers, SIGNATURE_HEADER)).toBe(signed);
    expect(headerValue(delivery.headers, 'X-Webhook-Id')).toBe(event.id);
  });

  it('verifies against the body it actually sent', () => {
    const verdict = verifyWebhookSignature({
      body: delivery.body ?? '',
      headerValue: headerValue(delivery.headers, SIGNATURE_HEADER) ?? '',
      secrets: [SECRET],
      nowSeconds: NOW,
    });
    expect(verdict.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Retry policy
// ---------------------------------------------------------------------------

describe('classifyReply', () => {
  it.each([200, 201, 202, 204])('treats %i as delivered', (status) => {
    expect(classifyReply({ kind: 'status', status }).outcome).toBe('delivered');
  });

  it.each([500, 502, 503, 408, 429])('retries a %i', (status) => {
    expect(classifyReply({ kind: 'status', status }).outcome).toBe('retry');
  });

  it.each([400, 401, 403, 404, 422])('does not retry a %i', (status) => {
    expect(classifyReply({ kind: 'status', status }).outcome).toBe('permanent');
  });

  it('treats 410 Gone as a request to stop and disable the endpoint', () => {
    expect(classifyReply({ kind: 'status', status: 410 }).outcome).toBe('endpoint-gone');
  });

  it('retries a timeout, and says why that forces idempotency on the receiver', () => {
    const classified = classifyReply({ kind: 'timeout' });
    expect(classified.outcome).toBe('retry');
    expect(classified.why).toMatch(/idempotent/);
  });
});

describe('deliverWebhook', () => {
  const deliver = (replies: readonly ReceiverReply[], maxAttempts = 5) =>
    deliverWebhook({
      event,
      endpoint: 'https://app.example.com/hooks',
      secret: SECRET,
      replies,
      backoff: { baseMs: 1000, capMs: 30_000 },
      maxAttempts,
      startSeconds: NOW,
    });

  it('stops at the first 2xx', () => {
    const run = deliver([{ kind: 'status', status: 200 }]);
    expect(run.delivered).toBe(true);
    expect(run.attempts).toHaveLength(1);
    expect(run.attempts[0].waitMs).toBe(0);
  });

  it('retries a 500 on an exponential curve and succeeds', () => {
    const run = deliver([
      { kind: 'status', status: 500 },
      { kind: 'status', status: 503 },
      { kind: 'status', status: 200 },
    ]);
    expect(run.delivered).toBe(true);
    expect(run.attempts.map((attempt) => attempt.waitMs)).toEqual([1000, 2000, 0]);
    expect(run.attempts[0].waitSource).toBe('backoff');
  });

  it('honours Retry-After over its own curve', () => {
    const run = deliver([
      { kind: 'status', status: 429, retryAfterSeconds: 7 },
      { kind: 'status', status: 200 },
    ]);
    expect(run.attempts[0].waitMs).toBe(7000);
    expect(run.attempts[0].waitSource).toBe('retry-after');
  });

  it('gives up on a 400 immediately rather than failing on a schedule', () => {
    const run = deliver([{ kind: 'status', status: 400 }]);
    expect(run.attempts).toHaveLength(1);
    expect(run.finalOutcome).toBe('permanent');
    expect(run.delivered).toBe(false);
  });

  it('stops on 410 Gone', () => {
    const run = deliver([{ kind: 'status', status: 410 }]);
    expect(run.finalOutcome).toBe('endpoint-gone');
    expect(run.attempts).toHaveLength(1);
  });

  it('exhausts its attempts rather than retrying forever', () => {
    const run = deliver([], 4);
    expect(run.attempts).toHaveLength(4);
    expect(run.finalOutcome).toBe('exhausted');
    expect(run.attempts.at(-1)?.waitMs).toBe(0);
    expect(run.attempts.at(-1)?.why).toMatch(/manual replay/);
  });

  it('re-signs every attempt with that attempt’s timestamp', () => {
    const run = deliver([
      { kind: 'status', status: 500 },
      { kind: 'status', status: 500 },
      { kind: 'status', status: 200 },
    ]);
    const signatures = run.attempts.map((attempt) =>
      headerValue(attempt.request.headers, SIGNATURE_HEADER),
    );
    // Distinct signatures: a retry arriving an hour later must not be stale on arrival.
    expect(new Set(signatures).size).toBe(3);
  });

  it('keeps the event id identical across every attempt', () => {
    const run = deliver([
      { kind: 'timeout' },
      { kind: 'timeout' },
      { kind: 'status', status: 200 },
    ]);
    const ids = run.attempts.map((attempt) =>
      headerValue(attempt.request.headers, 'X-Webhook-Id'),
    );
    expect(new Set(ids)).toEqual(new Set([event.id]));
  });

  it('numbers the attempts for the receiver', () => {
    const run = deliver([{ kind: 'timeout' }, { kind: 'status', status: 200 }]);
    expect(
      run.attempts.map((attempt) =>
        headerValue(attempt.request.headers, 'X-Webhook-Attempt'),
      ),
    ).toEqual(['1', '2']);
  });

  it('caps the backoff', () => {
    const run = deliverWebhook({
      event,
      endpoint: 'https://app.example.com/hooks',
      secret: SECRET,
      replies: [],
      backoff: { baseMs: 1000, capMs: 4000 },
      maxAttempts: 6,
      startSeconds: NOW,
    });
    expect(run.attempts.map((attempt) => attempt.waitMs)).toEqual([
      1000, 2000, 4000, 4000, 4000, 0,
    ]);
  });

  it('replays identically', () => {
    const replies: readonly ReceiverReply[] = [
      { kind: 'status', status: 500 },
      { kind: 'status', status: 200 },
    ];
    expect(deliver(replies)).toEqual(deliver(replies));
  });
});

// ---------------------------------------------------------------------------
// Idempotent receiving
// ---------------------------------------------------------------------------

describe('receiveEvent', () => {
  const charge = (received: WebhookEvent): JsonObject => ({
    charged: received.data.amount as number,
  });

  it('does the work the first time', () => {
    const outcome = receiveEvent(createIdempotencyStore(), event, charge);
    expect(outcome.processed).toBe(true);
    expect(outcome.result).toEqual({ charged: 4999 });
  });

  it('skips the work on a redelivery', () => {
    const first = receiveEvent(createIdempotencyStore(), event, charge);
    let calls = 0;
    const second = receiveEvent(first.store, event, (received) => {
      calls += 1;
      return charge(received);
    });
    expect(second.processed).toBe(false);
    expect(calls).toBe(0);
  });

  it('returns the identical result, so the sender cannot tell the deliveries apart', () => {
    const first = receiveEvent(createIdempotencyStore(), event, charge);
    const second = receiveEvent(first.store, event, charge);
    expect(second.result).toEqual(first.result);
  });

  it('keys on the event id, not the body -- which changes on every retry', () => {
    // Re-signing means the delivery differs each attempt; only the id is stable.
    const first = receiveEvent(createIdempotencyStore(), event, charge);
    const redelivered = { ...event, createdAt: event.createdAt + 60 };
    expect(receiveEvent(first.store, redelivered, charge).processed).toBe(false);
  });

  it('processes a genuinely different event', () => {
    const first = receiveEvent(createIdempotencyStore(), event, charge);
    const other = { ...event, id: 'evt_other' };
    expect(receiveEvent(first.store, other, charge).processed).toBe(true);
  });

  it('never mutates the store it was given', () => {
    const store = createIdempotencyStore();
    receiveEvent(store, event, charge);
    expect(store.processed).toEqual({});
  });
});

describe('the receiver checklist', () => {
  it('names what goes wrong when each step is skipped', () => {
    expect(RECEIVER_RULES).toHaveLength(6);
    for (const rule of RECEIVER_RULES) {
      expect(rule.otherwise.length).toBeGreaterThan(40);
    }
  });

  it('puts capturing the raw body before verifying it', () => {
    const titles = RECEIVER_RULES.map((rule) => rule.title);
    expect(titles.findIndex((title) => title.includes('raw body'))).toBeLessThan(
      titles.findIndex((title) => title.includes('Verify')),
    );
  });

  it('states plainly that delivery is at-least-once', () => {
    expect(AT_LEAST_ONCE_NOTE).toMatch(/at-least-once, never exactly-once/);
  });
});
