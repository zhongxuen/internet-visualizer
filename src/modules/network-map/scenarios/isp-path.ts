/**
 * Scenario 3 — ISP path.
 *
 * Home router to ISP access to regional POP, then two ways out: one hop across an
 * Internet exchange to a CDN, or a transit path across 13 000 km of fibre to Frankfurt.
 *
 * The data itself lives in `@/core/topologies`; see `./home-lan.ts` for why.
 */

export { ISP_PATH } from '@/core/topologies';
