/**
 * The Packet Journey scenario catalogue.
 *
 * Four runs across one network, in the order they build on each other: a complete TCP
 * conversation, the same journey without a connection, what a narrow link does to a
 * large datagram, and what a lossy one does to a reliable stream. The scenario picker,
 * the route, and the tests all read this list; nothing else hardcodes a scenario id.
 */

import type { JourneyScenario } from '../sim/journey';

import { FRAGMENTED_PACKET } from './fragmented-packet';
import { LOSSY_LINK } from './lossy-link';
import { TCP_WEB_REQUEST } from './tcp-web-request';
import { UDP_DNS_QUERY } from './udp-dns-query';

export { TCP_WEB_REQUEST, UDP_DNS_QUERY, FRAGMENTED_PACKET, LOSSY_LINK };
export {
  JOURNEY_TOPOLOGY,
  PATH_TO_ORIGIN,
  PATH_TO_RESOLVER,
  ACCESS_LINK_MTU,
  HOME_PUBLIC_IP,
  LAPTOP_IP,
} from './topology';

/** The ids this module offers, so a route param can be narrowed to one of them. */
export type PacketJourneyScenarioId =
  'tcp-web-request' | 'udp-dns-query' | 'fragmented-packet' | 'lossy-link';

/**
 * Every scenario, in teaching order.
 *
 * `tcp-web-request` first because it is the complete picture and everything after it is
 * that picture with one thing changed: the transport (`udp-dns-query`), the size of the
 * payload against the size of the link (`fragmented-packet`), or the reliability of the
 * link itself (`lossy-link`). Reordering them would break that.
 */
export const PACKET_JOURNEY_SCENARIOS: readonly JourneyScenario[] = [
  TCP_WEB_REQUEST,
  UDP_DNS_QUERY,
  FRAGMENTED_PACKET,
  LOSSY_LINK,
];

/** The scenario the module opens on. */
export const DEFAULT_JOURNEY_ID: PacketJourneyScenarioId = 'tcp-web-request';

/** Look up a scenario by id; `undefined` for anything this module does not offer. */
export function getJourneyScenario(id: string): JourneyScenario | undefined {
  return PACKET_JOURNEY_SCENARIOS.find((scenario) => scenario.id === id);
}
