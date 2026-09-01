/**
 * Scenario 1 — Home LAN.
 *
 * The first network the module offers, and the one every later scenario is measured
 * against: three devices, one private /24, one public address.
 *
 * The data itself lives in `@/core/topologies` rather than here. Phase 06 animates
 * packets across this same topology and phase 13 teaches from the same notes, and a
 * module may not import from another module — so the shared half sits in `core` and this
 * file records that the Network Map offers it. See `src/core/topologies/README.md`.
 */

export { HOME_LAN } from '@/core/topologies';
