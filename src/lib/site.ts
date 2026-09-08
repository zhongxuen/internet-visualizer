/**
 * Where this deployment thinks it lives.
 *
 * `sitemap.xml`, `robots.txt`, `metadataBase` and every `og:url` need an absolute URL,
 * and an absolute URL is the one thing a Next app cannot work out from inside itself.
 * So it is resolved once, here, from the environment -- and the fallback chain is the
 * interesting part, because each link in it is a different deployment situation:
 *
 *  1. **`NEXT_PUBLIC_SITE_URL`** -- an explicit custom domain. Set this the moment the
 *     project has one, because nothing else in the chain knows about it: Vercel's own
 *     variables report the `*.vercel.app` hostname even when a custom domain is
 *     serving the same deployment, and a canonical link pointing at the wrong one of
 *     two hostnames is the classic way to split a site's search identity in half.
 *  2. **`VERCEL_PROJECT_PRODUCTION_URL`** -- the project's production hostname, which
 *     Vercel sets on *every* deployment including previews. That is exactly what a
 *     canonical URL wants: a preview should point search engines at production, not at
 *     itself.
 *  3. **`VERCEL_URL`** -- this specific deployment. Only reached when the project has
 *     no production domain yet.
 *  4. **`http://localhost:3000`** -- development, and the value the unit tests see.
 *
 * Neither Vercel variable carries a scheme, so both are prefixed with `https://`;
 * `NEXT_PUBLIC_SITE_URL` is expected to carry its own and is normalised either way.
 *
 * These are read on the server only -- `sitemap.ts`, `robots.ts` and the layout's
 * metadata all run there. `NEXT_PUBLIC_SITE_URL` keeps its prefix anyway so that a
 * client component may read it later without the variable having to be renamed and
 * re-documented in three places.
 */

/**
 * The subset of `process.env` this module reads. See the chain above.
 *
 * The index signature is not decoration: `process.env` is typed with one, and TypeScript
 * refuses to assign it to an interface whose properties are all optional unless the two
 * share a declared member ("weak type" detection). Without it, every call site that
 * relies on the default parameter fails to compile.
 */
export interface SiteEnv {
  readonly NEXT_PUBLIC_SITE_URL?: string | undefined;
  readonly VERCEL_ENV?: string | undefined;
  readonly VERCEL_PROJECT_PRODUCTION_URL?: string | undefined;
  readonly VERCEL_URL?: string | undefined;
  readonly [key: string]: string | undefined;
}

/** Development, and what the unit tests resolve to. */
export const LOCAL_SITE_URL = 'http://localhost:3000';

/** Strip trailing slashes so `${siteUrl()}/learn` never doubles one. */
function normalise(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * The origin this deployment should describe itself as, without a trailing slash.
 *
 * Returns a string rather than a `URL` because both callers -- `metadataBase` and the
 * sitemap -- want to concatenate, and because an invalid value should surface where it
 * was set rather than as a constructor throwing during a build.
 */
export function siteUrl(env: SiteEnv = process.env): string {
  const explicit = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) {
    return normalise(/^https?:\/\//i.test(explicit) ? explicit : `https://${explicit}`);
  }

  const vercelHost =
    env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || env.VERCEL_URL?.trim() || '';
  if (vercelHost) return normalise(`https://${vercelHost}`);

  return LOCAL_SITE_URL;
}

/** `siteUrl()` joined to a root-relative path. `absoluteUrl('/')` has no trailing slash. */
export function absoluteUrl(path: string, env: SiteEnv = process.env): string {
  const base = siteUrl(env);
  if (path === '/' || path === '') return base;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Whether this is the production deployment, as opposed to a preview or a local build.
 *
 * `robots.ts` is the only caller and uses it to keep preview deployments out of search
 * results entirely. That matters more here than for most projects: every preview serves
 * the same thirty-odd lesson URLs as production, so an indexed preview would be an
 * exact-duplicate copy of the whole site under a hostname that stops existing.
 *
 * Vercel sets `VERCEL_ENV` to `production`, `preview` or `development`. Absent -- a
 * local `next build`, or a self-hosted deployment -- is treated as production, because
 * the alternative is a self-hosted site that silently refuses to be indexed.
 */
export function isProductionDeployment(env: SiteEnv = process.env): boolean {
  const vercelEnv = env.VERCEL_ENV?.trim();
  return !vercelEnv || vercelEnv === 'production';
}
