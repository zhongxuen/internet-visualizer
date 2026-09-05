/**
 * Scenario 4 -- a bucket with five tokens, and nine requests that want them.
 *
 * The bucket holds five and refills at one per second. A client that wants nine requests as
 * fast as it can send them gets the first five for nothing, is refused, and then discovers
 * what the limit actually is.
 *
 * Two things are worth watching for.
 *
 * **A refusal costs no token.** Look at the meter across a `429`: it does not move. A limiter
 * that decremented on refusal would punish a client for being refused, and a client retrying
 * in a tight loop could hold its own bucket empty indefinitely.
 *
 * **`Retry-After` beats the client's own curve.** The client's exponential backoff is a guess
 * made in the absence of information. `Retry-After` is the server saying exactly when a token
 * will exist. This scenario runs the same client twice -- once obeying the server, once
 * insisting on its own schedule -- and the second run is the failure mode: it either waits far
 * longer than it needed to or retries too early and is refused again. Backoff is for when the
 * server said nothing, which is precisely when a guess is all there is.
 *
 * The `429` is produced by the gateway and the application node stays dark for the whole
 * exchange. That is not a simplification. Rate limiting is an edge concern, which is why it is
 * cheap to enforce and why "my handler was never called" is the correct mental model.
 */

import { createBucket } from '../sim/ratelimit';
import type { ApiScenario } from '../sim/exchange';

import { API_HOST } from './common';

/** Nine requests at a bucket that holds five. */
export const RATE_LIMITED: ApiScenario = {
  id: 'rate-limited',
  title: 'Rate limiting: the token bucket',
  summary:
    'Five tokens, refilling at one a second, and a client that wants nine requests now. ' +
    'The meter empties, the 429 arrives with Retry-After, and the client paces itself back ' +
    'into the allowance -- then the same client is run again ignoring the instruction.',
  teaches: [
    'The bucket is a level and a timestamp, computed on arrival -- there is no timer anywhere',
    'Capacity is the burst; the refill rate is the sustained limit. They are different numbers',
    'A refused request costs no token, or a client could hold its own bucket empty',
    'Retry-After turns a refusal into an instruction, and is a delta rather than a date because clocks disagree',
    'RateLimit-* fields are advisory and are sent on success too -- learning the limit by hitting it is learning it too late',
    'Only 429 and Retry-After are settled; the RateLimit-* family is a draft and X-RateLimit-* is nothing at all',
  ],
  apiHost: API_HOST,
  conditions: { rttMs: 70 },
  plan: {
    kind: 'rate-limit',
    // Five and one-per-second: small enough that the whole story fits on one timeline, and
    // the same shape as a real limiter at any scale.
    bucket: createBucket({ capacity: 5, refillPerSecond: 1, atMs: 0 }),
    target: '/articles',
    method: 'GET',
    requests: 9,
    // The client is not being abusive; it is being ordinary. It wants nine pages of a list.
    spacingMs: 150,
    backoff: { baseMs: 500, capMs: 8_000, jitter: 'none' },
    maxAttempts: 5,
    headerStyle: 'draft-fields',
    compareIgnoringRetryAfter: true,
  },
  notes: [
    {
      phase: 'request-1',
      text: 'The bucket starts full, so the first requests cost nothing and the limit is invisible. That is how integrations get written against a limit nobody has met, and why the RateLimit-* fields are sent on successful responses as well: a client that only learns its remaining quota when it is refused has learned it too late to do anything but retry.',
      reference: { rfc: 9110, section: '10.2.3', title: 'HTTP Semantics: Retry-After' },
    },
    {
      phase: 'request-6',
      text: 'The first 429. Read its fields: Retry-After says how many seconds until a token exists, and it is a delta rather than an HTTP-date on purpose -- a client whose clock runs two minutes fast would compute a negative wait from a timestamp and hammer the server immediately. Note also that the response came from the gateway. The application server never saw this request.',
      reference: {
        rfc: 6585,
        section: '4',
        title: 'Additional HTTP Status Codes: 429 Too Many Requests',
      },
    },
    {
      phase: 'request-7',
      text: 'Watch the meter across the refusal above: it does not fall. A refused request costs nothing, which is what stops a client in a retry loop from starving itself -- and what makes the limiter cheap, since saying no is arithmetic on two numbers rather than work.',
    },
    {
      phase: 'request-9',
      text: 'By now the client is pacing itself at roughly the refill rate, which is the behaviour the limiter was trying to produce. Compare the run beside it that ignores Retry-After: the same nine requests take longer and cost more refusals, because an exponential curve chosen in advance cannot know when a token appears and the server can.',
    },
  ],
};
