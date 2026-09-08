import type { MetadataRoute } from 'next';

import { absoluteUrl } from '@/lib/site';
import {
  allLessonParams,
  glossaryHref,
  lessonHref,
} from '@/modules/learning-center/content/navigation';
import { readyModules } from '@/modules/registry';

/**
 * Every URL worth crawling, derived rather than listed.
 *
 * Same rule as `e2e/routes.ts`: `registry.ts` is the manifest and nothing else may
 * hardcode a module list, so a module added without an entry here would be a module
 * search engines never learn about. `allLessonParams()` is the same function
 * `generateStaticParams` uses in `/learn/[track]/[lesson]`, so the set of lessons
 * listed and the set built are the same set by construction.
 *
 * Two absences are deliberate:
 *
 *  - **`/demo`** is a development playground and is excluded here and disallowed in
 *    `robots.ts`. It renders a `SimulationView` with no explanation around it, which is
 *    a confusing thing to arrive at from a search result.
 *  - **`lastModified`** is omitted from every entry. The honest value would be the
 *    commit that last touched each page, which nothing here tracks; the easy value is
 *    the build timestamp, which would tell a crawler that all forty-odd pages changed
 *    every time any one of them did. An absent date is read as "unknown", which is
 *    true, rather than as a claim that is wrong.
 *
 * Only `ready` modules are listed. A `planned` entry renders `PlannedModule` -- an
 * honest placeholder, but not a page anybody should reach from a search result.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: absoluteUrl('/'),
      changeFrequency: 'monthly',
      priority: 1,
    },
    ...readyModules().map((module) => ({
      url: absoluteUrl(module.route),
      changeFrequency: 'monthly' as const,
      // The nine simulations and the Learning Center index are what the product is.
      priority: 0.8,
    })),
    {
      url: absoluteUrl(glossaryHref()),
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    },
    ...allLessonParams().map(({ track, lesson }) => ({
      url: absoluteUrl(lessonHref(track, lesson)),
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
  ];
}
