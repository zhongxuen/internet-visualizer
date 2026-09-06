/**
 * Tests for the pieces the three routes share: the response envelope, the status
 * mapping, and the "exactly one target" parameter reader.
 *
 * The mapping test is exhaustive over `GuardDenialReason` on purpose. Adding a reason
 * to the guard without deciding what status it deserves is exactly the kind of omission
 * that would surface as an accidental 500 in production, so the table is checked as a
 * table rather than one entry at a time.
 */

import { describe, expect, it } from 'vitest';

import { deny, type GuardDenialReason } from '@/core/net/guard';
import { createRateLimiter } from '@/core/net/ratelimit';

import { PLURAL_PARAMS, readOptionalParam, readSingleParam } from '../_lib/request';
import {
  codeForDenial,
  respondDenied,
  respondError,
  respondOk,
  respondRateLimited,
  statusForDenial,
} from '../_lib/respond';
import { bodyOf } from './harness';

/** Every reason the guard can return. Kept here so a new one fails this file first. */
const ALL_REASONS: GuardDenialReason[] = [
  'malformed-input',
  'blocked-scheme',
  'blocked-port',
  'credentials-in-url',
  'ambiguous-host',
  'malformed-host',
  'blocked-hostname',
  'blocked-address',
  'resolution-failed',
  'timeout',
  'no-addresses',
  'blocked-resolved-address',
  'too-many-redirects',
  'response-too-large',
];

function url(query: string): URL {
  return new URL(`https://visualizer.test/api/diagnostics/dns?${query}`);
}

describe('the guard reason -> HTTP status mapping', () => {
  it('has a status and a code for every reason the guard can give', () => {
    for (const reason of ALL_REASONS) {
      const denial = deny(reason, 'because');
      expect(statusForDenial(denial), reason).toBeTypeOf('number');
      expect(statusForDenial(denial), reason).toBeGreaterThanOrEqual(400);
      expect(codeForDenial(denial), reason).toBeTypeOf('string');
    }
  });

  it('separates "that is not a target" (400) from "this server will not go there" (403)', () => {
    const typos: GuardDenialReason[] = [
      'malformed-input',
      'malformed-host',
      'ambiguous-host',
      'credentials-in-url',
    ];
    const boundary: GuardDenialReason[] = [
      'blocked-scheme',
      'blocked-port',
      'blocked-hostname',
      'blocked-address',
      'blocked-resolved-address',
    ];

    for (const reason of typos) {
      expect(statusForDenial(deny(reason, 'x')), reason).toBe(400);
      expect(codeForDenial(deny(reason, 'x')), reason).toBe('invalid-target');
    }
    for (const reason of boundary) {
      expect(statusForDenial(deny(reason, 'x')), reason).toBe(403);
      expect(codeForDenial(deny(reason, 'x')), reason).toBe('blocked-target');
    }
  });

  it('maps a timeout to 504 and an oversized or looping response to 502', () => {
    expect(statusForDenial(deny('timeout', 'x'))).toBe(504);
    expect(statusForDenial(deny('response-too-large', 'x'))).toBe(502);
    expect(statusForDenial(deny('too-many-redirects', 'x'))).toBe(502);
    expect(statusForDenial(deny('no-addresses', 'x'))).toBe(404);
  });
});

describe('the response envelope', () => {
  it('carries the denial reason, address, and scope through to the body', async () => {
    const response = respondDenied(
      deny('blocked-address', '10.0.0.1 is private', {
        address: '10.0.0.1',
        scope: 'private',
        metadataEndpoint: 'AWS instance metadata',
      }),
    );
    const body = await bodyOf(response);

    expect(response.status).toBe(403);
    expect(body).toMatchObject({
      ok: false,
      error: {
        code: 'blocked-target',
        reason: 'blocked-address',
        message: '10.0.0.1 is private',
        address: '10.0.0.1',
        scope: 'private',
        metadataEndpoint: 'AWS instance metadata',
      },
    });
    expect(Number.isNaN(Date.parse(body.requestedAt))).toBe(false);
  });

  it('omits the optional fields entirely when the guard did not set them', async () => {
    const body = await bodyOf(respondDenied(deny('malformed-input', 'nope')));
    expect(Object.keys(body.error)).toEqual(['code', 'message', 'reason']);
  });

  it('never lets a live answer be cached', async () => {
    const ok = respondOk(
      { value: 1 },
      {
        requestedAt: new Date().toISOString(),
        elapsedMs: 1,
        source: { kind: 'doh', name: 'x', endpoint: 'https://x.test/', note: 'x' },
      },
    );
    expect(ok.headers.get('Cache-Control')).toBe('no-store');
    expect(respondError('timeout', 'x', 504).headers.get('Cache-Control')).toBe(
      'no-store',
    );
  });

  it('gives a 429 the Retry-After and X-RateLimit headers the UI counts down with', async () => {
    const limiter = createRateLimiter({
      client: { limit: 1, windowMs: 60_000, burst: 1 },
      global: null,
    });
    limiter.take('client');
    const decision = limiter.take('client');

    expect(decision.allowed).toBe(false);
    const response = respondRateLimited(decision);
    const body = await bodyOf(response);

    expect(response.status).toBe(429);
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
    expect(response.headers.get('X-RateLimit-Limit')).toBe('1');
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(body.error.code).toBe('rate-limited');
    expect(body.error.retryAfterSeconds).toBe(decision.retryAfterSeconds);
  });

  it('names the global bucket when the deployment, not the client, is at its limit', async () => {
    const limiter = createRateLimiter({
      client: { limit: 10, windowMs: 60_000, burst: 10 },
      global: { limit: 1, windowMs: 60_000, burst: 1 },
    });
    limiter.take('a');
    const decision = limiter.take('b');

    expect(decision.limitedBy).toBe('global');
    const body = await bodyOf(respondRateLimited(decision));
    expect(body.error.message).toContain('deployment');
  });
});

describe('readSingleParam', () => {
  it('accepts exactly one value', () => {
    const result = readSingleParam(url('target=example.com'), 'target');
    expect(result).toEqual({ allowed: true, value: 'example.com' });
  });

  it('refuses a missing value', () => {
    const result = readSingleParam(url('type=A'), 'target');
    expect(result.allowed).toBe(false);
  });

  it('refuses a repeated parameter rather than answering for the first', () => {
    const result = readSingleParam(
      url('target=a.example.com&target=b.example.com'),
      'target',
    );
    expect(result.allowed).toBe(false);
    if (result.allowed) return;
    expect(result.detail).toContain('exactly one target');
  });

  it('refuses every plural-looking parameter by name', () => {
    for (const plural of PLURAL_PARAMS) {
      const result = readSingleParam(url(`target=example.com&${plural}=a,b`), 'target');
      expect(result.allowed, plural).toBe(false);
      if (result.allowed) continue;
      expect(result.detail, plural).toContain('exactly one target');
    }
  });
});

describe('readOptionalParam', () => {
  it('returns undefined when the parameter is absent', () => {
    expect(readOptionalParam(url('target=example.com'), 'type')).toEqual({
      allowed: true,
      value: undefined,
    });
  });

  it('refuses a repeated parameter', () => {
    expect(readOptionalParam(url('type=A&type=TXT'), 'type').allowed).toBe(false);
  });
});
