import { describe, expect, it } from 'vitest';

import {
  OG_IMAGE,
  pageMetadata,
  rootMetadata,
  SITE_DESCRIPTION,
  SITE_NAME,
} from '@/lib/metadata';
import { absoluteUrl, isProductionDeployment, LOCAL_SITE_URL, siteUrl } from '@/lib/site';
import { allLessonParams, glossaryHref } from '@/modules/learning-center';
import { MODULES, readyModules } from '@/modules/registry';

import robots from '@/app/robots';
import sitemap from '@/app/sitemap';

/**
 * The deployment's idea of its own address, and everything derived from it.
 *
 * Two claims are worth stating up front, because both are load-bearing and neither is
 * obvious from reading any one file:
 *
 *  - the sitemap is *derived* from `registry.ts` and `allLessonParams()`, so a module
 *    or a lesson cannot ship without a URL a crawler can find;
 *  - a preview deployment canonicalises to production and refuses indexing, which is
 *    what stops every preview branch from publishing a duplicate copy of the site.
 */

describe('siteUrl', () => {
  it('prefers an explicit custom domain over anything Vercel reports', () => {
    // The case the chain exists for: Vercel's variables name the *.vercel.app host
    // even while a custom domain serves the same deployment.
    expect(
      siteUrl({
        NEXT_PUBLIC_SITE_URL: 'https://example.com',
        VERCEL_PROJECT_PRODUCTION_URL: 'proj.vercel.app',
        VERCEL_URL: 'proj-abc123.vercel.app',
      }),
    ).toBe('https://example.com');
  });

  it('normalises a domain given without a scheme or with a trailing slash', () => {
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: 'example.com' })).toBe('https://example.com');
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: 'https://example.com/' })).toBe(
      'https://example.com',
    );
  });

  it('falls back to the production host even on a preview deployment', () => {
    // Deliberate: a preview should describe itself as production, not as itself.
    expect(
      siteUrl({
        VERCEL_ENV: 'preview',
        VERCEL_PROJECT_PRODUCTION_URL: 'proj.vercel.app',
        VERCEL_URL: 'proj-abc123.vercel.app',
      }),
    ).toBe('https://proj.vercel.app');
  });

  it('uses the deployment host only when there is no production domain yet', () => {
    expect(siteUrl({ VERCEL_URL: 'proj-abc123.vercel.app' })).toBe(
      'https://proj-abc123.vercel.app',
    );
  });

  it('is localhost when nothing is set', () => {
    expect(siteUrl({})).toBe(LOCAL_SITE_URL);
  });
});

describe('absoluteUrl', () => {
  it('never emits a double slash, and never a trailing one on the root', () => {
    expect(absoluteUrl('/', {})).toBe(LOCAL_SITE_URL);
    expect(absoluteUrl('', {})).toBe(LOCAL_SITE_URL);
    expect(absoluteUrl('/dns-explorer', {})).toBe(`${LOCAL_SITE_URL}/dns-explorer`);
    expect(absoluteUrl('dns-explorer', {})).toBe(`${LOCAL_SITE_URL}/dns-explorer`);
  });
});

describe('isProductionDeployment', () => {
  it('is true for production and for an environment that does not say', () => {
    // A self-hosted build sets nothing, and must not be silently de-indexed.
    expect(isProductionDeployment({ VERCEL_ENV: 'production' })).toBe(true);
    expect(isProductionDeployment({})).toBe(true);
  });

  it('is false for a preview or a Vercel development deployment', () => {
    expect(isProductionDeployment({ VERCEL_ENV: 'preview' })).toBe(false);
    expect(isProductionDeployment({ VERCEL_ENV: 'development' })).toBe(false);
  });
});

describe('pageMetadata', () => {
  const meta = pageMetadata({
    title: 'DNS Explorer',
    description: 'Walk a domain lookup.',
    path: '/dns-explorer',
  });

  it('canonicalises to the given path, root-relative', () => {
    expect(meta.alternates?.canonical).toBe('/dns-explorer');
    expect(meta.openGraph?.url).toBe('/dns-explorer');
  });

  it('names the product in og:title, which has no page around it', () => {
    expect(meta.openGraph?.title).toBe(`DNS Explorer · ${SITE_NAME}`);
    expect(meta.twitter?.title).toBe(`DNS Explorer · ${SITE_NAME}`);
  });

  it('names the Open Graph card, because a nested segment does not inherit one', () => {
    // Metadata is shallow-merged: defining `openGraph` at all replaces the root's,
    // and with it the image Next injected from `app/opengraph-image.tsx`. Leaving
    // `images` out here is what makes a shared module or lesson link unfurl blank.
    expect(meta.openGraph?.images).toEqual([OG_IMAGE]);
    expect(meta.twitter?.images).toEqual([OG_IMAGE]);
    expect(rootMetadata().openGraph?.images).toEqual([OG_IMAGE]);
  });
});

describe('rootMetadata', () => {
  it('sets a metadataBase, without which every relative URL resolves to localhost', () => {
    expect(rootMetadata().metadataBase?.toString()).toContain('://');
  });

  it('carries the title template and the product description', () => {
    const meta = rootMetadata();

    expect(meta.title).toEqual({
      default: SITE_NAME,
      template: `%s · ${SITE_NAME}`,
    });
    expect(meta.description).toBe(SITE_DESCRIPTION);
  });
});

describe('sitemap', () => {
  const urls = sitemap().map((entry) => entry.url);

  it('lists every ready module, derived from the registry', () => {
    for (const entry of readyModules()) {
      expect(urls).toContain(absoluteUrl(entry.route));
    }
  });

  it('lists every lesson the route pre-renders, and the glossary', () => {
    // Same function `generateStaticParams` uses, so the set listed and the set built
    // are the same set rather than two lists that agree today.
    expect(urls).toContain(absoluteUrl(glossaryHref()));
    for (const { track, lesson } of allLessonParams()) {
      expect(urls).toContain(absoluteUrl(`/learn/${track}/${lesson}`));
    }
  });

  it('omits the demo playground and anything not ready', () => {
    expect(urls.some((url) => url.includes('/demo'))).toBe(false);

    for (const entry of MODULES.filter((m) => m.status !== 'ready')) {
      expect(urls).not.toContain(absoluteUrl(entry.route));
    }
  });

  it('has no duplicates and no relative entries', () => {
    expect(new Set(urls).size).toBe(urls.length);
    for (const url of urls) expect(url).toMatch(/^https?:\/\//);
  });

  it('states no lastModified, rather than a build timestamp that would be a lie', () => {
    for (const entry of sitemap()) expect(entry.lastModified).toBeUndefined();
  });
});

describe('robots', () => {
  it('keeps crawlers out of the diagnostics API and the demo playground', () => {
    // `/api/` is where every outbound request originates. A crawler walking it would
    // be this deployment scanning hosts on someone else's behalf.
    const rules = robots().rules;
    expect(Array.isArray(rules)).toBe(false);
    expect((rules as { disallow?: string[] }).disallow).toEqual(['/api/', '/demo']);
  });

  it('points at the sitemap', () => {
    expect(robots().sitemap).toBe(absoluteUrl('/sitemap.xml'));
  });
});
