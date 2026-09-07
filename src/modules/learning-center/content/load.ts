/**
 * The only file in the project that imports a lesson.
 *
 * The map is written out by hand instead of `import(`./lessons/${slug}.mdx`)` for two
 * reasons. A template-literal import compiles to a bundler context module: every file
 * in the folder is pulled into the graph whether or not a track lists it, and a
 * mistyped slug becomes a runtime rejection rather than a build error. Written out,
 * the set of lessons that *exist* is a value the content test can compare against the
 * set of lessons the tracks *reference*, so a lesson with no MDX file and an MDX file
 * in no track are both caught before anyone loads a page.
 *
 * Each entry stays lazy. `/learn` renders the whole curriculum and must not carry the
 * bytes of every lesson to do it; the route awaits exactly the one it is rendering.
 */

import type { MDXProps } from 'mdx/types';
import type { ReactNode } from 'react';

/**
 * A compiled lesson.
 *
 * `props.components` is how the route injects `<Quiz>`, `<Term>` and the rest -- see
 * `components/lessonComponents.ts`. The MDX file itself imports nothing.
 */
export type LessonContent = (props: MDXProps) => ReactNode;

type LessonLoader = () => Promise<{ default: LessonContent }>;

const LOADERS: Record<string, LessonLoader> = {
  'what-is-a-network': () => import('./lessons/what-is-a-network.mdx'),
  'addresses-and-subnets': () => import('./lessons/addresses-and-subnets.mdx'),
  'routing-and-the-path-between': () =>
    import('./lessons/routing-and-the-path-between.mdx'),
  'tcp-and-udp': () => import('./lessons/tcp-and-udp.mdx'),
  'from-url-to-pixels': () => import('./lessons/from-url-to-pixels.mdx'),
  'the-second-visit': () => import('./lessons/the-second-visit.mdx'),
  'why-pages-feel-slow': () => import('./lessons/why-pages-feel-slow.mdx'),
  'when-a-page-load-fails': () => import('./lessons/when-a-page-load-fails.mdx'),
  'how-a-name-is-resolved': () => import('./lessons/how-a-name-is-resolved.mdx'),
  'records-aliases-and-delegation': () =>
    import('./lessons/records-aliases-and-delegation.mdx'),
  'dns-caching-and-ttl': () => import('./lessons/dns-caching-and-ttl.mdx'),
  'dnssec-and-the-chain-of-trust': () =>
    import('./lessons/dnssec-and-the-chain-of-trust.mdx'),
  'anatomy-of-an-http-message': () => import('./lessons/anatomy-of-an-http-message.mdx'),
  'status-codes-and-redirects': () => import('./lessons/status-codes-and-redirects.mdx'),
  'http-caching': () => import('./lessons/http-caching.mdx'),
  'cookies-and-sessions': () => import('./lessons/cookies-and-sessions.mdx'),
  'cross-origin-requests': () => import('./lessons/cross-origin-requests.mdx'),
  'http-1-2-and-3': () => import('./lessons/http-1-2-and-3.mdx'),
  'what-tls-actually-does': () => import('./lessons/what-tls-actually-does.mdx'),
  'certificates-and-trust': () => import('./lessons/certificates-and-trust.mdx'),
  'handshakes-and-resumption': () => import('./lessons/handshakes-and-resumption.mdx'),
  'what-https-does-not-protect': () =>
    import('./lessons/what-https-does-not-protect.mdx'),
  'rest-and-resources': () => import('./lessons/rest-and-resources.mdx'),
  'api-authentication': () => import('./lessons/api-authentication.mdx'),
  'pagination-and-rate-limits': () => import('./lessons/pagination-and-rate-limits.mdx'),
  webhooks: () => import('./lessons/webhooks.mdx'),
  'choosing-a-realtime-transport': () =>
    import('./lessons/choosing-a-realtime-transport.mdx'),
  'the-websocket-upgrade': () => import('./lessons/the-websocket-upgrade.mdx'),
  'keeping-a-websocket-alive': () => import('./lessons/keeping-a-websocket-alive.mdx'),
  'cdns-and-the-edge': () => import('./lessons/cdns-and-the-edge.mdx'),
  'load-balancers-and-reverse-proxies': () =>
    import('./lessons/load-balancers-and-reverse-proxies.mdx'),
  'nat-and-private-addresses': () => import('./lessons/nat-and-private-addresses.mdx'),
  'firewalls-and-segmentation': () => import('./lessons/firewalls-and-segmentation.mdx'),
};

/** Every slug with an MDX file, for the content test to compare against the tracks. */
export function lessonSlugsWithContent(): string[] {
  return Object.keys(LOADERS);
}

/**
 * Compile and return one lesson.
 *
 * `undefined` rather than a throw for an unknown slug: the route turns that into a
 * 404, which is the honest answer, and a missing lesson is not an exception the page
 * can do anything about.
 */
export async function loadLessonContent(
  slug: string,
): Promise<LessonContent | undefined> {
  const load = LOADERS[slug];
  if (!load) return undefined;

  const mod = await load();
  return mod.default;
}
