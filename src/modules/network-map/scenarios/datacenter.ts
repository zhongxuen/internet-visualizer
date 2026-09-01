/**
 * Scenario 4 — Datacenter.
 *
 * What one hostname is actually made of: a CDN edge, a layer-4 load balancer, two
 * reverse proxies, three app servers, a cache, and a database that cannot be cloned.
 *
 * The data itself lives in `@/core/topologies`; see `./home-lan.ts` for why.
 */

export { DATACENTER } from '@/core/topologies';
