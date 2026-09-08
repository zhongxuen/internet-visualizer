import createMDX from '@next/mdx';
import type { NextConfig } from 'next';

import { cspModeFromEnv, securityHeaders } from './src/lib/securityHeaders';

/**
 * MDX is on so that phase 13's lessons can be prose with live simulations embedded in
 * it, rather than prose *about* simulations. `.mdx` files are only ever **imported**
 * here -- the lessons live in `src/modules/learning-center/content/lessons/` and are
 * rendered by the `/learn/[track]/[lesson]` route, never by file-based routing -- but
 * `pageExtensions` still lists `mdx` so the two spellings cannot disagree if a lesson
 * is ever promoted to its own page.
 *
 * Plugins are named by string, not imported: Turbopack runs the MDX pipeline in Rust
 * and cannot be handed a JavaScript function (see the Next 16 MDX guide,
 * "Using Plugins with Turbopack"). `remark-gfm` is here for tables and strikethrough,
 * both of which lessons use for wire formats and header lists.
 */
const nextConfig: NextConfig = {
  pageExtensions: ['ts', 'tsx', 'js', 'jsx', 'mdx'],

  /**
   * Security headers, on every response.
   *
   * `source: '/:path*'` rather than a list, because the set of things worth protecting
   * is "everything this deployment serves" -- pages, the diagnostics Route Handlers,
   * the OG image, and the build's own static assets. A header set that enumerated
   * routes would be a header set that a new route could be added outside of.
   *
   * The policy itself is in `src/lib/securityHeaders.ts` with the argument for each
   * directive; this file only decides *when*. Two conditions are decided here and
   * nowhere else:
   *
   *  - `development` loosens `script-src` and `connect-src` for Turbopack's evaluator
   *    and its Fast Refresh socket. Reading `NODE_ENV` is correct rather than lazy:
   *    `next build` sets it to `production` regardless of which environment the build
   *    is for, so a preview deployment gets the same policy production does, which is
   *    the whole point of having previews.
   *  - `CSP_MODE=report-only` switches the header name so a policy change can be
   *    watched before it can break anything. See `.env.example` for the rollout.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders({
          mode: cspModeFromEnv(),
          development: process.env.NODE_ENV === 'development',
          reportUri: process.env.CSP_REPORT_URI,
        }),
      },
    ];
  },
};

const withMDX = createMDX({
  options: {
    remarkPlugins: ['remark-gfm'],
  },
});

export default withMDX(nextConfig);
