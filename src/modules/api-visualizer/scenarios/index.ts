/**
 * The API Visualizer scenario catalogue.
 *
 * Seven runs, ordered so that each is the previous picture with one thing added:
 *
 * 1. `rest-crud` -- the five verbs and the statuses they earn. Everything after this is HTTP
 *    with something bolted on, so the something has to be recognisable first.
 * 2. `auth-bearer` -- add a credential. Change: some requests never reach the application.
 * 3. `oauth-authcode-pkce` -- add a third party. Change: the credential now has to be
 *    *obtained*, without the client ever seeing a password.
 * 4. `rate-limited` -- add scarcity. Change: a correct request is refused, and the refusal
 *    carries instructions.
 * 5. `paginated-collection` -- add a second page. Change: the collection stops holding still.
 * 6. `rest-vs-graphql` -- add a second way to ask. Change: the shape of the request becomes a
 *    design decision with a bill attached, in both directions.
 * 7. `webhook-delivery` -- reverse the arrow. Change: your endpoint is now a public URL, and
 *    everything you assumed about being the client stops being true.
 *
 * The scenario picker, the module, and the tests all read this list; nothing else hardcodes a
 * scenario id.
 *
 * Every one of these is a bundled fixture. There is no code path from any file in this folder
 * to a real network -- no `fetch`, no host parameter, and no address outside the ranges RFC
 * 5737 and RFC 2606 reserve so that examples can never be mistaken for the real thing.
 */

import type { ApiScenario } from '../sim/exchange';

import { AUTH_BEARER } from './auth-bearer';
import { OAUTH_AUTHCODE_PKCE } from './oauth-authcode-pkce';
import { PAGINATED_COLLECTION } from './paginated-collection';
import { RATE_LIMITED } from './rate-limited';
import { REST_CRUD } from './rest-crud';
import { REST_VS_GRAPHQL_SCENARIO } from './rest-vs-graphql';
import { WEBHOOK_DELIVERY } from './webhook-delivery';

export {
  AUTH_BEARER,
  OAUTH_AUTHCODE_PKCE,
  PAGINATED_COLLECTION,
  RATE_LIMITED,
  REST_CRUD,
  REST_VS_GRAPHQL_SCENARIO,
  WEBHOOK_DELIVERY,
};

export {
  API_HOST,
  AUDIENCE,
  ISSUER,
  RESOURCES,
  SCENARIO_EPOCH_SECONDS,
  SIGNING_SECRET,
  seedStore,
} from './common';

/** The ids this module offers, so a route param can be narrowed to one of them. */
export type ApiScenarioId =
  | 'rest-crud'
  | 'auth-bearer'
  | 'oauth-authcode-pkce'
  | 'rate-limited'
  | 'paginated-collection'
  | 'rest-vs-graphql'
  | 'webhook-delivery';

/** Every scenario, in teaching order. */
export const API_SCENARIOS: readonly ApiScenario[] = [
  REST_CRUD,
  AUTH_BEARER,
  OAUTH_AUTHCODE_PKCE,
  RATE_LIMITED,
  PAGINATED_COLLECTION,
  REST_VS_GRAPHQL_SCENARIO,
  WEBHOOK_DELIVERY,
];

/** The scenario the module opens on. */
export const DEFAULT_API_SCENARIO_ID: ApiScenarioId = 'rest-crud';

/** Look a scenario up by id; `undefined` for anything this module does not offer. */
export function getApiScenario(id: string): ApiScenario | undefined {
  return API_SCENARIOS.find((scenario) => scenario.id === id);
}
