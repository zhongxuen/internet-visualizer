import type { MetadataRoute } from 'next';

import { absoluteUrl, isProductionDeployment } from '@/lib/site';

/**
 * `robots.txt`, which says something different on a preview than in production.
 *
 * In production: crawl everything except two subtrees.
 *
 *  - **`/api/`** is the three diagnostics Route Handlers. They are `GET`-only and
 *    rate-limited, which makes them safe rather than crawlable: every hit is an
 *    outbound request from this deployment to a host named in the query string, and a
 *    crawler working through a sitemap of them would be the deployment scanning the
 *    Internet on someone else's behalf. That is the exact thing the module is built not
 *    to be able to do, and `Disallow` is the cheap half of saying so -- the rate
 *    limiter and the SSRF guard are the half that does not rely on anyone's good
 *    manners.
 *  - **`/demo`** is a development playground with no explanation around it.
 *
 * On a preview deployment: nothing at all. Every preview serves the same forty-odd URLs
 * as production under a hostname that stops existing when the branch merges, so an
 * indexed preview is duplicate content that turns into dead links. The sitemap is still
 * emitted -- it is useful to open by hand -- but nothing is invited to read it.
 */
export default function robots(): MetadataRoute.Robots {
  if (!isProductionDeployment()) {
    return {
      rules: { userAgent: '*', disallow: '/' },
    };
  }

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/demo'],
    },
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}
