/**
 * `GET /api/diagnostics/reach?target=<url or hostname>`
 *
 * One HTTP `HEAD` request to the target, with timing. The only route where the address
 * the user chose is the address a socket is opened to, and therefore the one that runs
 * the full SSRF guard including post-resolution re-checking. The logic is in
 * `../_lib/reach.ts`.
 *
 * This is not a ping. See `REACH_NOT_ICMP` in that file for the sentence the UI shows.
 */

import { defaultDeps } from '../_lib/deps';
import { createReachHandler } from '../_lib/reach';

export const runtime = 'nodejs';

/** A live measurement is never cached or prerendered. */
export const dynamic = 'force-dynamic';

export const GET = createReachHandler(defaultDeps);
