/**
 * Which run produces which status code.
 *
 * `StatusCodeMap` draws the whole 1xx-5xx grid, and the codes this module can actually
 * put on screen are clickable: pick one and the module loads something that produces it.
 * That mapping has to live somewhere, and the two candidates were both worse than a table.
 * Deriving it would mean running all seven scenarios on mount, which is a discrete-event
 * simulation of fourteen resources across three protocol versions and not something to do
 * for a tooltip. Inlining it in the component would put a claim about the simulation
 * inside a file that never runs one.
 *
 * So it is data here, and `statuses.test.ts` runs every entry and asserts the status it
 * claims really appears. A wrong row fails the build rather than sending somebody to a
 * run that does not contain what they clicked on.
 */

import type { RequestDraft } from './builder';
import type { HttpScenarioId } from './scenarios';

/** Where a learner is sent when they click a code on the map. */
export type StatusSource =
  /** One of the seven authored scenarios produces it. */
  | {
      readonly kind: 'scenario';
      readonly scenarioId: HttpScenarioId;
      /** One line: what to watch for once the run loads. */
      readonly how: string;
    }
  /** The request builder produces it, from this draft. */
  | {
      readonly kind: 'builder';
      readonly draft: Partial<RequestDraft>;
      readonly how: string;
    };

/**
 * Every code this module can reach, and the shortest route to it.
 *
 * Deliberately not every code in the registry: `StatusCodeMap` draws the registry from
 * `STATUS_SEMANTICS` and only marks these ones as reachable, because a grid where every
 * cell looks clickable and half of them do nothing is worse than a grid that is honest
 * about which half is live.
 */
export const STATUS_SOURCES: Readonly<Record<number, StatusSource>> = {
  200: {
    kind: 'scenario',
    scenarioId: 'simple-get',
    how: 'One GET, answered in full. The whole module is a variation on this picture.',
  },
  201: {
    kind: 'scenario',
    scenarioId: 'post-form',
    how: 'A POST that created something. Location names what was made, not where to go.',
  },
  204: {
    kind: 'scenario',
    scenarioId: 'cors-preflight',
    how: 'The browser’s own OPTIONS, answered with permission and no content at all.',
  },
  301: {
    kind: 'scenario',
    scenarioId: 'redirect-chain',
    how: 'The first hop. Permanent, heuristically cacheable, and therefore remembered.',
  },
  302: {
    kind: 'scenario',
    scenarioId: 'redirect-chain',
    how: 'The second hop. Specified to keep the method; implemented to rewrite POST to GET.',
  },
  303: {
    kind: 'scenario',
    scenarioId: 'redirect-chain',
    how: 'The one that always switches to GET, on purpose -- POST/redirect/GET.',
  },
  304: {
    kind: 'scenario',
    scenarioId: 'conditional-request',
    how: 'A revalidation confirmed. Look for the response with fields and no body.',
  },
  401: {
    kind: 'builder',
    draft: { target: '/account' },
    how: 'A cookie-gated page, asked for before logging in. 401 means "not yet", and the WWW-Authenticate field says how to become allowed.',
  },
  403: {
    kind: 'scenario',
    scenarioId: 'cookie-session',
    how: 'The cross-site request that arrived without its cookie. Not "log in" -- "no".',
  },
  404: {
    kind: 'builder',
    draft: { target: '/nowhere' },
    how: 'A path the sandbox has no route for.',
  },
  405: {
    kind: 'builder',
    draft: { method: 'GET', target: '/login' },
    how: 'A route that exists, asked for a method it does not allow. Read the Allow field.',
  },
  500: {
    kind: 'builder',
    draft: { target: '/boom' },
    how: 'The request was fine and the server was not. Retrying it unchanged is reasonable.',
  },
};

/** Where to go for a code, or `undefined` when nothing here produces it. */
export function sourceForStatus(code: number): StatusSource | undefined {
  return STATUS_SOURCES[code];
}

/** Every code the map should draw as reachable. */
export const REACHABLE_STATUS_CODES: readonly number[] = Object.keys(STATUS_SOURCES)
  .map(Number)
  .sort((a, b) => a - b);
