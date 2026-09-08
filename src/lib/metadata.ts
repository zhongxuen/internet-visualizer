import type { Metadata } from 'next';

import { absoluteUrl, isProductionDeployment } from './site';

/**
 * How every route in the product describes itself to a crawler and to a link unfurler.
 *
 * There are three places page metadata is written -- the root layout, a module page via
 * `moduleMetadata`, and the two Learning Center routes -- and before this file they
 * agreed on a title and on nothing else. {@link pageMetadata} is the shared shape, so
 * adding a field (a canonical, an `og:url`, a Twitter card type) happens once and
 * reaches all forty-odd routes.
 *
 * ## Why the image is named here rather than left to the file convention
 *
 * `src/app/opengraph-image.tsx` is a file convention, and the obvious expectation is
 * that Next attaches it to every route beneath the root. It does not, quite: metadata
 * objects from nested segments are **shallowly** merged, so a segment that defines
 * `openGraph` at all replaces the parent's whole `openGraph` object -- the injected
 * image included. Every route in this product defines `openGraph`, because a shared
 * link that unfurled with the site's name instead of the page's would be the point of
 * the exercise missed. So the image is named explicitly, in {@link OG_IMAGE}, and the
 * root does the same thing rather than a second thing.
 *
 * The cost of naming it is losing the content-hash query Next appends to the
 * file-convention URL. That hash is a cache-buster and buys nothing here: the route is
 * served `Cache-Control: public, max-age=0, must-revalidate`, so a scraper revalidates
 * on every fetch regardless.
 */

/**
 * The one Open Graph card, in the shape `openGraph.images` and `twitter.images` want.
 *
 * `url` is root-relative and resolved against `metadataBase`. The dimensions are
 * repeated from `opengraph-image.tsx` -- which imports them back from here, so there is
 * one pair of numbers and the `<meta og:image:width>` cannot disagree with the pixels.
 */
export const OG_IMAGE = {
  url: '/opengraph-image',
  width: 1200,
  height: 630,
  type: 'image/png',
  alt: 'Internet Visualizer — interactive, visual explanations of DNS, HTTP, TLS and TCP/IP',
} as const;

/** The product name, in the one place the title template and `og:site_name` share. */
export const SITE_NAME = 'Internet Visualizer';

/** The one-line description, used wherever a route has not written its own. */
export const SITE_DESCRIPTION =
  'An interactive, visual explanation of how the Internet works -- DNS, HTTP, TLS, TCP/IP and more, as live simulations rather than text.';

export interface PageMetadataInput {
  /** The route's own title. The root layout's template appends the product name. */
  readonly title: string;
  readonly description: string;
  /** Root-relative path, e.g. `/dns-explorer`. Becomes the canonical and `og:url`. */
  readonly path: string;
}

/**
 * Title, description, canonical URL, Open Graph and Twitter, from one page's facts.
 *
 * `alternates.canonical` is given as a root-relative path on purpose: Next resolves it
 * against `metadataBase`, which is resolved from the environment in `site.ts`. So a
 * preview deployment emits canonicals pointing at production -- the correct answer for
 * a hostname that serves an identical copy of the site and then stops existing.
 */
export function pageMetadata({ title, description, path }: PageMetadataInput): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      // Written out rather than left to the template: `og:title` is consumed on its
      // own, with no page around it to supply the product's name.
      title: `${title} · ${SITE_NAME}`,
      description,
      url: path,
      locale: 'en_US',
      images: [OG_IMAGE],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} · ${SITE_NAME}`,
      description,
      images: [OG_IMAGE],
    },
  };
}

/**
 * The root layout's metadata: the defaults every route inherits.
 *
 * The one field that is not simply a default is `robots`. It repeats what `robots.ts`
 * already says, and it repeats it for a reason -- `robots.txt` governs crawling and a
 * `noindex` meta tag governs indexing, and the two are not the same instruction. A
 * preview deployment that has been linked to from somewhere can be indexed despite a
 * `Disallow`, because `Disallow` only stops the crawl, not the listing. Saying it in
 * both places is what actually keeps a preview out of results.
 */
export function rootMetadata(): Metadata {
  const indexable = isProductionDeployment();

  return {
    metadataBase: new URL(absoluteUrl('/')),
    title: {
      default: SITE_NAME,
      template: `%s · ${SITE_NAME}`,
    },
    description: SITE_DESCRIPTION,
    applicationName: SITE_NAME,
    alternates: { canonical: '/' },
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      title: SITE_NAME,
      description: SITE_DESCRIPTION,
      url: '/',
      locale: 'en_US',
      images: [OG_IMAGE],
    },
    twitter: {
      card: 'summary_large_image',
      title: SITE_NAME,
      description: SITE_DESCRIPTION,
      images: [OG_IMAGE],
    },
    robots: indexable
      ? { index: true, follow: true }
      : { index: false, follow: false, nocache: true },
  };
}
