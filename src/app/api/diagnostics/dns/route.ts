/**
 * `GET /api/diagnostics/dns?target=<hostname>&type=<A|AAAA|MX|NS|TXT|CNAME>`
 *
 * A live DNS lookup, run over DNS-over-HTTPS from this server against one allow-listed
 * public resolver. The logic is in `../_lib/dns.ts`; this file exists to bind it to a
 * URL and to say `nodejs`, because the guard resolves names with `node:dns`.
 *
 * `GET` only. Next answers every other method with 405 on its own, and a `GET` has no
 * body -- which is one of the four reasons a list of targets has nowhere to arrive.
 */

import { defaultDeps } from '../_lib/deps';
import { createDnsHandler } from '../_lib/dns';

export const runtime = 'nodejs';

/** A live measurement is never cached or prerendered. */
export const dynamic = 'force-dynamic';

export const GET = createDnsHandler(defaultDeps);
