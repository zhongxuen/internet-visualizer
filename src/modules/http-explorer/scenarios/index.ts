/**
 * The HTTP Explorer scenario catalogue.
 *
 * Seven runs against bundled fixture servers, ordered so that each is the previous
 * picture with one thing added:
 *
 * 1. `simple-get` -- one request, one response, and the blank line between them.
 *    Everything else is a variation on this, so it goes first.
 * 2. `post-form` -- add a body. Change: the method stops promising to be harmless.
 * 3. `redirect-chain` -- add a forwarding address. Change: one link costs three requests.
 * 4. `conditional-request` -- add two caches. Change: the interesting answer has no body.
 * 5. `cookie-session` -- add memory. Change: the server knows who is asking, and one
 *    attribute decides who else can make it think that.
 * 6. `cors-preflight` -- add a second origin. Change: the request is sent and the
 *    *response* is blocked, which is the misconception the whole scenario exists for.
 * 7. `http2-multiplexing` -- add thirteen more requests and two more protocol versions.
 *    Change: the bottleneck stops being HTTP and starts being what is underneath it.
 *
 * The scenario picker, the route, and the tests all read this list; nothing else
 * hardcodes a scenario id.
 *
 * Every origin here is a fixture in the repository. There is no code path from any of
 * these files to a real network.
 */

import type { HttpScenario } from '../sim/exchange';

import { CONDITIONAL_REQUEST } from './conditional-request';
import { COOKIE_SESSION } from './cookie-session';
import { CORS_PREFLIGHT } from './cors-preflight';
import { HTTP2_MULTIPLEXING } from './http2-multiplexing';
import { POST_FORM } from './post-form';
import { REDIRECT_CHAIN } from './redirect-chain';
import { SIMPLE_GET } from './simple-get';

export {
  SIMPLE_GET,
  POST_FORM,
  REDIRECT_CHAIN,
  CONDITIONAL_REQUEST,
  COOKIE_SESSION,
  CORS_PREFLIGHT,
  HTTP2_MULTIPLEXING,
};
export { PAGE_RESOURCES } from './http2-multiplexing';
export {
  FIXTURE_ADDRESSES,
  HTTP_CLOCK,
  SCENARIO_EPOCH,
  daysBefore,
  secondsAfter,
} from './common';

/** The ids this module offers, so a route param can be narrowed to one of them. */
export type HttpScenarioId =
  | 'simple-get'
  | 'post-form'
  | 'redirect-chain'
  | 'conditional-request'
  | 'cookie-session'
  | 'cors-preflight'
  | 'http2-multiplexing';

/** Every scenario, in teaching order. */
export const HTTP_SCENARIOS: readonly HttpScenario[] = [
  SIMPLE_GET,
  POST_FORM,
  REDIRECT_CHAIN,
  CONDITIONAL_REQUEST,
  COOKIE_SESSION,
  CORS_PREFLIGHT,
  HTTP2_MULTIPLEXING,
];

/** The scenario the module opens on. */
export const DEFAULT_HTTP_SCENARIO_ID: HttpScenarioId = 'simple-get';

/** Look a scenario up by id; `undefined` for anything this module does not offer. */
export function getHttpScenario(id: string): HttpScenario | undefined {
  return HTTP_SCENARIOS.find((scenario) => scenario.id === id);
}
