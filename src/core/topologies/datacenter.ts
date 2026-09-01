/**
 * Datacenter -- what is behind one hostname.
 *
 * A visitor reaches a CDN edge in single-digit milliseconds; a cache miss costs 85 ms
 * across an ocean to reach an origin that is itself eleven machines in three tiers. The
 * scenario is built so those two numbers sit next to each other, because cache hit rate
 * is the difference between them.
 *
 * The tiers, and where each boundary earns its keep:
 *
 * - **CDN edge** terminates TLS and answers from cache. Its address is anycast: the same
 *   VIP is announced from every location, so routing alone sends each visitor to a near
 *   one, with no DNS trickery involved.
 * - **Load balancer** works at layer 4. It forwards TCP connections to healthy proxies
 *   and never reads the HTTP request, which is what lets it be fast and dumb.
 * - **Reverse proxies** work at layer 7. TLS terminates again here, for anything the CDN
 *   could not answer, and this is the last place the client's real address exists before
 *   it has to be carried in a header.
 * - **App tier** is stateless and therefore horizontally scalable: any app server can
 *   answer any request because none of them holds anything the others need.
 * - **Data tier** is where state actually lives, which is why it does not scale by adding
 *   machines the way the app tier does.
 *
 * Addressing is one RFC 1918 /24 per tier out of `10.40.0.0/16`, so a subnet says which
 * tier a machine belongs to at a glance.
 */

import type { Topology } from '../types/topology';

import { rfc, type ScenarioTopology } from './types';

const EDGE_SUBNET = '10.40.1.0/24';
const APP_SUBNET = '10.40.2.0/24';
const DATA_SUBNET = '10.40.3.0/24';

const topology: Topology = {
  nodes: [
    {
      id: 'visitor',
      kind: 'client',
      label: 'Visitor',
      ipv4: '203.0.113.7',
      detail: {
        Asked: 'DNS for app.example, and got an anycast address back',
        Behind: 'A home router doing NAPT',
        Connects: 'To whichever CDN edge routing puts nearest',
      },
    },
    {
      id: 'cdn-edge',
      kind: 'cdn-edge',
      label: 'CDN edge',
      ipv4: '203.0.113.200',
      detail: {
        'Address type': 'Anycast: the same VIP announced from every location',
        Terminates: 'TLS 1.3',
        Answers: 'Images, scripts, and anything else marked cacheable',
        'On a miss': 'Fetches from the origin, 85 ms away, and stores the result',
      },
    },
    {
      id: 'edge-lb',
      kind: 'load-balancer',
      label: 'Origin load balancer',
      ipv4: '192.0.2.20',
      detail: {
        'Public VIP': '192.0.2.20',
        'Internal address': '10.40.1.10',
        Layer: '4. It forwards TCP and never reads the HTTP request.',
        Algorithm: 'Least connections across healthy proxies',
        'Health check': 'TCP connect every 2 s; three misses removes a backend',
      },
    },
    {
      id: 'proxy-a',
      kind: 'proxy',
      label: 'Reverse proxy A',
      ipv4: '10.40.1.11',
      detail: {
        Tier: `Edge, ${EDGE_SUBNET}`,
        Terminates: 'TLS 1.3, then speaks plain HTTP/2 inward',
        Adds: 'Forwarded header carrying the original client address',
      },
    },
    {
      id: 'proxy-b',
      kind: 'proxy',
      label: 'Reverse proxy B',
      ipv4: '10.40.1.12',
      detail: {
        Tier: `Edge, ${EDGE_SUBNET}`,
        Terminates: 'TLS 1.3, then speaks plain HTTP/2 inward',
        Exists: 'So losing one proxy costs capacity, not availability',
      },
    },
    {
      id: 'app-1',
      kind: 'server',
      label: 'App server 1',
      ipv4: '10.40.2.21',
      detail: {
        Tier: `Application, ${APP_SUBNET}`,
        State: 'None. Session data lives in the cache, not in the process.',
        Health: 'GET /healthz, answered only when it can reach the database',
      },
    },
    {
      id: 'app-2',
      kind: 'server',
      label: 'App server 2',
      ipv4: '10.40.2.22',
      detail: {
        Tier: `Application, ${APP_SUBNET}`,
        State: 'None',
        Note: 'Identical to app server 1. That is the design, not a coincidence.',
      },
    },
    {
      id: 'app-3',
      kind: 'server',
      label: 'App server 3',
      ipv4: '10.40.2.23',
      detail: {
        Tier: `Application, ${APP_SUBNET}`,
        State: 'None',
        Scaling: 'Adding a fourth is a config change, not a migration',
      },
    },
    {
      id: 'cache',
      kind: 'server',
      label: 'In-memory cache',
      ipv4: '10.40.3.31',
      detail: {
        Tier: `Data, ${DATA_SUBNET}`,
        Holds: 'Sessions, rendered fragments, hot query results',
        Cost: '0.1 ms to ask, against 0.25 ms plus query time for the database',
      },
    },
    {
      id: 'db-primary',
      kind: 'server',
      label: 'Database primary',
      ipv4: '10.40.3.41',
      detail: {
        Tier: `Data, ${DATA_SUBNET}`,
        Accepts: 'Every write, and reads that must not be stale',
        Why: 'One writer keeps ordering unambiguous',
      },
    },
    {
      id: 'db-replica',
      kind: 'server',
      label: 'Database replica',
      ipv4: '10.40.3.42',
      detail: {
        Tier: `Data, ${DATA_SUBNET}`,
        Accepts: 'Read-only queries',
        Replication: 'Asynchronous, typically milliseconds behind',
        Placed: 'In a different availability zone, on purpose',
      },
    },
  ],
  links: [
    {
      id: 'visitor-edge',
      from: 'visitor',
      to: 'cdn-edge',
      latencyMs: 9,
      bandwidthMbps: 500,
      medium: 'fiber',
    },
    {
      id: 'edge-origin',
      from: 'cdn-edge',
      to: 'edge-lb',
      latencyMs: 85,
      bandwidthMbps: 100000,
      medium: 'fiber',
    },
    {
      id: 'lb-proxy-a',
      from: 'edge-lb',
      to: 'proxy-a',
      latencyMs: 0.15,
      bandwidthMbps: 25000,
      medium: 'ethernet',
    },
    {
      id: 'lb-proxy-b',
      from: 'edge-lb',
      to: 'proxy-b',
      latencyMs: 0.15,
      bandwidthMbps: 25000,
      medium: 'ethernet',
    },
    {
      id: 'proxy-a-app-1',
      from: 'proxy-a',
      to: 'app-1',
      latencyMs: 0.2,
      bandwidthMbps: 25000,
      medium: 'ethernet',
    },
    {
      id: 'proxy-a-app-2',
      from: 'proxy-a',
      to: 'app-2',
      latencyMs: 0.2,
      bandwidthMbps: 25000,
      medium: 'ethernet',
    },
    {
      id: 'proxy-b-app-2',
      from: 'proxy-b',
      to: 'app-2',
      latencyMs: 0.2,
      bandwidthMbps: 25000,
      medium: 'ethernet',
    },
    {
      id: 'proxy-b-app-3',
      from: 'proxy-b',
      to: 'app-3',
      latencyMs: 0.2,
      bandwidthMbps: 25000,
      medium: 'ethernet',
    },
    {
      id: 'app-1-cache',
      from: 'app-1',
      to: 'cache',
      latencyMs: 0.1,
      bandwidthMbps: 25000,
      medium: 'ethernet',
    },
    {
      id: 'app-2-cache',
      from: 'app-2',
      to: 'cache',
      latencyMs: 0.1,
      bandwidthMbps: 25000,
      medium: 'ethernet',
    },
    {
      id: 'app-3-cache',
      from: 'app-3',
      to: 'cache',
      latencyMs: 0.1,
      bandwidthMbps: 25000,
      medium: 'ethernet',
    },
    {
      id: 'app-1-db',
      from: 'app-1',
      to: 'db-primary',
      latencyMs: 0.25,
      bandwidthMbps: 25000,
      medium: 'ethernet',
    },
    {
      id: 'app-2-db',
      from: 'app-2',
      to: 'db-primary',
      latencyMs: 0.25,
      bandwidthMbps: 25000,
      medium: 'ethernet',
    },
    {
      id: 'app-3-db',
      from: 'app-3',
      to: 'db-primary',
      latencyMs: 0.25,
      bandwidthMbps: 25000,
      medium: 'ethernet',
    },
    {
      id: 'db-replication',
      from: 'db-primary',
      to: 'db-replica',
      latencyMs: 0.5,
      bandwidthMbps: 25000,
      medium: 'fiber',
    },
  ],
};

export const DATACENTER: ScenarioTopology = {
  id: 'datacenter',
  title: 'Datacenter',
  summary:
    'What one hostname is actually made of: a CDN edge, a load balancer, two proxies, three app servers, a cache, and a database that cannot be cloned.',
  teaches: [
    'CDN caching and anycast',
    'Where TLS terminates, and how often',
    'Layer 4 vs layer 7 load balancing',
    'Health checks and horizontal scaling',
    'Why the data tier does not scale like the app tier',
  ],
  topology,
  notes: [
    {
      targetId: 'visitor',
      text: 'The browser asked DNS for app.example and got back a single address that hundreds of machines answer to. It has no idea which one it reached, and does not need to: from here it is an ordinary TCP connection to an ordinary address.',
      reference: rfc(1035, 'Domain Names: Implementation and Specification'),
    },
    {
      targetId: 'cdn-edge',
      text: 'The edge answers from cache whenever the response says it may be cached, which for a typical site is most of the bytes and almost none of the interesting ones. Anycast means the same address is announced from every location the CDN operates, so ordinary BGP routing delivers each visitor to a nearby one. A hit costs 9 ms; a miss costs 9 plus the 85 below it, twice.',
      reference: rfc(9111, 'HTTP Caching'),
    },
    {
      targetId: 'edge-lb',
      text: 'The load balancer works at layer 4: it accepts a TCP connection to the public VIP and forwards it to a backend without ever parsing the HTTP request inside. Because it does not understand the request, it cannot route by URL, and because it does not understand the request, it is very fast. It health-checks each proxy and quietly stops sending to one that stops answering.',
      reference: rfc(3234, 'Middleboxes: Taxonomy and Issues'),
    },
    {
      targetId: 'proxy-a',
      text: 'This is the second place TLS terminates on the path. The CDN decrypted the request to decide whether it could answer, re-encrypted it to send onward, and the proxy decrypts it again to read the URL and pick a backend. Everything inward from here is plain HTTP/2 on a network the operator controls.',
      reference: rfc(8446, 'The Transport Layer Security (TLS) Protocol Version 1.3'),
    },
    {
      targetId: 'proxy-b',
      text: 'The application server never sees the visitor address: as far as its TCP stack is concerned the connection came from 10.40.1.12. The proxy therefore writes the original address into a Forwarded header, which is the only reason logs and rate limits downstream can tell one visitor from another.',
      reference: rfc(7239, 'Forwarded HTTP Extension'),
    },
    {
      targetId: 'app-1',
      text: 'The app tier builds the responses no cache could have answered. Any server can take any request because none of them holds session state locally, so a request routed here and the next one routed elsewhere behave identically.',
      reference: rfc(9110, 'HTTP Semantics'),
    },
    {
      targetId: 'app-2',
      text: 'Identical to its neighbours, deliberately. Horizontal scaling only works when servers are interchangeable, which means keeping every piece of per-user state somewhere shared: here, the cache. The moment one app server knows something the others do not, adding a fourth stops being free.',
    },
    {
      targetId: 'app-3',
      text: 'Adding capacity at this tier is a configuration change: start another identical server, let the health check pass, and the proxies start sending it work. That is what people mean by scaling out, and it is only this easy because the tier is stateless.',
    },
    {
      targetId: 'cache',
      text: 'Sessions, rendered fragments, and hot query results live here so that the app tier can stay interchangeable and the database can stay unbothered. Asking the cache costs 0.1 ms; asking the database costs the link plus however long the query takes, which is usually the larger number by far.',
    },
    {
      targetId: 'db-primary',
      text: 'One machine accepts every write, because a single writer is the simplest way to keep the order of changes unambiguous. This is also why the data tier does not scale the way the app tier does: adding app servers adds capacity, while adding database servers adds copies of a problem.',
    },
    {
      targetId: 'db-replica',
      text: 'The replica takes read-only queries and lives in a different availability zone, so a failure that takes out the primary is unlikely to take this out with it. Replication is asynchronous, so a read here can be a few milliseconds behind: fine for a product listing, wrong for the confirmation page after a write.',
    },
    {
      targetId: 'edge-origin',
      text: 'The most expensive link in the diagram by a factor of a hundred. Every request the CDN cannot answer pays 85 ms out and 85 ms back before the origin has even started work, which is why cache hit rate is the number worth optimising here and everything inside the datacenter is rounding error.',
    },
    {
      targetId: 'db-replication',
      text: 'Half a millisecond to a different availability zone: far enough that one power event or one flooded room is unlikely to take both, near enough that replication keeps up. That trade-off is the whole reason zones exist as a concept.',
    },
  ],
};
