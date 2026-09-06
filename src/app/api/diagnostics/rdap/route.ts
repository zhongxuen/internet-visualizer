/**
 * `GET /api/diagnostics/rdap?target=<domain or IP>`
 *
 * Registration data for one domain or one address, discovered through IANA's RDAP
 * bootstrap registry rather than through port-43 WHOIS. The logic is in
 * `../_lib/rdap.ts`; this file binds it to a URL.
 *
 * The handler is built once per instance so its bootstrap cache is shared by the
 * requests that instance serves, rather than refetched per request.
 */

import { defaultDeps } from '../_lib/deps';
import { createRdapHandler } from '../_lib/rdap';

export const runtime = 'nodejs';

/** A live measurement is never cached or prerendered. */
export const dynamic = 'force-dynamic';

export const GET = createRdapHandler(defaultDeps);
